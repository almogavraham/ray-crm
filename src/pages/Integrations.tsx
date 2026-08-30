import { useMemo, useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  Webhook, Copy, CheckCircle2, RefreshCw, Loader2,
  AlertTriangle, ExternalLink, TrendingUp, Users,
  Zap, Clock, ChevronDown, ChevronUp, ArrowUpRight,
  Shield, Activity, PlugZap, Link2, Link2Off, Eye, EyeOff, Save,
  Info, CheckCheck, ArrowRight, MessageCircle, Bot, Send, GitBranch,
  Mail, KeyRound, Sparkles, X, Plus, Globe,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { doc, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';
import type { Lead, WorkspaceProfile, TeamMember, MetaPage } from '../types';
import {
  PLATFORMS, loadSocialConnections, saveSocialConnection, deleteSocialConnection,
  openOAuthPopup, exchangeSocialToken, isConnectionValid,
} from '../lib/socialConnections';
import type { SocialConnection } from '../lib/socialConnections';
import { getAnthropicProxy } from '../lib/anthropicClient';
import GoogleAdsCampaigns from '../components/GoogleAdsCampaigns';
import { loadAgentConfig } from '../lib/gmailAgent';
import { oauthOriginsForDisplay } from '../lib/oauthOrigins';

interface Props {
  leads: Lead[];
  workspace: WorkspaceProfile;
  team: TeamMember[];
  currentUser: string;
  onLeadClick: (lead: Lead) => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate: () => Promise<void>;
}

const WEBHOOK_BASE = 'https://us-central1-chex-crm.cloudfunctions.net/leadsWebhook';
const META_OAUTH_URL = 'https://us-central1-chex-crm.cloudfunctions.net/metaOAuthCallback';
const META_SCOPES    = 'pages_show_list,pages_read_engagement,pages_manage_posts,ads_management,ads_read';

const STATUS_COLORS: Record<string, string> = {
  'חדש': '#6366f1', 'בתהליך': '#f97316', 'לקוח פעיל': '#10b981',
  'רימרקטינג': '#8b5cf6', 'לא רלוונטי': '#64748b',
};

// ─── Shared style helpers ────────────────────────────────────────────────────
const glass = {
  background:    'rgba(255,255,255,0.03)',
  border:        '1px solid rgba(255,255,255,0.07)',
  backdropFilter:'blur(8px)',
  borderRadius:  12,
  padding:       20,
};

/* ── Neon KPI Card ────────────────────────────────────────────────────────── */
function NeonKpiCard({ label, value, sub, icon: Icon, neon, percent }: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; neon: string; percent: number;
}) {
  const { c } = useTheme();
  return (
    <div className="rounded-xl p-4 transition-all duration-200 cursor-default"
      style={{ background:`linear-gradient(135deg,${neon}10,${neon}06)`, border:`1px solid ${neon}28`,
        backdropFilter:'blur(8px)', boxShadow:`0 2px 16px ${neon}12` }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow=`0 4px 32px ${neon}28,0 0 0 1px ${neon}48`; e.currentTarget.style.transform='translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow=`0 2px 16px ${neon}12`; e.currentTarget.style.transform='translateY(0)'; }}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-3xl font-black" style={{ color: c.textPrimary }}>{value}</div>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background:`${neon}18`, border:`1px solid ${neon}28` }}>
          <Icon size={16} style={{ color:neon }}/>
        </div>
      </div>
      <div className="text-sm font-bold" style={{ color: c.textSecondary }}>{label}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: c.textMuted }}>{sub}</div>}
      <div className="mt-3 h-1 rounded-full" style={{ background: c.subtleBg }}>
        <div className="h-full rounded-full" style={{ width:`${Math.min(percent,100)}%`,
          background:`linear-gradient(90deg,${neon}55,${neon})`, boxShadow:`0 0 6px ${neon}55` }}/>
      </div>
    </div>
  );
}

/* ── Step Badge ───────────────────────────────────────────────────────────── */
function StepBadge({ n, color, done }: { n: number; color: string; done?: boolean }) {
  return (
    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0"
      style={{ background: done ? `${color}30` : `${color}20`, color, border:`1px solid ${color}40` }}>
      {done ? <CheckCheck size={11}/> : n}
    </div>
  );
}

