import { useState, useCallback, useEffect, useRef, useMemo, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import './index.css';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Overview from './pages/Overview';
import AiAssistant from './pages/AiAssistant';
import Kanban from './pages/Kanban';
import Tasks from './pages/Tasks';
import Settings from './pages/Settings';
import ContentHub from './pages/ContentHub';
import HomeDashboard from './pages/HomeDashboard';
import Deals from './pages/Deals';
import Agents from './pages/Agents';
import LeadModal from './components/LeadModal';
import NewLeadModal from './components/NewLeadModal';
import CommandPalette from './components/CommandPalette';
import Toast from './components/Toast';
import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import PublicRegister from './pages/PublicRegister';
import WorkspaceOnboarding from './pages/WorkspaceOnboarding';
import WorkspaceSettings from './pages/WorkspaceSettings';
import AdminPanel from './pages/AdminPanel';
import LandingPage from './pages/LandingPage';
import LeadsOnboardingWizard from './pages/LeadsOnboardingWizard';
import ForgotPassword from './pages/ForgotPassword';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { Lead, Note, Page, TeamMember, AppSettings, Task, StandaloneTask } from './types';
import type { ToastMessage } from './components/Toast';
import { initialLeads, initialTeam } from './data/mockData';
import { db } from './lib/firebase';
import {
  collection, doc, setDoc, getDocs, onSnapshot, writeBatch, deleteDoc,
} from 'firebase/firestore';

// ─── Error Boundary ──────────────────────────────────────────────────────────
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, componentStack: '' };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error:', error, info);
    this.setState({ componentStack: info.componentStack ?? '' });
  }
  render() {
    if (this.state.error) {
      const msg   = this.state.error.message ?? 'Unknown error';
      const name  = this.state.error.name    ?? 'Error';
      const stack = this.state.error.stack   ?? '';
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 p-6 text-center" dir="rtl">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-white mb-2">אירעה שגיאה</h2>
          <p className="text-red-400 text-sm font-mono mb-1">{name}: {msg}</p>

          {/* Details panel — critical for debugging */}
          <details className="mt-4 mb-6 text-right max-w-2xl w-full">
            <summary className="text-slate-400 text-xs cursor-pointer hover:text-slate-200 transition-colors mb-2">
              פרטי שגיאה מלאים (לשיתוף עם תמיכה)
            </summary>
            <pre className="text-left text-[10px] text-slate-400 bg-slate-900 border border-slate-700 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap mt-2">
              {stack}
              {this.state.componentStack ? `\n\nComponent Stack:${this.state.componentStack}` : ''}
            </pre>
          </details>

          <div className="flex gap-3">
            <button
              onClick={() => { this.setState({ error: null, componentStack: '' }); window.location.reload(); }}
              className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-medium hover:bg-indigo-700 transition-colors text-sm"
            >
              רענן
            </button>
            <button
              onClick={() => { localStorage.clear(); window.location.href = '/'; }}
              className="bg-slate-700 text-white px-6 py-2 rounded-xl font-medium hover:bg-slate-600 transition-colors text-sm"
            >
              נקה ואפס
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Lead normalizer — guards against missing/null/invalid fields from Firestore or localStorage ──
const VALID_STATUSES: Lead['status'][] = ['חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'];
const VALID_SOURCES:  Lead['source'][] = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

function normalizeLead(raw: unknown): Lead {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawStatus = r.status as Lead['status'];
  const rawSource = r.source as Lead['source'];
  // migrate old status names from cheX era
  const migratedStatus: Lead['status'] =
    (rawStatus as string) === 'הטמעה' ? 'בתהליך' : rawStatus;
  // migrate old source names
  const migratedSource: Lead['source'] =
    ['cheX', 'ci3', 'סורקים'].includes(rawSource as string) ? 'אורגני' : rawSource;
  return {
    id:             String(r.id           ?? Date.now()),
    company:        String(r.company      ?? ''),
    contactName:    String(r.contactName  ?? ''),
    email:          String(r.email        ?? ''),
    phone:          String(r.phone        ?? ''),
    status:         VALID_STATUSES.includes(migratedStatus) ? migratedStatus : 'חדש',
    source:         VALID_SOURCES.includes(migratedSource)  ? migratedSource : 'אורגני',
    assignedTo:     String(r.assignedTo   ?? ''),
    lastUpdate:     String(r.lastUpdate   ?? ''),
    budget:         isFinite(Number(r.budget ?? r.checkCount)) ? Number(r.budget ?? r.checkCount) : 0,
    aiScore:        isFinite(Number(r.aiScore)) ? Number(r.aiScore) : 0,
    waitingContent: Boolean(r.waitingContent ?? r.waitingG3),
    tasks:          Array.isArray(r.tasks)       ? r.tasks       : [],
    notes:          Array.isArray(r.notes)       ? r.notes       : [],
    solutions:      Array.isArray(r.solutions)   ? r.solutions   : [],
    futureNotes:    Array.isArray(r.futureNotes) ? r.futureNotes : [],
  } as Lead;
}

// ─── Default settings ────────────────────────────────────────────────────────
const DEFAULT_SETTINGS: AppSettings = {
  userName: 'Almog Avraham',
  userInitials: 'AA',
  companyName: 'RAY Digital Agency',
  compactMode: false,
  showOverduePopup: true,
  defaultPage: 'home',
  accentColor: 'indigo',
};

// ─── localStorage helpers ────────────────────────────────────────────────────
function loadLeadsLocal(): Lead[] {
  try {
    const s = localStorage.getItem('crm-leads');
    const raw: unknown[] = s ? JSON.parse(s) : initialLeads;
    return Array.isArray(raw) ? raw.map(normalizeLead) : initialLeads.map(normalizeLead);
  } catch { return initialLeads.map(normalizeLead); }
}
function loadTeamLocal(): TeamMember[] {
  try { const s = localStorage.getItem('crm-team'); return s ? JSON.parse(s) : initialTeam; }
  catch { return initialTeam; }
}
function loadSettings(): AppSettings {
  try { const s = localStorage.getItem('crm-settings'); return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS; }
  catch { return DEFAULT_SETTINGS; }
}

// ─── AppInner: rendered inside AuthProvider ──────────────────────────────────
function AppInner() {
  const { user, profile, workspace, loading, isAdmin, isSuperAdmin, signOut, refreshWorkspace, refreshProfile } = useAuth();

  // ─── Domain routing ─────────────────────────────────────────────────────────
  // Supports two modes:
  //   NEW:    acme.ray-crm.com          → subdomain = workspace slug
  //   LEGACY: ray-crm-app.web.app/slug  → path segment = workspace slug
  //   DEV:    localhost/slug            → same as legacy
  const RAY_DOMAIN  = 'ray-crm.com';
  const hostname    = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
  const isNewDomain = hostname === RAY_DOMAIN || hostname.endsWith(`.${RAY_DOMAIN}`);

  // Detect admin domain — served by chex-crm Firebase site
  const isAdminDomain = (
    hostname === 'admin.ray-crm.com' ||
    hostname === 'chex-crm.web.app'  ||
    hostname === 'chex-crm.firebaseapp.com'
  );

  // Extract subdomain from new domain: acme.ray-crm.com → 'acme'
  const SKIP_SUBS = new Set(['www', 'app', 'admin', 'api', 'mail', 'signup']);
  let wsSlugFromHost: string | null = null;

  if (isNewDomain && !isAdminDomain) {
    const parts = hostname.split('.');
    if (parts.length >= 3 && !SKIP_SUBS.has(parts[0])) {
      wsSlugFromHost = parts[0];        // e.g. 'acme' from acme.ray-crm.com
    }
  }

  // Path-based routing (legacy ray-crm-app.web.app/slug, or localhost)
  const urlSearch      = new URLSearchParams(window.location.search);
  const inviteToken    = urlSearch.get('token') ?? '';
  const pathSegments   = window.location.pathname.split('/').filter(Boolean);
  const RESERVED_PATHS = new Set(['signup', 'register', 'login', 'signin', 'admin', 'reset', 'forgot', 'forgot-password']);
  const isSignupPath   = pathSegments[0] === 'signup' || urlSearch.get('signup') === '1';
  const isSigninPath   = pathSegments[0] === 'signin' || pathSegments[0] === 'login';
  const isForgotPath   = pathSegments[0] === 'forgot' || pathSegments[0] === 'forgot-password';
  // Allow path-based slug on any domain (ray-crm.com/acme OR ray-crm-app.web.app/acme)
  const wsSlugFromPath = (!isAdminDomain && pathSegments.length === 1 && !RESERVED_PATHS.has(pathSegments[0]))
    ? pathSegments[0] : null;

  // Final derived values — subdomain wins over path
  const isSignup  = isSignupPath;
  const isSignin  = isSigninPath;
  const isForgot  = isForgotPath;
  // Landing page: root domain with no path and no slug, NOT on admin domain
  const isLanding = !isAdminDomain && !wsSlugFromHost && !wsSlugFromPath && !isSignup && !isSignin && !isForgot && pathSegments.length === 0;
  const wsSlug   = wsSlugFromHost ?? wsSlugFromPath;

  // ── Workspace detection ───────────────────────────────────────────────────
  // isWorkspaceUser = a real tenant user (has workspaceId, not super admin)
  const isWorkspaceUser = !!(user && profile?.workspaceId && !isSuperAdmin);
  // isAdminWorkspace = super admin on admin domain → uses workspace-scoped Firestore (staging env)
  const isAdminWorkspace = !!(isSuperAdmin && isAdminDomain && workspace);
  // Effective workspace ID for Firestore paths (tenant or admin staging)
  const wid = isWorkspaceUser
    ? (profile?.workspaceId ?? null)
    : isAdminWorkspace
      ? (workspace?.id ?? null)
      : null;
  // Whether to use workspace-scoped Firestore paths (instead of root collections)
  const useWorkspaceFirestore = isWorkspaceUser || isAdminWorkspace;

  // bypassAuth — only on localhost (dev mode). On production always require login.
  const bypassAuth = isLocalhost && !user;

  // On admin domain → land directly on the admin page
  const [page, setPage]               = useState<Page>(isAdminDomain ? 'admin' : 'home');
  const [leads, setLeads]             = useState<Lead[]>([]);        // populated by effects
  const [team, setTeam]               = useState<TeamMember[]>([]);  // populated by effects
  const [settings, setSettings]       = useState<AppSettings>(loadSettings);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [toasts, setToasts]           = useState<ToastMessage[]>([]);
  const [fbReady, setFbReady]             = useState(false);
  const [standaloneTask, setStandaloneTask] = useState<StandaloneTask[]>([]);
  const [showLeadsWizard, setShowLeadsWizard] = useState(false);
  const initialSyncDone                   = useRef(false);
  const adminWsCreating                   = useRef(false);

  // ─── Overdue badge ────────────────────────────────────────────────────────
  const overdueBadge = useMemo(() => {
    try {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return leads
        .flatMap(l => (l.tasks ?? []).filter(t => !t.completed))
        .filter(t => { try { return new Date(t.date + 'T00:00:00') < today; } catch { return false; } })
        .length;
    } catch { return 0; }
  }, [leads]);

  // ─── Global Cmd+K listener ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette(p => !p);
      }
      if (e.key === 'Escape') setShowPalette(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── ROOT Firestore init (super admin / bypassAuth only) ────────────────
  useEffect(() => {
    // Skip: still loading, workspace tenant (or admin staging), or unauthenticated production user
    if (loading) return;
    if (useWorkspaceFirestore) return;
    // Only run Firestore init when there IS a user (super admin) or dev bypass
    if (!user && !bypassAuth) {
      setFbReady(true); // no Firestore needed for the landing page
      return;
    }

    let unsub: (() => void) | null = null;
    async function init() {
      try {
        const snap = await getDocs(collection(db, 'leads'));
        if (snap.empty) {
          const batch = writeBatch(db);
          loadLeadsLocal().forEach(l => batch.set(doc(db, 'leads', l.id), l));
          await batch.commit();
        }
        unsub = onSnapshot(
          collection(db, 'leads'),
          ss => {
            const fbLeads = ss.docs
              .map(d => normalizeLead(d.data()))
              .sort((a, b) => {
                const aTime = (a as Record<string, unknown>).createdAt ?? 0;
                const bTime = (b as Record<string, unknown>).createdAt ?? 0;
                return (bTime as number) - (aTime as number);
              });
            setLeads(fbLeads);
            localStorage.setItem('crm-leads', JSON.stringify(fbLeads));
          },
          () => { /* permission denied — ignore gracefully */ },
        );
        const teamSnap = await getDocs(collection(db, 'team'));
        if (teamSnap.empty) {
          const batch2 = writeBatch(db);
          loadTeamLocal().forEach(m => batch2.set(doc(db, 'team', m.id), m));
          await batch2.commit();
          setTeam(loadTeamLocal());
        } else {
          const fbTeam = teamSnap.docs.map(d => d.data() as TeamMember);
          setTeam(fbTeam);
          localStorage.setItem('crm-team', JSON.stringify(fbTeam));
        }
        initialSyncDone.current = true;
        setFbReady(true);
      } catch {
        setLeads(loadLeadsLocal());
        setTeam(loadTeamLocal());
        setFbReady(true);
      }
    }
    init();
    return () => { if (unsub) unsub(); };
  }, [loading, useWorkspaceFirestore, user, bypassAuth]); // eslint-disable-line

  // ─── WORKSPACE Firestore init (tenant OR admin staging) ──────────────────
  useEffect(() => {
    if (!useWorkspaceFirestore || !wid) return;

    let unsubLeads: (() => void) | null = null;
    let unsubTasks: (() => void) | null = null;

    // Listen to workspace leads subcollection
    unsubLeads = onSnapshot(
      collection(db, 'workspaces', wid, 'leads'),
      ss => {
        const wsLeads = ss.docs
          .map(d => normalizeLead(d.data()))
          .sort((a, b) => {
            const aTime = (a as Record<string, unknown>).createdAt ?? 0;
            const bTime = (b as Record<string, unknown>).createdAt ?? 0;
            return (bTime as number) - (aTime as number);
          });
        setLeads(wsLeads);
      },
      () => { /* permission error — handled silently */ },
    );

    // Listen to workspace tasks subcollection
    unsubTasks = onSnapshot(
      collection(db, 'workspaces', wid, 'tasks'),
      snap => {
        const tasks: StandaloneTask[] = snap.docs.map(d => d.data() as StandaloneTask);
        tasks.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        setStandaloneTask(tasks);
      },
      () => { /* permission error — handled silently */ },
    );

    // Load workspace team
    getDocs(collection(db, 'workspaces', wid, 'team')).then(snap => {
      setTeam(snap.docs.map(d => d.data() as TeamMember));
    }).catch(() => setTeam([]));

    initialSyncDone.current = true;
    setFbReady(true);

    return () => {
      if (unsubLeads) unsubLeads();
      if (unsubTasks) unsubTasks();
    };
  }, [useWorkspaceFirestore, wid]); // eslint-disable-line

  // ─── Save team to Firestore (workspace-aware) ─────────────────────────────
  useEffect(() => {
    if (!fbReady || !initialSyncDone.current) return;
    if (useWorkspaceFirestore && wid) {
      team.forEach(m => setDoc(doc(db, 'workspaces', wid, 'team', m.id), m).catch(console.error));
    } else {
      localStorage.setItem('crm-team', JSON.stringify(team));
      team.forEach(m => setDoc(doc(db, 'team', m.id), m).catch(console.error));
    }
  }, [team, fbReady, useWorkspaceFirestore, wid]); // eslint-disable-line

  // ─── Standalone tasks — root collection (only when NOT using workspace Firestore) ──
  useEffect(() => {
    if (loading || useWorkspaceFirestore) return;
    // Only listen when authenticated (super admin) or in dev bypass mode
    if (!user && !bypassAuth) return;
    const unsub = onSnapshot(
      collection(db, 'tasks'),
      snap => {
        const tasks: StandaloneTask[] = snap.docs.map(d => d.data() as StandaloneTask);
        tasks.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
        setStandaloneTask(tasks);
      },
      () => { /* permission denied — ignore gracefully */ },
    );
    return () => unsub();
  }, [loading, useWorkspaceFirestore, user, bypassAuth]); // eslint-disable-line

  // ─── Auto-create admin workspace on first super admin login at admin domain ─
  // If the super admin has no workspace yet, create one and link their user profile.
  useEffect(() => {
    if (!isSuperAdmin || !isAdminDomain || !user || loading || workspace) return;
    if (adminWsCreating.current) return;
    adminWsCreating.current = true;

    const adminWid = `admin_${user.uid}`;
    const now = new Date().toISOString();
    const adminWorkspaceData = {
      id: adminWid,
      name: 'RAY Staging',
      slug: 'ray-staging',
      businessId: '',
      phone: '',
      email: user.email ?? '',
      ownerId: user.uid,
      status: 'active',
      plan: 'enterprise',
      onboardingComplete: true,
      createdAt: now,
      industry: 'SaaS / CRM',
      isAdminWorkspace: true,
    };

    Promise.all([
      setDoc(doc(db, 'workspaces', adminWid), adminWorkspaceData, { merge: true }),
      setDoc(doc(db, 'users', user.uid), { workspaceId: adminWid }, { merge: true }),
    ])
      .then(() => refreshProfile())   // reloads profile + workspace from Firestore
      .catch(err => {
        console.error('Failed to create admin workspace:', err);
        adminWsCreating.current = false; // allow retry
      });
  }, [isSuperAdmin, isAdminDomain, user, loading, workspace]); // eslint-disable-line

  // ─── Save settings to localStorage ───────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('crm-settings', JSON.stringify(settings));
  }, [settings]);

  // ─── Toast helpers ────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
  }, []);
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── Save single lead (workspace-aware) ─────────────────────────────────
  const saveLead = useCallback(async (lead: Lead) => {
    try {
      if (useWorkspaceFirestore && wid) {
        await setDoc(doc(db, 'workspaces', wid, 'leads', lead.id), lead);
      } else {
        await setDoc(doc(db, 'leads', lead.id), lead);
      }
    } catch (err) { console.error('Error saving lead:', err); }
  }, [useWorkspaceFirestore, wid]);

  // ─── Lead handlers ────────────────────────────────────────────────────────
  const handleLeadSave = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    saveLead(updated);
    setSelectedLead(null);
    addToast('הכרטיס נשמר בהצלחה ✓');
  };

  const handleLeadUpdate = (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    saveLead(updated);
  };

  const handleLeadDelete = (id: string) => {
    setLeads(prev => prev.filter(l => l.id !== id));
    setSelectedLead(null);
    if (useWorkspaceFirestore && wid) {
      deleteDoc(doc(db, 'workspaces', wid, 'leads', id)).catch(console.error);
    } else {
      deleteDoc(doc(db, 'leads', id)).catch(console.error);
    }
    addToast('הליד נמחק', 'info');
  };

  const handleAddLead = async (lead: Lead) => {
    const leadWithTimestamp = { ...lead, createdAt: Date.now() } as Lead;
    setLeads(prev => [leadWithTimestamp, ...prev]);
    await saveLead(leadWithTimestamp);
    setShowNewLead(false);
    addToast(`ליד חדש נוסף: ${lead.company}`, 'success');
  };

  const handleTaskComplete = (leadId: string, taskId: string) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId
          ? { ...l, tasks: l.tasks.map(t => t.id === taskId ? { ...t, completed: true, completedAt: new Date().toISOString() } : t) }
          : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה הושלמה! ✅', 'success');
  };

  const handleTaskDelete = (leadId: string, taskId: string) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, tasks: l.tasks.filter(t => t.id !== taskId) } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה נמחקה', 'info');
  };

  const handleAddTask = (leadId: string, task: Task) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, tasks: [...l.tasks, task] } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה נוצרה בהצלחה ✓', 'success');
  };

  const handleBulkDelete = (leadIds: string[]) => {
    setLeads(prev => prev.filter(l => !leadIds.includes(l.id)));
    leadIds.forEach(id => {
      if (useWorkspaceFirestore && wid) {
        deleteDoc(doc(db, 'workspaces', wid, 'leads', id)).catch(console.error);
      } else {
        deleteDoc(doc(db, 'leads', id)).catch(console.error);
      }
    });
    addToast(`${leadIds.length} לידים נמחקו`, 'info');
  };

  const handleBulkStatusChange = (leadIds: string[], status: Lead['status']) => {
    setLeads(prev => {
      const next = prev.map(l =>
        leadIds.includes(l.id)
          ? { ...l, status, lastUpdate: new Date().toLocaleDateString('he-IL') }
          : l
      );
      leadIds.forEach(id => {
        const updated = next.find(l => l.id === id);
        if (updated) saveLead(updated);
      });
      return next;
    });
    addToast(`${leadIds.length} לידים עודכנו לסטטוס "${status}"`, 'success');
  };

  // ─── Team handlers ────────────────────────────────────────────────────────
  const handleUpdateRole = (id: string, role: 'מנהל' | 'סוכן') => {
    setTeam(prev => prev.map(m => m.id === id ? { ...m, role } : m));
    addToast('תפקיד עודכן', 'info');
  };
  const handleInvite = (email: string, role: 'מנהל' | 'סוכן') => {
    const newMember: TeamMember = {
      id: Date.now().toString(),
      name: email.split('@')[0],
      email,
      role,
    };
    setTeam(prev => [...prev, newMember]);
    addToast(`הזמנה נשלחה ל-${email}`, 'success');
  };
  const handleRemoveMember = (id: string) => {
    setTeam(prev => prev.filter(m => m.id !== id));
    addToast('חבר הצוות הוסר', 'info');
  };
  // ─── Standalone task handlers (workspace-aware) ──────────────────────────
  const handleStandaloneAdd = async (task: StandaloneTask) => {
    // Optimistic update — show immediately without waiting for Firestore
    setStandaloneTask(prev =>
      prev.some(t => t.id === task.id) ? prev : [...prev, task]
    );
    // Firestore rejects documents with undefined values — strip them before saving
    const firestoreTask = Object.fromEntries(
      Object.entries(task).filter(([, v]) => v !== undefined)
    ) as StandaloneTask;
    if (useWorkspaceFirestore && wid) {
      await setDoc(doc(db, 'workspaces', wid, 'tasks', task.id), firestoreTask).catch(console.error);
    } else {
      await setDoc(doc(db, 'tasks', task.id), firestoreTask).catch(console.error);
    }
    addToast('משימה נוספה ✓', 'success');
  };
  const handleStandaloneComplete = async (taskId: string) => {
    const task = standaloneTask.find(t => t.id === taskId);
    if (!task) return;
    const updated = { ...task, completed: true, completedAt: new Date().toISOString() };
    setStandaloneTask(prev => prev.map(t => t.id === taskId ? updated : t));
    if (useWorkspaceFirestore && wid) {
      await setDoc(doc(db, 'workspaces', wid, 'tasks', taskId), updated).catch(console.error);
    } else {
      await setDoc(doc(db, 'tasks', taskId), updated).catch(console.error);
    }
  };
  const handleStandaloneDelete = async (taskId: string) => {
    setStandaloneTask(prev => prev.filter(t => t.id !== taskId));
    if (useWorkspaceFirestore && wid) {
      await deleteDoc(doc(db, 'workspaces', wid, 'tasks', taskId)).catch(console.error);
    } else {
      await deleteDoc(doc(db, 'tasks', taskId)).catch(console.error);
    }
  };

  const handleStandaloneEdit = async (task: StandaloneTask) => {
    setStandaloneTask(prev => prev.map(t => t.id === task.id ? task : t));
    const firestoreTask = Object.fromEntries(
      Object.entries(task).filter(([, v]) => v !== undefined)
    ) as StandaloneTask;
    if (useWorkspaceFirestore && wid) {
      await setDoc(doc(db, 'workspaces', wid, 'tasks', task.id), firestoreTask).catch(console.error);
    } else {
      await setDoc(doc(db, 'tasks', task.id), firestoreTask).catch(console.error);
    }
    addToast('משימה עודכנה ✓', 'success');
  };

  // ─── AI agent: add note to lead ───────────────────────────────────────────
  const handleAddNote = (leadId: string, noteText: string) => {
    const note: Note = {
      id:        Date.now().toString(),
      text:      noteText,
      author:    settings.userName,
      timestamp: new Date().toISOString(),
    };
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, notes: [...l.notes, note] } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('הערה נוספה ✓', 'success');
  };

  // ─── Settings handlers ────────────────────────────────────────────────────
  const handleSettingsChange = (s: AppSettings) => {
    setSettings(s);
    addToast('ההגדרות נשמרו ✓', 'success');
  };

  const handleImportLeads = (imported: Lead[]) => {
    setLeads(prev => [...imported, ...prev]);
    imported.forEach(l => saveLead(l));
    addToast(`${imported.length} לידים יובאו`, 'success');
  };

  const handleResetData = () => {
    setLeads(initialLeads);
    initialLeads.forEach(l => saveLead(l));
    addToast('הנתונים אופסו', 'info');
  };

  // ─── Derive display name/initials from profile ────────────────────────────
  // Super admin always uses settings (RAY branding); workspace users use their profile
  const displayName = isWorkspaceUser && profile
    ? `${profile.firstName} ${profile.lastName}`
    : settings.userName;
  const displayInitials = isWorkspaceUser && profile?.firstName && profile?.lastName
    ? `${profile.firstName[0]}${profile.lastName[0]}`
    : settings.userInitials;

  // ── Auto-sync URL → workspace's canonical URL ─────────────────────────────
  // Only sync the URL when the user is ALREADY inside the app (not on landing/root).
  // We NEVER redirect from "/" — that always stays as the public landing page.
  // Admin domain URLs are not path-slug based, so skip them too.
  useEffect(() => {
    if (!isWorkspaceUser || !wid || isAdminDomain) return;
    const slug = workspace?.slug;
    // Skip if at root — root is always the landing page, never redirect away from it
    if (window.location.pathname === '/' || window.location.pathname === '') return;
    if (!slug) return; // no slug yet — don't modify URL
    // Already on the right subdomain
    if (wsSlugFromHost === slug) return;
    // Silently sync the URL to the workspace slug path
    if (window.location.pathname !== `/${slug}`) {
      window.history.replaceState({}, '', `/${slug}`);
    }
  }, [isWorkspaceUser, wid, workspace?.slug]); // eslint-disable-line

  // ─── Auth gates ──────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Password reset link from Firebase email (?mode=resetPassword&oobCode=xxx)
  const urlParams   = new URLSearchParams(window.location.search);
  const resetMode   = urlParams.get('mode');
  const resetCode   = urlParams.get('oobCode') ?? '';
  if (resetMode === 'resetPassword' && resetCode) {
    return (
      <ResetPassword
        oobCode={resetCode}
        onDone={() => {
          window.history.replaceState({}, '', '/');
          window.location.reload();
        }}
      />
    );
  }

  // admin domain, not logged in → show Login (no landing page, no signup link)
  if (isAdminDomain && !user && !bypassAuth) {
    return <Login />;
  }

  // admin domain, logged in but NOT super admin → redirect away (wrong person)
  if (isAdminDomain && user && !isSuperAdmin && !bypassAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 text-center p-6" dir="rtl">
        <div className="text-4xl">🚫</div>
        <h2 className="text-white font-black text-xl">אין גישה</h2>
        <p className="text-slate-400 text-sm">עמוד זה מיועד לאדמין בלבד.</p>
        <a href="https://ray-crm.com" className="text-indigo-400 hover:text-indigo-300 text-sm underline">חזרה לאתר</a>
      </div>
    );
  }

  // / (root) → Landing page for EVERYONE, always.
  // We never redirect from "/" — it's the public face of the product.
  // Logged-in workspace users can click "כניסה לסביבת העבודה" from the landing page.
  if (isLanding) {
    return (
      <LandingPage
        onSignIn={() => window.location.replace('/signin')}
        onSignUp={() => window.location.replace('/signup')}
        isLoggedIn={!!user}
        isSuperAdmin={isSuperAdmin}
        workspaceSlug={isWorkspaceUser ? workspace?.slug : undefined}
      />
    );
  }

  // Helper spinner
  const Spinner = () => (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // /forgot-password — always show, regardless of login state
  if (isForgot) {
    return <ForgotPassword onBack={() => window.location.replace('/signin')} />;
  }

  // /signin — login page.
  // If workspace user already fully logged in, send them straight to their workspace.
  if (isSignin) {
    if (user && isWorkspaceUser && workspace?.slug) {
      window.location.replace(`/${workspace.slug}`);
      return <Spinner />;
    }
    return <Login wsSlug={wsSlug ?? undefined} onSignUp={() => window.location.replace('/signup')} onBack={() => window.location.replace('/')} />;
  }

  // /signup — registration form.
  // Redirect workspace users who already have a workspace to their workspace.
  // Super admins can always view this page (for testing / convenience).
  if (isSignup) {
    if (user && isWorkspaceUser && workspace?.slug) {
      window.location.replace(`/${workspace.slug}`);
      return <Spinner />;
    }
    return (
      <PublicRegister
        onSuccess={(slug) => {
          // Same-origin path redirect — keeps Firebase Auth session alive
          window.location.replace(`/${slug}`);
        }}
        onBack={() => window.location.replace('/')}
        onSignIn={() => window.location.replace('/signin')}
      />
    );
  }

  // Invite-based registration
  if (inviteToken) {
    return (
      <Register
        token={inviteToken}
        onSuccess={() => {
          window.history.replaceState({}, '', '/');
          window.location.reload();
        }}
      />
    );
  }

  // Not logged in (direct slug URL or firebase.web.app) → Login page
  if (!user && !bypassAuth) return <Login wsSlug={wsSlug ?? undefined} onSignUp={() => window.location.replace('/signup')} />;

  // Workspace onboarding — show when workspace exists but onboarding not complete
  // Skip for admin workspace (always created with onboardingComplete: true)
  if (user && workspace && !workspace.onboardingComplete && !isAdminWorkspace) {
    return (
      <WorkspaceOnboarding
        workspace={workspace}
        onComplete={async () => {
          await refreshWorkspace();
          // After onboarding → update to the workspace's clean URL
          const slug = workspace.slug;
          window.history.replaceState({}, '', slug ? `/${slug}` : `/?ws=${workspace.id}`);
        }}
      />
    );
  }

  return (
    <>
      <Layout
        currentPage={page}
        onPageChange={setPage}
        onNewLead={() => setShowNewLead(true)}
        onRefresh={() => addToast(fbReady ? 'מחובר ל-Firebase ✓' : 'טוען...', 'info')}
        overdueBadge={overdueBadge}
        userInitials={displayInitials}
        userName={displayName}
        allowedPages={
          isWorkspaceUser
            // Workspace users: use their stored allowedPages, never include 'admin'
            ? (profile?.allowedPages ?? []).filter(p => p !== 'admin')
            // Super admin / dev bypass: full access
            : (profile?.allowedPages ?? (bypassAuth ? ['home','dashboard','overview','team','ai','kanban','tasks','settings','content','deals','agents','admin'] : []))
        }
        isAdmin={isAdmin || bypassAuth}
        isSuperAdmin={isWorkspaceUser ? false : isSuperAdmin}
        onSignOut={signOut}
        logoUrl={(isWorkspaceUser || isAdminWorkspace) ? workspace?.logoUrl : undefined}
        workspaceName={(isWorkspaceUser || isAdminWorkspace) ? workspace?.name : undefined}
      >
        {/* Firebase loading indicator */}
        {!fbReady && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-indigo-900 text-white text-sm px-4 py-2 rounded-full shadow-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            מתחבר ל-Firebase...
          </div>
        )}

        {page === 'home' && (
          <HomeDashboard
            leads={leads}
            standaloneTask={standaloneTask}
            currentUser={displayName}
            onLeadClick={setSelectedLead}
            onPageChange={setPage}
          />
        )}
        {page === 'dashboard' && (
          <Dashboard
            leads={leads}
            onLeadClick={setSelectedLead}
            onNoteClick={setSelectedLead}
            onTaskComplete={handleTaskComplete}
            onToast={addToast}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkDelete={handleBulkDelete}
            compact={settings.compactMode}
            workspace={workspace ?? undefined}
            onOpenLeadsWizard={workspace ? () => setShowLeadsWizard(true) : undefined}
          />
        )}
        {page === 'overview' && (
          <Overview leads={leads} onLeadClick={setSelectedLead} />
        )}
        {page === 'ai' && (
          <AiAssistant
            leads={leads}
            team={team}
            currentUser={displayName}
            standaloneTask={standaloneTask}
            onCreateTask={handleStandaloneAdd}
            onUpdateLead={handleLeadUpdate}
            onAddNote={handleAddNote}
            workspace={workspace}
          />
        )}
        {page === 'kanban' && (
          <Kanban leads={leads} onLeadClick={setSelectedLead} onLeadSave={handleLeadUpdate} onPageChange={setPage} />
        )}
        {page === 'tasks' && (
          <Tasks
            leads={leads}
            team={team}
            currentUser={displayName}
            standaloneTask={standaloneTask}
            onLeadClick={setSelectedLead}
            onLeadTaskComplete={handleTaskComplete}
            onLeadTaskDelete={handleTaskDelete}
            onLeadAddTask={handleAddTask}
            onStandaloneAdd={handleStandaloneAdd}
            onStandaloneComplete={handleStandaloneComplete}
            onStandaloneDelete={handleStandaloneDelete}
            onStandaloneEdit={handleStandaloneEdit}
            onPageChange={setPage}
          />
        )}
        {page === 'settings' && isWorkspaceUser && workspace && (
          <WorkspaceSettings
            workspace={workspace}
            team={team}
            currentUserUid={user?.uid ?? ''}
            currentUserEmail={user?.email ?? ''}
            onToast={addToast}
            onWorkspaceUpdate={refreshWorkspace}
          />
        )}
        {page === 'settings' && !isWorkspaceUser && (bypassAuth || isAdmin) && (
          <Settings
            settings={settings}
            leads={leads}
            onSettingsChange={handleSettingsChange}
            onImportLeads={handleImportLeads}
            onResetData={handleResetData}
            onToast={addToast}
            isAdmin={isAdmin || bypassAuth}
            currentUserUid={user?.uid ?? ''}
            team={team}
            onUpdateRole={handleUpdateRole}
            onInvite={handleInvite}
            onRemoveMember={handleRemoveMember}
          />
        )}
        {page === 'agents' && (
          <Agents
            leads={leads}
            team={team}
            currentUser={displayName}
            standaloneTask={standaloneTask}
            onCreateTask={handleStandaloneAdd}
            onUpdateLead={handleLeadUpdate}
            onToast={addToast}
          />
        )}
        {page === 'content' && (
          <ContentHub />
        )}
        {page === 'deals' && (
          <Deals leads={leads} team={team} currentUser={displayName} onLeadClick={setSelectedLead} onToast={addToast} />
        )}
        {page === 'admin' && !isWorkspaceUser && (bypassAuth || isSuperAdmin) && (
          <AdminPanel onToast={addToast} />
        )}
      </Layout>

      {/* Command Palette */}
      {showPalette && (
        <CommandPalette
          leads={leads}
          onClose={() => setShowPalette(false)}
          onLeadClick={lead => { setSelectedLead(lead); setShowPalette(false); }}
          onPageChange={p => { setPage(p); setShowPalette(false); }}
          onNewLead={() => { setShowNewLead(true); setShowPalette(false); }}
        />
      )}

      {selectedLead && (
        <LeadModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onSave={handleLeadSave}
          onUpdate={handleLeadUpdate}
          onDelete={handleLeadDelete}
          workspace={workspace ?? undefined}
          currentUser={displayName}
          onToast={addToast}
        />
      )}

      {showNewLead && (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onAdd={handleAddLead}
          workspaceSolutions={workspace?.businessSolutions ?? []}
          currentUser={displayName}
          existingLeads={leads}
        />
      )}

      {/* Leads onboarding / redesign wizard */}
      {showLeadsWizard && workspace && (
        <LeadsOnboardingWizard
          workspace={workspace}
          onComplete={async () => {
            await refreshWorkspace();
            setShowLeadsWizard(false);
          }}
          onClose={() => setShowLeadsWizard(false)}
        />
      )}

      <Toast toasts={toasts} onRemove={removeToast} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ErrorBoundary>
  );
}
