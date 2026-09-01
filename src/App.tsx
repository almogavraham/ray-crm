import { useState, useCallback, useEffect, useRef, useMemo, Component } from 'react';
import { Mail, RefreshCw, LogOut } from 'lucide-react';
import { startProductTour, maybeAutoStartTour } from './lib/productTour';
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
import AutomationStudio from './pages/AutomationStudio';
import Agents from './pages/Agents';
import Workflows from './pages/Workflows';
import Analytics from './pages/Analytics';
import AiStudio from './pages/AiStudio';
import Integrations from './pages/Integrations';
import LeadModal from './components/LeadModal';
import NewLeadModal from './components/NewLeadModal';
import CommandPalette from './components/CommandPalette';
import Toast from './components/Toast';
import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import PublicRegister from './pages/PublicRegister';
import WorkspaceOnboarding from './pages/WorkspaceOnboarding';
import WorkspaceSettings from './pages/WorkspaceSettings';
import AdminPanel from './pages/AdminPanel';
import LandingPage from './pages/LandingPage';
import BillingPage from './pages/BillingPage';
import EmailAgent from './pages/EmailAgent';
import MarketingAgent from './pages/MarketingAgent';
import LeadsOnboardingWizard from './pages/LeadsOnboardingWizard';
import ForgotPassword from './pages/ForgotPassword';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LangProvider } from './contexts/LangContext';
import { ThemeProvider } from './contexts/ThemeContext';
import type { Lead, Note, Page, TeamMember, AppSettings, Task, StandaloneTask, WorkspacePlan } from './types';
import type { ToastMessage } from './components/Toast';
import {
  loadStatusConfigs, saveStatusConfigs, getStatusConfig, resolveTaskDescription,
  DEFAULT_STATUS_CONFIGS,
} from './lib/statusConfig';
import type { StatusConfig } from './lib/statusConfig';
import { markNotificationRead } from './lib/notifications';
import LegalPages from './pages/LegalPages';
import CheckoutPage from './pages/CheckoutPage';
import ApiDocsPage from './pages/ApiDocsPage';
import SecurityPage from './pages/SecurityPage';
import { ALL_PAGES } from './types';
import { runAutoWorkflows } from './lib/automationEngine';
import type { PendingSend } from './lib/automationEngine';
import { dispatchAutomationSends } from './lib/automationSend';
import type { Workflow } from './lib/automationEngine';
import type { AppNotification } from './lib/notifications';
import StatusConfigEditor from './components/StatusConfigEditor';
import { initialLeads, initialTeam } from './data/mockData';
import { db } from './lib/firebase';
import { getImpersonation, stopImpersonation } from './lib/adminImpersonation';
import { computeInsights } from './lib/insightEngine';
import type { Insight } from './lib/insightEngine';
import { wakeWordDetector, isSpeechSupported } from './lib/wakeWord';
import {
  collection, doc, setDoc, getDocs, onSnapshot, writeBatch, deleteDoc,
  query, orderBy, limit,
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
// Note: VALID_STATUSES is only used for legacy migration — custom statuses are allowed (LeadStatus = string)
// 'הטמעה' is a real, distinct status in the cheX environment — do NOT fold it into
// 'בתהליך'. Keep this map empty unless a status truly needs renaming.
const LEGACY_STATUS_MIGRATIONS: Record<string, string> = {};
const VALID_SOURCES: Lead['source'][] = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

function normalizeLead(raw: unknown): Lead {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rawStatus = String(r.status ?? 'חדש');
  const rawSource = r.source as Lead['source'];
  // migrate old status names from cheX era — but allow ALL other string statuses (including custom)
  const migratedStatus: Lead['status'] = LEGACY_STATUS_MIGRATIONS[rawStatus] ?? rawStatus;
  // migrate old source names
  const migratedSource: Lead['source'] =
    ['cheX', 'ci3', 'סורקים'].includes(rawSource as string) ? 'אורגני' : rawSource;
  return {
    // Spread all raw fields first so optional fields (objection, activityLog,
    // lastContactDate, nextFollowUpDate, createdAt, etc.) are preserved from Firestore.
    // The explicit assignments below then override with validated/migrated values.
    ...r,
    id:             String(r.id           ?? Date.now()),
    company:        String(r.company      ?? ''),
    contactName:    String(r.contactName  ?? ''),
    email:          String(r.email        ?? ''),
    phone:          String(r.phone        ?? ''),
    status:         migratedStatus || 'חדש',  // allow any string — custom statuses pass through
    // Allow ANY source string (incl. workspace-custom sources like 'ליד טלפוני').
    // Only fall back to 'אורגני' when the value is empty. VALID_SOURCES is no
    // longer used to reset — that was silently wiping custom lead sources.
    source:         (migratedSource && String(migratedSource).trim()) ? migratedSource : 'אורגני',
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

// Firestore rejects any object containing `undefined` values — a single
// undefined optional field (objection, nextFollowUpDate, a customField, …) makes
// the whole setDoc throw, so the save silently fails and the edit is lost on
// refresh. Strip undefined recursively before every write.
function deepStripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => deepStripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = deepStripUndefined(v);
    }
    return out as T;
  }
  return value;
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
  theme: 'light',
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

// Map a Firebase auth error (from sending a verification email) to a clear Hebrew message.
function verificationErrorMsg(e: unknown): string {
  const code    = (e as { code?: string })?.code ?? '';
  const message = (e as { message?: string })?.message ?? '';
  if (code === 'auth/too-many-requests')
    return '⏳ נשלחו יותר מדי בקשות אימות. המתן מספר דקות ונסה שוב — המייל שכבר נשלח עדיין תקף, בדוק גם בתיקיית הספאם.';
  if (code === 'auth/network-request-failed')
    return '📡 בעיית תקשורת. בדוק את החיבור לאינטרנט ונסה שוב.';
  if (code === 'auth/requires-recent-login' || code === 'auth/user-token-expired')
    return '🔑 פג תוקף ההתחברות. התנתק והתחבר מחדש ונסה שוב.';
  return 'שגיאה בשליחת מייל האימות: ' + (message || code || 'לא ידוע');
}

// ─── Email Verification Banner ────────────────────────────────────────────────
function EmailVerificationBanner({ email, onResend, daysLeft }: { email: string; onResend: () => Promise<void>; daysLeft: number }) {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);

  const handleResend = async () => {
    setLoading(true);
    try { await onResend(); setSent(true); }
    catch (e) { alert(verificationErrorMsg(e)); }
    finally { setLoading(false); }
  };

  const urgentColor = daysLeft <= 1
    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
    : daysLeft === 2
      ? 'linear-gradient(90deg, #f97316, #ea580c)'
      : 'linear-gradient(90deg, #f59e0b, #f97316)';

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        title="הצג הודעת אימות מייל"
        style={{
          position: 'fixed', top: 8, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, background: urgentColor,
          color: '#fff', border: 'none', borderRadius: 20, padding: '4px 14px',
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: '0 2px 10px rgba(249,115,22,0.5)',
        }}
      >
        📧 אימות מייל — {daysLeft} {daysLeft === 1 ? 'יום' : 'ימים'} נותרו
      </button>
    );
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: urgentColor,
      color: '#fff', padding: '10px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, fontSize: 13, fontWeight: 500,
    }}>
      <span>📧</span>
      <span>
        יש לאמת את המייל <strong>{email}</strong> — נותרו <strong>{daysLeft} {daysLeft === 1 ? 'יום' : 'ימים'}</strong> לפני חסימת הגישה
      </span>
      {!sent ? (
        <button
          onClick={handleResend}
          disabled={loading}
          style={{
            background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.5)',
            borderRadius: 8, padding: '3px 12px', color: '#fff', cursor: 'pointer', fontSize: 12,
          }}
        >
          {loading ? 'שולח...' : 'שלח שוב'}
        </button>
      ) : (
        <span style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 8, padding: '3px 12px', fontSize: 12 }}>
          ✓ נשלח!
        </span>
      )}
      <button
        onClick={() => setMinimized(true)}
        title="מזער"
        style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 6, width: 24, height: 24, color: '#fff', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, lineHeight: 1,
        }}
      >
        —
      </button>
    </div>
  );
}

