/**
 * AdminPanel — Advanced SaaS Control Center
 * Only accessible to super-admin (almogavraham30@gmail.com)
 */
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import MorningPaymentsPanel from '../components/MorningPaymentsPanel';
import type { EngineId, EngineKind, EngineStatus } from '../lib/mediaEngines';
import type { EngineBudgets, ProviderId } from '../lib/engineBudgets';
import { PROVIDERS, PROVIDER_BY_ID, PRICE, CLIENT_MULTIPLIER, fmtMoney, loadEngineBudgets, setProviderLoaded, addEngineTokens, sumField } from '../lib/engineBudgets';
import { ENGINES, fetchEngineStatus, saveMediaKeys, testEngine } from '../lib/mediaEngines';
import {
  Users, Building2, TrendingUp, Shield, AlertTriangle, CheckCircle2,
  Clock, XCircle, RefreshCw, Search, BarChart3, Zap, Copy, ExternalLink,
  Trash2, Eye, Bell, Megaphone, Rocket, Settings2, ChevronRight,
  Activity, Crown, UserCheck, Mail, Phone, Hash, Sparkles, ToggleLeft,
  ToggleRight, Send, Plus, Archive, Globe, GitBranch, Package,
  ArrowUpRight, ArrowDownRight, Minus, X, Info, ChevronDown,
  KeyRound, AtSign, Unlink, Layers, Menu, DollarSign, LogIn, CreditCard,
} from 'lucide-react';
import {
  collection, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, where, setDoc, getDoc, onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db, auth, functions } from '../lib/firebase';
