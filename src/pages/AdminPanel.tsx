/**
 * AdminPanel — Advanced SaaS Control Center
 * Only accessible to super-admin (almogavraham30@gmail.com)
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Users, Building2, TrendingUp, Shield, AlertTriangle, CheckCircle2,
  Clock, XCircle, RefreshCw, Search, BarChart3, Zap, Copy, ExternalLink,
  Trash2, Eye, Bell, Megaphone, Rocket, Settings2, ChevronRight,
  Activity, Crown, UserCheck, Mail, Phone, Hash, Sparkles, ToggleLeft,
  ToggleRight, Send, Plus, Archive, Globe, GitBranch, Package,
  ArrowUpRight, ArrowDownRight, Minus, X, Info, ChevronDown,
  KeyRound, AtSign, Unlink, Layers, Menu, DollarSign,
} from 'lucide-react';
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, where, setDoc, getDoc, onSnapshot,
} from 'firebase/firestore';
import { db, auth, functions } from '../lib/firebase';
import { sendPasswordResetEmail, fetchSignInMethodsForEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import type { WorkspaceProfile, WorkspaceStatus, UserProfile, Page } from '../types';
import {
  grantPlanTokens, addTokens, formatBalance, balancePercent,
  DEFAULT_PLAN_TOKEN_AMOUNTS, formatTokenDisplay, formatTokenCount, dollarsToTokens,
  deductFromAdminQuota, getAdminQuota, setAdminQuotaBudget,
} from '../lib/tokenTracker';
import type { PlanTokenConfig, AdminQuota } from '../lib/tokenTracker';

/* ─── types ──────────────────────────────────────────────────────────────── */
type AdminTab = 'overview' | 'workspaces' | 'analytics' | 'users' | 'features' | 'announcements' | 'releases' | 'system';
type PlanKey  = 'trial' | 'basic' | 'pro' | 'enterprise';
type PlanPages = Record<PlanKey, Page[]>;

interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'success' | 'warning';
  target: 'all' | 'trial' | 'active';
  createdAt: string;
  active: boolean;
}

interface Release {
  id: string;
  version: string;
  title: string;
  notes: string;
  createdAt: string;
  publishedAt?: string;
  status: 'draft' | 'published';
}