// ─── AppInner: rendered inside AuthProvider ──────────────────────────────────
function AppInner() {
  const { user, profile, workspace, loading, isAdmin, isSuperAdmin, emailVerified, resendVerification, signOut, refreshWorkspace, refreshProfile } = useAuth();

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
  const RESERVED_PATHS = new Set(['signup', 'register', 'login', 'signin', 'admin', 'reset', 'forgot', 'forgot-password',
    // Legal pages. Without these a visit to /privacy is read as a workspace
    // slug and the visitor lands on a tenant login instead of the policy.
    'privacy', 'terms', 'accessibility',
    // Checkout and the API reference. Same hazard: without reserving these,
    // they resolve as workspace slugs and the visitor gets a login screen.
    'checkout', 'api', 'security']);
  const isSignupPath   = pathSegments[0] === 'signup' || urlSearch.get('signup') === '1';
  const isSigninPath   = pathSegments[0] === 'signin' || pathSegments[0] === 'login';
  const isForgotPath   = pathSegments[0] === 'forgot' || pathSegments[0] === 'forgot-password';
  const legalDoc       = (['privacy', 'terms', 'accessibility'] as const)
    .find(d => pathSegments[0] === d) ?? null;
  const isCheckout     = pathSegments[0] === 'checkout';
  const isApiDocs      = pathSegments[0] === 'api';
  const isSecurity     = pathSegments[0] === 'security';
  // Allow path-based slug on any domain (ray-crm.com/acme OR ray-crm-app.web.app/acme)
  const wsSlugFromPath = (!isAdminDomain && pathSegments.length === 1 && !RESERVED_PATHS.has(pathSegments[0]))
    ? pathSegments[0] : null;

  // Final derived values — subdomain wins over path
  const isSignup  = isSignupPath;
  const isSignin  = isSigninPath;
  const isForgot  = isForgotPath;
  // Landing page: root domain with no path and no slug, NOT on admin domain
  // NOTE: `!inviteToken` matters. An invite link is `https://ray-crm.com/?token=...`
  // — root path, so without this it counts as the landing page, which is rendered
  // BEFORE the invite route below. The token was silently discarded and every
  // invite link dropped the recipient on the marketing site.
  const isLanding = !isAdminDomain && !wsSlugFromHost && !wsSlugFromPath && !isSignup && !isSignin && !isForgot && !inviteToken && pathSegments.length === 0;
  const wsSlug   = wsSlugFromHost ?? wsSlugFromPath;

  // ── Workspace detection ───────────────────────────────────────────────────
  // isWorkspaceUser = a real tenant user (has workspaceId).
  // Super admin on admin domain → admin env. Super admin on workspace domain → workspace user.
  // Superadmin viewing a customer workspace (see lib/adminImpersonation.ts).
  const impersonation = isSuperAdmin ? getImpersonation() : null;
  const isWorkspaceUser = !!(user && profile?.workspaceId && (!isSuperAdmin || !isAdminDomain));
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
  // While impersonating, open on the customer's dashboard — landing on the
  // admin panel would hide the very workspace the admin just chose to enter.
  const [page, setPage]               = useState<Page>(
    getImpersonation() ? 'dashboard' : isAdminDomain ? 'admin' : 'home');
  const [settingsDefaultSection, setSettingsDefaultSection] = useState<'profile' | 'integrations' | undefined>(undefined);
  const [emailAgentDefaultTab, setEmailAgentDefaultTab] = useState<'inbox' | 'workflows' | undefined>(undefined);
  const [leads, setLeads]             = useState<Lead[]>([]);        // populated by effects
  const [team, setTeam]               = useState<TeamMember[]>([]);  // populated by effects
  const [settings, setSettings]       = useState<AppSettings>(loadSettings);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [showAiPanel,     setShowAiPanel]     = useState(false);
  const [aiPanelExpanded, setAiPanelExpanded] = useState(false);
  // Tracks prefill query + a nonce so AiAssistant can react even when already mounted
  const [aiPrefill, setAiPrefill] = useState<{ query: string; nonce: number } | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [toasts, setToasts]           = useState<ToastMessage[]>([]);
  const [fbReady, setFbReady]             = useState(false);
  const [standaloneTask, setStandaloneTask] = useState<StandaloneTask[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  /** Active automations, kept live so lead changes can trigger them instantly. */
  const [autoWorkflows, setAutoWorkflows] = useState<Workflow[]>([]);
  const [showLeadsWizard, setShowLeadsWizard] = useState(false);
  const [statusConfigs, setStatusConfigs] = useState<StatusConfig[]>(() => {
    // Eagerly load from localStorage so configs are available before Firestore responds
    try {
      const stored = localStorage.getItem('ray-crm-status-configs');
      if (stored) {
        const parsed: StatusConfig[] = JSON.parse(stored);
        if (parsed?.length) return parsed;
      }
    } catch { /* ignore */ }
    return DEFAULT_STATUS_CONFIGS;
  });
  const [showStatusEditor, setShowStatusEditor] = useState(false);
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

  // ─── Token low-balance badge ──────────────────────────────────────────────
  const tokenLowAlert = useMemo(() => {
    if (!workspace) return false;
    // Use persisted flag OR compute locally for immediate feedback
    if ((workspace as { tokenLowAlert?: boolean }).tokenLowAlert) return true;
    const bal   = workspace.tokenBalance ?? 0;
    const alloc = workspace.tokenPlanAllocation ?? 0;
    if (bal <= 0.000001) return true;
    if (alloc > 0 && (bal / alloc) * 100 < 20) return true;
    return false;
  }, [workspace]);

  const totalBadge = overdueBadge + (tokenLowAlert ? 1 : 0);

  // ─── AI Insights (client-side, zero API calls) ────────────────────────────
  const aiInsights = useMemo<Insight[]>(() => {
    if (!fbReady) return [];
    return computeInsights({ leads, standaloneTask, team, workspace, currentPage: page });
  }, [leads, standaloneTask, team, workspace, page, fbReady]); // eslint-disable-line

  // ─── HEY RAY wake word ───────────────────────────────────────────────────
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [wakeActivated,   setWakeActivated]   = useState(false); // pulses true → triggers conversation mode in AiAssistant

  // Detect mobile — wake word keeps the mic open 24/7 which is intrusive on mobile (indicator + battery)
  const isMobileDevice = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ||
    (typeof window !== 'undefined' && 'ontouchstart' in window && navigator.maxTouchPoints > 1);

  useEffect(() => {
    const storedPref = localStorage.getItem('ray-wake-word');
    // Desktop: ON by default (unless user disabled with '0')
    // Mobile:  OFF by default (opt-in only — keeps mic indicator out of status bar)
    const defaultOn = !isMobileDevice;
    const shouldEnable = storedPref !== null
      ? storedPref === '1'          // respect explicit user preference on any device
      : defaultOn && isSpeechSupported(); // no saved pref → use device default
    if (shouldEnable) setWakeWordEnabled(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Extracted wake callback — shared between normal start and post-conversation restart
  const handleWakeWord = useCallback(() => {
    setShowAiPanel(true);
    setWakeActivated(true);
    setTimeout(() => setWakeActivated(false), 200);
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.35);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!isSpeechSupported()) return;
    if (wakeWordEnabled) {
      // If the user explicitly enables via toggle, reset any prior denial latch
      // (they may have granted mic permission in browser settings since last denial)
      wakeWordDetector.resetPermission();
      wakeWordDetector.start(handleWakeWord, () => {
        // Permission denied callback — disable the toggle to reflect reality
        setWakeWordEnabled(false);
        localStorage.setItem('ray-wake-word', '0');
      });
    } else {
      wakeWordDetector.stop();
    }
    return () => wakeWordDetector.stop();
  }, [wakeWordEnabled, handleWakeWord]);

  // When conversation mode ends (AiAssistant fires 'ray-conv-ended'), restart wake word detection
  useEffect(() => {
    if (!wakeWordEnabled || !isSpeechSupported()) return;
    const onConvEnded = () => {
      // Small delay so the mic is fully released before restarting
      // Don't restart if permission was denied during conversation
      setTimeout(() => {
        if (wakeWordEnabled && !wakeWordDetector.isPermissionDenied) {
          wakeWordDetector.start(handleWakeWord);
        }
      }, 600);
    };
    window.addEventListener('ray-conv-ended', onConvEnded);
    return () => window.removeEventListener('ray-conv-ended', onConvEnded);
  }, [wakeWordEnabled, handleWakeWord]);

  // Helper: open AI panel with a pre-filled query
  const openAiWithQuery = useCallback((query: string) => {
    setShowAiPanel(true);
    // Use both sessionStorage (for fresh-mount case) and state prop (for already-open case)
    sessionStorage.setItem('ray-prefill-query', query);
    setAiPrefill({ query, nonce: Date.now() });
  }, []);

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
    // On admin domain: workspace Firestore handles everything — skip root collection entirely.
    // This prevents a brief flash of root data before the workspace Firestore takes over.
    if (isSuperAdmin && isAdminDomain) return;
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
        // Only mark ready AFTER the first real snapshot arrives — prevents the
        // brief flash of 'RAY' branding while workspace doc is still loading.
        if (!initialSyncDone.current) {
          initialSyncDone.current = true;
          setFbReady(true);
        }
      },
      () => {
        // Permission error — still mark ready so the app doesn't hang
        if (!initialSyncDone.current) {
          initialSyncDone.current = true;
          setFbReady(true);
        }
      },
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

    return () => {
      if (unsubLeads) unsubLeads();
      if (unsubTasks) unsubTasks();
    };
  }, [useWorkspaceFirestore, wid]); // eslint-disable-line

  // ─── Load status configs from Firestore (with localStorage fallback) ────────
  // targetWid: wid covers normal workspace users; profile?.workspaceId covers
  // the super-admin who is also a workspace owner (wid is null for them because
  // isWorkspaceUser is false when isSuperAdmin is true).
  useEffect(() => {
    const targetWid = wid ?? profile?.workspaceId ?? null;
    if (!targetWid) return;
    loadStatusConfigs(targetWid).then(configs => {
      if (configs !== null) {
        // Firestore had real saved data — use it and sync localStorage
        setStatusConfigs(configs);
        try { localStorage.setItem('ray-crm-status-configs', JSON.stringify(configs)); } catch { /* ignore */ }
      } else {
        // Firestore document doesn't exist yet — keep the localStorage value
        // already loaded by useState, and write it to Firestore now so future
        // loads return the correct data.
        const lsRaw = localStorage.getItem('ray-crm-status-configs');
        const lsConfigs: StatusConfig[] | null = lsRaw ? JSON.parse(lsRaw) : null;
        const toSave = lsConfigs?.length ? lsConfigs : DEFAULT_STATUS_CONFIGS;
        saveStatusConfigs(targetWid, toSave).catch(console.error);
      }
    }).catch(() => { /* network error — keep state as-is */ });
  }, [wid, profile?.workspaceId]); // eslint-disable-line

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

  // ─── Notifications (autopilot approvals/publishes, morning digest) ──────────
  useEffect(() => {
    if (!useWorkspaceFirestore || !wid) { setNotifications([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'workspaces', wid, 'notifications'), orderBy('createdAt', 'desc'), limit(30)),
      snap => setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as AppNotification))),
      () => { /* ignore */ },
    );
    return () => unsub();
  }, [useWorkspaceFirestore, wid]);

  // ─── Live automations (so they can fire the moment a lead changes) ─────────
  useEffect(() => {
    if (!useWorkspaceFirestore || !wid) { setAutoWorkflows([]); return; }
    const unsub = onSnapshot(
      collection(db, 'workspaces', wid, 'workflows'),
      snap => setAutoWorkflows(snap.docs.map(d => d.data() as Workflow).filter(w => w.active)),
      () => { /* ignore */ },
    );
    return () => unsub();
  }, [useWorkspaceFirestore, wid]);

  const handleNotificationClick = useCallback((n: AppNotification) => {
    if (!n.read && wid) {
      markNotificationRead(wid, n.id).catch(() => {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, read: true } : x));
    }
    if (n.link) setPage(n.link as Page);
  }, [wid]);

  // ─── Auto-create admin workspace on first super admin login at admin domain ─
  // If the super admin has no workspace yet, create one and link their user profile.
  useEffect(() => {
    // Skip entirely while impersonating. `workspace` is briefly null on first
    // load, so this effect would fire, relink the profile to the admin
    // workspace and call refreshProfile() — snapping the admin out of the
    // customer workspace they just entered while the banner still claimed
    // otherwise.
    if (impersonation) return;
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
  }, [isSuperAdmin, isAdminDomain, user, loading, workspace, impersonation]); // eslint-disable-line

  // ─── Save settings to localStorage ───────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('crm-settings', JSON.stringify(settings));
  }, [settings]);

  // ─── Apply theme class to <html> ─────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'light') {
      root.classList.add('light-theme');
    } else {
      root.classList.remove('light-theme');
    }
  }, [settings.theme]);

  // ─── Toast helpers ────────────────────────────────────────────────────────
  const addToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message }]);
  }, []);
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ─── Save single lead (workspace-aware) ─────────────────────────────────
  const saveLead = useCallback(async (lead: Lead): Promise<boolean> => {
    const clean = deepStripUndefined(lead);
    try {
      if (useWorkspaceFirestore && wid) {
        await setDoc(doc(db, 'workspaces', wid, 'leads', clean.id), clean, { merge: true });
      } else {
        await setDoc(doc(db, 'leads', clean.id), clean, { merge: true });
      }
      return true;
    } catch (err) { console.error('Error saving lead:', err); return false; }
  }, [useWorkspaceFirestore, wid]);

  // ─── Lead handlers ────────────────────────────────────────────────────────
  const handleLeadSave = async (updated: Lead) => {
    setLeads(prev => prev.map(l => l.id === updated.id ? updated : l));
    const ok = await saveLead(updated);
    setSelectedLead(null);
    addToast(ok ? 'הכרטיס נשמר בהצלחה ✓' : 'שגיאה בשמירה — נסה שוב', ok ? 'success' : 'error');
  };

  const handleLeadUpdate = (updated: Lead) => {
    // Give active automations a chance to react to this change (e.g. "a contact was
    // logged → move to בתהליך"). Only safe, local actions are applied, and the engine
    // returns null when nothing would change — so a rule can't retrigger on its own
    // output and loop.
    let finalLead = updated;
    let firedNames: string[] = [];
    let pendingSends: PendingSend[] = [];
    if (autoWorkflows.length) {
      try {
        const res = runAutoWorkflows(updated, autoWorkflows, displayName);
        if (res) { finalLead = res.lead; firedNames = res.applied; pendingSends = res.sends; }
      } catch (err) {
        console.error('[automation auto-run]', err);
      }
    }
    setLeads(prev => prev.map(l => l.id === finalLead.id ? finalLead : l));
    saveLead(finalLead);
    if (firedNames.length) {
      addToast(`⚡ אוטומציה הופעלה: ${firedNames.join(', ')}`, 'info');
    }

    // Messages go out on their own track, after the lead is saved — so a send
    // that fails can never take the field updates down with it. Every outcome
    // is reported: silence here would mean the customer believes a follow-up
    // went out when it did not.
    if (pendingSends.length) {
      void dispatchAutomationSends({
        workspaceId: wid ?? undefined, workspace, lead: finalLead, sends: pendingSends, fromName: displayName,
      }).then(r => {
        if (r.sent.length) addToast(`📧 נשלח: ${r.sent.join(', ')}`, 'success');
        for (const l of r.links) {
          addToast(`💬 ${l.rule} — ההודעה מוכנה, לחץ לפתיחת וואטסאפ`, 'info');
          window.open(l.url, '_blank', 'noopener');
        }
        for (const f of r.failed) addToast(`⚠️ ${f.rule}: ${f.reason}`, 'error');
      }).catch(err => addToast(`⚠️ שליחת ההודעות נכשלה: ${(err as Error).message}`, 'error'));
    }
  };

  const handleAssignLead = (leadId: string, assignedTo: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    handleLeadUpdate({ ...lead, assignedTo });
    addToast(assignedTo ? `הליד שויך ל-${assignedTo} ✓` : 'שיוך הוסר ✓', 'success');
  };

  /**
   * Optional split of the pipeline across two screens. A lead belongs to the
   * opportunities screen purely by its status, so moving between them is just
   * a status change — no conversion step, no duplicate record to keep in sync.
   */
  const splitCfg = workspace?.pipelineSplit;
  const splitOn = Boolean(splitCfg?.enabled && (splitCfg?.opportunityStatuses?.length ?? 0) > 0);
  const oppStatuses = new Set(splitCfg?.opportunityStatuses ?? []);
  const leadsForScope = (scope: 'leads' | 'opportunities'): Lead[] => {
    if (!splitOn) return leads;
    return scope === 'opportunities'
      ? leads.filter(l => oppStatuses.has(String(l.status)))
      : leads.filter(l => !oppStatuses.has(String(l.status)));
  };

  const handleLeadDelete = (id: string) => {
    const victim = leads.find(l => l.id === id);
    setLeads(prev => prev.filter(l => l.id !== id));
    setSelectedLead(null);

    // Park a copy BEFORE erasing. If parking fails we abort the delete and put
    // the row back — losing a lead silently is the failure this exists to stop.
    void (async () => {
      if (useWorkspaceFirestore && wid && victim) {
        const { moveToRecycleBin, logAudit } = await import('./lib/auditTrail');
        const parked = await moveToRecycleBin(wid, victim, displayName);
        if (!parked) {
          setLeads(prev => (prev.some(l => l.id === id) ? prev : [...prev, victim]));
          addToast('המחיקה בוטלה — לא הצלחתי לגבות את הליד', 'error');
          return;
        }
        await deleteDoc(doc(db, 'workspaces', wid, 'leads', id)).catch(console.error);
        logAudit(wid, {
          action: 'lead.delete', actor: displayName,
          summary: `נמחק ליד "${victim.company || id}" (ניתן לשחזור מסל המיחזור)`,
          targetId: id, targetName: victim.company,
        });
      } else {
        await deleteDoc(doc(db, 'leads', id)).catch(console.error);
      }
    })();

    // Delete all standalone tasks linked to this lead
    const linkedTasks = standaloneTask.filter(t => t.leadId === id);
    linkedTasks.forEach(t => {
      if (useWorkspaceFirestore && wid) {
        deleteDoc(doc(db, 'workspaces', wid, 'tasks', t.id)).catch(console.error);
      } else {
        deleteDoc(doc(db, 'tasks', t.id)).catch(console.error);
      }
    });
    if (linkedTasks.length > 0) {
      setStandaloneTask(prev => prev.filter(t => t.leadId !== id));
    }

    addToast('הליד נמחק', 'info');
  };

  const handleAddLead = async (lead: Lead) => {
    const leadWithTimestamp = { ...lead, createdAt: Date.now() } as Lead;
    setLeads(prev => [leadWithTimestamp, ...prev]);
    const ok = await saveLead(leadWithTimestamp);
    setShowNewLead(false);
    if (ok) {
      addToast(`ליד חדש נוסף: ${lead.company}`, 'success');
    } else {
      // Roll the optimistic row back so the UI never shows a lead that isn't stored.
      setLeads(prev => prev.filter(l => l.id !== leadWithTimestamp.id));
      addToast('שגיאה בשמירת הליד — נסה שוב', 'error');
    }
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

  const handleLeadTaskEdit = (leadId: string, task: Task) => {
    setLeads(prev => {
      const next = prev.map(l =>
        l.id === leadId ? { ...l, tasks: l.tasks.map(t => t.id === task.id ? { ...t, ...task } : t) } : l
      );
      const updated = next.find(l => l.id === leadId);
      if (updated) saveLead(updated);
      return next;
    });
    addToast('משימה עודכנה ✓', 'success');
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
    const leadIdSet = new Set(leadIds);
    const victims = leads.filter(l => leadIdSet.has(l.id));
    setLeads(prev => prev.filter(l => !leadIdSet.has(l.id)));

    void (async () => {
      if (useWorkspaceFirestore && wid) {
        const { moveToRecycleBin, logAudit } = await import('./lib/auditTrail');
        let parked = 0;
        for (const v of victims) {
          if (await moveToRecycleBin(wid, v, displayName)) {
            parked++;
            await deleteDoc(doc(db, 'workspaces', wid, 'leads', v.id)).catch(console.error);
          }
        }
        // Anything that could not be parked stays alive and comes back on screen.
        if (parked < victims.length) {
          const failed = victims.slice(parked);
          setLeads(prev => [...prev, ...failed.filter(f => !prev.some(l => l.id === f.id))]);
          addToast(`${failed.length} לידים לא נמחקו — הגיבוי שלהם נכשל`, 'error');
        }
        logAudit(wid, {
          action: 'lead.bulk_delete', actor: displayName, count: parked,
          summary: `נמחקו ${parked} לידים בפעולה קבוצתית (ניתנים לשחזור מסל המיחזור)`,
        });
      } else {
        leadIds.forEach(id => { void deleteDoc(doc(db, 'leads', id)).catch(console.error); });
      }
    })();

    // Delete all standalone tasks linked to any of the deleted leads
    const linkedTasks = standaloneTask.filter(t => t.leadId && leadIdSet.has(t.leadId));
    linkedTasks.forEach(t => {
      if (useWorkspaceFirestore && wid) {
        deleteDoc(doc(db, 'workspaces', wid, 'tasks', t.id)).catch(console.error);
      } else {
        deleteDoc(doc(db, 'tasks', t.id)).catch(console.error);
      }
    });
    if (linkedTasks.length > 0) {
      setStandaloneTask(prev => prev.filter(t => !t.leadId || !leadIdSet.has(t.leadId)));
    }

    addToast(`${leadIds.length} לידים נמחקו`, 'info');
  };

  const handleBulkStatusChange = (leadIds: string[], status: Lead['status']) => {
    void import('./lib/auditTrail').then(({ logAudit }) => logAudit(wid, {
      action: 'lead.bulk_status', actor: displayName, count: leadIds.length, after: String(status),
      summary: `${leadIds.length} לידים הועברו לסטטוס "${status}"`,
    }));
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

  // ─── Status config handlers ───────────────────────────────────────────────
  const handleSaveStatusConfigs = async (configs: StatusConfig[]) => {
    setStatusConfigs(configs);
    // Always save to localStorage (works even without Firestore)
    try { localStorage.setItem('ray-crm-status-configs', JSON.stringify(configs)); } catch { /* ignore */ }
    // Save to Firestore — use wid for normal users, or profile?.workspaceId for
    // super-admin who owns a workspace (wid is null for them on non-admin domain)
    const targetWid = wid ?? profile?.workspaceId ?? null;
    if (targetWid) {
      await saveStatusConfigs(targetWid, configs).catch(console.error);
    }
    addToast('הגדרות סטטוסים נשמרו ✓', 'success');
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

  // ─── Integrations → redirect to Settings > Integrations tab ────────────
  // Also reset settingsDefaultSection when navigating away so Settings opens
  // on the default tab next time the user clicks "הגדרות" directly.
  useEffect(() => {
    if (page === 'integrations') {
      setPage('settings');
      setSettingsDefaultSection('integrations');
    } else if (page !== 'settings') {
      // User navigated away from settings — clear the override
      setSettingsDefaultSection(undefined);
    }
  }, [page]);

  // ─── Meta OAuth callback param handling ──────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pageParam        = params.get('page');
    const metaConnected    = params.get('meta_connected');
    const metaError        = params.get('meta_error');
    const metaPagesCount   = params.get('pages');
    if (pageParam === 'integrations' || metaConnected || metaError) {
      if (pageParam === 'integrations') { setPage('settings'); setSettingsDefaultSection('integrations'); }
      if (metaConnected === 'success') {
        const pagesStr = metaPagesCount ? ` (${metaPagesCount} דפים)` : '';
        addToast(`Facebook חובר בהצלחה!${pagesStr} ✓`, 'success');
      } else if (metaError) {
        const errMap: Record<string, string> = {
          access_denied:            'המשתמש דחה את הבקשה',
          missing_params:           'פרמטרים חסרים',
          workspace_not_found:      'Workspace לא נמצא',
          app_credentials_missing:  'App ID ו-App Secret חסרים — שמור אותם קודם',
          db_error:                 'שגיאת מסד נתונים',
        };
        addToast(`שגיאה בחיבור Facebook: ${errMap[metaError] ?? metaError}`, 'error');
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line

  // ─── Billing / plan update ────────────────────────────────────────────────
  const handlePlanUpdate = useCallback((plan: WorkspacePlan) => {
    // Refresh workspace so the rest of the app sees the new plan
    refreshWorkspace();
    addToast(`התוכנית עודכנה ל-${plan} ✓`, 'success');
  }, [refreshWorkspace, addToast]); // eslint-disable-line

  // ─── Keep the Gmail connection alive ─────────────────────────────────────
  // Browser OAuth tokens die after ~1h with no refresh token, which is why a
  // mailbox connected yesterday read as "disconnected" today. Re-mint silently
  // Google sends the user back here after the permanent-connection consent
  // screen. Reported once and scrubbed from the URL, so a refresh does not
  // replay a stale banner.
  useEffect(() => {
    void (async () => {
      const { readConnectResult } = await import('./lib/gmailServerAuth');
      const res = readConnectResult();
      if (!res) return;
      if (res.status === 'success') {
        addToast(`Gmail חובר לצמיתות${res.email ? ` — ${res.email}` : ''} ✓`, 'success');
      } else {
        addToast(`חיבור Gmail נכשל: ${res.reason ?? 'שגיאה לא ידועה'}`, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // for as long as the app is open (see lib/gmailKeepAlive.ts).
  useEffect(() => {
    const wid = workspace?.id;
    if (!wid) return;
    let stop = () => {};
    void (async () => {
      const ka = await import('./lib/gmailKeepAlive');
      ka.startGmailKeepAlive(wid, workspace?.emailConfig?.oauthClientId);
      stop = ka.stopGmailKeepAlive;
    })();
    return () => stop();
  }, [workspace?.id, workspace?.emailConfig?.oauthClientId]);

  // ─── Workspace field update (label / solutions) ──────────────────────────
  const handleWorkspaceFieldUpdate = useCallback(async (updates: Partial<import('./types').WorkspaceProfile>) => {
    const wid = workspace?.id;
    if (!wid) return;
    await setDoc(doc(db, 'workspaces', wid), updates, { merge: true });
    await refreshWorkspace();
  }, [workspace?.id, refreshWorkspace]); // eslint-disable-line

  // ─── Settings handlers ────────────────────────────────────────────────────
  const handleSettingsChange = (s: AppSettings) => {
    setSettings(s);
    addToast('ההגדרות נשמרו ✓', 'success');
  };

  const handleImportLeads = (imported: Lead[]) => {
    setLeads(prev => [...imported, ...prev]);
    imported.forEach(l => saveLead(l));
    addToast(`${imported.length} לידים יובאו`, 'success');
    // An import is the single most destructive routine operation in this app —
    // it is what flattened 253 statuses. It gets a log line with a status
    // breakdown so the damage is legible the next morning.
    void import('./lib/auditTrail').then(({ logAudit }) => {
      const byStatus = imported.reduce<Record<string, number>>((a, l) => {
        const k = String(l.status ?? '—'); a[k] = (a[k] ?? 0) + 1; return a;
      }, {});
      logAudit(wid, {
        action: 'lead.import', actor: displayName, count: imported.length,
        summary: `יובאו ${imported.length} לידים · ${Object.entries(byStatus)
          .sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' · ')}`,
      });
    });
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
    // Public pages keep their own address. This used to rewrite any non-root
    // path to /{slug}, so a signed-in user opening /api, /security, /terms or
    // /checkout had the URL silently replaced: reloading dropped them into the
    // app, and copying the address to share it shared the wrong page.
    if (RESERVED_PATHS.has(pathSegments[0])) return;
    if (!slug) return; // no slug yet — don't modify URL
    // Already on the right subdomain
    if (wsSlugFromHost === slug) return;
    // Silently sync the URL to the workspace slug path
    if (window.location.pathname !== `/${slug}`) {
      window.history.replaceState({}, '', `/${slug}`);
    }
  }, [isWorkspaceUser, wid, workspace?.slug]); // eslint-disable-line

  // ─── Auto-start product tour on first entry into the main app ────────────
  useEffect(() => {
    const inMainApp = !!user && !!workspace && workspace.onboardingComplete && !isAdminDomain;
    if (inMainApp) maybeAutoStartTour({ navigate: (p) => setPage(p as Page), returnTo: page });
  }, [user, workspace?.onboardingComplete, isAdminDomain]); // eslint-disable-line

  // ─── Auth gates ──────────────────────────────────────────────────────────
  // Public legal documents. Rendered before the auth gate on purpose: they
  // must be reachable with no session, and must not sit behind a spinner
  // that is waiting for one.
  if (legalDoc) return <LegalPages doc={legalDoc} />;
  if (isCheckout) return <CheckoutPage />;
  if (isApiDocs) return <ApiDocsPage />;
  if (isSecurity) return <SecurityPage />;

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // Wait until both the workspace document AND the first Firestore snapshot have
  // arrived before rendering anything. This prevents the brief flash of 'RAY'
  // branding (the Layout default) while workspace data is still in flight.
  if ((isWorkspaceUser && !workspace) || (useWorkspaceFirestore && !fbReady)) return (
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

  // Email verification link from Firebase email (?mode=verifyEmail&oobCode=xxx)
  if (resetMode === 'verifyEmail' && resetCode) {
    return <VerifyEmail oobCode={resetCode} />;
  }

  // Email verification link from Firebase email (?mode=verifyEmail&oobCode=xxx)
  if (resetMode === 'verifyEmail' && resetCode) {
    return <VerifyEmail oobCode={resetCode} />;
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

  // Grace-period calculation — 3 days from account creation before hard block
  const GRACE_DAYS = 3;
  const createdAt = user?.metadata?.creationTime ? new Date(user.metadata.creationTime).getTime() : Date.now();
  const daysSinceCreation = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
  const inGracePeriod = daysSinceCreation < GRACE_DAYS;
  const daysLeft = Math.max(1, Math.ceil(GRACE_DAYS - daysSinceCreation));

  // Email not yet verified AND grace period expired → block access
  if (user && !emailVerified && !bypassAuth && !inGracePeriod) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center" style={{ background: '#0f172a' }} dir="rtl">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
          <Mail size={30} className="text-white" />
        </div>
        <div className="space-y-2 max-w-xs">
          <h2 className="text-white font-black text-2xl">אמת את האימייל שלך</h2>
          <p className="text-slate-400 text-sm leading-relaxed">
            שלחנו קישור אימות לכתובת{' '}
            <span className="text-indigo-400 font-semibold">{user.email}</span>.
            <br />לחץ על הקישור במייל כדי להיכנס למערכת.
          </p>
          <p className="text-slate-500 text-xs pt-1">בדוק גם בתיקיית הספאם</p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={async () => {
              try { await resendVerification(); alert('✅ מייל אימות נשלח מחדש. בדוק גם בתיקיית הספאם.'); }
              catch (e) { alert(verificationErrorMsg(e)); }
            }}
            className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
            <RefreshCw size={15} /> שלח מחדש
          </button>
          <button
            onClick={() => { void signOut(); window.location.replace('/signin'); }}
            className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-medium transition-colors"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
            <LogOut size={15} /> התנתק
          </button>
        </div>
        <p className="text-slate-600 text-xs">
          לאחר האימות, רענן את הדף או{' '}
          <button onClick={() => window.location.reload()} className="text-indigo-400 hover:underline">לחץ כאן</button>
        </p>
      </div>
    );
  }

  return (
    <ThemeProvider theme={settings.theme ?? 'light'}>
    <>
      {/* ── Admin impersonation banner ───────────────────────────────────────
          Always visible while a superadmin is inside someone else's workspace.
          Without a permanent way out, "enter workspace" would be a one-way door.

          LAYOUT NOTE: the container is dir="ltr" ON PURPOSE. The first version
          was dir="rtl" with justify-between, which put the exit button against
          the RIGHT edge — directly underneath this app's fixed right-hand
          sidebar, so the one control that gets you out was invisible. The button
          now sits on the physical left where nothing can cover it, and the bar
          reserves room on the right for the sidebar. */}
      {impersonation && (
        <div
          dir="ltr"
          className="w-full flex items-center gap-3 px-4 py-2.5 text-white"
          style={{
            background: 'linear-gradient(90deg,#7c3aed,#4f46e5)',
            paddingRight: 'calc(15rem + 1rem)',
            boxShadow: '0 2px 10px rgba(124,58,237,0.35)',
          }}
        >
          <button
            onClick={() => { stopImpersonation(); window.location.href = '/'; }}
            className="flex-shrink-0 text-xs font-black px-4 py-2 rounded-xl transition-transform hover:scale-105 active:scale-95 flex items-center gap-1.5"
            style={{ background: '#ffffff', color: '#5b21b6', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}
          >
            <LogOut size={14} />
            צא מהסביבה — חזור לאדמין
          </button>
          <div dir="rtl" className="flex-1 min-w-0 text-right text-xs font-bold truncate">
            👁️ אתה צופה בסביבה <strong>{impersonation.workspaceName}</strong> בתור אדמין —
            <span className="font-normal"> שינויים שתבצע ישפיעו על הנתונים האמיתיים של הלקוח</span>
          </div>
        </div>
      )}

      {/* ── Email verification banner (within grace period) ─────────────────── */}
      {user && !emailVerified && inGracePeriod && (
        <EmailVerificationBanner
          email={user.email ?? ''}
          onResend={resendVerification}
          daysLeft={daysLeft}
        />
      )}
      <Layout
        currentPage={page}
        onStartTour={() => startProductTour({ navigate: (p) => setPage(p as Page), returnTo: page })}
        onPageChange={(p) => {
          // 'ai' page → open the single shared panel instead of a separate instance
          if (p === 'ai') { setShowAiPanel(true); setAiPanelExpanded(true); return; }
          setPage(p);
        }}
        onNewLead={() => setShowNewLead(true)}
        onRefresh={() => addToast(fbReady ? 'מחובר ל-Firebase ✓' : 'טוען...', 'info')}
        overdueBadge={totalBadge}
        tokenLowAlert={tokenLowAlert}
        notifications={notifications}
        onNotificationClick={handleNotificationClick}
        userInitials={displayInitials}
        userName={displayName}
        allowedPages={
          isWorkspaceUser
            // Workspace users: prefer workspace-level page override; fall back to profile allowedPages
            ? (() => {
                const wsPages = workspace?.allowedPages;
                const pages = Array.isArray(wsPages) && wsPages.length > 0
                  ? wsPages
                  : (profile?.allowedPages ?? []);
                const withSplit = splitOn
                  ? [...pages, 'opportunities' as Page]
                  : pages.filter((p: Page) => p !== 'opportunities');
                return withSplit.filter((p: Page) => p !== 'admin');
              })()
            // Impersonating a customer: show the pages THEY are allowed, not the
            // admin's own full set. Seeing exactly what the customer sees is the
            // whole point of entering their workspace — an admin looking at a
            // full menu can't tell which pages the customer is missing.
            : impersonation
            ? ([...((workspace?.allowedPages ?? []) as Page[]), ...(splitOn ? ['opportunities' as Page] : [])])
                .filter((p: Page) => p !== 'admin')
            // Super admin / dev bypass: full access, derived from the Page
            // registry rather than from a stored list.
            //
            // It used to read `profile?.allowedPages ?? []`, which assumes the
            // super admin has a Firestore profile document. When that document
            // is missing — as it is for this account — the fallback produced an
            // empty array and the entire navigation menu disappeared, leaving
            // only the admin console. A super admin's access is defined by being
            // a super admin; it must not depend on a document that may never
            // have been written.
            : ALL_PAGES.filter(p => p !== 'opportunities' || splitOn)
        }
        isAdmin={isAdmin || bypassAuth}
        isSuperAdmin={isWorkspaceUser ? false : isSuperAdmin}
        onSignOut={signOut}
        logoUrl={(isWorkspaceUser || isAdminWorkspace) ? workspace?.logoUrl : undefined}
        workspaceName={(isWorkspaceUser || isAdminWorkspace) ? workspace?.name : undefined}
        workspace={(isWorkspaceUser || isAdminWorkspace) ? workspace ?? undefined : undefined}
        theme={settings.theme ?? 'light'}
        onAiClick={() => { setShowAiPanel(v => !v); if (showAiPanel) setAiPanelExpanded(false); }}
        showAiPanel={showAiPanel}
        aiInsightBadge={aiInsights.length}
        wakeWordEnabled={wakeWordEnabled}
        onToggleWakeWord={() => {
          const next = !wakeWordEnabled;
          setWakeWordEnabled(next);
          localStorage.setItem('ray-wake-word', next ? '1' : '0');
        }}
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
            leads={leadsForScope('leads')}
            onLeadClick={setSelectedLead}
            onNoteClick={setSelectedLead}
            onTaskComplete={handleTaskComplete}
            onToast={addToast}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkDelete={handleBulkDelete}
            compact={settings.compactMode}
            workspace={workspace ?? undefined}
            onOpenLeadsWizard={workspace ? () => setShowLeadsWizard(true) : undefined}
            onImportLeads={handleImportLeads}
            currentUser={displayName}
            onCreateTask={handleStandaloneAdd}
            onUpdateLead={handleLeadUpdate}
            onUpdateStandaloneTask={handleStandaloneEdit}
            team={team}
            standaloneTask={standaloneTask}
            insights={aiInsights}
            onOpenAi={openAiWithQuery}
            statusConfigs={statusConfigs}
            onOpenStatusEditor={() => setShowStatusEditor(true)}
            onWorkspaceUpdate={handleWorkspaceFieldUpdate}
            onNavigate={(p) => setPage(p as Page)}
          />
        )}
        {/* Same screen, other half of the pipeline. Reusing Dashboard rather
            than forking it means every future improvement lands on both. */}
        {page === 'opportunities' && (
          <Dashboard
            leads={leadsForScope('opportunities')}
            onLeadClick={setSelectedLead}
            onNoteClick={setSelectedLead}
            onTaskComplete={handleTaskComplete}
            onToast={addToast}
            onBulkStatusChange={handleBulkStatusChange}
            onBulkDelete={handleBulkDelete}
            compact={settings.compactMode}
            workspace={workspace ?? undefined}
            onOpenLeadsWizard={workspace ? () => setShowLeadsWizard(true) : undefined}
            onImportLeads={handleImportLeads}
            currentUser={displayName}
            onCreateTask={handleStandaloneAdd}
            onUpdateLead={handleLeadUpdate}
            onUpdateStandaloneTask={handleStandaloneEdit}
            team={team}
            standaloneTask={standaloneTask}
            insights={aiInsights}
            onOpenAi={openAiWithQuery}
            statusConfigs={statusConfigs}
            onOpenStatusEditor={() => setShowStatusEditor(true)}
            onWorkspaceUpdate={handleWorkspaceFieldUpdate}
            onNavigate={(p) => setPage(p as Page)}
          />
        )}
        {page === 'overview' && (
          <Overview leads={leads} onLeadClick={setSelectedLead} workspaceId={wid ?? undefined} />
        )}
        {/* 'ai' page now redirects to the shared side panel — no separate instance here */}
        {page === 'kanban' && (
          <Kanban leads={leads} onLeadClick={setSelectedLead} onLeadSave={handleLeadUpdate} onPageChange={setPage} statusConfigs={statusConfigs} workspace={workspace ?? undefined} />
        )}
        {/* Three nav entries led to a blank screen: the components were
            imported and never rendered, so the sidebar highlighted the item,
            the title changed, and nothing appeared. The compiler had been
            saying so all along — "'Deals' is declared but its value is never
            read" — but that warning sits among hundreds of unused-import
            warnings nobody reads, and `tsc -p tsconfig.json` checks no files
            at all, so nothing surfaced it. */}
        {page === 'deals' && (
          <Deals
            leads={leads}
            team={team}
            currentUser={displayName}
            onLeadClick={setSelectedLead}
            onToast={addToast}
          />
        )}
        {page === 'analytics' && (
          <Analytics
            leads={leads}
            team={team}
            standaloneTask={standaloneTask}
            currentUser={displayName}
            onLeadClick={setSelectedLead}
            workspaceId={workspace?.id}
          />
        )}
        {page === 'ai-studio' && (
          <AiStudio
            workspace={workspace ?? undefined}
            currentUser={displayName}
            onNavigateToBilling={() => setPage('billing')}
            onToast={(msg, type) => addToast(msg, type as Parameters<typeof addToast>[1])}
          />
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
            onLeadTaskEdit={handleLeadTaskEdit}
            onPageChange={setPage}
            onToast={addToast}
          />
        )}
        {page === 'settings' && (isWorkspaceUser || isAdminWorkspace) && workspace && (
          <WorkspaceSettings
            workspace={workspace}
            team={team}
            leads={leads}
            standaloneTask={standaloneTask}
            currentUserUid={user?.uid ?? ''}
            currentUserEmail={user?.email ?? ''}
            onToast={addToast}
            onWorkspaceUpdate={refreshWorkspace}
            settings={settings}
            onSettingsChange={handleSettingsChange}
            statusConfigs={statusConfigs}
            onSaveStatusConfigs={handleSaveStatusConfigs}
            onWorkspaceFieldUpdate={handleWorkspaceFieldUpdate}
            integrationsPanel={
              <Integrations
                leads={leads}
                workspace={workspace}
                team={team}
                currentUser={displayName}
                onLeadClick={setSelectedLead}
                onToast={addToast}
                onWorkspaceUpdate={refreshWorkspace}
              />
            }
            defaultSection={settingsDefaultSection}
          />
        )}
        {page === 'settings' && !isWorkspaceUser && !isAdminWorkspace && (bypassAuth || isAdmin) && (
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
            onAssignLead={handleAssignLead}
            onNavigateTo={(p) => setPage(p as import('./types').Page)}
            integrationsPanel={workspace ? (
              <Integrations
                leads={leads}
                workspace={workspace}
                team={team}
                currentUser={displayName}
                onLeadClick={setSelectedLead}
                onToast={addToast}
                onWorkspaceUpdate={refreshWorkspace}
              />
            ) : undefined}
            defaultSection={settingsDefaultSection}
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
            workspaceId={wid ?? undefined}
            statusConfigs={statusConfigs}
            workspace={workspace ?? undefined}
          />
        )}
        {page === 'workflows' && (
          <AutomationStudio
            workspaceId={wid ?? undefined}
            leads={leads}
            team={team}
            currentUser={displayName}
            statuses={statusConfigs.map(s => s.label)}
            sources={workspace?.leadSources ?? []}
            standaloneTasks={standaloneTask}
            onCreateTask={handleStandaloneAdd}
            onToast={addToast}
          />
        )}
        {page === 'admin' && !isWorkspaceUser && (bypassAuth || isSuperAdmin) && (
          <AdminPanel onToast={addToast} />
        )}
        {page === 'billing' && workspace && (
          <BillingPage workspace={workspace} onPlanUpdate={handlePlanUpdate} />
        )}
        {page === 'email-agent' && (
          <EmailAgent
            leads={leads}
            workspaceId={wid ?? undefined}
            workspace={workspace ?? undefined}
            onToast={addToast}
            onNavigate={(p) => setPage(p as import('./types').Page)}
            defaultTab={emailAgentDefaultTab}
            workflowsPanel={
              <Workflows
                leads={leads}
                currentUser={displayName}
                standaloneTask={standaloneTask}
                onCreateTask={handleStandaloneAdd}
                onUpdateLead={handleLeadUpdate}
                onToast={addToast}
                workspaceId={wid ?? undefined}
                statusConfigs={statusConfigs}
                leadSources={workspace?.leadSources}
                team={team}
              />
            }
          />
        )}
        {page === 'marketing-agent' && (
          <MarketingAgent
            workspaceId={wid ?? undefined}
            workspace={workspace ?? undefined}
            onToast={addToast}
            onNavigate={(p) => setPage(p as import('./types').Page)}
          />
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
          team={team}
          onToast={addToast}
          onWorkspaceUpdate={handleWorkspaceFieldUpdate}
          statusConfigs={statusConfigs}
        />
      )}

      {showNewLead && (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onAdd={handleAddLead}
          workspaceSolutions={workspace?.businessSolutions ?? []}
          workspaceSources={workspace?.leadSources ?? []}
          currentUser={displayName}
          existingLeads={leads}
          statusConfigs={statusConfigs}
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

      {/* ── AI Side Panel ──────────────────────────────────────────────────── */}
      {showAiPanel && (
        <>
          {/* Backdrop — desktop only (mobile panel is always full-screen, no backdrop needed) */}
          {!aiPanelExpanded && (
            <div
              className="hidden md:block fixed inset-0 top-14 z-40 bg-black/20"
              onClick={() => setShowAiPanel(false)}
            />
          )}

          {/* Drawer — full-screen on mobile, side panel on desktop
              Mobile: use inset-0 (top+right+bottom+left=0) instead of h-screen.
              position:fixed + inset-0 adapts to the visual viewport on iOS/Android,
              so when the soft keyboard opens the panel shrinks from the bottom and
              the input bar stays visible. h-screen (100vh) does NOT shrink on iOS. */}
          <div
            className={`fixed z-50 flex flex-col shadow-2xl transition-all duration-300 ${
              aiPanelExpanded
                ? 'inset-0'
                : 'inset-0 md:top-14 md:right-auto md:bottom-0 md:w-[380px] md:rounded-tr-2xl md:rounded-br-2xl'
            }`}
            style={{ boxShadow: '8px 0 40px rgba(0,0,0,0.5)' }}
          >
            <AiAssistant
              leads={leads}
              team={team}
              currentUser={displayName}
              standaloneTask={standaloneTask}
              onCreateTask={handleStandaloneAdd}
              onUpdateLead={handleLeadUpdate}
              onAddNote={handleAddNote}
              onCreateLead={(lead) => {
                const leadWithTimestamp = { ...lead, createdAt: Date.now() };
                setLeads(prev => [leadWithTimestamp, ...prev]);
                saveLead(leadWithTimestamp);
                addToast(`ליד חדש נוסף: ${lead.company} ✓`, 'success');
              }}
              onCompleteStandaloneTask={handleStandaloneComplete}
              workspace={workspace}
              onClose={() => setShowAiPanel(false)}
              onExpand={() => setAiPanelExpanded(v => !v)}
              isExpanded={aiPanelExpanded}
              currentPage={page}
              insights={aiInsights}
              wakeActivated={wakeActivated}
              prefillQuery={aiPrefill ?? undefined}
              statusConfigs={statusConfigs}
            />
          </div>
        </>
      )}


      <Toast toasts={toasts} onRemove={removeToast} />

      {/* ── Status Config Editor ────────────────────────────────────────────── */}
      {showStatusEditor && (
        <StatusConfigEditor
          configs={statusConfigs}
          onSave={handleSaveStatusConfigs}
          onClose={() => setShowStatusEditor(false)}
        />
      )}

      {/* ── Floating AI Button (FAB) ──────────────────────────────────────── */}
      {!showAiPanel && (
        <button
          onClick={() => { setShowAiPanel(true); }}
          title="פתח עוזר AI"
          style={{
            position: 'fixed',
            bottom: '80px',      // above mobile bottom nav
            left: '20px',
            zIndex: 55,
            width: 56, height: 56,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 60%, #7c3aed 100%)',
            boxShadow: '0 4px 24px rgba(99,102,241,0.5), 0 0 0 0 rgba(99,102,241,0.4)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fabPulse 2.5s ease-in-out infinite',
          }}
          className="md:bottom-6"
        >
          {/* Insight badge */}
          {aiInsights.length > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -4,
              minWidth: 18, height: 18, borderRadius: 9,
              background: '#ef4444', color: 'white',
              fontSize: 10, fontWeight: 800,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px',
              boxShadow: '0 0 8px rgba(239,68,68,0.6)',
            }}>{aiInsights.length > 9 ? '9+' : aiInsights.length}</span>
          )}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
            <path d="M19 3v4"/>
            <path d="M21 5h-4"/>
          </svg>
        </button>
      )}
      {/* FAB keyframe */}
      <style>{`
        @keyframes fabPulse {
          0%, 100% { box-shadow: 0 4px 24px rgba(99,102,241,0.5), 0 0 0 0 rgba(99,102,241,0.4); }
          50% { box-shadow: 0 4px 32px rgba(99,102,241,0.7), 0 0 0 10px rgba(99,102,241,0); }
        }
        @keyframes rayRing {
          0% { transform: scale(0.7); opacity: 0.9; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes rayPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        @keyframes rayFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
      `}</style>
    </>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <LangProvider>
        <AuthProvider>
          <AppInner />
        </AuthProvider>
      </LangProvider>
    </ErrorBoundary>
  );
}