/* ── Platform Section ─────────────────────────────────────────────────────── */
function PlatformSection({ id, name, emoji, color, badge, leadCount, connected, children }: {
  id: string; name: string; emoji: string; color: string;
  badge?: string; leadCount: number; connected: boolean;
  children: React.ReactNode;
}) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false); // all integration sections start collapsed on entry

  return (
    <div style={{ ...glass, padding:0, overflow:'hidden',
      border:`1px solid ${connected ? color+'40' : 'rgba(255,255,255,0.07)'}` }}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 transition-all"
        style={{ background:`linear-gradient(135deg,${color}10,${color}05)` }}>
        <div className="flex items-center gap-3">
          {open
            ? <ChevronUp size={14} style={{ color: c.textMuted }}/>
            : <ChevronDown size={14} style={{ color: c.textMuted }}/>}
          <div className="flex items-center gap-2">
            {connected ? (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1"
                style={{ background:`rgba(16,185,129,0.12)`, border:'1px solid rgba(16,185,129,0.3)', color:'#10b981' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse"/> מחובר
              </span>
            ) : leadCount > 0 ? (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ background:`${color}15`, border:`1px solid ${color}35`, color }}>
                {leadCount} לידים
              </span>
            ) : badge ? (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                {badge}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-bold text-[14px]" style={{ color: c.textPrimary }}>{name}</p>
            {leadCount > 0 && !connected && (
              <p className="text-[10px]" style={{ color: c.textMuted }}>{leadCount} לידים התקבלו</p>
            )}
          </div>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
            style={{ background:`${color}15`, border:`1px solid ${color}25` }}>
            {emoji}
          </div>
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="p-5" style={{ borderTop:`1px solid rgba(255,255,255,0.06)` }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Code Block ───────────────────────────────────────────────────────────── */
function CodeBlock({ code, label, onCopy }: { code: string; label?: string; onCopy?: () => void }) {
  const { c } = useTheme();
  const [cp, setCp] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => { setCp(true); setTimeout(() => setCp(false), 2000); });
    onCopy?.();
  };
  return (
    <div className="rounded-xl overflow-hidden" dir="ltr" style={{ background:'rgba(0,0,0,0.35)', border:'1px solid rgba(99,102,241,0.2)' }}>
      {label && (
        <div className="px-3 py-1.5 flex items-center justify-between"
          style={{ borderBottom: `1px solid ${c.divider}`, background: c.subtleBg }}>
          <button onClick={copy} className="flex items-center gap-1.5 text-[10px] font-semibold transition-all"
            style={{ color: cp ? '#10b981' : 'rgba(255,255,255,0.4)' }}>
            {cp ? <CheckCircle2 size={10}/> : <Copy size={10}/>}
            {cp ? 'הועתק!' : 'העתק'}
          </button>
          <span className="text-[10px]" style={{ color: c.textMuted, fontFamily:'monospace' }}>{label}</span>
        </div>
      )}
      <pre className="p-3 text-[10px] leading-relaxed overflow-x-auto"
        style={{ color: c.accentText, direction:'ltr', fontFamily:'monospace', margin:0 }}>
        {code}
      </pre>
    </div>
  );
}

/* ── Info Banner ──────────────────────────────────────────────────────────── */
function InfoBanner({ text, color = '#f59e0b', icon: Icon = AlertTriangle }: {
  text: React.ReactNode; color?: string; icon?: React.ElementType;
}) {
  const { c } = useTheme();
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl"
      style={{ background:`${color}08`, border:`1px solid ${color}20` }}>
      <Icon size={13} style={{ color, flexShrink:0, marginTop:1 }}/>
      <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>{text}</p>
    </div>
  );
}

/* ── API Key Section ──────────────────────────────────────────────────────── */
function ApiKeySection({ webhookSecret, onToast }: {
  webhookSecret: string;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { c } = useTheme();
  const [showFull, setShowFull] = useState(false);

  if (!webhookSecret) return null;

  const masked = webhookSecret.length > 12
    ? webhookSecret.slice(0, 8) + '...' + webhookSecret.slice(-4)
    : webhookSecret.slice(0, 4) + '...';

  const handleCopyKey = () => {
    navigator.clipboard.writeText(webhookSecret).then(() => {
      onToast('API Key הועתק ✓', 'success');
    }).catch(() => {
      onToast('לא ניתן להעתיק', 'error');
    });
  };

  return (
    <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-bold" style={{ color: '#f59e0b' }}>🔑 API Key לחיבור Zapier</span>
        <span className="text-[10px]" style={{ color: c.textMuted }}>השתמש במפתח זה ב-Zapier לחיבור לידים חדשים</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(245,158,11,0.2)', fontFamily: 'monospace' }}>
        <p className="flex-1 text-[11px] truncate select-all" style={{ color: '#fbbf24', direction: 'ltr' }}>
          {showFull ? webhookSecret : masked}
        </p>
        <button
          onClick={() => setShowFull(v => !v)}
          className="flex items-center justify-center w-6 h-6 rounded transition-all flex-shrink-0"
          style={{ color: c.textMuted }}
          title={showFull ? 'הסתר מפתח' : 'הצג מפתח'}
        >
          {showFull ? <EyeOff size={12}/> : <Eye size={12}/>}
        </button>
        <button
          onClick={handleCopyKey}
          className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg flex-shrink-0 transition-all"
          style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}
        >
          <Copy size={11}/> העתק API Key
        </button>
      </div>
    </div>
  );
}

/* ── Email Section ────────────────────────────────────────────────────────── */
function EmailSection({ workspace, onToast, onWorkspaceUpdate }: {
  workspace: WorkspaceProfile;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate: () => Promise<void>;
}) {
  const { c } = useTheme();
  const cfg = workspace.emailConfig || {};
  const EMAIL_COLOR = '#6366f1';

  // ── Load OAuth accounts from EmailAgent ──────────────────────────────────
  const [agentAccounts, setAgentAccounts] = useState<{id: string; email: string; provider?: string}[]>([]);
  useEffect(() => {
    loadAgentConfig(workspace.id).then(agentCfg => {
      if (agentCfg?.accounts?.length) setAgentAccounts(agentCfg.accounts as {id: string; email: string; provider?: string}[]);
    }).catch(() => {});
  }, [workspace.id]);

  type EmailTab = 'gmail' | 'outlook' | 'emailjs' | 'oauth';
  const [tab, setTab] = useState<EmailTab>((cfg.provider as EmailTab) || 'gmail');

  // Gmail / Outlook state
  const [smtpEmail,       setSmtpEmail]       = useState(cfg.gmailUser || '');
  const [smtpPassword,    setSmtpPassword]    = useState('');
  const [smtpFromName,    setSmtpFromName]    = useState(cfg.fromName  || '');
  const [smtpPassSet,     setSmtpPassSet]     = useState(cfg.gmailAppPasswordSet || false);
  const [showPass,        setShowPass]        = useState(false);
  const [showSmtpGuide,   setShowSmtpGuide]   = useState(false);

  // EmailJS state
  const [ejsServiceId,    setEjsServiceId]    = useState(cfg.emailServiceId  || '');
  const [ejsTemplateId,   setEjsTemplateId]   = useState(cfg.emailTemplateId || '');
  const [ejsInviteTmpl,   setEjsInviteTmpl]  = useState(cfg.emailInviteTmpl || '');
  const [ejsPublicKey,    setEjsPublicKey]    = useState(cfg.emailPublicKey  || '');
  const [ejsFromName,     setEjsFromName]     = useState(cfg.fromName        || '');
  const [showEjsGuide,    setShowEjsGuide]    = useState(false);

  // OAuth (AI Agent inbox) state
  const [oauthClientId,   setOauthClientId]   = useState(cfg.oauthClientId || '');
  const [oauthProvider,   setOauthProvider]   = useState<'gmail' | 'outlook'>(cfg.oauthProvider || 'gmail');
  const [oauthSaving,     setOauthSaving]     = useState(false);
  const [oauthSaved,      setOauthSaved]      = useState(false);
  const [showOauthGuide,  setShowOauthGuide]  = useState(true);

  // Common state
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [saved,    setSaved]    = useState(false);

  // Determine if current provider is configured
  const isConfigured =
    tab === 'emailjs'
      ? !!(ejsServiceId && ejsPublicKey && ejsTemplateId)
      : !!(smtpEmail && smtpPassSet);

  const anyConnected = isConfigured || agentAccounts.length > 0;

  // ── Save handlers ────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      if (tab === 'emailjs') {
        if (!ejsServiceId || !ejsPublicKey || !ejsTemplateId) {
          onToast('מלא את כל שדות EmailJS', 'error'); setSaving(false); return;
        }
        await updateDoc(doc(db, 'workspaces', workspace.id), {
          'emailConfig.provider':       'emailjs',
          'emailConfig.emailServiceId': ejsServiceId.trim(),
          'emailConfig.emailTemplateId':ejsTemplateId.trim(),
          'emailConfig.emailInviteTmpl':ejsInviteTmpl.trim(),
          'emailConfig.emailPublicKey': ejsPublicKey.trim(),
          'emailConfig.fromName':       ejsFromName.trim(),
        });
      } else {
        // gmail or outlook
        if (!smtpEmail) { onToast('הכנס כתובת אימייל', 'error'); setSaving(false); return; }
        if (!smtpPassSet && !smtpPassword) { onToast('הכנס App Password', 'error'); setSaving(false); return; }

        const update: Record<string, unknown> = {
          'emailConfig.provider':      tab,
          'emailConfig.emailProvider': tab,
          'emailConfig.gmailUser':     smtpEmail.trim(),
          'emailConfig.fromName':      smtpFromName.trim(),
          'emailConfig.gmailAppPasswordSet': true,
        };
        if (smtpPassword) update['emailConfig.gmailAppPassword'] = smtpPassword;
        await updateDoc(doc(db, 'workspaces', workspace.id), update);
        setSmtpPassSet(true);
        setSmtpPassword('');
      }
      await onWorkspaceUpdate();
      setSaved(true);
      onToast('הגדרות אימייל נשמרו ✓', 'success');
      setTimeout(() => setSaved(false), 3000);
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setSaving(false); }
  };

  // ── Test send ────────────────────────────────────────────────────────────
  const handleTest = async () => {
    setTesting(true);
    try {
      if (tab === 'emailjs') {
        const emailjs = await import('@emailjs/browser');
        if (!ejsServiceId || !ejsTemplateId || !ejsPublicKey) throw new Error('EmailJS לא מוגדר');
        await emailjs.send(
          ejsServiceId,
          ejsTemplateId,
          { to_email: smtpEmail || workspace.id, subject: 'מייל בדיקה מ-RAY CRM', message: 'הגדרות האימייל פועלות כראוי ✓', from_name: ejsFromName || 'RAY CRM', to_name: 'Test' },
          { publicKey: ejsPublicKey },
        );
      } else {
        const { getFunctions: gf, httpsCallable: hc } = await import('firebase/functions');
        const fn = hc(gf(undefined, 'us-central1'), 'sendEmail');
        await fn({
          workspaceId: workspace.id,
          to:       smtpEmail,
          subject:  'מייל בדיקה מ-RAY CRM',
          htmlBody: '<div dir="rtl" style="font-family:Arial,sans-serif;padding:20px"><p>✅ הגדרות האימייל פועלות כראוי!</p><p style="color:#64748b;font-size:12px">נשלח מ-RAY CRM</p></div>',
          textBody: 'הגדרות האימייל פועלות כראוי ✓',
        });
      }
      onToast('מייל בדיקה נשלח! בדוק את תיבת הדואר ✓', 'success');
    } catch (e: unknown) {
      onToast(`שגיאה: ${(e as Error).message}`, 'error');
    } finally { setTesting(false); }
  };

  // ── Save OAuth client ID ────────────────────────────────────────────────
  const handleSaveOauth = async () => {
    if (!oauthClientId.trim()) { onToast('הכנס Client ID', 'error'); return; }
    setOauthSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        'emailConfig.oauthClientId': oauthClientId.trim(),
        'emailConfig.oauthProvider': oauthProvider,
      });
      if (onWorkspaceUpdate) onWorkspaceUpdate();
      setOauthSaved(true);
      onToast('Client ID נשמר ✓ — עבור לדף סוכן מכירות AI לסיום החיבור', 'success');
      setTimeout(() => setOauthSaved(false), 4000);
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setOauthSaving(false); }
  };

  const inputStyle = {
    background: c.subtleBg,
    border: `1px solid ${c.cardBorder}`,
    color: c.textPrimary,
  };

  const TABS: { key: EmailTab; label: string; emoji: string; sub: string }[] = [
    { key: 'gmail',   label: 'Gmail',   emoji: '📧', sub: 'חינמי · אמין · מומלץ' },
    { key: 'outlook', label: 'Outlook', emoji: '🔵', sub: 'Microsoft 365 / Exchange' },
    { key: 'emailjs', label: 'EmailJS', emoji: '⚡', sub: 'JavaScript · ללא שרת' },
    { key: 'oauth',   label: 'סוכן AI',  emoji: '🤖', sub: 'קריאת תיבת דואר' },
  ];

  const GMAIL_STEPS = [
    <span key="1">עבור ל-<a href="https://myaccount.google.com/security" target="_blank" rel="noreferrer" className="underline" style={{ color:'#818cf8' }}>myaccount.google.com/security</a></span>,
    <span key="2">ודא שאימות דו-שלבי <strong style={{ color: c.textPrimary }}>(2-Step Verification)</strong> מופעל</span>,
    <span key="3">חפש <strong style={{ color: c.textPrimary }}>"App passwords"</strong> (סיסמאות אפליקציה) בתפריט</span>,
    <span key="4">בחר <strong style={{ color: c.textPrimary }}>Mail</strong> כאפליקציה ← Other כמכשיר ← הכנס שם "RAY CRM"</span>,
    <span key="5">לחץ <strong style={{ color: c.textPrimary }}>Generate</strong> — תקבל סיסמה של 16 תווים</span>,
    <span key="6">העתק את הסיסמה והדבק בשדה App Password</span>,
  ];

  const OUTLOOK_STEPS = [
    <span key="1">עבור ל-<a href="https://account.microsoft.com/security" target="_blank" rel="noreferrer" className="underline" style={{ color:'#818cf8' }}>account.microsoft.com/security</a></span>,
    <span key="2">לחץ <strong style={{ color: c.textPrimary }}>Advanced security options</strong></span>,
    <span key="3">תחת App passwords ← לחץ <strong style={{ color: c.textPrimary }}>Create a new app password</strong></span>,
    <span key="4">הכנס שם "RAY CRM" ← לחץ Next</span>,
    <span key="5">תקבל סיסמה — העתק אותה (לא תוכל לראות שוב!)</span>,
    <span key="6">הדבק את הסיסמה בשדה App Password למעלה ולחץ שמור</span>,
  ];

  return (
    <PlatformSection id="email" name="חיבור אימייל" emoji="📨" color={EMAIL_COLOR}
      badge={anyConnected ? undefined : 'לא מוגדר'}
      leadCount={0} connected={anyConnected}>

      <div className="space-y-5">

        {/* ── Connected accounts from EmailAgent ── */}
        {agentAccounts.length > 0 && (
          <div className="rounded-xl p-4" style={{ background:`${EMAIL_COLOR}08`, border:`1px solid ${EMAIL_COLOR}28` }}>
            <p className="text-[12px] font-bold mb-3" style={{ color: c.textPrimary }}>✅ חשבונות מחוברים — סוכן מכירות AI</p>
            <div className="space-y-2">
              {agentAccounts.map(account => (
                <div key={account.id} className="flex items-center gap-2.5 p-2.5 rounded-lg"
                  style={{ background:`${EMAIL_COLOR}12`, border:`1px solid ${EMAIL_COLOR}20` }}>
                  <CheckCircle2 size={14} style={{ color:'#10b981', flexShrink:0 }}/>
                  <span className="text-sm font-semibold flex-1" style={{ color: c.textPrimary }}>{account.email}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.25)', color:'#10b981' }}>
                    {account.provider === 'gmail' ? 'Gmail OAuth' : account.provider === 'outlook' ? 'Outlook OAuth' : 'OAuth'}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[10px] mt-2.5" style={{ color: c.textMuted }}>
              חשבונות אלו מנוהלים בדף סוכן מכירות AI ← הגדרות ← חיבור מייל
            </p>
          </div>
        )}

        {/* Provider tabs */}
        <div className="grid grid-cols-4 gap-2">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="p-3 rounded-xl text-right transition-all"
              style={tab === t.key
                ? { background:`${EMAIL_COLOR}18`, border:`2px solid ${EMAIL_COLOR}50` }
                : { background: c.subtleBg, border:`2px solid rgba(255,255,255,0.07)` }}>
              <p className="text-[13px] font-bold mb-0.5" style={{ color: c.textPrimary }}>{t.emoji} {t.label}</p>
              <p className="text-[10px]" style={{ color: c.textMuted }}>{t.sub}</p>
            </button>
          ))}
        </div>

        {/* ── GMAIL / OUTLOOK (SMTP) ── */}
        {(tab === 'gmail' || tab === 'outlook') && (
          <div className="space-y-4">

            {/* How it works */}
            <div className="rounded-xl p-4" style={{ background:`${EMAIL_COLOR}08`, border:`1px solid ${EMAIL_COLOR}20` }}>
              <p className="text-[12px] font-bold mb-3" style={{ color: c.textPrimary }}>🔄 איך זה עובד</p>
              <div className="flex items-center gap-2 flex-wrap justify-center text-center">
                {[
                  { icon:'✏️', title:'כותב מייל', sub:'בתוך CRM' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'☁️', title:'שרת Firebase', sub:'קורא סיסמה בצורה מאובטחת' },
                  { icon:'→', title:'', sub:'' },
                  { icon: tab === 'outlook' ? '🔵' : '📧', title: tab === 'outlook' ? 'Office 365' : 'Gmail SMTP', sub:'שולח את המייל' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'📩', title:'מייל מגיע', sub:'ללקוח שלך' },
                ].map((s, i) => (
                  s.icon === '→'
                    ? <ArrowRight key={i} size={12} style={{ color: c.textMuted, flexShrink:0 }}/>
                    : <div key={i} className="flex flex-col items-center gap-0.5 min-w-[60px] text-center">
                        <span className="text-lg">{s.icon}</span>
                        <p className="text-[9px] font-bold" style={{ color: c.textPrimary }}>{s.title}</p>
                        <p className="text-[8px]" style={{ color: c.textMuted }}>{s.sub}</p>
                      </div>
                ))}
              </div>
            </div>

            {/* Fields */}
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>
                  {tab === 'outlook' ? 'כתובת Outlook / Microsoft' : 'כתובת Gmail'}
                  {smtpEmail && smtpPassSet && <span className="mr-2 text-[10px] font-normal text-emerald-400">✓ מחובר</span>}
                </label>
                <input
                  value={smtpEmail} onChange={e => setSmtpEmail(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                  style={inputStyle} type="email" dir="ltr"
                  placeholder={tab === 'outlook' ? 'yourname@outlook.com / yourname@company.com' : 'yourname@gmail.com'}
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>
                  App Password (סיסמת אפליקציה)
                  {smtpPassSet && <span className="mr-2 text-[10px] font-normal text-emerald-400">✓ שמורה</span>}
                </label>
                <div className="relative">
                  <input
                    value={smtpPassword} onChange={e => setSmtpPassword(e.target.value)}
                    type={showPass ? 'text' : 'password'}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none pr-10"
                    style={inputStyle} dir="ltr"
                    placeholder={smtpPassSet ? '••••••••••••••••  (לא ישתנה אלא אם תקליד חדש)' : 'xxxx xxxx xxxx xxxx'}
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
                    style={{ color: c.textSecondary }}>
                    {showPass ? <EyeOff size={14}/> : <Eye size={14}/>}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>שם השולח (From Name)</label>
                <input
                  value={smtpFromName} onChange={e => setSmtpFromName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none text-right"
                  style={inputStyle} placeholder="לדוגמה: RAY Digital Agency"
                />
              </div>
            </div>

            {/* Step-by-step guide */}
            <div className="rounded-xl overflow-hidden" style={{ border:`1px solid ${c.cardBorder}` }}>
              <button type="button" onClick={() => setShowSmtpGuide(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-right transition-colors"
                style={{ background: c.subtleBg }}>
                {showSmtpGuide
                  ? <ChevronUp size={15} style={{ color: c.textMuted }}/>
                  : <ChevronDown size={15} style={{ color: c.textMuted }}/>}
                <span className="text-[12px] font-semibold flex items-center gap-2" style={{ color: c.textSecondary }}>
                  <KeyRound size={13}/>
                  {tab === 'outlook'
                    ? '📋 איך יוצרים App Password ב-Microsoft?'
                    : '📋 איך יוצרים App Password ב-Google?'}
                </span>
              </button>
              {showSmtpGuide && (
                <div className="px-4 py-4 space-y-2" style={{ background:`${EMAIL_COLOR}04` }}>
                  <ol className="space-y-2">
                    {(tab === 'outlook' ? OUTLOOK_STEPS : GMAIL_STEPS).map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[11px]" style={{ color: c.textSecondary }}>
                        <StepBadge n={i+1} color={EMAIL_COLOR}/>
                        <span className="mt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <InfoBanner icon={Shield} color={EMAIL_COLOR}
                    text="הסיסמה מאוחסנת בצורה מאובטחת בשרת Firebase — לא נחשפת בצד הלקוח לעולם"/>
                  {tab === 'outlook' && (
                    <InfoBanner icon={Info} color="#f59e0b"
                      text="חשוב: App Passwords ב-Microsoft דורש הפעלת אימות דו-שלבי (MFA) בחשבון. אם אתה משתמש ב-Microsoft 365 Business, ייתכן שמנהל ה-IT צריך לאפשר App Passwords ברמת הארגון."/>
                  )}
                </div>
              )}
            </div>

            <InfoBanner icon={Info} color={EMAIL_COLOR}
              text={tab === 'outlook'
                ? 'Outlook / Office 365 תומכים ב-SMTP שליחה דרך smtp.office365.com:587 — ניתן להשתמש עם כתובות outlook.com, hotmail.com, וגם Microsoft 365 Business.'
                : 'Gmail מאפשר שליחת מיילים דרך SMTP עם App Password בלבד (לא עם הסיסמה הרגילה). גם חשבונות G Suite / Google Workspace נתמכים.'}
            />
          </div>
        )}

        {/* ── EMAILJS ── */}
        {tab === 'emailjs' && (
          <div className="space-y-4">
            {/* How it works */}
            <div className="rounded-xl p-4" style={{ background:'rgba(249,115,22,0.06)', border:'1px solid rgba(249,115,22,0.2)' }}>
              <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>⚡ EmailJS — שליחה ישירות מהדפדפן</p>
              <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
                EmailJS שולח מיילים ישירות מהדפדפן ללא שרת — מתאים כשאין App Password.
                שירות חינמי עד <strong style={{ color: c.textPrimary }}>200 מיילים בחודש</strong>, ואחרי כן עולה $4/חודש.
              </p>
            </div>

            {/* Setup steps */}
            <div className="space-y-2">
              <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>📋 הגדרה ב-EmailJS (5 דקות)</p>
              {[
                { n:1, title:'צור חשבון חינמי', body:<>כנס ל-<a href="https://www.emailjs.com" target="_blank" rel="noreferrer" className="underline" style={{ color:'#818cf8' }}>emailjs.com</a> ← לחץ "Sign Up Free"</> },
                { n:2, title:'הוסף Email Service', body:'Email Services ← Add New Service ← בחר Gmail / Outlook / SMTP. חבר את חשבון האימייל שלך. קבל Service ID.' },
                { n:3, title:'צור Email Template', body:'Email Templates ← Create New Template. הכנס תבנית מייל. חשוב: השדות {{to_email}}, {{subject}}, {{message}}, {{from_name}} חייבים להופיע בתבנית.' },
                { n:4, title:'צור Template הזמנות (אופציונלי)', body:'צור Template נוסף להזמנות לצוות עם השדות: {{to_email}}, {{invited_by}}, {{role}}, {{invite_link}}.' },
                { n:5, title:'קבל Public Key', body:'Account ← API Keys ← העתק את ה-Public Key (מתחיל בדרך כלל עם user_...)' },
              ].map(({ n, title, body }) => (
                <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}` }}>
                  <StepBadge n={n} color="#f97316"/>
                  <div>
                    <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Fields */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>Service ID</label>
                  <input value={ejsServiceId} onChange={e => setEjsServiceId(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={inputStyle} placeholder="service_xxxxxxx" dir="ltr"/>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>Public Key</label>
                  <input value={ejsPublicKey} onChange={e => setEjsPublicKey(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={inputStyle} placeholder="xxxxxxxxxxxxxxxxxxxx" dir="ltr"/>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>Template ID (מיילים כלליים)</label>
                  <input value={ejsTemplateId} onChange={e => setEjsTemplateId(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={inputStyle} placeholder="template_xxxxxxx" dir="ltr"/>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>Template ID (הזמנות לצוות)</label>
                  <input value={ejsInviteTmpl} onChange={e => setEjsInviteTmpl(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={inputStyle} placeholder="template_xxxxxxx (אופציונלי)" dir="ltr"/>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>שם השולח (From Name)</label>
                <input value={ejsFromName} onChange={e => setEjsFromName(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none text-right"
                  style={inputStyle} placeholder="לדוגמה: RAY Digital Agency"/>
              </div>
            </div>

            {/* Template variables reference */}
            <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(249,115,22,0.2)' }}>
              <button type="button" onClick={() => setShowEjsGuide(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 transition-colors"
                style={{ background: c.subtleBg }}>
                {showEjsGuide ? <ChevronUp size={14} style={{ color: c.textMuted }}/> : <ChevronDown size={14} style={{ color: c.textMuted }}/>}
                <span className="text-[12px] font-semibold" style={{ color: c.textSecondary }}>📝 משתני תבנית — מה להכניס ב-EmailJS Template</span>
              </button>
              {showEjsGuide && (
                <div className="p-4 space-y-3" style={{ background:'rgba(249,115,22,0.04)' }}>
                  <p className="text-[11px] font-semibold" style={{ color: c.textPrimary }}>תבנית מייל כללי (emailTemplateId):</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {[
                      ['{{to_email}}','כתובת האימייל של הנמען'],
                      ['{{to_name}}', 'שם הנמען'],
                      ['{{from_name}}','שם השולח (מהמערכת)'],
                      ['{{subject}}', 'נושא המייל'],
                      ['{{message}}', 'תוכן המייל'],
                    ].map(([v, desc]) => (
                      <div key={v} className="flex items-center gap-1.5 p-1.5 rounded-lg" style={{ background: c.subtleBg }}>
                        <code className="font-mono text-orange-400">{v}</code>
                        <span style={{ color: c.textMuted }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] font-semibold mt-3" style={{ color: c.textPrimary }}>תבנית הזמנות לצוות (emailInviteTmpl):</p>
                  <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                    {[
                      ['{{to_email}}',    'כתובת המוזמן'],
                      ['{{invited_by}}',  'שם המזמין'],
                      ['{{role}}',        'תפקיד (מנהל / סוכן)'],
                      ['{{invite_link}}', 'קישור ההזמנה'],
                      ['{{subject}}',     'נושא המייל'],
                    ].map(([v, desc]) => (
                      <div key={v} className="flex items-center gap-1.5 p-1.5 rounded-lg" style={{ background: c.subtleBg }}>
                        <code className="font-mono text-orange-400">{v}</code>
                        <span style={{ color: c.textMuted }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── OAUTH (AI AGENT INBOX) ── */}
        {tab === 'oauth' && (
          <div className="space-y-4">

            {/* What is this banner */}
            <div className="rounded-2xl p-4"
              style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.05))', border:'1px solid rgba(99,102,241,0.25)' }}>
              <p className="text-[13px] font-bold mb-2" style={{ color: c.textPrimary }}>🤖 מה זה חיבור OAuth לסוכן AI?</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: c.textSecondary }}>
                <div className="flex items-start gap-1.5">
                  <span>📥</span>
                  <span><strong style={{ color: c.textPrimary }}>קריאת תיבת דואר</strong> — הסוכן רואה מיילים נכנסים בזמן אמת</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span>✍️</span>
                  <span><strong style={{ color: c.textPrimary }}>תשובות חכמות</strong> — AI מנסח תשובה ומבקש אישורך</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span>🔒</span>
                  <span><strong style={{ color: c.textPrimary }}>מאובטח לחלוטין</strong> — Token מאוחסן בדפדפן בלבד, לא בשרת</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <span>📤</span>
                  <span><strong style={{ color: c.textPrimary }}>שליחה בשמך</strong> — מייל יוצא נראה כאילו כתבת אותו</span>
                </div>
              </div>
              <div className="mt-3 p-2.5 rounded-xl flex items-center gap-2 text-[11px]"
                style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', color:'#d97706' }}>
                <span>⚡</span>
                <span><strong>שונה מ-App Password (SMTP):</strong> SMTP שולח מיילים מהמערכת — OAuth נותן לסוכן לקרוא את תיבת הדואר שלך</span>
              </div>
            </div>

            {/* Provider selector */}
            <div className="grid grid-cols-2 gap-3">
              {(['gmail', 'outlook'] as const).map(p => (
                <button key={p} onClick={() => setOauthProvider(p)}
                  className="p-3 rounded-xl text-right transition-all"
                  style={oauthProvider === p
                    ? { background:`${EMAIL_COLOR}18`, border:`2px solid ${EMAIL_COLOR}50` }
                    : { background: c.subtleBg, border:`2px solid rgba(255,255,255,0.07)` }}>
                  <p className="text-[13px] font-bold mb-0.5" style={{ color: c.textPrimary }}>
                    {p === 'gmail' ? '📧 Gmail' : '🔵 Outlook'}
                  </p>
                  <p className="text-[10px]" style={{ color: c.textMuted }}>
                    {p === 'gmail' ? 'Google Workspace / Gmail.com' : 'Microsoft 365 / Outlook.com'}
                  </p>
                </button>
              ))}
            </div>

            {/* Step-by-step guide */}
            <div className="rounded-xl overflow-hidden" style={{ border:`1px solid ${c.cardBorder}` }}>
              <button type="button" onClick={() => setShowOauthGuide(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-right transition-colors"
                style={{ background: c.subtleBg }}>
                {showOauthGuide
                  ? <ChevronUp size={15} style={{ color: c.textMuted }}/>
                  : <ChevronDown size={15} style={{ color: c.textMuted }}/>}
                <span className="text-[12px] font-semibold flex items-center gap-2" style={{ color: c.textSecondary }}>
                  <span>📋</span>
                  {oauthProvider === 'gmail'
                    ? 'מדריך: יצירת Google OAuth Client ID (5 דקות)'
                    : 'מדריך: רישום אפליקציה ב-Azure Portal (5 דקות)'}
                </span>
              </button>
              {showOauthGuide && (
                <div className="px-4 py-4 space-y-2.5" style={{ background:`${EMAIL_COLOR}04` }}>
                  {oauthProvider === 'gmail' ? (
                    <>
                      {[
                        { n:1, icon:'🌐', title:'פתח Google Cloud Console', body: <span>כנס ל-<a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="underline font-semibold" style={{ color:'#818cf8' }}>console.cloud.google.com</a> ← ודא שאתה מחובר לחשבון Google הנכון</span> },
                        { n:2, icon:'📁', title:'צור פרויקט חדש', body: <span>לחץ על שם הפרויקט בתפריט העליון ← <strong style={{ color: c.textPrimary }}>New Project</strong> ← שם: "RAY CRM" ← <strong style={{ color: c.textPrimary }}>Create</strong></span> },
                        { n:3, icon:'✅', title:'הפעל Gmail API', body: <span><strong style={{ color: c.textPrimary }}>APIs & Services → Library</strong> ← חפש <strong style={{ color: c.textPrimary }}>"Gmail API"</strong> ← לחץ <strong style={{ color: c.textPrimary }}>Enable</strong></span> },
                        { n:4, icon:'🛡️', title:'הגדר מסך הסכמה (OAuth consent screen)', body: <span><strong style={{ color: c.textPrimary }}>APIs & Services → OAuth consent screen</strong> ← בחר <strong style={{ color: c.textPrimary }}>Internal</strong> אם המייל שייך ל-Google Workspace של הארגון.<br/><span className="text-[10px]" style={{ color:'#10b981' }}>Internal חוסך אישור אבטחה של Google לקריאת מיילים — External מחייב בדיקה יקרה.</span></span> },
                        { n:5, icon:'🔑', title:'צור OAuth 2.0 Client ID', body: <span><strong style={{ color: c.textPrimary }}>APIs & Services → Credentials → + Create Credentials → OAuth client ID</strong><br/>Application type: <strong style={{ color: c.textPrimary }}>Web application</strong></span> },
                        { n:6, icon:'🔗', title:'הוסף Authorized JS Origins', body: <span>תחת "Authorized JavaScript origins" לחץ <strong style={{ color: c.textPrimary }}>+ Add URI</strong> והוסף את <strong style={{ color: c.textPrimary }}>כולן</strong> — אחרת החיבור יעבוד בכתובת אחת ויישבר באחרת:<br/>{oauthOriginsForDisplay().map(o => (<code key={o} className="font-mono text-xs px-1.5 py-0.5 rounded mt-1 ml-1 inline-block" style={{ background:`${EMAIL_COLOR}12`, color: EMAIL_COLOR }}>{o}</code>))}</span> },
                        { n:7, icon:'📋', title:'העתק Client ID', body: <span>לחץ <strong style={{ color: c.textPrimary }}>Create</strong> ← בחלון שנפתח — העתק את ה-<strong style={{ color: c.textPrimary }}>Client ID</strong> ← הדבק למטה<br/><span className="text-[10px]" style={{ color: c.textMuted }}>פורמט: 123456789-xxxxx.apps.googleusercontent.com</span></span> },
                      ].map(({ n, icon, title, body }) => (
                        <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}` }}>
                          <StepBadge n={n} color={EMAIL_COLOR}/>
                          <div>
                            <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{icon} {title}</p>
                            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                          </div>
                        </div>
                      ))}
                      <InfoBanner icon={Shield} color={EMAIL_COLOR}
                        text="הסוכן מקבל גישה לקריאת מיילים בלבד — לא ישנה, לא ימחק. אתה רואה ומאשר כל תשובה לפני שנשלחת."/>
                    </>
                  ) : (
                    <>
                      {[
                        { n:1, icon:'🌐', title:'פתח Azure App Registrations', body: <span>כנס ל-<a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps" target="_blank" rel="noreferrer" className="underline font-semibold" style={{ color:'#818cf8' }}>portal.azure.com</a> ← App registrations ← <strong style={{ color: c.textPrimary }}>+ New registration</strong></span> },
                        { n:2, icon:'📝', title:'הגדר את האפליקציה', body: <span>שם: "RAY CRM" ← Supported account types: <strong style={{ color: c.textPrimary }}>Multitenant + Personal Microsoft accounts</strong> ← Redirect URI: SPA → <code className="font-mono text-xs" style={{ color: EMAIL_COLOR }}>{typeof window !== 'undefined' ? window.location.origin : 'https://ray-crm-app.web.app'}</code></span> },
                        { n:3, icon:'🔑', title:'הוסף הרשאות Mail', body: <span><strong style={{ color: c.textPrimary }}>API permissions → + Add a permission → Microsoft Graph → Delegated</strong><br/>הוסף: <strong style={{ color: c.textPrimary }}>Mail.Read, Mail.Send, Mail.ReadWrite</strong></span> },
                        { n:4, icon:'📋', title:'העתק Application (client) ID', body: <span>עמוד <strong style={{ color: c.textPrimary }}>Overview</strong> ← העתק את <strong style={{ color: c.textPrimary }}>Application (client) ID</strong> ← הדבק למטה<br/><span className="text-[10px]" style={{ color: c.textMuted }}>פורמט: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</span></span> },
                      ].map(({ n, icon, title, body }) => (
                        <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}` }}>
                          <StepBadge n={n} color="#0078d4"/>
                          <div>
                            <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{icon} {title}</p>
                            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Client ID input */}
            <div className="space-y-2">
              <label className="block text-[12px] font-bold text-right" style={{ color: c.textPrimary }}>
                🔑 {oauthProvider === 'gmail' ? 'Google OAuth Client ID' : 'Azure Application (client) ID'}
                {cfg.oauthClientId && <span className="mr-2 text-[10px] font-normal text-emerald-400">✓ שמור</span>}
              </label>
              <input
                value={oauthClientId}
                onChange={e => setOauthClientId(e.target.value)}
                placeholder={oauthProvider === 'gmail' ? '123456789-xxxxx.apps.googleusercontent.com' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none font-mono"
                style={{ ...inputStyle, direction: 'ltr' }}
              />
              {oauthClientId && !oauthClientId.includes('.') && oauthProvider === 'gmail' && (
                <p className="text-[10px]" style={{ color:'#f59e0b' }}>⚠️ Client ID של Gmail מסתיים ב-.apps.googleusercontent.com</p>
              )}
            </div>

            {/* What happens next */}
            <div className="rounded-xl p-3 space-y-2" style={{ background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.2)' }}>
              <p className="text-[11px] font-bold" style={{ color: c.textPrimary }}>✅ אחרי שתלחץ "שמור Client ID":</p>
              <ol className="space-y-1 text-[11px]" style={{ color: c.textSecondary }}>
                <li>1. עבור לדף <strong style={{ color: c.textPrimary }}>סוכן מכירות AI</strong> ← טאב "מייל"</li>
                <li>2. לחץ <strong style={{ color: c.textPrimary }}>חבר חשבון</strong> — ה-Client ID יהיה מולא אוטומטית</li>
                <li>3. לחץ "חבר Gmail" — חלון Google ייפתח לאישור גישה</li>
                <li>4. הסוכן מוכן! 🚀</li>
              </ol>
            </div>

            {/* Save + navigate button */}
            <div className="flex gap-2 pt-1" style={{ borderTop:`1px solid ${c.divider}` }}>
              <button
                onClick={handleSaveOauth}
                disabled={oauthSaving || !oauthClientId.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50 transition-all"
                style={oauthSaved
                  ? { background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.3)', color:'#34d399' }
                  : { background:`linear-gradient(135deg,${EMAIL_COLOR},#8b5cf6)`, color:'white', boxShadow:`0 0 12px ${EMAIL_COLOR}30` }}>
                {oauthSaving
                  ? <><Loader2 size={13} className="animate-spin"/>שומר...</>
                  : oauthSaved
                    ? <><CheckCircle2 size={13}/>Client ID נשמר!</>
                    : <><Save size={13}/>שמור Client ID</>
                }
              </button>
            </div>
          </div>
        )}

        {/* Status + Actions — only for SMTP / EmailJS tabs */}
        {tab !== 'oauth' && (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-2" style={{ borderTop:`1px solid ${c.divider}` }}>
          {/* Status */}
          {isConfigured ? (
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color:'#34d399' }}>
              <CheckCircle2 size={15}/>
              {tab === 'emailjs' ? 'EmailJS מוגדר ופעיל' : `${tab === 'outlook' ? 'Outlook' : 'Gmail'} מחובר: ${smtpEmail}`}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm" style={{ color:'#fbbf24' }}>
              <AlertTriangle size={14}/>
              לא מוגדר — מלא את הפרטים ולחץ שמור
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleTest}
              disabled={testing || !isConfigured}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-2 rounded-xl disabled:opacity-40 transition-all"
              style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}`, color: c.textSecondary }}>
              <Send size={13}/>
              {testing ? 'שולח...' : 'שלח בדיקה'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-xl disabled:opacity-50 transition-all"
              style={saved
                ? { background:'rgba(52,211,153,0.15)', border:'1px solid rgba(52,211,153,0.3)', color:'#34d399' }
                : { background:`linear-gradient(135deg,${EMAIL_COLOR},#8b5cf6)`, color:'white', boxShadow:`0 0 12px ${EMAIL_COLOR}30` }}>
              {saving
                ? <><Loader2 size={13} className="animate-spin"/>שומר...</>
                : saved
                  ? <><CheckCircle2 size={13}/>נשמר!</>
                  : <><Save size={13}/>שמור</>
              }
            </button>
          </div>
        </div>
        )}

      </div>
    </PlatformSection>
  );
}

/* ── WhatsApp Section ─────────────────────────────────────────────────────── */
function WhatsAppSection({ webhookUrl, onToast }: {
  webhookUrl: string;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { c } = useTheme();
  const [tab, setTab] = useState<'connect' | 'bot' | 'followup'>('connect');
  const [provider, setProvider] = useState<'meta' | 'twilio'>('meta');

  const WA_COLOR = '#25d366';

  return (
    <PlatformSection id="whatsapp" name="WhatsApp Business" emoji="💬" color={WA_COLOR}
      badge="Cloud API" leadCount={0} connected={false}>

      <div className="space-y-4">

        {/* Feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Bot,           color:'#25d366', title:'צ\'אט-בוט חכם',      desc:'בנה בוט שעונה אוטומטית ללידים ב-WhatsApp דרך בונה האוטומציות' },
            { icon: Send,          color: c.accentText, title:'הודעות מעקב',        desc:'שלח סדרת הודעות מתוזמנת ללידים דרך בונה האוטומציות' },
            { icon: GitBranch,     color:'#f97316', title:'זרימות חכמות',       desc:'בנה Workflows עם תנאים — "אם לא ענה → שלח הודעה שנייה"' },
          ].map(f => (
            <div key={f.title} className="rounded-xl p-3 text-right"
              style={{ background:`${f.color}08`, border:`1px solid ${f.color}20` }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2"
                style={{ background:`${f.color}18`, border:`1px solid ${f.color}30` }}>
                <f.icon size={15} style={{ color: f.color }}/>
              </div>
              <p className="text-[12px] font-bold mb-1" style={{ color: c.textPrimary }}>{f.title}</p>
              <p className="text-[10px] leading-relaxed" style={{ color: c.textMuted }}>{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl p-1" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
          {([
            { key:'connect',  label:'⚡ חיבור ל-API' },
            { key:'bot',      label:'🤖 בניית בוט'  },
            { key:'followup', label:'📤 מעקב אוטומטי' },
          ] as { key: typeof tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
              style={tab === t.key
                ? { background:`${WA_COLOR}20`, color: WA_COLOR, border:`1px solid ${WA_COLOR}40` }
                : { color: c.textMuted, border:'1px solid transparent' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB 1: Connection ── */}
        {tab === 'connect' && (
          <div className="space-y-4">
            {/* Architecture flow */}
            <div className="rounded-xl p-4" style={{ background:'rgba(37,211,102,0.06)', border:'1px solid rgba(37,211,102,0.15)' }}>
              <p className="text-[12px] font-bold mb-3" style={{ color: c.textPrimary }}>🔄 כיצד WhatsApp עובד עם המערכת</p>
              <div className="flex items-center gap-2 flex-wrap justify-center">
                {[
                  { icon:'👤', title:'ליד שולח הודעה', sub:'ל-WhatsApp שלך' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'⚡', title:'Webhook נורה', sub:'לשרת שלנו' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'✅', title:'ליד נוצר', sub:'ב-CRM' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'🤖', title:'בוט עונה', sub:'דרך Workflows' },
                ].map((s, i) => (
                  s.icon === '→'
                    ? <ArrowRight key={i} size={12} style={{ color: c.textMuted, flexShrink:0 }}/>
                    : <div key={i} className="flex flex-col items-center gap-0.5 min-w-[65px] text-center">
                        <span className="text-lg">{s.icon}</span>
                        <p className="text-[9px] font-bold" style={{ color: c.textPrimary }}>{s.title}</p>
                        <p className="text-[8px]" style={{ color: c.textMuted }}>{s.sub}</p>
                      </div>
                ))}
              </div>
            </div>

            {/* Provider selector */}
            <div>
              <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>בחר ספק API</p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { key:'meta',   label:'Meta Cloud API', emoji:'📘', sub:'חינמי — דרך Facebook Business', color:'#1877f2' },
                  { key:'twilio', label:'Twilio',         emoji:'🟦', sub:'$0.005/הודעה — הגדרה קלה יותר', color:'#f22f46' },
                ] as { key:'meta'|'twilio'; label:string; emoji:string; sub:string; color:string }[]).map(p => (
                  <button key={p.key} onClick={() => setProvider(p.key)}
                    className="p-3 rounded-xl text-right transition-all"
                    style={provider === p.key
                      ? { background:`${p.color}18`, border:`2px solid ${p.color}50` }
                      : { background: c.subtleBg, border:'2px solid rgba(255,255,255,0.08)' }}>
                    <p className="text-[13px] font-bold mb-0.5" style={{ color: c.textPrimary }}>{p.emoji} {p.label}</p>
                    <p className="text-[10px]" style={{ color: c.textMuted }}>{p.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Provider steps */}
            {provider === 'meta' && (
              <div className="space-y-2">
                <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>📋 הגדרה — Meta WhatsApp Cloud API</p>
                {[
                  { n:1, title:'צור Meta Business Account', body: <><a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#60a5fa' }}>business.facebook.com</a> → הגדרות עסק → WhatsApp Accounts → הוסף מספר.</> },
                  { n:2, title:'פתח Meta for Developers', body: <><a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#60a5fa' }}>developers.facebook.com</a> → צור App חדש → בחר "Business" → הוסף מוצר WhatsApp.</> },
                  { n:3, title:'הגדר Webhook', body:'WhatsApp → Configuration → Webhook. הדבק את ה-Webhook URL של המערכת. Verify Token: כל מחרוזת שתבחר (שמור אותה!).' },
                  { n:4, title:'הפעל Events', body:'ב-Webhook Fields — סמן: messages, message_deliveries. זה מה שיורה כשמישהו שולח הודעה.' },
                  { n:5, title:'שמור Access Token', body:'WhatsApp → API Setup → העתק את ה-Temporary Access Token. לשימוש בבוט ב-Workflows.' },
                ].map(({ n, title, body }) => (
                  <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <StepBadge n={n} color={WA_COLOR}/>
                    <div>
                      <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                      <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {provider === 'twilio' && (
              <div className="space-y-2">
                <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>📋 הגדרה — Twilio WhatsApp</p>
                {[
                  { n:1, title:'פתח חשבון Twilio', body: <><a href="https://twilio.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#60a5fa' }}>twilio.com</a> → Messaging → Senders → WhatsApp Senders → Get Started.</> },
                  { n:2, title:'Sandbox לבדיקות', body:'שלח את הקוד מ-WhatsApp Sandbox כדי לבדוק. בפרודקשן תצטרך אישור WhatsApp Business.' },
                  { n:3, title:'הגדר Webhook', body:'Twilio → Phone Numbers → Active Numbers → Messaging → "When a message comes in" → Webhook URL שלך.' },
                  { n:4, title:'שמור Account SID + Auth Token', body:'מהדף הראשי של Twilio — Account SID ו-Auth Token. אלו הם פרטי ה-API לשליחת הודעות.' },
                ].map(({ n, title, body }) => (
                  <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <StepBadge n={n} color="#f22f46"/>
                    <div>
                      <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                      <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Webhook URL for inbound */}
            {webhookUrl ? (
              <div>
                <p className="text-[11px] font-semibold mb-2 text-right" style={{ color: c.textSecondary }}>
                  Webhook URL לקבלת הודעות נכנסות:
                </p>
                <CodeBlock label="Webhook URL (הדבק ב-Meta / Twilio)" code={`${webhookUrl}&source=WhatsApp`}
                  onCopy={() => onToast('URL הועתק ✓', 'success')}/>
              </div>
            ) : (
              <InfoBanner text="צור Webhook URL תחילה (סקשן ראשון) — ואז הדבק אותו ב-Meta / Twilio."/>
            )}
          </div>
        )}

        {/* ── TAB 2: Bot Builder ── */}
        {tab === 'bot' && (
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background:'rgba(37,211,102,0.06)', border:'1px solid rgba(37,211,102,0.2)' }}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background:'rgba(37,211,102,0.2)', border:'1px solid rgba(37,211,102,0.4)' }}>
                  <Bot size={15} style={{ color: WA_COLOR }}/>
                </div>
                <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>איך עובד הצ'אט-בוט</p>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
                הבוט בנוי <strong style={{ color: c.textPrimary }}>ישירות בבונה האוטומציות</strong>.
                כל ליד שנכנס מ-WhatsApp מקבל אוטומטית סדרת הודעות שבנית מראש — ללא עבודה ידנית.
                הבוט יכול לשאול שאלות, להסביר על השירות, ולקבוע פגישה.
              </p>
            </div>

            {/* Bot conversation example */}
            <div>
              <p className="text-[12px] font-bold mb-3" style={{ color: c.textPrimary }}>💬 דוגמה לשיחת בוט</p>
              <div className="space-y-2 rounded-xl p-4" style={{ background:'rgba(0,0,0,0.3)', border:'1px solid rgba(37,211,102,0.15)' }}>
                {[
                  { dir:'in',  text:'היי, ראיתי את הפרסום שלכם' },
                  { dir:'out', text:'שלום! שמח שפנית 😊 אני {שמך}, איך אוכל לעזור?' },
                  { dir:'in',  text:'מה כוללת החבילה הבסיסית?' },
                  { dir:'out', text:'החבילה כוללת: ניהול קמפיינים, דוחות שבועיים ועוד. רוצה לקבוע שיחת היכרות ב-15 דקות?' },
                  { dir:'in',  text:'כן, מתי אפשר?' },
                  { dir:'out', text:'מעולה! 📅 שלח לי מספר ימים/שעות שנוחות לך ואקבע.' },
                ].map((m, i) => (
                  <div key={i} className={`flex ${m.dir === 'out' ? 'justify-start' : 'justify-end'}`}>
                    <div className="max-w-[75%] px-3 py-1.5 rounded-xl text-[11px] leading-relaxed"
                      style={m.dir === 'out'
                        ? { background:'rgba(37,211,102,0.2)', color: c.textPrimary, borderBottomLeftRadius:4 }
                        : { background: c.subtleBg, color: c.textSecondary, borderBottomRightRadius:4 }}>
                      {m.text}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[10px] mt-2 text-center" style={{ color: c.textMuted }}>
                * הודעות ה-בוט (ירוק) מוגדרות מראש בבונה האוטומציות
              </p>
            </div>

            {/* Steps to build */}
            <div className="space-y-2">
              <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>🛠️ בניית הבוט — 3 צעדים</p>
              {[
                { n:1, title:'פתח את בונה האוטומציות', body:'עבור לתפריט → בונה אוטומציות (Workflows). לחץ "+ רצף חדש".' },
                { n:2, title:'הוסף שלבי WhatsApp', body:'לחץ "+ הוסף שלב" ← בחר 📱 WhatsApp. כתוב את ההודעה הראשונה (ברכה). הוסף שלב "המתן" של יום 1, ואז שלב WA שני (follow-up).' },
                { n:3, title:'הפעל לכל ליד חדש', body:'פתח ליד WhatsApp ← לחץ "הפעל רצף" ← בחר את הרצף שבנית. הבוט ישלח את ההודעות לפי הלו"ז.' },
              ].map(({ n, title, body }) => (
                <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <StepBadge n={n} color={WA_COLOR}/>
                  <div>
                    <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <InfoBanner icon={Info} color={WA_COLOR}
              text="הבוט שולח הודעות ב-WhatsApp Business — ולא ב-WhatsApp האישי. המספר חייב להיות רשום ב-Meta Business."/>
          </div>
        )}

        {/* ── TAB 3: Follow-up ── */}
        {tab === 'followup' && (
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background:'rgba(99,102,241,0.07)', border:'1px solid rgba(99,102,241,0.2)' }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)' }}>
                  <Send size={14} style={{ color: c.accentText }}/>
                </div>
                <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>הודעות מעקב אוטומטיות</p>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
                בונה האוטומציות כולל שלב <strong style={{ color: c.textPrimary }}>WhatsApp</strong> שמאפשר לשלוח הודעות מעקב מתוזמנות.
                תוכל לבנות רצפים כמו: "אחרי יום 1 → WA ראשון", "אחרי יום 3 → שיחה", "אחרי יום 7 → WA שני".
              </p>
            </div>

            {/* Sequence preview */}
            <div>
              <p className="text-[12px] font-bold mb-3" style={{ color: c.textPrimary }}>📅 דוגמה — רצף מעקב ליד חדש</p>
              <div className="space-y-2">
                {[
                  { day:'יום 1',  type:'whatsapp', color:'#25d366', emoji:'📱', msg:'שלום! קיבלתי את פרטיך ואשמח לספר על השירות שלנו. מתי נוח לשוחח?' },
                  { day:'יום 3',  type:'call',     color:'#6366f1', emoji:'📞', msg:'שיחת טלפון — לבדוק אם ראה את ההודעה' },
                  { day:'יום 7',  type:'whatsapp', color:'#25d366', emoji:'📱', msg:'היי, רצית לוודא שקיבלת את ההודעה שלי. יש לך שאלות?' },
                  { day:'יום 14', type:'email',    color:'#8b5cf6', emoji:'📧', msg:'מייל עם הצעת ערך מפורטת וקישור לפגישה' },
                  { day:'יום 21', type:'whatsapp', color:'#25d366', emoji:'📱', msg:'הודעה אחרונה — האם יש שינוי בנסיבות?' },
                ].map((step, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-14 flex-shrink-0 text-[10px] font-bold text-right" style={{ color: c.textMuted }}>{step.day}</div>
                    <div className="w-px h-6 self-stretch" style={{ background: c.subtleBg }}/>
                    <div className="flex-1 flex items-center gap-2 p-2.5 rounded-lg"
                      style={{ background:`${step.color}0d`, border:`1px solid ${step.color}25` }}>
                      <span className="text-sm flex-shrink-0">{step.emoji}</span>
                      <p className="text-[10px] leading-relaxed" style={{ color: c.textSecondary }}>{step.msg}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Templates */}
            <div>
              <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>✏️ תבניות הודעה מוכנות</p>
              <div className="space-y-2">
                {[
                  { title:'ברכת פנייה ראשונה',  text:'שלום {שם}! קיבלתי את פנייתך בנוגע ל-{שירות}. אני {שלי} מ-{חברה} ואשמח לעזור. מתי נוח לשוחח 5 דקות?' },
                  { title:'מעקב לאחר שתיקה',   text:'היי {שם}, רצינו לוודא שקיבלת את הפרטים שלנו. יש שאלות? כאן בשבילך 😊' },
                  { title:'הצעת ערך קצרה',       text:'{שם}, שמח להזכיר — אנחנו עוזרים ל-{עסקים כמוך} להשיג {תוצאה}. רוצה לשמוע איך?' },
                ].map((t, i) => (
                  <div key={i} className="rounded-xl p-3" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <p className="text-[11px] font-bold mb-1.5" style={{ color: c.textSecondary }}>{t.title}</p>
                    <p className="text-[10px] leading-relaxed text-right" style={{ color: c.textMuted, fontStyle:'italic' }}>"{t.text}"</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] mt-2 text-right" style={{ color: c.textMuted }}>
                * העתק תבניות ישירות לבונה האוטומציות ← שלב WhatsApp ← הודעה
              </p>
            </div>
          </div>
        )}

        {/* Bottom note */}
        <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background:'rgba(37,211,102,0.06)', border:'1px solid rgba(37,211,102,0.15)' }}>
          <MessageCircle size={15} style={{ color: WA_COLOR, flexShrink:0 }}/>
          <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
            <strong style={{ color: c.textPrimary }}>חשוב:</strong> שליחת הודעות WhatsApp דורשת מספר עסקי מאושר על ידי Meta.
            לא ניתן לשלוח הודעות יזומות דרך WhatsApp Personal — רק דרך WhatsApp Business API.
          </p>
        </div>

      </div>
    </PlatformSection>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SOCIAL PUBLISH SECTION — LinkedIn, TikTok, Twitter/X, YouTube + AI help
════════════════════════════════════════════════════════════════════════════ */
function SocialPublishSection({ workspace, onToast, metaConnected, metaPages }: {
  workspace: WorkspaceProfile;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  metaConnected: boolean;
  metaPages: import('../types').MetaPage[];
}) {
  const { c } = useTheme();
  const [open,          setOpen]          = useState(false); // collapsed on entry, like the other sections
  const [connections,   setConnections]   = useState<SocialConnection[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [connectingId,  setConnectingId]  = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [credModal,     setCredModal]     = useState<string | null>(null);
  const [credClientId,  setCredClientId]  = useState('');
  const [credSecret,    setCredSecret]    = useState('');
  const [aiPlatform,    setAiPlatform]    = useState<string | null>(null);
  const [aiQ,           setAiQ]           = useState('');
  const [aiA,           setAiA]           = useState('');
  const [aiLoading,     setAiLoading]     = useState(false);

  useEffect(() => {
    if (!workspace.id) return;
    loadSocialConnections(workspace.id).then(c => { setConnections(c); setLoading(false); });
  }, [workspace.id]);

  const getConn = (id: string) =>
    connections.find(c => c.platform === id) ?? { platform: id as any, connected: false };

  // ── Ask RAY ──────────────────────────────────────────────────────────────
  const handleAskRay = async () => {
    if (!aiQ.trim() || aiLoading) return;
    setAiLoading(true);
    setAiA('');
    try {
      const pm = PLATFORMS.find(p => p.id === aiPlatform);
      const proxy = getAnthropicProxy();
      const res = await proxy.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 600,
        system: `אתה ריי, עוזר AI מקצועי לשיווק דיגיטלי. המשתמש מנסה לחבר את ${pm?.label ?? 'הפלטפורמה'} ל-CRM שלו. ענה בעברית, בצורה ברורה וצעד-אחר-צעד. ענה בקצרה — עד 300 מילים.`,
        messages: [{ role: 'user', content: aiQ }],
      });
      const text = (res.content[0] as any)?.text ?? '';
      setAiA(text);
    } catch { setAiA('שגיאה בחיבור לריי. נסה שוב.'); }
    finally { setAiLoading(false); }
  };

  // ── Connect (OAuth popup) ─────────────────────────────────────────────────
  const handleConnect = async (platformId: string) => {
    const pm = PLATFORMS.find(p => p.id === platformId);
    if (!pm) return;
    if (platformId === 'facebook' || platformId === 'instagram') {
      onToast('Facebook ו-Instagram מחוברים דרך חיבור Meta — ראה סקציה למעלה', 'info');
      return;
    }
    if (!pm.oauthSupported) {
      setCredClientId(''); setCredSecret(''); setCredModal(platformId);
      return;
    }
    if (!credClientId) { setCredModal(platformId); return; }
    setConnectingId(platformId);
    try {
      // Save credentials to Firestore FIRST (server reads them during token exchange)
      await saveSocialConnection(workspace.id, {
        platform: platformId as any,
        connected: false,
        clientId: credClientId,
        clientSecret: credSecret,
      });
      const code = await openOAuthPopup(pm.id, credClientId);
      // Server reads clientSecret from Firestore — we don't send it over the wire
      const result = await exchangeSocialToken({ platform: platformId as any, code, workspaceId: workspace.id });
      const conn: SocialConnection = {
        platform: platformId as any,
        connected: true,
        accessToken: result.accessToken,
        accountName: result.accountName,
        accountId: result.accountId,
        clientId: credClientId,
        clientSecret: credSecret,   // keep in Firestore for future re-auth
        connectedAt: Date.now(),
      };
      await saveSocialConnection(workspace.id, conn);
      setConnections(prev => [...prev.filter(c => c.platform !== platformId), conn]);
      setCredModal(null);
      onToast(`${pm.label} חובר ✓`, 'success');
    } catch (e: any) { onToast(e.message ?? 'שגיאה בחיבור', 'error'); }
    finally { setConnectingId(null); }
  };

  // ── Disconnect ────────────────────────────────────────────────────────────
  const handleDisconnect = async (platformId: string) => {
    setDisconnecting(platformId);
    try {
      await deleteSocialConnection(workspace.id, platformId as any);
      setConnections(prev => prev.filter(c => c.platform !== platformId));
      onToast('הפלטפורמה נותקה ✓', 'info');
    } finally { setDisconnecting(null); }
  };

  // ── Setup guides per platform ─────────────────────────────────────────────
  const GUIDES: Record<string, { steps: { n: number; title: string; body: React.ReactNode }[]; docsUrl: string }> = {
    facebook: {
      docsUrl: 'https://developers.facebook.com',
      steps: [
        { n:1, title:'יצירת Meta App', body: <>כנס ל-<a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#1877f2' }}>developers.facebook.com</a> → My Apps → Create App</> },
        { n:2, title:'הגדרת OAuth', body: 'Products → Facebook Login → Settings → הוסף Redirect URI' },
        { n:3, title:'בקש הרשאות', body: 'pages_manage_posts, pages_read_engagement, leads_retrieval' },
        { n:4, title:'חבר דרך Meta', body: 'לחץ על כפתור "חבר Facebook" בסקציה "Facebook & Instagram Lead Ads" למעלה' },
      ],
    },
    instagram: {
      docsUrl: 'https://developers.facebook.com/docs/instagram-api',
      steps: [
        { n:1, title:'Meta Business Account', body: <>הדף Instagram חייב להיות מחובר לדף עסקי Facebook. ראה <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#e1306c' }}>business.facebook.com</a></> },
        { n:2, title:'חיבור דרך Meta', body: 'Instagram מופעל אוטומטית דרך חיבור Meta — חבר את Facebook ואינסטגרם תתחבר אוטומטית' },
        { n:3, title:'ודא Permissions', body: 'instagram_basic, instagram_content_publish, instagram_manage_comments' },
      ],
    },
    linkedin: {
      docsUrl: 'https://developer.linkedin.com',
      steps: [
        { n:1, title:'LinkedIn Developer Portal', body: <>כנס ל-<a href="https://developer.linkedin.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#0a66c2' }}>developer.linkedin.com</a> → My Apps → Create App</> },
        { n:2, title:'הגדר Auth Redirect URI', body: `הוסף ב-Auth tab: ${window.location.origin}/oauth/linkedin/callback` },
        { n:3, title:'בחר Permissions', body: 'w_member_social, r_organization_social, w_organization_social, openid, profile, email' },
        { n:4, title:'העתק Client ID ו-Secret', body: 'מדף Auth → Client ID וה-Client Secret שם בטופס החיבור' },
        { n:5, title:'לחץ חבר', body: 'חלון OAuth ייפתח — התחבר עם חשבון LinkedIn שלך ואשר הרשאות' },
      ],
    },
    tiktok: {
      docsUrl: 'https://developers.tiktok.com',
      steps: [
        { n:1, title:'TikTok for Developers', body: <>כנס ל-<a href="https://developers.tiktok.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#010101' }}>developers.tiktok.com</a> → My Apps → Create App</> },
        { n:2, title:'Product: Login Kit + Content Posting API', body: 'הפעל Login Kit ו-Content Posting API בסקציה Products' },
        { n:3, title:'הגדר Redirect Domain', body: `הוסף: ${window.location.hostname}` },
        { n:4, title:'Scopes', body: 'user.info.basic, video.publish, video.upload' },
        { n:5, title:'Client Key ו-Secret', body: 'מדף App Details. שים לב: TikTok קורא לזה Client Key (לא Client ID)' },
      ],
    },
    twitter: {
      docsUrl: 'https://developer.twitter.com',
      steps: [
        { n:1, title:'Twitter Developer Portal', body: <>כנס ל-<a href="https://developer.twitter.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#000' }}>developer.twitter.com</a> → Projects & Apps → New Project</> },
        { n:2, title:'הפעל OAuth 2.0', body: 'ב-App Settings → User authentication settings → OAuth 2.0 → הפעל' },
        { n:3, title:'Callback URL', body: `${window.location.origin}/oauth/twitter/callback` },
        { n:4, title:'Scopes', body: 'tweet.read tweet.write users.read offline.access' },
        { n:5, title:'Client ID ו-Secret', body: 'מדף Keys and tokens → OAuth 2.0 Client ID and Client Secret' },
      ],
    },
    youtube: {
      docsUrl: 'https://console.cloud.google.com',
      steps: [
        { n:1, title:'Google Cloud Console', body: <>כנס ל-<a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#ff0000' }}>console.cloud.google.com</a> → Create Project → Enable YouTube Data API v3</> },
        { n:2, title:'OAuth Consent Screen', body: 'APIs & Services → OAuth consent screen → External → הוסף YouTube scopes' },
        { n:3, title:'Create Credentials', body: 'APIs & Services → Credentials → Create OAuth client ID → Web Application' },
        { n:4, title:'Authorized Redirect URIs', body: `הוסף: ${window.location.origin}/oauth/youtube/callback` },
        { n:5, title:'Client ID ו-Secret', body: 'מדף Credentials — העתק ל-טופס החיבור' },
      ],
    },
    google: {
      docsUrl: 'https://console.cloud.google.com',
      steps: [
        { n:1, title:'Google Cloud Console', body: <>כנס ל-<a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#4285f4' }}>console.cloud.google.com</a> → Create Project</> },
        { n:2, title:'Enable APIs', body: 'הפעל: Google Ads API, Google Analytics API, Google Business Profile API' },
        { n:3, title:'OAuth Consent Screen', body: 'הגדר OAuth consent screen עם ה-scopes הנדרשים' },
        { n:4, title:'Create Credentials', body: 'Create OAuth 2.0 Client ID → Web Application' },
        { n:5, title:'Authorized Redirect URIs', body: `הוסף: ${window.location.origin}/oauth/google/callback` },
        { n:6, title:'Client ID ו-Secret', body: 'מדף Credentials — העתק ל-טופס החיבור' },
      ],
    },
  };

  const platform_color = (id: string) => PLATFORMS.find(p => p.id === id)?.color ?? '#6366f1';

  return (
    <div style={{ ...glass, padding:0, overflow:'hidden', border:'1px solid rgba(99,102,241,0.3)' }}>
      {/* Section header — collapsible */}
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 transition-all"
        style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.12),rgba(139,92,246,0.08))', borderBottom: open ? '1px solid rgba(255,255,255,0.07)' : 'none' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)' }}>
            <Globe size={16} style={{ color:'#818cf8' }} />
          </div>
          <div className="text-right">
            <h2 className="font-black text-base" style={{ color: c.textPrimary }}>רשתות חברתיות לפרסום</h2>
            <p className="text-[11px]" style={{ color: c.textMuted }}>LinkedIn · TikTok · Twitter/X · YouTube — פרסום אוטומטי מדף שיווק AI</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Connected count — only non-Meta/non-Google platforms */}
          {(() => {
            const displayedPlatforms = PLATFORMS.filter(pm => pm.id !== 'facebook' && pm.id !== 'instagram' && pm.id !== 'google');
            const connectedCount = connections.filter(c => c.connected && c.accessToken && displayedPlatforms.some(p => p.id === c.platform)).length;
            return (
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.3)', color:'#10b981' }}>
                {connectedCount} / {displayedPlatforms.length} מחוברים
              </span>
            );
          })()}
          {open
            ? <ChevronUp size={14} style={{ color: c.textMuted }}/>
            : <ChevronDown size={14} style={{ color: c.textMuted }}/>}
        </div>
      </button>

      {open && (<>
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin" style={{ color:'#818cf8' }} />
        </div>
      ) : (
        <div className="p-5 space-y-3">
          {PLATFORMS.filter(pm => pm.id !== 'facebook' && pm.id !== 'instagram' && pm.id !== 'google').map(pm => {
            const conn = getConn(pm.id);
            const active = isConnectionValid(conn as SocialConnection);
            const isConnecting = connectingId === pm.id;
            const isDisconnecting = disconnecting === pm.id;
            const guide = GUIDES[pm.id];
            const isMeta = pm.id === 'facebook' || pm.id === 'instagram';

            return (
              <div key={pm.id} style={{
                background: active ? `${pm.color}08` : c.subtleBg,
                border: `1px solid ${active ? pm.color + '35' : c.cardBorder}`,
                borderRadius: 16, overflow:'hidden',
              }}>
                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                    style={{ background:`${pm.color}18`, border:`1px solid ${pm.color}28` }}>
                    {pm.emoji}
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold" style={{ color: c.textPrimary }}>{pm.label}</p>
                      {active && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                          style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.3)', color:'#10b981' }}>
                          <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block animate-pulse"/> מחובר
                        </span>
                      )}
                      {isMeta && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background:'rgba(24,119,242,0.12)', border:'1px solid rgba(24,119,242,0.3)', color:'#60a5fa' }}>
                          דרך Meta
                        </span>
                      )}
                    </div>
                    <p className="text-[11px]" style={{ color: c.textMuted }}>{pm.description}</p>
                    {active && conn.accountName && (
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: pm.color }}>✓ {conn.accountName}</p>
                    )}
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Ask RAY */}
                    <button onClick={() => { setAiPlatform(pm.id); setAiQ(`איך לחבר ${pm.label} ל-CRM?`); setAiA(''); }}
                      className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-all"
                      style={{ background:'rgba(139,92,246,0.12)', border:'1px solid rgba(139,92,246,0.3)', color:'#a78bfa' }}>
                      <Sparkles size={10}/> שאל ריי
                    </button>
                    {/* Connect / Disconnect */}
                    {active ? (
                      <button onClick={() => handleDisconnect(pm.id)} disabled={isDisconnecting}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171' }}>
                        {isDisconnecting ? <Loader2 size={10} className="animate-spin"/> : <Link2Off size={10}/>} נתק
                      </button>
                    ) : isMeta ? (
                      <span className="text-[10px] font-medium" style={{ color: c.textMuted }}>חבר דרך Meta ↑</span>
                    ) : (
                      <button onClick={() => { setCredClientId(''); setCredSecret(''); setCredModal(pm.id); }} disabled={isConnecting}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-all disabled:opacity-50"
                        style={{ background:`${pm.color}18`, border:`1px solid ${pm.color}40`, color: pm.color }}>
                        {isConnecting ? <Loader2 size={10} className="animate-spin"/> : <Plus size={10}/>} חבר
                      </button>
                    )}
                    {/* Docs link */}
                    {guide?.docsUrl && (
                      <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center text-[11px] font-semibold px-2 py-1.5 rounded-lg transition-all"
                        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                        <ExternalLink size={10}/>
                      </a>
                    )}
                  </div>
                </div>

                {/* Setup guide (expandable) */}
                {guide?.steps && (
                  <details className="group" style={{ borderTop:`1px solid ${c.cardBorder}` }}>
                    <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer text-[11px] font-semibold list-none"
                      style={{ color: c.textMuted, background: c.subtleBg }}>
                      <span>📖 מדריך הגדרה — {pm.label}</span>
                      <ChevronDown size={12} className="mr-auto group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="px-4 py-3 space-y-2">
                      {guide.steps.map(({ n, title, body }) => (
                        <div key={n} className="flex gap-3 items-start p-2.5 rounded-xl"
                          style={{ background: c.subtleBg, border:`1px solid ${c.cardBorder}` }}>
                          <StepBadge n={n} color={platform_color(pm.id)} />
                          <div>
                            <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                            <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}

          {/* Facebook, Instagram & Google are managed in their own dedicated sections above */}

          {/* Zapier / Make note */}
          <div className="flex items-start gap-2 p-3 rounded-xl"
            style={{ background:'rgba(249,115,22,0.06)', border:'1px solid rgba(249,115,22,0.18)' }}>
            <Info size={13} style={{ color:'#f97316', flexShrink:0, marginTop:1 }}/>
            <p className="text-[11px]" style={{ color: c.textSecondary }}>
              <strong style={{ color:'#f97316' }}>Zapier / Make</strong> — ניתן לחבר כל פלטפורמה גם דרך Webhook URL בסקציה הכללית למעלה. הדבק את ה-URL ב-Zapier Action.
            </p>
          </div>
        </div>
      )}

      {/* ── Credentials modal ──────────────────────────────────────────────────── */}
      {credModal && (() => {
        const pm = PLATFORMS.find(p => p.id === credModal)!;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" dir="rtl">
            <div className="rounded-3xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
              style={{ background: c.cardBg, border:`1px solid ${pm.color}40` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{pm.emoji}</span>
                  <h3 className="font-black text-base" style={{ color: c.textPrimary }}>חיבור {pm.label}</h3>
                </div>
                <button onClick={() => setCredModal(null)}
                  className="p-1.5 rounded-xl" style={{ color: c.textMuted, background: c.subtleBg }}>
                  <X size={16}/>
                </button>
              </div>

              <div className="p-3 rounded-xl text-[11px]" style={{ background:`${pm.color}10`, border:`1px solid ${pm.color}25` }}>
                <p className="font-bold mb-1" style={{ color: pm.color }}>📋 מה צריך לפני?</p>
                <p style={{ color: c.textSecondary }}>
                  צור אפליקציה ב-{pm.label} Developer Portal, קבל Client ID ו-Client Secret,
                  הגדר Redirect URI: <code className="font-mono text-[10px] px-1 py-0.5 rounded" style={{ background: c.subtleBg }}>{window.location.origin}/oauth/{pm.id}/callback</code>
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold mb-1" style={{ color: c.textMuted }}>Client ID</label>
                  <input value={credClientId} onChange={e => setCredClientId(e.target.value)}
                    placeholder={`${pm.label} Client ID`} dir="ltr"
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                    style={{ background: c.inputBg, border:`1px solid ${c.inputBorder}`, color: c.inputText,
                      focusRingColor: pm.color }} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1" style={{ color: c.textMuted }}>Client Secret</label>
                  <input value={credSecret} onChange={e => setCredSecret(e.target.value)}
                    placeholder={`${pm.label} Client Secret`} dir="ltr" type="password"
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                    style={{ background: c.inputBg, border:`1px solid ${c.inputBorder}`, color: c.inputText }} />
                </div>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setCredModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: c.subtleBg, color: c.textMuted }}>ביטול</button>
                <button onClick={() => handleConnect(credModal)} disabled={!credClientId || !!connectingId}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center gap-1.5"
                  style={{ background:`linear-gradient(135deg,${pm.color},${pm.color}cc)` }}>
                  {connectingId === credModal ? <><Loader2 size={13} className="animate-spin"/> מחבר...</> : <><Plus size={13}/> חבר</>}
                </button>
              </div>

              {/* Mini guide */}
              {GUIDES[credModal]?.steps && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold" style={{ color: c.textMuted }}>📖 צעדים מהירים:</p>
                  {GUIDES[credModal].steps.slice(0,3).map(({ n, title }) => (
                    <div key={n} className="flex items-center gap-2 text-[10px]" style={{ color: c.textSecondary }}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0"
                        style={{ background:`${pm.color}20`, color: pm.color, border:`1px solid ${pm.color}35` }}>{n}</span>
                      {title}
                    </div>
                  ))}
                  <a href={GUIDES[credModal].docsUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: pm.color }}>
                    <ExternalLink size={9}/> תיעוד מלא
                  </a>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Ask RAY modal ──────────────────────────────────────────────────────── */}
      {aiPlatform && (() => {
        const pm = PLATFORMS.find(p => p.id === aiPlatform)!;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" dir="rtl">
            <div className="rounded-3xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4"
              style={{ background: c.cardBg, border:'1px solid rgba(139,92,246,0.4)' }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                    style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    <Sparkles size={14} className="text-white"/>
                  </div>
                  <div>
                    <h3 className="font-black text-sm" style={{ color: c.textPrimary }}>שאל את ריי AI</h3>
                    <p className="text-[10px]" style={{ color: c.textMuted }}>עזרה בחיבור {pm.label}</p>
                  </div>
                </div>
                <button onClick={() => { setAiPlatform(null); setAiA(''); setAiQ(''); }}
                  className="p-1.5 rounded-xl" style={{ color: c.textMuted, background: c.subtleBg }}>
                  <X size={16}/>
                </button>
              </div>

              {/* Suggested questions */}
              <div className="flex flex-wrap gap-1.5">
                {[
                  `איך יוצרים App ב-${pm.label}?`,
                  `מה ה-scopes הנדרשים ל-${pm.label}?`,
                  `מה ה-Redirect URI שצריך להגדיר?`,
                  `מה עושים אם החיבור נכשל?`,
                ].map(q => (
                  <button key={q} onClick={() => setAiQ(q)}
                    className="text-[10px] font-semibold px-2 py-1 rounded-lg transition-all"
                    style={{ background:'rgba(139,92,246,0.1)', border:'1px solid rgba(139,92,246,0.25)', color:'#a78bfa' }}>
                    {q}
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input value={aiQ} onChange={e => setAiQ(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAskRay()}
                  placeholder={`שאל שאלה על חיבור ${pm.label}...`}
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  style={{ background: c.inputBg, border:`1px solid ${c.inputBorder}`, color: c.inputText }} />
                <button onClick={handleAskRay} disabled={!aiQ.trim() || aiLoading}
                  className="px-4 py-2.5 rounded-xl font-bold text-white disabled:opacity-50 flex items-center gap-1.5"
                  style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                  {aiLoading ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}
                </button>
              </div>

              {/* Answer */}
              {aiLoading && (
                <div className="flex items-center gap-2 p-4 rounded-xl" style={{ background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.15)' }}>
                  <Loader2 size={14} className="animate-spin" style={{ color:'#a78bfa' }}/>
                  <p className="text-sm" style={{ color: c.textMuted }}>ריי חושב...</p>
                </div>
              )}
              {aiA && !aiLoading && (
                <div className="p-4 rounded-xl max-h-60 overflow-y-auto" style={{ background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.2)', scrollbarWidth:'thin' }}>
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      <Bot size={12} className="text-white"/>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: c.textPrimary }}>{aiA}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      </>)}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════ */
export default function Integrations({
  leads, workspace, team: _team, onLeadClick, onToast, onWorkspaceUpdate,
}: Props) {
  const { isDark, c } = useTheme();
  const [copied,       setCopied]       = useState(false);
  const [generating,   setGenerating]   = useState(false);
  const [whSecret,     setWhSecret]     = useState(workspace.webhookSecret ?? '');
  const [guideOpen,    setGuideOpen]    = useState<string | null>(null);
  const [filterSrc,    setFilterSrc]    = useState<string>('all');

  // ── Meta state ────────────────────────────────────────────────────────────
  const [metaAppId,       setMetaAppId]       = useState(workspace.metaAppId ?? '');
  const [metaAppSecret,   setMetaAppSecret]   = useState(workspace.metaAppSecret ?? '');
  const [showSecret,      setShowSecret]      = useState(false);
  const [metaSaving,      setMetaSaving]      = useState(false);
  const [metaPages,       setMetaPages]       = useState<MetaPage[]>(workspace.metaIntegration?.pages ?? []);
  const [metaConnected,   setMetaConnected]   = useState(workspace.metaIntegration?.connected ?? false);
  const [subscribing,     setSubscribing]     = useState<string | null>(null);
  const [disconnecting,   setDisconnecting]   = useState(false);
  const [metaSection,     setMetaSection]     = useState<'setup'|'guide'|'pages'|'social'>('setup');

  // ── Google Ads state ──────────────────────────────────────────────────────
  const [googleAdsKey,    setGoogleAdsKey]    = useState(workspace.googleAdsWebhookKey ?? '');
  const [googleKeySaving, setGoogleKeySaving] = useState(false);

  // ── Google social connection (OAuth) ─────────────────────────────────────
  const [googleSocialConn, setGoogleSocialConn] = useState<SocialConnection | null>(null);

  useEffect(() => {
    if (!workspace.id) return;
    loadSocialConnections(workspace.id).then(conns => {
      const g = conns.find(c => c.platform === 'google');
      setGoogleSocialConn(g ?? null);
    }).catch(() => {});
  }, [workspace.id]);

  // Sync Meta connection status from live workspace data (handles async load + re-mount)
  useEffect(() => {
    const connected = workspace.metaIntegration?.connected ?? false;
    const pages     = workspace.metaIntegration?.pages ?? [];
    setMetaConnected(connected);
    setMetaPages(pages);
    if (connected && pages.length > 0) setMetaSection('pages');
  }, [workspace.metaIntegration?.connected, workspace.id]); // eslint-disable-line

  const metaExpiresAt = workspace.metaIntegration?.expiresAt
    ? new Date(workspace.metaIntegration.expiresAt).toLocaleDateString('he-IL')
    : null;

  // Encode both workspaceId and current origin in state so callback can redirect back correctly
  const metaState = btoa(`${workspace.id}|${window.location.origin}`);
  const metaOAuthLink = metaAppId
    ? `https://www.facebook.com/dialog/oauth?` +
      `client_id=${metaAppId}` +
      `&redirect_uri=${encodeURIComponent(META_OAUTH_URL)}` +
      `&scope=${META_SCOPES}` +
      `&state=${metaState}` +
      `&response_type=code`
    : null;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSaveMetaCreds = async () => {
    if (!metaAppId.trim()) { onToast('App ID חסר', 'error'); return; }
    setMetaSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        metaAppId:     metaAppId.trim(),
        metaAppSecret: metaAppSecret.trim(),
      });
      await onWorkspaceUpdate();
      onToast('פרטי האפליקציה נשמרו ✓', 'success');
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setMetaSaving(false); }
  };

  const handleMetaSubscribe = async (pageId: string, subscribe: boolean) => {
    setSubscribing(pageId);
    try {
      await httpsCallable(getFunctions(), 'metaSubscribePage')({ workspaceId: workspace.id, pageId, subscribe });
      setMetaPages(prev => prev.map(p => p.id === pageId ? { ...p, subscribed: subscribe } : p));
      onToast(subscribe ? 'דף מנוי לקבלת לידים ✓' : 'הדף הוסר ממנוי ✓', 'success');
    } catch (err: unknown) {
      onToast(`שגיאה: ${(err as { message?: string }).message ?? 'שגיאה'}`, 'error');
    } finally { setSubscribing(null); }
  };

  const handleMetaDisconnect = async () => {
    if (!window.confirm('לנתק את חיבור Facebook?')) return;
    setDisconnecting(true);
    try {
      await httpsCallable(getFunctions(), 'metaDisconnect')({ workspaceId: workspace.id });
      setMetaConnected(false); setMetaPages([]); setMetaSection('setup');
      await onWorkspaceUpdate();
      onToast('Facebook נותק', 'info');
    } catch { onToast('שגיאה בניתוק', 'error'); }
    finally { setDisconnecting(false); }
  };

  const handleSaveGoogleKey = async () => {
    setGoogleKeySaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { googleAdsWebhookKey: googleAdsKey.trim() || null });
      await onWorkspaceUpdate();
      onToast(googleAdsKey.trim() ? 'מפתח Google Ads נשמר ✓' : 'המפתח הוסר ✓', 'success');
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setGoogleKeySaving(false); }
  };

  const handleGenerateSecret = async () => {
    setGenerating(true);
    const newSecret = `wh_${Math.random().toString(36).slice(2,10)}${Math.random().toString(36).slice(2,10)}`;
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { webhookSecret: newSecret });
      setWhSecret(newSecret);
      await onWorkspaceUpdate();
      onToast('Webhook URL נוצר ✓', 'success');
    } catch { onToast('שגיאה ביצירת ה-URL', 'error'); }
    finally { setGenerating(false); }
  };

  const handleCopy = (text?: string) => {
    const t = text ?? webhookUrl;
    if (!t) return;
    navigator.clipboard.writeText(t).then(() => {
      if (!text) { setCopied(true); setTimeout(() => setCopied(false), 2500); }
      onToast('הועתק ✓', 'success');
    });
  };

  // ── Data ──────────────────────────────────────────────────────────────────
  const webhookUrl     = whSecret ? `${WEBHOOK_BASE}?ws=${workspace.id}&key=${whSecret}` : '';
  const webhookLeads   = useMemo(() => leads.filter(l => l.id.startsWith('wh_')), [leads]);
  const googleLeads    = useMemo(() => webhookLeads.filter(l => l.source === 'גוגל'), [webhookLeads]);
  const fbLeads        = useMemo(() => webhookLeads.filter(l => l.source === 'פייסבוק' || l.source === 'אינסטגרם'), [webhookLeads]);

  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }, []);
  const todayISO   = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }, []);

  const leadsToday    = useMemo(() => webhookLeads.filter(l => (l.createdAt ?? 0) >= todayStart), [webhookLeads, todayStart]);
  const leadsThisWeek = useMemo(() => webhookLeads.filter(l => (l.createdAt ?? 0) >= todayStart - 7*86_400_000), [webhookLeads, todayStart]);

  const dailyData = useMemo(() => {
    return Array.from({ length:7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6-i)); d.setHours(0,0,0,0);
      const next = new Date(d); next.setDate(next.getDate()+1);
      return {
        name:  d.toLocaleDateString('he-IL', { weekday:'short', day:'numeric' }),
        count: webhookLeads.filter(l => { const t = l.createdAt??0; return t>=d.getTime() && t<next.getTime(); }).length,
        ts:    d.getTime(),
      };
    });
  }, [webhookLeads]);

  const sourceBreakdown = useMemo(() => {
    const c: Record<string,number> = {};
    webhookLeads.forEach(l => { c[l.source] = (c[l.source]??0)+1; });
    return Object.entries(c).sort((a,b) => b[1]-a[1]);
  }, [webhookLeads]);

  const recentLeads = useMemo(() => {
    const base = filterSrc==='all' ? webhookLeads : webhookLeads.filter(l => l.source===filterSrc);
    return [...base].sort((a,b) => (b.createdAt??0)-(a.createdAt??0)).slice(0,20);
  }, [webhookLeads, filterSrc]);

  const tooltipStyle = {
    contentStyle: { background:'rgba(10,15,30,0.95)', border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, color: c.textPrimary, fontSize:12 },
    labelStyle:   { color: c.textSecondary },
    cursor:       { fill:'rgba(99,102,241,0.06)' },
  };

  const activePlatforms = (whSecret ? 1 : 0) + (metaConnected ? 1 : 0) + (googleLeads.length > 0 ? 1 : 0);

  // ── Guide steps ──────────────────────────────────────────────────────────
  const WEBHOOK_GUIDES = [
    { id:'zapier', title:'⚡ Zapier', color:'#f97316',
      steps:['צור Zap חדש','Trigger: פלטפורמת המודעות שלך','Action: Webhooks by Zapier → POST',`URL: הדבק את ה-Webhook URL שלך`,'Body Type: JSON | שדות: name, email, phone, company','הפעל — לידים ייכנסו אוטומטית'] },
    { id:'make', title:'🔄 Make (Integromat)', color:'#8b5cf6',
      steps:['צור Scenario חדש','Module של הפלטפורמה שלך','הוסף HTTP → Make a request','Method: POST | URL: ה-Webhook','Body: JSON עם שדות name, email, phone, company'] },
    { id:'curl', title:'🌐 בדיקת cURL ידנית', color:'#10b981',
      steps:['שלח POST request ל-URL','Header: Content-Type: application/json','Body: {"name":"שם","email":"מייל","phone":"טלפון","company":"חברה"}','שדות נוספים: budget, utm_source, source','תשובה: {"success":true,"leadId":"..."}'] },
  ];

  return (
    <div className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6 space-y-5" dir="rtl"
      style={{ background: c.pageBg, backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize, minHeight:'calc(100vh - 56px)' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.3),rgba(139,92,246,0.2))', border:'1px solid rgba(99,102,241,0.35)' }}>
            <PlugZap size={16} style={{ color: c.accentText }}/>
          </div>
          <div>
            <h1 className="text-lg font-black" style={{ color: c.textPrimary }}>אינטגרציות</h1>
            <p className="text-[12px]" style={{ color: c.textMuted }}>חיבור פלטפורמות מודעות ומשיכת לידים אוטומטית</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]" style={{ color: c.textMuted }}>
          <div className={`w-2 h-2 rounded-full ${whSecret ? 'bg-emerald-500' : 'bg-red-500/60'}`}/>
          {whSecret ? 'Webhook פעיל' : 'Webhook לא מוגדר'}
        </div>
      </div>

      {/* ── KPIs ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <NeonKpiCard icon={Zap}        label="סה״כ לידים נכנסים"  value={String(webhookLeads.length)} sub="מכל האינטגרציות"   neon="#6366f1" percent={Math.min(100,(webhookLeads.length/Math.max(leads.length,1))*100)}/>
        <NeonKpiCard icon={TrendingUp} label="השבוע"               value={String(leadsThisWeek.length)} sub="7 ימים אחרונים"  neon="#10b981" percent={leadsThisWeek.length>0?60:0}/>
        <NeonKpiCard icon={Clock}      label="היום"                value={String(leadsToday.length)}   sub={todayISO}          neon="#f97316" percent={leadsToday.length>0?80:0}/>
        <NeonKpiCard icon={Users}      label="פלטפורמות פעילות"   value={String(activePlatforms)}     sub="מחוברות ופעילות"   neon="#8b5cf6" percent={activePlatforms*25}/>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
           WEBHOOK URL (universal)
         ══════════════════════════════════════════════════════════════════════ */}
      <div style={glass}>
        <div className="flex items-center justify-between mb-4">
          <button onClick={handleGenerateSecret} disabled={generating}
            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all"
            style={{ background: whSecret?'rgba(255,255,255,0.04)':'rgba(99,102,241,0.15)',
              border: whSecret?'1px solid rgba(255,255,255,0.1)':'1px solid rgba(99,102,241,0.4)',
              color:  whSecret?'rgba(255,255,255,0.4)':'#818cf8' }}>
            {generating ? <Loader2 size={11} className="animate-spin"/> : <RefreshCw size={11}/>}
            {whSecret ? 'צור מחדש' : 'צור Webhook URL'}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-1 h-4 rounded-full" style={{ background:'linear-gradient(180deg,#6366f1,#6366f180)' }}/>
            <h2 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>🪝 Webhook URL אוניברסלי</h2>
          </div>
        </div>

        {webhookUrl ? (
          <>
            <div className="rounded-xl p-3 flex items-center gap-2 mb-2"
              style={{ background:'rgba(0,0,0,0.35)', border:'1px solid rgba(99,102,241,0.25)', fontFamily:'monospace' }}>
              <p className="flex-1 text-[11px] truncate select-all" style={{ color: c.accentText, direction:'ltr' }}>
                {webhookUrl}
              </p>
              <button onClick={() => handleCopy()}
                className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex-shrink-0 transition-all"
                style={copied
                  ? { background:'rgba(16,185,129,0.15)', border:'1px solid rgba(16,185,129,0.35)', color:'#10b981' }
                  : { background:'rgba(99,102,241,0.12)', border:'1px solid rgba(99,102,241,0.3)', color: c.accentText }}>
                {copied ? <CheckCircle2 size={12}/> : <Copy size={12}/>}
                {copied ? 'הועתק!' : 'העתק'}
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] mb-3" style={{ color: c.textMuted }}>
              <Shield size={9}/> URL מאובטח עם מפתח ייחודי. השתמש בו בכל הפלטפורמות למטה.
            </div>

            {/* API Key display */}
            <ApiKeySection webhookSecret={workspace.webhookSecret ?? ''} onToast={onToast} />


            {/* Guides accordion */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold mb-2" style={{ color: c.textMuted }}>מדריך חיבור מהיר</p>
              {WEBHOOK_GUIDES.map(({ id, title, color, steps }) => (
                <div key={id} className="rounded-xl overflow-hidden" style={{ border:`1px solid ${color}20` }}>
                  <button onClick={() => setGuideOpen(g => g===id?null:id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 transition-all"
                    style={{ background: guideOpen===id?`${color}10`:'rgba(255,255,255,0.02)' }}>
                    <span className="text-[12px] font-semibold" style={{ color: c.textPrimary }}>{title}</span>
                    {guideOpen===id ? <ChevronUp size={13} style={{ color: c.textMuted }}/> : <ChevronDown size={13} style={{ color: c.textMuted }}/>}
                  </button>
                  {guideOpen===id && (
                    <div className="px-4 py-3" style={{ background:'rgba(0,0,0,0.2)', borderTop:`1px solid ${color}15` }}>
                      <ol className="space-y-1.5">
                        {steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs" style={{ color: c.textSecondary }}>
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                              style={{ background:`${color}20`, color }}>{i+1}</span>
                            {step}
                          </li>
                        ))}
                      </ol>
                      {id==='curl' && (
                        <div className="mt-3">
                          <CodeBlock label="cURL example" code={`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"ישראל ישראלי","email":"israel@example.com","phone":"0501234567","company":"חברה בדיקה"}'`}
                            onCopy={() => onToast('cURL הועתק ✓', 'success')}/>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-xl p-6 text-center" style={{ background: c.subtleBg, border:'1px dashed rgba(255,255,255,0.1)' }}>
            <Webhook size={24} className="mx-auto mb-2" style={{ color: c.textMuted }}/>
            <p className="text-sm font-semibold mb-1" style={{ color: c.textMuted }}>עדיין אין Webhook URL</p>
            <p className="text-xs" style={{ color: c.textMuted }}>לחץ "צור Webhook URL" כדי להתחיל לקבל לידים</p>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
           FACEBOOK / META INTEGRATION
         ══════════════════════════════════════════════════════════════════════ */}
      <PlatformSection id="facebook" name="Facebook & Instagram Lead Ads"
        emoji="🔵" color="#1877f2" badge="OAuth ישיר"
        leadCount={fbLeads.length} connected={metaConnected || (workspace.metaIntegration?.connected ?? false)}>

        {/* Status bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          {metaConnected && (
            <button onClick={handleMetaDisconnect} disabled={disconnecting}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg"
              style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171' }}>
              {disconnecting ? <Loader2 size={11} className="animate-spin"/> : <Link2Off size={11}/>} נתק
            </button>
          )}
          <div className="flex gap-1 mr-auto flex-wrap">
            {(['setup','guide','pages','social'] as const).filter(t => t!=='pages' || metaConnected || (workspace.metaIntegration?.connected ?? false)).map(tab => (
              <button key={tab} onClick={() => setMetaSection(tab)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all"
                style={metaSection===tab
                  ? { background:'rgba(24,119,242,0.2)', border:'1px solid rgba(24,119,242,0.4)', color:'#60a5fa' }
                  : { background:'transparent', border:'1px solid transparent', color: c.textMuted }}>
                {tab==='setup'?'⚙️ הגדרות':tab==='guide'?'📖 איך זה עובד':tab==='social'?'📱 פרסום ברשתות':`📋 דפים (${metaPages.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* ── HOW IT WORKS tab ──────────────────────────────────────────────── */}
        {metaSection==='guide' && (
          <div className="space-y-4">
            {/* Architecture flow */}
            <div className="rounded-xl p-4" style={{ background:'rgba(24,119,242,0.06)', border:'1px solid rgba(24,119,242,0.15)' }}>
              <p className="text-[12px] font-bold mb-4 text-right" style={{ color: c.textPrimary }}>🔄 איך הזרימה עובדת</p>
              <div className="flex items-center gap-2 flex-wrap justify-center text-center">
                {[
                  { icon:'👤', title:'לקוח ממלא טופס', sub:'ב-Facebook / Instagram Ads' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'🔵', title:'Facebook שולח', sub:'התראה בזמן אמת' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'⚙️', title:'שרת RAY CRM', sub:'מושך פרטים דרך Graph API' },
                  { icon:'→', title:'', sub:'' },
                  { icon:'✅', title:'ליד נוצר', sub:'בסביבת העבודה שלך' },
                ].map((s, i) => (
                  s.icon==='→'
                    ? <ArrowRight key={i} size={16} style={{ color: c.textMuted, flexShrink:0 }}/>
                    : <div key={i} className="flex flex-col items-center gap-1 min-w-[80px]">
                        <span className="text-2xl">{s.icon}</span>
                        <p className="text-[10px] font-bold" style={{ color: c.textPrimary }}>{s.title}</p>
                        <p className="text-[9px]" style={{ color: c.textMuted }}>{s.sub}</p>
                      </div>
                ))}
              </div>
            </div>

            {/* Why custom app */}
            <div className="space-y-2">
              <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>❓ למה צריך ליצור אפליקציה ב-Facebook?</p>
              <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
                Facebook דורשת שכל מערכת CRM תייצג את עצמה כ"אפליקציה". זה אחד-פעמי בלבד — אחרי שיצרת את האפליקציה, החיבור אוטומטי לגמרי.
                הלידים מגיעים <strong style={{ color: c.textPrimary }}>תוך שניות</strong> מרגע שהלקוח מילא את הטופס.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
                {[
                  { emoji:'🔐', title:'אבטחה מלאה', desc:'ה-App Secret נשמר בשרת בלבד, לא נחשף ללקוח' },
                  { emoji:'⚡', title:'זמן אמת', desc:'ליד מגיע בתוך 2-5 שניות מרגע מילוי הטופס' },
                  { emoji:'🔄', title:'ללא Zapier', desc:'חיבור ישיר — ללא עלויות נוספות של כלי אוטומציה' },
                ].map(f => (
                  <div key={f.emoji} className="rounded-xl p-3 text-center" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <span className="text-xl">{f.emoji}</span>
                    <p className="text-[11px] font-bold mt-1" style={{ color: c.textPrimary }}>{f.title}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Common issues */}
            <div>
              <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>🛠️ שאלות נפוצות</p>
              <div className="space-y-2">
                {[
                  { q:'הכפתור "התחבר עם Facebook" לא עובד', a:'וודא שהזנת App ID תקין ולחצת "שמור פרטים" לפני שמנסה להתחבר.' },
                  { q:'אין לי דפים ב-Facebook ←"דפים"', a:'ודא שהחשבון שהתחברת איתו הוא מנהל הדף. הרשאות נדרשות: pages_show_list + pages_read_engagement.' },
                  { q:'הלידים לא מגיעים אחרי ההפעלה', a:'בדוק שה-Webhook URL מוגדר ושהדף מנוי (✓ "הפעל לידים"). Facebook שולח רק לידים חדשים אחרי ההפעלה.' },
                  { q:'"Token פג תוקף" — מה עושים?', a:'הטוקן של Facebook תקף ~60 יום. לחץ "חדש את חיבור Facebook" בלשונית ⚙️ הגדרות כדי לחדש.' },
                ].map(({ q, a }) => (
                  <div key={q} className="rounded-xl p-3" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                    <p className="text-[11px] font-bold mb-1" style={{ color: c.textPrimary }}>❓ {q}</p>
                    <p className="text-[11px]" style={{ color: c.textSecondary }}>→ {a}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── SETUP tab ─────────────────────────────────────────────────────── */}
        {metaSection==='setup' && (
          <div className="space-y-5">

            {/* Step 1 — Create FB App */}
            <div className="rounded-xl p-4" style={{ background:'rgba(24,119,242,0.06)', border:'1px solid rgba(24,119,242,0.15)' }}>
              <div className="flex items-start gap-3 mb-3">
                <StepBadge n={1} color="#1877f2" done={!!metaAppId}/>
                <div className="flex-1">
                  <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>צור אפליקציה ב-Facebook Developers</p>
                  <p className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>פעם אחת בלבד — אוצר 5 דקות</p>
                </div>
              </div>
              <div className="mr-9 space-y-2">
                <ol className="space-y-2">
                  {[
                    <span key="1">כנס ל-<a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#60a5fa' }}>developers.facebook.com/apps</a></span>,
                    'לחץ "Create App" ← בחר סוג "Business"',
                    'שם האפליקציה: RAY CRM (או כל שם שתרצה)',
                    'הוסף את מוצר Lead Ads Retrieval: לחץ "+ Add Product" ← Lead Ads Retrieval',
                    'ב-Valid OAuth Redirect URIs — הוסף את ה-URI הבא:',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-[11px]" style={{ color: c.textSecondary }}>
                      <CheckCircle2 size={13} style={{ color:'rgba(24,119,242,0.6)', flexShrink:0, marginTop:1 }}/>
                      {step}
                    </li>
                  ))}
                </ol>
                <CodeBlock label="OAuth Redirect URI — הדבק בהגדרות האפליקציה" code={META_OAUTH_URL}
                  onCopy={() => onToast('Redirect URI הועתק ✓', 'success')}/>
                <InfoBanner icon={Info} color="#60a5fa"
                  text="חשוב: URI הזה חייב להיות מוגדר באפליקציה שלך ב-Facebook לפני שמנסים להתחבר."/>
              </div>
            </div>

            {/* Step 2 — Credentials */}
            <div className="rounded-xl p-4" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={2} color="#1877f2" done={!!(metaAppId && metaAppSecret)}/>
                <div>
                  <p className="text-[13px] font-bold" style={{ color: c.textPrimary }}>הכנס App ID ו-App Secret</p>
                  <p className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>
                    מצא אותם ב-App Dashboard → Settings → Basic
                  </p>
                </div>
              </div>
              <div className="mr-9 space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold mb-1.5" style={{ color: c.textMuted }}>
                    App ID <span style={{ color: c.textMuted }}>(מזהה אפליקציה — ציבורי)</span>
                  </label>
                  <input value={metaAppId} onChange={e => setMetaAppId(e.target.value)}
                    placeholder="1234567890123456" dir="ltr"
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none font-mono"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold mb-1.5" style={{ color: c.textMuted }}>
                    App Secret <span style={{ color: c.textMuted }}>(סוד האפליקציה — שמור בסוד!)</span>
                  </label>
                  <div className="relative">
                    <input value={metaAppSecret} onChange={e => setMetaAppSecret(e.target.value)}
                      type={showSecret?'text':'password'} placeholder="••••••••••••••••••••••••" dir="ltr"
                      className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none font-mono"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
                    <button onClick={() => setShowSecret(s => !s)} className="absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: c.textMuted }}>
                      {showSecret ? <EyeOff size={14}/> : <Eye size={14}/>}
                    </button>
                  </div>
                  <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: c.textMuted }}>
                    <Shield size={9}/> מאוחסן בצורה מוצפנת בשרת — לא נחשף בצד הלקוח לעולם
                  </p>
                </div>
                <button onClick={handleSaveMetaCreds} disabled={metaSaving}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
                  style={{ background:'rgba(24,119,242,0.15)', border:'1px solid rgba(24,119,242,0.35)', color:'#60a5fa' }}>
                  {metaSaving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}
                  שמור פרטים
                </button>
              </div>
            </div>

            {/* Step 3 — Connect */}
            <div className="rounded-xl p-4" style={{ background: metaOAuthLink ? 'rgba(24,119,242,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${metaOAuthLink ? 'rgba(24,119,242,0.2)' : 'rgba(255,255,255,0.07)'}` }}>
              <div className="flex items-start gap-3 mb-4">
                <StepBadge n={3} color="#1877f2" done={metaConnected}/>
                <div>
                  <p className="text-[13px] font-bold" style={{ color: metaOAuthLink?'white':'rgba(255,255,255,0.4)' }}>
                    {metaConnected ? '✓ מחובר ל-Facebook' : 'התחבר עם Facebook'}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>
                    {metaConnected
                      ? `${metaPages.length} דפים · פג תוקף: ${metaExpiresAt}`
                      : 'לחץ כדי לפתוח את חלון ההרשאה של Facebook'}
                  </p>
                </div>
              </div>
              <div className="mr-9 space-y-3">
                {metaOAuthLink ? (
                  <>
                    <a href={metaOAuthLink}
                      className="inline-flex items-center gap-2.5 px-5 py-3 rounded-xl font-bold text-sm"
                      style={{ background:'linear-gradient(135deg,#1877f2,#0a58ca)', color: 'white',
                        boxShadow:'0 4px 20px rgba(24,119,242,0.35)', textDecoration:'none' }}>
                      <span className="text-lg">🔵</span>
                      {metaConnected ? 'חדש את חיבור Facebook' : 'התחבר עם Facebook'}
                      <ExternalLink size={14}/>
                    </a>
                    <p className="text-[10px]" style={{ color: c.textMuted }}>
                      לחיצה תפתח חלון Facebook → אשר הרשאות → תוחזר אוטומטית לכאן.
                    </p>
                    {metaConnected && !workspace.metaIntegration?.hasPostingPermission && (
                      <div className="rounded-xl p-3 flex items-start gap-2"
                        style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
                        <span className="text-sm mt-0.5">⚠️</span>
                        <div className="flex-1">
                          <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#fbbf24' }}>
                            נדרשת הרשאה נוספת לפרסום. לחץ 'חבר מחדש' כדי לאפשר פרסום פוסטים.
                          </p>
                          <a href={metaOAuthLink ?? '#'}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                            style={{ background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', color: '#fbbf24', textDecoration: 'none' }}>
                            <span>🔵</span> חבר מחדש
                          </a>
                        </div>
                      </div>
                    )}
                    {metaConnected && workspace.metaIntegration?.hasPostingPermission && (
                      <InfoBanner icon={Info} color="#10b981"
                        text="הכל מוגדר! עבור ללשונית 📋 דפים כדי להפעיל קבלת לידים לכל דף."/>
                    )}
                    {metaConnected && !workspace.metaIntegration?.hasPostingPermission && (
                      <InfoBanner icon={Info} color="#6366f1"
                        text="מחובר לקבלת לידים. חבר מחדש כדי לאפשר גם פרסום פוסטים."/>
                    )}
                  </>
                ) : (
                  <InfoBanner color="#f59e0b"
                    text="שמור App ID ו-App Secret קודם (שלב 2) כדי להפעיל את כפתור החיבור."/>
                )}
              </div>
            </div>

          </div>
        )}

        {/* ── PAGES tab ─────────────────────────────────────────────────────── */}
        {metaSection==='pages' && (metaConnected || (workspace.metaIntegration?.connected ?? false)) && (
          <div className="space-y-3">
            <InfoBanner icon={Info} color="#60a5fa"
              text="הפעל מנוי לכל דף שתרצה לקבל ממנו לידים. כל ליד שיתקבל ייכנס אוטומטית לסביבת העבודה שלך."/>
            {metaPages.length===0 ? (
              <div className="text-center py-8" style={{ color: c.textMuted }}>
                <p className="text-sm">לא נמצאו דפים — ודא שיש לך הרשאת ניהול דפים</p>
              </div>
            ) : metaPages.map(page => (
              <div key={page.id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: page.subscribed?'rgba(16,185,129,0.05)':'rgba(255,255,255,0.02)',
                  border:`1px solid ${page.subscribed?'rgba(16,185,129,0.2)':'rgba(255,255,255,0.07)'}` }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: page.subscribed?'#10b981':'rgba(255,255,255,0.15)',
                    boxShadow: page.subscribed?'0 0 6px rgba(16,185,129,0.6)':'none' }}/>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-[13px] font-semibold" style={{ color: c.textPrimary }}>{page.name}</p>
                  <p className="text-[10px]" style={{ color: c.textMuted }}>
                    {page.category}
                    {page.fanCount>0 && ` · ${page.fanCount.toLocaleString('he-IL')} עוקבים`}
                    {page.leadCount>0 && ` · ${page.leadCount} לידים`}
                  </p>
                </div>
                <button onClick={() => handleMetaSubscribe(page.id, !page.subscribed)} disabled={subscribing===page.id}
                  className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-all flex-shrink-0"
                  style={page.subscribed
                    ? { background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', color:'#f87171' }
                    : { background:'rgba(16,185,129,0.1)', border:'1px solid rgba(16,185,129,0.3)', color:'#10b981' }}>
                  {subscribing===page.id ? <Loader2 size={11} className="animate-spin"/> : page.subscribed ? <Link2Off size={11}/> : <Link2 size={11}/>}
                  {page.subscribed ? 'בטל מנוי' : 'הפעל לידים'}
                </button>
              </div>
            ))}
            {!whSecret && (
              <InfoBanner text="עדיין אין Webhook URL — צור אחד בסקשן Webhook למעלה כדי שהלידים יגיעו."/>
            )}

            {/* Fetched Ad Accounts */}
            {metaConnected && workspace.metaIntegration?.adAccounts && workspace.metaIntegration.adAccounts.length > 0 && (
              <div className="mt-4 p-3 rounded-xl border" style={{ borderColor: 'rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                <div className="text-sm font-bold mb-2" style={{ color: c.textPrimary }}>
                  💰 חשבונות פרסום (Facebook Ads)
                </div>
                <div className="space-y-1.5">
                  {workspace.metaIntegration.adAccounts.filter(a => a.status === 'ACTIVE').map(acc => (
                    <div key={acc.id} className="flex items-center justify-between text-xs px-2 py-1.5 rounded-lg"
                      style={{ background: c.subtleBg }}>
                      <span style={{ color: c.textPrimary }}>{acc.name || `חשבון ${acc.id}`}</span>
                      <div className="flex items-center gap-2">
                        <span style={{ color: c.textMuted }}>{acc.currency}</span>
                        {acc.hasPaymentMethod
                          ? <span className="text-green-400 text-[10px]">✓ תשלום</span>
                          : <span className="text-amber-400 text-[10px]">⚠ אין תשלום</span>}
                      </div>
                    </div>
                  ))}
                </div>
                {workspace.metaIntegration.adAccounts.filter(a => a.status !== 'ACTIVE').length > 0 && (
                  <div className="text-[10px] mt-1" style={{ color: c.textMuted }}>
                    + {workspace.metaIntegration.adAccounts.filter(a => a.status !== 'ACTIVE').length} חשבונות לא פעילים
                  </div>
                )}
              </div>
            )}
            {metaConnected && (!workspace.metaIntegration?.adAccounts || workspace.metaIntegration.adAccounts.length === 0) && (
              <div className="mt-4 p-3 rounded-xl border text-xs" style={{ borderColor: '#f59e0b40', background: '#f59e0b08' }}>
                <span className="text-amber-400">💡 חבר מחדש כדי לטעון חשבונות פרסום אוטומטית</span>
              </div>
            )}
          </div>
        )}

        {/* ── SOCIAL PUBLISHING tab ─────────────────────────────────────────── */}
        {metaSection==='social' && (
          <div className="space-y-4">
            <div className="rounded-xl p-4" style={{ background:'rgba(24,119,242,0.06)', border:'1px solid rgba(24,119,242,0.15)' }}>
              <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>📱 פרסום לפייסבוק ואינסטגרם</p>
              <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
                אחרי שחיברת את Meta (בלשונית ⚙️ הגדרות), תוכל לפרסם פוסטים ישירות לדפי פייסבוק ולחשבונות אינסטגרם מהמערכת — ללא יציאה לפלטפורמה.
              </p>
            </div>

            {/* Facebook */}
            <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(24,119,242,0.3)', background:'rgba(24,119,242,0.04)' }}>
              <div className="flex items-center gap-3 px-4 py-3" style={{ background:'rgba(24,119,242,0.08)', borderBottom:'1px solid rgba(24,119,242,0.12)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background:'rgba(24,119,242,0.15)', border:'1px solid rgba(24,119,242,0.25)' }}>📘</div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: c.textPrimary }}>Facebook</p>
                  <p className="text-[11px]" style={{ color: c.textMuted }}>פרסום פוסטים לדפי פייסבוק</p>
                </div>
                {metaConnected && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.3)', color:'#10b981' }}>✓ מחובר</span>}
              </div>
              <div className="p-4 space-y-2">
                {metaConnected ? (
                  <>
                    <p className="text-[11px]" style={{ color: c.textSecondary }}>✅ פרסום לפייסבוק פעיל! עבור ל<strong style={{ color: c.textPrimary }}>דף שיווק AI</strong> ← <strong style={{ color: c.textPrimary }}>פרסם ברשתות</strong> כדי ליצור ולפרסם פוסטים.</p>
                    {!workspace.metaIntegration?.hasPostingPermission && (
                      <div className="rounded-lg p-2.5 text-[11px]" style={{ background:'rgba(245,158,11,0.08)', border:'1px solid rgba(245,158,11,0.2)', color:'#fbbf24' }}>
                        ⚠️ נדרשת הרשאת פרסום — חבר מחדש בלשונית ⚙️ הגדרות כדי לאפשר פרסום פוסטים.
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: c.textMuted }}>חבר את Meta בלשונית ⚙️ הגדרות כדי לאפשר פרסום לפייסבוק.</p>
                )}
              </div>
            </div>

            {/* Instagram */}
            <div className="rounded-2xl overflow-hidden" style={{ border:'1px solid rgba(228,64,95,0.3)', background:'rgba(228,64,95,0.04)' }}>
              <div className="flex items-center gap-3 px-4 py-3" style={{ background:'rgba(228,64,95,0.08)', borderBottom:'1px solid rgba(228,64,95,0.12)' }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-lg" style={{ background:'rgba(228,64,95,0.15)', border:'1px solid rgba(228,64,95,0.25)' }}>📸</div>
                <div className="flex-1">
                  <p className="text-sm font-bold" style={{ color: c.textPrimary }}>Instagram</p>
                  <p className="text-[11px]" style={{ color: c.textMuted }}>פרסום לחשבונות אינסטגרם עסקיים</p>
                </div>
                {metaConnected && metaPages.some((p: MetaPage) => p.instagramBusinessAccountId) && (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.3)', color:'#10b981' }}>✓ מחובר</span>
                )}
              </div>
              <div className="p-4 space-y-2">
                {metaConnected ? (
                  metaPages.some((p: MetaPage) => p.instagramBusinessAccountId) ? (
                    <p className="text-[11px]" style={{ color: c.textSecondary }}>✅ אינסטגרם מחובר! עבור ל<strong style={{ color: c.textPrimary }}>דף שיווק AI</strong> ← <strong style={{ color: c.textPrimary }}>פרסם ברשתות</strong> כדי לפרסם.</p>
                  ) : (
                    <p className="text-[11px]" style={{ color: c.textMuted }}>לא נמצאו חשבונות אינסטגרם עסקיים — ודא שדפי הפייסבוק שחיברת מקושרים לחשבון אינסטגרם עסקי.</p>
                  )
                ) : (
                  <p className="text-[11px]" style={{ color: c.textMuted }}>חבר את Meta בלשונית ⚙️ הגדרות כדי לאפשר פרסום לאינסטגרם.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl p-3 flex items-start gap-2" style={{ background:'rgba(249,115,22,0.06)', border:'1px solid rgba(249,115,22,0.18)' }}>
              <Info size={13} style={{ color:'#f97316', flexShrink:0, marginTop:1 }}/>
              <p className="text-[11px]" style={{ color: c.textSecondary }}>
                חיבור אחד לשניהם — Facebook ואינסטגרם מנוהלים יחד דרך אינטגרציית Meta. ⚙️ הגדרות → שמור App ID + App Secret → התחבר עם Facebook.
              </p>
            </div>
          </div>
        )}
      </PlatformSection>

      {/* ══════════════════════════════════════════════════════════════════════
           GOOGLE ADS
         ══════════════════════════════════════════════════════════════════════ */}
      <PlatformSection id="google" name="Google Ads Lead Form Extensions"
        emoji="🔴" color="#ea4335" badge="Webhook ישיר"
        leadCount={googleLeads.length} connected={googleLeads.length > 0 || (googleSocialConn?.connected ?? false)}>

        <div className="space-y-4">
          {/* Architecture */}
          <div className="rounded-xl p-4" style={{ background:'rgba(234,67,53,0.06)', border:'1px solid rgba(234,67,53,0.15)' }}>
            <p className="text-[12px] font-bold mb-3" style={{ color: c.textPrimary }}>🔄 זרימה — ללא OAuth, ללא Zapier</p>
            <div className="flex items-center gap-2 flex-wrap justify-center text-center">
              {[
                { icon:'👤', title:'לקוח מחפש', sub:'ב-Google' },
                { icon:'→', title:'', sub:'' },
                { icon:'📋', title:'ממלא טופס ליד', sub:'Google Lead Form' },
                { icon:'→', title:'', sub:'' },
                { icon:'⚡', title:'Google שולח POST', sub:'ל-Webhook URL שלך' },
                { icon:'→', title:'', sub:'' },
                { icon:'✅', title:'ליד נכנס', sub:'לסביבת העבודה' },
              ].map((s, i) => (
                s.icon==='→'
                  ? <ArrowRight key={i} size={14} style={{ color: c.textMuted, flexShrink:0 }}/>
                  : <div key={i} className="flex flex-col items-center gap-1 min-w-[70px]">
                      <span className="text-xl">{s.icon}</span>
                      <p className="text-[10px] font-bold" style={{ color: c.textPrimary }}>{s.title}</p>
                      <p className="text-[9px]" style={{ color: c.textMuted }}>{s.sub}</p>
                    </div>
              ))}
            </div>
          </div>

          <InfoBanner icon={Info} color="#ea4335"
            text="Google Lead Form Extensions תומכות ב-Webhook ישיר — ללא צורך ב-Zapier, Make או כל כלי ביניים. פשוט הדבק את ה-URL שלך."/>

          {/* Steps */}
          <div className="space-y-3">
            <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>📋 הגדרה ב-Google Ads (10 דקות)</p>
            <div className="space-y-2">
              {[
                { n:1, title:'פתח את Google Ads', body:<>כנס ל-<a href="https://ads.google.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#f87171' }}>ads.google.com</a> ← בחר את הקמפיין הרצוי.</> },
                { n:2, title:'הוסף Lead Form Extension', body:'בחר Assets (נכסים) ← Lead Form Extension. אם אין לך כזו, לחץ "+ Create new lead form extension".' },
                { n:3, title:'הגדר Webhook Delivery', body:'גלול למטה בטופס ← Lead Delivery Options ← Webhook ← הדבק את ה-Webhook URL שלך.' },
                { n:4, title:'הגדר Key (אופציונלי)', body:`ב-Lead Delivery ← Key: הכנס את המפתח שהגדרת ב"מפתח אימות Google Ads" למטה. Google ישלח אותו בכל בקשה לאבטחה נוספת.${googleAdsKey ? ` המפתח שלך: "${googleAdsKey}"` : ''}` },
                { n:5, title:'שמור ובדוק', body:'לחץ Save. Google שולח בקשת בדיקה אוטומטית — ודא שקיבלת Toast "ליד נכנס" במערכת.' },
              ].map(({ n, title, body }) => (
                <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <StepBadge n={n} color="#ea4335"/>
                  <div>
                    <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Webhook URL reminder */}
          {webhookUrl ? (
            <div>
              <p className="text-[11px] font-semibold mb-2" style={{ color: c.textSecondary }}>ה-Webhook URL שלך להדבקה ב-Google Ads:</p>
              <CodeBlock label="Google Ads → Lead Form → Webhook URL" code={webhookUrl}
                onCopy={() => onToast('URL הועתק ✓', 'success')}/>
            </div>
          ) : (
            <InfoBanner text="צור Webhook URL תחילה (ראה למעלה) ואז חזור לכאן להדבקה ב-Google Ads."/>
          )}

          {/* Google Ads Webhook Key (optional security) */}
          <div className="rounded-xl p-4" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            <div className="flex items-start gap-3 mb-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background:'rgba(234,67,53,0.15)', border:'1px solid rgba(234,67,53,0.25)' }}>
                <KeyRound size={13} style={{ color:'#f87171' }}/>
              </div>
              <div className="flex-1">
                <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>מפתח אימות Google Ads (אופציונלי)</p>
                <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: c.textMuted }}>
                  Google Ads שולח "Key" קבוע בכל בקשת ליד. הגדר כאן מפתח — המערכת תדחה בקשות ללא המפתח הנכון.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <input
                value={googleAdsKey}
                onChange={e => setGoogleAdsKey(e.target.value)}
                placeholder="my-secret-google-key (אופציונלי)"
                dir="ltr"
                className="flex-1 rounded-xl px-3 py-2.5 text-sm focus:outline-none font-mono"
                style={{ background: isDark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.04)', border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
              />
              <button onClick={handleSaveGoogleKey} disabled={googleKeySaving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all flex-shrink-0"
                style={{ background:'rgba(234,67,53,0.12)', border:'1px solid rgba(234,67,53,0.3)', color:'#f87171' }}>
                {googleKeySaving ? <Loader2 size={13} className="animate-spin"/> : <Save size={13}/>}
                שמור
              </button>
            </div>
            {googleAdsKey && (
              <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: c.textMuted }}>
                <Shield size={9}/>
                ב-Google Ads ← Lead Form ← Lead Delivery ← Key: הכנס את אותו הערך
              </p>
            )}
          </div>

          {/* Field mapping */}
          <div className="rounded-xl overflow-hidden" style={{ border:'1px solid rgba(234,67,53,0.2)' }}>
            <div className="px-4 py-2 flex items-center justify-between"
              style={{ background:'rgba(234,67,53,0.08)', borderBottom:'1px solid rgba(234,67,53,0.15)' }}>
              <span className="text-[10px]" style={{ color: c.textMuted }}>מיפוי אוטומטי</span>
              <p className="text-[11px] font-bold" style={{ color: c.textPrimary }}>שדות שהמערכת מזהה מ-Google</p>
            </div>
            <div className="p-3 grid grid-cols-2 gap-1.5 text-[10px]">
              {[
                ['full_name / FULL_NAME','contactName'],
                ['email','email'],
                ['phone_number / PHONE_NUMBER','phone'],
                ['company_name / COMPANY_NAME','company'],
                ['city / CITY','company (suffix)'],
                ['utm_source / source → "גוגל"','source'],
              ].map(([from, to]) => (
                <div key={from} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <span style={{ color: c.textMuted, fontFamily:'monospace', fontSize:9 }}>{from}</span>
                  <ArrowRight size={9} style={{ color: c.textMuted, flexShrink:0 }}/>
                  <span style={{ color:'#f87171', fontFamily:'monospace', fontSize:9 }}>{to}</span>
                </div>
              ))}
            </div>
          </div>

          {googleLeads.length>0 && (
            <div className="rounded-xl p-3 flex items-center gap-3"
              style={{ background:'rgba(234,67,53,0.06)', border:'1px solid rgba(234,67,53,0.2)' }}>
              <span className="text-2xl">🎉</span>
              <div>
                <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>Google Ads מחובר ועובד!</p>
                <p className="text-[11px]" style={{ color: c.textSecondary }}>{googleLeads.length} לידים התקבלו מ-Google Ads.</p>
              </div>
            </div>
          )}

          {/* ── Google Ads Campaign Manager ── */}
          <div className="pt-2" style={{ borderTop:`1px solid rgba(234,67,53,0.15)` }}>
            <GoogleAdsCampaigns
              workspace={workspace}
              webhookUrl={webhookUrl}
              onToast={onToast}
            />
          </div>

          {/* ── Google OAuth Connection Status ── */}
          {googleSocialConn?.connected && (
            <div className="rounded-xl p-4 flex items-center gap-3"
              style={{ background:'rgba(16,185,129,0.07)', border:'1px solid rgba(16,185,129,0.25)' }}>
              <CheckCircle2 size={18} style={{ color:'#10b981', flexShrink:0 }}/>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>Google מחובר ✓</p>
                {googleSocialConn.accountName && (
                  <p className="text-[11px]" style={{ color: c.textMuted }}>{googleSocialConn.accountName}</p>
                )}
              </div>
              <button
                onClick={async () => {
                  await deleteSocialConnection(workspace.id, 'google');
                  setGoogleSocialConn(null);
                  onToast('Google נותק', 'info');
                }}
                className="text-[11px] px-3 py-1.5 rounded-lg transition-colors"
                style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.25)', color:'#f87171' }}>
                נתק
              </button>
            </div>
          )}

          {/* ── Google Analytics / Social OAuth ── */}
          <div className="rounded-xl p-4" style={{ background:'rgba(234,67,53,0.04)', border:'1px solid rgba(234,67,53,0.15)', borderTop:'1px solid rgba(234,67,53,0.15)' }}>
            <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>📊 Google Analytics & Social OAuth</p>
            <p className="text-[11px] leading-relaxed mb-3" style={{ color: c.textSecondary }}>
              לפרסום ודיווח דרך Google (YouTube Ads, Google Analytics) — חיבור OAuth זמין דרך לשונית פרסום ברשתות.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { emoji:'📈', title:'Google Analytics', desc:'מעקב המרות ודוחות', link:'https://analytics.google.com' },
                { emoji:'▶️', title:'YouTube Ads', desc:'קמפיינים ברשת YouTube', link:'https://ads.google.com' },
              ].map(item => (
                <a key={item.title} href={item.link} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 p-2.5 rounded-xl transition-all"
                  style={{ background: c.subtleBg, border:`1px solid rgba(234,67,53,0.15)`, textDecoration:'none' }}>
                  <span className="text-lg">{item.emoji}</span>
                  <div>
                    <p className="text-[11px] font-bold" style={{ color: c.textPrimary }}>{item.title}</p>
                    <p className="text-[10px]" style={{ color: c.textMuted }}>{item.desc}</p>
                  </div>
                  <ExternalLink size={10} style={{ color: c.textMuted, marginRight:'auto' }}/>
                </a>
              ))}
            </div>
          </div>
        </div>
      </PlatformSection>

      {/* ══════════════════════════════════════════════════════════════════════
           TIKTOK
         ══════════════════════════════════════════════════════════════════════ */}
      <PlatformSection id="tiktok" name="TikTok Lead Generation Ads"
        emoji="🎵" color="#ff0050" badge="Webhook ישיר"
        leadCount={0} connected={false}>

        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background:'rgba(255,0,80,0.06)', border:'1px solid rgba(255,0,80,0.15)' }}>
            <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>💡 TikTok תומכת ב-CRM Webhook ישיר</p>
            <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
              TikTok Ads Manager תומכת בחיבור CRM מובנה — הלידים נשלחים אוטומטית דרך Webhook.
              מגיעים תוך שניות מרגע מילוי הטופס.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>📋 הגדרה ב-TikTok Ads Manager</p>
            <div className="space-y-2">
              {[
                { n:1, title:'כנס ל-TikTok Ads Manager', body:<>כנס ל-<a href="https://ads.tiktok.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color:'#ff6b8a' }}>ads.tiktok.com</a> ← בחר את החשבון הרצוי.</> },
                { n:2, title:'נווט לחיבורי CRM', body:'Tools (כלים) ← Lead Generation ← CRM Connection ← "+ New Connection".' },
                { n:3, title:'בחר "Custom Webhook"', body:'רשימת הפלטפורמות ← גלול למטה ← "Custom" / "Webhook" ← הזן את ה-Webhook URL שלך.' },
                { n:4, title:'מיפוי שדות', body:'TikTok ישאל אותך למפות שדות — Full Name → name, Email → email, Phone → phone.' },
                { n:5, title:'חבר לקמפיין', body:'שמור את החיבור ← בקמפיין שלך ← Lead Generation ← בחר את הטופס ← אפשר את חיבור ה-CRM שיצרת.' },
              ].map(({ n, title, body }) => (
                <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <StepBadge n={n} color="#ff0050"/>
                  <div>
                    <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {webhookUrl ? (
            <div>
              <p className="text-[11px] font-semibold mb-2" style={{ color: c.textSecondary }}>ה-Webhook URL שלך להדבקה ב-TikTok:</p>
              <CodeBlock label="TikTok Ads Manager → CRM Connection → Webhook URL" code={webhookUrl}
                onCopy={() => onToast('URL הועתק ✓', 'success')}/>
            </div>
          ) : (
            <InfoBanner text="צור Webhook URL תחילה (ראה למעלה)."/>
          )}

          {/* Zapier alternative */}
          <div className="rounded-xl p-4" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-[12px] font-bold mb-2" style={{ color: c.textSecondary }}>
              ⚡ חלופה: Zapier / Make (אם CRM Connection לא זמין)
            </p>
            <ol className="space-y-1">
              {[
                'ב-Zapier: Trigger → TikTok Lead Generation (New Lead)',
                'Action → Webhooks by Zapier → POST',
                'URL → ה-Webhook URL שלך | Body: name, email, phone, company',
              ].map((s, i) => (
                <li key={i} className="text-[11px] flex items-start gap-2" style={{ color: c.textMuted }}>
                  <span style={{ color:'rgba(255,0,80,0.7)', flexShrink:0 }}>→</span> {s}
                </li>
              ))}
            </ol>
          </div>

          <InfoBanner icon={Info} color="#ff0050"
            text={<>TikTok Lead Generation זמין רק לחשבונות שמריצים <strong style={{ color: c.textPrimary }}>Lead Generation Objective</strong>. ודא שהקמפיין שלך מוגדר כך.</>}/>
        </div>
      </PlatformSection>

      {/* ══════════════════════════════════════════════════════════════════════
           LINKEDIN
         ══════════════════════════════════════════════════════════════════════ */}
      <PlatformSection id="linkedin" name="LinkedIn Lead Gen Forms"
        emoji="🔷" color="#0077b5" badge="Via Zapier / Make"
        leadCount={0} connected={false}>

        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ background:'rgba(0,119,181,0.06)', border:'1px solid rgba(0,119,181,0.18)' }}>
            <p className="text-[12px] font-bold mb-2" style={{ color: c.textPrimary }}>ℹ️ LinkedIn Lead Gen Forms</p>
            <p className="text-[11px] leading-relaxed" style={{ color: c.textSecondary }}>
              LinkedIn תומכת בחיבור ל-CRM בשתי דרכים: <strong style={{ color: c.textPrimary }}>Zapier/Make</strong> (הכי פשוט)
              או LinkedIn Marketing API (דורש אישור אפליקציה). אנחנו ממליצים על Zapier/Make.
            </p>
          </div>

          {/* Via Zapier */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full"
                style={{ background:'rgba(249,115,22,0.15)', color:'#f97316', border:'1px solid rgba(249,115,22,0.3)' }}>
                ⭐ מומלץ
              </span>
              <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>חיבור דרך Zapier</p>
            </div>
            <div className="space-y-2">
              {[
                { n:1, title:'Trigger: LinkedIn Lead Gen Forms', body:<>ב-Zapier: Trigger ← LinkedIn Lead Gen Forms ← "New Response". חבר את חשבון LinkedIn Ads שלך.</> },
                { n:2, title:'Action: Webhook POST', body:'Action ← Webhooks by Zapier ← POST. URL = ה-Webhook URL שלך.' },
                { n:3, title:'מיפוי שדות', body:'חבר את שדות LinkedIn לשדות JSON: fullName → name, emailAddress → email, phoneNumber → phone, companyName → company.' },
                { n:4, title:'הפעל ובדוק', body:'הפעל את ה-Zap. שלח ליד בדיקה מ-LinkedIn Campaign Manager ← Forms ← "Preview" ← "Submit Test Lead".' },
              ].map(({ n, title, body }) => (
                <div key={n} className="flex gap-3 p-3 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <StepBadge n={n} color="#0077b5"/>
                  <div>
                    <p className="text-[12px] font-bold" style={{ color: c.textPrimary }}>{title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: c.textSecondary }}>{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {webhookUrl ? (
            <div>
              <p className="text-[11px] font-semibold mb-2" style={{ color: c.textSecondary }}>ה-Webhook URL לשימוש ב-Zapier:</p>
              <CodeBlock label="Zapier → Webhooks by Zapier → POST → URL" code={webhookUrl}
                onCopy={() => onToast('URL הועתק ✓', 'success')}/>
            </div>
          ) : (
            <InfoBanner text="צור Webhook URL תחילה (ראה למעלה) ואז שמור אותו ב-Zapier."/>
          )}

          {/* Via Make */}
          <div className="rounded-xl p-4" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-[12px] font-bold mb-2" style={{ color: c.textSecondary }}>🔄 חיבור דרך Make (Integromat)</p>
            <ol className="space-y-1">
              {[
                'Scenario חדש ← Trigger: LinkedIn Ads → Watch Leads',
                'הוסף Module: HTTP → Make a request | Method: POST',
                'URL: ה-Webhook URL שלך | Body Type: Raw | Content Type: JSON',
                'Body: {"name":"{{fullName}}","email":"{{emailAddress}}","phone":"{{phoneNumber}}","company":"{{companyName}}"}',
              ].map((s, i) => (
                <li key={i} className="text-[11px] flex items-start gap-2" style={{ color: c.textMuted }}>
                  <span style={{ color:'rgba(0,119,181,0.7)', flexShrink:0 }}>→</span> {s}
                </li>
              ))}
            </ol>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            {[
              { emoji:'🎯', label:'B2B מצוין', desc:'LinkedIn מביא לידים עסקיים איכותיים' },
              { emoji:'💰', label:'תקציב גבוה', desc:'CPC גבוה אך ערך לקוח גבוה יותר' },
              { emoji:'⏱️', label:'הגדרה קלה', desc:'10 דקות ב-Zapier — ואתה מוכן' },
            ].map(f => (
              <div key={f.emoji} className="rounded-xl p-3" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                <span className="text-xl">{f.emoji}</span>
                <p className="text-[10px] font-bold mt-1" style={{ color: c.textPrimary }}>{f.label}</p>
                <p className="text-[9px] mt-0.5" style={{ color: c.textMuted }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </PlatformSection>

      {/* ══════════════════════════════════════════════════════════════════════
           EMAIL INTEGRATION
         ══════════════════════════════════════════════════════════════════════ */}
      <EmailSection workspace={workspace} onToast={onToast} onWorkspaceUpdate={onWorkspaceUpdate} />

      {/* AI media tools section removed — API keys are managed in the Admin Console → Integrations. */}

      {/* ══════════════════════════════════════════════════════════════════════
           WHATSAPP BUSINESS
         ══════════════════════════════════════════════════════════════════════ */}
      <WhatsAppSection webhookUrl={webhookUrl} onToast={onToast} />

      {/* ══════════════════════════════════════════════════════════════════════
           SOCIAL NETWORKS — LinkedIn, TikTok, Twitter/X, YouTube, Facebook…
         ══════════════════════════════════════════════════════════════════════ */}
      <SocialPublishSection workspace={workspace} onToast={onToast} metaConnected={metaConnected} metaPages={metaPages}/>

      {/* ══════════════════════════════════════════════════════════════════════
           CHARTS ROW
         ══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2" style={glass}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full" style={{ background:'linear-gradient(180deg,#6366f1,#6366f180)' }}/>
            <h2 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>לידים לפי יום — 7 ימים אחרונים</h2>
          </div>
          {webhookLeads.length===0 ? (
            <div className="h-36 flex flex-col items-center justify-center gap-2">
              <Activity size={28} style={{ color: c.textMuted }}/>
              <p className="text-xs" style={{ color: c.textMuted }}>עדיין לא התקבלו לידים</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={dailyData} barGap={4}>
                <XAxis dataKey="name" tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false}/>
                <YAxis tick={{ fontSize:10, fill:'rgba(255,255,255,0.4)' }} axisLine={false} tickLine={false} width={20}/>
                <Tooltip {...tooltipStyle}/>
                <Bar dataKey="count" radius={[4,4,0,0]} name="לידים">
                  {dailyData.map((entry, i) => (
                    <Cell key={i} fill={entry.ts>=todayStart?'#6366f1':'rgba(99,102,241,0.45)'}/>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={glass}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full" style={{ background:'linear-gradient(180deg,#8b5cf6,#8b5cf680)' }}/>
            <h2 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>פילוח לפי מקור</h2>
          </div>
          {sourceBreakdown.length===0 ? (
            <div className="h-36 flex items-center justify-center">
              <p className="text-xs" style={{ color: c.textMuted }}>אין נתונים</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sourceBreakdown.map(([src, count]) => {
                const pct = webhookLeads.length>0 ? Math.round((count/webhookLeads.length)*100) : 0;
                const srcColor = src==='פייסבוק'?'#1877f2':src==='גוגל'?'#ea4335':src==='אינסטגרם'?'#e1306c':src==='אורגני'?'#10b981':'#6366f1';
                return (
                  <div key={src}>
                    <div className="flex justify-between text-[11px] mb-1">
                      <span style={{ color: c.textSecondary }}>{count} · {pct}%</span>
                      <span className="font-semibold" style={{ color: c.textPrimary }}>{src}</span>
                    </div>
                    <div className="h-1 rounded-full" style={{ background: c.subtleBg }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{ width:`${pct}%`, background:`linear-gradient(90deg,${srcColor}55,${srcColor})`, boxShadow:`0 0 4px ${srcColor}55` }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
           RECENT LEADS TABLE
         ══════════════════════════════════════════════════════════════════════ */}
      <div style={glass}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5 flex-wrap">
            {['all', ...sourceBreakdown.map(([s]) => s)].map(src => (
              <button key={src} onClick={() => setFilterSrc(src)}
                className="text-[10px] font-semibold px-2.5 py-1 rounded-lg transition-all"
                style={filterSrc===src
                  ? { background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', color: c.accentText }
                  : { background:'transparent', border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                {src==='all'?'הכל':src}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-[13px]" style={{ color: c.textPrimary }}>לידים נכנסים אחרונים</h2>
            <div className="w-1 h-4 rounded-full" style={{ background:'linear-gradient(180deg,#6366f1,#6366f180)' }}/>
          </div>
        </div>

        {recentLeads.length===0 ? (
          <div className="text-center py-12 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)' }}>
              <Webhook size={24} style={{ color:'rgba(99,102,241,0.5)' }}/>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: c.textMuted }}>
                {whSecret ? 'עדיין לא התקבלו לידים דרך אינטגרציה' : 'הגדר Webhook URL כדי לקבל לידים'}
              </p>
              <p className="text-xs mt-1" style={{ color: c.textMuted }}>
                {whSecret ? 'חבר פלטפורמת מודעות לפי ההוראות למעלה' : 'לחץ "צור Webhook URL" בסקשן הראשון'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid text-[10px] font-semibold mb-1 px-3 py-1.5 rounded-lg"
              style={{ gridTemplateColumns:'1fr 1fr 1fr 90px 90px 80px', color: c.textMuted, background: c.subtleBg }}>
              <span className="text-right">שם / חברה</span>
              <span className="text-right">אימייל</span>
              <span className="text-right">טלפון</span>
              <span className="text-right">מקור</span>
              <span className="text-right">תאריך</span>
              <span className="text-right">סטטוס</span>
            </div>
            <div className="space-y-0.5 max-h-96 overflow-y-auto" style={{ scrollbarWidth:'thin', scrollbarColor:'rgba(255,255,255,0.1) transparent' }}>
              {recentLeads.map(lead => {
                const neon = STATUS_COLORS[lead.status] ?? '#6366f1';
                const srcColor = lead.source==='פייסבוק'?'#1877f2':lead.source==='גוגל'?'#ea4335':lead.source==='אינסטגרם'?'#e1306c':lead.source==='אורגני'?'#10b981':'#6366f1';
                const createdDate = lead.createdAt
                  ? new Date(lead.createdAt).toLocaleDateString('he-IL', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })
                  : lead.lastUpdate;
                return (
                  <button key={lead.id} onClick={() => onLeadClick(lead)}
                    className="w-full grid items-center px-3 py-2.5 transition-all text-right"
                    style={{ gridTemplateColumns:'1fr 1fr 1fr 90px 90px 80px', borderRadius:8,
                      borderRight:`3px solid ${neon}`, background: c.subtleBg }}
                    onMouseEnter={e => { e.currentTarget.style.backgroundColor=`${neon}0d`; e.currentTarget.style.boxShadow=`inset 0 0 0 1px ${neon}20`; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor='rgba(255,255,255,0.02)'; e.currentTarget.style.boxShadow='none'; }}>
                    <div className="min-w-0 text-right">
                      <p className="text-[12px] font-semibold truncate" style={{ color: c.textPrimary }}>{lead.company||lead.contactName}</p>
                      {lead.company&&lead.contactName&&lead.company!==lead.contactName&&(
                        <p className="text-[10px] truncate" style={{ color: c.textMuted }}>{lead.contactName}</p>
                      )}
                    </div>
                    <p className="text-[11px] truncate text-right" style={{ color: c.textMuted, direction:'ltr' }}>{lead.email||'—'}</p>
                    <p className="text-[11px] truncate text-right" style={{ color: c.textMuted, direction:'ltr' }}>{lead.phone||'—'}</p>
                    <span className="text-[10px] font-semibold text-right" style={{ color:srcColor }}>{lead.source}</span>
                    <span className="text-[10px] text-right" style={{ color: c.textMuted }}>{createdDate}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-right justify-self-end"
                      style={{ background:`${neon}12`, color:neon, border:`1px solid ${neon}25` }}>{lead.status}</span>
                  </button>
                );
              })}
            </div>
            {webhookLeads.length>20 && (
              <p className="text-center text-[10px] mt-3" style={{ color: c.textMuted }}>
                מוצגים 20 מתוך {webhookLeads.length} לידים
                <ArrowUpRight size={10} className="inline mr-1"/>
              </p>
            )}
          </>
        )}
      </div>

    </div>
  );
}
