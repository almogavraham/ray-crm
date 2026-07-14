/**
 * insightEngine.ts
 * Pure client-side insight computation — zero API calls.
 * Runs on every render (memoized in App.tsx).
 */
import type { Lead, StandaloneTask, TeamMember } from '../types';
import type { WorkspaceProfile } from '../types';

export type InsightType = 'warning' | 'opportunity' | 'setup' | 'tip' | 'milestone';

export interface Insight {
  id: string;
  type: InsightType;
  priority: number;   // 1–10 (higher = more urgent)
  icon: string;       // emoji
  title: string;
  body: string;
  query: string;      // pre-filled AI chat query
  action?: string;    // optional action button label
  page?: string;      // most relevant page slug (optional)
}

interface EngineParams {
  leads: Lead[];
  standaloneTask: StandaloneTask[];
  team: TeamMember[];
  workspace?: WorkspaceProfile | null;
  currentPage?: string;
}

/* ─── helpers ───────────────────────────────────────────────────────────── */
function daysSince(dateStr?: string | null): number {
  if (!dateStr) return 9999;
  try {
    let date = new Date(dateStr);
    // Handle Hebrew/Israeli locale formats: "D.M.YYYY" or "DD/MM/YYYY"
    if (isNaN(date.getTime())) {
      const sep = dateStr.includes('/') ? '/' : dateStr.includes('.') ? '.' : null;
      if (sep) {
        const parts = dateStr.split(sep).map(Number);
        if (parts.length === 3) {
          const [d, m, y] = parts;
          if (!isNaN(d) && !isNaN(m) && !isNaN(y) && y > 1000) {
            date = new Date(y, m - 1, d);
          }
        }
      }
    }
    if (isNaN(date.getTime())) return 9999;
    return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  } catch { return 9999; }
}

function leadLastActivity(l: Lead): number {
  const log = l.activityLog ?? [];
  const lastLog = log.length ? log[log.length - 1].timestamp : null;
  const dates = [lastLog, l.lastContactDate, l.lastUpdate].filter(Boolean) as string[];

  if (dates.length > 0) {
    const computed = dates.map(d => daysSince(d));
    const valid = computed.filter(n => isFinite(n) && n < 9999);
    if (valid.length > 0) return Math.min(...valid);
  }

  // No valid string dates — fall back to createdAt (Unix ms timestamp)
  if (l.createdAt && typeof l.createdAt === 'number' && l.createdAt > 0) {
    return Math.max(0, Math.floor((Date.now() - l.createdAt) / 86_400_000));
  }
  return 9999;
}

/* ─── milestone helpers (stored in localStorage) ────────────────────────── */
const MS_KEY = 'ray-milestones';
function loadMilestones(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(MS_KEY) ?? '{}'); } catch { return {}; }
}
export function saveMilestone(id: string): void {
  const m = loadMilestones();
  m[id] = true;
  localStorage.setItem(MS_KEY, JSON.stringify(m));
}

export const MILESTONE_DEFS = [
  { id: 'first_lead',       label: 'הוסף ליד ראשון',             icon: '👤', check: (p: EngineParams) => p.leads.length > 0 },
  { id: 'first_task',       label: 'צור משימה ראשונה',            icon: '✅', check: (p: EngineParams) => p.standaloneTask.length > 0 || p.leads.some(l => l.tasks?.length > 0) },
  { id: 'email_connected',  label: 'חבר אימייל',                  icon: '📧', check: (p: EngineParams) => !!(p.workspace?.emailConfig?.gmailUser || p.workspace?.emailConfig?.emailServiceId) },
  { id: 'lead_assigned',    label: 'שייך ליד לאיש צוות',          icon: '🤝', check: (p: EngineParams) => p.leads.some(l => l.assignedTo) },
  { id: 'first_automation', label: 'צור אוטומציה ראשונה',         icon: '⚡', check: (_p: EngineParams) => false }, // checked via Firestore elsewhere
];

export function getMilestoneProgress(params: EngineParams): { done: number; total: number; nextMilestone: typeof MILESTONE_DEFS[0] | null } {
  const completed = loadMilestones();
  // Also check live data
  MILESTONE_DEFS.forEach(m => { if (m.check(params)) { saveMilestone(m.id); completed[m.id] = true; } });
  const done = MILESTONE_DEFS.filter(m => completed[m.id]).length;
  const nextMilestone = MILESTONE_DEFS.find(m => !completed[m.id]) ?? null;
  return { done, total: MILESTONE_DEFS.length, nextMilestone };
}