interface FeatureFlags {
  [feature: string]: { trial: boolean; basic: boolean; pro: boolean; enterprise: boolean };
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const STATUS_CFG: Record<WorkspaceStatus, { label: string; color: string; bg: string; dot: string }> = {
  active:    { label: 'פעיל',   color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200',  dot: 'bg-emerald-500' },
  trial:     { label: 'ניסיון', color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200',        dot: 'bg-blue-500'    },
  pending:   { label: 'ממתין',  color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200',      dot: 'bg-amber-500'   },
  suspended: { label: 'מושהה', color: 'text-red-700',     bg: 'bg-red-50 border-red-200',          dot: 'bg-red-500'     },
};

const PLAN_COLORS: Record<string, string> = {
  trial: 'bg-slate-100 text-slate-600', basic: 'bg-sky-100 text-sky-700',
  pro: 'bg-violet-100 text-violet-700', enterprise: 'bg-amber-100 text-amber-700',
};

const FEATURE_LABELS: Record<string, string> = {
  ai:       'עוזר AI',    kanban:   'פייפליין Kanban', deals:    'ניהול לקוחות',
  content:  'קריאייטיב', agents:   'סוכנים חכמים',   overview: 'דוחות',
  tasks:    'משימות',     team:     'ניהול צוות',
};

const PAGE_LABELS: Partial<Record<Page, string>> = {
  home:      'לוח בקרה',
  dashboard: 'לידים',
  kanban:    'פייפליין',
  deals:     'לקוחות פעילים',
  tasks:     'משימות',
  content:   'קריאייטיב',
  overview:  'דוחות',
  agents:    'סוכנים AI',
  ai:        'עוזר AI',
  settings:  'הגדרות',
  billing:   'מנוי ותשלום',
  team:      'ניהול צוות',
};
// Pages manageable per-plan (exclude 'admin' — always hidden from workspace users)
const MANAGED_PAGES: Page[] = ['home','dashboard','kanban','deals','tasks','content','overview','agents','ai','team','settings','billing'];

const DEFAULT_PLAN_PAGES: PlanPages = {
  trial:      ['home','dashboard','kanban','tasks','ai','settings','billing'],
  basic:      ['home','dashboard','kanban','tasks','ai','overview','team','settings','billing','content'],
  pro:        ['home','dashboard','kanban','deals','tasks','ai','overview','team','settings','billing','content','agents'],
  enterprise: ['home','dashboard','kanban','deals','tasks','ai','overview','team','settings','billing','content','agents'],
};

const DEFAULT_FLAGS: FeatureFlags = {
  ai:       { trial: true,  basic: true,  pro: true,  enterprise: true },
  kanban:   { trial: true,  basic: true,  pro: true,  enterprise: true },
  deals:    { trial: true,  basic: true,  pro: true,  enterprise: true },
  content:  { trial: false, basic: true,  pro: true,  enterprise: true },
  agents:   { trial: false, basic: false, pro: true,  enterprise: true },
  overview: { trial: true,  basic: true,  pro: true,  enterprise: true },
  tasks:    { trial: true,  basic: true,  pro: true,  enterprise: true },
  team:     { trial: true,  basic: true,  pro: true,  enterprise: true },
};

/* ─── Revenue / health helpers ─────────────────────────────────────────────── */
const PLAN_MRR: Record<string, number> = { trial: 0, basic: 149, pro: 299, enterprise: 799 };

function mrr(workspaces: WorkspaceProfile[]) {
  return workspaces.filter(w => w.status === 'active').reduce((sum, w) => sum + (PLAN_MRR[w.plan] ?? 0), 0);
}

function healthScore(w: WorkspaceProfile): number {
  let score = 50;
  if (w.status === 'active')    score += 20;
  if (w.status === 'trial')     score += 10;
  if (w.status === 'suspended') score -= 30;
  if (w.onboardingComplete)     score += 15;
  if (w.logoUrl)                score += 5;
  if (w.prompt)                 score += 5;
  if (w.plan === 'pro')         score += 10;
  if (w.plan === 'enterprise')  score += 15;
  const d = daysLeft(w.trialEndsAt);
  if (w.status === 'trial' && d !== null && d <= 3) score -= 10;
  return Math.min(100, Math.max(0, score));
}

function healthColor(score: number) {
  if (score >= 75) return { bar: 'bg-emerald-500', text: 'text-emerald-600', label: 'בריא' };
  if (score >= 50) return { bar: 'bg-amber-400',   text: 'text-amber-600',   label: 'בינוני' };
  return              { bar: 'bg-red-500',          text: 'text-red-600',     label: 'בסיכון' };
}

function daysLeft(iso?: string) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}
function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
function copyText(t: string) { navigator.clipboard.writeText(t).catch(() => {}); }
function thisMonth(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

/* ─── Main Component ──────────────────────────────────────────────────────── */
export default function AdminPanel({ onToast }: { onToast?: (m: string, t?: 'success'|'error'|'info') => void }) {
  const toast = onToast ?? (() => {});

  const [tab,        setTab]        = useState<AdminTab>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceProfile[]>([]);
  const [users,      setUsers]      = useState<UserProfile[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<WorkspaceProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [releases,   setReleases]   = useState<Release[]>([]);
  const [flags,           setFlags]          = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [flagSaving,      setFlagSaving]     = useState(false);
  const [planPages,       setPlanPages]      = useState<PlanPages>(DEFAULT_PLAN_PAGES);
  const [planPagesSaving, setPlanPagesSaving] = useState(false);
  const [planTokenAmounts, setPlanTokenAmounts] = useState<PlanTokenConfig>(DEFAULT_PLAN_TOKEN_AMOUNTS);
  const [tokenAmountsSaving, setTokenAmountsSaving] = useState(false);

  /* ── Load all data ──────────────────────────────────────────────────────── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wsSnap, usersSnap, annSnap, relSnap, cfgSnap] = await Promise.all([
        getDocs(query(collection(db, 'workspaces'), orderBy('createdAt', 'desc'))),
        getDocs(collection(db, 'users')),
        getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'releases'), orderBy('createdAt', 'desc'))),
        getDoc(doc(db, 'system', 'config')),
      ]);
      setWorkspaces(wsSnap.docs.map(d => d.data() as WorkspaceProfile));
      setUsers(usersSnap.docs.map(d => d.data() as UserProfile));
      setAnnouncements(annSnap.docs.map(d => d.data() as Announcement));
      setReleases(relSnap.docs.map(d => d.data() as Release));
      if (cfgSnap.exists()) {
        const cfg = cfgSnap.data();
        if (cfg.featureFlags)    setFlags({ ...DEFAULT_FLAGS, ...cfg.featureFlags });
        if (cfg.planPages)       setPlanPages({ ...DEFAULT_PLAN_PAGES, ...cfg.planPages });
        if (cfg.planTokenAmounts) setPlanTokenAmounts({ ...DEFAULT_PLAN_TOKEN_AMOUNTS, ...cfg.planTokenAmounts });
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  /* ── Workspace actions ──────────────────────────────────────────────────── */
  const setStatus = async (wid: string, status: WorkspaceStatus) => {
    await updateDoc(doc(db, 'workspaces', wid), { status });
    setWorkspaces(p => p.map(w => w.id === wid ? { ...w, status } : w));
    if (selected?.id === wid) setSelected(s => s ? { ...s, status } : s);
    toast(`סטטוס עודכן ל-${STATUS_CFG[status].label}`, 'success');
  };
  const setPlan = async (wid: string, plan: string) => {
    await updateDoc(doc(db, 'workspaces', wid), { plan });
    setWorkspaces(p => p.map(w => w.id === wid ? { ...w, plan } as WorkspaceProfile : w));
    if (selected?.id === wid) setSelected(s => s ? { ...s, plan } as WorkspaceProfile : s);
    toast('תוכנית עודכנה', 'success');
  };
  const deleteWorkspace = async (wid: string) => {
    const wsData = workspaces.find(w => w.id === wid);
    const wsName = wsData?.name ?? wid;

    if (!window.confirm(
      `למחוק את "${wsName}" לצמיתות?\n\n` +
      'פעולה זו תמחק:\n' +
      '• את כל הלידים, המשימות והצוות\n' +
      '• את כל המשתמשים בסביבה זו מ-Firestore\n' +
      '• את כל חשבונות ה-Auth (האימיילים ישוחררו לרישום חוזר)\n\n' +
      'פעולה זו אינה הפיכה!'
    )) return;

    try {
      // 1. Delete all Firestore subcollections (leads, tasks, team)
      const subcollections = ['leads', 'tasks', 'team'];
      for (const sub of subcollections) {
        const snap = await getDocs(collection(db, 'workspaces', wid, sub));
        const chunks: Promise<void>[][] = [[]];
        snap.docs.forEach(d => {
          if (chunks[chunks.length - 1].length >= 400) chunks.push([]);
          chunks[chunks.length - 1].push(deleteDoc(d.ref));
        });
        for (const chunk of chunks) await Promise.all(chunk);
      }

      // 2. Delete workspace document
      await deleteDoc(doc(db, 'workspaces', wid));

      // 3. Find ALL users belonging to this workspace (not just the owner)
      const wsUsersSnap = await getDocs(query(collection(db, 'users'), where('workspaceId', '==', wid)));
      const wsUserIds: string[] = wsUsersSnap.docs.map(d => d.id);

      // 4. Delete every user's Firestore doc
      await Promise.all(wsUsersSnap.docs.map(d => deleteDoc(d.ref)));

      // 5. Delete every user from Firebase Auth via Cloud Function
      const deleteFn = httpsCallable<{ uid: string }, { success: boolean }>(functions, 'deleteAuthUser');
      const authErrors: string[] = [];
      for (const uid of wsUserIds) {
        try {
          await deleteFn({ uid });
        } catch (e) {
          authErrors.push(uid);
          console.warn(`Could not delete Auth user ${uid}:`, e);
        }
      }

      if (authErrors.length > 0) {
        setTimeout(() => {
          toast(`${authErrors.length} משתמשים לא שוחררו מ-Auth אוטומטית — מחק ידנית ב-Firebase Console`, 'info');
        }, 1500);
      }

      setWorkspaces(p => p.filter(w => w.id !== wid));
      setUsers(p => p.filter(u => u.workspaceId !== wid));
      setSelected(null);
      toast(`סביבת העבודה "${wsName}" ו-${wsUserIds.length} משתמשים נמחקו ✓`, 'info');
    } catch (err) {
      console.error('Error deleting workspace:', err);
      toast('שגיאה במחיקת סביבת העבודה', 'error');
    }
  };

  /* ── Feature flags ──────────────────────────────────────────────────────── */
  const saveFlags = async (newFlags: FeatureFlags) => {
    setFlagSaving(true);
    try {
      await setDoc(doc(db, 'system', 'config'), { featureFlags: newFlags }, { merge: true });
      setFlags(newFlags);
      toast('תכונות עודכנו בהצלחה ✓', 'success');
    } catch { toast('שגיאה בשמירת תכונות', 'error'); }
    finally { setFlagSaving(false); }
  };
  const toggleFlag = (feature: string, plan: PlanKey) => {
    const next = { ...flags, [feature]: { ...flags[feature], [plan]: !flags[feature]?.[plan] } };
    setFlags(next);
  };

  /* ── Plan pages ──────────────────────────────────────────────────────────── */
  const savePlanPages = async (next: PlanPages) => {
    setPlanPagesSaving(true);
    try {
      await setDoc(doc(db, 'system', 'config'), { planPages: next }, { merge: true });
      setPlanPages(next);
      toast('דפי מסלול עודכנו ✓', 'success');
    } catch { toast('שגיאה בשמירת דפי מסלול', 'error'); }
    finally { setPlanPagesSaving(false); }
  };
  /* ── Plan token amounts ──────────────────────────────────────────────────── */
  const savePlanTokenAmounts = async (amounts: PlanTokenConfig) => {
    setTokenAmountsSaving(true);
    try {
      await setDoc(doc(db, 'system', 'config'), { planTokenAmounts: amounts }, { merge: true });
      setPlanTokenAmounts(amounts);
      toast('הקצאת טוקנים עודכנה ✓', 'success');
    } catch { toast('שגיאה בשמירת הקצאת טוקנים', 'error'); }
    finally { setTokenAmountsSaving(false); }
  };

  const togglePlanPage = (page: Page, plan: PlanKey) => {
    const current = planPages[plan] ?? [];
    const next: PlanPages = {
      ...planPages,
      [plan]: current.includes(page) ? current.filter(p => p !== page) : [...current, page],
    };
    setPlanPages(next);
  };

  /* ── Workspace page override ─────────────────────────────────────────────── */
  const setWorkspacePages = async (wid: string, pages: Page[] | null) => {
    const update = pages === null ? { allowedPages: null } : { allowedPages: pages };
    await updateDoc(doc(db, 'workspaces', wid), update);
    setWorkspaces(p => p.map(w => w.id === wid ? { ...w, allowedPages: pages ?? undefined } : w));
    if (selected?.id === wid) setSelected(s => s ? { ...s, allowedPages: pages ?? undefined } : s);
    toast(pages === null ? 'איפוס לברירת מחדל של המסלול ✓' : 'דפים עודכנו ✓', 'success');
  };

  /* ── Metrics ────────────────────────────────────────────────────────────── */
  const total     = workspaces.length;
  const active    = workspaces.filter(w => w.status === 'active').length;
  const trial     = workspaces.filter(w => w.status === 'trial').length;
  const suspended = workspaces.filter(w => w.status === 'suspended').length;
  const newMonth  = workspaces.filter(w => thisMonth(w.createdAt)).length;
  const trialExpiringSoon = workspaces.filter(w => {
    const d = daysLeft(w.trialEndsAt);
    return w.status === 'trial' && d !== null && d <= 3 && d >= 0;
  }).length;

  const NAV_ITEMS = [
    { key: 'overview',      label: 'סקירה כללית',    icon: Activity,   group: 'main' },
    { key: 'workspaces',    label: 'סביבות עבודה',   icon: Building2,  group: 'main' },
    { key: 'analytics',     label: 'אנליטיקס',        icon: BarChart3,  group: 'main' },
    { key: 'users',         label: 'משתמשים',         icon: Users,      group: 'main' },
    { key: 'features',      label: 'תכונות',           icon: Settings2,  group: 'ops'  },
    { key: 'announcements', label: 'הודעות',           icon: Megaphone,  group: 'ops'  },
    { key: 'releases',      label: 'פרסום גרסאות',    icon: Rocket,     group: 'ops'  },
    { key: 'system',        label: 'מערכת',            icon: Globe,      group: 'ops'  },
  ] as { key: AdminTab; label: string; icon: React.ElementType; group: string }[];

  const currentTabLabel = NAV_ITEMS.find(n => n.key === tab)?.label ?? '';

  /* ─── UI ──────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] -m-4 md:-m-6 overflow-hidden bg-slate-50" dir="rtl">

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Left sidebar nav ────────────────────────────────────────────── */}
      <aside className={`
        fixed md:relative inset-y-0 right-0 z-50 w-64 md:w-52 bg-slate-900 flex flex-col flex-shrink-0 border-l border-slate-800
        transform transition-transform duration-300 md:transform-none
        ${sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
      `}>
        <div className="px-4 py-5 border-b border-slate-800 flex items-center justify-between">
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white p-1 transition-colors">
            <X size={16} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Shield size={15} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm">Admin Console</p>
              <p className="text-slate-500 text-[10px]">Super Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ key, label, icon: Icon }, idx, arr) => (
            <div key={key}>
              {/* Divider between groups */}
              {idx > 0 && arr[idx].group !== arr[idx-1].group && (
                <div className="border-t border-slate-800 my-2 mx-1" />
              )}
              <button onClick={() => { setTab(key); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  tab === key ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}>
                <Icon size={15} />
                <span>{label}</span>
                {key === 'workspaces' && trialExpiringSoon > 0 && (
                  <span className="mr-auto bg-amber-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                    {trialExpiringSoon}
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>

        {/* ── New Workspace button ─────────────────────────────────── */}
        <div className="px-3 pb-3 border-t border-slate-800 pt-3">
          <SignupLinkButton onToast={toast} />
        </div>

        <div className="px-4 py-3 border-t border-slate-800">
          <button onClick={loadAll}
            className="w-full flex items-center justify-center gap-2 text-slate-500 hover:text-slate-300 text-xs transition-colors">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            רענן נתונים
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Shield size={13} className="text-white" />
            </div>
            <span className="text-white font-bold text-sm">Admin Console</span>
            {currentTabLabel && <span className="text-slate-400 text-xs">· {currentTabLabel}</span>}
          </div>
          <button onClick={() => setSidebarOpen(true)} className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-slate-800 transition-colors">
            <Menu size={18} />
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            {tab === 'overview'      && <OverviewTab workspaces={workspaces} users={users} total={total} active={active} trial={trial} suspended={suspended} newMonth={newMonth} />}
            {tab === 'workspaces'    && <WorkspacesTab workspaces={workspaces} selected={selected} onSelect={setSelected} onStatus={setStatus} onPlan={setPlan} onDelete={deleteWorkspace} onToast={toast} planPages={planPages} onSetPages={setWorkspacePages} planTokenAmounts={planTokenAmounts} />}
            {tab === 'analytics'     && <AnalyticsTab workspaces={workspaces} />}
            {tab === 'users'         && <UsersTab users={users} workspaces={workspaces} />}
            {tab === 'features'      && <FeaturesTab flags={flags} onToggle={toggleFlag} onSave={saveFlags} saving={flagSaving} planPages={planPages} onTogglePage={togglePlanPage} onSavePlanPages={savePlanPages} planPagesSaving={planPagesSaving} planTokenAmounts={planTokenAmounts} onSavePlanTokenAmounts={savePlanTokenAmounts} tokenAmountsSaving={tokenAmountsSaving} />}
            {tab === 'announcements' && <AnnouncementsTab announcements={announcements} onRefresh={loadAll} onToast={toast} />}
            {tab === 'releases'      && <ReleasesTab releases={releases} workspaces={workspaces} onRefresh={loadAll} onToast={toast} />}
            {tab === 'system'        && <SystemTab workspaces={workspaces} onToast={toast} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Overview
══════════════════════════════════════════════════════════════════════════ */
function OverviewTab({ workspaces, users, total, active, trial, suspended, newMonth }:
  { workspaces: WorkspaceProfile[]; users: UserProfile[]; total: number; active: number; trial: number; suspended: number; newMonth: number }) {

  // 30-day signup bars
  const bars = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const dateStr = d.toISOString().split('T')[0];
    return workspaces.filter(w => w.createdAt.startsWith(dateStr)).length;
  });
  const maxBar = Math.max(...bars, 1);

  const recent = workspaces.slice(0, 8);

  // Revenue metrics
  const monthlyRevenue  = mrr(workspaces);
  const annualRevenue   = monthlyRevenue * 12;

  // Expiring trials
  const expiring = workspaces.filter(w => {
    const d = daysLeft(w.trialEndsAt);
    return w.status === 'trial' && d !== null && d <= 3 && d >= 0;
  });

  // Workspace health alerts
  const atRisk = workspaces.filter(w => healthScore(w) < 50);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-800">סקירה כללית</h1>
          <p className="text-slate-500 text-sm mt-0.5">מבט על כל המערכת — {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <SignupLinkButton />
      </div>

      {/* Alerts row */}
      {(expiring.length > 0 || atRisk.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {expiring.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-center gap-3">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-amber-800 font-bold text-sm">{expiring.length} ניסיונות יפוגו בקרוב</p>
                <p className="text-amber-600 text-xs">{expiring.map(w => w.name).join(', ')}</p>
              </div>
            </div>
          )}
          {atRisk.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-2xl px-4 py-3 flex items-center gap-3">
              <XCircle size={16} className="text-red-500 flex-shrink-0" />
              <div>
                <p className="text-red-800 font-bold text-sm">{atRisk.length} סביבות בסיכון</p>
                <p className="text-red-600 text-xs">ציון בריאות נמוך מ-50</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPI cards — row 1: volume */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="סה״כ סביבות"   value={total}        sub={`+${newMonth} החודש`}                            trend="up"      icon={<Building2 size={18} />}    color="indigo"  />
        <KPI label="פעילות"         value={active}       sub={`${total ? Math.round(active/total*100) : 0}% מהסה״כ`} trend="up" icon={<CheckCircle2 size={18} />} color="emerald" />
        <KPI label="בניסיון"        value={trial}        sub={`${expiring.length} יפוגו השבוע`}                trend="neutral" icon={<Clock size={18} />}         color="blue"    />
        <KPI label="משתמשים"        value={users.length} sub="רשומים במערכת"                                   trend="up"      icon={<Users size={18} />}        color="violet"  />
      </div>

      {/* Revenue cards — row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-5 text-white shadow-lg shadow-indigo-200">
          <p className="text-indigo-200 text-xs font-semibold mb-1">MRR (הכנסה חודשית)</p>
          <p className="text-3xl font-black">₪{monthlyRevenue.toLocaleString()}</p>
          <p className="text-indigo-300 text-xs mt-1">מ-{active} לקוחות פעילים</p>
        </div>
        <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl p-5 text-white shadow-lg shadow-emerald-200">
          <p className="text-emerald-200 text-xs font-semibold mb-1">ARR (הכנסה שנתית)</p>
          <p className="text-3xl font-black">₪{annualRevenue.toLocaleString()}</p>
          <p className="text-emerald-300 text-xs mt-1">תחזית שנתית</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-slate-500 text-xs font-semibold mb-2">הכנסה לפי תוכנית</p>
          <div className="space-y-2">
            {['enterprise','pro','basic','trial'].map(p => {
              const count = workspaces.filter(w => w.plan === p && w.status === 'active').length;
              const rev   = count * (PLAN_MRR[p] ?? 0);
              return (
                <div key={p} className="flex items-center justify-between text-xs">
                  <span className={`px-2 py-0.5 rounded-full font-bold ${PLAN_COLORS[p] ?? 'bg-slate-100 text-slate-600'}`}>{p}</span>
                  <span className="text-slate-500">{count} לקוחות</span>
                  <span className="font-bold text-slate-800">₪{rev.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chart + Status breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 30-day signups chart */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-slate-800 text-sm">הצטרפויות — 30 יום אחרונים</h2>
              <p className="text-slate-500 text-xs mt-0.5">סביבות עבודה חדשות ליום</p>
            </div>
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-full">+{newMonth} החודש</span>
          </div>
          <div className="flex items-end gap-0.5 h-24">
            {bars.map((v, i) => (
              <div key={i} className="flex-1 flex items-end">
                <div
                  className="w-full rounded-sm bg-indigo-500 opacity-80 hover:opacity-100 transition-opacity"
                  style={{ height: `${(v / maxBar) * 100}%`, minHeight: v > 0 ? 4 : 0 }}
                  title={`${v} הצטרפויות`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-slate-400">
            <span>30 ימים אחורה</span>
            <span>היום</span>
          </div>
        </div>

        {/* Status breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-bold text-slate-800 text-sm mb-4">פילוח סטטוס</h2>
          <div className="space-y-3">
            {(['active','trial','pending','suspended'] as WorkspaceStatus[]).map(s => {
              const count = workspaces.filter(w => w.status === s).length;
              const pct   = total ? Math.round(count / total * 100) : 0;
              return (
                <div key={s}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">{STATUS_CFG[s].label}</span>
                    <span className="font-semibold text-slate-800">{count}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full">
                    <div className={`h-full rounded-full ${STATUS_CFG[s].dot}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {expiring.length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold">
                <AlertTriangle size={12} />
                {expiring.length} ניסיונות יפוגו בקרוב
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent workspaces with health score */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-sm">הצטרפויות אחרונות</h2>
          <span className="text-xs text-slate-500">{workspaces.length} סביבות סה״כ</span>
        </div>
        <div className="divide-y divide-slate-50">
          {recent.map(w => {
            const hs  = healthScore(w);
            const hc  = healthColor(hs);
            return (
              <div key={w.id} className="flex items-center px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {w.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="mr-3 flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{w.name}</p>
                  <p className="text-xs text-slate-500 truncate">{w.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Health score mini bar */}
                  <div className="flex items-center gap-1.5 w-20">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full">
                      <div className={`h-full rounded-full ${hc.bar}`} style={{ width: `${hs}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold ${hc.text}`}>{hs}</span>
                  </div>
                  <StatusBadge status={w.status} />
                  <span className="text-xs text-slate-400 hidden md:block">{fmtDate(w.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════════════
   TAB: Workspaces
══════════════════════════════════════════════════════════════════════════ */
function WorkspacesTab({ workspaces, selected, onSelect, onStatus, onPlan, onDelete, onToast, planPages, onSetPages, planTokenAmounts }:
  { workspaces: WorkspaceProfile[]; selected: WorkspaceProfile|null; onSelect: (w: WorkspaceProfile|null)=>void;
    onStatus: (id:string, s:WorkspaceStatus)=>Promise<void>; onPlan: (id:string, p:string)=>Promise<void>;
    onDelete: (id:string)=>Promise<void>; onToast: (m:string,t?:'success'|'error'|'info')=>void;
    planPages: PlanPages; onSetPages: (wid:string, pages:Page[]|null)=>Promise<void>;
    planTokenAmounts: PlanTokenConfig; }) {

  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState<WorkspaceStatus|'all'>('all');
  const [plan,   setPlan]     = useState('all');
  const [sort,   setSort]     = useState<'createdAt'|'name'>('createdAt');
  const [actLoad, setActLoad] = useState<string|null>(null);

  const action = async (fn: ()=>Promise<void>, id: string) => {
    setActLoad(id); try { await fn(); } finally { setActLoad(null); }
  };

  const filtered = workspaces
    .filter(w => (status === 'all' || w.status === status) && (plan === 'all' || w.plan === plan))
    .filter(w => !search || w.name.toLowerCase().includes(search.toLowerCase()) || w.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="flex h-full">
      {/* List */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, אימייל..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
          </div>
          <div className="flex gap-2">
            <select value={status} onChange={e => setStatus(e.target.value as WorkspaceStatus|'all')}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none">
              <option value="all">כל הסטטוסים</option>
              {Object.entries(STATUS_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={plan} onChange={e => setPlan(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none">
              <option value="all">כל התוכניות</option>
              {['trial','basic','pro','enterprise'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value as 'createdAt'|'name')}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none">
              <option value="createdAt">הכי חדש</option>
              <option value="name">לפי שם</option>
            </select>
          </div>
        </div>

        {/* Count */}
        <div className="px-6 py-2 bg-slate-50 border-b border-slate-200">
          <p className="text-xs text-slate-500">{filtered.length} סביבות עבודה</p>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 py-20">
              <Building2 size={32} className="mb-3 opacity-30" />
              <p className="text-sm">אין תוצאות</p>
            </div>
          ) : filtered.map(w => {
            const d = daysLeft(w.trialEndsAt);
            const expiring = w.status === 'trial' && d !== null && d <= 3 && d >= 0;
            return (
              <div key={w.id}
                onClick={() => onSelect(selected?.id === w.id ? null : w)}
                className={`flex items-center px-6 py-3.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors ${selected?.id === w.id ? 'bg-indigo-50 border-indigo-100' : ''}`}>
                {/* Logo / initial */}
                <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
                  {w.logoUrl ? <img src={w.logoUrl} alt="" className="w-full h-full object-contain" /> : w.name?.[0]?.toUpperCase()}
                </div>
                <div className="mr-3 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800 truncate">{w.name}</p>
                    {expiring && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">יפוג ב-{d} ימים</span>}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{w.email} · {fmtDate(w.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PLAN_COLORS[w.plan] ?? 'bg-slate-100 text-slate-600'}`}>
                    {w.plan}
                  </span>
                  <StatusBadge status={w.status} />
                  <ChevronRight size={14} className={`text-slate-400 transition-transform ${selected?.id === w.id ? 'rotate-90' : ''}`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 md:hidden" onClick={() => onSelect(null)} />
          <WorkspaceDetail
            ws={selected}
            onClose={() => onSelect(null)}
            onStatus={s => action(() => onStatus(selected.id, s), selected.id)}
            onPlan={p => action(() => onPlan(selected.id, p), p)}
            onDelete={() => action(() => onDelete(selected.id), selected.id)}
            loading={actLoad}
            onToast={onToast}
            planPages={planPages}
            onSetPages={pages => onSetPages(selected.id, pages)}
            planTokenAmounts={planTokenAmounts}
          />
        </>
      )}
    </div>
  );
}

function WorkspaceDetail({ ws, onClose, onStatus, onPlan, onDelete, loading, onToast, planPages, onSetPages, planTokenAmounts }:
  { ws: WorkspaceProfile; onClose: ()=>void; onStatus:(s:WorkspaceStatus)=>void;
    onPlan:(p:string)=>void; onDelete:()=>void; loading:string|null; onToast:(m:string,t?:'success'|'error'|'info')=>void;
    planPages: PlanPages; onSetPages:(pages:Page[]|null)=>Promise<void>;
    planTokenAmounts: PlanTokenConfig; }) {

  const d = daysLeft(ws.trialEndsAt);
  const RAY_DOMAIN     = 'ray-crm.com';
  // Subdomain per workspace: acme.ray-crm.com — fallback to ?ws= for legacy
  const workspaceLink  = ws.slug
    ? `https://${ws.slug}.${RAY_DOMAIN}`
    : `https://${RAY_DOMAIN}/?ws=${ws.id}`;
  const inviteLink     = `https://${RAY_DOMAIN}/?workspace=${ws.id}&invite=1`;

  // Team members loaded from subcollection
  const [members,     setMembers]     = useState<{ id:string; name:string; email:string; role:string }[]>([]);
  const [membersLoad, setMembersLoad] = useState(false);

  // Support action states
  const [resetLoad,  setResetLoad]  = useState(false);
  const [authLoad,   setAuthLoad]   = useState(false);

  // Token management state
  const [tokenGrantLoad, setTokenGrantLoad] = useState(false);
  const [manualAmount,   setManualAmount]   = useState('');
  const [manualLoad,     setManualLoad]     = useState(false);

  const planTokenAmount = planTokenAmounts[ws.plan as PlanKey] ?? DEFAULT_PLAN_TOKEN_AMOUNTS[ws.plan as PlanKey] ?? 0;
  const tokenBalance    = ws.tokenBalance ?? 0;
  const tokenAllocation = ws.tokenPlanAllocation ?? 0;
  const tokenUsed       = ws.tokenUsed ?? 0;
  const tokenPct        = balancePercent(tokenBalance, tokenAllocation);
  const tokenBarColor   = tokenPct > 50 ? 'bg-emerald-500' : tokenPct > 20 ? 'bg-amber-400' : 'bg-red-500';

  const handleGrantPlanTokens = async () => {
    if (planTokenAmount <= 0) { onToast('לא הוגדרה הקצאה לתוכנית זו', 'error'); return; }
    setTokenGrantLoad(true);
    try {
      await grantPlanTokens(ws.id, ws.plan, planTokenAmount);
      onToast(`${planTokenAmount}$ טוקנים הוענקו ✓`, 'success');
    } catch { onToast('שגיאה בהענקת טוקנים', 'error'); }
    finally { setTokenGrantLoad(false); }
  };

  const handleManualTokens = async () => {
    const amt = parseFloat(manualAmount);
    if (!amt || amt <= 0) { onToast('הזן סכום תקין', 'error'); return; }
    setManualLoad(true);
    try {
      await addTokens(ws.id, amt, 'manual', 'Admin manual credit');
      // Deduct from admin quota (best-effort — don't block on failure)
      deductFromAdminQuota(amt).catch(console.error);
      setManualAmount('');
      onToast(`${formatTokenDisplay(amt)} טוקנים נוספו ✓`, 'success');
    } catch { onToast('שגיאה בהוספת טוקנים', 'error'); }
    finally { setManualLoad(false); }
  };

  // Page override state for this workspace
  const isCustomPages  = Array.isArray(ws.allowedPages);
  const effectivePages: Page[] = isCustomPages
    ? (ws.allowedPages as Page[])
    : (planPages[ws.plan as PlanKey] ?? DEFAULT_PLAN_PAGES[ws.plan as PlanKey] ?? MANAGED_PAGES);
  const [localPages,    setLocalPages]    = useState<Page[]>(effectivePages);
  const [pagesSaving,   setPagesSaving]   = useState(false);

  // Reset local pages when ws changes
  useEffect(() => {
    const ep = Array.isArray(ws.allowedPages)
      ? (ws.allowedPages as Page[])
      : (planPages[ws.plan as PlanKey] ?? DEFAULT_PLAN_PAGES[ws.plan as PlanKey] ?? MANAGED_PAGES);
    setLocalPages(ep);
  }, [ws.id, ws.allowedPages, ws.plan, planPages]); // eslint-disable-line

  const handleSavePages = async () => {
    setPagesSaving(true);
    try { await onSetPages(localPages); }
    finally { setPagesSaving(false); }
  };
  const handleResetPages = async () => {
    setPagesSaving(true);
    try {
      await onSetPages(null);
      setLocalPages(planPages[ws.plan as PlanKey] ?? DEFAULT_PLAN_PAGES[ws.plan as PlanKey] ?? MANAGED_PAGES);
    } finally { setPagesSaving(false); }
  };

  useEffect(() => {
    setMembersLoad(true);
    getDocs(collection(db, 'workspaces', ws.id, 'team'))
      .then(snap => setMembers(snap.docs.map(d => d.data() as { id:string; name:string; email:string; role:string })))
      .catch(() => {})
      .finally(() => setMembersLoad(false));
  }, [ws.id]);

  // Send password-reset email to workspace owner via Firebase client Auth SDK
  const handlePasswordReset = async () => {
    if (!ws.email) return;
    setResetLoad(true);
    try {
      await sendPasswordResetEmail(auth, ws.email);
      onToast(`קישור איפוס נשלח ל-${ws.email} ✓`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast(`שגיאה: ${msg}`, 'error');
    } finally { setResetLoad(false); }
  };

  // Delete only the Firebase Auth account (without deleting the workspace)
  const handleDeleteAuthOnly = async () => {
    if (!ws.ownerId) { onToast('UID בעלים לא ידוע', 'error'); return; }
    if (!window.confirm(`למחוק את חשבון ה-Auth של ${ws.email}?\nהסביבה תישאר אך לא ניתן יהיה להיכנס אליה.`)) return;
    setAuthLoad(true);
    try {
      const deleteFn = httpsCallable<{ uid: string }, { success: boolean }>(functions, 'deleteAuthUser');
      await deleteFn({ uid: ws.ownerId });
      // Also remove user profile doc
      await deleteDoc(doc(db, 'users', ws.ownerId));
      onToast('חשבון Auth נמחק — האימייל שוחרר ✓', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast(`שגיאה: ${msg}`, 'error');
    } finally { setAuthLoad(false); }
  };

  return (
    <aside className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden md:relative md:inset-auto md:z-auto md:w-80 md:border-r md:border-slate-200">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-bold">
            {ws.logoUrl ? <img src={ws.logoUrl} alt="" className="w-full h-full object-contain" /> : ws.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-slate-800 text-sm">{ws.name}</p>
            <StatusBadge status={ws.status} />
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 mt-0.5"><X size={15} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Info */}
        <div className="px-5 py-4 space-y-2.5 border-b border-slate-100">
          {ws.slug && (
            <div className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5 flex-shrink-0"><Globe size={12} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-400 font-medium">URL ייחודי</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs text-indigo-600 font-mono font-semibold truncate">/{ws.slug}</p>
                  <button onClick={() => { copyText(`https://${ws.slug}.ray-crm.com`); onToast('URL הועתק ✓', 'success'); }}
                    className="text-slate-300 hover:text-slate-600 flex-shrink-0 transition-colors">
                    <Copy size={10} />
                  </button>
                </div>
              </div>
            </div>
          )}
          <InfoRow icon={<Mail size={12} />}      label="אימייל"    value={ws.email} />
          <InfoRow icon={<Phone size={12} />}     label="טלפון"     value={ws.phone || '—'} />
          <InfoRow icon={<Hash size={12} />}      label="ח.פ"       value={ws.businessId || '—'} />
          <InfoRow icon={<Building2 size={12} />} label="תחום"      value={ws.industry || '—'} />
          <InfoRow icon={<Clock size={12} />}     label="הצטרף"     value={fmtDate(ws.createdAt)} />
          {ws.ownerId && (
            <div className="flex items-start gap-2">
              <span className="text-slate-400 mt-0.5 flex-shrink-0"><Shield size={12} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-400 font-medium">UID בעלים</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] text-slate-600 font-mono truncate">{ws.ownerId}</p>
                  <button onClick={() => { copyText(ws.ownerId!); onToast('UID הועתק ✓', 'success'); }}
                    className="text-slate-300 hover:text-slate-600 flex-shrink-0 transition-colors">
                    <Copy size={10} />
                  </button>
                </div>
              </div>
            </div>
          )}
          {ws.trialEndsAt && (
            <InfoRow icon={<Clock size={12} />}   label="ניסיון עד" value={`${fmtDate(ws.trialEndsAt)} (${d !== null ? `${d} ימים` : ''})`} />
          )}
        </div>

        {/* Status & Plan */}
        <div className="px-5 py-4 space-y-3 border-b border-slate-100">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">סטטוס</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(['active','trial','pending','suspended'] as WorkspaceStatus[]).map(s => (
                <button key={s} onClick={() => onStatus(s)}
                  className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${ws.status===s ? STATUS_CFG[s].bg+' '+STATUS_CFG[s].color+' border-current' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                  {STATUS_CFG[s].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">תוכנית</p>
            <div className="grid grid-cols-2 gap-1.5">
              {['trial','basic','pro','enterprise'].map(p => (
                <button key={p} onClick={() => onPlan(p)}
                  className={`py-1.5 rounded-lg text-xs font-semibold border transition-all capitalize ${ws.plan===p ? PLAN_COLORS[p]+' border-current' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Page access control ──────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 flex items-center gap-1">
              <Layers size={11} /> דפים מורשים
            </p>
            {isCustomPages && (
              <span className="text-[9px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">מותאם אישית</span>
            )}
          </div>

          {/* Page toggles */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {MANAGED_PAGES.map(p => {
              const active = localPages.includes(p);
              return (
                <button key={p}
                  onClick={() => setLocalPages(prev => active ? prev.filter(x => x !== p) : [...prev, p])}
                  className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all ${
                    active ? 'bg-indigo-600 text-white border-indigo-700' : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-slate-400'
                  }`}>
                  {PAGE_LABELS[p] ?? p}
                </button>
              );
            })}
          </div>

          <div className="flex gap-1.5">
            <button onClick={handleSavePages} disabled={pagesSaving}
              className="flex-1 flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-1.5 rounded-lg text-[10px] font-bold transition-colors">
              {pagesSaving ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
              שמור דפים
            </button>
            {isCustomPages && (
              <button onClick={handleResetPages} disabled={pagesSaving}
                className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-600 py-1.5 px-2.5 rounded-lg text-[10px] font-bold transition-colors">
                איפוס למסלול
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            {isCustomPages ? `הגדרה ידנית · מסלול: ${ws.plan}` : `נגזר ממסלול: ${ws.plan}`}
          </p>
        </div>

        {/* AI Prompt */}
        {ws.prompt && (
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1"><Sparkles size={11} /> הנחיות AI</p>
            <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{ws.prompt}</p>
          </div>
        )}

        {/* Workspace links */}
        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
              <Globe size={11} /> קישור כניסה ייחודי
            </p>
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2">
              <p className="flex-1 text-xs text-indigo-700 truncate font-medium">{workspaceLink}</p>
              <button onClick={() => { copyText(workspaceLink); onToast('קישור כניסה הועתק ✓', 'success'); }}
                className="text-indigo-400 hover:text-indigo-700 transition-colors flex-shrink-0">
                <Copy size={12} />
              </button>
              <a href={workspaceLink} target="_blank" rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-700 transition-colors flex-shrink-0">
                <ExternalLink size={12} />
              </a>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">הלקוח יראה שם חברה ולוגו בדף הכניסה</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
              <UserCheck size={11} /> קישור הזמנת חבר צוות
            </p>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <p className="flex-1 text-xs text-slate-600 truncate">{inviteLink}</p>
              <button onClick={() => { copyText(inviteLink); onToast('קישור הזמנה הועתק ✓', 'success'); }}
                className="text-slate-400 hover:text-indigo-600 transition-colors flex-shrink-0">
                <Copy size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* Team members */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
            <Users size={11} /> חברי צוות ({members.length})
          </p>
          {membersLoad ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <RefreshCw size={11} className="animate-spin" /> טוען...
            </div>
          ) : members.length === 0 ? (
            <p className="text-xs text-slate-400">אין חברי צוות רשומים</p>
          ) : (
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-2.5 py-1.5">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {(m.name?.[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 truncate">{m.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{m.email}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${m.role === 'מנהל' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Token Balance ─────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-emerald-700 mb-3 flex items-center gap-1.5">
            <DollarSign size={11} /> מאזן טוקנים AI
          </p>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-emerald-50 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-emerald-600 font-medium mb-0.5">מאזן</p>
              <p className="text-xs font-bold text-emerald-800">{formatTokenDisplay(tokenBalance)}</p>
              <p className="text-[9px] text-emerald-600">{formatBalance(tokenBalance)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-slate-500 font-medium mb-0.5">הקצאה</p>
              <p className="text-xs font-bold text-slate-700">{formatBalance(tokenAllocation)}</p>
            </div>
            <div className="bg-slate-50 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-slate-500 font-medium mb-0.5">שומש</p>
              <p className="text-xs font-bold text-slate-700">{formatBalance(tokenUsed)}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>{tokenPct}% נותר</span>
              <span>{formatBalance(tokenBalance)} מתוך {formatBalance(tokenAllocation)}</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${tokenBarColor}`} style={{ width: `${tokenPct}%` }} />
            </div>
          </div>

          {/* Grant plan tokens */}
          <button
            onClick={handleGrantPlanTokens}
            disabled={tokenGrantLoad}
            className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white py-2 rounded-lg text-xs font-bold transition-colors mb-2"
          >
            {tokenGrantLoad ? <RefreshCw size={11} className="animate-spin" /> : <DollarSign size={11} />}
            הענק טוקני תוכנית ({formatBalance(planTokenAmount)})
          </button>

          {/* Manual add tokens */}
          <div className="flex gap-1.5">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="סכום $"
              value={manualAmount}
              onChange={e => setManualAmount(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
              dir="ltr"
            />
            <button
              onClick={handleManualTokens}
              disabled={manualLoad}
              className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
            >
              {manualLoad ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
              הוסף ידנית
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            תוכנית {ws.plan} · הקצאה מוגדרת: {formatBalance(planTokenAmount)}
          </p>
        </div>

        {/* Technical support tools */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-2.5 flex items-center gap-1.5">
            <Settings2 size={11} /> כלי תמיכה טכנית
          </p>
          <div className="space-y-2">
            {/* Password reset */}
            <button
              onClick={handlePasswordReset}
              disabled={resetLoad}
              className="w-full flex items-center gap-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 py-2 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {resetLoad ? <RefreshCw size={12} className="animate-spin" /> : <Mail size={12} />}
              שלח איפוס סיסמה לבעלים
            </button>

            {/* Copy UID */}
            {ws.ownerId && (
              <button
                onClick={() => { copyText(ws.ownerId!); onToast('UID הועתק ✓', 'success'); }}
                className="w-full flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
              >
                <Copy size={12} />
                העתק UID (לקונסול Firebase)
              </button>
            )}

            {/* Delete only Auth account */}
            {ws.ownerId && (
              <button
                onClick={handleDeleteAuthOnly}
                disabled={authLoad}
                className="w-full flex items-center gap-2 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 py-2 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
              >
                {authLoad ? <RefreshCw size={12} className="animate-spin" /> : <UserCheck size={12} />}
                שחרר אימייל מ-Auth בלבד
              </button>
            )}

            {/* Direct Firebase Console link for manual deletion */}
            <a
              href="https://console.firebase.google.com/project/chex-crm/authentication/users"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center gap-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
            >
              <ExternalLink size={12} />
              מחק ידנית ב-Firebase Console
            </a>
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            "שחרר אימייל" דורש Firebase Blaze plan. לחלופין — השתמש בקישור ה-Firebase Console למחיקה ידנית
          </p>
        </div>
      </div>

      {/* Delete workspace */}
      <div className="px-5 py-4 border-t border-slate-100">
        <button onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 border border-red-200 py-2 rounded-xl text-xs font-semibold transition-colors">
          <Trash2 size={12} /> מחק סביבת עבודה לצמיתות
        </button>
      </div>
    </aside>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Users
   Source of truth for OWNERS = workspaces collection (always populated).
   users collection = optional enrichment for firstName / lastName only.
   This way, even if a user profile document is missing / was deleted,
   the workspace owner still appears in this tab.
══════════════════════════════════════════════════════════════════════════ */
function UsersTab({ users, workspaces }:
  { users: UserProfile[]; workspaces: WorkspaceProfile[] }) {
  const [search, setSearch] = useState('');

  // uid → user-profile (for name enrichment only)
  const profileMap = Object.fromEntries(users.map(u => [u.uid, u]));

  // team members = users whose workspaceId is set AND they are NOT a workspace owner
  const ownerUids = new Set(workspaces.map(w => w.ownerId).filter(Boolean));
  const members   = users.filter(u => u.workspaceId && !ownerUids.has(u.uid));

  const PLAN_BADGE: Record<string, string> = {
    trial:      'bg-amber-100 text-amber-700',
    basic:      'bg-blue-100 text-blue-700',
    pro:        'bg-indigo-100 text-indigo-700',
    enterprise: 'bg-violet-100 text-violet-700',
  };
  const STATUS_DOT: Record<WorkspaceStatus, string> = {
    active:    'bg-emerald-500',
    trial:     'bg-amber-400',
    suspended: 'bg-red-500',
    pending:   'bg-slate-400',
  };

  // Filter workspaces (owners) by search
  const filteredWorkspaces = workspaces.filter(ws => {
    if (!search) return true;
    const profile = ws.ownerId ? profileMap[ws.ownerId] : null;
    const name    = profile ? `${profile.firstName} ${profile.lastName}` : '';
    return (
      ws.name.toLowerCase().includes(search.toLowerCase()) ||
      ws.email.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  // Filter members by search
  const filteredMembers = members.filter(u =>
    !search ||
    `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800">משתמשים</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {workspaces.length} בעלי סביבה · {members.length} חברי צוות
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
            <Building2 size={12} /> {workspaces.length} בעלי סביבה
          </span>
          <span className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold px-3 py-1.5 rounded-xl">
            <Users size={12} /> {members.length} חברי צוות
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם עסק, שם, אימייל..."
          className="w-full bg-white border border-slate-200 rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm" />
      </div>

      {/* ── Workspace Owners ─────────────────────────────────────────────── */}
      {/* Always derived from workspaces collection — never misses an owner  */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Crown size={15} className="text-indigo-500" />
          <h2 className="font-bold text-slate-700 text-sm">בעלי סביבות עבודה</h2>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filteredWorkspaces.length}</span>
        </div>

        {filteredWorkspaces.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 py-10 text-center text-slate-400 text-sm">
            לא נמצאו תוצאות
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredWorkspaces.map(ws => {
              // Try to enrich with user profile (might be null if doc missing)
              const profile   = ws.ownerId ? profileMap[ws.ownerId] : null;
              const initials  = profile
                ? (profile.firstName?.[0] ?? ws.email[0]).toUpperCase()
                : ws.email[0].toUpperCase();
              const displayName = profile
                ? `${profile.firstName} ${profile.lastName}`.trim()
                : null;
              const hs = healthScore(ws);
              const hc = healthColor(hs);

              return (
                <div key={ws.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all">
                  {/* Owner identity */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-black flex-shrink-0 shadow-sm">
                      {ws.logoUrl
                        ? <img src={ws.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
                        : initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      {displayName ? (
                        <>
                          <p className="font-bold text-slate-800 text-sm leading-tight truncate">{displayName}</p>
                          <p className="text-xs text-slate-500 truncate" dir="ltr">{ws.email}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-slate-800 text-sm leading-tight truncate" dir="ltr">{ws.email}</p>
                          <p className="text-[10px] text-slate-400">שם לא זמין — פרופיל חסר</p>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 font-bold px-2 py-0.5 rounded-full">בעלים</span>
                      <span className={`text-[10px] font-bold ${hc.text}`}>{hc.label} {hs}</span>
                    </div>
                  </div>

                  {/* Workspace info card */}
                  <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[ws.status] ?? 'bg-slate-400'}`} />
                        <span className="font-semibold text-slate-800 text-sm truncate">{ws.name}</span>
                      </div>
                      <StatusBadge status={ws.status} />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">
                        {ws.createdAt ? new Date(ws.createdAt).toLocaleDateString('he-IL') : '—'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {ws.industry && (
                          <span className="text-[10px] text-slate-500 bg-white border border-slate-200 px-1.5 py-0.5 rounded-lg">
                            {ws.industry}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PLAN_BADGE[ws.plan] ?? 'bg-slate-100 text-slate-600'}`}>
                          {ws.plan}
                        </span>
                      </div>
                    </div>

                    {/* Health bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-slate-200 rounded-full">
                        <div className={`h-full rounded-full ${hc.bar}`} style={{ width: `${hs}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400">בריאות {hs}%</span>
                    </div>

                    {/* Missing profile warning */}
                    {!profile && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        <AlertTriangle size={10} />
                        פרופיל משתמש חסר ב-Firestore — הרישום אולי לא הסתיים
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Team Members (non-owners) ──────────────────────────────────────── */}
      {members.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 pt-2">
            <Users size={15} className="text-slate-500" />
            <h2 className="font-bold text-slate-700 text-sm">חברי צוות</h2>
            <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{filteredMembers.length}</span>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="divide-y divide-slate-50">
              {filteredMembers.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">לא נמצאו חברי צוות</div>
              ) : filteredMembers.map(u => {
                const ws = u.workspaceId ? workspaces.find(w => w.id === u.workspaceId) : null;
                return (
                  <div key={u.uid} className="flex items-center px-5 py-3 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(u.firstName?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="mr-3 flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-slate-500 truncate" dir="ltr">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ws && (
                        <div className="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded-lg truncate max-w-[110px]">
                          {ws.name}
                        </div>
                      )}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {u.role === 'admin' ? 'מנהל' : 'סוכן'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Feature Flags
══════════════════════════════════════════════════════════════════════════ */
function FeaturesTab({ flags, onToggle, onSave, saving, planPages, onTogglePage, onSavePlanPages, planPagesSaving, planTokenAmounts, onSavePlanTokenAmounts, tokenAmountsSaving }:
  { flags: FeatureFlags; onToggle:(f:string,p:PlanKey)=>void; onSave:(f:FeatureFlags)=>Promise<void>; saving:boolean;
    planPages: PlanPages; onTogglePage:(page:Page,plan:PlanKey)=>void;
    onSavePlanPages:(pp:PlanPages)=>Promise<void>; planPagesSaving:boolean;
    planTokenAmounts: PlanTokenConfig; onSavePlanTokenAmounts:(a:PlanTokenConfig)=>Promise<void>; tokenAmountsSaving:boolean; }) {

  const PLANS: PlanKey[] = ['trial','basic','pro','enterprise'];
  const [localTokenAmounts, setLocalTokenAmounts] = useState<PlanTokenConfig>(planTokenAmounts);

  // sync if parent changes
  useEffect(() => { setLocalTokenAmounts(planTokenAmounts); }, [planTokenAmounts]);

  return (
    <div className="p-6 space-y-6">

      {/* ── Section 1: Feature flags ─────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black text-slate-800">תכונות ותוכניות</h1>
            <p className="text-slate-500 text-sm mt-0.5">שלוט אילו תכונות פתוחות לכל תוכנית</p>
          </div>
          <button onClick={() => onSave(flags)} disabled={saving}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Package size={14} />}
            שמור תכונות
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-5 px-5 py-3 bg-slate-50 border-b border-slate-200">
            <div className="col-span-1 text-xs font-bold text-slate-500 uppercase tracking-wider">תכונה</div>
            {PLANS.map(p => (
              <div key={p} className="text-center">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PLAN_COLORS[p]}`}>{p}</span>
              </div>
            ))}
          </div>
          {Object.entries(FEATURE_LABELS).map(([key, label]) => (
            <div key={key} className="grid grid-cols-5 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors items-center">
              <div className="col-span-1">
                <p className="text-sm font-medium text-slate-700">{label}</p>
                <p className="text-xs text-slate-400">{key}</p>
              </div>
              {PLANS.map(p => {
                const on = flags[key]?.[p] ?? false;
                return (
                  <div key={p} className="flex justify-center">
                    <button onClick={() => onToggle(key, p)}
                      className={`w-9 h-5 rounded-full transition-all relative ${on ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ── Section 2: Pages per plan ────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <Layers size={18} className="text-indigo-600" /> דפים לפי מסלול
            </h2>
            <p className="text-slate-500 text-sm mt-0.5">הגדר אילו דפים כל מסלול יכול לגשת אליהם כברירת מחדל</p>
          </div>
          <button onClick={() => onSavePlanPages(planPages)} disabled={planPagesSaving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
            {planPagesSaving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            שמור דפים
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-5 px-5 py-3 bg-slate-50 border-b border-slate-200">
            <div className="col-span-1 text-xs font-bold text-slate-500 uppercase tracking-wider">דף</div>
            {PLANS.map(p => (
              <div key={p} className="text-center">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PLAN_COLORS[p]}`}>{p}</span>
              </div>
            ))}
          </div>

          {MANAGED_PAGES.map(page => (
            <div key={page} className="grid grid-cols-5 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors items-center">
              <div className="col-span-1">
                <p className="text-sm font-medium text-slate-700">{PAGE_LABELS[page] ?? page}</p>
                <p className="text-xs text-slate-400">{page}</p>
              </div>
              {PLANS.map(plan => {
                const on = (planPages[plan] ?? []).includes(page);
                return (
                  <div key={plan} className="flex justify-center">
                    <button onClick={() => onTogglePage(page, plan)}
                      className={`w-9 h-5 rounded-full transition-all relative ${on ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-700 flex items-start gap-2">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <p>ברירות המחדל חלות על סביבות עבודה חדשות. סביבות עם הגדרה ידנית (כחול "מותאם אישית" בפאנל) לא יושפעו.</p>
        </div>
      </div>

      {/* ── Section 3: Plan Token Allocation ────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <DollarSign size={18} className="text-emerald-600" /> טוקנים לפי תוכנית
            </h2>
            <p className="text-slate-500 text-sm mt-0.5">הגדר כמה דולרים של טוקנים AI מקבלת כל תוכנית</p>
          </div>
          <button onClick={() => onSavePlanTokenAmounts(localTokenAmounts)} disabled={tokenAmountsSaving}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
            {tokenAmountsSaving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            שמור הקצאות
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-3 px-5 py-3 bg-emerald-50 border-b border-emerald-100">
            <div className="col-span-1 text-xs font-bold text-emerald-700 uppercase tracking-wider">תוכנית</div>
            <div className="text-center text-xs font-bold text-emerald-700 uppercase tracking-wider">הקצאת טוקנים ($)</div>
            <div className="text-center text-xs font-bold text-emerald-700 uppercase tracking-wider">מטבע</div>
          </div>
          {PLANS.map(plan => (
            <div key={plan} className="grid grid-cols-3 px-5 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-colors items-center">
              <div className="col-span-1 flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PLAN_COLORS[plan]}`}>{plan}</span>
              </div>
              <div className="flex justify-center">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={localTokenAmounts[plan] ?? DEFAULT_PLAN_TOKEN_AMOUNTS[plan] ?? 0}
                  onChange={e => setLocalTokenAmounts(prev => ({ ...prev, [plan]: parseFloat(e.target.value) || 0 }))}
                  className="w-24 text-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm font-semibold focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  dir="ltr"
                />
              </div>
              <div className="text-center text-xs text-slate-500">USD</div>
            </div>
          ))}
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-xs text-emerald-700 flex items-start gap-2">
          <Info size={14} className="flex-shrink-0 mt-0.5" />
          <p>ערכים אלו קובעים כמה דולרים של טוקנים AI מוקצים לכל סביבה עבור כל תוכנית. השינויים לא חלים אוטומטית — יש ללחוץ "הענק טוקני תוכנית" בפאנל הסביבה.</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 flex items-start gap-2">
        <Info size={14} className="flex-shrink-0 mt-0.5" />
        <p>שינויים בתכונות ייכנסו לתוקף בכניסה הבאה של המשתמש. תכונות ודפים מושבתים לא יופיעו בניווט.</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Announcements
══════════════════════════════════════════════════════════════════════════ */
function AnnouncementsTab({ announcements, onRefresh, onToast }:
  { announcements: Announcement[]; onRefresh: ()=>void; onToast:(m:string,t?:'success'|'error'|'info')=>void }) {

  const [title,  setTitle]  = useState('');
  const [body,   setBody]   = useState('');
  const [type,   setType]   = useState<'info'|'success'|'warning'>('info');
  const [target, setTarget] = useState<'all'|'trial'|'active'>('all');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) { onToast('מלא כותרת ותוכן', 'error'); return; }
    setSaving(true);
    try {
      const id  = `ann_${Date.now()}`;
      const ann: Announcement = { id, title: title.trim(), body: body.trim(), type, target, createdAt: new Date().toISOString(), active: true };
      await setDoc(doc(db, 'announcements', id), ann);
      setTitle(''); setBody('');
      onRefresh();
      onToast('הודעה פורסמה ✓', 'success');
    } catch { onToast('שגיאה בפרסום', 'error'); }
    finally { setSaving(false); }
  };

  const toggleActive = async (ann: Announcement) => {
    await updateDoc(doc(db, 'announcements', ann.id), { active: !ann.active });
    onRefresh();
    onToast(ann.active ? 'הודעה הושבתה' : 'הודעה הופעלה', 'info');
  };

  const deleteAnn = async (id: string) => {
    await deleteDoc(doc(db, 'announcements', id));
    onRefresh();
    onToast('הודעה נמחקה', 'info');
  };

  const TYPE_STYLE = {
    info:    'bg-blue-50 border-blue-300 text-blue-800',
    success: 'bg-emerald-50 border-emerald-300 text-emerald-800',
    warning: 'bg-amber-50 border-amber-300 text-amber-800',
  };
  const TYPE_LABEL = { info: 'מידע', success: 'הצלחה', warning: 'אזהרה' };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-800">הודעות למשתמשים</h1>
        <p className="text-slate-500 text-sm mt-0.5">הודעות שיוצגו בתוך האפליקציה לפי קהל יעד</p>
      </div>

      {/* Create form */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Megaphone size={15} className="text-indigo-600" /> הודעה חדשה</h2>

        <div className="space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת ההודעה"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500" />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="תוכן ההודעה..." rows={3}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 resize-none" />

          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-500 mb-1.5">סוג</p>
              <div className="flex gap-2">
                {(['info','success','warning'] as const).map(t => (
                  <button key={t} onClick={() => setType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${type===t ? TYPE_STYLE[t] : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-500 mb-1.5">קהל יעד</p>
              <div className="flex gap-2">
                {([['all','כולם'],['trial','ניסיון'],['active','פעילים']] as const).map(([v,l]) => (
                  <button key={v} onClick={() => setTarget(v)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${target===v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <button onClick={handleCreate} disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
          פרסם הודעה
        </button>
      </div>

      {/* Existing announcements */}
      <div className="space-y-3">
        {announcements.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">
            <Megaphone size={28} className="mx-auto mb-2 opacity-30" />
            אין הודעות פורסמו עדיין
          </div>
        ) : announcements.map(ann => (
          <div key={ann.id} className={`border rounded-2xl p-4 ${ann.active ? TYPE_STYLE[ann.type] : 'bg-slate-50 border-slate-200 opacity-60'}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-bold text-sm">{ann.title}</p>
                <p className="text-sm mt-0.5 opacity-80">{ann.body}</p>
                <div className="flex items-center gap-3 mt-2 text-xs opacity-70">
                  <span>{fmtDate(ann.createdAt)}</span>
                  <span>·</span>
                  <span>קהל: {ann.target === 'all' ? 'כולם' : ann.target}</span>
                  <span className={`font-bold ${ann.active ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {ann.active ? '● פעיל' : '○ כבוי'}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 mr-3">
                <button onClick={() => toggleActive(ann)} className="text-current opacity-60 hover:opacity-100">
                  {ann.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => deleteAnn(ann.id)} className="text-current opacity-60 hover:opacity-100">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Releases / Publish
══════════════════════════════════════════════════════════════════════════ */
function ReleasesTab({ releases, workspaces, onRefresh, onToast }:
  { releases: Release[]; workspaces: WorkspaceProfile[]; onRefresh:()=>void; onToast:(m:string,t?:'success'|'error'|'info')=>void }) {

  const [version,  setVersion]  = useState('');
  const [title,    setTitle]    = useState('');
  const [notes,    setNotes]    = useState('');
  const [saving,   setSaving]   = useState(false);
  const [deploying,setDeploying]= useState(false);
  const [deployStatus, setDeployStatus] = useState<'idle'|'running'|'done'|'error'>('idle');

  // GitHub Actions config (stored in Firestore system/config)
  const [ghOwner,  setGhOwner]  = useState('');
  const [ghRepo,   setGhRepo]   = useState('');
  const [ghToken,  setGhToken]  = useState('');
  const [ghSaving, setGhSaving] = useState(false);
  const [showGhSetup, setShowGhSetup] = useState(false);

  // Load saved GitHub config
  useEffect(() => {
    getDoc(doc(db, 'system', 'config')).then(snap => {
      if (snap.exists()) {
        const d = snap.data();
        if (d.github) { setGhOwner(d.github.owner ?? ''); setGhRepo(d.github.repo ?? ''); setGhToken(d.github.token ?? ''); }
      }
    }).catch(() => {});
  }, []);

  const hasGithub = ghOwner && ghRepo && ghToken;

  const saveGithubConfig = async () => {
    setGhSaving(true);
    try {
      await setDoc(doc(db, 'system', 'config'), { github: { owner: ghOwner, repo: ghRepo, token: ghToken } }, { merge: true });
      onToast('הגדרות GitHub נשמרו ✓', 'success');
      setShowGhSetup(false);
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setGhSaving(false); }
  };

  const handleSaveDraft = async () => {
    if (!version.trim() || !title.trim()) { onToast('מלא גרסה וכותרת', 'error'); return; }
    setSaving(true);
    try {
      const id = `rel_${Date.now()}`;
      const rel: Release = { id, version: version.trim(), title: title.trim(), notes: notes.trim(), createdAt: new Date().toISOString(), status: 'draft' };
      await setDoc(doc(db, 'releases', id), rel);
      setVersion(''); setTitle(''); setNotes('');
      onRefresh();
      onToast('טיוטה נשמרה ✓', 'success');
    } catch { onToast('שגיאה', 'error'); }
    finally { setSaving(false); }
  };

  // Trigger GitHub Actions workflow → auto-deploys to ray-crm.com
  const triggerGithubDeploy = async (rel: Release) => {
    const url = `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/deploy-client.yml/dispatches`;
    const res  = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { version: rel.version, release_notes: rel.notes } }),
    });
    if (!res.ok && res.status !== 204) throw new Error(`GitHub API: ${res.status}`);
  };

  const handlePublish = async (rel: Release) => {
    setDeploying(true);
    setDeployStatus('running');
    try {
      // 1. Mark as published in Firestore
      await updateDoc(doc(db, 'releases', rel.id), { status: 'published', publishedAt: new Date().toISOString() });
      await setDoc(doc(db, 'system', 'config'), { latestVersion: rel.version, lastPublished: new Date().toISOString() }, { merge: true });

      // 2. Trigger auto-deploy if GitHub configured
      if (hasGithub) {
        await triggerGithubDeploy(rel);
        setDeployStatus('done');
        onToast(`🚀 גרסה ${rel.version} — Deploy הופעל אוטומטית! כל הלקוחות יקבלו עדכון תוך כ-2 דקות`, 'success');
      } else {
        setDeployStatus('idle');
        onToast(`גרסה ${rel.version} פורסמה בFirestore. הגדר GitHub Actions לפריסה אוטומטית.`, 'info');
      }
      onRefresh();
    } catch (err) {
      setDeployStatus('error');
      onToast(`שגיאה: ${(err as Error).message}`, 'error');
    } finally {
      setDeploying(false);
    }
  };

  const clientCount = workspaces.length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-800">פרסום גרסאות</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            פרסום עדכן את <strong>{clientCount}</strong> סביבות עבודה בבת-אחת — כולם על {' '}
            <span className="font-mono text-indigo-600">ray-crm.com</span>
          </p>
        </div>
        <button onClick={() => setShowGhSetup(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${hasGithub ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-amber-50 border-amber-300 text-amber-700'}`}>
          <GitBranch size={12} />
          {hasGithub ? 'GitHub מחובר ✓' : 'חבר GitHub'}
        </button>
      </div>

      {/* Deploy status banner */}
      {deployStatus === 'running' && (
        <div className="bg-indigo-900 rounded-2xl p-4 border border-indigo-700 flex items-center gap-3">
          <RefreshCw size={16} className="animate-spin text-indigo-300 flex-shrink-0" />
          <div>
            <p className="text-white font-bold text-sm">פריסה בתהליך...</p>
            <p className="text-indigo-300 text-xs mt-0.5">GitHub Actions בונה ומפרסם לכל הלקוחות</p>
          </div>
        </div>
      )}
      {deployStatus === 'done' && (
        <div className="bg-emerald-900 rounded-2xl p-4 border border-emerald-700 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-emerald-300 flex-shrink-0" />
          <div>
            <p className="text-white font-bold text-sm">🎉 פריסה הופעלה בהצלחה!</p>
            <p className="text-emerald-300 text-xs mt-0.5">כל הלקוחות יקבלו את הגרסה החדשה תוך ~2 דקות</p>
          </div>
          <button onClick={() => setDeployStatus('idle')} className="mr-auto text-emerald-500 hover:text-white"><X size={14}/></button>
        </div>
      )}

      {/* GitHub Setup panel */}
      {showGhSetup && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2">
              <GitBranch size={15} className="text-slate-600" /> הגדרות GitHub Actions
            </h2>
            <button onClick={() => setShowGhSetup(false)} className="text-slate-400 hover:text-slate-600"><X size={14}/></button>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 space-y-1">
            <p className="font-bold">איך להגדיר (חד-פעמי):</p>
            <p>1. צור Personal Access Token ב-GitHub → Settings → Developer settings → Fine-grained tokens</p>
            <p>2. הרשאות: <code className="bg-blue-100 px-1 rounded">Actions: Read & Write</code></p>
            <p>3. הוסף את Secret <code className="bg-blue-100 px-1 rounded">FIREBASE_SERVICE_ACCOUNT_CHEX_CRM</code> ב-Repository Secrets</p>
            <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold mt-1">
              <ExternalLink size={10} /> פתח GitHub Tokens
            </a>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">GitHub Owner (שם משתמש / ארגון)</label>
              <input value={ghOwner} onChange={e => setGhOwner(e.target.value)} placeholder="username"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1.5">Repository Name</label>
              <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} placeholder="crm-app"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">Personal Access Token</label>
            <input value={ghToken} onChange={e => setGhToken(e.target.value)} type="password" placeholder="github_pat_..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
          </div>
          <button onClick={saveGithubConfig} disabled={ghSaving}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
            {ghSaving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            שמור הגדרות
          </button>
        </div>
      )}

      {/* Create release */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <h2 className="font-bold text-slate-800 text-sm flex items-center gap-2"><Plus size={15} className="text-indigo-600" /> גרסה חדשה</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">מספר גרסה</label>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.2.0"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">כותרת</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="שם הגרסה"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-500 block mb-1.5">מה חדש</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="• תיאור השינוי הראשון&#10;• תיאור השינוי השני"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
        </div>
        <button onClick={handleSaveDraft} disabled={saving}
          className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Archive size={14} />}
          שמור טיוטה
        </button>
      </div>

      {/* Releases list */}
      <div className="space-y-3">
        {releases.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm bg-white rounded-2xl border border-slate-200">
            <Package size={28} className="mx-auto mb-2 opacity-30" />
            אין גרסאות עדיין
          </div>
        ) : releases.map(rel => (
          <div key={rel.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${rel.status === 'published' ? 'border-emerald-200' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">v{rel.version}</span>
                  <span className="font-bold text-slate-800 text-sm">{rel.title}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rel.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {rel.status === 'published' ? '✓ פורסם' : '⏸ טיוטה'}
                  </span>
                </div>
                {rel.notes && (
                  <pre className="text-xs text-slate-600 font-sans whitespace-pre-wrap mt-2 leading-relaxed">{rel.notes}</pre>
                )}
                <p className="text-xs text-slate-400 mt-2">
                  נוצר: {fmtDate(rel.createdAt)}
                  {rel.publishedAt && ` · פורסם: ${fmtDate(rel.publishedAt)}`}
                </p>
              </div>
              {rel.status === 'draft' && (
                <button onClick={() => handlePublish(rel)} disabled={deploying}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors mr-4 flex-shrink-0 ${hasGithub ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'} disabled:opacity-60`}>
                  {deploying ? <RefreshCw size={12} className="animate-spin" /> : <Rocket size={12} />}
                  {hasGithub ? 'פרסם אוטומטית 🚀' : 'פרסם'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Info box — how it works */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-xs text-slate-600 space-y-1">
        <p className="font-bold text-slate-700 flex items-center gap-1"><Info size={12}/> איך עובד הפרסום?</p>
        {hasGithub ? (
          <>
            <p>✅ GitHub Actions מחובר — לחיצה על "פרסם אוטומטית" תפעיל build ו-deploy ב-GitHub Actions</p>
            <p>• הגרסה תועלה לאתר <code className="bg-slate-200 px-1 rounded">ray-crm.com</code> תוך ~2 דקות</p>
            <p>• <strong>כל {clientCount} הלקוחות</strong> יקבלו את העדכון אוטומטית בטעינה הבאה</p>
          </>
        ) : (
          <>
            <p>⚠️ GitHub Actions לא מוגדר — הפרסום שומר בFirestore אך לא מפרס קוד</p>
            <p>• לפריסה ידנית: <code className="bg-slate-200 px-1 rounded">npm run build && firebase deploy --only hosting:client</code></p>
            <p>• לפריסה אוטומטית עם לחיצה אחת: לחץ "חבר GitHub" ↗</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Analytics
══════════════════════════════════════════════════════════════════════════ */
function AnalyticsTab({ workspaces }: { workspaces: WorkspaceProfile[] }) {
  // 12-month signups
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    const y = d.getFullYear();
    const m = d.getMonth();
    const label = d.toLocaleDateString('he-IL', { month: 'short' });
    const count = workspaces.filter(w => {
      const c = new Date(w.createdAt);
      return c.getFullYear() === y && c.getMonth() === m;
    }).length;
    return { label, count };
  });
  const maxMonth = Math.max(...months.map(m => m.count), 1);

  // Plan distribution
  const planDist = ['trial','basic','pro','enterprise'].map(p => ({
    plan: p,
    count: workspaces.filter(w => w.plan === p).length,
    pct: workspaces.length ? Math.round(workspaces.filter(w => w.plan === p).length / workspaces.length * 100) : 0,
  }));

  // Industry breakdown
  const industryMap: Record<string, number> = {};
  workspaces.forEach(w => {
    const ind = w.industry || 'לא מוגדר';
    industryMap[ind] = (industryMap[ind] ?? 0) + 1;
  });
  const industries = Object.entries(industryMap).sort((a,b) => b[1]-a[1]).slice(0, 6);
  const maxInd = Math.max(...industries.map(([,c]) => c), 1);

  // Conversion funnel: trial → active
  const totalTrials = workspaces.filter(w => w.status === 'trial' || w.status === 'active').length;
  const converted   = workspaces.filter(w => w.status === 'active').length;
  const convRate    = totalTrials ? Math.round(converted / totalTrials * 100) : 0;

  // Revenue trend (per plan)
  const mrrNow = mrr(workspaces);

  // Health score distribution
  const excellent = workspaces.filter(w => healthScore(w) >= 75).length;
  const moderate  = workspaces.filter(w => healthScore(w) >= 50 && healthScore(w) < 75).length;
  const atRisk    = workspaces.filter(w => healthScore(w) < 50).length;

  const PLAN_COLORS_CHART: Record<string, string> = {
    trial: 'bg-slate-400', basic: 'bg-sky-500', pro: 'bg-violet-500', enterprise: 'bg-amber-500',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-800">אנליטיקס</h1>
        <p className="text-slate-500 text-sm mt-0.5">ניתוח מעמיק של כל נתוני המערכת</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm text-center">
          <p className="text-2xl font-black text-indigo-600">₪{mrrNow.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1">MRR חודשי</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm text-center">
          <p className="text-2xl font-black text-emerald-600">{convRate}%</p>
          <p className="text-xs text-slate-500 mt-1">שיעור המרה (trial→active)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm text-center">
          <p className="text-2xl font-black text-slate-800">{workspaces.length > 0 ? Math.round(mrrNow / Math.max(workspaces.filter(w=>w.status==='active').length,1)) : 0}</p>
          <p className="text-xs text-slate-500 mt-1">₪ ARPU (ממוצע לחשבון)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm text-center">
          <p className="text-2xl font-black text-amber-600">{atRisk}</p>
          <p className="text-xs text-slate-500 mt-1">חשבונות בסיכון</p>
        </div>
      </div>

      {/* 12-month chart */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-slate-800 text-sm">צמיחה — 12 חודשים אחרונים</h2>
            <p className="text-slate-500 text-xs mt-0.5">סביבות עבודה חדשות לחודש</p>
          </div>
          <span className="text-xs text-indigo-600 bg-indigo-50 font-bold px-3 py-1 rounded-full">
            סה״כ {workspaces.length} סביבות
          </span>
        </div>
        <div className="flex items-end gap-1.5 h-32">
          {months.map(({ label, count }, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-bold text-indigo-600 opacity-0 group-hover:opacity-100">
                {count > 0 ? count : ''}
              </span>
              <div className="w-full flex items-end justify-center" style={{ height: '100px' }}>
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-indigo-600 to-indigo-400 hover:from-violet-600 hover:to-violet-400 transition-colors cursor-default"
                  style={{ height: `${(count / maxMonth) * 100}%`, minHeight: count > 0 ? 6 : 2 }}
                  title={`${label}: ${count} סביבות`}
                />
              </div>
              <span className="text-[10px] text-slate-400">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Plan distribution + Industry breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Plan distribution */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-bold text-slate-800 text-sm mb-4">פילוח תוכניות</h2>
          <div className="space-y-3">
            {planDist.map(({ plan, count, pct }) => (
              <div key={plan}>
                <div className="flex justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${PLAN_COLORS_CHART[plan]}`} />
                    <span className="font-semibold capitalize text-slate-700">{plan}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-500">
                    <span>{count} סביבות</span>
                    <span className="font-bold text-slate-800">{pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-slate-100 rounded-full">
                  <div className={`h-full rounded-full ${PLAN_COLORS_CHART[plan]}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Donut-style visual (CSS approximation) */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs text-slate-500 mb-2">הכנסה לפי תוכנית (MRR)</p>
            <div className="flex gap-2 flex-wrap">
              {planDist.map(({ plan, count }) => {
                const rev = count * (PLAN_MRR[plan] ?? 0);
                if (rev === 0) return null;
                return (
                  <div key={plan} className={`flex-1 min-w-[70px] rounded-xl p-2 text-center ${PLAN_COLORS[plan] ?? 'bg-slate-100 text-slate-600'}`}>
                    <p className="text-xs font-black">₪{rev.toLocaleString()}</p>
                    <p className="text-[10px] capitalize">{plan}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Industry breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <h2 className="font-bold text-slate-800 text-sm mb-4">פילוח לפי תחום עיסוק</h2>
          {industries.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-6">אין נתוני תחום</p>
          ) : (
            <div className="space-y-3">
              {industries.map(([ind, count]) => {
                const pct = workspaces.length ? Math.round(count / workspaces.length * 100) : 0;
                return (
                  <div key={ind}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-700 font-medium truncate">{ind}</span>
                      <span className="text-slate-500 flex-shrink-0 mr-2">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full bg-violet-400 rounded-full" style={{ width: `${(count/maxInd)*100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Conversion funnel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 text-sm mb-4">משפך המרה</h2>
        <div className="flex items-stretch gap-3">
          {[
            { label: 'נרשמו', count: workspaces.length,                  color: 'bg-indigo-100 border-indigo-300 text-indigo-800' },
            { label: 'ניסיון', count: totalTrials,                        color: 'bg-blue-100 border-blue-300 text-blue-800'    },
            { label: 'המירו',  count: converted,                          color: 'bg-emerald-100 border-emerald-300 text-emerald-800' },
            { label: 'Pro+',   count: workspaces.filter(w=>w.status==='active'&&(w.plan==='pro'||w.plan==='enterprise')).length, color: 'bg-violet-100 border-violet-300 text-violet-800' },
          ].map(({ label, count, color }, i, arr) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-2">
              <div className={`w-full border-2 rounded-2xl p-4 text-center ${color}`}>
                <p className="text-2xl font-black">{count}</p>
                <p className="text-xs font-semibold mt-0.5">{label}</p>
              </div>
              {i < arr.length - 1 && (
                <div className="flex items-center text-slate-400 text-xs">
                  <ChevronRight size={16} />
                  <span className="text-[10px]">
                    {arr[i].count > 0 ? Math.round(arr[i+1].count/arr[i].count*100) : 0}%
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Health score distribution */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 text-sm mb-4">פילוח בריאות חשבונות</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-black text-emerald-700">{excellent}</p>
            <p className="text-xs font-semibold text-emerald-600 mt-0.5">בריאים (75+)</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-black text-amber-700">{moderate}</p>
            <p className="text-xs font-semibold text-amber-600 mt-0.5">בינוניים (50-74)</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-black text-red-700">{atRisk}</p>
            <p className="text-xs font-semibold text-red-600 mt-0.5">בסיכון (&lt;50)</p>
          </div>
        </div>
        {atRisk > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500">חשבונות בסיכון:</p>
            {workspaces.filter(w => healthScore(w) < 50).map(w => (
              <div key={w.id} className="flex items-center justify-between bg-red-50 rounded-xl px-3 py-2">
                <span className="text-xs font-medium text-slate-700">{w.name}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={w.status} />
                  <span className="text-xs font-bold text-red-600">{healthScore(w)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: System
══════════════════════════════════════════════════════════════════════════ */
function SystemTab({ workspaces, onToast }: { workspaces: WorkspaceProfile[]; onToast: (m:string,t?:'success'|'error'|'info')=>void }) {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [cfgLoading, setCfgLoading] = useState(true);

  useEffect(() => {
    getDoc(doc(db, 'system', 'config'))
      .then(snap => { if (snap.exists()) setConfig(snap.data()); })
      .catch(() => {})
      .finally(() => setCfgLoading(false));
  }, []);

  const FIREBASE_PROJECT = 'chex-crm';
  const CLIENT_PROJECT   = 'ray-crm-app';

  const FIREBASE_LINKS = [
    { label: 'Firebase Console — Admin',    url: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/overview`,      icon: '🔧' },
    { label: 'Authentication — Users',      url: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/authentication/users`, icon: '👤' },
    { label: 'Firestore Database',          url: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/firestore/data`,  icon: '🗄️' },
    { label: 'Storage',                     url: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/storage`,         icon: '📦' },
    { label: 'Cloud Functions',             url: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/functions`,       icon: '⚙️' },
    { label: 'Hosting — Admin Site',        url: `https://console.firebase.google.com/project/${FIREBASE_PROJECT}/hosting`,        icon: '🌐' },
    { label: 'Firebase Console — Client',   url: `https://console.firebase.google.com/project/${CLIENT_PROJECT}/overview`,        icon: '🔧' },
    { label: 'Hosting — Client Site',       url: `https://console.firebase.google.com/project/${CLIENT_PROJECT}/hosting`,         icon: '🌐' },
    { label: 'Client Auth — Users',         url: `https://console.firebase.google.com/project/${CLIENT_PROJECT}/authentication/users`, icon: '👤' },
    { label: 'Client Firestore',            url: `https://console.firebase.google.com/project/${CLIENT_PROJECT}/firestore/data`,   icon: '🗄️' },
  ];

  const LIVE_LINKS = [
    { label: 'Admin Site (live)',  url: 'https://admin.ray-crm.com',   icon: '🔐' },
    { label: 'Client Site (live)', url: 'https://ray-crm.com',         icon: '🚀' },
    { label: 'Signup URL',         url: 'https://ray-crm.com/signup',  icon: '📝' },
  ];

  const latestVersion = config.latestVersion as string | undefined;
  const lastPublished = config.lastPublished as string | undefined;
  const hasGithub     = !!(config.github as Record<string, unknown> | undefined)?.owner;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-black text-slate-800">מערכת</h1>
        <p className="text-slate-500 text-sm mt-0.5">מידע טכני, קישורים, וסטטוס סביבה</p>
      </div>

      {/* Deployment architecture — key banner */}
      <div className="bg-gradient-to-br from-indigo-950 to-slate-900 rounded-2xl p-5 border border-indigo-700 text-white">
        <div className="flex items-center gap-2 mb-3">
          <Rocket size={18} className="text-indigo-300" />
          <p className="font-black text-sm">ארכיטקטורת הפריסה</p>
        </div>
        <p className="text-indigo-200 text-sm leading-relaxed">
          כל הלקוחות משתמשים ב-<span className="font-mono bg-indigo-800 px-1.5 py-0.5 rounded text-white">*.ray-crm.com</span> — כל סביבת עבודה על תת-דומיין ייחודי משלה, מתוך <strong className="text-white">{workspaces.length}</strong> סביבות פעילות.
          פרסום גרסה חדשה (<code className="bg-indigo-800 px-1 rounded">firebase deploy --only hosting</code>) מעדכן את <strong className="text-white">כולם בבת-אחת</strong> בטעינה הבאה.
        </p>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="bg-indigo-800/50 rounded-xl px-3 py-2 text-xs">
            <p className="text-indigo-300">גרסה נוכחית</p>
            <p className="font-mono font-bold text-white">{cfgLoading ? '...' : (latestVersion ?? 'לא הוגדר')}</p>
          </div>
          <div className="bg-indigo-800/50 rounded-xl px-3 py-2 text-xs">
            <p className="text-indigo-300">פורסם לאחרונה</p>
            <p className="font-bold text-white">{cfgLoading ? '...' : (lastPublished ? fmtDate(lastPublished) : 'לא')}</p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs ${hasGithub ? 'bg-emerald-800/50' : 'bg-amber-800/50'}`}>
            <p className={hasGithub ? 'text-emerald-300' : 'text-amber-300'}>GitHub Actions</p>
            <p className="font-bold text-white">{hasGithub ? '✅ מחובר' : '⚠️ לא מוגדר'}</p>
          </div>
        </div>
      </div>

      {/* Deploy command quick-copy */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <Package size={14} className="text-indigo-600" /> פקודות פריסה מהירה
        </h2>
        <div className="space-y-2">
          {[
            { label: 'פרסם Client בלבד (מעדכן כל הלקוחות)',     cmd: 'npm run build && firebase deploy --only hosting:client'    },
            { label: 'פרסם Cloud Functions (Blaze נדרש)',        cmd: 'firebase deploy --only functions'                          },
            { label: 'פרסם הכל',                                  cmd: 'npm run build && firebase deploy'                           },
          ].map(({ label, cmd }) => (
            <div key={cmd} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
              <code className="flex-1 text-xs text-slate-800 font-mono" dir="ltr">{cmd}</code>
              <button
                onClick={() => { copyText(cmd); onToast('פקודה הועתקה ✓', 'success'); }}
                className="text-slate-400 hover:text-indigo-600 flex-shrink-0 transition-colors"
              >
                <Copy size={13} />
              </button>
            </div>
          ))}
          <p className="text-[11px] text-slate-400 mt-1">💡 הרץ מתיקיית הפרויקט <code className="bg-slate-100 px-1 rounded">crm-app/</code></p>
        </div>
      </div>

      {/* Live links */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <Globe size={14} className="text-emerald-600" /> קישורים לאתרים
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {LIVE_LINKS.map(({ label, url, icon }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer"
              className="flex items-center gap-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl px-3 py-2.5 transition-colors">
              <span className="text-lg">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-800 truncate">{label}</p>
                <p className="text-[10px] text-slate-500 truncate" dir="ltr">{url}</p>
              </div>
              <ExternalLink size={11} className="text-slate-400 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Firebase Console links */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <Zap size={14} className="text-amber-500" /> Firebase Console
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {FIREBASE_LINKS.map(({ label, url, icon }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer"
              className="flex items-center gap-2.5 bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-200 rounded-xl px-3 py-2.5 transition-colors">
              <span>{icon}</span>
              <p className="text-xs font-medium text-slate-700 flex-1 truncate">{label}</p>
              <ExternalLink size={11} className="text-slate-400 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Stuck Email Release Tool */}
      <StuckEmailTool onToast={onToast} workspaces={workspaces} />

      {/* Environment info */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h2 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <Info size={14} className="text-slate-500" /> מידע סביבה
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { label: 'Admin Firebase Project',  value: FIREBASE_PROJECT,       mono: true  },
            { label: 'Client Firebase Project', value: CLIENT_PROJECT,         mono: true  },
            { label: 'Admin URL',               value: 'admin.ray-crm.com',    mono: true  },
            { label: 'Client URL',              value: 'ray-crm.com',          mono: true  },
            { label: 'סה״כ סביבות',              value: String(workspaces.length), mono: false },
            { label: 'Super Admin',             value: 'almogavraham30@gmail.com', mono: false },
          ].map(({ label, value, mono }) => (
            <div key={label} className="bg-slate-50 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-medium">{label}</p>
              <p className={`text-xs text-slate-800 font-bold mt-0.5 ${mono ? 'font-mono' : ''}`} dir="ltr">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Stuck Email Release Tool
   Appears inside SystemTab. Lets super-admin find & delete an orphaned
   Firebase Auth account whose workspace / user-profile docs were already
   removed from Firestore (so it no longer appears anywhere in the UI).
══════════════════════════════════════════════════════════════════════════ */
function StuckEmailTool({ onToast, workspaces }:
  { onToast: (m: string, t?: 'success'|'error'|'info') => void; workspaces: WorkspaceProfile[] }) {

  const [email,    setEmail]    = useState('');
  const [checking, setChecking] = useState(false);
  const [status,   setStatus]   = useState<'idle'|'exists'|'not-found'|'unknown'>('idle');
  const [deleting, setDeleting] = useState(false);

  // Check whether the email is registered in Firebase Auth (client-side probe)
  const checkEmail = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setChecking(true);
    setStatus('idle');
    try {
      const methods = await fetchSignInMethodsForEmail(auth, trimmed);
      setStatus(methods.length > 0 ? 'exists' : 'not-found');
    } catch {
      // fetchSignInMethodsForEmail may throw on malformed email / network
      setStatus('unknown');
    } finally {
      setChecking(false);
    }
  };

  // Try to call Cloud Function (only works if Blaze plan + function deployed)
  const tryCloudDelete = async () => {
    setDeleting(true);
    try {
      // We don't know the UID from email alone client-side, so look it up from workspace or users
      // If the workspace was deleted, we won't find the UID here — function must be called with UID
      onToast('פונקציית deleteAuthUser דורשת UID. השתמש בקונסול Firebase למחיקה ידנית.', 'info');
    } finally {
      setDeleting(false);
    }
  };

  // Is the email associated with any known workspace?
  const matchingWorkspace = workspaces.find(w =>
    w.email?.toLowerCase() === email.trim().toLowerCase()
  );

  const consoleUrl = `https://console.firebase.google.com/project/chex-crm/authentication/users`;

  return (
    <div className="bg-white rounded-2xl border-2 border-orange-200 p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
          <Unlink size={15} className="text-orange-600" />
        </div>
        <div>
          <h2 className="font-bold text-slate-800 text-sm">שחרור אימייל תקוע</h2>
          <p className="text-xs text-slate-500">מחק משתמש Auth שאין לו סביבת עבודה במערכת</p>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 text-xs text-orange-800 space-y-1">
        <p className="font-bold">מתי זה קורה?</p>
        <p>כאשר מוחקים סביבת עבודה, הרשומות ב-Firestore נמחקות אך חשבון Firebase Auth נשאר.
        כתוצאה מכך, הרישום מחדש עם אותו אימייל נכשל עם "אימייל כבר קיים".</p>
      </div>

      {/* Email input row */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <AtSign size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setStatus('idle'); }}
            onKeyDown={e => e.key === 'Enter' && checkEmail()}
            placeholder="הכנס אימייל לבדיקה..."
            dir="ltr"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 focus:ring-1 focus:ring-orange-300"
          />
        </div>
        <button
          onClick={checkEmail}
          disabled={checking || !email.trim()}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors flex-shrink-0"
        >
          {checking ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
          בדוק
        </button>
      </div>

      {/* Result */}
      {status === 'not-found' && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-700 font-semibold">
          <CheckCircle2 size={14} />
          האימייל אינו רשום ב-Firebase Auth — ניתן להשתמש בו לרישום חדש
        </div>
      )}

      {status === 'unknown' && (
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
          <AlertTriangle size={14} className="text-amber-500" />
          לא ניתן לבדוק — בדוק ידנית ב-Firebase Console
        </div>
      )}

      {status === 'exists' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 font-semibold">
            <XCircle size={14} />
            האימייל <span dir="ltr" className="font-mono mx-1">{email.trim()}</span> רשום ב-Firebase Auth אך אינו מופיע במערכת
            {matchingWorkspace && (
              <span className="text-red-600 mr-1">(נמצא בסביבה: {matchingWorkspace.name})</span>
            )}
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            {/* Primary: open Firebase Console */}
            <a
              href={consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 text-white py-2.5 px-4 rounded-xl text-xs font-bold transition-colors"
            >
              <ExternalLink size={13} />
              פתח Firebase Console Authentication ←
            </a>

            {/* Copy email for easy search in console */}
            <button
              onClick={() => { copyText(email.trim()); onToast('אימייל הועתק — הדבק בשדה החיפוש בקונסול ✓', 'success'); }}
              className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 py-2.5 px-4 rounded-xl text-xs font-bold transition-colors"
            >
              <Copy size={13} />
              העתק אימייל (לחיפוש בקונסול)
            </button>

            {/* Try Cloud Function (might fail if not deployed) */}
            {matchingWorkspace?.ownerId && (
              <button
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const deleteFn = httpsCallable<{ uid: string }, { success: boolean }>(functions, 'deleteAuthUser');
                    await deleteFn({ uid: matchingWorkspace.ownerId! });
                    setStatus('not-found');
                    onToast(`חשבון Auth של ${email} נמחק ✓ — האימייל פנוי לרישום חדש`, 'success');
                  } catch (err: unknown) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
                      setStatus('not-found');
                      onToast('המשתמש לא נמצא ב-Auth — ייתכן שכבר נמחק', 'info');
                    } else {
                      onToast(`Cloud Function לא זמינה — מחק ידנית ב-Firebase Console (${msg})`, 'error');
                    }
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
                className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 py-2.5 px-4 rounded-xl text-xs font-bold transition-colors disabled:opacity-60"
              >
                {deleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                מחק Auth אוטומטית (דורש Firebase Blaze)
              </button>
            )}
          </div>

          {/* Step-by-step guide */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 space-y-1.5">
            <p className="font-bold text-slate-700">מחיקה ידנית — שלב אחר שלב:</p>
            <p>1. לחץ "פתח Firebase Console Authentication" ↗</p>
            <p>2. לחץ "העתק אימייל" ← הדבק בשדה החיפוש בקונסול</p>
            <p>3. סמן את המשתמש → לחץ תפריט ⋮ → Delete account</p>
            <p>4. לאחר המחיקה, הרישום מחדש יעבוד תקין</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Small shared components ─────────────────────────────────────────────── */
function StatusBadge({ status }: { status: WorkspaceStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function KPI({ label, value, sub, trend, icon, color }:
  { label: string; value: number; sub: string; trend: 'up'|'down'|'neutral'; icon: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    indigo: 'from-indigo-500 to-indigo-600', emerald: 'from-emerald-500 to-emerald-600',
    blue: 'from-blue-500 to-blue-600', violet: 'from-violet-500 to-violet-600',
  };
  const TrendIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus;
  const trendColor = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-500' : 'text-slate-400';
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${colors[color]} flex items-center justify-center text-white`}>
          {icon}
        </div>
        <TrendIcon size={16} className={trendColor} />
      </div>
      <p className="text-2xl font-black text-slate-800">{value}</p>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
      <p className="text-[10px] text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-400 mt-0.5 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-400 font-medium">{label}</p>
        <p className="text-xs text-slate-700 font-medium truncate">{value}</p>
      </div>
    </div>
  );
}

/* ─── Signup Link Button ──────────────────────────────────────────────────── */
function SignupLinkButton({ onToast }: { onToast?: (m: string, t?: 'success'|'error'|'info') => void }) {
  const [copied, setCopied] = useState(false);
  // Client environment lives on the custom domain
  const signupUrl = 'https://ray-crm.com/signup';

  const handleCopy = () => {
    copyText(signupUrl);
    setCopied(true);
    onToast?.('קישור הועתק ✓', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpen = () => window.open(signupUrl, '_blank');

  return (
    <div className="flex flex-col gap-1.5">
      {/* Main copy button */}
      <button
        onClick={handleCopy}
        className={`w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-bold transition-all ${
          copied
            ? 'bg-emerald-500 text-white'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white'
        }`}
      >
        {copied ? <CheckCircle2 size={13} /> : <Plus size={13} />}
        {copied ? 'הועתק!' : 'קישור רישום חדש'}
      </button>
      {/* Open in new tab */}
      <button
        onClick={handleOpen}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-[11px] font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all"
      >
        <ExternalLink size={11} />
        פתח בטאב חדש
      </button>
    </div>
  );
}