import { startImpersonation } from '../lib/adminImpersonation';
// TEMPORARY: one-off repair for the 24/8 import. Remove with the component.
import StatusRestoreTool from '../components/StatusRestoreTool';
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
type AdminTab = 'overview' | 'workspaces' | 'analytics' | 'users' | 'tokens' | 'payments' | 'features' | 'announcements' | 'releases' | 'system' | 'emails' | 'integrations';
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

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  previewText: string;
  updatedAt: string;
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const STATUS_CFG: Record<WorkspaceStatus, { label: string; color: string; bg: string; dot: string; style?: React.CSSProperties }> = {
  active:    { label: 'פעיל',   color: '', bg: '', dot: 'bg-emerald-400', style: { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.28)' } },
  trial:     { label: 'ניסיון', color: '', bg: '', dot: 'bg-blue-400',    style: { background: 'rgba(59,130,246,0.15)',  color: '#60a5fa', border: '1px solid rgba(59,130,246,0.28)'  } },
  pending:   { label: 'ממתין',  color: '', bg: '', dot: 'bg-amber-400',   style: { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.28)'  } },
  suspended: { label: 'מושהה', color: '', bg: '', dot: 'bg-red-400',     style: { background: 'rgba(239,68,68,0.15)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.28)'   } },
};

const PLAN_COLORS: Record<string, string> = {
  trial: '', basic: '', pro: '', enterprise: '',
};
const PLAN_COLOR_STYLES: Record<string, React.CSSProperties> = {
  trial:      { background: 'rgba(148,163,184,0.15)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.25)' },
  basic:      { background: 'rgba(56,189,248,0.15)',  color: '#38bdf8', border: '1px solid rgba(56,189,248,0.25)'  },
  pro:        { background: 'rgba(139,92,246,0.15)',  color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)'  },
  enterprise: { background: 'rgba(251,191,36,0.15)',  color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)'  },
};

const FEATURE_LABELS: Record<string, string> = {
  ai:       'עוזר AI',    kanban:   'פייפליין Kanban', deals:    'ניהול לקוחות',
  content:  'קריאייטיב', agents:   'סוכנים חכמים',   overview: 'דוחות',
  tasks:    'משימות',     team:     'ניהול צוות',
  workflows:    'בונה אוטומציות',
  integrations: 'אינטגרציות',
  'ai-studio':      'AI Studio',
  'email-agent':    'RAY SALES',
  'marketing-agent':'RAY MARKETING',
};

const PAGE_LABELS: Partial<Record<Page, string>> = {
  home:             'לוח בקרה',
  dashboard:        'לידים',
  kanban:           'פייפליין',
  deals:            'לקוחות פעילים',
  tasks:            'משימות',
  content:          'קריאייטיב',
  overview:         'דוחות',
  analytics:        'אנליטיקס',
  agents:           'סוכנים AI',
  workflows:        'בונה אוטומציות',
  integrations:     'אינטגרציות',
  ai:               'עוזר AI',
  'ai-studio':      'AI Studio',
  'email-agent':    'RAY SALES',
  'marketing-agent':'RAY MARKETING',
  settings:         'הגדרות',
  billing:          'מנוי ותשלום',
  team:             'ניהול צוות',
};

// Pages manageable per-plan (exclude 'admin' — always hidden from workspace users)
const MANAGED_PAGES: Page[] = [
  'home','dashboard','kanban','deals','tasks',
  'content','overview','analytics',
  'agents','workflows','integrations',
  'ai','ai-studio','email-agent','marketing-agent',
  'team','settings','billing',
];

const DEFAULT_PLAN_PAGES: PlanPages = {
  trial:      ['home','dashboard','kanban','tasks','ai','settings','billing'],
  basic:      ['home','dashboard','kanban','tasks','ai','overview','team','settings','billing','content'],
  pro:        ['home','dashboard','kanban','deals','tasks','ai','ai-studio','overview','analytics','team','settings','billing','content','agents','workflows','integrations','email-agent','marketing-agent'],
  enterprise: ['home','dashboard','kanban','deals','tasks','ai','ai-studio','overview','analytics','team','settings','billing','content','agents','workflows','integrations','email-agent','marketing-agent'],
};

const DEFAULT_FLAGS: FeatureFlags = {
  ai:               { trial: true,  basic: true,  pro: true,  enterprise: true  },
  kanban:           { trial: true,  basic: true,  pro: true,  enterprise: true  },
  deals:            { trial: true,  basic: true,  pro: true,  enterprise: true  },
  content:          { trial: false, basic: true,  pro: true,  enterprise: true  },
  agents:           { trial: false, basic: false, pro: true,  enterprise: true  },
  overview:         { trial: true,  basic: true,  pro: true,  enterprise: true  },
  tasks:            { trial: true,  basic: true,  pro: true,  enterprise: true  },
  team:             { trial: true,  basic: true,  pro: true,  enterprise: true  },
  workflows:        { trial: false, basic: false, pro: true,  enterprise: true  },
  integrations:     { trial: false, basic: false, pro: true,  enterprise: true  },
  'ai-studio':      { trial: false, basic: false, pro: true,  enterprise: true  },
  'email-agent':    { trial: false, basic: false, pro: true,  enterprise: true  },
  'marketing-agent':{ trial: false, basic: false, pro: true,  enterprise: true  },
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
  const { isDark, c } = useTheme();

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

  /* ── Email templates state ──────────────────────────────────────────────── */
  const [emailTemplates,   setEmailTemplates]   = useState<EmailTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [emailSaving,      setEmailSaving]       = useState(false);
  const [emailPreview,     setEmailPreview]      = useState(false);

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

  /* ── Email templates ────────────────────────────────────────────────────── */
  const seedDefaultTemplates = async () => {
    const welcomeHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ברוכים הבאים ל-RAY</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;direction:rtl;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);border-radius:20px 20px 0 0;padding:40px 40px 32px;text-align:center;">
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:16px;padding:12px 28px;margin-bottom:20px;">
            <span style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">RAY</span>
            <span style="font-size:12px;color:rgba(255,255,255,0.7);margin-right:8px;font-weight:500;">CRM</span>
          </div>
          <h1 style="margin:0;font-size:26px;font-weight:800;color:#ffffff;line-height:1.3;">ברוכים הבאים! 🚀</h1>
          <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.8);line-height:1.6;">המערכת שלך מוכנה — בואו נתחיל</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#1e293b;padding:40px;">

          <p style="margin:0 0 28px;font-size:15px;color:#cbd5e1;line-height:1.7;">היי,<br/><br/>אנחנו שמחים שהצטרפת ל-RAY! הנה כמה דברים שתוכל לעשות כבר עכשיו כדי להפיק את המקסימום מהמערכת.</p>

          <!-- Feature cards -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
            <tr>
              <td width="33%" style="padding:0 6px 0 0;vertical-align:top;">
                <div style="background:#0f172a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:20px;text-align:center;">
                  <div style="font-size:26px;margin-bottom:10px;">📋</div>
                  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#e2e8f0;">ניהול לידים</p>
                  <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">עקוב אחר כל ליד ממקור עד סגירה</p>
                </div>
              </td>
              <td width="33%" style="padding:0 3px;vertical-align:top;">
                <div style="background:#0f172a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:20px;text-align:center;">
                  <div style="font-size:26px;margin-bottom:10px;">🤖</div>
                  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#e2e8f0;">AI חכם</p>
                  <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">תובנות אוטומטיות לכל ליד</p>
                </div>
              </td>
              <td width="33%" style="padding:0 0 0 6px;vertical-align:top;">
                <div style="background:#0f172a;border:1px solid rgba(99,102,241,0.3);border-radius:14px;padding:20px;text-align:center;">
                  <div style="font-size:26px;margin-bottom:10px;">👥</div>
                  <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#e2e8f0;">ניהול צוות</p>
                  <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">שתף ועבוד יחד בזמן אמת</p>
                </div>
              </td>
            </tr>
          </table>

          <!-- Getting started checklist -->
          <div style="background:#0f172a;border:1px solid rgba(99,102,241,0.2);border-radius:14px;padding:24px;margin-bottom:32px;">
            <p style="margin:0 0 16px;font-size:14px;font-weight:700;color:#a78bfa;">✅ צ'קליסט התחלה מהירה</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="display:inline-block;width:20px;height:20px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:6px;margin-left:10px;vertical-align:middle;"></span>
                <span style="font-size:13px;color:#cbd5e1;vertical-align:middle;">הגדר פרופיל עסקי — שם, לוגו ותיאור</span>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="display:inline-block;width:20px;height:20px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:6px;margin-left:10px;vertical-align:middle;"></span>
                <span style="font-size:13px;color:#cbd5e1;vertical-align:middle;">הוסף את הלידים הראשונים שלך</span>
              </td></tr>
              <tr><td style="padding:8px 0;">
                <span style="display:inline-block;width:20px;height:20px;background:rgba(99,102,241,0.2);border:1px solid rgba(99,102,241,0.4);border-radius:6px;margin-left:10px;vertical-align:middle;"></span>
                <span style="font-size:13px;color:#cbd5e1;vertical-align:middle;">הגדר את הצוות שלך והענק גישות</span>
              </td></tr>
            </table>
          </div>

          <!-- CTA button -->
          <div style="text-align:center;">
            <a href="https://ray-crm-app.web.app" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:12px;letter-spacing:0.3px;">כנס למערכת &rarr;</a>
          </div>

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0f172a;border-radius:0 0 20px 20px;padding:24px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0 0 6px;font-size:12px;color:#475569;">RAY CRM &mdash; מערכת ניהול לידים חכמה</p>
          <p style="margin:0;font-size:11px;color:#334155;"><a href="#" style="color:#6366f1;text-decoration:none;">הסר מנוי</a> &nbsp;|&nbsp; <a href="#" style="color:#6366f1;text-decoration:none;">הגדרות מייל</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const newLeadHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>ליד חדש נכנס</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;direction:rtl;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#059669 0%,#10b981 100%);border-radius:20px 20px 0 0;padding:32px 40px;text-align:center;">
          <div style="font-size:40px;margin-bottom:12px;">🎯</div>
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">ליד חדש נכנס!</h1>
          <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">{{leadName}} ממתין לטיפול</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#1e293b;padding:36px 40px;">

          <div style="background:#0f172a;border:1px solid rgba(16,185,129,0.25);border-radius:14px;padding:24px;margin-bottom:28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:12px;color:#64748b;font-weight:600;">שם הליד</span><br/>
                <span style="font-size:15px;color:#e2e8f0;font-weight:700;">{{leadName}}</span>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:12px;color:#64748b;font-weight:600;">מקור</span><br/>
                <span style="font-size:14px;color:#cbd5e1;">{{leadSource}}</span>
              </td></tr>
              <tr><td style="padding:8px 0;">
                <span style="font-size:12px;color:#64748b;font-weight:600;">נציג מטפל</span><br/>
                <span style="font-size:14px;color:#cbd5e1;">{{agentName}}</span>
              </td></tr>
            </table>
          </div>

          <div style="text-align:center;">
            <a href="https://ray-crm-app.web.app" style="display:inline-block;background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:12px;">צפה בליד &rarr;</a>
          </div>

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0f172a;border-radius:0 0 20px 20px;padding:20px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:#334155;">RAY CRM &mdash; <a href="#" style="color:#6366f1;text-decoration:none;">הסר מנוי</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const newTaskHtml = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>משימה חדשה</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Segoe UI',Arial,sans-serif;direction:rtl;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#f59e0b 0%,#f97316 100%);border-radius:20px 20px 0 0;padding:32px 40px;text-align:center;">
          <div style="font-size:40px;margin-bottom:12px;">📌</div>
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;">משימה חדשה הוקצתה לך</h1>
          <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.85);">יש לך משימה חדשה ב-RAY</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#1e293b;padding:36px 40px;">

          <div style="background:#0f172a;border:1px solid rgba(245,158,11,0.25);border-radius:14px;padding:24px;margin-bottom:28px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:12px;color:#64748b;font-weight:600;">תיאור המשימה</span><br/>
                <span style="font-size:15px;color:#e2e8f0;font-weight:700;">{{taskDescription}}</span>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
                <span style="font-size:12px;color:#64748b;font-weight:600;">תאריך יעד</span><br/>
                <span style="font-size:14px;color:#fbbf24;">{{dueDate}}</span>
              </td></tr>
              <tr><td style="padding:8px 0;">
                <span style="font-size:12px;color:#64748b;font-weight:600;">הוקצה על ידי</span><br/>
                <span style="font-size:14px;color:#cbd5e1;">{{assignedBy}}</span>
              </td></tr>
            </table>
          </div>

          <div style="text-align:center;">
            <a href="https://ray-crm-app.web.app" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#f97316);color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 32px;border-radius:12px;">צפה במשימה &rarr;</a>
          </div>

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0f172a;border-radius:0 0 20px 20px;padding:20px 40px;text-align:center;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="margin:0;font-size:11px;color:#334155;">RAY CRM &mdash; <a href="#" style="color:#6366f1;text-decoration:none;">הסר מנוי</a></p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const defaults: EmailTemplate[] = [
      {
        id: 'welcome',
        name: 'ברוכים הבאים ל-RAY',
        subject: 'ברוכים הבאים! המערכת שלך מוכנה 🚀',
        previewText: 'כמה צעדים פשוטים כדי להתחיל',
        htmlBody: welcomeHtml,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'new_lead',
        name: 'ליד חדש נכנס',
        subject: '{{leadName}} נכנס כליד חדש 🎯',
        previewText: 'ליד חדש ממתין לטיפול',
        htmlBody: newLeadHtml,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'new_task',
        name: 'משימה חדשה',
        subject: 'משימה חדשה: {{taskDescription}}',
        previewText: 'יש לך משימה חדשה ב-RAY',
        htmlBody: newTaskHtml,
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const tmpl of defaults) {
      await setDoc(doc(db, 'emailTemplates', tmpl.id), tmpl);
    }
  };

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'emailTemplates'), snap => {
      const templates = snap.docs.map(d => ({ id: d.id, ...d.data() } as EmailTemplate));
      setEmailTemplates(templates);
      if (templates.length === 0) {
        seedDefaultTemplates();
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // 1. Save plan-pages template to system config
      await setDoc(doc(db, 'system', 'config'), { planPages: next }, { merge: true });
      setPlanPages(next);

      // 2. Propagate to every workspace that has NO custom page override
      //    (allowedPages === null/undefined → uses plan default)
      //    Batch writes in chunks of 400 to stay under Firestore's 500-op limit
      const nonCustom = workspaces.filter(w => !Array.isArray(w.allowedPages));
      if (nonCustom.length > 0) {
        const CHUNK = 400;
        for (let i = 0; i < nonCustom.length; i += CHUNK) {
          const b = writeBatch(db);
          nonCustom.slice(i, i + CHUNK).forEach(ws => {
            const pages = next[ws.plan as PlanKey] ?? next.trial;
            b.update(doc(db, 'workspaces', ws.id), { allowedPages: pages });
          });
          await b.commit();
        }
        toast(`דפי מסלול עודכנו ✓ — ${nonCustom.length} סביבות עובדו`, 'success');
      } else {
        toast('דפי מסלול עודכנו ✓', 'success');
      }
    } catch (e) { console.error(e); toast('שגיאה בשמירת דפי מסלול', 'error'); }
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
    { key: 'tokens',        label: 'טוקנים',           icon: Zap,        group: 'main' },
    { key: 'payments',      label: 'תשלומים',          icon: CreditCard, group: 'main' },
    { key: 'features',      label: 'תכונות',           icon: Settings2,  group: 'ops'  },
    { key: 'announcements', label: 'הודעות',           icon: Megaphone,  group: 'ops'  },
    { key: 'releases',      label: 'פרסום גרסאות',    icon: Rocket,     group: 'ops'  },
    { key: 'integrations',  label: 'אינטגרציות',      icon: KeyRound,   group: 'ops'  },
    { key: 'system',        label: 'מערכת',            icon: Globe,      group: 'ops'  },
    { key: 'emails',        label: 'מיילים',           icon: Mail,       group: 'ops'  },
  ] as { key: AdminTab; label: string; icon: React.ElementType; group: string }[];

  const currentTabLabel = NAV_ITEMS.find(n => n.key === tab)?.label ?? '';

  /* ─── UI ──────────────────────────────────────────────────────────────── */
  return (
    <div className="flex h-[calc(100vh-theme(spacing.16))] -m-4 md:-m-6 overflow-hidden admin-panel" dir="rtl" style={{ background: c.pageBg, backgroundImage: c.pageBgImage, backgroundSize: c.pageBgSize }}>

      {/* Mobile overlay backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Left sidebar nav ────────────────────────────────────────────── */}
      <aside className={`
        fixed md:relative inset-y-0 right-0 z-50 w-64 md:w-52 flex flex-col flex-shrink-0
        transform transition-transform duration-300 md:transform-none
        ${sidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}
      `} style={{ background: 'rgba(10,15,30,0.95)', borderLeft: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}>
        <div className="px-4 py-5 flex items-center justify-between" style={{ background: 'rgba(99,102,241,0.15)', borderBottom: '1px solid rgba(99,102,241,0.2)' }}>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1 transition-colors" style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={16} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Shield size={15} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-sm" style={{ color: 'white' }}>Admin Console</p>
              <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>Super Admin</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ key, label, icon: Icon }, idx, arr) => (
            <div key={key}>
              {/* Divider between groups */}
              {idx > 0 && arr[idx].group !== arr[idx-1].group && (
                <div className="my-2 mx-1" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />
              )}
              <button onClick={() => { setTab(key); setSidebarOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                style={tab === key
                  ? { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: 'white' }
                  : { color: 'rgba(255,255,255,0.45)' }}
                onMouseEnter={e => { if (tab !== key) { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.12)'; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.8)'; } }}
                onMouseLeave={e => { if (tab !== key) { (e.currentTarget as HTMLButtonElement).style.background = ''; (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.45)'; } }}>
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
        <div className="px-3 pb-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <SignupLinkButton onToast={toast} />
        </div>

        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={loadAll}
            className="w-full flex items-center justify-center gap-2 text-xs transition-colors"
            style={{ color: 'rgba(255,255,255,0.35)' }}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            רענן נתונים
          </button>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 py-3" style={{ background: 'rgba(10,15,30,0.9)', borderBottom: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Shield size={13} className="text-white" />
            </div>
            <span className="font-bold text-sm" style={{ color: 'white' }}>Admin Console</span>
            {currentTabLabel && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>· {currentTabLabel}</span>}
          </div>
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 rounded-lg transition-colors" style={{ color: 'rgba(255,255,255,0.4)' }}>
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
            {tab === 'tokens'        && <TokensTab workspaces={workspaces} onToast={toast} onRefresh={loadAll} />}
            {tab === 'features'      && <FeaturesTab flags={flags} onToggle={toggleFlag} onSave={saveFlags} saving={flagSaving} planPages={planPages} onTogglePage={togglePlanPage} onSavePlanPages={savePlanPages} planPagesSaving={planPagesSaving} planTokenAmounts={planTokenAmounts} onSavePlanTokenAmounts={savePlanTokenAmounts} tokenAmountsSaving={tokenAmountsSaving} />}
            {tab === 'announcements' && <AnnouncementsTab announcements={announcements} onRefresh={loadAll} onToast={toast} />}
            {tab === 'releases'      && <ReleasesTab releases={releases} workspaces={workspaces} onRefresh={loadAll} onToast={toast} />}
            {tab === 'payments'      && <MorningPaymentsPanel onToast={toast} />}
            {tab === 'integrations'  && <IntegrationsTab onToast={toast} />}
            {tab === 'system'        && <SystemTab workspaces={workspaces} onToast={toast} />}
            {tab === 'emails'        && (
              <div className="p-6 h-full flex flex-col">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h1 className="text-xl font-black" style={{ color: 'white' }}>תבניות מייל</h1>
                    <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>ערוך ותצוגה מקדימה של תבניות האימייל</p>
                  </div>
                </div>
                <div className="flex gap-5 flex-1 min-h-0">
                  {/* Template list */}
                  <div className="w-56 flex-shrink-0 space-y-2 overflow-y-auto">
                    <h3 className="font-bold text-sm mb-3" style={{ color: 'rgba(255,255,255,0.7)' }}>תבניות</h3>
                    {emailTemplates.length === 0 && (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>טוען תבניות...</p>
                    )}
                    {emailTemplates.map(tmpl => (
                      <button
                        key={tmpl.id}
                        onClick={() => { setSelectedTemplate({ ...tmpl }); setEmailPreview(false); }}
                        className="w-full text-right p-3 rounded-xl text-sm font-medium transition-all"
                        style={selectedTemplate?.id === tmpl.id
                          ? { background: 'rgba(99,102,241,0.25)', color: '#a78bfa', border: '1px solid rgba(99,102,241,0.5)' }
                          : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        {tmpl.name}
                      </button>
                    ))}
                  </div>

                  {/* Editor panel */}
                  {selectedTemplate ? (
                    <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto">
                      {/* Tab switcher + title */}
                      <div className="flex items-center gap-2 justify-between flex-shrink-0">
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEmailPreview(false)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={!emailPreview
                              ? { background: 'rgba(99,102,241,0.25)', color: '#a78bfa', border: '1px solid rgba(99,102,241,0.4)' }
                              : { color: 'rgba(255,255,255,0.4)', border: '1px solid transparent' }}>
                            עריכה
                          </button>
                          <button
                            onClick={() => setEmailPreview(true)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={emailPreview
                              ? { background: 'rgba(99,102,241,0.25)', color: '#a78bfa', border: '1px solid rgba(99,102,241,0.4)' }
                              : { color: 'rgba(255,255,255,0.4)', border: '1px solid transparent' }}>
                            תצוגה מקדימה
                          </button>
                        </div>
                        <h3 className="font-bold text-sm" style={{ color: 'white' }}>{selectedTemplate.name}</h3>
                      </div>

                      {!emailPreview ? (
                        <>
                          {/* Subject */}
                          <div className="flex-shrink-0">
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.45)' }}>נושא המייל</label>
                            <input
                              value={selectedTemplate.subject}
                              onChange={e => setSelectedTemplate(t => t ? { ...t, subject: e.target.value } : t)}
                              className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                            />
                          </div>

                          {/* Preview text */}
                          <div className="flex-shrink-0">
                            <label className="text-xs font-semibold mb-1 block" style={{ color: 'rgba(255,255,255,0.45)' }}>טקסט תצוגה מקדימה</label>
                            <input
                              value={selectedTemplate.previewText}
                              onChange={e => setSelectedTemplate(t => t ? { ...t, previewText: e.target.value } : t)}
                              className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
                            />
                          </div>

                          {/* HTML Body */}
                          <div className="flex-1 flex flex-col min-h-0">
                            <label className="text-xs font-semibold mb-1 block flex-shrink-0" style={{ color: 'rgba(255,255,255,0.45)' }}>HTML Body</label>
                            <textarea
                              value={selectedTemplate.htmlBody}
                              onChange={e => setSelectedTemplate(t => t ? { ...t, htmlBody: e.target.value } : t)}
                              rows={18}
                              className="w-full rounded-xl px-3 py-2.5 text-xs font-mono focus:outline-none resize-none flex-1"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', direction: 'ltr' }}
                            />
                          </div>

                          {/* Actions row */}
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <button
                              onClick={async () => {
                                if (!selectedTemplate) return;
                                setEmailSaving(true);
                                try {
                                  await setDoc(doc(db, 'emailTemplates', selectedTemplate.id), {
                                    ...selectedTemplate,
                                    updatedAt: new Date().toISOString(),
                                  });
                                  toast('תבנית נשמרה בהצלחה ✓', 'success');
                                } catch {
                                  toast('שגיאה בשמירת תבנית', 'error');
                                } finally {
                                  setEmailSaving(false);
                                }
                              }}
                              disabled={emailSaving}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity"
                              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', opacity: emailSaving ? 0.6 : 1 }}>
                              {emailSaving ? 'שומר...' : 'שמור תבנית'}
                            </button>
                            <button
                              onClick={() => {
                                copyText(selectedTemplate.htmlBody);
                                toast('HTML הועתק ללוח ✓', 'success');
                              }}
                              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                              <Copy size={13} />
                              העתק HTML
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 flex flex-col min-h-0 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                          <div className="px-3 py-2 text-xs flex-shrink-0" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
                            תצוגה מקדימה: {selectedTemplate.subject}
                          </div>
                          <iframe
                            srcDoc={selectedTemplate.htmlBody}
                            className="w-full flex-1"
                            style={{ minHeight: 520, border: 'none' }}
                            title="email preview"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <p style={{ color: 'rgba(255,255,255,0.25)' }}>בחר תבנית לעריכה</p>
                    </div>
                  )}
                </div>
              </div>
            )}
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
          <h1 className="text-xl font-black" style={{ color: 'white' }}>סקירה כללית</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>מבט על כל המערכת — {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <SignupLinkButton />
      </div>

      {/* Alerts row */}
      {(expiring.length > 0 || atRisk.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {expiring.length > 0 && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <AlertTriangle size={16} className="flex-shrink-0" style={{ color: '#fbbf24' }} />
              <div>
                <p className="font-bold text-sm" style={{ color: '#fbbf24' }}>{expiring.length} ניסיונות יפוגו בקרוב</p>
                <p className="text-xs" style={{ color: 'rgba(251,191,36,0.7)' }}>{expiring.map(w => w.name).join(', ')}</p>
              </div>
            </div>
          )}
          {atRisk.length > 0 && (
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
              <XCircle size={16} className="flex-shrink-0" style={{ color: '#f87171' }} />
              <div>
                <p className="font-bold text-sm" style={{ color: '#f87171' }}>{atRisk.length} סביבות בסיכון</p>
                <p className="text-xs" style={{ color: 'rgba(248,113,113,0.7)' }}>ציון בריאות נמוך מ-50</p>
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
        <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-xs font-semibold mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>הכנסה לפי תוכנית</p>
          <div className="space-y-2">
            {['enterprise','pro','basic','trial'].map(p => {
              const count = workspaces.filter(w => w.plan === p && w.status === 'active').length;
              const rev   = count * (PLAN_MRR[p] ?? 0);
              return (
                <div key={p} className="flex items-center justify-between text-xs">
                  <span className="px-2 py-0.5 rounded-full font-bold" style={PLAN_COLOR_STYLES[p] ?? { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>{p}</span>
                  <span style={{ color: 'rgba(255,255,255,0.45)' }}>{count} לקוחות</span>
                  <span className="font-bold" style={{ color: 'white' }}>₪{rev.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Chart + Status breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 30-day signups chart */}
        <div className="md:col-span-2 rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-sm" style={{ color: 'white' }}>הצטרפויות — 30 יום אחרונים</h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>סביבות עבודה חדשות ליום</p>
            </div>
            <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>+{newMonth} החודש</span>
          </div>
          <div className="flex items-end gap-0.5 h-24">
            {bars.map((v, i) => (
              <div key={i} className="flex-1 flex items-end">
                <div
                  className="w-full rounded-sm opacity-80 hover:opacity-100 transition-opacity"
                  style={{ height: `${(v / maxBar) * 100}%`, minHeight: v > 0 ? 4 : 0, background: 'linear-gradient(180deg,#818cf8,#6366f1)' }}
                  title={`${v} הצטרפויות`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
            <span>30 ימים אחורה</span>
            <span>היום</span>
          </div>
        </div>

        {/* Status breakdown */}
        <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <h2 className="font-bold text-sm mb-4" style={{ color: 'white' }}>פילוח סטטוס</h2>
          <div className="space-y-3">
            {(['active','trial','pending','suspended'] as WorkspaceStatus[]).map(s => {
              const count = workspaces.filter(w => w.status === s).length;
              const pct   = total ? Math.round(count / total * 100) : 0;
              return (
                <div key={s}>
                  <div className="flex justify-between text-xs mb-1">
                    <span style={{ color: 'rgba(255,255,255,0.55)' }}>{STATUS_CFG[s].label}</span>
                    <span className="font-semibold" style={{ color: 'white' }}>{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className={`h-full rounded-full ${STATUS_CFG[s].dot}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {expiring.length > 0 && (
            <div className="mt-4 rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }}>
              <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: '#fbbf24' }}>
                <AlertTriangle size={12} />
                {expiring.length} ניסיונות יפוגו בקרוב
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent workspaces with health score */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="font-bold text-sm" style={{ color: 'white' }}>הצטרפויות אחרונות</h2>
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{workspaces.length} סביבות סה״כ</span>
        </div>
        <div>
          {recent.map((w, idx) => {
            const hs  = healthScore(w);
            const hc  = healthColor(hs);
            return (
              <div key={w.id} className="flex items-center px-5 py-3 transition-colors" style={{ borderBottom: idx < recent.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = ''}>
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {w.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="mr-3 flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'white' }}>{w.name}</p>
                  <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{w.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Health score mini bar */}
                  <div className="flex items-center gap-1.5 w-20">
                    <div className="flex-1 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className={`h-full rounded-full ${hc.bar}`} style={{ width: `${hs}%` }} />
                    </div>
                    <span className={`text-[10px] font-bold ${hc.text}`}>{hs}</span>
                  </div>
                  <StatusBadge status={w.status} />
                  <span className="text-xs hidden md:block" style={{ color: 'rgba(255,255,255,0.3)' }}>{fmtDate(w.createdAt)}</span>
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
        <div className="px-6 py-4 flex flex-col md:flex-row gap-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(10,15,30,0.6)' }}>
          <div className="relative flex-1">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(255,255,255,0.35)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם, אימייל..."
              className="w-full rounded-xl pr-9 pl-3 py-2 text-sm focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }} />
          </div>
          <div className="flex gap-2">
            <select value={status} onChange={e => setStatus(e.target.value as WorkspaceStatus|'all')}
              className="rounded-xl px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
              <option value="all">כל הסטטוסים</option>
              {Object.entries(STATUS_CFG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={plan} onChange={e => setPlan(e.target.value)}
              className="rounded-xl px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
              <option value="all">כל התוכניות</option>
              {['trial','basic','pro','enterprise'].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={sort} onChange={e => setSort(e.target.value as 'createdAt'|'name')}
              className="rounded-xl px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
              <option value="createdAt">הכי חדש</option>
              <option value="name">לפי שם</option>
            </select>
          </div>
        </div>

        {/* Count */}
        <div className="px-6 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{filtered.length} סביבות עבודה</p>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-20" style={{ color: 'rgba(255,255,255,0.3)' }}>
              <Building2 size={32} className="mb-3 opacity-30" />
              <p className="text-sm">אין תוצאות</p>
            </div>
          ) : filtered.map(w => {
            const d = daysLeft(w.trialEndsAt);
            const expiring = w.status === 'trial' && d !== null && d <= 3 && d >= 0;
            const isSelected = selected?.id === w.id;
            return (
              <div key={w.id}
                onClick={() => onSelect(isSelected ? null : w)}
                className="flex items-center px-6 py-3.5 cursor-pointer transition-colors"
                style={{
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  background: isSelected ? 'rgba(99,102,241,0.1)' : undefined,
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)'; }}
                onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = ''; }}>
                {/* Logo / initial */}
                <div className="w-9 h-9 rounded-xl flex-shrink-0 overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-sm font-bold">
                  {w.logoUrl ? <img src={w.logoUrl} alt="" className="w-full h-full object-contain" /> : w.name?.[0]?.toUpperCase()}
                </div>
                <div className="mr-3 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate" style={{ color: 'white' }}>{w.name}</p>
                    {expiring && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: 'rgba(245,158,11,0.2)', color: '#fbbf24' }}>יפוג ב-{d} ימים</span>}
                  </div>
                  <p className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{w.email} · {fmtDate(w.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={PLAN_COLOR_STYLES[w.plan] ?? { background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>
                    {w.plan}
                  </span>
                  <StatusBadge status={w.status} />
                  <ChevronRight size={14} className={`transition-transform ${isSelected ? 'rotate-90' : ''}`} style={{ color: 'rgba(255,255,255,0.3)' }} />
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
    <aside className="fixed inset-0 z-50 flex flex-col overflow-hidden md:relative md:inset-auto md:z-auto md:w-80" style={{ background: 'rgba(10,15,30,0.97)', borderRight: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(20px)' }}>
      {/* Header */}
      <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white font-bold">
            {ws.logoUrl ? <img src={ws.logoUrl} alt="" className="w-full h-full object-contain" /> : ws.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-bold text-sm" style={{ color: 'white' }}>{ws.name}</p>
            <StatusBadge status={ws.status} />
          </div>
        </div>
        <button onClick={onClose} className="mt-0.5" style={{ color: 'rgba(255,255,255,0.3)' }}><X size={15} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Info */}
        <div className="px-5 py-4 space-y-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {ws.slug && (
            <div className="flex items-start gap-2">
              <span className="text-white/35 mt-0.5 flex-shrink-0"><Globe size={12} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>URL ייחודי</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-mono font-semibold truncate" style={{ color: '#818cf8' }}>/{ws.slug}</p>
                  <button onClick={() => { copyText(`https://${ws.slug}.ray-crm.com`); onToast('URL הועתק ✓', 'success'); }}
                    className="flex-shrink-0 transition-colors" style={{ color: 'rgba(255,255,255,0.25)' }}>
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
              <span className="mt-0.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}><Shield size={12} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>UID בעלים</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-[10px] font-mono truncate" style={{ color: 'rgba(255,255,255,0.6)' }}>{ws.ownerId}</p>
                  <button onClick={() => { copyText(ws.ownerId!); onToast('UID הועתק ✓', 'success'); }}
                    className="flex-shrink-0 transition-colors" style={{ color: 'rgba(255,255,255,0.25)' }}>
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
        <div className="px-5 py-4 space-y-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>סטטוס</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(['active','trial','pending','suspended'] as WorkspaceStatus[]).map(s => (
                <button key={s} onClick={() => onStatus(s)}
                  className="py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={ws.status===s ? (STATUS_CFG[s].style ?? {}) : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {STATUS_CFG[s].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>תוכנית</p>
            <div className="grid grid-cols-2 gap-1.5">
              {['trial','basic','pro','enterprise'].map(p => (
                <button key={p} onClick={() => onPlan(p)}
                  className="py-1.5 rounded-lg text-xs font-semibold transition-all capitalize"
                  style={ws.plan===p ? (PLAN_COLOR_STYLES[p] ?? {}) : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Page access control ──────────────────────────────────── */}
        <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              <Layers size={11} /> דפים מורשים
            </p>
            {isCustomPages && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.25)', color: '#818cf8' }}>מותאם אישית</span>
            )}
          </div>

          {/* Page toggles */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {MANAGED_PAGES.map(p => {
              const active = localPages.includes(p);
              return (
                <button key={p}
                  onClick={() => setLocalPages(prev => active ? prev.filter(x => x !== p) : [...prev, p])}
                  className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                  style={active
                    ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: '1px solid rgba(99,102,241,0.5)' }
                    : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {PAGE_LABELS[p] ?? p}
                </button>
              );
            })}
          </div>

          <div className="flex gap-1.5">
            <button onClick={handleSavePages} disabled={pagesSaving}
              className="flex-1 flex items-center justify-center gap-1 disabled:opacity-60 text-white py-1.5 rounded-lg text-[10px] font-bold transition-colors"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              {pagesSaving ? <RefreshCw size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
              שמור דפים
            </button>
            {isCustomPages && (
              <button onClick={handleResetPages} disabled={pagesSaving}
                className="flex items-center gap-1 disabled:opacity-60 py-1.5 px-2.5 rounded-lg text-[10px] font-bold transition-colors"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                איפוס למסלול
              </button>
            )}
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {isCustomPages ? `הגדרה ידנית · מסלול: ${ws.plan}` : `נגזר ממסלול: ${ws.plan}`}
          </p>
        </div>

        {/* AI Prompt */}
        {ws.prompt && (
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-xs font-semibold mb-2 flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.45)' }}><Sparkles size={11} /> הנחיות AI</p>
            <p className="text-xs leading-relaxed line-clamp-4" style={{ color: 'rgba(255,255,255,0.55)' }}>{ws.prompt}</p>
          </div>
        )}

        {/* Workspace links */}
        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
          <div>
            <p className="text-xs font-semibold text-white/45 mb-1.5 flex items-center gap-1">
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
            <p className="text-[10px] text-white/35 mt-1">הלקוח יראה שם חברה ולוגו בדף הכניסה</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-white/45 mb-1.5 flex items-center gap-1">
              <UserCheck size={11} /> קישור הזמנת חבר צוות
            </p>
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <p className="flex-1 text-xs text-white/60 truncate">{inviteLink}</p>
              <button onClick={() => { copyText(inviteLink); onToast('קישור הזמנה הועתק ✓', 'success'); }}
                className="text-white/35 hover:text-indigo-600 transition-colors flex-shrink-0">
                <Copy size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* Team members */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-white/45 mb-2 flex items-center gap-1.5">
            <Users size={11} /> חברי צוות ({members.length})
          </p>
          {membersLoad ? (
            <div className="flex items-center gap-2 text-xs text-white/35">
              <RefreshCw size={11} className="animate-spin" /> טוען...
            </div>
          ) : members.length === 0 ? (
            <p className="text-xs text-white/35">אין חברי צוות רשומים</p>
          ) : (
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-2 bg-white/5 rounded-lg px-2.5 py-1.5">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                    {(m.name?.[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white/75 truncate">{m.name}</p>
                    <p className="text-[10px] text-white/35 truncate">{m.email}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${m.role === 'מנהל' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-white/10 text-white/60'}`}>
                    {m.role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Token Balance ─────────────────────────────────────── */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-emerald-400 mb-3 flex items-center gap-1.5">
            <DollarSign size={11} /> מאזן טוקנים AI
          </p>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-emerald-50 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-emerald-600 font-medium mb-0.5">מאזן</p>
              <p className="text-xs font-bold text-emerald-400">{formatTokenDisplay(tokenBalance)}</p>
              <p className="text-[9px] text-emerald-600">{formatBalance(tokenBalance)}</p>
            </div>
            <div className="bg-white/5 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-white/45 font-medium mb-0.5">הקצאה</p>
              <p className="text-xs font-bold text-white/75">{formatBalance(tokenAllocation)}</p>
            </div>
            <div className="bg-white/5 rounded-lg px-2 py-2 text-center">
              <p className="text-[9px] text-white/45 font-medium mb-0.5">שומש</p>
              <p className="text-xs font-bold text-white/75">{formatBalance(tokenUsed)}</p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex justify-between text-[10px] text-white/45 mb-1">
              <span>{tokenPct}% נותר</span>
              <span>{formatBalance(tokenBalance)} מתוך {formatBalance(tokenAllocation)}</span>
            </div>
            <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
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
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
              dir="ltr"
            />
            <button
              onClick={handleManualTokens}
              disabled={manualLoad}
              className="flex items-center gap-1 bg-white/[0.06] hover:bg-white/[0.1] disabled:opacity-60 text-white/75 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors"
            >
              {manualLoad ? <RefreshCw size={10} className="animate-spin" /> : <Plus size={10} />}
              הוסף ידנית
            </button>
          </div>
          <p className="text-[10px] text-white/35 mt-1.5">
            תוכנית {ws.plan} · הקצאה מוגדרת: {formatBalance(planTokenAmount)}
          </p>
        </div>

        {/* Technical support tools */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-white/45 mb-2.5 flex items-center gap-1.5">
            <Settings2 size={11} /> כלי תמיכה טכנית
          </p>
          <div className="space-y-2">
            {/* One-off status repair — only for the workspace it applies to. */}
            {ws.id === 'ws_1VoQGpt3iyWkhcZoGIYxS4IA4KB2' && (
              <StatusRestoreTool workspaceId={ws.id} onToast={onToast} />
            )}

            {/* Enter the workspace as admin */}
            <button
              onClick={() => {
                if (!window.confirm(
                  `להיכנס לסביבת "${ws.name}" בתור אדמין?

` +
                  'תראה את המערכת בדיוק כפי שהלקוח רואה אותה, עם הנתונים שלו. ' +
                  'כל פעולה שתבצע תשפיע על הנתונים האמיתיים שלו.',
                )) return;
                startImpersonation(ws.id, ws.name);
                // Full reload so every workspace-scoped subscription re-runs
                // against the new id rather than half the app keeping the old one.
                window.location.href = '/';
              }}
              className="w-full flex items-center gap-2 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-400/30 text-indigo-300 text-xs font-bold px-3 py-2 rounded-lg transition-colors"
            >
              <LogIn size={12} />
              היכנס לסביבה בתור אדמין
            </button>

            {/* Password reset */}
            <button
              onClick={handlePasswordReset}
              disabled={resetLoad}
              className="w-full flex items-center gap-2 bg-blue-500/10 hover:bg-blue-100 border border-blue-200 text-blue-400 py-2 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
            >
              {resetLoad ? <RefreshCw size={12} className="animate-spin" /> : <Mail size={12} />}
              שלח איפוס סיסמה לבעלים
            </button>

            {/* Copy UID */}
            {ws.ownerId && (
              <button
                onClick={() => { copyText(ws.ownerId!); onToast('UID הועתק ✓', 'success'); }}
                className="w-full flex items-center gap-2 bg-white/5 hover:bg-white/[0.06] border border-white/10 text-white/75 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
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
                className="w-full flex items-center gap-2 bg-orange-500/10 hover:bg-orange-500/15 border border-orange-500/25 text-orange-400 py-2 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-60"
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
              className="w-full flex items-center gap-2 bg-white/5 hover:bg-white/[0.06] border border-white/10 text-white/60 py-2 px-3 rounded-xl text-xs font-semibold transition-colors"
            >
              <ExternalLink size={12} />
              מחק ידנית ב-Firebase Console
            </a>
          </div>
          <p className="text-[10px] text-white/35 mt-2">
            "שחרר אימייל" דורש Firebase Blaze plan. לחלופין — השתמש בקישור ה-Firebase Console למחיקה ידנית
          </p>
        </div>
      </div>

      {/* Delete workspace */}
      <div className="px-5 py-4 border-t border-slate-100">
        <button onClick={onDelete}
          className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-500/10 border border-red-500/20 py-2 rounded-xl text-xs font-semibold transition-colors">
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
    trial:      'bg-amber-100 text-amber-400',
    basic:      'bg-blue-100 text-blue-400',
    pro:        'bg-indigo-500/15 text-indigo-400',
    enterprise: 'bg-violet-500/15 text-violet-400',
  };
  const STATUS_DOT: Record<WorkspaceStatus, string> = {
    active:    'bg-emerald-500',
    trial:     'bg-amber-400',
    suspended: 'bg-red-500',
    pending:   'bg-white/25',
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
          <h1 className="text-xl font-black text-white/90">משתמשים</h1>
          <p className="text-white/45 text-sm mt-0.5">
            {workspaces.length} בעלי סביבה · {members.length} חברי צוות
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
            <Building2 size={12} /> {workspaces.length} בעלי סביבה
          </span>
          <span className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/60 text-xs font-semibold px-3 py-1.5 rounded-xl">
            <Users size={12} /> {members.length} חברי צוות
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם עסק, שם, אימייל..."
          className="w-full bg-white/5 border border-white/10 rounded-xl pr-9 pl-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 " />
      </div>

      {/* ── Workspace Owners ─────────────────────────────────────────────── */}
      {/* Always derived from workspaces collection — never misses an owner  */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Crown size={15} className="text-indigo-500" />
          <h2 className="font-bold text-white/75 text-sm">בעלי סביבות עבודה</h2>
          <span className="text-xs text-white/35 bg-white/[0.06] px-2 py-0.5 rounded-full">{filteredWorkspaces.length}</span>
        </div>

        {filteredWorkspaces.length === 0 ? (
          <div className="bg-white/5 rounded-2xl border border-white/10 py-10 text-center text-white/35 text-sm">
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
                <div key={ws.id} className="bg-white/5 border border-white/10 rounded-2xl p-4  hover:border-indigo-300 hover:shadow-md transition-all">
                  {/* Owner identity */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-sm font-black flex-shrink-0 ">
                      {ws.logoUrl
                        ? <img src={ws.logoUrl} alt="" className="w-full h-full rounded-xl object-cover" />
                        : initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      {displayName ? (
                        <>
                          <p className="font-bold text-white/90 text-sm leading-tight truncate">{displayName}</p>
                          <p className="text-xs text-white/45 truncate" dir="ltr">{ws.email}</p>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-white/90 text-sm leading-tight truncate" dir="ltr">{ws.email}</p>
                          <p className="text-[10px] text-white/35">שם לא זמין — פרופיל חסר</p>
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] bg-indigo-500/15 text-indigo-400 font-bold px-2 py-0.5 rounded-full">בעלים</span>
                      <span className={`text-[10px] font-bold ${hc.text}`}>{hc.label} {hs}</span>
                    </div>
                  </div>

                  {/* Workspace info card */}
                  <div className="bg-white/5 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[ws.status] ?? 'bg-white/25'}`} />
                        <span className="font-semibold text-white/90 text-sm truncate">{ws.name}</span>
                      </div>
                      <StatusBadge status={ws.status} />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/35">
                        {ws.createdAt ? new Date(ws.createdAt).toLocaleDateString('he-IL') : '—'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {ws.industry && (
                          <span className="text-[10px] text-white/45 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded-lg">
                            {ws.industry}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${PLAN_BADGE[ws.plan] ?? 'bg-white/[0.06] text-white/60'}`}>
                          {ws.plan}
                        </span>
                      </div>
                    </div>

                    {/* Health bar */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-white/10 rounded-full">
                        <div className={`h-full rounded-full ${hc.bar}`} style={{ width: `${hs}%` }} />
                      </div>
                      <span className="text-[10px] text-white/35">בריאות {hs}%</span>
                    </div>

                    {/* Missing profile warning */}
                    {!profile && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded-lg px-2 py-1">
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
            <Users size={15} className="text-white/45" />
            <h2 className="font-bold text-white/75 text-sm">חברי צוות</h2>
            <span className="text-xs text-white/35 bg-white/[0.06] px-2 py-0.5 rounded-full">{filteredMembers.length}</span>
          </div>

          <div className="bg-white/5 rounded-2xl border border-white/10  overflow-hidden">
            <div className="divide-y divide-slate-50">
              {filteredMembers.length === 0 ? (
                <div className="py-8 text-center text-white/35 text-sm">לא נמצאו חברי צוות</div>
              ) : filteredMembers.map(u => {
                const ws = u.workspaceId ? workspaces.find(w => w.id === u.workspaceId) : null;
                return (
                  <div key={u.uid} className="flex items-center px-5 py-3 hover:bg-white/5 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                      {(u.firstName?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="mr-3 flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white/90">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-white/45 truncate" dir="ltr">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {ws && (
                        <div className="text-xs text-white/60 bg-white/[0.06] px-2 py-1 rounded-lg truncate max-w-[110px]">
                          {ws.name}
                        </div>
                      )}
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        u.role === 'admin' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-white/[0.06] text-white/60'
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
   TAB: Tokens — Admin quota + per-workspace breakdown
══════════════════════════════════════════════════════════════════════════ */
function TokensTab({ workspaces, onToast, onRefresh }: {
  workspaces: WorkspaceProfile[];
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onRefresh: () => void;
}) {
  const [quota,        setQuota]        = useState<AdminQuota>({ totalBudget: 0, allocated: 0 });
  const [quotaLoading, setQuotaLoading] = useState(true);
  const [budgetInput,  setBudgetInput]  = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [addingTo,     setAddingTo]     = useState<string | null>(null);
  const [addAmount,    setAddAmount]    = useState('');
  const [addLoading,   setAddLoading]   = useState(false);
  const [resettingId,  setResettingId]  = useState<string | null>(null);
  const [search,       setSearch]       = useState('');

  useEffect(() => {
    getAdminQuota().then(q => { setQuota(q); setQuotaLoading(false); });
  }, []);

  /* ── Media-engine budgets (per provider) ───────────────────────────────── */
  const [engineBudgets, setEngineBudgets] = useState<EngineBudgets>({});
  const [loadedInput,   setLoadedInput]   = useState<Record<string, string>>({});
  const [grantWs,       setGrantWs]       = useState<string>('');
  const [grantProvider, setGrantProvider] = useState<ProviderId>('google');
  const [grantAmount,   setGrantAmount]   = useState('');
  const [grantBusy,     setGrantBusy]     = useState(false);
  useEffect(() => { void loadEngineBudgets().then(setEngineBudgets); }, []);

  const saveLoaded = async (provider: ProviderId) => {
    const amt = parseFloat(loadedInput[provider] ?? '');
    if (isNaN(amt) || amt < 0) return;
    await setProviderLoaded(provider, amt);
    setEngineBudgets(b => ({ ...b, [provider]: { loaded: amt, usedReal: b[provider]?.usedReal ?? 0 } }));
    setLoadedInput(i => ({ ...i, [provider]: '' }));
    onToast(`יתרת ${PROVIDER_BY_ID[provider].label} עודכנה ✓`, 'success');
  };

  const grantEngine = async () => {
    const amt = parseFloat(grantAmount);
    if (!grantWs || isNaN(amt) || amt <= 0) return;
    setGrantBusy(true);
    try {
      await addEngineTokens(grantWs, grantProvider, amt);
      onToast(`${fmtMoney(amt, PROVIDER_BY_ID[grantProvider].currency)} ${PROVIDER_BY_ID[grantProvider].label} נוספו ✓`, 'success');
      setGrantAmount('');
      onRefresh();
    } catch (e) { onToast(`שגיאה: ${(e as Error).message}`, 'error'); }
    finally { setGrantBusy(false); }
  };

  /* Real admin cost per workspace — virtual dollars ÷ 2 = real Anthropic cost */
  const realAdminCostForWs = (ws: WorkspaceProfile): number => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hist: any[] = (ws as any).tokenHistory ?? [];
    return hist.reduce((sum, e) => {
      if (!e || e.amount <= 0) return sum;
      // Every virtual dollar granted costs admin $0.50 real (2x markup)
      return sum + e.amount * 0.5;
    }, 0);
  };

  /* Total virtual dollars ever granted to a workspace */
  const tokensGranted = (ws: WorkspaceProfile): number => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hist: any[] = (ws as any).tokenHistory ?? [];
    return hist.reduce((sum, e) => (e?.amount > 0 ? sum + e.amount : sum), 0);
  };

  const handleSaveBudget = async () => {
    const amt = parseFloat(budgetInput);
    if (isNaN(amt) || amt < 0) return;
    setSavingBudget(true);
    try {
      await setAdminQuotaBudget(amt);
      setQuota(q => ({ ...q, totalBudget: amt }));
      onToast('יתרת Anthropic עודכנה ✓', 'success');
      setBudgetInput('');
    } finally { setSavingBudget(false); }
  };

  const handleAddTokens = async (ws: WorkspaceProfile) => {
    const amt = parseFloat(addAmount);
    if (isNaN(amt) || amt <= 0) return;
    setAddLoading(true);
    try {
      await addTokens(ws.id, amt, 'manual', 'Admin manual credit');
      deductFromAdminQuota(amt * 0.5).catch(console.error); // real cost = virtual / 2
      onToast(`${formatTokenDisplay(amt)} טוקנים נוספו ✓`, 'success');
      setAddingTo(null);
      setAddAmount('');
      onRefresh();
    } finally { setAddLoading(false); }
  };

  const handleResetTokens = async (ws: WorkspaceProfile) => {
    if (!window.confirm(`לאפס את כל הטוקנים של "${ws.name}"?`)) return;
    setResettingId(ws.id);
    try {
      await updateDoc(doc(db, 'workspaces', ws.id), {
        tokenBalance: 0, tokenUsed: 0, tokenPlanAllocation: 0, tokenHistory: [],
      });
      onToast(`טוקנים של ${ws.name} אופסו ✓`, 'success');
      onRefresh();
    } finally { setResettingId(null); }
  };

  // Real Anthropic balance = budget - REAL usage (not allocated virtual)
  const totalRealUsed      = workspaces.reduce((s, ws) => s + (ws.tokenUsed ?? 0), 0);
  const totalClientBalance = workspaces.reduce((s, ws) => s + (ws.tokenBalance ?? 0), 0);
  const totalGranted       = workspaces.reduce((s, ws) => s + tokensGranted(ws), 0);
  const totalMyRealCost    = workspaces.reduce((s, ws) => s + realAdminCostForWs(ws), 0);

  // Real remaining = what admin loaded into Anthropic minus actual API spending
  const realRemaining = Math.max(0, quota.totalBudget - totalRealUsed);
  const realRemainPct = quota.totalBudget > 0 ? Math.min(100, Math.round((realRemaining / quota.totalBudget) * 100)) : 100;
  const realUsedPct   = 100 - realRemainPct;

  // Tokens as count strings
  const remainingTokens = formatTokenCount(Math.round(realRemaining * 300_000));
  const usedTokens      = formatTokenCount(Math.round(totalRealUsed * 300_000));
  const clientTokens    = formatTokenCount(Math.round(totalClientBalance * 300_000));

  const sorted = [...workspaces]
    .filter(ws => !search || ws.name?.includes(search) || ws.email?.includes(search))
    .sort((a, b) => (b.tokenUsed ?? 0) - (a.tokenUsed ?? 0));

  // ── Exposure risk: if all client balances were used, can admin cover it?
  //
  // A customer's virtual dollar costs half a real one — the 50% margin the
  // top-up webhook charges against. Named rather than left as a bare /2, since
  // changing the margin has to change both places together.
  const REAL_COST_RATIO = 0.5;
  const maxExposure    = totalClientBalance * REAL_COST_RATIO; // real Anthropic cost if ALL virtual used
  const exposureRisk   = maxExposure - realRemaining; // positive = admin could run out
  const isAdminLow     = realRemaining < 2 || (quota.totalBudget > 0 && realRemainPct < 20);

  /**
   * What is left to give away, as opposed to what is left at Anthropic.
   *
   * `realRemaining` only falls when a customer *spends*, so granting a plan
   * changed nothing on screen and it was possible to keep handing out credit
   * that is already promised elsewhere. This falls the moment tokens are
   * granted — by purchase or by signup — which is the number to check before
   * granting more. It can go negative, and that is the point: it means more has
   * been promised than is held.
   */
  const freeToAllocate  = realRemaining - maxExposure;
  const committedTokens = formatTokenCount(Math.round(maxExposure * 300_000));
  const freeTokens      = formatTokenCount(Math.round(Math.max(0, freeToAllocate) * 300_000));

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">

      {/* ── ADMIN LOW-BALANCE ALERT BANNER ────────────────────────────────── */}
      {!quotaLoading && isAdminLow && (
        <div className="rounded-2xl px-5 py-4 flex items-start gap-4"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.2)' }}>
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-red-400 text-base">⚠️ יתרת Anthropic שלך נמוכה!</p>
            <p className="text-red-300/80 text-sm mt-1">
              נשאר לך <span className="font-black text-red-300">${realRemaining.toFixed(2)}</span> ({realRemainPct}%) מתוך ${quota.totalBudget.toFixed(2)} שטענת.
              {exposureRisk > 0 && (
                <span> הלקוחות שלך יכולים לצרוך עוד <span className="font-black">${exposureRisk.toFixed(2)}</span> ממך — טען כסף ב-Anthropic עכשיו.</span>
              )}
            </p>
            <a href="https://console.anthropic.com/settings/billing" target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold mt-2 text-red-300 hover:text-red-200 underline underline-offset-2">
              <ExternalLink size={11} /> פתח Anthropic Console → Billing
            </a>
          </div>
        </div>
      )}

      {/* ── EXPOSURE WARNING (when committed > available) ──────────────────── */}
      {!quotaLoading && exposureRisk > 0.5 && !isAdminLow && (
        <div className="rounded-2xl px-5 py-3.5 flex items-center gap-3"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-amber-300/90 text-sm">
            <span className="font-bold">שים לב:</span> אם כל הלקוחות ישתמשו בטוקנים שלהם, תצטרך עוד <span className="font-black text-amber-300">${exposureRisk.toFixed(2)}</span> ב-Anthropic.
            הלקוחות "קיבלו" טוקנים וירטואליים שעלותם האמיתית גבוהה מהיתרה הנוכחית שלך.
          </p>
        </div>
      )}

      {/* ── REAL BALANCE CARD ─────────────────────────────────────────────── */}
      <div className="rounded-2xl p-6" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
          {/* Left — main balance */}
          <div>
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-2">💳 יתרת Anthropic שלי — כסף אמיתי</p>
            <div className="flex items-end gap-3">
              <span className={`text-5xl font-black tabular-nums ${realRemaining > 3 ? 'text-emerald-400' : realRemaining > 1 ? 'text-amber-400' : 'text-red-400'}`}>
                {quotaLoading ? '...' : `$${realRemaining.toFixed(2)}`}
              </span>
              <div className="mb-1.5">
                <p className="text-white/40 text-xs">נשאר מתוך ${quota.totalBudget.toFixed(2)}</p>
                <p className="text-white/55 text-xs font-medium">{remainingTokens} טוקנים אמיתיים</p>
              </div>
            </div>
            <p className="text-white/35 text-xs mt-2">
              השתמשת ב-${totalRealUsed.toFixed(4)} ({realUsedPct}%) · {usedTokens} טוקנים בפועל
            </p>

            {/* The figure to check before granting more. The balance above only
                moves when a customer spends, so handing out a plan changed
                nothing on screen — and it was possible to keep promising credit
                that is already spoken for. */}
            <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <p className="text-white/40 text-[11px] font-semibold">כבר הובטח ללקוחות</p>
                <p className="text-amber-300 text-lg font-black tabular-nums">${maxExposure.toFixed(2)}</p>
                <p className="text-white/30 text-[10px]">{committedTokens} טוקנים</p>
              </div>
              <div>
                <p className="text-white/40 text-[11px] font-semibold">פנוי להקצאה</p>
                <p className={`text-lg font-black tabular-nums ${freeToAllocate > 2 ? 'text-emerald-400' : freeToAllocate > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  ${freeToAllocate.toFixed(2)}
                </p>
                <p className="text-white/30 text-[10px]">
                  {freeToAllocate < 0 ? 'הובטח יותר ממה שיש — טען ב-Anthropic' : `${freeTokens} טוקנים`}
                </p>
              </div>
            </div>
          </div>
          {/* Right — update budget */}
          <div className="flex flex-col gap-2 items-start sm:items-end">
            <p className="text-white/40 text-[11px] font-medium">עדכן לאחר טעינה ב-Anthropic Console</p>
            <div className="flex gap-2">
              <input
                type="number" min="0" step="0.01" placeholder="$0.00"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                className="w-28 bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-sm text-white/90 placeholder-white/25 focus:outline-none focus:border-violet-400 text-center"
                dir="ltr"
              />
              <button
                onClick={handleSaveBudget} disabled={savingBudget || !budgetInput}
                className="disabled:opacity-40 text-white text-sm font-bold px-4 py-2 rounded-xl transition-all hover:scale-105"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}
              >
                {savingBudget ? <RefreshCw size={14} className="animate-spin" /> : 'עדכן'}
              </button>
            </div>
            <p className="text-white/25 text-[10px]">console.anthropic.com → Billing → Credits</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-3 bg-white/5 border border-white/10 rounded-full overflow-hidden mb-2">
          <div
            className={`h-full rounded-full transition-all duration-700 ${realRemaining > 3 ? 'bg-emerald-500' : realRemaining > 1 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: `${realRemainPct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-white/35 mb-4" dir="ltr">
          <span>$0</span>
          <span>${(quota.totalBudget * 0.25).toFixed(2)}</span>
          <span>${(quota.totalBudget * 0.5).toFixed(2)}</span>
          <span>${(quota.totalBudget * 0.75).toFixed(2)}</span>
          <span>${quota.totalBudget.toFixed(2)}</span>
        </div>

        {/* Stats row — 4 cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)' }}>
            <p className="text-[10px] text-white/45 mb-1">🔥 שימוש AI אמיתי</p>
            <p className="text-base font-black text-rose-400">${totalRealUsed.toFixed(4)}</p>
            <p className="text-[10px] text-white/30">{usedTokens} טוקנים</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.18)' }}>
            <p className="text-[10px] text-white/45 mb-1">👥 יתרה אצל לקוחות</p>
            <p className="text-base font-black text-indigo-400">{clientTokens}</p>
            <p className="text-[10px] text-white/30">${totalClientBalance.toFixed(2)} וירטואלי</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.18)' }}>
            <p className="text-[10px] text-white/45 mb-1">💰 עלות אמיתית שלי</p>
            <p className="text-base font-black text-emerald-400">${totalMyRealCost.toFixed(2)}</p>
            <p className="text-[10px] text-white/30">הוקצה ÷ 2 (×2 מארק-אפ)</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.18)' }}>
            <p className="text-[10px] text-white/45 mb-1">📦 סה"כ הוקצה ללקוחות</p>
            <p className="text-base font-black text-amber-400">{formatTokenCount(Math.round(totalGranted * 300_000))}</p>
            <p className="text-[10px] text-white/30">${totalGranted.toFixed(2)} וירטואלי</p>
          </div>
        </div>
      </div>

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 text-[11px]" dir="rtl">
        <span className="flex items-center gap-1.5 text-white/50">
          <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
          יתרה (לקוח) = טוקנים וירטואליים שנשארו
        </span>
        <span className="flex items-center gap-1.5 text-white/50">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
          שימוש אמיתי = עלות Anthropic בפועל
        </span>
        <span className="flex items-center gap-1.5 text-white/50">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          עלות לי = וירטואלי ÷ 2 (מארק-אפ ×2)
        </span>
      </div>

      {/* ── MEDIA ENGINE METERS ─────────────────────────────────────────────
          One meter per provider, in the currency the operator pays it in.
          Imagen and Veo share the Google meter because they share the bill. */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.25)' }}>
        <div>
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">🎨 מנועי תמונות ווידאו — כסף אמיתי לפי ספק</p>
          <p className="text-white/35 text-[11px] mt-1">כל יצירה מחייבת את הלקוח ×2 מהמחיר האמיתי ומורידה את המחיר האמיתי מהמד. הלקוח לא יכול ליצור בלי יתרה בספק המתאים.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PROVIDERS.map(pv => {
            // A freshly set meter has `loaded` and no `usedReal` yet; without
            // the defaults the first render said "NaN₪".
            const raw = engineBudgets[pv.id];
            const b = { loaded: Number(raw?.loaded ?? 0), usedReal: Number(raw?.usedReal ?? 0) };
            const remaining = b.loaded - b.usedReal;
            const promised  = sumField(workspaces, 'engineBalances', pv.id) / CLIENT_MULTIPLIER;
            const free      = remaining - promised;
            const pct       = b.loaded > 0 ? Math.max(0, Math.min(100, Math.round((remaining / b.loaded) * 100))) : 0;
            const prices    = pv.engines.map(e => `${e}: ${fmtMoney(PRICE[e], pv.currency)}`).join(' · ');
            return (
              <div key={pv.id} className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${pv.color}40` }}>
                <div className="flex items-center justify-between">
                  <a href={pv.billingUrl} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-300 hover:underline">טעינה ↗</a>
                  <span className="font-bold text-sm" style={{ color: pv.color }}>{pv.label}</span>
                </div>
                <div className="flex items-end gap-2 justify-end">
                  <span className="text-[11px] text-white/40 mb-1">נשאר מתוך {fmtMoney(b.loaded, pv.currency)}</span>
                  <span className={`text-3xl font-black tabular-nums ${remaining > b.loaded * 0.3 ? 'text-emerald-400' : remaining > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                    {fmtMoney(remaining, pv.currency)}
                  </span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pv.color }} />
                </div>
                <div className="flex justify-between text-[10px] text-white/45">
                  <span>הובטח ללקוחות: {fmtMoney(promised, pv.currency)}</span>
                  <span className={free < 0 ? 'text-red-300 font-bold' : ''}>פנוי להקצאה: {fmtMoney(free, pv.currency)}</span>
                </div>
                <p className="text-[10px] text-white/30">מחיר אמיתי ליצירה — {prices}</p>
                <div className="flex gap-1.5 pt-1">
                  <input type="number" min="0" step="0.01" dir="ltr"
                    placeholder={`סה"כ טענת ב-${pv.currency === 'ILS' ? '₪' : '$'}`}
                    value={loadedInput[pv.id] ?? ''}
                    onChange={e => setLoadedInput(i => ({ ...i, [pv.id]: e.target.value }))}
                    className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-white/90 placeholder-white/25 focus:outline-none text-center" />
                  <button onClick={() => void saveLoaded(pv.id)} disabled={!loadedInput[pv.id]}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                    style={{ background: pv.color }}>עדכן</button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Grant engine credit to a workspace */}
        <div className="rounded-xl p-4 flex flex-wrap items-end gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[10px] text-white/45 mb-1">סביבת עבודה</label>
            <select value={grantWs} onChange={e => setGrantWs(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-lg px-2 py-2 text-xs text-white/90 focus:outline-none">
              <option value="">בחר סביבה…</option>
              {workspaces.map(w => <option key={w.id} value={w.id} style={{ color: '#111' }}>{w.name}</option>)}
            </select>
          </div>
          <div className="min-w-[170px]">
            <label className="block text-[10px] text-white/45 mb-1">ספק</label>
            <select value={grantProvider} onChange={e => setGrantProvider(e.target.value as ProviderId)}
              className="w-full bg-white/5 border border-white/15 rounded-lg px-2 py-2 text-xs text-white/90 focus:outline-none">
              {PROVIDERS.map(pv => <option key={pv.id} value={pv.id} style={{ color: '#111' }}>{pv.label} ({pv.currency})</option>)}
            </select>
          </div>
          <div className="w-28">
            <label className="block text-[10px] text-white/45 mb-1">סכום ללקוח ({PROVIDER_BY_ID[grantProvider].currency === 'ILS' ? '₪' : '$'})</label>
            <input type="number" min="0" step="0.5" dir="ltr" value={grantAmount} onChange={e => setGrantAmount(e.target.value)}
              className="w-full bg-white/5 border border-white/15 rounded-lg px-2 py-2 text-xs text-white/90 focus:outline-none text-center" />
          </div>
          <button onClick={() => void grantEngine()} disabled={grantBusy || !grantWs || !grantAmount}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#14b8a6,#0d9488)' }}>
            {grantBusy ? '…' : '➕ הוסף יתרת מנוע'}
          </button>
          <p className="w-full text-[10px] text-white/30">עלות אמיתית לך = מחצית מהסכום שהלקוח מקבל (מארק-אפ ×2), ורק כשהוא באמת יוצר.</p>
        </div>

        {/* Per-workspace engine balances */}
        {workspaces.some(w => w.engineBalances && Object.values(w.engineBalances).some(v => Number(v) > 0)) && (
          <div className="overflow-x-auto" dir="ltr">
            <table className="w-full text-xs" dir="rtl">
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                  <th className="text-right px-3 py-2 text-white/50 font-semibold">סביבה</th>
                  {PROVIDERS.map(pv => <th key={pv.id} className="text-center px-3 py-2 font-semibold" style={{ color: pv.color }}>{pv.label.split(' ')[0]}</th>)}
                </tr>
              </thead>
              <tbody>
                {workspaces.filter(w => w.engineBalances && Object.values(w.engineBalances).some(v => Number(v) > 0)).map(w => (
                  <tr key={w.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td className="px-3 py-2 text-white/80 font-semibold">{w.name}</td>
                    {PROVIDERS.map(pv => {
                      const bal = Number(w.engineBalances?.[pv.id] ?? 0);
                      const used = Number(w.engineUsed?.[pv.id] ?? 0);
                      return (
                        <td key={pv.id} className="px-3 py-2 text-center tabular-nums">
                          <span className={bal > 0 ? 'text-white/85 font-bold' : 'text-white/25'}>{fmtMoney(bal, pv.currency)}</span>
                          {used > 0 && <span className="block text-[9px] text-white/35">שימוש אמיתי {fmtMoney(used, pv.currency)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Workspace table ────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div>
            <h3 className="font-bold text-white/90 text-base">פירוט לפי סביבת עבודה</h3>
            <p className="text-xs text-white/40 mt-0.5">יתרה וירטואלית ללקוח · עלות אמיתית מ-Anthropic</p>
          </div>
          <input
            placeholder="חפש שם / מייל..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white/80 placeholder-white/25 focus:outline-none focus:border-indigo-400 w-52"
          />
        </div>

        <div className="overflow-x-auto" dir="ltr">
          <table className="w-full text-sm" dir="rtl">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th className="text-right px-4 py-3 text-white/50 text-xs font-semibold">סביבת עבודה</th>
                <th className="text-center px-3 py-3 text-white/50 text-xs font-semibold">תוכנית</th>
                <th className="text-center px-3 py-3 text-indigo-400 text-xs font-semibold">יתרה (לקוח)</th>
                <th className="text-center px-3 py-3 text-amber-400 text-xs font-semibold">שימוש (אמיתי)</th>
                <th className="text-center px-3 py-3 text-rose-400 text-xs font-semibold">עלות אמיתית לי</th>
                <th className="text-center px-3 py-3 text-white/50 text-xs font-semibold">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ws, idx) => {
                const used    = ws.tokenUsed ?? 0;
                const balance = ws.tokenBalance ?? 0;
                const granted = tokensGranted(ws);
                const myCost  = realAdminCostForWs(ws);
                const balPct  = granted > 0 ? Math.min(100, Math.round((balance / granted) * 100)) : 0;
                const isAdding    = addingTo === ws.id;
                const isResetting = resettingId === ws.id;

                return (
                  <tr key={ws.id}
                    className="transition-colors hover:bg-white/[0.03]"
                    style={{ borderTop: idx > 0 ? '1px solid rgba(255,255,255,0.04)' : undefined }}
                  >
                    {/* Name */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <div className="font-semibold text-white/85 text-sm">{ws.name || '—'}</div>
                        {balance <= 0.000001 && (
                          <span title="טוקנים נגמרו!" className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-red-300"
                            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                            ⚠️ ריק
                          </span>
                        )}
                        {balance > 0.000001 && balPct < 20 && (
                          <span title="טוקנים עומדים להיגמר" className="text-[10px] font-bold px-1.5 py-0.5 rounded-full text-amber-300"
                            style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
                            ⚡ נמוך
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-white/35 mt-0.5">{ws.email}</div>
                    </td>
                    {/* Plan */}
                    <td className="px-3 py-3.5 text-center">
                      <span className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                        style={PLAN_COLOR_STYLES[ws.plan ?? 'trial']}>
                        {ws.plan ?? 'trial'}
                      </span>
                    </td>
                    {/* Client virtual balance */}
                    <td className="px-3 py-3.5 text-center">
                      <div className={`font-bold text-sm ${balance > 0.05 ? 'text-indigo-300' : 'text-red-400'}`}>
                        {formatTokenCount(Math.round(balance * 300_000))}
                      </div>
                      <div className="text-[10px] text-white/40">${balance.toFixed(2)}</div>
                      <div className="w-20 mx-auto mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className={`h-full rounded-full transition-all ${balPct > 40 ? 'bg-indigo-400' : balPct > 15 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${balPct}%` }} />
                      </div>
                      <div className="text-[9px] text-white/30 mt-0.5">{balPct}% נותר</div>
                    </td>
                    {/* Real AI usage */}
                    <td className="px-3 py-3.5 text-center">
                      <div className="font-bold text-amber-300 text-sm">${used.toFixed(4)}</div>
                      <div className="text-[10px] text-white/35">{formatTokenCount(Math.round(used * 300_000))} טוקנים</div>
                    </td>
                    {/* My real cost (virtual ÷ 2) */}
                    <td className="px-3 py-3.5 text-center">
                      <div className="font-bold text-rose-300 text-sm">${myCost.toFixed(2)}</div>
                      <div className="text-[10px] text-white/35">הקצאה + שימוש</div>
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-3.5 text-center">
                      {isAdding ? (
                        <div className="flex items-center gap-1 justify-center">
                          <input
                            type="number" min="0.5" step="0.5" placeholder="$"
                            value={addAmount}
                            onChange={e => setAddAmount(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddTokens(ws)}
                            className="w-16 bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-white/85 text-center focus:outline-none focus:border-emerald-400"
                            autoFocus dir="ltr"
                          />
                          <button onClick={() => handleAddTokens(ws)} disabled={addLoading || !addAmount}
                            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors">
                            {addLoading ? '...' : '✓'}
                          </button>
                          <button onClick={() => { setAddingTo(null); setAddAmount(''); }}
                            className="text-white/30 hover:text-white/60 text-xs px-1.5 py-1.5">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 justify-center">
                          <button
                            onClick={() => { setAddingTo(ws.id); setAddAmount(''); }}
                            className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                            style={{ background: 'rgba(16,185,129,0.1)' }}
                          >
                            <Plus size={10} /> הוסף
                          </button>
                          <button
                            onClick={() => handleResetTokens(ws)}
                            disabled={isResetting}
                            className="text-[11px] font-bold text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg transition-colors"
                            style={{ background: 'rgba(239,68,68,0.08)' }}
                            title="אפס טוקנים"
                          >
                            {isResetting ? <RefreshCw size={10} className="animate-spin" /> : '↺'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-white/30 text-sm">
                    לא נמצאו סביבות עבודה
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5 text-xs font-semibold"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
          <span className="text-white/40">{sorted.length} סביבות</span>
          <span className="text-indigo-300">יתרה כוללת: {clientTokens} ({formatTokenCount(Math.round(totalClientBalance * 300_000))})</span>
          <span className="text-amber-300">שימוש AI: ${totalRealUsed.toFixed(4)}</span>
          <span className="text-rose-300">עלות כוללת לי: ${totalMyRealCost.toFixed(2)}</span>
        </div>
      </div>
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
  const [activeView, setActiveView] = useState<'unified'|'tokens'>('unified');

  // sync if parent changes
  useEffect(() => { setLocalTokenAmounts(planTokenAmounts); }, [planTokenAmounts]);

  const anyUnsaved = saving || planPagesSaving;

  // ── Plan badge style
  const planBadge = (p: PlanKey) => (
    <div key={p} className="text-center">
      <span className="text-xs font-black px-2.5 py-1 rounded-full" style={PLAN_COLOR_STYLES[p]}>{p}</span>
    </div>
  );

  // ── Groups for the unified table
  const GROUPS: { label: string; emoji: string; color: string; rows: { id: string; name: string; type: 'feature'|'page' }[] }[] = [
    {
      label: 'ניווט בסיסי', emoji: '🧭', color: 'text-sky-400',
      rows: [
        { id: 'home',      name: 'לוח בקרה',      type: 'page' },
        { id: 'dashboard', name: 'לידים',          type: 'page' },
        { id: 'kanban',    name: 'פייפליין',       type: 'page' },
        { id: 'deals',     name: 'לקוחות פעילים', type: 'page' },
        { id: 'tasks',     name: 'משימות',         type: 'page' },
      ],
    },
    {
      label: 'דוחות ונתונים', emoji: '📊', color: 'text-emerald-400',
      rows: [
        { id: 'overview',  name: 'דוחות',          type: 'page' },
        { id: 'analytics', name: 'אנליטיקס',       type: 'page' },
      ],
    },
    {
      label: 'תוכן ושיווק', emoji: '🎨', color: 'text-pink-400',
      rows: [
        { id: 'content',          name: 'קריאייטיב',       type: 'page' },
        { id: 'marketing-agent',  name: 'RAY MARKETING',      type: 'page' },
      ],
    },
    {
      label: 'סוכנים ואוטומציות', emoji: '🤖', color: 'text-violet-400',
      rows: [
        { id: 'ai',           name: 'עוזר AI',           type: 'page' },
        { id: 'ai-studio',    name: 'AI Studio',         type: 'page' },
        { id: 'email-agent',  name: 'RAY SALES',   type: 'page' },
        { id: 'agents',       name: 'סוכנים חכמים',     type: 'page' },
        { id: 'workflows',    name: 'בונה אוטומציות',   type: 'page' },
      ],
    },
    {
      label: 'אינטגרציות ופלטפורמות', emoji: '🔌', color: 'text-amber-400',
      rows: [
        { id: 'integrations', name: 'אינטגרציות',       type: 'page' },
      ],
    },
    {
      label: 'ניהול צוות', emoji: '👥', color: 'text-teal-400',
      rows: [
        { id: 'team', name: 'ניהול צוות', type: 'page' },
      ],
    },
    {
      label: 'מנוי והגדרות', emoji: '⚙️', color: 'text-slate-400',
      rows: [
        { id: 'settings', name: 'הגדרות',        type: 'page' },
        { id: 'billing',  name: 'מנוי ותשלום',  type: 'page' },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-5">

      {/* ── Header + tab switcher ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-white/90 flex items-center gap-2">
            <Layers size={20} className="text-indigo-400" /> תכונות, דפים ותוכניות
          </h1>
          <p className="text-white/45 text-sm mt-0.5">טבלה מאוחדת — שלוט בגישה לכל תכונה ודף לפי תוכנית</p>
        </div>
        <div className="flex gap-2 items-center">
          {/* view switcher */}
          <div className="flex bg-white/5 rounded-xl p-1 border border-white/10">
            {(['unified','tokens'] as const).map(v => (
              <button key={v} onClick={() => setActiveView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeView===v ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'}`}>
                {v === 'unified' ? '🗂️ תכונות ודפים' : '💰 טוקנים'}
              </button>
            ))}
          </div>
          {activeView === 'unified' && (
            <button onClick={async () => { await onSave(flags); await onSavePlanPages(planPages); }} disabled={anyUnsaved}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
              {anyUnsaved ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              שמור הכל
            </button>
          )}
          {activeView === 'tokens' && (
            <button onClick={() => onSavePlanTokenAmounts(localTokenAmounts)} disabled={tokenAmountsSaving}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors">
              {tokenAmountsSaving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              שמור הקצאות
            </button>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════
          VIEW: Unified features + pages table
      ══════════════════════════════════════════════════════════════ */}
      {activeView === 'unified' && (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="min-w-[560px] w-full border-collapse">
            {/* Sticky header */}
            <thead>
              <tr className="bg-white/8 border-b border-white/10">
                <th className="text-right px-5 py-3 text-xs font-black text-white/50 uppercase tracking-wider w-48">דף / תכונה</th>
                {PLANS.map(p => (
                  <th key={p} className="text-center px-3 py-3 text-xs font-black uppercase tracking-wider">
                    <span className="px-2.5 py-1 rounded-full text-[11px]" style={PLAN_COLOR_STYLES[p]}>{p}</span>
                  </th>
                ))}
                <th className="text-center px-3 py-3 text-xs font-black text-violet-400/80 uppercase tracking-wider w-24">גישה</th>
              </tr>
            </thead>
            <tbody>
              {GROUPS.map(({ label, emoji, color, rows }) => (
                <>
                  {/* Group header row */}
                  <tr key={`grp-${label}`} className="bg-white/3">
                    <td colSpan={6} className="px-5 py-2">
                      <span className={`text-[11px] font-black uppercase tracking-wider ${color}`}>{emoji} {label}</span>
                    </td>
                  </tr>
                  {rows.map(({ id, name }) => {
                    const pageOn  = (p: PlanKey) => (planPages[p] ?? []).includes(id as Page);
                    const featOn  = (p: PlanKey) => flags[id]?.[p] ?? false;
                    const hasFlag = id in flags;
                    return (
                      <tr key={id} className="border-b border-white/5 hover:bg-white/4 transition-colors group">
                        {/* Name */}
                        <td className="px-5 py-3">
                          <p className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{name}</p>
                          <p className="text-[10px] text-white/30 font-mono">{id}</p>
                        </td>
                        {/* Page toggle per plan */}
                        {PLANS.map(plan => (
                          <td key={plan} className="text-center px-3 py-3">
                            <div className="flex flex-col items-center gap-1">
                              {/* Page access */}
                              <button onClick={() => onTogglePage(id as Page, plan)}
                                title="גישה לדף"
                                className={`w-9 h-5 rounded-full transition-all relative ${pageOn(plan) ? 'bg-emerald-500' : 'bg-white/10'}`}>
                                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${pageOn(plan) ? 'right-0.5' : 'left-0.5'}`} />
                              </button>
                              {/* Feature flag (only if this id exists as a feature flag) */}
                              {hasFlag && (
                                <button onClick={() => onToggle(id, plan)}
                                  title="תכונה מופעלת"
                                  className={`w-7 h-3.5 rounded-full transition-all relative ${featOn(plan) ? 'bg-indigo-500' : 'bg-white/10'}`}>
                                  <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${featOn(plan) ? 'right-0.5' : 'left-0.5'}`} />
                                </button>
                              )}
                            </div>
                          </td>
                        ))}
                        {/* Legend */}
                        <td className="text-center px-3 py-3">
                          {hasFlag ? (
                            <div className="flex flex-col items-center gap-0.5 text-[9px] text-white/30">
                              <span className="text-emerald-400">● דף</span>
                              <span className="text-indigo-400">● תכונה</span>
                            </div>
                          ) : (
                            <span className="text-[9px] text-emerald-400/60">● דף</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info banner */}
      {activeView === 'unified' && (
        <div className="flex flex-col gap-2">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-400 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" /> <strong>ירוק (דף):</strong> הדף מופיע בניווט של הסביבה
          </div>
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-3 text-xs text-indigo-400 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-indigo-500 flex-shrink-0" /> <strong>סגול (תכונה):</strong> הפיצ'ר מופעל בקוד (רלוונטי לתכונות עם לוגיקה נוספת)
          </div>
          <div className="bg-blue-500/10 border border-blue-200 rounded-xl p-3 text-xs text-blue-400 flex items-start gap-2">
            <Info size={13} className="flex-shrink-0 mt-0.5" />
            <span>שמירה מעדכנת <strong>מיידית</strong> את כל הסביבות ללא הגדרה ידנית. סביבות עם "מותאם אישית" בפאנל הסביבה — לא יושפעו.</span>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════
          VIEW: Token allocations
      ══════════════════════════════════════════════════════════════ */}
      {activeView === 'tokens' && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-black text-white/90 flex items-center gap-2">
              <DollarSign size={18} className="text-emerald-400" /> טוקנים לפי תוכנית
            </h2>
            <p className="text-white/45 text-sm mt-0.5">הגדר כמה דולרים של טוקנים AI מקבלת כל תוכנית</p>
          </div>

          <div className="bg-white/5 rounded-2xl border border-white/10 overflow-hidden">
            <div className="grid grid-cols-4 px-5 py-3 border-b border-white/10">
              <div className="col-span-1 text-xs font-black text-white/45 uppercase tracking-wider">תוכנית</div>
              <div className="text-center text-xs font-black text-white/45 uppercase tracking-wider">הקצאת טוקנים ($)</div>
              <div className="text-center text-xs font-black text-white/45 uppercase tracking-wider">מטבע</div>
              <div className="text-center text-xs font-black text-white/45 uppercase tracking-wider">מחיר חודשי</div>
            </div>
            {PLANS.map(plan => (
              <div key={plan} className="grid grid-cols-4 px-5 py-4 border-b border-white/5 hover:bg-white/5 transition-colors items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black px-2.5 py-1 rounded-full" style={PLAN_COLOR_STYLES[plan]}>{plan}</span>
                </div>
                <div className="flex justify-center">
                  <input
                    type="number" min="0" step="1" dir="ltr"
                    value={localTokenAmounts[plan] ?? DEFAULT_PLAN_TOKEN_AMOUNTS[plan] ?? 0}
                    onChange={e => setLocalTokenAmounts(prev => ({ ...prev, [plan]: parseFloat(e.target.value) || 0 }))}
                    className="w-24 text-center bg-white/5 border border-white/10 rounded-xl px-2 py-1.5 text-sm font-semibold focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 text-white"
                  />
                </div>
                <div className="text-center text-xs text-white/45">USD</div>
                <div className="text-center text-xs font-bold text-white/60">
                  {plan === 'trial' ? 'חינם' : `$${PLAN_MRR[plan]}/חודש`}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-xs text-emerald-400 flex items-start gap-2">
            <Info size={14} className="flex-shrink-0 mt-0.5" />
            <p>ערכים אלו קובעים כמה דולרים של טוקנים AI מוקצים לכל סביבה עבור כל תוכנית. השינויים לא חלים אוטומטית — יש ללחוץ "הענק טוקני תוכנית" בפאנל הסביבה.</p>
          </div>
        </div>
      )}
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
    info:    'bg-blue-500/10 border-blue-300 text-blue-400',
    success: 'bg-emerald-50 border-emerald-300 text-emerald-400',
    warning: 'bg-amber-500/10 border-amber-300 text-amber-400',
  };
  const TYPE_LABEL = { info: 'מידע', success: 'הצלחה', warning: 'אזהרה' };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-black text-white/90">הודעות למשתמשים</h1>
        <p className="text-white/45 text-sm mt-0.5">הודעות שיוצגו כרצועת דגש בראש האפליקציה לפי קהל יעד — ניתן לסגור ע"י המשתמש</p>
      </div>

      {/* Create form */}
      <div className="bg-white/5 rounded-2xl border border-white/10  p-5 space-y-4">
        <h2 className="font-bold text-white/90 text-sm flex items-center gap-2"><Megaphone size={15} className="text-indigo-600" /> הודעה חדשה</h2>

        <div className="space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת ההודעה"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500" />
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="תוכן ההודעה..." rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 resize-none" />

          <div className="flex gap-3">
            <div className="flex-1">
              <p className="text-xs font-semibold text-white/45 mb-1.5">סוג</p>
              <div className="flex gap-2">
                {(['info','success','warning'] as const).map(t => (
                  <button key={t} onClick={() => setType(t)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${type===t ? TYPE_STYLE[t] : 'bg-white/5 text-white/45 border-white/10'}`}>
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-white/45 mb-1.5">קהל יעד</p>
              <div className="flex gap-2">
                {([['all','כולם'],['trial','ניסיון'],['active','פעילים']] as const).map(([v,l]) => (
                  <button key={v} onClick={() => setTarget(v)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${target===v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white/5 text-white/45 border-white/10'}`}>
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
          <div className="text-center py-10 text-white/35 text-sm bg-white/5 rounded-2xl border border-white/10">
            <Megaphone size={28} className="mx-auto mb-2 opacity-30" />
            אין הודעות פורסמו עדיין
          </div>
        ) : announcements.map(ann => (
          <div key={ann.id} className={`border rounded-2xl p-4 ${ann.active ? TYPE_STYLE[ann.type] : 'bg-white/5 border-white/10 opacity-60'}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="font-bold text-sm">{ann.title}</p>
                <p className="text-sm mt-0.5 opacity-80">{ann.body}</p>
                <div className="flex items-center gap-3 mt-2 text-xs opacity-70">
                  <span>{fmtDate(ann.createdAt)}</span>
                  <span>·</span>
                  <span>קהל: {ann.target === 'all' ? 'כולם' : ann.target}</span>
                  <span className={`font-bold ${ann.active ? 'text-emerald-400' : 'text-white/45'}`}>
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
          <h1 className="text-xl font-black text-white/90">פרסום גרסאות</h1>
          <p className="text-white/45 text-sm mt-0.5">
            פרסום עדכן את <strong>{clientCount}</strong> סביבות עבודה בבת-אחת — כולם על {' '}
            <span className="font-mono text-indigo-600">ray-crm.com</span>
          </p>
        </div>
        <button onClick={() => setShowGhSetup(s => !s)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${hasGithub ? 'bg-emerald-50 border-emerald-300 text-emerald-400' : 'bg-amber-500/10 border-amber-300 text-amber-400'}`}>
          <GitBranch size={12} />
          {hasGithub ? 'GitHub מחובר ✓' : 'חבר GitHub'}
        </button>
      </div>

      {/* Deploy status banner */}
      {deployStatus === 'running' && (
        <div className="bg-violet-50 rounded-2xl p-4 border border-violet-200 flex items-center gap-3">
          <RefreshCw size={16} className="animate-spin text-violet-600 flex-shrink-0" />
          <div>
            <p className="text-white/90 font-bold text-sm">פריסה בתהליך...</p>
            <p className="text-violet-600 text-xs mt-0.5">GitHub Actions בונה ומפרסם לכל הלקוחות</p>
          </div>
        </div>
      )}
      {deployStatus === 'done' && (
        <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-200 flex items-center gap-3">
          <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
          <div>
            <p className="text-white/90 font-bold text-sm">🎉 פריסה הופעלה בהצלחה!</p>
            <p className="text-emerald-600 text-xs mt-0.5">כל הלקוחות יקבלו את הגרסה החדשה תוך ~2 דקות</p>
          </div>
          <button onClick={() => setDeployStatus('idle')} className="mr-auto text-emerald-500 hover:text-emerald-400"><X size={14}/></button>
        </div>
      )}

      {/* GitHub Setup panel */}
      {showGhSetup && (
        <div className="bg-white/5 rounded-2xl border border-white/10  p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-white/90 text-sm flex items-center gap-2">
              <GitBranch size={15} className="text-white/60" /> הגדרות GitHub Actions
            </h2>
            <button onClick={() => setShowGhSetup(false)} className="text-white/35 hover:text-white/60"><X size={14}/></button>
          </div>

          <div className="bg-blue-500/10 border border-blue-200 rounded-xl p-3 text-xs text-blue-400 space-y-1">
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
              <label className="text-xs font-semibold text-white/45 block mb-1.5">GitHub Owner (שם משתמש / ארגון)</label>
              <input value={ghOwner} onChange={e => setGhOwner(e.target.value)} placeholder="username"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
            </div>
            <div>
              <label className="text-xs font-semibold text-white/45 block mb-1.5">Repository Name</label>
              <input value={ghRepo} onChange={e => setGhRepo(e.target.value)} placeholder="crm-app"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-white/45 block mb-1.5">Personal Access Token</label>
            <input value={ghToken} onChange={e => setGhToken(e.target.value)} type="password" placeholder="github_pat_..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
          </div>
          <button onClick={saveGithubConfig} disabled={ghSaving}
            className="flex items-center gap-2 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
            {ghSaving ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            שמור הגדרות
          </button>
        </div>
      )}

      {/* Create release */}
      <div className="bg-white/5 rounded-2xl border border-white/10  p-5 space-y-4">
        <h2 className="font-bold text-white/90 text-sm flex items-center gap-2"><Plus size={15} className="text-indigo-600" /> גרסה חדשה</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-white/45 block mb-1.5">מספר גרסה</label>
            <input value={version} onChange={e => setVersion(e.target.value)} placeholder="1.2.0"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 font-mono" dir="ltr" />
          </div>
          <div>
            <label className="text-xs font-semibold text-white/45 block mb-1.5">כותרת</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="שם הגרסה"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-white/45 block mb-1.5">מה חדש</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            placeholder="• תיאור השינוי הראשון&#10;• תיאור השינוי השני"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 resize-none" />
        </div>
        <button onClick={handleSaveDraft} disabled={saving}
          className="flex items-center gap-2 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
          {saving ? <RefreshCw size={14} className="animate-spin" /> : <Archive size={14} />}
          שמור טיוטה
        </button>
      </div>

      {/* Releases list */}
      <div className="space-y-3">
        {releases.length === 0 ? (
          <div className="text-center py-10 text-white/35 text-sm bg-white/5 rounded-2xl border border-white/10">
            <Package size={28} className="mx-auto mb-2 opacity-30" />
            אין גרסאות עדיין
          </div>
        ) : releases.map(rel => (
          <div key={rel.id} className={`bg-white/5 rounded-2xl border  p-5 ${rel.status === 'published' ? 'border-emerald-200' : 'border-white/10'}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg">v{rel.version}</span>
                  <span className="font-bold text-white/90 text-sm">{rel.title}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${rel.status === 'published' ? 'bg-emerald-100 text-emerald-400' : 'bg-amber-100 text-amber-400'}`}>
                    {rel.status === 'published' ? '✓ פורסם' : '⏸ טיוטה'}
                  </span>
                </div>
                {rel.notes && (
                  <pre className="text-xs text-white/60 font-sans whitespace-pre-wrap mt-2 leading-relaxed">{rel.notes}</pre>
                )}
                <p className="text-xs text-white/35 mt-2">
                  נוצר: {fmtDate(rel.createdAt)}
                  {rel.publishedAt && ` · פורסם: ${fmtDate(rel.publishedAt)}`}
                </p>
              </div>
              {rel.status === 'draft' && (
                <button onClick={() => handlePublish(rel)} disabled={deploying}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors mr-4 flex-shrink-0 disabled:opacity-60 text-white"
                  style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
                  {deploying ? <RefreshCw size={12} className="animate-spin" /> : <Rocket size={12} />}
                  {hasGithub ? 'פרסם אוטומטית 🚀' : 'פרסם'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Info box — how it works */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-xs text-white/60 space-y-1">
        <p className="font-bold text-white/75 flex items-center gap-1"><Info size={12}/> איך עובד הפרסום?</p>
        {hasGithub ? (
          <>
            <p>✅ GitHub Actions מחובר — לחיצה על "פרסם אוטומטית" תפעיל build ו-deploy ב-GitHub Actions</p>
            <p>• הגרסה תועלה לאתר <code className="bg-white/10 px-1 rounded">ray-crm.com</code> תוך ~2 דקות</p>
            <p>• <strong>כל {clientCount} הלקוחות</strong> יקבלו את העדכון אוטומטית בטעינה הבאה</p>
          </>
        ) : (
          <>
            <p>⚠️ GitHub Actions לא מוגדר — הפרסום שומר בFirestore אך לא מפרס קוד</p>
            <p>• לפריסה ידנית: <code className="bg-white/10 px-1 rounded">npm run build && firebase deploy --only hosting:client</code></p>
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
    trial: 'bg-white/25', basic: 'bg-sky-500', pro: 'bg-violet-500', enterprise: 'bg-amber-500',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-black text-white/90">אנליטיקס</h1>
        <p className="text-white/45 text-sm mt-0.5">ניתוח מעמיק של כל נתוני המערכת</p>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white/5 rounded-2xl border border-white/10 p-4  text-center">
          <p className="text-2xl font-black text-indigo-600">₪{mrrNow.toLocaleString()}</p>
          <p className="text-xs text-white/45 mt-1">MRR חודשי</p>
        </div>
        <div className="bg-white/5 rounded-2xl border border-white/10 p-4  text-center">
          <p className="text-2xl font-black text-emerald-600">{convRate}%</p>
          <p className="text-xs text-white/45 mt-1">שיעור המרה (trial→active)</p>
        </div>
        <div className="bg-white/5 rounded-2xl border border-white/10 p-4  text-center">
          <p className="text-2xl font-black text-white/90">{workspaces.length > 0 ? Math.round(mrrNow / Math.max(workspaces.filter(w=>w.status==='active').length,1)) : 0}</p>
          <p className="text-xs text-white/45 mt-1">₪ ARPU (ממוצע לחשבון)</p>
        </div>
        <div className="bg-white/5 rounded-2xl border border-white/10 p-4  text-center">
          <p className="text-2xl font-black text-amber-600">{atRisk}</p>
          <p className="text-xs text-white/45 mt-1">חשבונות בסיכון</p>
        </div>
      </div>

      {/* 12-month chart */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="font-bold text-white/90 text-sm">צמיחה — 12 חודשים אחרונים</h2>
            <p className="text-white/45 text-xs mt-0.5">סביבות עבודה חדשות לחודש</p>
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
              <span className="text-[10px] text-white/35">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Plan distribution + Industry breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Plan distribution */}
        <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
          <h2 className="font-bold text-white/90 text-sm mb-4">פילוח תוכניות</h2>
          <div className="space-y-3">
            {planDist.map(({ plan, count, pct }) => (
              <div key={plan}>
                <div className="flex justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${PLAN_COLORS_CHART[plan]}`} />
                    <span className="font-semibold capitalize text-white/75">{plan}</span>
                  </div>
                  <div className="flex items-center gap-2 text-white/45">
                    <span>{count} סביבות</span>
                    <span className="font-bold text-white/90">{pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-white/[0.06] rounded-full">
                  <div className={`h-full rounded-full ${PLAN_COLORS_CHART[plan]}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>

          {/* Donut-style visual (CSS approximation) */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs text-white/45 mb-2">הכנסה לפי תוכנית (MRR)</p>
            <div className="flex gap-2 flex-wrap">
              {planDist.map(({ plan, count }) => {
                const rev = count * (PLAN_MRR[plan] ?? 0);
                if (rev === 0) return null;
                return (
                  <div key={plan} className={`flex-1 min-w-[70px] rounded-xl p-2 text-center ${PLAN_COLORS[plan] ?? 'bg-white/[0.06] text-white/60'}`}>
                    <p className="text-xs font-black">₪{rev.toLocaleString()}</p>
                    <p className="text-[10px] capitalize">{plan}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Industry breakdown */}
        <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
          <h2 className="font-bold text-white/90 text-sm mb-4">פילוח לפי תחום עיסוק</h2>
          {industries.length === 0 ? (
            <p className="text-white/35 text-sm text-center py-6">אין נתוני תחום</p>
          ) : (
            <div className="space-y-3">
              {industries.map(([ind, count]) => {
                const pct = workspaces.length ? Math.round(count / workspaces.length * 100) : 0;
                return (
                  <div key={ind}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-white/75 font-medium truncate">{ind}</span>
                      <span className="text-white/45 flex-shrink-0 mr-2">{count} ({pct}%)</span>
                    </div>
                    <div className="h-1.5 bg-white/[0.06] rounded-full">
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
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <h2 className="font-bold text-white/90 text-sm mb-4">משפך המרה</h2>
        <div className="flex items-stretch gap-3">
          {[
            { label: 'נרשמו', count: workspaces.length,                  color: 'bg-indigo-100 border-indigo-300 text-indigo-800' },
            { label: 'ניסיון', count: totalTrials,                        color: 'bg-blue-100 border-blue-300 text-blue-400'    },
            { label: 'המירו',  count: converted,                          color: 'bg-emerald-100 border-emerald-300 text-emerald-400' },
            { label: 'Pro+',   count: workspaces.filter(w=>w.status==='active'&&(w.plan==='pro'||w.plan==='enterprise')).length, color: 'bg-violet-100 border-violet-300 text-violet-800' },
          ].map(({ label, count, color }, i, arr) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-2">
              <div className={`w-full border-2 rounded-2xl p-4 text-center ${color}`}>
                <p className="text-2xl font-black">{count}</p>
                <p className="text-xs font-semibold mt-0.5">{label}</p>
              </div>
              {i < arr.length - 1 && (
                <div className="flex items-center text-white/35 text-xs">
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
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <h2 className="font-bold text-white/90 text-sm mb-4">פילוח בריאות חשבונות</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-black text-emerald-400">{excellent}</p>
            <p className="text-xs font-semibold text-emerald-600 mt-0.5">בריאים (75+)</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-black text-amber-400">{moderate}</p>
            <p className="text-xs font-semibold text-amber-600 mt-0.5">בינוניים (50-74)</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-black text-red-400">{atRisk}</p>
            <p className="text-xs font-semibold text-red-600 mt-0.5">בסיכון (&lt;50)</p>
          </div>
        </div>
        {atRisk > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold text-white/45">חשבונות בסיכון:</p>
            {workspaces.filter(w => healthScore(w) < 50).map(w => (
              <div key={w.id} className="flex items-center justify-between bg-red-50 rounded-xl px-3 py-2">
                <span className="text-xs font-medium text-white/75">{w.name}</span>
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
/* ─── IntegrationsTab — media engines and their keys, admin-only ────────────
 * Keys are written through the saveMediaKeys callable into `system/mediaKeys`,
 * which no client can read (firestore.rules). This screen only ever learns
 * "configured: yes/no" per engine from mediaEngineStatus. The earlier design
 * kept keys in `system/apiKeys`, readable by every signed-in user — that doc
 * is still written for the marketing page's remaining direct calls, and goes
 * away when those move behind generateMedia too.
 * ──────────────────────────────────────────────────────────────────────── */

function IntegrationsTab({ onToast }: { onToast: (m:string,t?:'success'|'error'|'info')=>void }) {
  /*
   * Every image and video engine, in one place, with the operator's keys.
   *
   * Keys are written through a callable and held server-side; this screen
   * never receives a value back, only "configured: yes/no" per engine. That is
   * on purpose: the old design stored keys in a document every signed-in user
   * could read, and the browser called OpenAI with the raw key.
   *
   * Blank input = leave as is. So the admin can update one key without
   * retyping the rest, and a ✓ can be shown for a key this screen cannot see.
   */
  const [status,  setStatus]  = useState<EngineStatus | null>(null);
  const [draft,   setDraft]   = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [open,    setOpen]    = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try { setStatus(await fetchEngineStatus()); }
    catch (e) { onToast(`לא ניתן לקרוא את מצב המנועים: ${(e as Error).message}`, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  /**
   * Save. `only` restricts it to one engine's fields — the button inside each
   * card. The page-level button used to be the sole way to save and sat ~700px
   * below the field; a key pasted into a card and never scrolled past was
   * never saved, and the test button then ran against the old key.
   */
  const handleSave = async (only?: string[]) => {
    const keys: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (only && !only.includes(k)) continue;
      if (v.trim()) keys[k] = v.trim();
    }
    if (!Object.keys(keys).length) { onToast('לא הוזן מפתח חדש', 'info'); return; }
    setSaving(true);
    try {
      const { saved, cleaned } = await saveMediaKeys(keys);
      onToast(`נשמרו ${saved.length} מפתחות ✅ — לחץ "בדוק חיבור" כדי לוודא`, 'success');
      if (cleaned.length) onToast(`הוסרו תווים בלתי נראים מהמפתח (${cleaned.join(', ')}) — כנראה מהדבקה מדף בעברית`, 'info');
      setDraft(d => { const n = { ...d }; for (const k of saved) delete n[k]; return n; });
      setResults({});
      await load();
    } catch (e) { onToast(`שגיאה בשמירה: ${(e as Error).message}`, 'error'); }
    finally { setSaving(false); }
  };

  const handleTest = async (id: EngineId) => {
    // A key typed but not yet saved would be tested as the OLD key and reported
    // as rejected. Save the card's draft first, then test what is stored.
    const def = ENGINES.find(e => e.id === id);
    if (def && def.keyFields.some(f => (draft[f.name] ?? '').trim())) {
      await handleSave(def.keyFields.map(f => f.name));
    }
    setTesting(id);
    try {
      setResults(r => ({ ...r, [id]: { ok: false, message: '…' } }));
      const res = await testEngine(id);
      setResults(r => ({ ...r, [id]: res }));
    } catch (e) {
      setResults(r => ({ ...r, [id]: { ok: false, message: (e as Error).message } }));
    } finally { setTesting(null); }
  };

  // A key shared by two engines (Google → Imagen + Veo) is entered once.
  const seenKeys = new Set<string>();
  const KIND_LABEL: Record<EngineKind, string> = { image: 'מנועי תמונות', video: 'מנועי וידאו' };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-xl font-black text-white/90">אינטגרציות — מנועי תמונות ווידאו</h1>
        <p className="text-white/45 text-sm mt-0.5">
          מפתחות גלובליים, נשמרים בשרת בלבד. כל מנוע שמחובר כאן מופיע לבחירה בצ׳אט RAY Marketing של כל הסביבות.
        </p>
      </div>

      {loading && !status ? (
        <div className="flex items-center gap-2 text-white/50 text-sm py-4"><div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/70 animate-spin"/> טוען...</div>
      ) : (
        (['image', 'video'] as EngineKind[]).map(kind => (
          <section key={kind} className="space-y-3">
            <h2 className="text-sm font-black text-white/80">{KIND_LABEL[kind]}</h2>
            {ENGINES.filter(e => e.kind === kind).map(e => {
              const connected = status?.[e.id] ?? e.id === 'pollinations';
              const res = results[e.id];
              const isOpen = open === e.id;
              return (
                <div key={e.id} className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${connected ? `${e.color}55` : 'rgba(255,255,255,0.08)'}` }}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : e.id)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right">
                    <span className="flex items-center gap-2 flex-shrink-0">
                      {res && res.message !== '…' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={res.ok ? { background: 'rgba(16,185,129,0.15)', color: '#34d399' } : { background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                          {res.ok ? '✓ ' : '✗ '}{res.message}
                        </span>
                      )}
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full"
                        style={connected ? { background: `${e.color}22`, color: e.color } : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>
                        {connected ? 'מחובר' : 'לא מחובר'}
                      </span>
                      <span className="text-white/40 text-xs">{isOpen ? '▴' : '▾'}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold text-sm" style={{ color: e.color }}>{e.label} <span className="text-white/35 font-normal text-[11px]">· {e.vendor}</span></span>
                      <span className="block text-[11px] text-white/50 truncate">{e.bestFor}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[11px] text-white/55 mt-3"><span className="font-bold text-white/70">עלות: </span>{e.cost}</p>

                      <div className="rounded-xl p-3 space-y-1.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-black text-white/70">איך מחברים</span>
                          {e.keyUrl && <a href={e.keyUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-300 hover:underline">פתח את דף המפתחות ↗</a>}
                        </div>
                        <ol className="space-y-1 pr-4 list-decimal">
                          {e.steps.map((st, i) => <li key={i} className="text-[11px] text-white/65 leading-relaxed">{st}</li>)}
                        </ol>
                      </div>
                      {e.caveats?.length ? (
                        <ul className="space-y-1 pr-4 list-disc">
                          {e.caveats.map((c, i) => <li key={i} className="text-[10.5px] text-amber-200/70 leading-relaxed">{c}</li>)}
                        </ul>
                      ) : null}

                      {e.keyFields.map(f => {
                        const shared = seenKeys.has(f.name);
                        seenKeys.add(f.name);
                        return (
                          <div key={f.name} className="space-y-1">
                            <label className="text-[11px] font-bold" style={{ color: e.color }}>{f.label}{shared ? ' (משותף — כבר הוזן למעלה)' : ''}</label>
                            <div className="flex gap-2">
                              <input type="password" dir="ltr" autoComplete="off"
                                value={draft[f.name] ?? ''}
                                onChange={ev => setDraft(d => ({ ...d, [f.name]: ev.target.value }))}
                                placeholder={connected ? '•••••••• (שמור — הזן רק כדי להחליף)' : f.placeholder}
                                className="flex-1 rounded-xl px-3 py-2 text-sm outline-none font-mono"
                                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${draft[f.name] ? `${e.color}80` : 'rgba(255,255,255,0.1)'}`, color: 'white' }} />
                              {connected && !draft[f.name] && <span className="flex items-center px-2 text-emerald-400 text-sm">✓</span>}
                            </div>
                          </div>
                        );
                      })}

                      <div className="flex items-center gap-2 justify-end">
                        {e.keyFields.length > 0 && (
                          <button type="button"
                            onClick={() => void handleSave(e.keyFields.map(f => f.name))}
                            disabled={saving || !e.keyFields.some(f => (draft[f.name] ?? '').trim())}
                            className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-white disabled:opacity-40"
                            style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
                            {saving ? 'שומר…' : '💾 שמור מפתח'}
                          </button>
                        )}
                        {e.keyFields.length > 0 && (
                          <button type="button" onClick={() => void handleTest(e.id)} disabled={testing === e.id || saving || (!connected && !e.keyFields.some(f => (draft[f.name] ?? '').trim()))}
                            className="px-3 py-1.5 rounded-xl text-[11px] font-bold disabled:opacity-40"
                            style={{ background: `${e.color}22`, color: e.color, border: `1px solid ${e.color}55` }}>
                            {testing === e.id ? 'בודק…' : e.keyFields.some(f => (draft[f.name] ?? '').trim()) ? '💾 שמור ובדוק' : '🔌 בדוק חיבור'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))
      )}

      <section className="rounded-2xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-sm font-black text-white/80">כלים נוספים</h2>
        {[
          { name: 'heygen', label: 'HeyGen API Key', desc: 'אווטאר מדבר (HyperFrames). נשמר להמשך — אין עדיין יצירה מהצ׳אט.', placeholder: 'MjQ…', link: 'https://app.heygen.com/settings?nav=API' },
          { name: 'canva',  label: 'Canva Client ID', desc: 'ייצוא מצגות לקאנבה (Connect API).', placeholder: 'OC-…', link: 'https://www.canva.com/developers/' },
        ].map(f => (
          <div key={f.name} className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-white/70">{f.label}</label>
              <a href={f.link} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-300 hover:underline">קבל מפתח ↗</a>
            </div>
            <p className="text-[10px] text-white/40">{f.desc}</p>
            <input type="password" dir="ltr" autoComplete="off" value={draft[f.name] ?? ''}
              onChange={ev => setDraft(d => ({ ...d, [f.name]: ev.target.value }))}
              placeholder={f.placeholder}
              className="w-full rounded-xl px-3 py-2 text-sm outline-none font-mono"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }} />
          </div>
        ))}
      </section>

      <button type="button" onClick={() => void handleSave()} disabled={saving || !Object.values(draft).some(v => v.trim())}
        className="w-full py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ background: 'linear-gradient(135deg,#f59e0b,#d97706)' }}>
        {saving ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"/><span>שומר...</span></> : '💾 שמור מפתחות'}
      </button>
      <p className="text-[10px] text-center text-white/40">שדה ריק = המפתח הקיים נשאר. המפתחות לעולם לא נשלחים חזרה לדפדפן.</p>
    </div>
  );
}

function SystemTab({ workspaces, onToast }: { workspaces: WorkspaceProfile[]; onToast: (m:string,t?:'success'|'error'|'info')=>void }) {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [cfgLoading, setCfgLoading] = useState(true);

  // Broadcast system message state
  const [broadcastMsg,     setBroadcastMsg]     = useState('');
  const [broadcastTarget,  setBroadcastTarget]  = useState<'all'|'trial'|'active'>('all');
  const [broadcastSaving,  setBroadcastSaving]  = useState(false);
  const [clearingMsg,      setClearingMsg]      = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'system', 'config'))
      .then(snap => { if (snap.exists()) setConfig(snap.data()); })
      .catch(() => {})
      .finally(() => setCfgLoading(false));
  }, []);

  // Broadcast a system message to matching workspaces
  const handleBroadcast = async () => {
    if (!broadcastMsg.trim()) { onToast('הכנס טקסט הודעה', 'error'); return; }
    setBroadcastSaving(true);
    try {
      const targets = workspaces.filter(w => {
        if (broadcastTarget === 'all') return true;
        return w.status === broadcastTarget;
      });
      const CHUNK = 400;
      for (let i = 0; i < targets.length; i += CHUNK) {
        const b = writeBatch(db);
        targets.slice(i, i + CHUNK).forEach(ws => {
          b.update(doc(db, 'workspaces', ws.id), { systemMessage: broadcastMsg.trim() });
        });
        await b.commit();
      }
      setBroadcastMsg('');
      onToast(`הודעה נשלחה ל-${targets.length} סביבות ✓`, 'success');
    } catch { onToast('שגיאה בשליחת הודעה', 'error'); }
    finally { setBroadcastSaving(false); }
  };

  // Clear system message from all workspaces
  const handleClearAll = async () => {
    if (!window.confirm('לנקות את הודעת המערכת מכל הסביבות?')) return;
    setClearingMsg(true);
    try {
      const CHUNK = 400;
      for (let i = 0; i < workspaces.length; i += CHUNK) {
        const b = writeBatch(db);
        workspaces.slice(i, i + CHUNK).forEach(ws => {
          b.update(doc(db, 'workspaces', ws.id), { systemMessage: '' });
        });
        await b.commit();
      }
      onToast('הודעת מערכת נוקתה מכל הסביבות ✓', 'success');
    } catch { onToast('שגיאה בניקוי הודעה', 'error'); }
    finally { setClearingMsg(false); }
  };

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

  // Derived stats for quick overview
  const totalWs    = workspaces.length;
  const activeWs   = workspaces.filter(w => w.status === 'active').length;
  const trialWs    = workspaces.filter(w => w.status === 'trial').length;
  const withMsg    = workspaces.filter(w => !!w.systemMessage).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-black text-white/90">מערכת</h1>
        <p className="text-white/45 text-sm mt-0.5">ניהול, שידורים, מידע טכני וקישורים</p>
      </div>

      {/* Quick stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'סביבות סה״כ',   value: totalWs,  color: 'from-indigo-500 to-indigo-600',  icon: '🏢' },
          { label: 'פעילות',         value: activeWs, color: 'from-emerald-500 to-emerald-600', icon: '✅' },
          { label: 'בניסיון',        value: trialWs,  color: 'from-sky-500 to-sky-600',         icon: '⏱' },
          { label: 'עם הודעת מערכת', value: withMsg,  color: 'from-amber-500 to-amber-600',     icon: '📢' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="rounded-2xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-lg mx-auto mb-2`}>{icon}</div>
            <p className="text-2xl font-black text-white">{value}</p>
            <p className="text-xs text-white/45 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Broadcast system message ─────────────────────────────────────── */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)' }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-bold text-white/90 text-sm flex items-center gap-2">
              <Megaphone size={15} className="text-indigo-400" /> שידור הודעת מערכת
            </h2>
            <p className="text-xs text-white/45 mt-0.5">ההודעה תוצג כרצועת דגש בראש האפליקציה לכל הסביבות שנבחרו</p>
          </div>
          {withMsg > 0 && (
            <button onClick={handleClearAll} disabled={clearingMsg}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl disabled:opacity-60 transition-colors"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
              {clearingMsg ? <RefreshCw size={11} className="animate-spin" /> : <X size={11} />}
              נקה הודעה מכל {withMsg} הסביבות
            </button>
          )}
        </div>

        <div className="space-y-3">
          <textarea
            value={broadcastMsg}
            onChange={e => setBroadcastMsg(e.target.value)}
            rows={2}
            placeholder="הכנס הודעת מערכת לשידור (למשל: תחזוקה מתוכננת ב-...) ..."
            className="w-full rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(99,102,241,0.3)', color: 'white' }}
          />
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-1.5">
              {([['all','כל הסביבות'],['trial','ניסיון בלבד'],['active','פעילות בלבד']] as const).map(([v,l]) => (
                <button key={v} onClick={() => setBroadcastTarget(v)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                  style={broadcastTarget === v
                    ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white' }
                    : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={handleBroadcast} disabled={broadcastSaving || !broadcastMsg.trim()}
              className="flex items-center gap-2 disabled:opacity-50 text-white px-4 py-1.5 rounded-xl text-xs font-bold transition-colors mr-auto"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              {broadcastSaving ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
              שדר הודעה
            </button>
          </div>
        </div>

        {/* Active messages preview */}
        {withMsg > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-white/40">הודעות פעילות עכשיו:</p>
            {workspaces.filter(w => !!w.systemMessage).slice(0, 4).map(w => (
              <div key={w.id} className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span className="font-semibold text-white/70 truncate max-w-[100px]">{w.name}</span>
                <span className="text-white/35">·</span>
                <span className="text-white/50 truncate flex-1">{w.systemMessage}</span>
              </div>
            ))}
            {withMsg > 4 && <p className="text-[10px] text-white/30">ועוד {withMsg - 4} סביבות...</p>}
          </div>
        )}
      </div>

      {/* Deployment architecture — key banner */}
      <div className="rounded-2xl p-5 border border-violet-200" style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Rocket size={18} className="text-violet-600" />
          <p className="font-black text-sm text-white/90">ארכיטקטורת הפריסה</p>
        </div>
        <p className="text-white/60 text-sm leading-relaxed">
          כל הלקוחות משתמשים ב-<span className="font-mono bg-violet-100 border border-violet-200 px-1.5 py-0.5 rounded text-violet-700">*.ray-crm.com</span> — כל סביבת עבודה על תת-דומיין ייחודי משלה, מתוך <strong className="text-white/90">{workspaces.length}</strong> סביבות פעילות.
          פרסום גרסה חדשה (<code className="bg-violet-100 border border-violet-200 px-1 rounded text-violet-700">firebase deploy --only hosting</code>) מעדכן את <strong className="text-white/90">כולם בבת-אחת</strong> בטעינה הבאה.
        </p>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs ">
            <p className="text-white/45">גרסה נוכחית</p>
            <p className="font-mono font-bold text-white/90">{cfgLoading ? '...' : (latestVersion ?? 'לא הוגדר')}</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs ">
            <p className="text-white/45">פורסם לאחרונה</p>
            <p className="font-bold text-white/90">{cfgLoading ? '...' : (lastPublished ? fmtDate(lastPublished) : 'לא')}</p>
          </div>
          <div className={`rounded-xl px-3 py-2 text-xs border ${hasGithub ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-500/10 border-amber-200'}`}>
            <p className={hasGithub ? 'text-emerald-600' : 'text-amber-600'}>GitHub Actions</p>
            <p className={`font-bold ${hasGithub ? 'text-emerald-400' : 'text-amber-400'}`}>{hasGithub ? '✅ מחובר' : '⚠️ לא מוגדר'}</p>
          </div>
        </div>
      </div>

      {/* Deploy command quick-copy */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <h2 className="font-bold text-white/90 text-sm mb-3 flex items-center gap-2">
          <Package size={14} className="text-indigo-600" /> פקודות פריסה מהירה
        </h2>
        <div className="space-y-2">
          {[
            { label: 'פרסם Client בלבד (מעדכן כל הלקוחות)',     cmd: 'npm run build && firebase deploy --only hosting:client'    },
            { label: 'פרסם Cloud Functions (Blaze נדרש)',        cmd: 'firebase deploy --only functions'                          },
            { label: 'פרסם הכל',                                  cmd: 'npm run build && firebase deploy'                           },
          ].map(({ label, cmd }) => (
            <div key={cmd} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5">
              <code className="flex-1 text-xs text-white/90 font-mono" dir="ltr">{cmd}</code>
              <button
                onClick={() => { copyText(cmd); onToast('פקודה הועתקה ✓', 'success'); }}
                className="text-white/35 hover:text-indigo-600 flex-shrink-0 transition-colors"
              >
                <Copy size={13} />
              </button>
            </div>
          ))}
          <p className="text-[11px] text-white/35 mt-1">💡 הרץ מתיקיית הפרויקט <code className="bg-white/[0.06] px-1 rounded">crm-app/</code></p>
        </div>
      </div>

      {/* Live links */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <h2 className="font-bold text-white/90 text-sm mb-3 flex items-center gap-2">
          <Globe size={14} className="text-emerald-600" /> קישורים לאתרים
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {LIVE_LINKS.map(({ label, url, icon }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer"
              className="flex items-center gap-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl px-3 py-2.5 transition-colors">
              <span className="text-lg">{icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-white/90 truncate">{label}</p>
                <p className="text-[10px] text-white/45 truncate" dir="ltr">{url}</p>
              </div>
              <ExternalLink size={11} className="text-white/35 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Firebase Console links */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <h2 className="font-bold text-white/90 text-sm mb-3 flex items-center gap-2">
          <Zap size={14} className="text-amber-500" /> Firebase Console
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {FIREBASE_LINKS.map(({ label, url, icon }) => (
            <a key={url} href={url} target="_blank" rel="noreferrer"
              className="flex items-center gap-2.5 bg-white/5 hover:bg-amber-500/10 border border-white/10 hover:border-amber-200 rounded-xl px-3 py-2.5 transition-colors">
              <span>{icon}</span>
              <p className="text-xs font-medium text-white/75 flex-1 truncate">{label}</p>
              <ExternalLink size={11} className="text-white/35 flex-shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* Stuck Email Release Tool */}
      <StuckEmailTool onToast={onToast} workspaces={workspaces} />

      {/* Environment info */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-5 ">
        <h2 className="font-bold text-white/90 text-sm mb-3 flex items-center gap-2">
          <Info size={14} className="text-white/45" /> מידע סביבה
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
            <div key={label} className="bg-white/5 rounded-xl px-3 py-2.5">
              <p className="text-[10px] text-white/35 font-medium">{label}</p>
              <p className={`text-xs text-white/90 font-bold mt-0.5 ${mono ? 'font-mono' : ''}`} dir="ltr">{value}</p>
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
    <div className="bg-white/5 rounded-2xl border-2 border-orange-200 p-5 ">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-orange-500/15 flex items-center justify-center flex-shrink-0">
          <Unlink size={15} className="text-orange-600" />
        </div>
        <div>
          <h2 className="font-bold text-white/90 text-sm">שחרור אימייל תקוע</h2>
          <p className="text-xs text-white/45">מחק משתמש Auth שאין לו סביבת עבודה במערכת</p>
        </div>
      </div>

      {/* Explanation */}
      <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 mb-4 text-xs text-orange-400 space-y-1">
        <p className="font-bold">מתי זה קורה?</p>
        <p>כאשר מוחקים סביבת עבודה, הרשומות ב-Firestore נמחקות אך חשבון Firebase Auth נשאר.
        כתוצאה מכך, הרישום מחדש עם אותו אימייל נכשל עם "אימייל כבר קיים".</p>
      </div>

      {/* Email input row */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <AtSign size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setStatus('idle'); }}
            onKeyDown={e => e.key === 'Enter' && checkEmail()}
            placeholder="הכנס אימייל לבדיקה..."
            dir="ltr"
            className="w-full bg-white/5 border border-white/10 rounded-xl pr-9 pl-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-300"
          />
        </div>
        <button
          onClick={checkEmail}
          disabled={checking || !email.trim()}
          className="flex items-center gap-1.5 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors flex-shrink-0" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}
        >
          {checking ? <RefreshCw size={13} className="animate-spin" /> : <Search size={13} />}
          בדוק
        </button>
      </div>

      {/* Result */}
      {status === 'not-found' && (
        <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-xs text-emerald-400 font-semibold">
          <CheckCircle2 size={14} />
          האימייל אינו רשום ב-Firebase Auth — ניתן להשתמש בו לרישום חדש
        </div>
      )}

      {status === 'unknown' && (
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-xs text-white/60">
          <AlertTriangle size={14} className="text-amber-500" />
          לא ניתן לבדוק — בדוק ידנית ב-Firebase Console
        </div>
      )}

      {status === 'exists' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400 font-semibold">
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
              className="w-full flex items-center justify-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] text-white/75 py-2.5 px-4 rounded-xl text-xs font-bold transition-colors"
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
                className="w-full flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-400 py-2.5 px-4 rounded-xl text-xs font-bold transition-colors disabled:opacity-60"
              >
                {deleting ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                מחק Auth אוטומטית (דורש Firebase Blaze)
              </button>
            )}
          </div>

          {/* Step-by-step guide */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white/60 space-y-1.5">
            <p className="font-bold text-white/75">מחיקה ידנית — שלב אחר שלב:</p>
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
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={cfg.style ?? {}}>
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
  const trendColor = trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-500' : 'text-white/35';
  return (
    <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${colors[color]} flex items-center justify-center text-white`}>
          {icon}
        </div>
        <TrendIcon size={16} className={trendColor} />
      </div>
      <p className="text-2xl font-black" style={{ color: 'white' }}>{value}</p>
      <p className="text-xs font-medium mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</p>
      <p className="text-[10px] mt-1" style={{ color: 'rgba(255,255,255,0.3)' }}>{sub}</p>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium" style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</p>
        <p className="text-xs font-medium truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>{value}</p>
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
        className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-[11px] font-medium text-white/45 hover:text-white/75 hover:bg-white/[0.06] transition-all"
      >
        <ExternalLink size={11} />
        פתח בטאב חדש
      </button>
    </div>
  );
}