/* ─── main engine ────────────────────────────────────────────────────────── */
export function computeInsights(params: EngineParams): Insight[] {
  const { leads, standaloneTask, workspace } = params;
  const insights: Insight[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);

  /* 1. Stale leads — no activity 14+ days, not closed */
  const staleLeads = leads.filter(l =>
    !['לא רלוונטי', 'לקוח פעיל'].includes(l.status) &&
    leadLastActivity(l) >= 14
  );
  if (staleLeads.length > 0) {
    insights.push({
      id: 'stale_leads',
      type: 'warning',
      priority: 9,
      icon: '🔔',
      title: `${staleLeads.length} לידים ממתינים לטיפול`,
      body: `לא טופלו ${staleLeads.length > 1 ? `${staleLeads.length} לידים` : `הליד ${staleLeads[0].company}`} ב-14+ יום`,
      query: `יש לי ${staleLeads.length} לידים שלא טופלו ב-14 יום האחרונים: ${staleLeads.slice(0, 3).map(l => l.company).join(', ')}. צור לי תוכנית מעקב ומשימות לכל אחד`,
      action: 'צור משימות מעקב',
      page: 'dashboard',
    });
  }

  /* 2. Email not configured */
  const emailOk = !!(workspace?.emailConfig?.gmailUser || workspace?.emailConfig?.emailServiceId);
  if (!emailOk) {
    insights.push({
      id: 'no_email',
      type: 'setup',
      priority: 8,
      icon: '📧',
      title: 'אימייל לא מחובר',
      body: 'חבר Gmail, Outlook, או EmailJS כדי לשלוח מיילים מהמערכת',
      query: 'תסביר לי איך לחבר את האימייל שלי למערכת RAY CRM. מה האפשרויות שיש?',
      action: 'חבר אימייל',
      page: 'integrations',
    });
  }

  /* 3. Overdue tasks */
  const overdue = leads.flatMap(l => (l.tasks ?? []).filter(t => {
    if (t.completed) return false;
    try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; }
  }));
  const overdueStandalone = standaloneTask.filter(t => {
    if (t.completed) return false;
    try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; }
  });
  const totalOverdue = overdue.length + overdueStandalone.length;
  if (totalOverdue > 0) {
    insights.push({
      id: 'overdue_tasks',
      type: 'warning',
      priority: 8,
      icon: '⏰',
      title: `${totalOverdue} משימות באיחור`,
      body: `${totalOverdue} משימות שהיו אמורות להסתיים כבר`,
      query: `יש לי ${totalOverdue} משימות שפג תוקפן. עזור לי לארגן אותן מחדש ולקבוע עדיפויות`,
      action: 'ארגן משימות',
      page: 'tasks',
    });
  }

  /* 4. Leads in "בתהליך" for 30+ days */
  const longProcess = leads.filter(l =>
    l.status === 'בתהליך' && daysSince(l.lastUpdate) >= 30
  );
  if (longProcess.length > 0) {
    insights.push({
      id: 'long_process',
      type: 'opportunity',
      priority: 7,
      icon: '🎯',
      title: `${longProcess.length} לידים תקועים בתהליך`,
      body: `${longProcess.slice(0, 2).map(l => l.company).join(', ')} — 30+ יום ללא התקדמות`,
      query: `הלידים הבאים תקועים בשלב "בתהליך" יותר מ-30 יום: ${longProcess.map(l => l.company).join(', ')}. מה האסטרטגיה הטובה ביותר לסגור אותם?`,
      action: 'קבל אסטרטגיה',
      page: 'kanban',
    });
  }

  /* 5. Unassigned leads (when team > 1) */
  const teamCount = params.team.length;
  if (teamCount > 1) {
    const unassigned = leads.filter(l => !l.assignedTo && !['לא רלוונטי','לקוח פעיל'].includes(l.status));
    if (unassigned.length >= 3) {
      insights.push({
        id: 'unassigned_leads',
        type: 'tip',
        priority: 6,
        icon: '👥',
        title: `${unassigned.length} לידים לא משוייכים`,
        body: `לצוות יש ${teamCount} חברים — אפשר לחלק עומסים חכם`,
        query: `יש לי ${unassigned.length} לידים שלא משוייכים לאיש צוות. הצוות שלי: ${params.team.map(m => m.name).join(', ')}. כיצד לחלק אותם?`,
        action: 'חלק לידים',
        page: 'dashboard',
      });
    }
  }

  /* 6. No WhatsApp integration */
  const waOk = !!(workspace?.whatsappToken || workspace?.whatsappPhoneId);
  if (!waOk && leads.length > 5) {
    insights.push({
      id: 'no_whatsapp',
      type: 'setup',
      priority: 5,
      icon: '💬',
      title: 'WhatsApp לא מחובר',
      body: 'חבר WhatsApp Business API לשליחת הודעות ישירות ללידים',
      query: 'איך אני מחבר WhatsApp Business API למערכת? הסבר לי את התהליך',
      action: 'חבר WhatsApp',
      page: 'integrations',
    });
  }

  /* 7. High-budget leads without follow-up */
  const highBudgetStale = leads.filter(l =>
    (l.budget ?? 0) >= 10000 &&
    !['לא רלוונטי', 'לקוח פעיל'].includes(l.status) &&
    leadLastActivity(l) >= 7
  );
  if (highBudgetStale.length > 0) {
    insights.push({
      id: 'high_budget_stale',
      type: 'opportunity',
      priority: 9,
      icon: '💰',
      title: `ליד בתקציב גבוה ממתין`,
      body: `${highBudgetStale[0].company} — ₪${(highBudgetStale[0].budget ?? 0).toLocaleString()} — 7+ ימים ללא מגע`,
      query: `הליד ${highBudgetStale[0].company} עם תקציב של ₪${(highBudgetStale[0].budget ?? 0).toLocaleString()} לא טופל ב-7 ימים. תן לי אסטרטגיה וכתוב לי הצעת מחיר`,
      action: 'טפל עכשיו',
      page: 'dashboard',
    });
  }

  /* 8. Milestone — next step in onboarding */
  const { nextMilestone, done, total } = getMilestoneProgress(params);
  if (nextMilestone && done < total) {
    insights.push({
      id: `milestone_${nextMilestone.id}`,
      type: 'milestone',
      priority: done === 0 ? 10 : 4,
      icon: nextMilestone.icon,
      title: `הצעד הבא: ${nextMilestone.label}`,
      body: `${done}/${total} צעדי הגדרה הושלמו — המשך להגדיר את המערכת`,
      query: `אני רוצה לבצע את הצעד הבא במערכת: ${nextMilestone.label}. תסביר לי איך עושים את זה ומה היתרון`,
      action: 'כיצד?',
      page: 'settings',
    });
  }

  // Sort by priority desc
  return insights.sort((a, b) => b.priority - a.priority);
}
