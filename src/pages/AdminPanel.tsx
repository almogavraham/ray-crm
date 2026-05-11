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
} from 'lucide-react';
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, setDoc, getDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { WorkspaceProfile, WorkspaceStatus, UserProfile } from '../types';

/* ─── types ──────────────────────────────────────────────────────────────── */
type AdminTab = 'overview' | 'workspaces' | 'users' | 'features' | 'announcements' | 'releases';

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
  const [workspaces, setWorkspaces] = useState<WorkspaceProfile[]>([]);
  const [users,      setUsers]      = useState<UserProfile[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState<WorkspaceProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [releases,   setReleases]   = useState<Release[]>([]);
  const [flags,      setFlags]      = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [flagSaving, setFlagSaving] = useState(false);

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
      if (cfgSnap.exists() && cfgSnap.data().featureFlags) {
        setFlags({ ...DEFAULT_FLAGS, ...cfgSnap.data().featureFlags });
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
    if (!window.confirm('למחוק את סביבת העבודה לצמיתות?')) return;
    await deleteDoc(doc(db, 'workspaces', wid));
    setWorkspaces(p => p.filter(w => w.id !== wid));
    setSelected(null);
    toast('סביבת העבודה נמחקה', 'info');
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
  const toggleFlag = (feature: string, plan: 'trial'|'basic'|'pro'|'enterprise') => {
    const next = { ...flags, [feature]: { ...flags[feature], [plan]: !flags[feature]?.[plan] } };
    setFlags(next);
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

  /* ─── UI ──────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] -m-4 md:-m-6 overflow-hidden bg-slate-50" dir="rtl">

      {/* ── Left sidebar nav ────────────────────────────────────────────── */}
      <aside className="w-52 bg-slate-900 flex flex-col flex-shrink-0 border-l border-slate-800">
        <div className="px-4 py-5 border-b border-slate-800">
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
          {([
            { key: 'overview',      label: 'סקירה כללית',   icon: Activity   },
            { key: 'workspaces',    label: 'סביבות עבודה',  icon: Building2  },
            { key: 'users',         label: 'משתמשים',        icon: Users      },
            { key: 'features',      label: 'תכונות ותוכניות', icon: Settings2  },
            { key: 'announcements', label: 'הודעות',          icon: Megaphone  },
            { key: 'releases',      label: 'פרסום גרסאות',   icon: Rocket     },
          ] as { key: AdminTab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
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
      <main className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw size={24} className="animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            {tab === 'overview'      && <OverviewTab workspaces={workspaces} users={users} total={total} active={active} trial={trial} suspended={suspended} newMonth={newMonth} />}
            {tab === 'workspaces'    && <WorkspacesTab workspaces={workspaces} selected={selected} onSelect={setSelected} onStatus={setStatus} onPlan={setPlan} onDelete={deleteWorkspace} onToast={toast} />}
            {tab === 'users'         && <UsersTab users={users} workspaces={workspaces} />}
            {tab === 'features'      && <FeaturesTab flags={flags} onToggle={toggleFlag} onSave={saveFlags} saving={flagSaving} />}
            {tab === 'announcements' && <AnnouncementsTab announcements={announcements} onRefresh={loadAll} onToast={toast} />}
            {tab === 'releases'      && <ReleasesTab releases={releases} workspaces={workspaces} onRefresh={loadAll} onToast={toast} />}
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

  // Simple 30-day bar chart data
  const bars = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const dateStr = d.toISOString().split('T')[0];
    return workspaces.filter(w => w.createdAt.startsWith(dateStr)).length;
  });
  const maxBar = Math.max(...bars, 1);

  const recent = workspaces.slice(0, 8);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-800">סקירה כללית</h1>
          <p className="text-slate-500 text-sm mt-0.5">מבט על כל המערכת — {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <SignupLinkButton />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="סה״כ סביבות"   value={total}    sub={`+${newMonth} החודש`}    trend="up"      icon={<Building2 size={18} />} color="indigo" />
        <KPI label="פעילות"         value={active}   sub={`${total ? Math.round(active/total*100) : 0}% מהסה״כ`} trend="up" icon={<CheckCircle2 size={18} />} color="emerald" />
        <KPI label="בניסיון"        value={trial}    sub="יפוגו בקרוב"            trend="neutral" icon={<Clock size={18} />}        color="blue"    />
        <KPI label="משתמשים"        value={users.length} sub="רשומים במערכת"     trend="up"      icon={<Users size={18} />}       color="violet"  />
      </div>

      {/* Chart + Recent */}
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

          {/* Alert: expiring trials */}
          {workspaces.filter(w => { const d = daysLeft(w.trialEndsAt); return w.status==='trial' && d!==null && d<=3 && d>=0; }).length > 0 && (
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold">
                <AlertTriangle size={12} />
                {workspaces.filter(w => { const d = daysLeft(w.trialEndsAt); return w.status==='trial' && d!==null && d<=3 && d>=0; }).length} ניסיונות יפוגו בקרוב
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent workspaces */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 text-sm">הצטרפויות אחרונות</h2>
          <span className="text-xs text-slate-500">{workspaces.length} סביבות סה״כ</span>
        </div>
        <div className="divide-y divide-slate-50">
          {recent.map(w => (
            <div key={w.id} className="flex items-center px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {w.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="mr-3 flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{w.name}</p>
                <p className="text-xs text-slate-500 truncate">{w.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={w.status} />
                <span className="text-xs text-slate-400">{fmtDate(w.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Workspaces
══════════════════════════════════════════════════════════════════════════ */
function WorkspacesTab({ workspaces, selected, onSelect, onStatus, onPlan, onDelete, onToast }:
  { workspaces: WorkspaceProfile[]; selected: WorkspaceProfile|null; onSelect: (w: WorkspaceProfile|null)=>void;
    onStatus: (id:string, s:WorkspaceStatus)=>Promise<void>; onPlan: (id:string, p:string)=>Promise<void>;
    onDelete: (id:string)=>Promise<void>; onToast: (m:string,t?:'success'|'error'|'info')=>void }) {

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
        <WorkspaceDetail
          ws={selected}
          onClose={() => onSelect(null)}
          onStatus={s => action(() => onStatus(selected.id, s), selected.id)}
          onPlan={p => action(() => onPlan(selected.id, p), p)}
          onDelete={() => action(() => onDelete(selected.id), selected.id)}
          loading={actLoad}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function WorkspaceDetail({ ws, onClose, onStatus, onPlan, onDelete, loading, onToast }:
  { ws: WorkspaceProfile; onClose: ()=>void; onStatus:(s:WorkspaceStatus)=>void;
    onPlan:(p:string)=>void; onDelete:()=>void; loading:string|null; onToast:(m:string,t?:'success'|'error'|'info')=>void }) {

  const d = daysLeft(ws.trialEndsAt);
  const CLIENT_ORIGIN  = 'https://ray-crm-app.web.app';
  // Unique branded login link — shows workspace logo/name on login screen
  const workspaceLink  = `${CLIENT_ORIGIN}/?ws=${ws.id}`;
  // Invite link for new team members of this workspace
  const inviteLink     = `${CLIENT_ORIGIN}/?workspace=${ws.id}&invite=1`;

  return (
    <aside className="w-80 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
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
          <InfoRow icon={<Mail size={12} />}     label="אימייל"    value={ws.email} />
          <InfoRow icon={<Phone size={12} />}    label="טלפון"     value={ws.phone || '—'} />
          <InfoRow icon={<Hash size={12} />}     label="ח.פ"       value={ws.businessId || '—'} />
          <InfoRow icon={<Building2 size={12} />} label="תחום"     value={ws.industry || '—'} />
          <InfoRow icon={<Clock size={12} />}    label="הצטרף"     value={fmtDate(ws.createdAt)} />
          {ws.trialEndsAt && (
            <InfoRow icon={<Clock size={12} />}  label="ניסיון עד" value={`${fmtDate(ws.trialEndsAt)} (${d !== null ? `${d} ימים` : ''})`} />
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

        {/* AI Prompt */}
        {ws.prompt && (
          <div className="px-5 py-4 border-b border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1"><Sparkles size={11} /> הנחיות AI</p>
            <p className="text-xs text-slate-600 leading-relaxed line-clamp-4">{ws.prompt}</p>
          </div>
        )}

        {/* Unique workspace login link */}
        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
              <Globe size={11} /> קישור כניסה ייחודי לסביבה
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
            <p className="text-[10px] text-slate-400 mt-1">הלקוח יראה את שם החברה והלוגו שלהם בדף הכניסה</p>
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
      </div>

      {/* Delete */}
      <div className="px-5 py-4 border-t border-slate-100">
        <button onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-50 border border-red-200 py-2 rounded-xl text-xs font-semibold transition-colors">
          <Trash2 size={12} /> מחק סביבת עבודה
        </button>
      </div>
    </aside>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   TAB: Users
══════════════════════════════════════════════════════════════════════════ */
function UsersTab({ users, workspaces }:
  { users: UserProfile[]; workspaces: WorkspaceProfile[] }) {
  const [search, setSearch] = useState('');

  const wsMap = Object.fromEntries(workspaces.map(w => [w.id, w]));

  const filtered = users.filter(u =>
    !search ||
    `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-800">משתמשים</h1>
          <p className="text-slate-500 text-sm mt-0.5">{users.length} משתמשים רשומים</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או אימייל..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>

        <div className="divide-y divide-slate-50">
          {filtered.map(u => {
            const ws = u.workspaceId ? wsMap[u.workspaceId] : null;
            return (
              <div key={u.uid} className="flex items-center px-5 py-3 hover:bg-slate-50 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {(u.firstName?.[0] ?? '?').toUpperCase()}
                </div>
                <div className="mr-3 flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{u.firstName} {u.lastName}</p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-2 text-right">
                  {ws && (
                    <div className="text-xs text-slate-600 bg-slate-100 px-2 py-1 rounded-lg truncate max-w-[100px]">
                      {ws.name}
                    </div>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                    {u.role === 'admin' ? 'מנהל' : 'סוכן'}
                  </span>
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
   TAB: Feature Flags
══════════════════════════════════════════════════════════════════════════ */
function FeaturesTab({ flags, onToggle, onSave, saving }:
  { flags: FeatureFlags; onToggle:(f:string,p:'trial'|'basic'|'pro'|'enterprise')=>void; onSave:(f:FeatureFlags)=>Promise<void>; saving:boolean }) {

  const PLANS: ('trial'|'basic'|'pro'|'enterprise')[] = ['trial','basic','pro','enterprise'];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-800">תכונות ותוכניות</h1>
          <p className="text-slate-500 text-sm mt-0.5">שלוט אילו תכונות פתוחות לכל תוכנית</p>
        </div>
        <button onClick={() => onSave(flags)} disabled={saving}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Package size={14} />}
          שמור הגדרות
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Header row */}
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

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 flex items-start gap-2">
        <Info size={14} className="flex-shrink-0 mt-0.5" />
        <p>שינויים בתכונות ייכנסו לתוקף בכניסה הבאה של המשתמש. תכונות מושבתות לא יופיעו בניווט.</p>
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

  // Trigger GitHub Actions workflow → auto-deploys to ray-crm-app.web.app
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
            <span className="font-mono text-indigo-600">ray-crm-app.web.app</span>
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
            <p>• הגרסה תועלה לאתר <code className="bg-slate-200 px-1 rounded">ray-crm-app.web.app</code> תוך ~2 דקות</p>
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
  // Client environment lives on a separate hosting site — isolated from admin
  const CLIENT_ORIGIN = 'https://ray-crm-app.web.app';
  const signupUrl = `${CLIENT_ORIGIN}/?signup=1`;

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
