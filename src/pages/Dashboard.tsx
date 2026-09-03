import { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, Filter, Download, Flame, CheckCircle2, Rocket, Users,
  ChevronDown, Bell, ArrowUpDown, ArrowUp, ArrowDown, X, Trash2,
  Sparkles, MessageCircle, FileSpreadsheet, Snowflake, AlertCircle,
  Zap, Clock, BarChart2, SlidersHorizontal, Mail, Send, PhoneOff, ShieldAlert, Megaphone,
  UserCheck, UserMinus, Settings2, Plus, ChevronLeft, ChevronRight,
} from 'lucide-react';
import type { Lead, LeadStatus, WorkspaceProfile, StandaloneTask, TeamMember, CardLayoutSettings } from '../types';
import { DEFAULT_CARD_LAYOUT, DEFAULT_CARD_SECTIONS } from '../types';
import type { StatusConfig } from '../lib/statusConfig';
import { DEFAULT_STATUS_CONFIGS } from '../lib/statusConfig';
import EmailModal from '../components/EmailModal';
import ExcelImportModal from '../components/ExcelImportModal';
import WhatsAppModal from '../components/WhatsAppModal';
import DashboardAiPanel from '../components/DashboardAiPanel';
import AiInsightCard from '../components/AiInsightCard';
import CardCustomizePanel from '../components/CardCustomizePanel';
import AutomationChat from '../components/AutomationChat';
import SalesCopilot from '../components/SalesCopilot';
import MarketingCopilot from '../components/MarketingCopilot';
import RayMailChat from '../components/RayMailChat';
import { useChatBadge, setChatScope } from '../lib/chatSessionStore';
import LeadViewBar from '../components/LeadViewBar';
import { LeadCardsView } from '../components/LeadBoardView';
import Kanban from './Kanban';
import {
  loadLeadViews, saveLeadViews, isDirty, BUILT_IN_VIEWS, EMPTY_FILTERS,
} from '../lib/leadViews';
import type { LeadView, ViewMode, LeadViewFilters } from '../lib/leadViews';
import { collection, doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import type { Insight } from '../lib/insightEngine';

const ALL_STATUSES: LeadStatus[] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];
const DEFAULT_SOURCES = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

const NEON: Record<LeadStatus, string> = {
  'חדש':        '#6366f1',
  'בתהליך':     '#f97316',
  'לקוח פעיל':  '#10b981',
  'רימרקטינג':  '#8b5cf6',
  'לא רלוונטי': '#64748b',
};

type SortField = 'company' | 'status' | 'budget' | 'lastUpdate' | 'aiScore' | 'createdAt';
type SortDir   = 'asc' | 'desc';
type TempType  = 'hot' | 'cold' | 'active' | 'normal';

interface DashboardProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onNoteClick: (lead: Lead) => void;
  onTaskComplete?: (leadId: string, taskId: string) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onBulkStatusChange?: (leadIds: string[], status: LeadStatus) => void;
  onBulkDelete?: (leadIds: string[]) => void;
  compact?: boolean;
  workspace?: WorkspaceProfile;
  onOpenLeadsWizard?: () => void;
  onImportLeads?: (leads: Lead[]) => void;
  currentUser?: string;
  onCreateTask?: (task: StandaloneTask) => void;
  onUpdateLead?: (lead: Lead) => void;
  onUpdateStandaloneTask?: (task: StandaloneTask) => void;
  team?: TeamMember[];
  standaloneTask?: StandaloneTask[];
  insights?: Insight[];
  onOpenAi?: (query: string) => void;
  statusConfigs?: StatusConfig[];
  onOpenStatusEditor?: () => void;
  onWorkspaceUpdate?: (updates: Partial<WorkspaceProfile>) => Promise<void>;
  /** Switch the app to another page (used by the copilots to hand off). */
  onNavigate?: (page: string) => void;
}

/**
 * Badge on a floating chat button.
 *
 * Two states, because they mean different things to the user: a pulsing dot
 * says "still working, you can walk away", a number says "the answer is ready
 * and you haven't seen it". Both only appear while the window is closed.
 */
function ChatBadge({ unread, busy }: { unread: number; busy: boolean }) {
  if (unread > 0) {
    return (
      <span
        className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-black flex items-center justify-center"
        style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.9)' }}>
        {unread > 9 ? '9+' : unread}
      </span>
    );
  }
  if (busy) {
    return (
      <span className="absolute -top-1 -right-1 flex h-3 w-3">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-400"
          style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.9)' }} />
      </span>
    );
  }
  return null;
}

// ─── Dashboard task type for the "My Day" list ──────────────────────────────
interface DashTask {
  id: string;
  description: string;
  date: string;
  time: string;
  priority: import('../types').TaskPriority;
  completed: boolean;
  company: string;
  lead: import('../types').Lead | null;
  isStandalone: boolean;
  standaloneRef?: StandaloneTask;
}

// ─── safe helpers ───────────────────────────────────────────────────────────────
const safeStr = (v: unknown) => (v == null ? '' : String(v));
const safeArr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const safeNum = (v: unknown) => (isFinite(Number(v)) ? Number(v) : 0);

/**
 * Parse a lead's `lastUpdate` into a timestamp.
 *
 * Leads are stamped with `new Date().toLocaleDateString('he-IL')`, which yields
 * DOT-separated dates ("5.8.2026") — not slashes. Handling only '/' made every
 * freshly-created lead parse as 0, so it sorted to the very bottom of the
 * default (lastUpdate desc) ordering and looked like it had vanished.
 * Accepts ISO, dot- and slash-separated, and numeric timestamps.
 */
function parseDate(d: string | undefined): number {
  if (!d) return 0;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {                 // ISO
    const ts = new Date(s.slice(0, 10) + 'T00:00:00').getTime();
    return isNaN(ts) ? 0 : ts;
  }
  if (/^\d{10,}$/.test(s)) {                          // epoch millis
    const ts = Number(s);
    return isNaN(ts) ? 0 : ts;
  }
  const sep = s.includes('/') ? '/' : '.';            // he-IL uses dots
  const p = s.split(sep);
  if (p.length !== 3) return 0;
  const [day, month, yearRaw] = p.map(Number);
  if (!day || !month || !yearRaw) return 0;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const ts = new Date(year, month - 1, day).getTime();
  return isNaN(ts) ? 0 : ts;
}

function daysSince(s: string) {
  const ts = parseDate(s);
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function isTaskDueSoon(dateStr: string) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date(new Date().toDateString());
    const diff = Math.floor((d.getTime() - now.getTime()) / 86400000);
    return diff >= 0 && diff <= 1;
  } catch { return false; }
}

function isTaskOverdue(dateStr: string) {
  try {
    return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
  } catch { return false; }
}

/** Estimate a local AI score when lead.aiScore is 0 */
function estimateScore(lead: Lead): number {
  let s = 30; // base
  const budget = safeNum(lead.budget);
  if (budget > 50000) s += 20;
  else if (budget > 20000) s += 14;
  else if (budget > 5000)  s += 8;
  if (lead.phone)  s += 6;
  if (lead.email)  s += 4;
  const stale = daysSince(lead.lastUpdate);
  if (stale <= 3)  s += 18;
  else if (stale <= 7)  s += 12;
  else if (stale <= 14) s += 4;
  else if (stale > 30)  s -= 12;
  const openTasks = lead.tasks.filter(t => !t.completed).length;
  if (openTasks > 0) s += 8;
  const overdue = lead.tasks.filter(t => !t.completed && isTaskOverdue(t.date)).length;
  if (overdue > 0) s -= 10;
  if (lead.status === 'לקוח פעיל')  s += 12;
  if (lead.status === 'לא רלוונטי') s -= 20;
  return Math.max(5, Math.min(99, Math.round(s)));
}

function getEffectiveScore(lead: Lead): number {
  const stored = safeNum(lead.aiScore);
  return stored > 0 ? stored : estimateScore(lead);
}

function PageNav({ pageNum, totalPages, onChange }: { pageNum: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 py-3">
      <button type="button" onClick={() => onChange(Math.max(1, pageNum - 1))} disabled={pageNum === 1}
        className="p-1.5 rounded-lg transition-all disabled:opacity-25 disabled:cursor-not-allowed"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)' }}
        title="עמוד קודם">
        <ChevronRight size={13} />
      </button>
      <span className="text-[11px] font-bold whitespace-nowrap px-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
        עמוד {pageNum} מתוך {totalPages}
      </span>
      <button type="button" onClick={() => onChange(Math.min(totalPages, pageNum + 1))} disabled={pageNum === totalPages}
        className="p-1.5 rounded-lg transition-all disabled:opacity-25 disabled:cursor-not-allowed"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.5)' }}
        title="עמוד הבא">
        <ChevronLeft size={13} />
      </button>
    </div>
  );
}

function getTemperature(lead: Lead): TempType {
  if (lead.isHot) return 'hot';   // manual override always wins
  const stale = daysSince(lead.lastUpdate);
  const hasSoonTask = lead.tasks.some(t => !t.completed && isTaskDueSoon(t.date));
  if (hasSoonTask) return 'active';
  if (lead.aiScore >= 75 && stale < 7) return 'hot';
  if (stale > 21) return 'cold';
  return 'normal';
}

