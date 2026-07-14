import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import type { TaskPriority } from '../types';

export interface StatusAutomation {
  createTask?: {
    description: string;   // supports {{company}}, {{contact}} placeholders
    priority: TaskPriority;
    daysOffset: number;    // 0=today, 1=tomorrow
  };
  dashboardSection?: string; // e.g. 'meetings', 'demos', 'proposals'
  nextStatusSuggestion?: string;
}

export interface StatusConfig {
  id: string;           // same as label for backward compat
  label: string;
  color: string;        // hex
  emoji: string;
  order: number;
  isDefault: boolean;
  pipeline: boolean;    // show in kanban/pipeline
  automation?: StatusAutomation;
  description?: string; // for AI context
}

/** Statuses that are permanently hidden from the filter bar and UI */
const REMOVED_STATUSES = new Set(['פגישה נקבעה', 'הצעת מחיר נשלחה']);

export const DEFAULT_STATUS_CONFIGS: StatusConfig[] = [
  {
    id: 'חדש', label: 'חדש', color: '#6366f1', emoji: '🆕', order: 0, isDefault: true, pipeline: true,
    description: 'ליד חדש שטרם טופל',
    automation: { createTask: { description: 'יצירת קשר ראשונית עם {{contact}} מ-{{company}}', priority: 'high', daysOffset: 0 } },
  },
  {
    id: 'בתהליך', label: 'בתהליך', color: '#f97316', emoji: '⚡', order: 1, isDefault: true, pipeline: true,
    description: 'ליד בתהליך מכירה פעיל',
    automation: { createTask: { description: 'מעקב אחרי {{company}} — עדכון סטטוס', priority: 'medium', daysOffset: 3 } },
  },
  {
    id: 'לקוח פעיל', label: 'לקוח פעיל', color: '#10b981', emoji: '✅', order: 4, isDefault: true, pipeline: false,
    description: 'לקוח שסגר עסקה ופעיל',
    automation: {
      createTask: { description: 'שיחת onboarding עם {{contact}} מ-{{company}}', priority: 'high', daysOffset: 1 },
      dashboardSection: 'active',
    },
  },
  {
    id: 'רימרקטינג', label: 'רימרקטינג', color: '#8b5cf6', emoji: '🔄', order: 5, isDefault: true, pipeline: true,
    description: 'ליד שהיה לקוח — ניסיון חוזר',
    automation: { createTask: { description: 'שליחת הצעה מחודשת ל-{{company}}', priority: 'medium', daysOffset: 2 } },
  },
  {
    id: 'לא רלוונטי', label: 'לא רלוונטי', color: '#64748b', emoji: '❌', order: 6, isDefault: true, pipeline: false,
    description: 'ליד שאינו מתאים לשלב זה',
  },
];

export function getStatusConfig(label: string, configs: StatusConfig[]): StatusConfig {
  return configs.find(c => c.id === label || c.label === label) ?? {
    id: label, label, color: '#6366f1', emoji: '📌', order: 99, isDefault: false, pipeline: true,
  };
}

export function resolveTaskDescription(template: string, lead: { company?: string; contactName?: string }): string {
  return template
    .replace(/\{\{company\}\}/g, lead.company ?? 'הלקוח')
    .replace(/\{\{contact\}\}/g, lead.contactName ?? 'איש הקשר');
}

/**
 * Returns saved configs from Firestore, or `null` if the document was never
 * written (so the caller can fall back to localStorage / defaults without
 * accidentally overwriting a valid local state).
 */
export async function loadStatusConfigs(workspaceId: string): Promise<StatusConfig[] | null> {
  try {
    const db = getFirestore();
    const snap = await getDoc(doc(db, 'workspaces', workspaceId, 'config', 'statuses'));
    if (!snap.exists()) return null;                           // nothing saved yet → caller falls back to localStorage
    const data = snap.data() as { configs?: StatusConfig[] };
    if (!data.configs?.length) return null;                    // empty document → same fallback
    // Return exactly what the user saved — no automatic re-injection of defaults.
    // (Defaults were only added when the document was first created.)
    const savedConfigs = data.configs.filter(c => !REMOVED_STATUSES.has(c.id));
    if (!savedConfigs.length) return null;
    return savedConfigs.sort((a, b) => a.order - b.order);
  } catch { return null; }
}

export async function saveStatusConfigs(workspaceId: string, configs: StatusConfig[]): Promise<void> {
  const db = getFirestore();
  await setDoc(doc(db, 'workspaces', workspaceId, 'config', 'statuses'), { configs });
}