function calcConversion(lead: Lead): number {
  let score = getEffectiveScore(lead);
  if ((lead.budget ?? 0) > 15000) score += 10;
  if (lead.phone) score += 5;
  if (daysSince(lead.lastUpdate) > 14) score -= 15;
  const overdue = lead.tasks.filter(t => !t.completed && isTaskOverdue(t.date));
  if (overdue.length > 0) score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─── Dashboard ──────────────────────────────────────────────────────────────────
export default function Dashboard({
  leads, onLeadClick, onNoteClick, onTaskComplete, onToast, onBulkStatusChange, onBulkDelete,
  compact = false, workspace, onOpenLeadsWizard, onImportLeads, currentUser, onCreateTask, onUpdateLead,
  onUpdateStandaloneTask, team, standaloneTask, insights = [], onOpenAi,
  statusConfigs = DEFAULT_STATUS_CONFIGS, onOpenStatusEditor, onWorkspaceUpdate, onNavigate,
}: DashboardProps) {
  const { t } = useLang();
  const { isDark, c } = useTheme();
  // Use the workspace's custom lead sources (same list edited from the lead card) —
  // falls back to the default list when the workspace hasn't customized it.
  const ALL_SOURCES = workspace?.leadSources?.length ? workspace.leadSources : DEFAULT_SOURCES;
  const [newSourceInput, setNewSourceInput] = useState('');
  const [editingSources,  setEditingSources] = useState(false);
  const [search,         setSearch]         = useState('');
  const [activeStatus,   setActiveStatus]   = useState<LeadStatus | 'הכל'>('הכל');
  const [tasksExpanded,  setTasksExpanded]  = useState(false); // "היום שלי" starts collapsed on entry
  const [sourceFilter,   setSourceFilter]   = useState('');
  const [showFilters,    setShowFilters]    = useState(false);
  const [emailLead,      setEmailLead]      = useState<Lead | null>(null);
  const [whatsAppLead,   setWhatsAppLead]   = useState<Lead | null>(null);
  const [sortField,      setSortField]      = useState<SortField>('lastUpdate');
  const [sortDir,        setSortDir]        = useState<SortDir>('desc');
  const [selected,       setSelected]       = useState<Set<string>>(new Set());
  const [bulkStatus,     setBulkStatus]     = useState<LeadStatus | ''>('');
  const [deleteConfirm,  setDeleteConfirm]  = useState(false);
  const [bannerDismissed,setBannerDismissed]= useState(false);
  const [showExcelImport,setShowExcelImport]= useState(false);
  type QuickFilter = 'hot' | 'objections' | 'new' | null;
  const [quickFilter,    setQuickFilter]    = useState<QuickFilter>(null);
  const [pageSize,       setPageSize]       = useState<number>(() => {
    const stored = Number(localStorage.getItem('ray-crm-leads-page-size'));
    return [20, 50, 100].includes(stored) ? stored : 50;
  });
  const [pageNum, setPageNum] = useState(1);
  const changePageSize = (n: number) => {
    setPageSize(n);
    setPageNum(1);
    try { localStorage.setItem('ray-crm-leads-page-size', String(n)); } catch { /* ignore */ }
  };

  // ── Bulk messaging modal ────────────────────────────────────────────────────
  const [showBulkModal,   setShowBulkModal]   = useState(false);
  const [bulkChannel,     setBulkChannel]     = useState<'email' | 'whatsapp'>('email');
  const [bulkRecipients,  setBulkRecipients]  = useState<'all' | 'status' | 'source'>('all');
  const [bulkFilterValue, setBulkFilterValue] = useState('');
  const [bulkTitle,       setBulkTitle]       = useState('');
  const [bulkContent,     setBulkContent]     = useState('');
  const [bulkStep,        setBulkStep]        = useState<1 | 2 | 3>(1);

  // ── Advanced filter panel ───────────────────────────────────────────────────
  const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
  const [filterObjection,    setFilterObjection]    = useState('');
  const [filterSource,       setFilterSource]       = useState('');
  const [filterNoAnswer,     setFilterNoAnswer]     = useState(false);
  const [filterUntreated,    setFilterUntreated]    = useState(false);

  /* ── Saved views + display mode ─────────────────────────────────────────── */
  const [views,     setViews]     = useState<LeadView[]>(BUILT_IN_VIEWS);
  const [activeView, setActiveView] = useState<string>('all');
  const [viewMode,  setViewMode]  = useState<ViewMode>('table');

  // ── Editing task from My Day ─────────────────────────────────────────────────
  const [editingDashTask, setEditingDashTask] = useState<DashTask | null>(null);

  // ── Recommendation panel ─────────────────────────────────────────────────────
  type RecInsight = {
    icon: string; color: string; bg: string; border: string; text: string;
    action: string; guidance: string;
    insightLeads: Lead[];
    insightTasks: DashTask[];
  };
  const [recPanel, setRecPanel] = useState<RecInsight | null>(null);

  // ── Inline agent assignment ──────────────────────────────────────────────────
  const [assignOpen, setAssignOpen] = useState<string | null>(null); // lead.id

  useEffect(() => {
    if (!assignOpen) return;
    const handler = () => setAssignOpen(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [assignOpen]);

  const handleAssign = useCallback((lead: Lead, agentName: string | null) => {
    if (!onUpdateLead) return;
    onUpdateLead({ ...lead, assignedTo: agentName ?? '' });
    setAssignOpen(null);
  }, [onUpdateLead]);

  // ── Hot-lead scoring by activity log ────────────────────────────────────────
  const isHotLead = useCallback((l: Lead): boolean => {
    const weekAgo = Date.now() - 7 * 86400000;
    const log = safeArr<import('../types').LeadActivity>(l.activityLog as import('../types').LeadActivity[]);
    const lastActTime  = log.length ? new Date(log[log.length - 1].timestamp).getTime() : 0;
    const lastContTime = (l as any).lastContactDate ? new Date((l as any).lastContactDate).getTime() : 0;
    const recentActivity = Math.max(lastActTime, lastContTime) >= weekAgo;
    return Boolean(l.isHot) || recentActivity || (safeNum(l.aiScore) >= 70 && ['חדש','בתהליך'].includes(l.status));
  }, []);

  // ── KPI counts ───────────────────────────────────────────────────────────────
  const hotLeads      = leads.filter(isHotLead).length;
  const activeClients = leads.filter(l => l.status === 'לקוח פעיל').length;
  const onboarding    = leads.filter(l => l.status === 'בתהליך').length;
  const newLeads      = leads.filter(l => l.status === 'חדש').length;
  const conversionRate = leads.length > 0 ? Math.round((activeClients / leads.length) * 100) : 0;
  const untreatedCount = leads.filter(l => l.status === 'חדש' && !safeArr(l.activityLog).length && !l.lastContactDate).length;

  // ── Bulk messaging helpers ───────────────────────────────────────────────────
  const getBulkTargetLeads = () => {
    if (bulkRecipients === 'all') return leads;
    if (bulkRecipients === 'status') return leads.filter(l => l.status === bulkFilterValue);
    if (bulkRecipients === 'source') return leads.filter(l => l.source === bulkFilterValue);
    return leads;
  };

  const handleBulkEmail = () => {
    const targets = getBulkTargetLeads().filter(l => l.email);
    const emails = targets.slice(0, 50).map(l => l.email).join(',');
    const mailto = `mailto:${emails}?subject=${encodeURIComponent(bulkTitle)}&body=${encodeURIComponent(bulkContent)}`;
    window.open(mailto, '_blank');
    setShowBulkModal(false);
    setBulkStep(1);
  };

  const handleBulkWhatsApp = () => {
    const targets = getBulkTargetLeads().filter(l => l.phone);
    if (targets.length === 0) return;
    const msg = `${bulkTitle}\n\n${bulkContent}`;
    const firstPhone = targets[0].phone!.replace(/\D/g, '');
    const formattedPhone = firstPhone.startsWith('0') ? '972' + firstPhone.slice(1) : firstPhone;
    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank');
    if (targets.length > 1) {
      onToast?.(`נפתח וואטסאפ ל-${targets[0].contactName}. ${targets.length - 1} נמענים נוספים ממתינים.`, 'info');
    }
    setShowBulkModal(false);
    setBulkStep(1);
  };

  // Lead-embedded tasks
  const leadTasks: DashTask[] = leads
    .flatMap(l => safeArr<import('../types').Task>(l.tasks).filter(t => !t.completed).map(t => ({
      id:          t.id,
      description: t.description,
      date:        t.date,
      time:        t.time ?? '',
      priority:    (t.priority ?? 'medium') as import('../types').TaskPriority,
      completed:   false,
      company:     safeStr(l.company),
      lead:        l as import('../types').Lead,
      isStandalone: false,
    })));

  // Standalone tasks (from the tasks subcollection)
  const standaloneMapped: DashTask[] = safeArr<import('../types').StandaloneTask>(standaloneTask)
    .filter(t => !t.completed)
    .map(t => ({
      id:           `standalone-${t.id}`,
      description:  t.description ?? '',
      date:         t.date ?? '',
      time:         t.time ?? '',
      completed:    false,
      priority:     (t.priority ?? 'medium') as import('../types').TaskPriority,
      company:      t.leadId ? safeStr(leads.find(l => l.id === t.leadId)?.company) : '—',
      lead:         t.leadId ? (leads.find(l => l.id === t.leadId) ?? null) : null,
      isStandalone: true,
      standaloneRef: t,
    }));

  const upcomingTasks: DashTask[] = [...leadTasks, ...standaloneMapped]
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
    .slice(0, 8);

  // ── Daily insights ───────────────────────────────────────────────────────────
  const todayISO = new Date().toISOString().split('T')[0];
  const staleInsightLeads = leads
    .filter(l => ['חדש','בתהליך','רימרקטינג'].includes(l.status) && daysSince(l.lastUpdate) >= 7)
    .sort((a, b) => daysSince(b.lastUpdate) - daysSince(a.lastUpdate))
    .slice(0, 8);
  const hotInsightLeads = leads
    .filter(l => isHotLead(l) && ['חדש','בתהליך'].includes(l.status))
    .sort((a, b) => safeNum(b.aiScore) - safeNum(a.aiScore))
    .slice(0, 8);
  const allTasks = [...leadTasks, ...standaloneMapped];
  const todayInsightTasks  = allTasks.filter(t => t.date === todayISO);
  const overdueInsightTasks = allTasks.filter(t => t.date && t.date < todayISO);
  const staleLeadsCount   = staleInsightLeads.length;
  const overdueTasksCount = overdueInsightTasks.length;
  const hotLeadsToContact = hotInsightLeads.length;
  const todayTasksCount   = todayInsightTasks.length;

  const dailyInsights = [
    staleLeadsCount > 0 && {
      icon: '⏰', color: '#f97316', bg: 'rgba(249,115,22,0.1)', border: 'rgba(249,115,22,0.25)',
      text: `${staleLeadsCount} לידים לא עודכנו מעל שבוע`,
      action: `איזה לידים לא עודכנו מעל 7 ימים ומה כדאי לעשות?`,
      guidance: 'הלידים האלה לא עודכנו מזמן — כדאי לחדש קשר. שלח מייל אישי, הודעת WhatsApp, או התקשר. אחרי הפנייה — עדכן סטטוס והוסף הערה.',
      insightLeads: staleInsightLeads,
      insightTasks: [] as DashTask[],
    },
    hotLeadsToContact > 0 && {
      icon: '🔥', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)',
      text: `${hotLeadsToContact} לידים חמים ממתינים לתשומת לב`,
      action: `מי הלידים החמים ביותר שכדאי לפנות אליהם היום?`,
      guidance: 'אלה ההזדמנויות הכי טובות שלך עכשיו! יש להם ציון AI גבוה ופעילות עדכנית. הגיע הזמן לסגור — שלח הצעת מחיר, קבע פגישה, או פנה אישית.',
      insightLeads: hotInsightLeads,
      insightTasks: [] as DashTask[],
    },
    todayTasksCount > 0 && {
      icon: '✅', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)',
      text: `${todayTasksCount} משימות מתוכננות להיום`,
      action: `מה המשימות שלי להיום?`,
      guidance: 'אלה המשימות שתכננת להיום. סמן כל משימה שהשלמת, ועדכן לידים רלוונטיים בהתאם.',
      insightLeads: [] as Lead[],
      insightTasks: todayInsightTasks,
    },
    overdueTasksCount > 0 && !todayTasksCount && {
      icon: '⚠️', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)',
      text: `${overdueTasksCount} משימות שפג תוקפן`,
      action: `אילו משימות עברו את המועד שלהן?`,
      guidance: 'משימות שפג תוקפן — טפל בהן מיד או עדכן תאריך. עיכוב בטיפול בלידים עלול לגרום לאיבוד הזדמנויות.',
      insightLeads: [] as Lead[],
      insightTasks: overdueInsightTasks,
    },
    staleLeadsCount === 0 && hotLeadsToContact === 0 && todayTasksCount === 0 && overdueTasksCount === 0 && {
      icon: '🎯', color: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)',
      text: 'הכל עדכני — יום מצוין!',
      action: `מה ההזדמנויות הטובות ביותר שיש לי כרגע?`,
      guidance: 'אין פעולות דחופות — הכל מטופל. זה זמן טוב להכין הצעות מחיר חדשות או לנתח את הפייפליין.',
      insightLeads: [] as Lead[],
      insightTasks: [] as DashTask[],
    },
  ].filter(Boolean) as Array<{ icon: string; color: string; bg: string; border: string; text: string; action: string; guidance: string; insightLeads: Lead[]; insightTasks: DashTask[] }>;
  const shownInsights = dailyInsights.slice(0, 3);

  const dynamicStatuses = statusConfigs.map(c => c.label);
  const statusCounts = dynamicStatuses.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length;
    return acc;
  }, {} as Record<LeadStatus, number>);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    const q = safeStr(search).toLowerCase();
    const weekAgo = Date.now() - 7 * 86400000;
    const base = leads.filter(l => {
      const matchSearch = !q || [l.company, l.contactName, l.phone, l.email].some(f => safeStr(f).toLowerCase().includes(q));
      const matchStatus = activeStatus === 'הכל' || l.status === activeStatus;
      const matchSource = !sourceFilter || l.source === sourceFilter;
      let matchQuick = true;
      if (quickFilter === 'hot')        matchQuick = isHotLead(l);
      if (quickFilter === 'objections') matchQuick = !!(l as any).objection;
      if (quickFilter === 'new')        matchQuick = parseDate(l.lastUpdate) >= weekAgo || l.status === 'חדש';
      // Advanced filters
      const matchObjection  = !filterObjection || (l as any).objection === filterObjection;
      const matchAdvSource  = !filterSource || l.source === filterSource;
      const matchNoAnswer   = !filterNoAnswer || ((l as any).nextFollowUpDate && new Date((l as any).nextFollowUpDate) < new Date());
      const matchUntreated  = !filterUntreated || (l.status === 'חדש' && !safeArr(l.activityLog).length && !l.lastContactDate);
      return matchSearch && matchStatus && matchSource && matchQuick && matchObjection && matchAdvSource && matchNoAnswer && matchUntreated;
    });
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'company')    cmp = safeStr(a.company).localeCompare(safeStr(b.company), 'he');
      if (sortField === 'status')     cmp = safeStr(a.status).localeCompare(safeStr(b.status), 'he');
      if (sortField === 'budget')     cmp = safeNum(a.budget) - safeNum(b.budget);
      if (sortField === 'aiScore')    cmp = safeNum(a.aiScore) - safeNum(b.aiScore);
      if (sortField === 'lastUpdate') cmp = parseDate(a.lastUpdate) - parseDate(b.lastUpdate);
      if (sortField === 'createdAt')  cmp = (a.createdAt ?? 0) - (b.createdAt ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, search, activeStatus, sourceFilter, sortField, sortDir, quickFilter, filterObjection, filterSource, filterNoAnswer, filterUntreated, isHotLead]);

  // How many of the filtered leads to actually render on screen (20/50/100 — user-controlled).
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Reset to page 1 whenever the active filters/search/sort change (NOT when the
  // underlying leads data itself refreshes via the realtime listener — that
  // shouldn't yank the user back to page 1 mid-browse).
  useEffect(() => { setPageNum(1); }, [search, activeStatus, sourceFilter, quickFilter, filterObjection, filterSource, filterNoAnswer, filterUntreated, sortField, sortDir]);
  // Clamp if the current page no longer exists (e.g. leads were deleted).
  useEffect(() => { if (pageNum > totalPages) setPageNum(totalPages); }, [pageNum, totalPages]);
  const paged = useMemo(() => filtered.slice((pageNum - 1) * pageSize, pageNum * pageSize), [filtered, pageSize, pageNum]);

  /**
   * Full Excel export: every lead plus dedicated sheets for notes and
   * solutions. Deliberately exports ALL leads, not the filtered view — this is
   * the 'take my data out' button, and silently shipping a filtered subset is
   * the kind of surprise that costs someone a report.
   */
  const [exporting, setExporting] = useState(false);
  const exportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { exportLeadsToExcel } = await import('../lib/leadsExport');
      const r = await exportLeadsToExcel(leads, { workspaceName: workspace?.name });
      onToast?.(`✅ ${r.fileName} — ${r.leads} לידים · ${r.notes} הערות · ${r.solutions} פתרונות`, 'success');
    } catch (err) {
      console.error('[export]', err);
      onToast?.(`ייצוא נכשל: ${(err as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const toggleSelect    = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleSelectAll = () => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)));
  const clearSelection  = () => { setSelected(new Set()); setBulkStatus(''); setDeleteConfirm(false); };

  const handleBulkDelete = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); setTimeout(() => setDeleteConfirm(false), 3000); return; }
    onBulkDelete?.([...selected]);
    clearSelection();
  };
  const applyBulkStatus = () => {
    if (!bulkStatus || selected.size === 0) return;
    onBulkStatusChange?.([...selected], bulkStatus as LeadStatus);
    clearSelection();
  };

  const addSourceItem = async () => {
    if (!newSourceInput.trim() || !onWorkspaceUpdate) return;
    if (ALL_SOURCES.includes(newSourceInput.trim())) { setNewSourceInput(''); return; }
    const updated = [...ALL_SOURCES, newSourceInput.trim()];
    await onWorkspaceUpdate({ leadSources: updated });
    setNewSourceInput('');
    onToast?.('מקור נוסף ✓', 'success');
  };
  const removeSourceItem = async (s: string) => {
    if (!onWorkspaceUpdate) return;
    const updated = ALL_SOURCES.filter(x => x !== s);
    await onWorkspaceUpdate({ leadSources: updated });
    if (sourceFilter === s) setSourceFilter('');
    onToast?.('מקור הוסר', 'info');
  };

  // ── Card layout customization — same workspace.cardLayout field the lead-card's
  // own "🎨 עיצוב" button reads/writes, so both entry points stay in sync automatically.
  const [showCustomize, setShowCustomize] = useState(false);
  const [showAutoChat, setShowAutoChat] = useState(false);
  const [showCopilot,  setShowCopilot]  = useState(false);
  const [showMktChat,  setShowMktChat]  = useState(false);
  const [showMailChat, setShowMailChat] = useState(false);

  /* Chat sessions are stored per workspace so one client's conversation can
     never surface in another's window. */
  // Load the workspace's saved views once the workspace is known.
  useEffect(() => {
    if (!workspace?.id) return;
    let alive = true;
    void loadLeadViews(workspace.id).then(v => { if (alive) setViews(v); });
    return () => { alive = false; };
  }, [workspace?.id]);

  /** The live filter state, in the shape a view stores. */
  const currentFilters: LeadViewFilters = {
    search, activeStatus: String(activeStatus), sourceFilter,
    quickFilter: quickFilter ?? null,
    filterObjection, filterSource, filterNoAnswer, filterUntreated,
    sortField: String(sortField), sortDir,
  };

  const applyFilters = (f: LeadViewFilters) => {
    setSearch(f.search);
    setActiveStatus(f.activeStatus as LeadStatus | 'הכל');
    setSourceFilter(f.sourceFilter);
    setQuickFilter((f.quickFilter ?? null) as QuickFilter);
    setFilterObjection(f.filterObjection);
    setFilterSource(f.filterSource);
    setFilterNoAnswer(f.filterNoAnswer);
    setFilterUntreated(f.filterUntreated);
    setSortField(f.sortField as SortField);
    setSortDir(f.sortDir);
    setPageNum(1);
  };

  const pickView = (v: LeadView) => { setActiveView(v.id); setViewMode(v.mode); applyFilters(v.filters); };

  const persistViews = async (next: LeadView[]) => {
    setViews(next);
    if (!workspace?.id) { onToast?.('אין סביבת עבודה — התצוגה לא נשמרה', 'error'); return; }
    try { await saveLeadViews(workspace.id, next); }
    catch (e) { onToast?.(`שמירת התצוגה נכשלה: ${(e as Error).message}`, 'error'); }
  };

  const saveViewAs = (name: string) => {
    const v: LeadView = {
      id: `v_${Date.now()}`, name, mode: viewMode,
      filters: currentFilters, createdBy: currentUser, createdAt: Date.now(),
    };
    void persistViews([...views, v]);
    setActiveView(v.id);
    onToast?.(`התצוגה "${name}" נשמרה ✓`, 'success');
  };

  const updateActiveView = () => {
    const next = views.map(v => v.id === activeView && !v.builtIn
      ? { ...v, mode: viewMode, filters: currentFilters } : v);
    void persistViews(next);
    onToast?.('התצוגה עודכנה ✓', 'success');
  };

  const deleteView = (id: string) => {
    const v = views.find(x => x.id === id);
    if (!v || v.builtIn) return;
    if (!window.confirm(`למחוק את התצוגה "${v.name}"?`)) return;
    void persistViews(views.filter(x => x.id !== id));
    if (activeView === id) pickView(BUILT_IN_VIEWS[0]);
    onToast?.('התצוגה נמחקה', 'info');
  };

  useEffect(() => { setChatScope(workspace?.id); }, [workspace?.id]);
  const salesBadge = useChatBadge('sales');
  const mktBadge   = useChatBadge('marketing');
  const mailBadge  = useChatBadge('mail');
  const autoBadge  = useChatBadge('automation');

  // App Password (SMTP) can only SEND; reading an inbox needs OAuth. The copilot
  // is told which of the two is active so it never claims to read mail it can't.
  // OAuth accounts live in the email-agent config doc, so they're fetched lazily
  // when the copilot is first opened rather than on every leads-page render.
  const [hasOauthMail, setHasOauthMail] = useState(false);
  useEffect(() => {
    if (!showCopilot || !workspace?.id) return;
    let alive = true;
    import('../lib/gmailAgent')
      .then(m => m.loadAgentConfig(workspace.id))
      .then(cfg => { if (alive) setHasOauthMail((cfg?.accounts?.length ?? 0) > 0); })
      .catch(() => { /* treat as not connected */ });
    return () => { alive = false; };
  }, [showCopilot, workspace?.id]);

  const emailMode: 'oauth' | 'smtp' | 'none' =
    hasOauthMail ? 'oauth'
    : (workspace?.emailConfig?.gmailUser && workspace?.emailConfig?.gmailAppPasswordSet) ? 'smtp'
    : 'none';

  /** Persist an automation drafted in the chat (same collection the builder uses). */
  const saveChatWorkflow = async (d: {
    name: string; description: string; conditionLogic: 'and' | 'or';
    conditions: { id: string; type: string; value: string }[];
    actions: { id: string; type: string; config: Record<string, string> }[];
  }) => {
    if (!workspace?.id) { onToast?.('אין סביבת עבודה מחוברת', 'error'); return; }
    const id = Date.now().toString();
    try {
      await setDoc(doc(collection(db, 'workspaces', workspace.id, 'workflows'), id), {
        id, name: d.name, description: d.description ?? '', active: true,
        conditionLogic: d.conditionLogic, conditions: d.conditions, actions: d.actions,
        createdAt: new Date().toISOString(), runCount: 0,
      });
      onToast?.(`⚡ האוטומציה "${d.name}" נשמרה והופעלה`, 'success');
    } catch (err) {
      console.error('[chat workflow save]', err);
      onToast?.(`שגיאה בשמירת האוטומציה: ${(err as Error).message}`, 'error');
    }
  };
  const cardLayout: CardLayoutSettings = {
    ...DEFAULT_CARD_LAYOUT,
    ...(workspace?.cardLayout ?? {}),
    sections: (workspace?.cardLayout?.sections && workspace.cardLayout.sections.length > 0)
      ? workspace.cardLayout.sections
      : DEFAULT_CARD_SECTIONS,
  };
  const handleSaveLayout = async (newLayout: CardLayoutSettings) => {
    setShowCustomize(false);
    if (onWorkspaceUpdate) {
      await onWorkspaceUpdate({ cardLayout: newLayout });
      onToast?.('עיצוב הכרטיס עודכן ✓', 'success');
    }
  };

  const needsSetup = workspace && !workspace.leadsSetupDone;

  const dotGrid: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle, rgba(99,102,241,0.12) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
  };

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6 space-y-4"
      style={{ background: c.pageBg, backgroundImage: c.pageBgImage, backgroundSize: c.pageBgSize, minHeight: 'calc(100vh - 56px)' }}
      dir="rtl"
    >
      {emailLead    && <EmailModal    lead={emailLead}    workspace={workspace} onClose={() => setEmailLead(null)} />}
      {whatsAppLead && <WhatsAppModal lead={whatsAppLead} workspace={workspace} onClose={() => setWhatsAppLead(null)} />}

      {/* ── AI Insight Card ── */}
      {onOpenAi && insights.length > 0 && (
        <AiInsightCard insights={insights} currentPage="dashboard" onOpenAi={onOpenAi} />
      )}

      {/* ── Setup banner ── */}
      {needsSetup && !bannerDismissed && (
        <div className="relative rounded-2xl px-5 py-4 flex flex-wrap items-center gap-4"
          style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: '1px solid rgba(99,102,241,0.5)', boxShadow: '0 4px 24px rgba(99,102,241,0.3)' }}>
          <button onClick={() => setBannerDismissed(true)} className="absolute left-3 top-3 transition-colors" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <X size={14} />
          </button>
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)' }}>
            <Sparkles size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-white">עצב את כרטיס הלקוח שלך</p>
            <p className="text-xs mt-0.5 hidden sm:block" style={{ color: 'rgba(255,255,255,0.7)' }}>ענה על 3 שאלות קצרות ו-AI יתאים את המערכת לעסק שלך</p>
          </div>
          <button onClick={onOpenLeadsWizard} className="shrink-0 font-bold text-sm px-4 py-2 rounded-xl flex items-center gap-1.5 transition-all text-white"
            style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.3)'; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.2)'; }}>
            <Sparkles size={13} />מתחילים
          </button>
        </div>
      )}

      {/* ── My Day Section ── */}
      {(upcomingTasks.length > 0 || shownInsights.length > 0) && (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(10,15,30,0.7)', border: '1px solid rgba(99,102,241,0.18)', backdropFilter: 'blur(12px)' }}>
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3 cursor-pointer"
            style={{ borderBottom: tasksExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none', background: 'rgba(99,102,241,0.06)' }}
            onClick={() => setTasksExpanded(v => !v)}
          >
            <div className="flex items-center gap-3">
              <span className="font-bold text-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>☀️ היום שלי</span>
              {upcomingTasks.length > 0 && (
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                  {upcomingTasks.length}
                </span>
              )}
            </div>
            <ChevronDown size={15} className={`transition-transform ${tasksExpanded ? '' : 'rotate-90'}`} style={{ color: 'rgba(255,255,255,0.25)' }} />
          </div>

          {tasksExpanded && (
            <div className="p-4 space-y-3">
              {/* Daily insights strip */}
              {shownInsights.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-1">
                  {shownInsights.map((ins, i) => (
                    <button key={i}
                      onClick={() => {
                        if (ins.insightLeads.length === 1 && ins.insightTasks.length === 0) {
                          onLeadClick(ins.insightLeads[0]);
                        } else {
                          setRecPanel(ins);
                        }
                      }}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-right transition-all text-sm"
                      style={{ background: ins.bg, border: `1px solid ${ins.border}` }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = ''; }}>
                      <span className="text-base flex-shrink-0">{ins.icon}</span>
                      <span className="text-xs font-medium leading-tight flex-1" style={{ color: ins.color }}>{ins.text}</span>
                      <span className="text-[9px] opacity-50 flex-shrink-0" style={{ color: ins.color }}>›</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Task list */}
              {upcomingTasks.map(task => {
                const isOverdue = task.date && task.date < todayISO;
                const isToday   = task.date === todayISO;
                const rowBg     = isOverdue ? 'rgba(239,68,68,0.07)' : isToday ? 'rgba(99,102,241,0.08)' : 'rgba(249,115,22,0.06)';
                const rowBorder = isOverdue ? 'rgba(239,68,68,0.22)' : isToday ? 'rgba(99,102,241,0.25)' : 'rgba(249,115,22,0.16)';
                const taskId = task.isStandalone ? (task.standaloneRef?.id ?? task.id) : task.id;
                const leadForComplete = task.lead;
                return (
                  <div key={task.id}
                    className="flex items-center justify-between rounded-xl px-4 py-2.5 cursor-pointer transition-all gap-2"
                    style={{ background: rowBg, border: `1px solid ${rowBorder}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.filter = ''; }}
                    onClick={() => setEditingDashTask(task)}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs flex-shrink-0" style={{ color: isOverdue ? '#f87171' : 'rgba(255,255,255,0.3)' }}>
                        {isOverdue ? '⚠️' : isToday ? '☀️' : '📅'} {task.date}
                      </span>
                      {task.company && task.company !== '—' && (
                        <span className="text-xs font-medium flex-shrink-0" style={{ color: '#fb923c' }}>· {task.company}</span>
                      )}
                      <span className="text-sm font-medium truncate" style={{ color: 'rgba(255,255,255,0.8)' }}>{task.description}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-lg font-bold"
                        style={task.priority === 'high'
                          ? { background: 'rgba(239,68,68,0.18)', color: '#f87171' }
                          : task.priority === 'medium'
                            ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
                            : { background: 'rgba(99,102,241,0.15)', color: '#818cf8' }
                        }>
                        {task.priority === 'high' ? 'דחוף' : task.priority === 'medium' ? 'בינוני' : 'נמוך'}
                      </span>
                      <button type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (!task.isStandalone && leadForComplete) {
                            onTaskComplete?.(leadForComplete.id, taskId);
                          } else if (task.isStandalone && task.standaloneRef) {
                            onUpdateStandaloneTask?.({ ...task.standaloneRef, completed: true });
                          }
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg font-bold transition-all"
                        style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
                        ✓
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Task Edit Modal ── */}
      {editingDashTask && (
        <DashboardTaskEditModal
          task={editingDashTask}
          onClose={() => setEditingDashTask(null)}
          onSave={(updated) => {
            if (updated.isStandalone && updated.standaloneRef && onUpdateStandaloneTask) {
              onUpdateStandaloneTask({
                ...updated.standaloneRef,
                description: updated.description,
                date:        updated.date,
                time:        updated.time,
                priority:    updated.priority,
              });
            } else if (!updated.isStandalone && updated.lead && onUpdateLead) {
              const originalTaskId = updated.id;
              const updatedLead = {
                ...updated.lead,
                tasks: updated.lead.tasks.map(t =>
                  t.id === originalTaskId
                    ? { ...t, description: updated.description, date: updated.date, time: updated.time, priority: updated.priority }
                    : t
                ),
              };
              onUpdateLead(updatedLead);
            }
            setEditingDashTask(null);
            onToast?.('משימה עודכנה ✓', 'success');
          }}
        />
      )}


      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NeonKpiCard label="לידים חמים"                   value={hotLeads}      sub="דורשים תשומת לב"                                          icon={<Flame size={18} />}       neon="#f97316" percent={Math.round(hotLeads / Math.max(leads.length, 1) * 100)} />
        <NeonKpiCard label={t('dashboard.activeClients')} value={activeClients} sub={`${conversionRate}% ${t('dashboard.conversionRate')}`}    icon={<CheckCircle2 size={18} />} neon="#10b981" percent={conversionRate} />
        <NeonKpiCard label={t('status.inProgress')}       value={onboarding}    sub="פרויקטים פעילים"                                          icon={<Rocket size={18} />}      neon="#f97316" percent={Math.round(onboarding / Math.max(leads.length, 1) * 100)} />
        <NeonKpiCard label={t('dashboard.total')}         value={leads.length}  sub={`${newLeads} ${t('common.new')}`}                        icon={<Users size={18} />}       neon="#6366f1" percent={100} />
      </div>

      {/* ── AI Panel ── */}
      <DashboardAiPanel
        leads={leads}
        currentUser={currentUser}
        workspace={workspace}
        onCreateTask={onCreateTask}
        onUpdateLead={onUpdateLead}
        onToast={onToast}
        team={team}
        standaloneTask={standaloneTask}
        statusConfigs={statusConfigs}
      />

      {/* ── Search + Filters ── */}
      <div className="rounded-xl overflow-hidden" data-tour="dashboard-search-filters"
        style={{ background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)', boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}>

        {/* Row 1 — compact search + quick filters + actions */}
        <div className="flex items-center gap-2 px-3 py-2.5 flex-wrap">

          {/* Compact search */}
          <div className="relative w-44 sm:w-52 flex-shrink-0">
            <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'rgba(255,255,255,0.25)' }} />
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="חיפוש..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault(); }}
              className="w-full pr-8 pl-6 py-1.5 text-xs focus:outline-none rounded-xl transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
              onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; e.target.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.12)'; }}
              onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; e.target.style.boxShadow = ''; }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2" tabIndex={-1}
                style={{ color: 'rgba(255,255,255,0.3)' }}>
                <X size={11} />
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="w-px h-5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.08)' }} />

          {/* Quick filters */}
          <button type="button" onClick={() => setQuickFilter(quickFilter === 'hot' ? null : 'hot')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="לידים חמים — פעילות אחרונה בשבוע או ציון AI גבוה"
            style={quickFilter === 'hot'
              ? { background: 'rgba(249,115,22,0.2)', border: '1px solid rgba(249,115,22,0.45)', color: '#fb923c', boxShadow: '0 0 10px rgba(249,115,22,0.2)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }
            }>
            <Flame size={11} />
            <span className="hidden sm:inline">חמים</span>
          </button>

          <button type="button" onClick={() => setQuickFilter(quickFilter === 'objections' ? null : 'objections')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="לידים עם התנגדות — סטטוס לא רלוונטי עם סיבה"
            style={quickFilter === 'objections'
              ? { background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', boxShadow: '0 0 10px rgba(239,68,68,0.18)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }
            }>
            <ShieldAlert size={11} />
            <span className="hidden sm:inline">התנגדויות</span>
          </button>

          <button type="button" onClick={() => setQuickFilter(quickFilter === 'new' ? null : 'new')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="לידים חדשים — הצטרפו השבוע"
            style={quickFilter === 'new'
              ? { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.45)', color: '#a5b4fc', boxShadow: '0 0 10px rgba(99,102,241,0.18)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }
            }>
            <Zap size={11} />
            <span className="hidden sm:inline">חדשים</span>
          </button>

          {/* AI score sort */}
          <button type="button"
            onClick={() => { setSortField('aiScore'); setSortDir(sortField === 'aiScore' && sortDir === 'desc' ? 'asc' : 'desc'); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="מיון לפי ציון AI"
            style={sortField === 'aiScore'
              ? { background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.45)', color: '#c4b5fd', boxShadow: '0 0 10px rgba(139,92,246,0.18)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }
            }>
            <BarChart2 size={11} />
            <span className="hidden sm:inline">ציון AI</span>
          </button>

          {/* Divider */}
          <div className="w-px h-5 flex-shrink-0 hidden sm:block" style={{ background: 'rgba(255,255,255,0.08)' }} />

          {/* Count */}
          <span className="text-[11px] font-bold whitespace-nowrap hidden sm:block" style={{ color: 'rgba(255,255,255,0.28)' }}>
            {filtered.length > pageSize ? `מציג ${paged.length} מתוך ${filtered.length}` : `${filtered.length} לידים`}
          </span>

          {/* Page navigation */}
          <PageNav pageNum={pageNum} totalPages={totalPages} onChange={setPageNum} />

          {/* Page size selector */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[10px] font-bold hidden sm:inline" style={{ color: 'rgba(255,255,255,0.25)' }}>הצג:</span>
            {[20, 50, 100].map(n => (
              <button key={n} type="button" onClick={() => changePageSize(n)}
                className="px-2 py-1 rounded-lg text-[11px] font-bold transition-all flex-shrink-0"
                style={pageSize === n
                  ? { background: 'rgba(99,102,241,0.28)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.35)' }
                }>
                {n}
              </button>
            ))}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Untreated leads filter */}
          <button type="button"
            onClick={() => setFilterUntreated(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="לידים חדשים שלא טופלו — אין יומן פעילות ואין תאריך מגע"
            style={filterUntreated
              ? { background: 'rgba(245,158,11,0.22)', border: '1px solid rgba(245,158,11,0.5)', color: '#fbbf24', boxShadow: '0 0 10px rgba(245,158,11,0.2)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }
            }>
            <AlertCircle size={11} />
            <span className="hidden sm:inline">לא טופלו</span>
            {untreatedCount > 0 && (
              <span className="text-[9px] font-black px-1 py-0.5 rounded-full"
                style={filterUntreated
                  ? { background: 'rgba(245,158,11,0.35)', color: '#fbbf24' }
                  : { background: 'rgba(245,158,11,0.18)', color: '#fbbf24' }
                }>{untreatedCount}</span>
            )}
          </button>

          {/* Bulk messaging button */}
          <button type="button"
            onClick={() => { setShowBulkModal(true); setBulkStep(1); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="דיוור המוני — שלח מייל או וואטסאפ לקבוצת לידים"
            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.28)', color: '#818cf8' }}>
            <Send size={11} />
            <span className="hidden sm:inline">דיוור המוני</span>
          </button>

          {/* Advanced filter toggle */}
          <button type="button"
            onClick={() => setShowAdvancedFilter(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            title="סינון מתקדם"
            style={showAdvancedFilter || filterObjection || filterSource || filterNoAnswer
              ? { background: 'rgba(139,92,246,0.22)', border: '1px solid rgba(139,92,246,0.45)', color: '#c4b5fd', boxShadow: '0 0 10px rgba(139,92,246,0.18)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }
            }>
            <Filter size={11} />
            <span className="hidden sm:inline">סינון מתקדם</span>
            {(filterObjection || filterSource || filterNoAnswer) && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#c4b5fd' }} />
            )}
          </button>

          {/* Source filter */}
          <button type="button" onClick={() => setShowFilters(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
            style={showFilters || sourceFilter
              ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.45)', color: '#818cf8', boxShadow: '0 0 10px rgba(99,102,241,0.18)' }
              : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.38)' }
            }>
            <SlidersHorizontal size={11} />
            <span className="hidden sm:inline">מקור</span>
            {sourceFilter && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#818cf8' }} />}
          </button>

          <button type="button" onClick={exportExcel} disabled={exporting}
            title="ייצוא כל הלידים לאקסל — כולל גיליון הערות וגיליון פתרונות"
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0 disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.38)' }}>
            <Download size={11} />{exporting ? 'מייצא...' : 'אקסל'}
          </button>

          {onImportLeads && (
            <button type="button" onClick={() => setShowExcelImport(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.28)', color: '#34d399' }}>
              <FileSpreadsheet size={11} />
              <span className="hidden sm:inline">{t('dashboard.importExcel')}</span>
            </button>
          )}

          {onOpenLeadsWizard && (
            <button type="button"
              onClick={needsSetup ? onOpenLeadsWizard : () => setShowCustomize(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all flex-shrink-0"
              style={needsSetup
                ? { background: 'rgba(99,102,241,0.28)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc', boxShadow: '0 0 12px rgba(99,102,241,0.18)' }
                : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.38)' }
              }
              title={needsSetup ? undefined : 'עורך את אותו עיצוב כרטיס שנפתח מתוך כרטיס הליד'}>
              <Sparkles size={11} />
              <span className="hidden sm:inline">{needsSetup ? 'עצב כרטיס' : 'עצב מחדש'}</span>
            </button>
          )}
        </div>

        {showCustomize && (
          <CardCustomizePanel
            layout={cardLayout}
            statuses={statusConfigs.map(c => c.label)}
            onSave={handleSaveLayout}
            onClose={() => setShowCustomize(false)}
          />
        )}

        {/* Row 2: Status tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-3 scrollbar-hide" dir="rtl"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button type="button" onClick={() => setActiveStatus('הכל')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all mt-2"
            style={activeStatus === 'הכל'
              ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.5)', color: '#818cf8', boxShadow: '0 0 10px rgba(99,102,241,0.18)' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
            }>
            הכל
            <span className="text-[9px] font-black px-1 py-0.5 rounded-full"
              style={activeStatus === 'הכל'
                ? { background: 'rgba(99,102,241,0.28)', color: '#818cf8' }
                : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.28)' }
              }>{leads.length}</span>
          </button>
          {statusConfigs.map(cfg => {
            const s = cfg.label;
            const neon = cfg.color;
            const active = activeStatus === s;
            return (
              <button type="button" key={s} onClick={() => setActiveStatus(activeStatus === s ? 'הכל' : s)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap flex-shrink-0 transition-all mt-2"
                style={active
                  ? { background: `${neon}22`, border: `1px solid ${neon}55`, color: neon, boxShadow: `0 0 12px ${neon}28` }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.32)' }
                }>
                <span>{cfg.emoji}</span>
                <span>{s}</span>
                <span className="text-[9px] font-black px-1 py-0.5 rounded-full"
                  style={active
                    ? { background: `${neon}28`, color: neon }
                    : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.28)' }
                  }>{statusCounts[s] ?? 0}</span>
              </button>
            );
          })}
          {onOpenStatusEditor && (
            <button
              type="button"
              onClick={onOpenStatusEditor}
              title="ניהול סטטוסים"
              className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 mt-2 transition-all hover:bg-indigo-500/20"
              style={{ border: '1px solid rgba(99,102,241,0.3)', color: 'rgba(165,180,252,0.6)' }}
            >
              <Settings2 size={13} />
            </button>
          )}
        </div>

        {/* Source filter panel */}
        {showFilters && (
          <div className="px-3 pb-3 pt-2 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.28)' }}>מקור:</span>
              {['', ...ALL_SOURCES].map(s => (
                <button type="button" key={s} onClick={() => setSourceFilter(s)}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                  style={sourceFilter === s
                    ? { background: 'rgba(99,102,241,0.28)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)' }
                    : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.38)', border: '1px solid rgba(255,255,255,0.08)' }
                  }>
                  {s || 'הכל'}
                </button>
              ))}
              {onWorkspaceUpdate && (
                <button type="button" onClick={() => setEditingSources(v => !v)}
                  className="px-2 py-1 rounded-lg text-[11px] font-semibold transition-all flex items-center gap-1"
                  style={editingSources
                    ? { background: 'rgba(99,102,241,0.28)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)' }
                    : { background: 'transparent', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <Settings2 size={11} /> {editingSources ? 'סיום' : 'ערוך מקורות'}
                </button>
              )}
            </div>

            {editingSources && onWorkspaceUpdate && (
              <div className="rounded-xl p-3 space-y-2" style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_SOURCES.map(s => (
                    <span key={s} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold"
                      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}>
                      {s}
                      <button type="button" onClick={() => removeSourceItem(s)} title="הסר מקור">
                        <X size={11} className="text-red-400 hover:text-red-300" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input value={newSourceInput} onChange={e => setNewSourceInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addSourceItem()}
                    placeholder="הוסף מקור חדש..." dir="rtl"
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }} />
                  <button type="button" onClick={addSourceItem}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1"
                    style={{ background: 'rgba(99,102,241,0.9)', color: '#fff' }}>
                    <Plus size={12} /> הוסף
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Advanced filter panel */}
        {showAdvancedFilter && (
          <div className="px-3 pb-4 pt-3 space-y-3" style={{ borderTop: '1px solid rgba(139,92,246,0.15)', background: 'rgba(139,92,246,0.04)' }}>
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => { setFilterObjection(''); setFilterSource(''); setFilterNoAnswer(false); }}
                className="text-[10px] font-bold transition-colors"
                style={{ color: 'rgba(255,255,255,0.25)' }}>
                נקה הכל
              </button>
              <span className="text-[11px] font-bold" style={{ color: '#c4b5fd' }}>סינון מתקדם</span>
            </div>

            {/* Filter by source */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>מקור:</span>
              {['', ...ALL_SOURCES].map(s => (
                <button type="button" key={s} onClick={() => setFilterSource(filterSource === s ? '' : s)}
                  className="px-2 py-0.5 rounded-lg text-[10px] font-semibold transition-all"
                  style={filterSource === s && s !== ''
                    ? { background: 'rgba(139,92,246,0.28)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.4)' }
                    : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.07)' }
                  }>
                  {s || 'הכל'}
                </button>
              ))}
            </div>

            {/* Filter by objection */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>התנגדות:</span>
              <input
                type="text"
                placeholder="הקלד התנגדות..."
                value={filterObjection}
                onChange={e => setFilterObjection(e.target.value)}
                className="flex-1 max-w-[200px] px-3 py-1 text-xs rounded-lg focus:outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                onFocus={e => { e.target.style.borderColor = 'rgba(139,92,246,0.5)'; }}
                onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              />
              {filterObjection && (
                <button type="button" onClick={() => setFilterObjection('')} style={{ color: 'rgba(255,255,255,0.3)' }}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Toggle filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button"
                onClick={() => setFilterNoAnswer(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                style={filterNoAnswer
                  ? { background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }
                  : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.38)' }
                }>
                <PhoneOff size={11} />
                לא ענו (פגישה שעברה)
              </button>

              <button type="button"
                onClick={() => setFilterUntreated(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                style={filterUntreated
                  ? { background: 'rgba(245,158,11,0.18)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24' }
                  : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.38)' }
                }>
                <AlertCircle size={11} />
                לא טופלו ({untreatedCount})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Bulk Action Bar ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-30 rounded-2xl px-5 py-3 flex items-center gap-4"
          style={{ background: 'rgba(10,15,30,0.96)', backdropFilter: 'blur(20px)', border: '1px solid rgba(99,102,241,0.28)', boxShadow: '0 8px 40px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.12)' }}>
          <button type="button" onClick={clearSelection} className="text-xs font-bold transition-colors" style={{ color: 'rgba(255,255,255,0.32)' }}>✕ {t('common.cancel')}</button>
          <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <span className="text-sm font-black" style={{ color: '#818cf8' }}>{selected.size} {t('dashboard.selected')}</span>
          <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value as LeadStatus | '')}
            className="text-sm rounded-xl px-3 py-1.5 focus:outline-none cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.65)' }}>
            <option value="">{t('dashboard.bulkStatus')}...</option>
            {dynamicStatuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={applyBulkStatus} disabled={!bulkStatus}
            className="text-sm px-4 py-1.5 rounded-xl font-bold transition-all disabled:opacity-30"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.28)' }}>
            {t('common.confirm')}
          </button>
          <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
          <button type="button" onClick={exportExcel} disabled={exporting} className="flex items-center gap-1.5 text-sm transition-colors"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            <Download size={13} /> {t('common.export')}
          </button>
          {onBulkDelete && (
            <>
              <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
              <button type="button" onClick={handleBulkDelete}
                className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-xl transition-all"
                style={deleteConfirm
                  ? { background: 'rgba(239,68,68,0.28)', border: '1px solid rgba(239,68,68,0.5)', color: '#f87171', boxShadow: '0 0 12px rgba(239,68,68,0.18)' }
                  : { color: 'rgba(239,68,68,0.55)' }
                }>
                <Trash2 size={13} />
                {deleteConfirm ? `${t('common.confirm')} ${t('common.delete')} ${selected.size}` : t('common.delete')}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Saved views + display mode ── */}
      <LeadViewBar
        views={views}
        activeId={activeView}
        mode={viewMode}
        filters={currentFilters}
        dirty={isDirty(views.find(v => v.id === activeView) ?? null, currentFilters, viewMode)}
        onPick={pickView}
        onMode={setViewMode}
        onSaveAs={saveViewAs}
        onUpdate={updateActiveView}
        onRevert={() => { const v = views.find(x => x.id === activeView); if (v) pickView(v); }}
        onDelete={deleteView}
      />

      {/* Board and cards replace BOTH the mobile list and the desktop table —
          they are already responsive, so there is no separate mobile variant. */}
      {/* Board mode renders the real pipeline, not a lookalike. LeadBoardView was
          a read-only stand-in; reusing Kanban here means drag-to-change-status,
          the column styling and every capability of the pipeline page arrive at
          once and cannot drift from it later. It receives the already-filtered
          leads, so the saved view's filters still apply. */}
      {viewMode === 'board' && (
        <Kanban
          leads={filtered}
          statusConfigs={statusConfigs}
          onLeadClick={onLeadClick}
          onLeadSave={l => onUpdateLead?.(l)}
          onPageChange={onNavigate}
          workspace={workspace}
        />
      )}
      {viewMode === 'cards' && (
        <LeadCardsView leads={paged} statusConfigs={statusConfigs} onLeadClick={onLeadClick} />
      )}

      {viewMode === 'table' && (<>
      {/* ── Mobile Cards ── */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-2xl py-16 text-center flex flex-col items-center gap-3"
            style={{ border: '2px dashed rgba(99,102,241,0.18)' }}>
            <Search size={28} style={{ color: 'rgba(99,102,241,0.28)' }} />
            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>{t('dashboard.noLeads')}</span>
          </div>
        ) : paged.map(lead => {
          const neon = statusConfigs.find(c => c.label === lead.status)?.color ?? NEON[lead.status] ?? '#6366f1';
          const temp = getTemperature(lead);
          const budget = safeNum(lead.budget);
          const isVIP = budget >= 15000;
          const conversion = calcConversion(lead);
          return (
            <div key={lead.id} onClick={() => onLeadClick(lead)}
              className="relative rounded-xl cursor-pointer overflow-hidden transition-all duration-200"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', backdropFilter: 'blur(8px)', boxShadow: '0 2px 12px rgba(0,0,0,0.3)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = neon + '48'; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 24px ${neon}18`; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)'; }}>
              {/* Right NEON accent bar — replaced by the automation flag colour when set */}
              <div className="absolute top-0 right-0 h-full" style={{
                width: lead.flagColor ? '4px' : '2px',
                background: lead.flagColor
                  ? lead.flagColor
                  : `linear-gradient(to bottom,${neon},${neon}40)`,
                boxShadow: lead.flagColor ? `0 0 10px ${lead.flagColor}` : undefined,
              }} title={lead.flagColor ? (lead.flagReason || 'סומן על-ידי אוטומציה') : undefined} />
              {/* Temperature strip */}
              {temp === 'hot'    && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-orange-500 via-red-500 to-orange-500" style={{ boxShadow: '0 0 8px #f97316' }} />}
              {temp === 'cold'   && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-500 via-blue-400 to-cyan-500" style={{ boxShadow: '0 0 8px #06b6d4' }} />}
              {temp === 'active' && <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-400" style={{ boxShadow: '0 0 8px #fbbf24' }} />}

              <div className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {lead.phone && (
                      <button type="button" onClick={e => { e.stopPropagation(); setWhatsAppLead(lead); }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center transition-all"
                        style={{ background: 'rgba(22,163,74,0.14)', border: '1px solid rgba(22,163,74,0.28)', color: '#22c55e' }}
                        title="שלח WhatsApp">
                        <MessageCircle size={13} />
                      </button>
                    )}
                    <button type="button" onClick={e => { e.stopPropagation(); setEmailLead(lead); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all"
                      style={{ background: 'rgba(99,102,241,0.14)', border: '1px solid rgba(99,102,241,0.28)', color: '#818cf8' }}>
                      <Sparkles size={11} />מייל
                    </button>
                  </div>
                  <div className="flex-1 text-right">
                    <div className="flex items-center justify-end gap-2 flex-wrap">
                      <div className="font-bold text-white text-sm">{safeStr(lead.company)}</div>
                      {isVIP && <span className="text-[9px] font-black text-amber-900 px-1.5 py-0.5 rounded" style={{ background: 'linear-gradient(90deg,#fbbf24,#f59e0b)', boxShadow: '0 0 6px #f59e0b48' }}>VIP</span>}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.38)' }}>{safeStr(lead.contactName)}</div>
                    <div className="flex items-center justify-end gap-1.5 mt-1.5 flex-wrap">
                      {safeStr(lead.source) && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.35)' }}>
                          {safeStr(lead.source)}
                        </span>
                      )}
                      {/* Mobile inline assign */}
                      {team && team.length > 0 && onUpdateLead && (
                        <div className="relative" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setAssignOpen(assignOpen === `m-${lead.id}` ? null : `m-${lead.id}`); }}
                            className="flex items-center justify-center gap-1 rounded-full transition-all"
                            style={
                              lead.assignedTo
                                ? { width: 26, height: 26, background: 'rgba(99,102,241,0.3)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.5)', boxShadow: '0 0 6px rgba(99,102,241,0.2)' }
                                : { width: 26, height: 26, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.15)' }
                            }
                            title={lead.assignedTo ? `משויך ל-${lead.assignedTo}` : 'שייך סוכן'}
                          >
                            {lead.assignedTo ? (
                              <span className="text-[10px] font-black">{lead.assignedTo.charAt(0)}</span>
                            ) : (
                              <UserCheck size={11} />
                            )}
                          </button>
                          {assignOpen === `m-${lead.id}` && (
                            <div
                              className="absolute left-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-2xl min-w-[140px]"
                              style={{ background: 'rgba(10,15,30,0.98)', border: '1px solid rgba(99,102,241,0.3)', backdropFilter: 'blur(12px)' }}
                              onClick={e => e.stopPropagation()}
                            >
                              {lead.assignedTo && (
                                <button
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-right transition-colors hover:bg-red-500/10"
                                  style={{ color: 'rgba(248,113,113,0.8)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                                  onClick={() => handleAssign(lead, null)}
                                >
                                  <UserMinus size={11} />הסר שיוך
                                </button>
                              )}
                              {team.map(member => (
                                <button
                                  key={member.id}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-right transition-colors"
                                  style={{
                                    color: lead.assignedTo === member.name ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
                                    background: lead.assignedTo === member.name ? 'rgba(99,102,241,0.15)' : 'transparent',
                                  }}
                                  onMouseEnter={e => { if (lead.assignedTo !== member.name) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                                  onMouseLeave={e => { if (lead.assignedTo !== member.name) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  onClick={() => handleAssign(lead, member.name)}
                                >
                                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0"
                                    style={{ background: 'rgba(99,102,241,0.25)', color: '#818cf8' }}>
                                    {member.name.charAt(0)}
                                  </span>
                                  <span className="truncate">{member.name}</span>
                                  {lead.assignedTo === member.name && <span className="mr-auto text-indigo-400">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Fallback: show avatar when no team */}
                      {(!team || team.length === 0) && safeStr(lead.assignedTo) && (
                        <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                          style={{ background: 'rgba(99,102,241,0.25)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' }}>
                          {safeStr(lead.assignedTo).charAt(0)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {budget > 0 && (
                      <span className="text-xs font-black" style={{ color: neon }}>
                        {workspace?.cardLeftField?.prefix ?? '₪'}{budget.toLocaleString()}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: 'rgba(255,255,255,0.28)' }}>{safeStr(lead.lastUpdate)}</span>
                    {temp === 'hot'  && <span className="flex items-center gap-0.5 text-[10px] font-bold text-orange-400"><Flame size={9} />חם</span>}
                    {temp === 'cold' && <span className="flex items-center gap-0.5 text-[10px] font-bold text-cyan-400"><Snowflake size={9} />קר</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${neon}18`, color: neon, border: `1px solid ${neon}38` }}>
                      פוטנציאל: {conversion}%
                    </span>
                    <ScoreRing score={getEffectiveScore(lead)} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="md:hidden">
        <PageNav pageNum={pageNum} totalPages={totalPages} onChange={setPageNum} />
      </div>

      {/* ── Desktop Table ── */}
      <div className="hidden md:block rounded-xl overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)' }}>
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
          {/* Fixed column widths – header and data cells always align */}
          <colgroup>
            <col style={{ width: '40px' }} />   {/* checkbox */}
            <col style={{ width: '9%' }} />     {/* createdAt — first */}
            <col style={{ width: '20%' }} />    {/* company */}
            <col style={{ width: '11%' }} />    {/* contact */}
            <col style={{ width: '10%' }} />    {/* status */}
            <col style={{ width: '9%' }} />     {/* budget */}
            <col style={{ width: '9%' }} />     {/* lastUpdate */}
            <col style={{ width: '6%' }} />     {/* aiScore */}
            <col style={{ width: '26%' }} />    {/* actions */}
          </colgroup>
          <thead>
            <tr style={{ background: 'rgba(10,15,30,0.85)', borderBottom: '1px solid rgba(99,102,241,0.18)' }}>
              <th className="px-4 py-3">
                <input type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="rounded cursor-pointer accent-indigo-500" />
              </th>
              <DarkSortTh label="תאריך יצירה"               field="createdAt"  current={sortField} dir={sortDir} onSort={handleSort} />
              <DarkSortTh label={t('dashboard.company')}    field="company"    current={sortField} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('dashboard.contact')}</th>
              <DarkSortTh label={t('common.status')}        field="status"     current={sortField} dir={sortDir} onSort={handleSort} />
              <DarkSortTh label={workspace?.cardLeftField?.label ?? t('dashboard.budget')} field="budget" current={sortField} dir={sortDir} onSort={handleSort} />
              <DarkSortTh label={t('dashboard.lastUpdate')} field="lastUpdate" current={sortField} dir={sortDir} onSort={handleSort} />
              <DarkSortTh label={t('dashboard.score')}      field="aiScore"    current={sortField} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-16">
                  <div className="flex flex-col items-center gap-3">
                    <Search size={32} style={{ color: 'rgba(99,102,241,0.2)' }} />
                    <span className="text-sm" style={{ color: 'rgba(255,255,255,0.2)' }}>{t('dashboard.noLeads')}</span>
                  </div>
                </td>
              </tr>
            ) : paged.map(lead => {
              const isSelected = selected.has(lead.id);
              const budget = safeNum(lead.budget);
              const neon = statusConfigs.find(c => c.label === lead.status)?.color ?? NEON[lead.status] ?? '#6366f1';
              const temp = getTemperature(lead);
              const isVIP = budget >= 15000;
              return (
                <tr key={lead.id}
                  className="transition-all cursor-pointer"
                  title={lead.flagColor ? (lead.flagReason || 'סומן על-ידי אוטומציה') : undefined}
                  style={{
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    // An automation flag colour takes over the row marker so it's unmissable.
                    borderRight: `${lead.flagColor ? 5 : 3}px solid ${lead.flagColor || neon}`,
                    background: isSelected
                      ? 'rgba(99,102,241,0.1)'
                      : lead.flagColor ? `${lead.flagColor}0d` : 'transparent',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = `${neon}08`; }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  onClick={() => onLeadClick(lead)}>
                  <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)}
                      className="rounded cursor-pointer accent-indigo-500" />
                  </td>
                  {/* createdAt — first column */}
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-xs`} style={{ color: 'rgba(255,255,255,0.32)' }}>
                    {lead.createdAt
                      ? new Date(lead.createdAt).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })
                      : '—'}
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} overflow-hidden`}>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {temp === 'hot'    && <Flame size={10} className="text-orange-400 flex-shrink-0" />}
                        {temp === 'cold'   && <Snowflake size={10} className="text-cyan-400 flex-shrink-0" />}
                        <span className="font-bold text-white text-sm truncate">{safeStr(lead.company)}</span>
                        {isVIP && <span className="text-[8px] font-black text-amber-900 px-1 py-0.5 rounded flex-shrink-0" style={{ background: 'linear-gradient(90deg,#fbbf24,#f59e0b)' }}>VIP</span>}
                        {lead.waitingContent && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold flex-shrink-0" style={{ background: 'rgba(245,158,11,0.14)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' }}>תוכן</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {safeStr(lead.source) && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.28)' }}>{safeStr(lead.source)}</span>}
                      </div>
                    </div>
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-sm overflow-hidden`} style={{ color: 'rgba(255,255,255,0.55)' }}>
                    <span className="block truncate">{safeStr(lead.contactName)}</span>
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`}>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                      style={{ background: `${neon}18`, color: neon, border: `1px solid ${neon}38`, boxShadow: `0 0 6px ${neon}28` }}>
                      {lead.status}
                    </span>
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-sm`}>
                    {budget > 0
                      ? <span className="font-black text-xs" style={{ color: neon }}>{workspace?.cardLeftField?.prefix ?? '₪'}{budget.toLocaleString()}{isVIP && ' 🌟'}</span>
                      : <span style={{ color: 'rgba(255,255,255,0.18)' }}>—</span>}
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-xs`} style={{ color: 'rgba(255,255,255,0.32)' }}>{safeStr(lead.lastUpdate)}</td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`}>
                    <ScoreRing score={getEffectiveScore(lead)} />
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`} onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 flex-wrap">
                      {lead.phone && (
                        <button type="button"
                          onClick={e => { e.stopPropagation(); setWhatsAppLead(lead); }}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-bold transition-all"
                          style={{ background: 'rgba(22,163,74,0.1)', color: 'rgba(34,197,94,0.55)', border: '1px solid rgba(22,163,74,0.2)' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#22c55e'; (e.currentTarget as HTMLElement).style.background = 'rgba(22,163,74,0.22)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(22,163,74,0.4)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(34,197,94,0.55)'; (e.currentTarget as HTMLElement).style.background = 'rgba(22,163,74,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(22,163,74,0.2)'; }}>
                          <MessageCircle size={11} /> WA
                        </button>
                      )}
                      <button type="button" onClick={() => setEmailLead(lead)}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg font-bold transition-all"
                        style={{ background: 'rgba(99,102,241,0.1)', color: 'rgba(129,140,248,0.45)', border: '1px solid rgba(99,102,241,0.14)' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#818cf8'; (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.22)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(129,140,248,0.45)'; (e.currentTarget as HTMLElement).style.background = 'rgba(99,102,241,0.1)'; }}>
                        <Sparkles size={11} /> מייל
                      </button>

                      {/* ── Inline assign dropdown ── */}
                      {team && team.length > 0 && onUpdateLead && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); setAssignOpen(assignOpen === lead.id ? null : lead.id); }}
                            className="flex items-center justify-center rounded-full transition-all"
                            style={
                              lead.assignedTo
                                ? { width: 28, height: 28, background: 'rgba(99,102,241,0.25)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.5)', boxShadow: '0 0 8px rgba(99,102,241,0.2)' }
                                : { width: 28, height: 28, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: 'none' }
                            }
                            title={lead.assignedTo ? `משויך ל-${lead.assignedTo}` : 'שייך סוכן'}
                          >
                            {lead.assignedTo ? (
                              <span className="text-[11px] font-black">{lead.assignedTo.charAt(0)}</span>
                            ) : (
                              <UserCheck size={12} />
                            )}
                          </button>

                          {assignOpen === lead.id && (
                            <div
                              className="absolute left-0 top-full mt-1 z-50 rounded-xl overflow-hidden shadow-2xl min-w-[140px]"
                              style={{ background: 'rgba(10,15,30,0.98)', border: '1px solid rgba(99,102,241,0.3)', backdropFilter: 'blur(12px)' }}
                              onClick={e => e.stopPropagation()}
                            >
                              {/* Remove assignment */}
                              {lead.assignedTo && (
                                <button
                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-right transition-colors hover:bg-red-500/10"
                                  style={{ color: 'rgba(248,113,113,0.8)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                                  onClick={() => handleAssign(lead, null)}
                                >
                                  <UserMinus size={11} />
                                  הסר שיוך
                                </button>
                              )}
                              {/* Team members */}
                              {team.map(member => (
                                <button
                                  key={member.id}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 text-xs text-right transition-colors"
                                  style={{
                                    color: lead.assignedTo === member.name ? '#a5b4fc' : 'rgba(255,255,255,0.7)',
                                    background: lead.assignedTo === member.name ? 'rgba(99,102,241,0.15)' : 'transparent',
                                  }}
                                  onMouseEnter={e => { if (lead.assignedTo !== member.name) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                                  onMouseLeave={e => { if (lead.assignedTo !== member.name) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  onClick={() => handleAssign(lead, member.name)}
                                >
                                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0"
                                    style={{ background: 'rgba(99,102,241,0.25)', color: '#818cf8' }}>
                                    {member.name.charAt(0)}
                                  </span>
                                  <span className="truncate">{member.name}</span>
                                  {lead.assignedTo === member.name && <span className="mr-auto text-indigo-400">✓</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hidden md:block">
        <PageNav pageNum={pageNum} totalPages={totalPages} onChange={setPageNum} />
      </div>
      </>)}


      {/* ── The four smart chats, as one row centred at the top ──
          Previously four separately positioned buttons stacked up the
          bottom-left corner, which meant every new chat pushed the stack further
          up the screen and each one carried its own magic offset. One flex row
          owns the layout instead, so adding a fifth chat needs no arithmetic.

          Rendered through a portal straight onto <body> so no ancestor can turn
          `position: fixed` into "fixed relative to a transformed parent", and
          centred with a physical left/translate rather than a logical property,
          because under dir="rtl" logical inset properties resolve to the right
          edge — where the sidebar sits.

          The general AI assistant keeps its own launcher and is deliberately not
          part of this group. */}
      {createPortal(
        <div
          className="fixed z-50 flex items-center gap-2 flex-wrap justify-center px-2"
          style={{
            top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: 'min(96vw, 900px)',
          }}>
          {([
            { key: 'mail',   label: 'RAY MAIL',       icon: Mail,      badge: mailBadge,
              title: 'RAY MAIL — העוזר האישי שלך למיילים',
              bg: 'linear-gradient(135deg,#0369a1,#0891b2)', shadow: 'rgba(8,145,178,0.45)',
              open: () => setShowMailChat(true) },
            { key: 'sales',  label: 'RAY SALES',    icon: Sparkles,  badge: salesBadge,
              title: 'RAY SALES — שותף המכירות החכם שלך',
              bg: 'linear-gradient(135deg,#0f766e,#0891b2)', shadow: 'rgba(13,148,136,0.45)',
              open: () => setShowCopilot(true) },
            { key: 'mkt',    label: 'RAY Marketing',  icon: Megaphone, badge: mktBadge,
              title: 'RAY Marketing — מנהל השיווק החכם שלך',
              bg: 'linear-gradient(135deg,#a21caf,#db2777)', shadow: 'rgba(192,38,211,0.45)',
              open: () => setShowMktChat(true) },
            { key: 'auto',   label: 'בנה אוטומציה',   icon: Sparkles,  badge: autoBadge,
              title: 'בונה האוטומציות החכם — שוחח ובנה אוטומציה',
              bg: 'linear-gradient(135deg,#7c3aed,#6366f1)', shadow: 'rgba(124,58,237,0.45)',
              open: () => setShowAutoChat(true) },
          ] as const).map(b => (
            <button key={b.key} onClick={b.open} title={b.title}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-white font-bold text-[13px] transition-transform hover:scale-105 active:scale-95"
              style={{ background: b.bg, boxShadow: `0 8px 28px ${b.shadow}` }}>
              <b.icon size={16} />
              <span>{b.label}</span>
              <ChatBadge {...b.badge} />
            </button>
          ))}
        </div>,
        document.body,
      )}

      {showMailChat && (
        <RayMailChat
          workspaceId={workspace?.id}
          clientId={workspace?.emailConfig?.oauthClientId}
          onToast={(m, t) => onToast?.(m, t ?? 'info')}
          onClose={() => setShowMailChat(false)}
        />
      )}

      {showMktChat && (
        <MarketingCopilot
          leads={leads}
          workspace={workspace}
          workspaceId={workspace?.id}
          currentUser={currentUser ?? ''}
          onToast={onToast}
          onNavigate={onNavigate}
          onClose={() => setShowMktChat(false)}
        />
      )}

      {showCopilot && (
        <SalesCopilot
          leads={leads}
          team={team}
          statuses={statusConfigs.map(s => s.label)}
          currentUser={currentUser ?? ''}
          emailMode={emailMode}
          emailAddress={workspace?.emailConfig?.gmailUser}
          workspaceId={workspace?.id}
          oauthClientId={workspace?.emailConfig?.oauthClientId}
          onUpdateLead={onUpdateLead}
          onCreateTask={onCreateTask}
          onLeadClick={onLeadClick}
          onNavigate={onNavigate}
          onToast={onToast}
          onClose={() => setShowCopilot(false)}
        />
      )}

      {showAutoChat && (
        <AutomationChat
          leads={leads}
          statuses={statusConfigs.map(s => s.label)}
          sources={ALL_SOURCES}
          team={team}
          onSave={saveChatWorkflow}
          onClose={() => setShowAutoChat(false)}
        />
      )}

      {/* Excel Import Modal */}
      {showExcelImport && onImportLeads && (
        <ExcelImportModal
          onImport={leads => { onImportLeads(leads); }}
          onClose={() => setShowExcelImport(false)}
          currentUser={currentUser}
          statusConfigs={statusConfigs}
          customFieldDefs={workspace?.customFieldDefs ?? []}
        />
      )}

      {/* ── Bulk Messaging Modal ── */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowBulkModal(false); setBulkStep(1); } }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden"
            style={{ background: 'rgba(10,15,30,0.98)', border: '1px solid rgba(99,102,241,0.28)', boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 40px rgba(99,102,241,0.12)' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(99,102,241,0.08)' }}>
              <button type="button" onClick={() => { setShowBulkModal(false); setBulkStep(1); }}
                className="transition-colors" style={{ color: 'rgba(255,255,255,0.3)' }}>
                <X size={18} />
              </button>
              <div className="flex items-center gap-2">
                <Send size={16} style={{ color: '#818cf8' }} />
                <span className="font-bold text-white">דיוור המוני</span>
              </div>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-0 px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {([1, 2, 3] as const).map(step => (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-black flex-shrink-0 transition-all"
                    style={bulkStep >= step
                      ? { background: 'rgba(99,102,241,0.35)', border: '1px solid rgba(99,102,241,0.6)', color: '#a5b4fc' }
                      : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.25)' }
                    }>{step}</div>
                  {step < 3 && <div className="flex-1 h-px mx-2" style={{ background: bulkStep > step ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.07)' }} />}
                </div>
              ))}
            </div>

            <div className="px-5 py-4 space-y-4">

              {/* Step 1: Choose channel */}
              {bulkStep === 1 && (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>בחר ערוץ שליחה</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => setBulkChannel('email')}
                      className="flex flex-col items-center gap-2 py-5 rounded-xl transition-all"
                      style={bulkChannel === 'email'
                        ? { background: 'rgba(99,102,241,0.22)', border: '2px solid rgba(99,102,241,0.55)', color: '#a5b4fc', boxShadow: '0 0 16px rgba(99,102,241,0.18)' }
                        : { background: 'rgba(255,255,255,0.04)', border: '2px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }
                      }>
                      <Mail size={24} />
                      <span className="text-sm font-bold">📧 Email</span>
                    </button>
                    <button type="button" onClick={() => setBulkChannel('whatsapp')}
                      className="flex flex-col items-center gap-2 py-5 rounded-xl transition-all"
                      style={bulkChannel === 'whatsapp'
                        ? { background: 'rgba(22,163,74,0.18)', border: '2px solid rgba(22,163,74,0.45)', color: '#4ade80', boxShadow: '0 0 16px rgba(22,163,74,0.15)' }
                        : { background: 'rgba(255,255,255,0.04)', border: '2px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }
                      }>
                      <MessageCircle size={24} />
                      <span className="text-sm font-bold">💬 WhatsApp</span>
                    </button>
                  </div>
                  <button type="button" onClick={() => setBulkStep(2)}
                    className="w-full py-2.5 rounded-xl text-sm font-bold transition-all"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 16px rgba(99,102,241,0.28)' }}>
                    המשך
                  </button>
                </div>
              )}

              {/* Step 2: Choose recipients */}
              {bulkStep === 2 && (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>בחר נמענים</p>
                  <div className="space-y-2">
                    {([
                      { value: 'all',    label: 'כל הלידים', count: leads.length },
                      { value: 'status', label: 'לפי סטטוס', count: null },
                      { value: 'source', label: 'לפי מקור',  count: null },
                    ] as const).map(opt => (
                      <button type="button" key={opt.value} onClick={() => { setBulkRecipients(opt.value); setBulkFilterValue(''); }}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all"
                        style={bulkRecipients === opt.value
                          ? { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.45)', color: '#a5b4fc' }
                          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }
                        }>
                        <span>{opt.count !== null ? `${opt.count} לידים` : ''}</span>
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </div>

                  {bulkRecipients === 'status' && (
                    <div className="flex flex-wrap gap-1.5">
                      {statusConfigs.map(cfg => (
                        <button type="button" key={cfg.label} onClick={() => setBulkFilterValue(cfg.label)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                          style={bulkFilterValue === cfg.label
                            ? { background: `${cfg.color}22`, color: cfg.color, border: `1px solid ${cfg.color}44` }
                            : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }
                          }>{cfg.emoji} {cfg.label}</button>
                      ))}
                    </div>
                  )}

                  {bulkRecipients === 'source' && (
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_SOURCES.map(s => (
                        <button type="button" key={s} onClick={() => setBulkFilterValue(s)}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all"
                          style={bulkFilterValue === s
                            ? { background: 'rgba(99,102,241,0.28)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)' }
                            : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }
                          }>{s}</button>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button type="button" onClick={() => setBulkStep(1)}
                      className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>
                      חזור
                    </button>
                    <button type="button"
                      onClick={() => setBulkStep(3)}
                      disabled={bulkRecipients !== 'all' && !bulkFilterValue}
                      className="flex-[2] py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-30"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.28)' }}>
                      המשך ({getBulkTargetLeads().filter(l => bulkChannel === 'email' ? l.email : l.phone).length} נמענים)
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Compose */}
              {bulkStep === 3 && (
                <div className="space-y-3">
                  <p className="text-sm font-bold text-right" style={{ color: 'rgba(255,255,255,0.6)' }}>כתוב הודעה</p>
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="כותרת / נושא..."
                      value={bulkTitle}
                      onChange={e => setBulkTitle(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition-all text-right"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                      onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; }}
                      onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                    />
                    <textarea
                      rows={5}
                      placeholder="תוכן ההודעה..."
                      value={bulkContent}
                      onChange={e => setBulkContent(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl text-sm focus:outline-none transition-all text-right resize-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                      onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.5)'; }}
                      onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setBulkStep(2)}
                      className="flex-1 py-2 rounded-xl text-sm font-bold transition-all"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.45)' }}>
                      חזור
                    </button>
                    <button type="button"
                      onClick={bulkChannel === 'email' ? handleBulkEmail : handleBulkWhatsApp}
                      disabled={!bulkContent.trim()}
                      className="flex-[2] py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                      style={bulkChannel === 'email'
                        ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 16px rgba(99,102,241,0.28)' }
                        : { background: 'linear-gradient(135deg,#16a34a,#22c55e)', color: 'white', boxShadow: '0 0 16px rgba(22,163,74,0.28)' }
                      }>
                      {bulkChannel === 'email' ? <><Mail size={14} /> שלח מייל</> : <><MessageCircle size={14} /> שלח WhatsApp</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Recommendation Action Panel ───────────────────────────────────── */}
      {recPanel && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
          onClick={() => setRecPanel(null)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
            style={{ background: '#0f1e32', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 32px 80px rgba(0,0,0,0.5)', maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ background: recPanel.bg, borderBottom: `1px solid ${recPanel.border}` }}>
              <div className="flex items-center gap-2.5">
                <span className="text-2xl">{recPanel.icon}</span>
                <span className="font-bold text-sm leading-snug" style={{ color: recPanel.color }}>{recPanel.text}</span>
              </div>
              <button onClick={() => setRecPanel(null)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-all"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>✕</button>
            </div>

            {/* Guidance message */}
            <div className="px-5 py-3.5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-xs leading-relaxed text-right" style={{ color: 'rgba(255,255,255,0.65)' }}>
                💡 {recPanel.guidance}
              </p>
            </div>

            {/* Lead list */}
            {recPanel.insightLeads.length > 0 && (
              <div className="overflow-y-auto flex-1">
                {recPanel.insightLeads.map((lead, i) => {
                  const since = daysSince(lead.lastUpdate);
                  const aiScore = safeNum(lead.aiScore);
                  return (
                    <div key={lead.id}
                      className="px-5 py-3.5 transition-all"
                      style={{
                        borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                        background: 'transparent',
                      }}>
                      <div className="flex items-start justify-between gap-3">
                        {/* Lead info */}
                        <div className="flex-1 min-w-0 text-right">
                          <div className="flex items-center gap-2 justify-end flex-wrap">
                            <span className="font-bold text-sm text-white truncate">{lead.company}</span>
                            {aiScore >= 70 && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171' }}>🔥 חם</span>}
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>{lead.status}</span>
                          </div>
                          <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{lead.contactName}</div>
                          <div className="flex items-center gap-3 mt-1 justify-end flex-wrap">
                            {lead.phone && <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>📞 {lead.phone}</span>}
                            {lead.budget > 0 && <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>₪{lead.budget.toLocaleString()}/חודש</span>}
                            {since > 0 && <span className="text-[10px]" style={{ color: since >= 14 ? '#f87171' : since >= 7 ? '#fbbf24' : 'rgba(255,255,255,0.3)' }}>לפני {since} ימים</span>}
                          </div>
                        </div>

                        {/* Quick actions */}
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          {/* Open card */}
                          <button
                            onClick={() => { onLeadClick(lead); setRecPanel(null); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all text-white"
                            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 2px 10px rgba(99,102,241,0.35)' }}
                            title="פתח כרטיס ליד">
                            👤 פתח כרטיס
                          </button>
                          {/* Email */}
                          {lead.email && (
                            <a href={`mailto:${lead.email}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
                              style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}
                              title={`שלח מייל ל-${lead.email}`}>
                              📧 מייל
                            </a>
                          )}
                          {/* Call */}
                          {lead.phone && (
                            <a href={`tel:${lead.phone}`}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
                              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.22)', color: '#6ee7b7' }}
                              title={`התקשר ל-${lead.phone}`}>
                              📞 התקשר
                            </a>
                          )}
                          {/* WhatsApp */}
                          {lead.phone && (
                            <button
                              onClick={() => { setWhatsAppLead(lead); setRecPanel(null); }}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all"
                              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.22)', color: '#86efac' }}
                              title="שלח WhatsApp">
                              💬 WhatsApp
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Task list (for task-type insights) */}
            {recPanel.insightTasks.length > 0 && recPanel.insightLeads.length === 0 && (
              <div className="overflow-y-auto flex-1">
                {recPanel.insightTasks.map((task, i) => {
                  const isOverdue = task.date && task.date < todayISO;
                  return (
                    <div key={task.id}
                      className="px-5 py-3.5 transition-all cursor-pointer"
                      style={{
                        borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                        background: 'transparent',
                      }}
                      onClick={() => { setEditingDashTask(task); setRecPanel(null); }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-right flex-1 min-w-0">
                          <div className="font-medium text-sm text-white truncate">{task.description}</div>
                          <div className="flex items-center gap-2 justify-end mt-0.5">
                            {task.company && task.company !== '—' && (
                              <span className="text-[10px]" style={{ color: '#fb923c' }}>{task.company}</span>
                            )}
                            <span className="text-[10px]" style={{ color: isOverdue ? '#f87171' : 'rgba(255,255,255,0.35)' }}>
                              {isOverdue ? '⚠️' : '📅'} {task.date}
                            </span>
                          </div>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.5 rounded-lg font-bold flex-shrink-0"
                          style={task.priority === 'high'
                            ? { background: 'rgba(239,68,68,0.18)', color: '#f87171' }
                            : task.priority === 'medium'
                              ? { background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }
                              : { background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>
                          {task.priority === 'high' ? 'דחוף' : task.priority === 'medium' ? 'בינוני' : 'נמוך'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-3 flex-shrink-0 flex items-center justify-between gap-3"
              style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <button onClick={() => { onOpenAi?.(recPanel.action); setRecPanel(null); }}
                className="flex items-center gap-1.5 text-xs font-medium transition-all"
                style={{ color: '#818cf8' }}>
                🤖 שאל את RAY
              </button>
              <button onClick={() => setRecPanel(null)}
                className="text-xs px-4 py-2 rounded-xl transition-all"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }}>
                סגור
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const { isDark } = useTheme();
  const r = 14;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f97316' : '#ef4444';
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="flex-shrink-0">
      <circle cx="18" cy="18" r={r} fill="none" stroke={trackColor} strokeWidth="3" />
      <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        strokeDashoffset={circ * 0.25}
        style={{ filter: `drop-shadow(0 0 4px ${color}88)`, transition: 'stroke-dasharray 0.6s ease' }} />
      <text x="18" y="22" textAnchor="middle" fontSize="8" fontWeight="800" fill={color}>{score}</text>
    </svg>
  );
}

function NeonKpiCard({ label, value, sub, icon, neon, percent }: {
  label: string; value: number; sub: string; icon: React.ReactNode; neon: string; percent: number;
}) {
  return (
    <div
      className="rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5 cursor-default"
      style={{
        background: `linear-gradient(135deg,${neon}10,${neon}06)`,
        border: `1px solid ${neon}28`,
        backdropFilter: 'blur(8px)',
        boxShadow: `0 2px 16px ${neon}12`,
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 32px ${neon}28, 0 0 0 1px ${neon}48`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 16px ${neon}12`; }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-3xl font-black text-white">{value}</div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${neon}18`, border: `1px solid ${neon}28` }}>
          <div style={{ color: neon }}>{icon}</div>
        </div>
      </div>
      <div className="text-sm font-bold text-right" style={{ color: 'rgba(255,255,255,0.75)' }}>{label}</div>
      <div className="text-xs text-right mt-0.5" style={{ color: 'rgba(255,255,255,0.32)' }}>{sub}</div>
      <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(percent, 100)}%`, background: `linear-gradient(90deg,${neon}55,${neon})`, boxShadow: `0 0 6px ${neon}55` }} />
      </div>
    </div>
  );
}

function DarkSortTh({ label, field, current, dir, onSort, className }: {
  label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void; className?: string;
}) {
  const active = current === field;
  return (
    <th
      className={`text-right px-4 py-3 text-[11px] font-bold cursor-pointer select-none transition-colors ${className ?? ''}`}
      style={{ color: active ? '#818cf8' : 'rgba(255,255,255,0.35)' }}
      onClick={() => onSort(field)}>
      {/* dir="ltr" keeps the icon-then-label order left→right so the text stays right-edge-aligned matching data cells */}
      <div className="flex items-center gap-1 justify-end" dir="ltr">
        {active
          ? (dir === 'asc' ? <ArrowUp size={12} style={{ color: '#818cf8' }} /> : <ArrowDown size={12} style={{ color: '#818cf8' }} />)
          : <ArrowUpDown size={12} style={{ color: 'rgba(255,255,255,0.18)' }} />}
        {label}
      </div>
    </th>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD TASK EDIT MODAL — lightweight version for "My Day" clicks
═══════════════════════════════════════════════════════════════════════════ */
function DashboardTaskEditModal({ task, onClose, onSave }: {
  task: DashTask;
  onClose: () => void;
  onSave: (updated: DashTask) => void;
}) {
  const [desc,     setDesc]     = useState(task.description);
  const [date,     setDate]     = useState(task.date);
  const [time,     setTime]     = useState(task.time);
  const [priority, setPriority] = useState<import('../types').TaskPriority>(task.priority);

  const todayISO = new Date().toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
      <div className="rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md overflow-hidden"
        dir="rtl"
        style={{ background: '#ffffff', border: '1px solid #e2e8f0', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div className="h-1" style={{ background: 'linear-gradient(90deg,#6366f1,#8b5cf6,#06b6d4)' }} />

        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid #f1f5f9' }}>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
            style={{ color: '#94a3b8', background: '#f1f5f9' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#e0e7ff'; e.currentTarget.style.color = '#6366f1'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#94a3b8'; }}>
            <X size={16} />
          </button>
          <div className="text-right">
            <h2 className="font-black text-base" style={{ color: '#0f172a' }}>✏️ עריכת משימה</h2>
            {task.company && task.company !== '—' && (
              <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>🏢 {task.company}</p>
            )}
          </div>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.35)' }}>
            <Bell size={14} className="text-white" />
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4 pt-4">
          {/* Description */}
          <div className="rounded-2xl p-4" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
            <label className="block text-[10px] font-bold mb-2 uppercase tracking-wide" style={{ color: '#94a3b8' }}>תיאור</label>
            <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} autoFocus
              className="w-full bg-transparent text-sm text-right focus:outline-none resize-none placeholder-slate-400"
              style={{ color: '#0f172a' }}
              placeholder="תיאור המשימה..."
            />
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: '#94a3b8' }}>📅 תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none" style={{ colorScheme: 'light', color: '#0f172a' }} />
            </div>
            <div className="rounded-2xl p-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
              <label className="block text-[10px] font-bold mb-1.5" style={{ color: '#94a3b8' }}>⏰ שעה</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none" style={{ colorScheme: 'light', color: '#0f172a' }} />
            </div>
          </div>

          {/* Quick dates */}
          <div className="flex gap-2">
            {[{ label: '☀️ היום', days: 0 }, { label: '→ מחר', days: 1 }, { label: '+3', days: 3 }, { label: '+7', days: 7 }].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days);
              const val = d.toISOString().split('T')[0];
              return (
                <button key={label} onClick={() => setDate(val)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={date === val
                    ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 10px rgba(99,102,241,0.3)' }
                    : { background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b' }
                  }>{label}</button>
              );
            })}
          </div>

          {/* Priority */}
          <div className="grid grid-cols-3 gap-2">
            {([
              { p: 'high'   as const, label: 'דחוף',   emoji: '🔴', activeBg: '#fef2f2', activeBorder: '#fca5a5', activeColor: '#dc2626' },
              { p: 'medium' as const, label: 'בינוני', emoji: '🟡', activeBg: '#fffbeb', activeBorder: '#fde68a', activeColor: '#d97706' },
              { p: 'low'    as const, label: 'נמוך',   emoji: '🟢', activeBg: '#f0fdf4', activeBorder: '#86efac', activeColor: '#16a34a' },
            ] as const).map(({ p, label, emoji, activeBg, activeBorder, activeColor }) => (
              <button key={p} onClick={() => setPriority(p)}
                className="py-3 rounded-2xl flex flex-col items-center gap-1 transition-all"
                style={priority === p
                  ? { background: activeBg, color: activeColor, border: `1.5px solid ${activeBorder}` }
                  : { background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#94a3b8' }}>
                <span className="text-lg leading-none">{emoji}</span>
                <span className="text-xs font-semibold">{label}</span>
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button onClick={onClose}
              className="flex-1 py-3 rounded-2xl text-sm font-semibold transition-all"
              style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b' }}>
              ביטול
            </button>
            <button onClick={() => { if (!desc.trim() || !date) return; onSave({ ...task, description: desc, date, time, priority }); }}
              disabled={!desc.trim() || !date}
              className="flex-1 py-3 rounded-2xl text-white text-sm font-bold transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 16px rgba(99,102,241,0.3)' }}>
              <CheckCircle2 size={14} /> שמור
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
