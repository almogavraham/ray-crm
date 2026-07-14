import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Building2, Mail, Users2, Image, Save, Copy,
  Lock, Eye, EyeOff, CheckCircle2, Check, AlertCircle, UserPlus, Trash2,
  ChevronLeft, Crown, RefreshCw, Send, AlertTriangle,
  Link, Loader2, ExternalLink,
  BarChart3, TrendingUp, Target, Award,
  Zap, Webhook, ChevronDown, ChevronUp, Shield,
  Palette, Moon, Monitor, Sparkles,
  Bell, DollarSign, Users, BarChart2, Briefcase, Plus, Minus, Settings2,
  FileText, ClipboardList, X, Printer, Edit3, Brain, PlugZap,
} from 'lucide-react';
import { calculateCost, deductTokens, hasBalance } from '../lib/tokenTracker';
import { getAnthropicProxy } from '../lib/anthropicClient';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { doc, updateDoc, setDoc, deleteDoc, getDoc, getDocs, collection, onSnapshot, addDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { WorkspaceProfile, TeamMember, Lead, StandaloneTask, AppSettings } from '../types';

interface Props {
  workspace: WorkspaceProfile;
  team: TeamMember[];
  leads: Lead[];
  standaloneTask: StandaloneTask[];
  currentUserUid: string;
  currentUserEmail: string;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate: () => Promise<void>;
  settings?: AppSettings;
  onSettingsChange?: (s: AppSettings) => void;
  integrationsPanel?: React.ReactNode;
  defaultSection?: Section;
}

type Section = 'workspace' | 'password' | 'team' | 'performance' | 'plan' | 'portal' | 'appearance' | 'revenue' | 'notifications' | 'sales' | 'proposals' | 'marketing-budget' | 'custom-fields' | 'integrations';

/* ── Finance types & constants ──────────────────────────────────────────── */
interface FinanceEntry {
  id: string;
  type: 'income' | 'expense';
  category: string;
  description: string;
  amount: number;
  vatAmount?: number;
  date: string;
  recurring: boolean;
  productId?: string;
  clientName?: string;
  createdAt: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  priceType: 'monthly' | 'one_time' | 'hourly' | 'project';
  category: string;
  active?: boolean;
  createdAt?: string;
}

interface ProposalItem {
  id: string;
  name: string;
  description: string;
  price: number;
  priceType: 'monthly' | 'one_time';
  quantity: number;
}

interface Proposal {
  id: string;
  proposalNumber: string;
  clientName: string;
  clientEmail: string;
  leadId?: string;
  items: ProposalItem[];
  notes: string;
  footer: string;
  validUntil: string;
  status: 'draft' | 'sent' | 'approved' | 'rejected';
  totalMonthly: number;
  totalOneTime: number;
  createdAt: string;
  approvalToken: string;
}

const INCOME_CATEGORIES = [
  '💼 ניהול קמפיינים', '🎯 שיווק דיגיטלי', '💻 פיתוח ועיצוב',
  '📊 ייעוץ אסטרטגי', '💰 עמלה / בונוס', '📄 שכר טרחה חודשי',
  '📦 פרויקט חד-פעמי', '📋 כתיבת תוכן', '🎨 עיצוב גרפי', '🔄 אחר',
];

const EXPENSE_CATEGORIES = [
  '🏢 שכירות משרד', '👥 שכר עובדים / פרילנסרים', '💻 תוכנות וכלים',
  '📢 פרסום ושיווק', '🚗 נסיעות ורכב', '📦 ציוד ותשתית',
  '📋 הנהלת חשבונות ומשפטי', '☁️ ספקי ענן', '📱 תקשורת', '🔄 אחר',
];

const INDUSTRIES = [
  'סוכנות שיווק', 'נדל"ן', 'טכנולוגיה', 'פיננסים',
  'שירותים עסקיים', 'קמעונאות', 'בריאות', 'חינוך', 'אחר',
];

const INPUT = 'w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none';

export default function WorkspaceSettings({
  workspace, team, leads, standaloneTask, currentUserUid, currentUserEmail, onToast, onWorkspaceUpdate,
  settings, onSettingsChange, integrationsPanel, defaultSection,
}: Props) {
  const { t, dir } = useLang();
  const { isDark, c } = useTheme();
  const inputStyle: React.CSSProperties = {
    background: c.inputBg,
    border: `1px solid ${c.inputBorder}`,
    color: c.inputText,
  };
  const [section, setSection] = useState<Section>(defaultSection ?? 'workspace');

  // Respond to external navigation (e.g. sidebar → integrations → redirect here)
  useEffect(() => {
    if (defaultSection) setSection(defaultSection);
  }, [defaultSection]);

  // ── Identify current user's team record (UID match → fallback: sole admin) ─
  const myTeamRecord = useMemo(() => {
    const byUid = team.find(m => m.uid === currentUserUid);
    if (byUid) return byUid;
    // Fallback: if there is exactly one admin in this workspace, that must be
    // the currently logged-in workspace owner (whose UID was stored incorrectly).
    const admins = team.filter(m => m.role === 'מנהל');
    return admins.length === 1 ? admins[0] : null;
  }, [team, currentUserUid]);

  // ── Auto-fix: patch Firestore record with correct uid + email ─────────────
  useEffect(() => {
    if (!currentUserUid || !currentUserEmail || !myTeamRecord) return;
    const needsUpdate =
      myTeamRecord.email !== currentUserEmail ||
      myTeamRecord.uid   !== currentUserUid;
    if (!needsUpdate) return;
    updateDoc(doc(db, 'workspaces', workspace.id, 'team', myTeamRecord.id), {
      email: currentUserEmail,
      uid:   currentUserUid,
    }).catch(() => {});
  }, [currentUserUid, currentUserEmail, myTeamRecord, workspace.id]); // eslint-disable-line

  // ── Workspace profile state ──────────────────────────────────────────────
  const [wsName,     setWsName]     = useState(workspace.name ?? '');
  const [wsEmail,    setWsEmail]    = useState(workspace.email ?? currentUserEmail);
  const [wsPhone,    setWsPhone]    = useState(workspace.phone ?? '');
  const [wsBizId,    setWsBizId]    = useState(workspace.businessId ?? '');
  const [wsIndustry, setWsIndustry] = useState(workspace.industry ?? '');
  const [wsPrompt,        setWsPrompt]        = useState(workspace.prompt ?? '');
  const [wsAiInstructions, setWsAiInstructions] = useState(workspace.aiInstructions ?? '');
  const [wsLogo,     setWsLogo]     = useState(workspace.logoUrl ?? '');
  const [wsSaving,   setWsSaving]   = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  // ── Password state ───────────────────────────────────────────────────────
  const [currentPw,  setCurrentPw]  = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [confirmPw,  setConfirmPw]  = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [pwSaving,   setPwSaving]   = useState(false);
  const [pwError,    setPwError]    = useState('');

  // ── Team invite state ────────────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole,  setInviteRole]  = useState<'מנהל' | 'סוכן'>('סוכן');
  const [inviting,    setInviting]    = useState(false);

  // ── Team editing state ───────────────────────────────────────────────────
  const isMeAdmin = myTeamRecord?.role === 'מנהל';
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [memberEditName,   setMemberEditName]   = useState('');
  const [memberEditRole,   setMemberEditRole]   = useState<'מנהל' | 'סוכן'>('סוכן');
  const [memberEditPerms,  setMemberEditPerms]  = useState<Record<string, boolean>>({});
  const [memberSaving,     setMemberSaving]     = useState(false);
  const [teamSearch,       setTeamSearch]       = useState('');

  const DEFAULT_AGENT_PERMS: Record<string, boolean> = {
    canViewLeads: true,  canAddLeads: true,  canEditLeads: true,  canDeleteLeads: false,
    canViewAnalytics: false, canViewRevenue: false, canViewDeals: true,
    canViewKanban: true, canViewTasks: true, canViewAI: true, canViewContent: true,
    canViewSettings: false, canManageIntegrations: false, canExportData: false,
  };
  const DEFAULT_ADMIN_PERMS: Record<string, boolean> = Object.fromEntries(
    Object.keys(DEFAULT_AGENT_PERMS).map(k => [k, true])
  );
  const PERMISSION_GROUPS = [
    { label: '👥 ניהול לידים', perms: [
      { key: 'canViewLeads',   label: 'צפייה בלידים' },
      { key: 'canAddLeads',    label: 'הוספת לידים' },
      { key: 'canEditLeads',   label: 'עריכת לידים' },
      { key: 'canDeleteLeads', label: 'מחיקת לידים' },
    ]},
    { label: '📊 דוחות וניתוח', perms: [
      { key: 'canViewAnalytics', label: 'אנליטיקס' },
      { key: 'canViewRevenue',   label: 'הכנסות' },
      { key: 'canViewDeals',     label: 'עסקאות' },
    ]},
    { label: '🔧 כלים', perms: [
      { key: 'canViewKanban',  label: 'לוח קנבן' },
      { key: 'canViewTasks',   label: 'משימות' },
      { key: 'canViewAI',      label: 'עוזר AI' },
      { key: 'canViewContent', label: 'תוכן ויצירה' },
    ]},
    { label: '⚙️ הגדרות', perms: [
      { key: 'canViewSettings',       label: 'צפייה בהגדרות' },
      { key: 'canManageIntegrations', label: 'אינטגרציות' },
      { key: 'canExportData',         label: 'ייצוא נתונים' },
    ]},
  ];

  const openEditMember = (member: TeamMember) => {
    if (expandedMemberId === member.id) { setExpandedMemberId(null); return; }
    setExpandedMemberId(member.id);
    setMemberEditName(member.name);
    setMemberEditRole(member.role);
    const stored = (member as any).permissions;
    setMemberEditPerms(stored ?? (member.role === 'מנהל' ? { ...DEFAULT_ADMIN_PERMS } : { ...DEFAULT_AGENT_PERMS }));
  };

  const saveMemberEdit = async (member: TeamMember) => {
    setMemberSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id, 'team', member.id), {
        name: memberEditName.trim() || member.name,
        role: memberEditRole,
        permissions: memberEditPerms,
      });
      if (member.uid) await updateDoc(doc(db, 'users', member.uid), { role: memberEditRole }).catch(() => {});
      await onWorkspaceUpdate();
      onToast('פרטי החבר עודכנו ✓', 'success');
      setExpandedMemberId(null);
    } catch {
      onToast('שגיאה בשמירה', 'error');
    } finally {
      setMemberSaving(false);
    }
  };

  const quickToggleRole = async (member: TeamMember) => {
    const newRole: 'מנהל' | 'סוכן' = member.role === 'מנהל' ? 'סוכן' : 'מנהל';
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id, 'team', member.id), {
        role: newRole,
        permissions: newRole === 'מנהל' ? DEFAULT_ADMIN_PERMS : DEFAULT_AGENT_PERMS,
      });
      if (member.uid) await updateDoc(doc(db, 'users', member.uid), { role: newRole }).catch(() => {});
      await onWorkspaceUpdate();
      onToast(`${member.name} הוגדר כ${newRole === 'מנהל' ? 'מנהל' : 'סוכן'} ✓`, 'success');
    } catch {
      onToast('שגיאה בעדכון תפקיד', 'error');
    }
  };

  // ── Logo upload ──────────────────────────────────────────────────────────
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { onToast(t('settings.logoSizeError'), 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => setWsLogo(ev.target?.result as string ?? '');
    reader.readAsDataURL(file);
  };

  // ── Save workspace profile ───────────────────────────────────────────────
  const handleSaveWorkspace = async () => {
    if (!wsName.trim()) { onToast(t('settings.businessNameRequired'), 'error'); return; }
    setWsSaving(true);
    try {
      const updates: Record<string, unknown> = {
        name: wsName.trim(),
        email: wsEmail.trim(),
        phone: wsPhone.trim(),
        businessId: wsBizId.trim(),
        prompt: wsPrompt.trim(),
        aiInstructions: wsAiInstructions.trim(),
      };
      if (wsIndustry) updates.industry = wsIndustry;
      if (wsLogo)     updates.logoUrl  = wsLogo;
      await updateDoc(doc(db, 'workspaces', workspace.id), updates);
      await onWorkspaceUpdate();
      onToast(t('settings.workspaceSaved'), 'success');
    } catch (err) {
      console.error(err);
      onToast(t('settings.errorSaving'), 'error');
    } finally {
      setWsSaving(false);
    }
  };

  // ── Change password ──────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    setPwError('');
    if (newPw.length < 6)         { setPwError(t('settings.passwordMinLength')); return; }
    if (newPw !== confirmPw)      { setPwError(t('settings.passwordMismatch')); return; }
    if (!auth.currentUser)        { setPwError(t('settings.notLoggedIn')); return; }
    setPwSaving(true);
    try {
      const cred = EmailAuthProvider.credential(currentUserEmail, currentPw);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      onToast(t('settings.passwordUpdated'), 'success');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential')
        setPwError(t('settings.passwordWrong'));
      else
        setPwError(t('settings.passwordError'));
    } finally {
      setPwSaving(false);
    }
  };

  // ── Invite team member ───────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteEmail.trim()) { onToast(t('settings.inviteEmailRequired'), 'error'); return; }
    setInviting(true);
    try {
      // Create invite token in Firestore
      const token = `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      await setDoc(doc(db, 'invites', token), {
        token,
        email:       inviteEmail.trim(),
        role:        inviteRole,
        workspaceId: workspace.id,
        createdAt:   new Date().toISOString(),
        used:        false,
      });
      const inviteUrl = `${window.location.origin}/?token=${token}`;
      await navigator.clipboard.writeText(inviteUrl).catch(() => {});
      onToast(t('settings.inviteCreated'), 'success');
      setInviteEmail('');
    } catch (err) {
      console.error(err);
      onToast(t('settings.inviteError'), 'error');
    } finally {
      setInviting(false);
    }
  };

  // ── Email config state ───────────────────────────────────────────────────
  const [emailServiceId,  setEmailServiceId]  = useState('');
  const [emailTemplateId, setEmailTemplateId] = useState('');
  const [emailInviteTmpl, setEmailInviteTmpl] = useState('');
  const [emailPublicKey,  setEmailPublicKey]  = useState('');
  const [emailFromName,   setEmailFromName]   = useState('');
  const [emailLoading,    setEmailLoading]    = useState(false);
  const [emailTesting,    setEmailTesting]    = useState(false);
  const [emailSaved,      setEmailSaved]      = useState(false);
  // savedEmailConfigured = true when data is already saved in Firestore (not just typed)
  const [savedEmailConfigured, setSavedEmailConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (section !== 'email') return;
    getDoc(doc(db, 'workspaces', workspace.id)).then(snap => {
      if (!snap.exists()) return;
      const cfg = snap.data().emailConfig ?? {};
      setEmailServiceId(cfg.serviceId ?? '');
      setEmailTemplateId(cfg.templateId ?? '');
      setEmailInviteTmpl(cfg.inviteTemplateId ?? '');
      setEmailPublicKey(cfg.publicKey ?? '');
      setEmailFromName(cfg.fromName ?? '');
      // Mark as already configured if all three required fields are saved
      const alreadySet = !!(cfg.serviceId && cfg.templateId && cfg.publicKey);
      setSavedEmailConfigured(alreadySet);
    }).catch(() => { setSavedEmailConfigured(false); });
  }, [section, workspace.id]);

  const handleSaveEmail = async () => {
    setEmailLoading(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        emailConfig: {
          serviceId:        emailServiceId.trim(),
          templateId:       emailTemplateId.trim(),
          inviteTemplateId: emailInviteTmpl.trim(),
          publicKey:        emailPublicKey.trim(),
          fromName:         emailFromName.trim(),
          updatedAt:        new Date().toISOString(),
        },
      });
      setEmailSaved(true);
      onToast(t('settings.emailSaved'), 'success');
      setTimeout(() => setEmailSaved(false), 3000);
    } catch {
      onToast(t('settings.emailSaveError'), 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailServiceId || !emailPublicKey || !emailTemplateId) {
      onToast(t('settings.emailTestFillAll'), 'error');
      return;
    }
    setEmailTesting(true);
    try {
      const emailjs = await import('@emailjs/browser');
      await emailjs.default.send(
        emailServiceId,
        emailTemplateId,
        {
          to_email:  auth.currentUser?.email ?? '',
          to_name:   emailFromName || 'Test',
          subject:   'RAY CRM — Email connection test',
          message:   t('settings.emailTestSuccess'),
          from_name: emailFromName || 'RAY CRM',
        },
        emailPublicKey,
      );
      onToast(t('settings.emailTestSuccess'), 'success');
    } catch (e) {
      onToast(t('settings.emailTestError') + ': ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setEmailTesting(false);
    }
  };

  // ── Remove team member ───────────────────────────────────────────────────
  const handleRemove = async (member: TeamMember) => {
    if (member.uid === currentUserUid) { onToast(t('settings.cannotRemoveSelf'), 'error'); return; }
    if (!window.confirm(`${t('settings.confirmRemoveMember')} ${member.name} ${t('settings.confirmRemoveMemberSuffix')}`)) return;
    try {
      // Mark user profile as removed from workspace
      if (member.uid) {
        await updateDoc(doc(db, 'users', member.uid), { workspaceId: null }).catch(() => {});
      }
      // Remove from workspace team subcollection
      await deleteDoc(doc(db, 'workspaces', workspace.id, 'team', member.id)).catch(() => {});
      onToast(`${member.name} ${t('settings.memberRemoved')}`, 'info');
      await onWorkspaceUpdate();
    } catch (err) {
      console.error(err);
      onToast(t('settings.memberRemoveError'), 'error');
    }
  };

  // ── Objection types state ────────────────────────────────────────────────
  const DEFAULT_OBJECTION_TYPES = ['💰 מחיר גבוה', '⏰ לא הזמן הנכון', '🔄 כבר יש פתרון', '❌ לא מתאים'];
  const [newObjection, setNewObjection] = useState('');

  const objectionTypes = settings?.objectionTypes ?? DEFAULT_OBJECTION_TYPES;

  const handleAddObjection = () => {
    const trimmed = newObjection.trim();
    if (!trimmed) return;
    if (objectionTypes.includes(trimmed)) { onToast('סוג התנגדות זה כבר קיים', 'error'); return; }
    onSettingsChange?.({ ...settings!, objectionTypes: [...objectionTypes, trimmed] });
    setNewObjection('');
  };

  const handleRemoveObjection = (item: string) => {
    onSettingsChange?.({ ...settings!, objectionTypes: objectionTypes.filter(o => o !== item) });
  };

  const saveNotifPrefs = async () => {
    setNotifSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { notificationPrefs: notifPrefs });
      onToast('הגדרות התראות נשמרו ✓', 'success');
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setNotifSaving(false); }
  };

  const saveSalesSettings = async () => {
    setSalesSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { salesSettings });
      onToast('הגדרות מכירה נשמרו ✓', 'success');
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setSalesSaving(false); }
  };

  // ── Portal state ─────────────────────────────────────────────────────────
  const [portals,   setPortals]   = useState<Record<string, string>>({});
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalLoaded,  setPortalLoaded]  = useState(false);
  const [genFor,    setGenFor]    = useState<string | null>(null);
  const [copiedPortalId, setCopiedPortalId] = useState<string | null>(null);

  useEffect(() => {
    if (section !== 'portal' || portalLoaded) return;
    setPortalLoading(true);
    getDocs(collection(db, 'portals'))
      .then(snap => {
        const map: Record<string, string> = {};
        snap.docs.forEach(d => {
          const data = d.data() as { leadId: string };
          map[data.leadId] = d.id;
        });
        setPortals(map);
        setPortalLoaded(true);
      })
      .catch(() => {})
      .finally(() => setPortalLoading(false));
  }, [section, portalLoaded]);

  useEffect(() => {
    if ((workspace as any).notificationPrefs) {
      setNotifPrefs(p => ({ ...p, ...(workspace as any).notificationPrefs }));
    }
  }, [workspace.id]);

  const generatePortal = async (lead: Lead) => {
    setGenFor(lead.id);
    const token = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 8);
    await setDoc(doc(db, 'portals', token), {
      leadId: lead.id, company: lead.company, contactName: lead.contactName,
      createdAt: new Date().toISOString(), views: 0,
    }).catch(() => {});
    setPortals(prev => ({ ...prev, [lead.id]: token }));
    setGenFor(null);
    onToast(`פורטל נוצר עבור ${lead.company} ✓`, 'success');
  };

  const copyPortalLink = (leadId: string) => {
    const token = portals[leadId];
    const url = `${window.location.origin}?portal=${token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedPortalId(leadId);
      setTimeout(() => setCopiedPortalId(null), 2000);
    });
  };

  const openPortal = (leadId: string) => {
    const token = portals[leadId];
    window.open(`${window.location.origin}?portal=${token}`, '_blank');
  };

  const activeClients = leads.filter(l => l.status === 'לקוח פעיל');

  // ── Performance stats (memoized) ─────────────────────────────────────────
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  const perfStats = useMemo(() => {
    return team.map(member => {
      const myLeads   = leads.filter(l => l.assignedTo === member.name || l.assignedTo === member.id);
      const active    = myLeads.filter(l => l.status === 'לקוח פעיל');
      const pipeline  = myLeads.filter(l => l.status === 'בתהליך');
      const revenue   = active.reduce((s, l) => s + l.budget, 0);
      const closeRate = myLeads.length > 0 ? (active.length / myLeads.length) * 100 : 0;
      const avgScore  = myLeads.length > 0 ? myLeads.reduce((s, l) => s + l.aiScore, 0) / myLeads.length : 0;
      const myTasks   = standaloneTask.filter(tk => tk.assignedTo === member.name);
      const overdue   = myTasks.filter(tk => !tk.completed && (() => { try { return new Date(tk.date + 'T00:00:00') < today; } catch { return false; } })()).length;
      const done      = myTasks.filter(tk => tk.completed).length;
      const perf      = Math.min(100, Math.round(closeRate * 0.4 + (revenue > 0 ? Math.min(40, revenue / 500) : 0) + (overdue === 0 ? 20 : Math.max(0, 20 - overdue * 5))));
      return { member, total: myLeads.length, active: active.length, pipeline: pipeline.length, revenue, closeRate, avgScore, overdue, done, perf };
    }).sort((a, b) => b.perf - a.perf);
  }, [leads, team, standaloneTask, today]);

  const activePerfStats = perfStats; // show all team members, including those with no leads

  // ── Notification Preferences ────────────────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState({
    recipients: [] as string[], // array of team member emails
    newLead: true,
    newTask: false,
    newMeeting: false,
    staleLead: false,
    staleLeadDays: 7,
    paymentOverdue: false,
  });
  const [notifSaving, setNotifSaving] = useState(false);

  // ── Sales Settings ────────────────────────────────────────────────────────────
  const [salesSettings, setSalesSettings] = useState({
    monthlyLeadTarget: (workspace as any).salesSettings?.monthlyLeadTarget ?? 50,
    monthlyRevenueTarget: (workspace as any).salesSettings?.monthlyRevenueTarget ?? 30000,
    conversionTarget: (workspace as any).salesSettings?.conversionTarget ?? 20,
    followUpDays: (workspace as any).salesSettings?.followUpDays ?? 5,
    proposalValidDays: (workspace as any).salesSettings?.proposalValidDays ?? 14,
    pipelineStages: (workspace as any).salesSettings?.pipelineStages ?? ['חדש', 'בתהליך', 'הצעת מחיר', 'משא ומתן', 'לקוח פעיל'],
    proposalFooter: (workspace as any).salesSettings?.proposalFooter ?? '',
  });
  const [salesSaving, setSalesSaving] = useState(false);
  const [newStageName, setNewStageName] = useState('');

  // ── Custom Fields ─────────────────────────────────────────────────────────
  const [customFieldDefs, setCustomFieldDefs] = useState<import('../types').CustomFieldDef[]>(
    (workspace as any).customFieldDefs ?? []
  );
  const [cfSaving, setCfSaving] = useState(false);
  const [newCfLabel, setNewCfLabel] = useState('');
  const [newCfOption, setNewCfOption] = useState<Record<string, string>>({});
  const [cfMulti, setCfMulti] = useState<Record<string, boolean>>({});

  const saveCustomFields = async () => {
    setCfSaving(true);
    try {
      await updateDoc(doc(db, 'workspaces', workspace.id), { customFieldDefs });
      await onWorkspaceUpdate();
      onToast('שדות מותאמים נשמרו ✓', 'success');
    } catch { onToast('שגיאה בשמירה', 'error'); }
    finally { setCfSaving(false); }
  };

  const addCustomField = () => {
    if (!newCfLabel.trim()) return;
    const id = `cf_${Date.now()}`;
    setCustomFieldDefs(prev => [...prev, { id, label: newCfLabel.trim(), options: [], multiSelect: false }]);
    setNewCfLabel('');
  };

  const removeCustomField = (id: string) =>
    setCustomFieldDefs(prev => prev.filter(f => f.id !== id));

  const addOptionToField = (fieldId: string) => {
    const opt = (newCfOption[fieldId] ?? '').trim();
    if (!opt) return;
    setCustomFieldDefs(prev => prev.map(f =>
      f.id === fieldId ? { ...f, options: [...f.options, opt] } : f
    ));
    setNewCfOption(prev => ({ ...prev, [fieldId]: '' }));
  };

  const removeOptionFromField = (fieldId: string, opt: string) =>
    setCustomFieldDefs(prev => prev.map(f =>
      f.id === fieldId ? { ...f, options: f.options.filter(o => o !== opt) } : f
    ));

  const SECTIONS: { key: Section; label: string; icon: React.ElementType }[] = [
    { key: 'workspace',        label: t('settings.workspaceProfile'), icon: Building2     },
    { key: 'team',             label: t('settings.teamManagement'),   icon: Users2        },
    { key: 'integrations',     label: 'אינטגרציות',                   icon: PlugZap       },
    { key: 'performance',      label: 'ביצועי צוות',                  icon: BarChart3     },
    { key: 'revenue',          label: 'הכנסות',                       icon: TrendingUp    },
    { key: 'notifications',    label: 'התראות',                       icon: Bell          },
    { key: 'sales',            label: 'הגדרות מכירה',                 icon: Settings2     },
    { key: 'proposals',        label: 'הצעות מחיר',                   icon: FileText      },
    { key: 'marketing-budget', label: 'תקציב שיווק',                  icon: Brain         },
    { key: 'custom-fields',    label: 'שדות מותאמים',                 icon: ClipboardList },
    { key: 'portal',           label: 'פורטל לקוחות',                 icon: Link          },
    { key: 'appearance',       label: 'מראה ועיצוב',                  icon: Palette       },
    { key: 'plan',             label: t('settings.planManagement'),   icon: Crown         },
  ];

  const planLabel =
    workspace.plan === 'trial'      ? t('billing.trial') :
    workspace.plan === 'basic'      ? 'Basic'             :
    workspace.plan === 'pro'        ? 'Pro'               :
    workspace.plan === 'enterprise' ? 'Enterprise'        : workspace.plan;
  const trialEnd  = workspace.trialEndsAt ? new Date(workspace.trialEndsAt).toLocaleDateString('he-IL') : '';

  return (
    <div className="w-full" dir={dir}>
      <div className="mb-6">
        <h1 className="text-2xl font-black" style={{ color: c.textPrimary }}>{t('settings.title')}</h1>
        <p className="text-sm mt-1" style={{ color: c.textMuted }}>{t('settings.workspace')}</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <div className="md:w-52 flex-shrink-0">
          <nav className="rounded-2xl p-2 flex md:flex-col gap-1 overflow-x-auto" dir="ltr" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            {SECTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full text-right flex-shrink-0 md:flex-shrink"
                style={
                  section === key
                    ? { background: c.accentBg, color: c.accentText, border: `1px solid ${c.accentBorder}` }
                    : { color: c.textSecondary, border: '1px solid transparent' }
                }
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="hidden md:block">{label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">

          {/* ── Workspace Info ─────────────────────────────────────────── */}
          {section === 'workspace' && (
            <Card title={t('settings.workspaceProfile')} icon={<Building2 size={18} />}>
              {/* Logo */}
              <div className="flex items-center gap-4 mb-5">
                <div
                  className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden hover:border-indigo-400 transition-colors bg-slate-50"
                  onClick={() => logoRef.current?.click()}
                >
                  {wsLogo
                    ? <img src={wsLogo} alt={t('settings.logo')} className="w-full h-full object-contain p-1" />
                    : <Image size={24} className="text-slate-400" />
                  }
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{t('settings.logo')}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{t('settings.logoSizeHint')}</p>
                  <button
                    onClick={() => logoRef.current?.click()}
                    className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    {t('settings.uploadLogo')}
                  </button>
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                </div>
              </div>

              <div className="space-y-4">
                <Field label={t('settings.businessName')}>
                  <input value={wsName} onChange={e => setWsName(e.target.value)} className={INPUT} style={inputStyle} placeholder={t('settings.businessName')} />
                </Field>
                <Field label="מייל עסקי">
                  <input
                    type="email"
                    value={wsEmail}
                    onChange={e => setWsEmail(e.target.value)}
                    className={INPUT}
                    style={inputStyle}
                    placeholder="email@company.com"
                    dir="ltr"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('settings.businessId')}>
                    <input value={wsBizId} onChange={e => setWsBizId(e.target.value)} className={INPUT} style={inputStyle} placeholder="515123456" />
                  </Field>
                  <Field label={t('settings.businessPhone')}>
                    <input value={wsPhone} onChange={e => setWsPhone(e.target.value)} className={INPUT} style={inputStyle} placeholder="050-0000000" />
                  </Field>
                </div>
                <Field label={t('settings.industry')}>
                  <select value={wsIndustry} onChange={e => setWsIndustry(e.target.value)} className={INPUT + ' appearance-none'} style={inputStyle}>
                    <option value="">{t('settings.industryPlaceholder')}</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </Field>
                <Field label={t('settings.businessDesc')}>
                  <textarea
                    value={wsPrompt}
                    onChange={e => setWsPrompt(e.target.value)}
                    rows={4}
                    className={INPUT + ' resize-none'}
                    style={inputStyle}
                    placeholder={t('settings.businessDescPlaceholder')}
                  />
                </Field>
              </div>

              {/* ── AI Instructions ─────────────────────────────────────── */}
              <div className="mt-6 rounded-2xl p-5 space-y-3"
                style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', boxShadow: '0 0 12px rgba(99,102,241,0.35)' }}>
                    <Sparkles size={14} className="text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-sm" style={{ color: 'rgba(255,255,255,0.9)' }}>הנחיות אישיות לעוזר AI</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      ספר לעוזר על עצמך, על החברה, ואיך אתה רוצה שהוא יעבוד
                    </p>
                  </div>
                </div>

                <textarea
                  value={wsAiInstructions}
                  onChange={e => setWsAiInstructions(e.target.value)}
                  rows={6}
                  className={INPUT + ' resize-none'}
                  style={{ ...inputStyle, lineHeight: '1.6' }}
                  placeholder={`לדוגמה:
• שמי אלמוג, אני מנהל סוכנות שיווק דיגיטלי עם 5 שנות ניסיון
• העסק שלי מתמחה בלקוחות B2B בתחום הטכנולוגיה
• אני מעדיף תשובות קצרות וממוקדות
• תמיד הצג 3 אפשרויות כשאתה ממליץ
• השתמש בשפה מקצועית אך לא פורמלית מדי`}
                />

                <div className="flex items-start gap-2 text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  <span style={{ color: '#818cf8', flexShrink: 0 }}>💡</span>
                  <span>הנחיות אלו יתווספו לכל שיחה עם העוזר החכם ויאפשרו לו להתאים את עצמו לצרכים שלך</span>
                </div>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={handleSaveWorkspace}
                  disabled={wsSaving}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
                >
                  {wsSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  {t('settings.saveSettings')}
                </button>
              </div>
            </Card>
          )}

          {/* ── Team Management ────────────────────────────────────────── */}
          {section === 'team' && (
            <div className="space-y-5" dir="rtl">

              {/* ── Stats row ─────────────────────────────────────────── */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'חברי צוות', val: team.length, icon: <Users2 size={16} />, color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
                  { label: 'מנהלים',    val: team.filter(m => m.role === 'מנהל').length, icon: <Shield size={16} />, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
                  { label: 'סוכנים',    val: team.filter(m => m.role === 'סוכן').length,  icon: <Users size={16} />,  color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
                ].map(s => (
                  <div key={s.label} className="rounded-2xl p-4 flex items-center gap-3"
                    style={{ background: s.bg, border: `1px solid ${s.color}30` }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: s.color + '20', color: s.color }}>{s.icon}</div>
                    <div>
                      <p className="text-xl font-black" style={{ color: s.color }}>{s.val}</p>
                      <p className="text-xs" style={{ color: c.textMuted }}>{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Invite card ───────────────────────────────────────── */}
              <Card title={t('settings.inviteTeamMember')} icon={<UserPlus size={18} />}>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label={t('team.email')}>
                      <input type="email" value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        className={INPUT} style={inputStyle}
                        placeholder="email@company.com" dir="ltr" />
                    </Field>
                    <Field label={t('team.role')}>
                      <div className="flex gap-2 h-[42px]">
                        {(['מנהל', 'סוכן'] as const).map(r => (
                          <button key={r} onClick={() => setInviteRole(r)}
                            className="flex-1 rounded-xl text-sm font-bold border transition-all"
                            style={{
                              background: inviteRole === r ? '#6366f1' : c.subtleBg,
                              color: inviteRole === r ? '#fff' : c.textSecondary,
                              borderColor: inviteRole === r ? '#6366f1' : c.cardBorder,
                            }}>
                            {r === 'מנהל' ? '👑 מנהל' : '👤 סוכן'}
                          </button>
                        ))}
                      </div>
                    </Field>
                  </div>
                  <button onClick={handleInvite} disabled={inviting}
                    className="w-full disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    {inviting ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    {t('team.sendInvite')}
                  </button>
                  <p className="text-xs text-center" style={{ color: c.textMuted }}>
                    🔗 קישור הזמנה יועתק ללוח — שלח אותו לחבר הצוות
                  </p>
                </div>
              </Card>

              {/* ── Search ────────────────────────────────────────────── */}
              {team.length > 3 && (
                <div className="relative">
                  <input type="text" value={teamSearch}
                    onChange={e => setTeamSearch(e.target.value)}
                    placeholder="חיפוש לפי שם או אימייל..."
                    className={INPUT + ' pr-9'}
                    style={inputStyle} />
                  <Users2 size={15} className="absolute top-1/2 -translate-y-1/2 right-3 pointer-events-none"
                    style={{ color: c.textMuted }} />
                </div>
              )}

              {/* ── Members list ──────────────────────────────────────── */}
              <div className="space-y-3">
                {team
                  .filter(m => !teamSearch || m.name.includes(teamSearch) || m.email?.includes(teamSearch))
                  .map(member => {
                    const isMe       = member.id === myTeamRecord?.id;
                    const isExpanded = expandedMemberId === member.id;
                    const memberLeads = leads.filter(l => l.assignedTo === member.name || l.assignedTo === member.id);
                    const activeLeads = memberLeads.filter(l => l.status === 'לקוח פעיל');
                    const storedPerms = (member as any).permissions ?? (member.role === 'מנהל' ? DEFAULT_ADMIN_PERMS : DEFAULT_AGENT_PERMS);

                    return (
                      <div key={member.id} className="rounded-2xl overflow-hidden transition-all"
                        style={{ background: c.cardBg, border: `1px solid ${isExpanded ? c.accentBorder : c.cardBorder}`, boxShadow: isExpanded ? c.glow : 'none' }}>

                        {/* Member row */}
                        <div className="flex items-center gap-3 p-4">
                          {/* Avatar */}
                          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white text-sm font-black flex-shrink-0"
                            style={{ background: isMe ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'linear-gradient(135deg,#0ea5e9,#6366f1)' }}>
                            {(member.name?.[0] ?? '?').toUpperCase()}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold" style={{ color: c.textPrimary }}>{member.name}</span>
                              {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: c.accentBg, color: c.accentText }}>אני</span>}
                              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold"
                                style={{
                                  background: member.role === 'מנהל' ? 'rgba(245,158,11,0.15)' : 'rgba(16,185,129,0.12)',
                                  color: member.role === 'מנהל' ? '#f59e0b' : '#10b981',
                                }}>
                                {member.role === 'מנהל' ? '👑 מנהל' : '👤 סוכן'}
                              </span>
                            </div>
                            <p className="text-xs mt-0.5 truncate" style={{ color: c.textMuted }}>
                              {isMe ? currentUserEmail : (member.email ?? '—')}
                            </p>
                            {/* Mini stats */}
                            <div className="flex gap-3 mt-1">
                              <span className="text-[11px]" style={{ color: c.textMuted }}>
                                🎯 {memberLeads.length} לידים
                              </span>
                              <span className="text-[11px]" style={{ color: '#10b981' }}>
                                ✅ {activeLeads.length} לקוחות
                              </span>
                            </div>
                          </div>

                          {/* Actions */}
                          {isMeAdmin && (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {/* Quick role toggle (not self) */}
                              {!isMe && (
                                <button
                                  onClick={() => quickToggleRole(member)}
                                  title={member.role === 'מנהל' ? 'הורד לסוכן' : 'קדם למנהל'}
                                  className="p-2 rounded-xl transition-all text-xs font-bold"
                                  style={{ background: c.subtleBg, color: c.textSecondary, border: `1px solid ${c.cardBorder}` }}>
                                  {member.role === 'מנהל' ? <Users size={14} /> : <Shield size={14} />}
                                </button>
                              )}
                              {/* Edit button */}
                              <button
                                onClick={() => openEditMember(member)}
                                className="p-2 rounded-xl transition-all"
                                style={{
                                  background: isExpanded ? c.accentBg : c.subtleBg,
                                  color: isExpanded ? c.accentText : c.textSecondary,
                                  border: `1px solid ${isExpanded ? c.accentBorder : c.cardBorder}`,
                                }}>
                                <Edit3 size={14} />
                              </button>
                              {/* Remove (not self) */}
                              {!isMe && (
                                <button onClick={() => handleRemove(member)}
                                  className="p-2 rounded-xl transition-all"
                                  style={{ background: c.subtleBg, color: c.textMuted, border: `1px solid ${c.cardBorder}` }}
                                  onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = c.textMuted; e.currentTarget.style.background = c.subtleBg; }}>
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Expanded edit panel */}
                        {isExpanded && isMeAdmin && (
                          <div className="px-4 pb-5 space-y-5" style={{ borderTop: `1px solid ${c.divider}` }}>
                            <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                              {/* Name */}
                              <div>
                                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>שם</label>
                                <input type="text" value={memberEditName}
                                  onChange={e => setMemberEditName(e.target.value)}
                                  className={INPUT} style={inputStyle} />
                              </div>
                              {/* Role */}
                              <div>
                                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תפקיד</label>
                                <div className="flex gap-2">
                                  {(['מנהל', 'סוכן'] as const).map(r => (
                                    <button key={r} onClick={() => {
                                      setMemberEditRole(r);
                                      setMemberEditPerms(r === 'מנהל' ? { ...DEFAULT_ADMIN_PERMS } : { ...DEFAULT_AGENT_PERMS });
                                    }}
                                      className="flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all"
                                      style={{
                                        background: memberEditRole === r ? (r === 'מנהל' ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)') : c.subtleBg,
                                        color: memberEditRole === r ? (r === 'מנהל' ? '#f59e0b' : '#10b981') : c.textSecondary,
                                        borderColor: memberEditRole === r ? (r === 'מנהל' ? '#f59e0b40' : '#10b98140') : c.cardBorder,
                                      }}>
                                      {r === 'מנהל' ? '👑 מנהל' : '👤 סוכן'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>

                            {/* Permissions */}
                            <div>
                              <div className="flex items-center justify-between mb-3">
                                <p className="text-sm font-bold" style={{ color: c.textPrimary }}>🔐 הרשאות</p>
                                <div className="flex gap-2">
                                  <button onClick={() => setMemberEditPerms(Object.fromEntries(Object.keys(memberEditPerms).map(k => [k, true])))}
                                    className="text-[11px] px-2.5 py-1 rounded-lg font-bold transition-all"
                                    style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
                                    הכל ✓
                                  </button>
                                  <button onClick={() => setMemberEditPerms(Object.fromEntries(Object.keys(memberEditPerms).map(k => [k, false])))}
                                    className="text-[11px] px-2.5 py-1 rounded-lg font-bold transition-all"
                                    style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                                    נקה הכל
                                  </button>
                                </div>
                              </div>
                              <div className="space-y-3">
                                {PERMISSION_GROUPS.map(group => (
                                  <div key={group.label} className="rounded-xl p-3"
                                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                                    <p className="text-xs font-bold mb-2" style={{ color: c.textSecondary }}>{group.label}</p>
                                    <div className="grid grid-cols-2 gap-2">
                                      {group.perms.map(perm => {
                                        const on = memberEditPerms[perm.key] ?? false;
                                        return (
                                          <button key={perm.key}
                                            onClick={() => setMemberEditPerms(p => ({ ...p, [perm.key]: !p[perm.key] }))}
                                            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all text-right"
                                            style={{
                                              background: on ? c.accentBg : c.cardBg,
                                              color: on ? c.accentText : c.textMuted,
                                              border: `1px solid ${on ? c.accentBorder : c.cardBorder}`,
                                            }}>
                                            <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center"
                                              style={{ background: on ? '#6366f1' : c.cardBorder }}>
                                              {on && <Check size={8} className="text-white" />}
                                            </div>
                                            {perm.label}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Current permissions summary (readonly) */}
                            <div className="rounded-xl p-3" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                              <p className="text-xs font-bold mb-2" style={{ color: c.textMuted }}>הרשאות נוכחיות שמורות</p>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(storedPerms).filter(([,v]) => v).map(([k]) => {
                                  const label = PERMISSION_GROUPS.flatMap(g => g.perms).find(p => p.key === k)?.label ?? k;
                                  return (
                                    <span key={k} className="text-[10px] px-2 py-0.5 rounded-full font-bold"
                                      style={{ background: c.accentBg, color: c.accentText }}>
                                      {label}
                                    </span>
                                  );
                                })}
                              </div>
                            </div>

                            <button onClick={() => saveMemberEdit(member)} disabled={memberSaving}
                              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                              {memberSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                              שמור שינויים
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>

              {team.length === 0 && (
                <div className="rounded-2xl p-10 text-center" style={{ background: c.cardBg, border: `1px dashed ${c.cardBorder}` }}>
                  <Users2 size={36} className="mx-auto mb-3 opacity-30" style={{ color: c.textMuted }} />
                  <p className="text-sm font-semibold" style={{ color: c.textSecondary }}>{t('team.noMembers')}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Team Performance ──────────────────────────────────────── */}
          {section === 'performance' && (
            <div className="space-y-5">

              {/* Summary KPI row */}
              {activePerfStats.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'סה״כ הכנסות',
                      val: `₪${activePerfStats.reduce((s,a)=>s+a.revenue,0).toLocaleString()}`,
                      icon: <TrendingUp size={16} />,
                      color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
                    },
                    {
                      label: 'ממוצע סגירה',
                      val: `${activePerfStats.length > 0 ? Math.round(activePerfStats.reduce((s,a)=>s+a.closeRate,0) / activePerfStats.length) : 0}%`,
                      icon: <Target size={16} />,
                      color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200',
                    },
                    {
                      label: 'סה״כ לידים',
                      val: activePerfStats.reduce((s,a)=>s+a.total,0),
                      icon: <Users2 size={16} />,
                      color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200',
                    },
                    {
                      label: 'משימות באיחור',
                      val: activePerfStats.reduce((s,a)=>s+a.overdue,0),
                      icon: <AlertTriangle size={16} />,
                      color: activePerfStats.reduce((s,a)=>s+a.overdue,0) > 0 ? 'text-red-600' : 'text-slate-400',
                      bg: activePerfStats.reduce((s,a)=>s+a.overdue,0) > 0 ? 'bg-red-50' : 'bg-slate-50',
                      border: activePerfStats.reduce((s,a)=>s+a.overdue,0) > 0 ? 'border-red-200' : 'border-slate-200',
                    },
                  ].map(({ label, val, icon, color, bg, border }) => (
                    <div key={label} className={`${bg} border ${border} rounded-2xl p-4 flex items-center gap-3`}>
                      <div className={`${color} flex-shrink-0`}>{icon}</div>
                      <div>
                        <p className={`text-xl font-black ${color}`}>{val}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Leaderboard */}
              <Card title="לוח מובילים" icon={<Award size={18} />}>
                {activePerfStats.length === 0 ? (
                  <div className="text-center py-10">
                    <BarChart3 size={32} className="text-slate-200 mx-auto mb-3" />
                    <p className="text-slate-500 font-medium">אין חברי צוות עדיין</p>
                    <p className="text-slate-400 text-sm mt-1">הוסף חברי צוות בלשונית "ניהול צוות"</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activePerfStats.map((s, idx) => {
                      const perfColor   = s.perf >= 70 ? 'text-emerald-600' : s.perf >= 40 ? 'text-amber-500' : 'text-red-500';
                      const perfBg      = s.perf >= 70 ? 'bg-emerald-500'   : s.perf >= 40 ? 'bg-amber-500'   : 'bg-red-500';
                      const perfBorder  = s.perf >= 70 ? 'border-emerald-500' : s.perf >= 40 ? 'border-amber-400' : 'border-red-400';
                      const medal       = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                      const isTop       = idx === 0;
                      return (
                        <div
                          key={s.member.id}
                          className={`rounded-2xl border p-4 transition-all ${
                            isTop
                              ? 'bg-gradient-to-l from-amber-50 to-white border-amber-200 shadow-sm'
                              : 'bg-white border-slate-100 hover:border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-4">
                            {/* Rank + Avatar */}
                            <div className="flex flex-col items-center gap-1.5 flex-shrink-0 w-14">
                              {medal
                                ? <span className="text-2xl leading-none">{medal}</span>
                                : <span className="text-xs font-black text-slate-400">#{idx + 1}</span>
                              }
                              <div className={`w-10 h-10 rounded-xl border-2 ${perfBorder} bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-xs font-black shadow-sm`}>
                                {s.member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </div>
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                                <span className="font-bold text-slate-800">{s.member.name}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  s.member.role === 'מנהל'
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {s.member.role}
                                </span>
                                {s.total === 0 && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-600 border border-amber-200">
                                    ללא לידים
                                  </span>
                                )}
                              </div>

                              {/* Metrics grid */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                                {[
                                  { label: 'הכנסות', val: `₪${Math.round(s.revenue/1000)}K`, color: 'text-emerald-600' },
                                  { label: 'סגירה',  val: `${Math.round(s.closeRate)}%`,      color: 'text-indigo-600' },
                                  { label: 'לידים',  val: s.total,                            color: 'text-slate-700' },
                                  { label: 'איחור',  val: s.overdue,                          color: s.overdue > 0 ? 'text-red-500' : 'text-slate-400' },
                                ].map(({ label, val, color }) => (
                                  <div key={label} className="text-center bg-slate-50 rounded-xl py-2 px-1">
                                    <div className={`text-sm font-black ${color}`}>{val}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">{label}</div>
                                  </div>
                                ))}
                              </div>

                              {/* Performance bar */}
                              <div>
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-[10px] text-slate-400">ציון ביצועים</span>
                                  <span className={`text-xs font-black ${perfColor}`}>{s.perf}%</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-700 ${perfBg}`}
                                    style={{ width: `${s.perf}%` }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Avg AI score badge */}
                            <div className="flex-shrink-0 text-center hidden md:block">
                              <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
                                <span className="text-lg font-black text-indigo-600">{Math.round(s.avgScore)}</span>
                                <span className="text-[9px] text-slate-400 leading-tight text-center">ציון<br/>AI</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ── Email Connection ───────────────────────────────────────── */}
          {section === 'email' && (
            <div className="space-y-4">

              {/* ── Connection status banner (loaded from Firestore) ─────── */}
              {savedEmailConfigured === null ? (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <RefreshCw size={14} className="animate-spin text-slate-400" />
                  <span className="text-sm text-slate-500">{t('common.loading')}</span>
                </div>
              ) : savedEmailConfigured ? (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3.5">
                  <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-emerald-800">{t('settings.emailSettings')} ✓</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      {t('settings.emailConnected')}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3.5">
                  <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-800">{t('settings.emailNotConnected')}</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      {t('settings.emailNotConnectedDesc')}
                    </p>
                  </div>
                </div>
              )}

              {/* ── Setup instructions ───────────────────────────────────── */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5" dir={dir}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Mail size={12} className="text-white" />
                  </div>
                  <p className="font-bold text-indigo-900 text-sm">{t('settings.emailSetupTitle')}</p>
                </div>
                <ol className="space-y-2.5 text-sm text-indigo-800">
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                    <span>
                      <a href="https://www.emailjs.com" target="_blank" rel="noreferrer"
                        className="font-bold text-indigo-600 underline hover:text-indigo-900">
                        emailjs.com
                      </a>
                      {' — '}{t('settings.emailSetupStep1')}
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                    <span>{t('settings.emailSetupStep2')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                    <span>{t('settings.emailSetupStep3')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                    <span>{t('settings.emailSetupStep4')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">5</span>
                    <span className="font-semibold text-indigo-900">{t('settings.emailSetupStep5')}</span>
                  </li>
                </ol>
                <a
                  href="https://www.emailjs.com"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-900 transition-colors"
                >
                  <ChevronLeft size={12} className="rotate-180" />
                  {t('settings.emailOpenEmailJS')}
                </a>
              </div>

              {/* ── Config form ──────────────────────────────────────────── */}
              <Card title={t('settings.emailConfigTitle')} icon={<Mail size={18} />}>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Service ID
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailServiceId} onChange={e => setEmailServiceId(e.target.value)}
                        className={INPUT} style={inputStyle} placeholder="service_xxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Public Key
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailPublicKey} onChange={e => setEmailPublicKey(e.target.value)}
                        className={INPUT} style={inputStyle} placeholder="xxxxxxxxxxxxxxxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        {t('settings.emailTemplateGeneral')}
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailTemplateId} onChange={e => setEmailTemplateId(e.target.value)}
                        className={INPUT} style={inputStyle} placeholder="template_xxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        {t('settings.emailTemplateInvite')}
                        <span className="text-slate-400 text-xs font-normal mr-1">{t('settings.emailTemplateInviteOptional')}</span>
                      </label>
                      <input value={emailInviteTmpl} onChange={e => setEmailInviteTmpl(e.target.value)}
                        className={INPUT} style={inputStyle} placeholder="template_xxxxxxx" dir="ltr" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{t('settings.emailSenderName')}</label>
                      <input value={emailFromName} onChange={e => setEmailFromName(e.target.value)}
                        className={INPUT} style={inputStyle} placeholder={t('settings.emailSenderPlaceholder')} />
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                    <button
                      onClick={handleTestEmail}
                      disabled={emailTesting || !emailServiceId || !emailPublicKey || !emailTemplateId}
                      className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
                    >
                      <Send size={14} />
                      {emailTesting ? t('forgotPassword.sending') : t('settings.emailTestButton')}
                    </button>
                    <button
                      onClick={async () => { await handleSaveEmail(); setSavedEmailConfigured(!!(emailServiceId && emailTemplateId && emailPublicKey)); }}
                      disabled={emailLoading}
                      className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl transition-colors ${
                        emailSaved
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      } disabled:opacity-50`}
                    >
                      {emailSaved
                        ? <><CheckCircle2 size={14} /> {t('settings.saved')}</>
                        : <><Save size={14} /> {t('common.save')}</>
                      }
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          )}


          {/* ── Client Portal ─────────────────────────────────────────── */}
          {section === 'portal' && (
            <div className="space-y-4">
              <Card title="פורטל לקוחות" icon={<Link size={18} />}>
                <p className="text-slate-500 text-sm mb-4">
                  צור קישור ייחודי לכל לקוח פעיל — הם יוכלו לצפות בסטטוס העבודה, מסמכים ועדכונים בזמן אמת.
                </p>

                {portalLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 size={22} className="animate-spin text-indigo-400" />
                  </div>
                ) : activeClients.length === 0 ? (
                  <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                    <Link size={30} className="text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-600 font-semibold">אין לקוחות פעילים</p>
                    <p className="text-slate-400 text-sm mt-1">פורטל זמין ללקוחות בסטטוס "לקוח פעיל"</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeClients.map(lead => {
                      const token    = portals[lead.id];
                      const hasPortal = !!token;
                      return (
                        <div key={lead.id} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                            {lead.company[0]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-slate-800">{lead.company}</p>
                            <p className="text-slate-500 text-xs">{lead.contactName} · ₪{lead.budget.toLocaleString()}/חודש</p>
                            {hasPortal && (
                              <p className="text-teal-600 text-[11px] mt-0.5 font-mono truncate">
                                {window.location.origin}?portal={token.slice(0, 8)}...
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            {hasPortal ? (
                              <>
                                <button
                                  onClick={() => copyPortalLink(lead.id)}
                                  className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-3 py-1.5 rounded-lg transition-colors font-medium"
                                >
                                  <Copy size={11} />
                                  {copiedPortalId === lead.id ? '✓ הועתק' : 'העתק קישור'}
                                </button>
                                <button
                                  onClick={() => openPortal(lead.id)}
                                  className="flex items-center gap-1.5 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200 px-3 py-1.5 rounded-lg transition-colors font-medium"
                                >
                                  <ExternalLink size={11} /> פתח
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => generatePortal(lead)}
                                disabled={genFor === lead.id}
                                className="flex items-center gap-1.5 text-xs bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition-colors font-bold"
                              >
                                {genFor === lead.id
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <Link size={11} />
                                }
                                צור פורטל
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>

              <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 text-sm text-teal-800 space-y-1.5">
                <p className="font-bold text-teal-900">מה הלקוח רואה בפורטל?</p>
                <p>📋 סטטוס הפרויקט ועדכונים אחרונים</p>
                <p>📁 מסמכים וקבצים משותפים</p>
                <p>✅ רשימת משימות ואבני דרך</p>
                <p>💬 ערוץ תקשורת ישיר איתך</p>
              </div>
            </div>
          )}

          {/* ── Plan Info ──────────────────────────────────────────────── */}
          {section === 'plan' && (
            <Card title={t('settings.planManagement')} icon={<Crown size={18} />}>
              <div className="space-y-4">
                <div className={`rounded-2xl p-5 border-2 ${
                  workspace.status === 'active' ? 'border-emerald-500 bg-emerald-50' :
                  workspace.status === 'trial'  ? 'border-indigo-400 bg-indigo-50'   :
                  'border-red-400 bg-red-50'
                }`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-800 text-lg">{planLabel}</p>
                      <p className="text-sm text-slate-600 mt-0.5">
                        {workspace.status === 'trial' && trialEnd ? `${t('billing.trialActive')}: ${trialEnd}` :
                         workspace.status === 'active' ? t('billing.activePlan') : t('billing.trialEnded')}
                      </p>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                      workspace.status === 'active'    ? 'bg-emerald-500 text-white' :
                      workspace.status === 'trial'     ? 'bg-indigo-500 text-white'  :
                      'bg-red-500 text-white'
                    }`}>
                      {workspace.status === 'active' ? t('billing.activePlan') : workspace.status === 'trial' ? t('billing.trial') : t('billing.trialEnded')}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                  <Row label={t('settings.businessName')}    value={workspace.name} />
                  <Row label={t('team.email')}      value={wsEmail || workspace.email} />
                  {workspace.phone      && <Row label={t('settings.businessPhone')}   value={workspace.phone} />}
                  {workspace.businessId && <Row label={t('settings.businessId')}     value={workspace.businessId} />}
                  {workspace.industry   && <Row label={t('settings.industry')}    value={workspace.industry} />}
                  <Row label={t('team.joinedAt')} value={new Date(workspace.createdAt).toLocaleDateString('he-IL')} />
                </div>

                {/* Unique workspace URL */}
                {workspace.slug && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-indigo-700 mb-1.5">{t('settings.uniqueLink')}</p>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-mono font-bold text-indigo-800 truncate" dir="ltr">
                        {workspace.slug}.ray-crm.com
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`https://${workspace.slug}.ray-crm.com`);
                          onToast(t('settings.linkCopied'), 'success');
                        }}
                        className="text-indigo-400 hover:text-indigo-700 transition-colors flex-shrink-0"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-indigo-600 mt-1.5">
                      {t('settings.uniqueLinkDesc')}
                    </p>
                  </div>
                )}

                <div className="text-center pt-2">
                  <p className="text-sm" style={{ color: c.textMuted }}>{t('settings.upgradePlan')}</p>
                </div>
              </div>
            </Card>
          )}

          {/* ── INTEGRATIONS ──────────────────────────────────────────── */}
          {section === 'integrations' && (
            <div className="-mx-0">
              {integrationsPanel ?? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <PlugZap size={32} className="opacity-20" />
                  <p className="text-sm font-semibold opacity-40">לא נמצאו אינטגרציות</p>
                </div>
              )}
            </div>
          )}

          {/* ── APPEARANCE ─────────────────────────────────────────────── */}
          {section === 'appearance' && settings && onSettingsChange && (
            <div className="space-y-4">
              <Card title="מראה ועיצוב" icon={<Palette size={18} />}>
                <div className="space-y-5">
                  {/* Theme */}
                  <div>
                    <p className="text-sm font-semibold mb-3" style={{ color: c.textSecondary }}>נושא עיצוב</p>
                    <div className="flex gap-3">
                      {([
                        { key: 'dark',  label: 'כהה',  icon: Moon,    desc: 'ממשק כהה' },
                        { key: 'light', label: 'בהיר', icon: Monitor, desc: 'ממשק בהיר' },
                      ] as { key: 'dark' | 'light'; label: string; icon: React.ElementType; desc: string }[]).map(opt => {
                        const Icon = opt.icon;
                        const isActive = (settings.theme ?? 'dark') === opt.key;
                        return (
                          <button
                            key={opt.key}
                            onClick={() => onSettingsChange({ ...settings, theme: opt.key })}
                            className="flex-1 flex flex-col items-center gap-2 p-3 rounded-xl transition-all"
                            style={
                              isActive
                                ? { background: c.accentBg, border: `2px solid ${c.accentBorder}` }
                                : { background: c.subtleBg, border: `2px solid ${c.cardBorder}` }
                            }
                          >
                            <Icon size={20} style={{ color: isActive ? c.accentText : c.textMuted }} />
                            <span className="text-sm font-semibold" style={{ color: isActive ? c.accentText : c.textSecondary }}>{opt.label}</span>
                            <span className="text-xs" style={{ color: c.textMuted }}>{opt.desc}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs mt-3" style={{ color: c.textMuted }}>שינוי נושא העיצוב יכנס לתוקף מיידית</p>
                  </div>
                </div>
              </Card>

            </div>
          )}

          {/* ── REVENUE ──────────────────────────────────────────────── */}
          {section === 'revenue' && (
            <RevenueManager workspaceId={workspace.id} leads={leads} />
          )}

          {/* ── NOTIFICATIONS ────────────────────────────────────────── */}
          {section === 'notifications' && (
            <div className="space-y-4" dir="rtl">
              <Card title="הגדרות התראות" icon={<Bell size={18} />}>
                <div className="space-y-5">
                  {/* Team member recipients */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold" style={{ color: c.textSecondary }}>
                        {notifPrefs.recipients.length} נבחרו
                      </span>
                      <p className="text-xs font-semibold" style={{ color: c.textSecondary }}>מי יקבל התראות?</p>
                    </div>
                    <div className="space-y-2">
                      {team.length === 0 ? (
                        <div className="rounded-xl px-4 py-3 text-center text-sm"
                          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                          אין חברי צוות — הוסף חברי צוות בלשונית "ניהול צוות"
                        </div>
                      ) : (
                        team.map(member => {
                          const isSelected = notifPrefs.recipients.includes(member.email);
                          const initials = member.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                          const toggleRecipient = () => {
                            setNotifPrefs(p => ({
                              ...p,
                              recipients: isSelected
                                ? p.recipients.filter(e => e !== member.email)
                                : [...p.recipients, member.email],
                            }));
                          };
                          return (
                            <button key={member.id} onClick={toggleRecipient}
                              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-right transition-all"
                              style={isSelected
                                ? { background: 'rgba(99,102,241,0.08)', border: '2px solid rgba(99,102,241,0.4)' }
                                : { background: c.subtleBg, border: `2px solid ${c.cardBorder}` }}>
                              {/* Avatar */}
                              <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
                                style={{ background: isSelected ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : c.cardBorder }}>
                                {initials}
                              </div>
                              {/* Info */}
                              <div className="flex-1 min-w-0 text-right">
                                <p className="text-sm font-semibold truncate" style={{ color: c.textPrimary }}>{member.name}</p>
                                <p className="text-xs truncate" style={{ color: c.textMuted }}>{member.email} · {member.role}</p>
                              </div>
                              {/* Check */}
                              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                                style={isSelected
                                  ? { background: '#6366f1' }
                                  : { border: `2px solid ${c.cardBorder}` }}>
                                {isSelected && <Check size={11} className="text-white" />}
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {notifPrefs.recipients.length > 0 && (
                      <p className="text-xs mt-2 text-right" style={{ color: c.textMuted }}>
                        התראות יישלחו ל: {notifPrefs.recipients.join(', ')}
                      </p>
                    )}
                  </div>

                  <div style={{ borderTop: `1px solid ${c.divider}`, paddingTop: 16 }}>
                    <p className="text-xs font-semibold mb-3" style={{ color: c.textSecondary }}>בחר אילו אירועים לקבל התראה עליהם</p>
                    <div className="space-y-3">
                      {([
                        { key: 'newLead',        label: 'ליד חדש נכנס',            desc: 'קבל התראה כשמגיע ליד חדש' },
                        { key: 'newTask',        label: 'משימה חדשה נוצרה',        desc: 'קבל התראה כשנוצרת משימה' },
                        { key: 'newMeeting',     label: 'פגישה נקבעה',              desc: 'קבל התראה כשנקבעת פגישה' },
                        { key: 'paymentOverdue', label: 'תשלום באיחור',             desc: 'קבל התראה על תשלומים שעברו את תאריכם' },
                        { key: 'staleLead',      label: 'ליד לא עודכן',             desc: `קבל תזכורת אחרי ${notifPrefs.staleLeadDays} ימים ללא עדכון` },
                      ] as const).map(({ key, label, desc }) => (
                        <div key={key} className="flex items-start justify-between gap-3 py-2"
                          style={{ borderBottom: `1px solid ${c.divider}` }}>
                          <div>
                            <p className="text-sm font-medium" style={{ color: c.textPrimary }}>{label}</p>
                            <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>{desc}</p>
                            {key === 'staleLead' && notifPrefs.staleLead && (
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-xs" style={{ color: c.textMuted }}>אחרי</span>
                                <input
                                  type="number" min={1} max={30} value={notifPrefs.staleLeadDays}
                                  onChange={e => setNotifPrefs(p => ({ ...p, staleLeadDays: Number(e.target.value) }))}
                                  className="w-16 rounded-lg px-2 py-1 text-xs text-center focus:outline-none"
                                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                                />
                                <span className="text-xs" style={{ color: c.textMuted }}>ימים</span>
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => setNotifPrefs(p => ({ ...p, [key]: !p[key as keyof typeof p] }))}
                            className="flex-shrink-0 w-11 h-6 rounded-full transition-all relative"
                            style={{ background: notifPrefs[key as keyof typeof notifPrefs] ? '#6366f1' : c.subtleBg,
                                     border: `1px solid ${notifPrefs[key as keyof typeof notifPrefs] ? '#6366f1' : c.cardBorder}` }}>
                            <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all shadow"
                              style={{ right: notifPrefs[key as keyof typeof notifPrefs] ? 1 : undefined,
                                       left: notifPrefs[key as keyof typeof notifPrefs] ? undefined : 1 }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={saveNotifPrefs}
                    disabled={notifSaving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    {notifSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    שמור הגדרות התראות
                  </button>
                </div>
              </Card>
            </div>
          )}

          {/* ── SALES SETTINGS ───────────────────────────────────────── */}
          {section === 'sales' && (
            <div className="space-y-4" dir="rtl">
              {/* Monthly targets */}
              <Card title="יעדים חודשיים" icon={<Target size={18} />}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { key: 'monthlyLeadTarget',     label: 'יעד לידים לחודש',       suffix: 'לידים', min: 1 },
                    { key: 'monthlyRevenueTarget',  label: 'יעד הכנסות לחודש (₪)',  suffix: '₪',     min: 0 },
                    { key: 'conversionTarget',      label: 'יעד המרה (%)',           suffix: '%',     min: 1 },
                  ].map(({ key, label, suffix, min }) => (
                    <div key={key}>
                      <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>{label}</label>
                      <div className="flex items-center gap-1.5 rounded-xl px-3 py-2.5"
                        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                        <input
                          type="number" min={min}
                          value={(salesSettings as any)[key]}
                          onChange={e => setSalesSettings(s => ({ ...s, [key]: Number(e.target.value) }))}
                          className="flex-1 bg-transparent text-sm text-right focus:outline-none"
                          style={{ color: c.textPrimary }}
                        />
                        <span className="text-xs flex-shrink-0" style={{ color: c.textMuted }}>{suffix}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Pipeline stages */}
              <Card title="שלבי Pipeline" icon={<BarChart2 size={18} />}>
                <div className="space-y-2 mb-3">
                  {salesSettings.pipelineStages.map((stage, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-xl px-3 py-2"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                      <span className="text-xs font-bold w-5 text-center flex-shrink-0"
                        style={{ color: c.textMuted }}>{i + 1}</span>
                      <input
                        type="text" value={stage}
                        onChange={e => setSalesSettings(s => ({
                          ...s,
                          pipelineStages: s.pipelineStages.map((st, j) => j === i ? e.target.value : st)
                        }))}
                        className="flex-1 bg-transparent text-sm text-right focus:outline-none"
                        style={{ color: c.textPrimary }}
                      />
                      {i >= 3 && (
                        <button
                          onClick={() => setSalesSettings(s => ({ ...s, pipelineStages: s.pipelineStages.filter((_, j) => j !== i) }))}
                          className="flex-shrink-0 p-1 rounded-lg transition-colors"
                          style={{ color: '#ef4444' }}>
                          <Minus size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (!newStageName.trim()) return;
                      setSalesSettings(s => ({ ...s, pipelineStages: [...s.pipelineStages, newStageName.trim()] }));
                      setNewStageName('');
                    }}
                    className="px-3 py-2 rounded-xl text-xs font-bold text-white flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    <Plus size={13} />
                  </button>
                  <input
                    type="text" value={newStageName} onChange={e => setNewStageName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newStageName.trim()) {
                        setSalesSettings(s => ({ ...s, pipelineStages: [...s.pipelineStages, newStageName.trim()] }));
                        setNewStageName('');
                      }
                    }}
                    placeholder="שם שלב חדש..."
                    className="flex-1 rounded-xl px-3 py-2 text-sm text-right focus:outline-none"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                  />
                </div>
              </Card>

              {/* Objection types */}
              {settings && onSettingsChange && (
                <Card title="סוגי התנגדויות" icon={<AlertTriangle size={18} />}>
                  <div className="space-y-4">
                    <p className="text-xs mb-1" style={{ color: c.textMuted }}>הגדר את הסיבות שמוצגות כאשר ליד מסומן כ"לא רלוונטי"</p>
                    <div className="space-y-2 mb-3">
                      {objectionTypes.map(item => (
                        <div
                          key={item}
                          className="flex items-center justify-between px-3 py-2 rounded-xl text-sm"
                          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}
                        >
                          <span style={{ color: c.textPrimary }}>{item}</span>
                          <button
                            onClick={() => handleRemoveObjection(item)}
                            className="transition-colors"
                            style={{ color: c.textMuted }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                            onMouseLeave={e => (e.currentTarget.style.color = c.textMuted)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={newObjection}
                        onChange={e => setNewObjection(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddObjection(); } }}
                        className={INPUT + ' flex-1'}
                        style={inputStyle}
                        placeholder="למשל: 🤔 צריך לחשוב על זה"
                      />
                      <button
                        onClick={handleAddObjection}
                        disabled={!newObjection.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors text-white"
                        style={{ background: '#6366f1' }}
                      >
                        <Plus size={13} />
                        הוסף
                      </button>
                    </div>
                  </div>
                </Card>
              )}

              <button
                onClick={saveSalesSettings}
                disabled={salesSaving}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {salesSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                שמור הגדרות מכירה
              </button>
            </div>
          )}

          {/* ── PROPOSALS ─────────────────────────────────────────────── */}
          {section === 'proposals' && (
            <div className="space-y-4" dir="rtl">
              {/* Follow-up & Proposal defaults */}
              <Card title="הגדרות פולואפ והצעת מחיר" icon={<Settings2 size={18} />}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>
                        פולואפ אוטומטי — אחרי כמה ימים?
                      </label>
                      <div className="flex items-center gap-1.5 rounded-xl px-3 py-2.5"
                        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                        <input
                          type="number" min={1} max={30} value={salesSettings.followUpDays}
                          onChange={e => setSalesSettings(s => ({ ...s, followUpDays: Number(e.target.value) }))}
                          className="flex-1 bg-transparent text-sm text-right focus:outline-none"
                          style={{ color: c.textPrimary }}
                        />
                        <span className="text-xs" style={{ color: c.textMuted }}>ימים</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>
                        תוקף הצעת מחיר (ימים)
                      </label>
                      <div className="flex items-center gap-1.5 rounded-xl px-3 py-2.5"
                        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                        <input
                          type="number" min={1} max={90} value={salesSettings.proposalValidDays}
                          onChange={e => setSalesSettings(s => ({ ...s, proposalValidDays: Number(e.target.value) }))}
                          className="flex-1 bg-transparent text-sm text-right focus:outline-none"
                          style={{ color: c.textPrimary }}
                        />
                        <span className="text-xs" style={{ color: c.textMuted }}>ימים</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>
                      הערת סיום ברירת מחדל בהצעת מחיר
                    </label>
                    <textarea
                      rows={3} value={salesSettings.proposalFooter}
                      onChange={e => setSalesSettings(s => ({ ...s, proposalFooter: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none resize-none"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                      placeholder="לדוגמה: תנאי תשלום: 50% מקדמה, 50% עם סיום. תוקף ההצעה: 14 ימים."
                    />
                  </div>
                  <button
                    onClick={saveSalesSettings}
                    disabled={salesSaving}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    {salesSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    שמור הגדרות
                  </button>
                </div>
              </Card>

              <ProposalManager
                workspaceId={workspace.id}
                leads={leads}
                workspaceName={workspace.name}
                workspaceEmail={workspace.email}
                defaultFooter={salesSettings.proposalFooter}
                defaultValidDays={salesSettings.proposalValidDays}
                onToast={onToast}
              />
            </div>
          )}

          {/* ── MARKETING BUDGET ──────────────────────────────────────── */}
          {section === 'marketing-budget' && (
            <MarketingBudgetSection leads={leads} workspaceId={workspace.id} />
          )}

          {/* ── CUSTOM FIELDS ─────────────────────────────────────────── */}
          {section === 'custom-fields' && (
            <div className="space-y-4" dir="rtl">
              <Card title="שדות מותאמים אישית לכרטיס ליד" icon={<ClipboardList size={18} />}>
                <p className="text-xs mb-5 leading-relaxed" style={{ color: c.textMuted }}>
                  הוסף שורות מידע מותאמות שיופיעו בכל כרטיס ליד — לדוגמה: "תוכנת הנהלת חשבונות", "מספר עובדים", "שלב בפרויקט". לכל שורה ניתן להגדיר אפשרויות בחירה.
                </p>

                {/* Existing fields */}
                <div className="space-y-4 mb-5">
                  {customFieldDefs.length === 0 && (
                    <div className="text-center py-8 rounded-xl" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                      <ClipboardList size={28} className="mx-auto mb-2 opacity-30" style={{ color: c.textMuted }} />
                      <p className="text-sm" style={{ color: c.textMuted }}>אין שדות מותאמים עדיין</p>
                      <p className="text-xs mt-1" style={{ color: c.textMuted }}>הוסף שדה ראשון בתחתית הדף</p>
                    </div>
                  )}
                  {customFieldDefs.map(field => (
                    <div key={field.id} className="rounded-xl p-4 space-y-3"
                      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                      {/* Field header */}
                      <div className="flex items-center justify-between">
                        <button onClick={() => removeCustomField(field.id)}
                          className="text-xs px-2.5 py-1 rounded-lg transition-all"
                          style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }}>
                          <Trash2 size={12} />
                        </button>
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 cursor-pointer text-xs" style={{ color: c.textSecondary }}>
                            <input type="checkbox"
                              checked={field.multiSelect ?? false}
                              onChange={e => setCustomFieldDefs(prev => prev.map(f =>
                                f.id === field.id ? { ...f, multiSelect: e.target.checked } : f
                              ))}
                              className="rounded" />
                            בחירה מרובה
                          </label>
                          <span className="font-bold text-sm" style={{ color: c.textPrimary }}>
                            🏷️ {field.label}
                          </span>
                        </div>
                      </div>

                      {/* Options chips */}
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        {field.options.map(opt => (
                          <span key={opt} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                            style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}>
                            {opt}
                            <button onClick={() => removeOptionFromField(field.id, opt)}
                              className="opacity-60 hover:opacity-100 transition-opacity ml-0.5">
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                        {field.options.length === 0 && (
                          <span className="text-xs" style={{ color: c.textMuted }}>אין אפשרויות עדיין</span>
                        )}
                      </div>

                      {/* Add option input */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => addOptionToField(field.id)}
                          disabled={!(newCfOption[field.id] ?? '').trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-40 flex-shrink-0"
                          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                          + הוסף
                        </button>
                        <input
                          type="text"
                          placeholder="הוסף אפשרות..."
                          value={newCfOption[field.id] ?? ''}
                          onChange={e => setNewCfOption(prev => ({ ...prev, [field.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOptionToField(field.id); } }}
                          className={`${INPUT} flex-1 text-right text-xs`}
                          style={{ background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.textPrimary }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add new field */}
                <div className="rounded-xl p-4 space-y-3"
                  style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
                  <p className="text-xs font-bold text-right" style={{ color: '#818cf8' }}>➕ הוסף שדה חדש</p>
                  <div className="flex gap-2">
                    <button onClick={addCustomField}
                      disabled={!newCfLabel.trim()}
                      className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40 flex-shrink-0"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                      הוסף
                    </button>
                    <input
                      type="text"
                      placeholder='שם השדה — לדוגמה: "תוכנת הנהלת חשבונות"'
                      value={newCfLabel}
                      onChange={e => setNewCfLabel(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomField(); } }}
                      className={`${INPUT} flex-1 text-right text-sm`}
                      style={{ background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.textPrimary }}
                    />
                  </div>
                </div>

                {/* Save button */}
                <div className="flex justify-start mt-4">
                  <button onClick={saveCustomFields} disabled={cfSaving}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                    {cfSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    שמור שדות
                  </button>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Marketing Budget Section ────────────────────────────────────────────── */
function MarketingBudgetSection({ leads, workspaceId }: { leads: Lead[]; workspaceId: string }) {
  const { c } = useTheme();
  const [budget,   setBudget]   = useState('10000');
  const [loading,  setLoading]  = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [copied,   setCopied]   = useState(false);

  const stats = useMemo(() => {
    const map = new Map<string, { total: number; active: number; rev: number; scores: number[] }>();
    leads.forEach(l => {
      if (!l.source) return;
      const e = map.get(l.source) ?? { total: 0, active: 0, rev: 0, scores: [] };
      e.total++; e.scores.push(l.aiScore ?? 0);
      if (l.status === 'לקוח פעיל') { e.active++; e.rev += (l.budget ?? 0); }
      map.set(l.source, e);
    });
    return [...map.entries()].map(([src, d]) => ({
      src, total: d.total, active: d.active, rev: d.rev,
      conv: d.total > 0 ? Math.round((d.active / d.total) * 100) : 0,
      avgScore: d.scores.length > 0 ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length) : 0,
    })).sort((a, b) => b.rev - a.rev);
  }, [leads]);

  const analyze = async () => {
    const ok = await hasBalance(workspaceId);
    if (!ok) return;
    setLoading(true); setAnalysis('');
    try {
      const client    = getAnthropicProxy();
      const statsText = stats.map(s =>
        `${s.src}: ${s.total} לידים → ${s.active} לקוחות (${s.conv}% המרה) → ₪${s.rev.toLocaleString()}/חודש, ציון AI ממוצע ${s.avgScore}%`
      ).join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await (client.messages as any).create({
        model: 'claude-opus-4-5', max_tokens: 1200,
        messages: [{ role: 'user', content:
`אתה יועץ מרקטינג ישראלי בכיר. נתח את ביצועי המקורות ותן המלצות מבוססות נתונים.

**נתוני מקורות לידים:**
${statsText}

**תקציב חודשי זמין:** ₪${Number(budget).toLocaleString()}

ספק ניתוח מקצועי:

## 🏆 המקור המנצח
[מה הכי משתלם ולמה — בנתונים]

## 💰 הקצאת תקציב מומלצת
[פירוט מדויק לכל ערוץ + אחוז מהתקציב]

## 🚀 3 פעולות מיידיות
1.
2.
3.

## ⚠️ מה להפסיק
[ערוץ עם ביצועים נמוכים]

## 📈 תחזית לחודש הבא
[לידים, לקוחות והכנסה צפויים]` }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = res.content?.find((b: any) => b.type === 'text')?.text ?? '';
      setAnalysis(text);
      const cost = calculateCost('claude-opus-4-5', res.usage?.input_tokens ?? 0, res.usage?.output_tokens ?? 0);
      await deductTokens(workspaceId, cost, 'claude-opus-4-5', 'Marketing budget analysis');
    } catch { /* silent */ } finally { setLoading(false); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Stats summary cards */}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {stats.map(s => (
            <div key={s.src} className="rounded-xl p-3.5 text-right"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
              <div className="text-xs font-bold mb-1" style={{ color: c.textMuted }}>{s.src}</div>
              <div className="text-lg font-black" style={{ color: c.textPrimary }}>{s.total} <span className="text-xs font-normal">לידים</span></div>
              <div className="text-xs mt-1" style={{ color: '#22c55e' }}>{s.conv}% המרה</div>
              {s.rev > 0 && <div className="text-xs mt-0.5" style={{ color: c.textMuted }}>₪{s.rev.toLocaleString()}/חודש</div>}
            </div>
          ))}
        </div>
      )}

      {/* AI Analysis card */}
      <div className="rounded-2xl p-5 space-y-4"
        style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
        <div className="flex items-center gap-2 justify-end">
          <h3 className="text-sm font-bold m-0" style={{ color: c.textPrimary }}>ניתוח AI + המלצות תקציב</h3>
          <Brain size={16} color="#818cf8"/>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))' }}>
          {/* Left: input + button */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-right" style={{ color: c.textSecondary }}>
                תקציב שיווק חודשי (₪)
              </label>
              <input type="number" value={budget} onChange={e => setBudget(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}/>
            </div>
            <button onClick={analyze} disabled={loading || stats.length === 0}
              className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              {loading
                ? <><Loader2 size={14} className="animate-spin"/> מנתח...</>
                : <><Brain size={14}/> נתח ויעץ</>}
            </button>
            {stats.length === 0 && (
              <p className="text-xs text-center" style={{ color: c.textMuted }}>
                אין מספיק נתוני מקורות לניתוח
              </p>
            )}
          </div>

          {/* Right: analysis result */}
          <div className="rounded-xl p-4" style={{ background: c.subtleBg, border: '1px solid rgba(99,102,241,0.15)', minHeight: 160 }}>
            {analysis ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() => navigator.clipboard.writeText(analysis).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg font-semibold"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary, cursor: 'pointer' }}>
                    ✓ {copied ? 'הועתק' : 'העתק'}
                  </button>
                  <span className="text-xs flex items-center gap-1" style={{ color: '#818cf8' }}>
                    <Sparkles size={9}/> ניתוח AI
                  </span>
                </div>
                <div className="text-xs leading-relaxed text-right overflow-y-auto" style={{ whiteSpace: 'pre-wrap', color: c.textSecondary, maxHeight: 400 }}>
                  {analysis}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <Brain size={36} color="rgba(99,102,241,0.3)" className="mb-2"/>
                <p className="text-xs" style={{ color: c.textMuted }}>הכנס תקציב ולחץ "נתח"</p>
                <p className="text-[10px] mt-1" style={{ color: c.textMuted }}>
                  AI ימליץ על חלוקת תקציב אופטימלית לכל ערוץ
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Toggle helper ───────────────────────────────────────────────────────── */
function FToggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  const { c } = useTheme();
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none" onClick={e => { e.preventDefault(); onToggle(); }}>
      <div className="relative flex-shrink-0" style={{ width: 36, height: 20 }}>
        <div className="w-full h-full rounded-full transition-all" style={{ background: on ? '#6366f1' : c.cardBorder }} />
        <div className="w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] shadow transition-all"
          style={{ right: on ? 2 : undefined, left: on ? undefined : 2 }} />
      </div>
      <span className="text-xs" style={{ color: c.textSecondary }}>{label}</span>
    </label>
  );
}

/* ── Entry List helper ───────────────────────────────────────────────────── */
function FEntryList({ entries, selectedMonth, onMonthChange, total, totalLabel, totalColor, onDelete, fmt, loading }: {
  entries: FinanceEntry[]; selectedMonth: string; onMonthChange: (m: string) => void;
  total: number; totalLabel: string; totalColor: string;
  onDelete: (id: string) => Promise<void>; fmt: (n: number) => string; loading: boolean;
}) {
  const { c } = useTheme();
  return (
    <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="text-right">
          <p className="text-[10px]" style={{ color: c.textMuted }}>{totalLabel}</p>
          <p className="text-xl font-black" style={{ color: totalColor }}>{fmt(total)}</p>
        </div>
        <input type="month" value={selectedMonth} onChange={e => onMonthChange(e.target.value)}
          className="rounded-xl px-3 py-1.5 text-xs focus:outline-none"
          style={{ background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.inputText }} dir="ltr" />
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: c.textMuted }} /></div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8" style={{ color: c.textMuted }}>
          <DollarSign size={24} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">אין רשומות לחודש זה</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 group"
              style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
              <div className="flex-1 min-w-0 text-right">
                <div className="flex items-center gap-1.5 justify-end flex-wrap">
                  <p className="text-sm font-semibold truncate" style={{ color: c.textPrimary }}>{e.category}</p>
                  {e.recurring && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>חוזר</span>}
                  {e.clientName && <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>{e.clientName}</span>}
                </div>
                <p className="text-xs truncate" style={{ color: c.textMuted }}>
                  {e.description || '—'} · {new Date(e.date + 'T12:00:00').toLocaleDateString('he-IL')}
                  {(e.vatAmount ?? 0) > 0 && <span style={{ color: '#f59e0b' }}> · מע"מ: ₪{e.vatAmount}</span>}
                </p>
              </div>
              <p className="text-sm font-black flex-shrink-0" style={{ color: totalColor }}>{fmt(e.amount)}</p>
              <button onClick={() => onDelete(e.id)}
                className="flex-shrink-0 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                style={{ color: c.textMuted }}
                onMouseEnter={ev => (ev.currentTarget.style.color = '#ef4444')}
                onMouseLeave={ev => (ev.currentTarget.style.color = c.textMuted)}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Revenue Manager (full financial dashboard) ──────────────────────────── */
function RevenueManager({ workspaceId, leads }: { workspaceId: string; leads: Lead[] }) {
  const { c } = useTheme();
  const inputSt: React.CSSProperties = { background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.inputText };
  const TODAY      = new Date().toISOString().slice(0, 10);
  const THIS_MONTH = new Date().toISOString().slice(0, 7);

  /* ── Tabs ── */
  const [mainTab, setMainTab] = useState<'overview' | 'income' | 'expenses' | 'products' | 'budget'>('overview');

  /* ── Data ── */
  const [entries,  setEntries]  = useState<FinanceEntry[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [budgetCfg, setBudgetCfg] = useState({ incomeTarget: 50000, expenseLimit: 20000 });
  const [loadingEntries, setLoadingEntries] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(THIS_MONTH);

  /* ── Shared form state ── */
  const [formProductId, setFormProductId] = useState('');
  const [formCategory,  setFormCategory]  = useState('');
  const [formClient,    setFormClient]    = useState('');
  const [formDesc,      setFormDesc]      = useState('');
  const [formAmount,    setFormAmount]    = useState('');
  const [formDate,      setFormDate]      = useState(TODAY);
  const [formRecurring, setFormRecurring] = useState(false);
  const [formVat,       setFormVat]       = useState(false);
  const [formSaving,    setFormSaving]    = useState(false);

  /* ── Product form ── */
  const [prodName,     setProdName]     = useState('');
  const [prodPrice,    setProdPrice]    = useState('');
  const [prodType,     setProdType]     = useState<'monthly' | 'one_time' | 'hourly' | 'project'>('monthly');
  const [prodCategory, setProdCategory] = useState('');
  const [prodSaving,   setProdSaving]   = useState(false);

  /* ── Budget form ── */
  const [budgetIncome,  setBudgetIncome]  = useState('50000');
  const [budgetExpense, setBudgetExpense] = useState('20000');
  const [budgetSaving,  setBudgetSaving]  = useState(false);

  /* ── Firestore ── */
  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'workspaces', workspaceId, 'financeEntries'), snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as FinanceEntry));
      data.sort((a, b) => b.date.localeCompare(a.date));
      setEntries(data); setLoadingEntries(false);
    });
    const u2 = onSnapshot(collection(db, 'workspaces', workspaceId, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    });
    getDoc(doc(db, 'workspaces', workspaceId)).then(snap => {
      if (!snap.exists()) return;
      const bc = (snap.data() as any).budgetCfg;
      if (bc) { setBudgetCfg(bc); setBudgetIncome(String(bc.incomeTarget)); setBudgetExpense(String(bc.expenseLimit)); }
    });
    return () => { u1(); u2(); };
  }, [workspaceId]);

  /* ── Computed ── */
  const monthEntries = entries.filter(e => e.date.startsWith(selectedMonth));
  const income    = monthEntries.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const expenses  = monthEntries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const netProfit = income - expenses;
  const margin    = income > 0 ? Math.round((netProfit / income) * 100) : 0;

  /* ── Last 6 months ── */
  const last6 = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
    const key = d.toISOString().slice(0, 7);
    const me  = entries.filter(e => e.date.startsWith(key));
    return { key, label: d.toLocaleDateString('he-IL', { month: 'short' }),
      inc: me.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0),
      exp: me.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0) };
  });
  const maxBar = Math.max(...last6.flatMap(m => [m.inc, m.exp]), 1);

  /* ── Category aggregation ── */
  const aggregate = (type: 'income' | 'expense') =>
    Object.entries(monthEntries.filter(e => e.type === type)
      .reduce((acc, e) => ({ ...acc, [e.category]: (acc[e.category] ?? 0) + e.amount }), {} as Record<string, number>))
    .sort((a, b) => b[1] - a[1]).slice(0, 6);
  const incomeCats  = aggregate('income');
  const expenseCats = aggregate('expense');

  /* ── Helpers ── */
  const fmt = (n: number) =>
    n >= 1_000_000 ? `₪${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `₪${(n/1000).toFixed(1)}K` : `₪${n.toLocaleString()}`;
  const VAT = 0.17;
  const vatAmount = formVat ? Math.round(Number(formAmount) * VAT) : 0;
  const clients   = [...new Set(leads.filter(l => l.status === 'לקוח פעיל').map(l => l.company || l.contactName))];
  const resetForm = () => { setFormProductId(''); setFormCategory(''); setFormClient(''); setFormDesc(''); setFormAmount(''); setFormRecurring(false); setFormVat(false); };

  /* ── Actions ── */
  const pickProduct = (id: string) => {
    const p = products.find(x => x.id === id);
    if (!p) return;
    setFormProductId(id); setFormCategory(p.name);
    setFormAmount(String(p.price)); setFormRecurring(p.priceType === 'monthly');
  };

  const saveEntry = async (type: 'income' | 'expense') => {
    if (!formAmount || !formCategory) return;
    setFormSaving(true);
    try {
      await addDoc(collection(db, 'workspaces', workspaceId, 'financeEntries'), {
        type, category: formCategory, description: formDesc.trim(),
        amount: Number(formAmount), vatAmount,
        date: formDate, recurring: formRecurring,
        clientName: formClient || null, productId: formProductId || null,
        createdAt: new Date().toISOString(),
      });
      resetForm();
    } catch (e) { console.error(e); } finally { setFormSaving(false); }
  };

  const importFromCRM = async () => {
    const active = leads.filter(l => l.status === 'לקוח פעיל');
    const monthLabel = new Date(selectedMonth + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    for (const lead of active) {
      for (const sol of lead.solutions) {
        if (!sol.price) continue;
        await addDoc(collection(db, 'workspaces', workspaceId, 'financeEntries'), {
          type: 'income', category: sol.name,
          description: `${lead.company || lead.contactName} — ${monthLabel}`,
          amount: sol.price, vatAmount: 0, date: selectedMonth + '-01',
          recurring: sol.priceType !== 'one_time',
          clientName: lead.company || lead.contactName,
          createdAt: new Date().toISOString(),
        });
      }
    }
  };

  const addProduct = async () => {
    if (!prodName || !prodPrice) return;
    setProdSaving(true);
    try {
      await addDoc(collection(db, 'workspaces', workspaceId, 'products'), {
        name: prodName.trim(), price: Number(prodPrice), priceType: prodType,
        category: prodCategory.trim() || prodName.trim(), active: true,
        createdAt: new Date().toISOString(),
      });
      setProdName(''); setProdPrice(''); setProdCategory('');
    } finally { setProdSaving(false); }
  };

  const deleteProduct = (id: string) => deleteDoc(doc(db, 'workspaces', workspaceId, 'products', id));
  const deleteEntry   = (id: string) => deleteDoc(doc(db, 'workspaces', workspaceId, 'financeEntries', id));

  const saveBudget = async () => {
    setBudgetSaving(true);
    const cfg = { incomeTarget: Number(budgetIncome), expenseLimit: Number(budgetExpense) };
    await updateDoc(doc(db, 'workspaces', workspaceId), { budgetCfg: cfg });
    setBudgetCfg(cfg); setBudgetSaving(false);
  };

  /* ── Tab nav ── */
  const TABS = [
    { key: 'overview',  label: 'סקירה',          icon: '📊' },
    { key: 'income',    label: 'הכנסות',          icon: '📈' },
    { key: 'expenses',  label: 'הוצאות',          icon: '📉' },
    { key: 'products',  label: 'מוצרים',          icon: '📦' },
    { key: 'budget',    label: 'תקציב',           icon: '🎯' },
  ] as const;

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Tab nav ── */}
      <div className="flex gap-1 p-1 rounded-2xl overflow-x-auto" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
            style={mainTab === t.key
              ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
              : { color: c.textSecondary }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════ OVERVIEW ════════════════ */}
      {mainTab === 'overview' && (
        <div className="space-y-4">
          {/* Month picker */}
          <div className="flex justify-end">
            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="rounded-xl px-3 py-1.5 text-sm focus:outline-none" style={inputSt} dir="ltr" />
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'הכנסות', val: income,    goal: budgetCfg.incomeTarget,  color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)' },
              { label: 'הוצאות', val: expenses,  goal: budgetCfg.expenseLimit,  color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.2)' },
              { label: 'רווח נקי', val: netProfit, goal: null, color: netProfit >= 0 ? '#10b981' : '#ef4444', bg: netProfit >= 0 ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: netProfit >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)' },
              { label: "מרג'ין",  val: null, pct: margin, goal: null, color: margin >= 30 ? '#10b981' : margin >= 0 ? '#f59e0b' : '#ef4444', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.2)' },
            ].map((kpi, i) => (
              <div key={i} className="rounded-2xl p-4 text-right" style={{ background: kpi.bg, border: `1px solid ${kpi.border}` }}>
                <div className="text-2xl font-black mb-0.5" style={{ color: kpi.color }}>
                  {kpi.pct !== undefined ? `${kpi.pct}%` : fmt(kpi.val ?? 0)}
                </div>
                <div className="text-xs font-bold" style={{ color: kpi.color }}>{kpi.label}</div>
                {kpi.goal !== null && kpi.goal !== undefined && kpi.val !== null && kpi.val !== undefined && (
                  <>
                    <div className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>מתוך {fmt(kpi.goal)}</div>
                    <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: c.subtleBg }}>
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${Math.min(100, Math.round((kpi.val / kpi.goal) * 100))}%`, background: kpi.color }} />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* P&L */}
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>📄 דוח רווח והפסד — {selectedMonth}</p>
            <div className="space-y-1.5">
              {[
                { label: 'סך הכנסות ברוטו',        val: income,    color: '#10b981', bold: false, sub: false },
                { label: `מע"מ שנגבה (${Math.round(monthEntries.reduce((s, e) => s + (e.vatAmount ?? 0), 0)).toLocaleString()}₪)`, val: income, color: c.textMuted, bold: false, sub: true },
                { label: 'סך הוצאות',               val: -expenses, color: '#ef4444', bold: false, sub: false },
                { label: 'רווח נקי',                val: netProfit, color: netProfit >= 0 ? '#10b981' : '#ef4444', bold: true,  sub: false },
                { label: `מרג'ין רווח`,              val: null,      pct: margin, color: margin >= 30 ? '#10b981' : '#f59e0b', bold: false, sub: true },
              ].map((row, i, arr) => (
                <div key={i}>
                  {i === arr.length - 2 && <div style={{ borderTop: `2px solid ${c.divider}`, margin: '8px 0' }} />}
                  <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${row.bold ? 'font-black' : ''}`}
                    style={{ background: row.bold ? (netProfit >= 0 ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.07)') : 'transparent' }}>
                    <span className={`${row.bold ? 'text-base font-black' : 'text-sm'}`} style={{ color: row.color }}>
                      {row.pct !== undefined ? `${row.pct}%` : fmt(Math.abs(row.val ?? 0))}
                    </span>
                    <span className={`text-sm ${row.sub ? 'opacity-60' : ''}`} style={{ color: row.bold ? row.color : c.textSecondary }}>{row.label}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>📊 מגמה חודשית — 6 חודשים אחרונים</p>
            <div className="flex items-end gap-2 mb-1" style={{ height: 96 }}>
              {last6.map(m => (
                <div key={m.key} className="flex-1 flex flex-col items-center">
                  <div className="w-full flex gap-0.5 items-end" style={{ height: 80 }}>
                    <div className="flex-1 rounded-t-md transition-all" style={{ height: `${(m.inc / maxBar) * 100}%`, background: '#10b981', opacity: 0.85, minHeight: m.inc > 0 ? 3 : 0 }} />
                    <div className="flex-1 rounded-t-md transition-all" style={{ height: `${(m.exp / maxBar) * 100}%`, background: '#ef4444', opacity: 0.85, minHeight: m.exp > 0 ? 3 : 0 }} />
                  </div>
                  <span className="text-[9px] mt-1" style={{ color: c.textMuted }}>{m.label}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-5 justify-end mt-1">
              {[{ c: '#10b981', l: 'הכנסות' }, { c: '#ef4444', l: 'הוצאות' }].map(({ c: cl, l }) => (
                <span key={l} className="flex items-center gap-1.5 text-xs" style={{ color: c.textMuted }}>
                  <span className="w-3 h-2 rounded-sm inline-block" style={{ background: cl }} /> {l}
                </span>
              ))}
            </div>
          </div>

          {/* Category breakdown side by side */}
          {(incomeCats.length > 0 || expenseCats.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { title: '📈 מקורות הכנסה', cats: incomeCats, color: '#10b981' },
                { title: '📉 קטגוריות הוצאה', cats: expenseCats, color: '#ef4444' },
              ].map(({ title, cats, color }) => cats.length > 0 && (
                <div key={title} className="rounded-2xl p-4" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                  <p className="text-xs font-bold mb-3" style={{ color: c.textSecondary }}>{title}</p>
                  <div className="space-y-2.5">
                    {cats.map(([cat, amt]) => (
                      <div key={cat}>
                        <div className="flex justify-between mb-1">
                          <span className="text-xs font-bold" style={{ color }}>{fmt(amt as number)}</span>
                          <span className="text-xs truncate max-w-[60%] text-right" style={{ color: c.textSecondary }}>{cat}</span>
                        </div>
                        <div className="h-1.5 rounded-full" style={{ background: c.subtleBg }}>
                          <div className="h-full rounded-full" style={{ width: `${((amt as number) / (cats[0][1] as number)) * 100}%`, background: color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CRM MRR banner */}
          {(() => {
            const active = leads.filter(l => l.status === 'לקוח פעיל');
            const mrr = active.reduce((s, l) => s + l.solutions.reduce((s2, sol) => s2 + ((!sol.priceType || sol.priceType === 'monthly') ? (sol.price ?? 0) : 0), 0), 0);
            if (!mrr) return null;
            return (
              <div className="rounded-xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.18)' }}>
                <TrendingUp size={16} style={{ color: '#818cf8', flexShrink: 0 }} />
                <p className="text-xs" style={{ color: c.textSecondary }}>
                  MRR מ-CRM: <strong style={{ color: '#818cf8' }}>{fmt(mrr)}/חודש</strong> · ARR: <strong style={{ color: '#818cf8' }}>{fmt(mrr * 12)}</strong>
                </p>
              </div>
            );
          })()}
        </div>
      )}

      {/* ════════════════ INCOME ════════════════ */}
      {mainTab === 'income' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>📈 הוסף הכנסה</p>

            {/* Product quick-pick */}
            {products.filter(p => p.active !== false).length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold mb-2" style={{ color: c.textSecondary }}>⚡ בחר מוצר/שירות מהקטלוג</p>
                <div className="flex gap-2 flex-wrap">
                  {products.filter(p => p.active !== false).map(p => (
                    <button key={p.id} onClick={() => pickProduct(p.id)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border"
                      style={formProductId === p.id
                        ? { background: 'rgba(16,185,129,0.15)', borderColor: '#10b981', color: '#10b981' }
                        : { background: c.subtleBg, borderColor: c.cardBorder, color: c.textSecondary }}>
                      {p.name} · {fmt(p.price)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>קטגוריה / שירות *</label>
                <select value={formCategory} onChange={e => { setFormCategory(e.target.value); setFormProductId(''); }}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt}>
                  <option value="">בחר קטגוריה...</option>
                  <optgroup label="— מוצרים שלי —">
                    {products.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  </optgroup>
                  <optgroup label="— קטגוריות כלליות —">
                    {INCOME_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>לקוח</label>
                <select value={formClient} onChange={e => setFormClient(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt}>
                  <option value="">ללא שיוך</option>
                  {clients.map(cl => <option key={cl} value={cl}>{cl}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>
                  סכום (₪) *{formVat && <span style={{ color: '#f59e0b' }}> → כולל מע"מ: ₪{(Number(formAmount || 0) + vatAmount).toLocaleString()}</span>}
                </label>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold" style={{ color: c.textMuted }}>₪</span>
                  <input type="number" min={0} value={formAmount} onChange={e => { setFormAmount(e.target.value); setFormProductId(''); }}
                    placeholder="0" className="w-full rounded-xl pr-8 pl-3 py-2.5 text-sm focus:outline-none text-right" style={inputSt} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תאריך *</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt} dir="ltr" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תיאור</label>
                <input value={formDesc} onChange={e => setFormDesc(e.target.value)}
                  placeholder="לדוגמה: תשלום חודש יוני — ניהול רשתות חברתיות"
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt} />
              </div>
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex gap-4 flex-wrap">
                <FToggle on={formRecurring} onToggle={() => setFormRecurring(r => !r)} label="חוזר חודשי" />
                <FToggle on={formVat} onToggle={() => setFormVat(v => !v)} label={`כולל מע"מ (17%)`} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {leads.some(l => l.status === 'לקוח פעיל' && l.solutions.some(s => s.price)) && (
                  <button onClick={importFromCRM}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border"
                    style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)', color: '#6366f1' }}>
                    <RefreshCw size={12} /> ייבא מ-CRM
                  </button>
                )}
                <button onClick={() => saveEntry('income')} disabled={formSaving || !formAmount || !formCategory}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: '#10b981' }}>
                  {formSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  הוסף הכנסה
                </button>
              </div>
            </div>
          </div>

          <FEntryList
            entries={entries.filter(e => e.type === 'income' && e.date.startsWith(selectedMonth))}
            selectedMonth={selectedMonth} onMonthChange={setSelectedMonth}
            total={income} totalLabel="סה״כ הכנסות חודש" totalColor="#10b981"
            onDelete={deleteEntry} fmt={fmt} loading={loadingEntries}
          />
        </div>
      )}

      {/* ════════════════ EXPENSES ════════════════ */}
      {mainTab === 'expenses' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>📉 הוסף הוצאה</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>קטגוריה *</label>
                <select value={formCategory} onChange={e => setFormCategory(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt}>
                  <option value="">בחר קטגוריה...</option>
                  {EXPENSE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תיאור</label>
                <input value={formDesc} onChange={e => setFormDesc(e.target.value)}
                  placeholder="לדוגמה: Slack Pro — חודש יוני"
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt} />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>סכום (₪) *</label>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold" style={{ color: c.textMuted }}>₪</span>
                  <input type="number" min={0} value={formAmount} onChange={e => setFormAmount(e.target.value)}
                    placeholder="0" className="w-full rounded-xl pr-8 pl-3 py-2.5 text-sm focus:outline-none text-right" style={inputSt} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תאריך *</label>
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt} dir="ltr" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <FToggle on={formRecurring} onToggle={() => setFormRecurring(r => !r)} label="חוזר חודשי" />
              <button onClick={() => saveEntry('expense')} disabled={formSaving || !formAmount || !formCategory}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: '#ef4444' }}>
                {formSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                הוסף הוצאה
              </button>
            </div>
          </div>

          <FEntryList
            entries={entries.filter(e => e.type === 'expense' && e.date.startsWith(selectedMonth))}
            selectedMonth={selectedMonth} onMonthChange={setSelectedMonth}
            total={expenses} totalLabel="סה״כ הוצאות חודש" totalColor="#ef4444"
            onDelete={deleteEntry} fmt={fmt} loading={loadingEntries}
          />
        </div>
      )}

      {/* ════════════════ PRODUCTS ════════════════ */}
      {mainTab === 'products' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>📦 הוסף מוצר / שירות לקטלוג</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>שם המוצר/שירות *</label>
                <input value={prodName} onChange={e => setProdName(e.target.value)}
                  placeholder="לדוגמה: ניהול רשתות חברתיות"
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt} />
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>מחיר (₪) *</label>
                <div className="relative">
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold" style={{ color: c.textMuted }}>₪</span>
                  <input type="number" min={0} value={prodPrice} onChange={e => setProdPrice(e.target.value)}
                    placeholder="0" className="w-full rounded-xl pr-8 pl-3 py-2.5 text-sm focus:outline-none text-right" style={inputSt} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>סוג תמחור</label>
                <div className="flex gap-1.5 flex-wrap">
                  {([['monthly','חודשי'],['one_time','חד-פעמי'],['hourly','שעתי'],['project','פרויקט']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setProdType(k)}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                      style={prodType === k
                        ? { background: 'rgba(99,102,241,0.15)', borderColor: '#6366f1', color: '#6366f1' }
                        : { background: c.subtleBg, borderColor: c.cardBorder, color: c.textSecondary }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>קטגוריה</label>
                <input value={prodCategory} onChange={e => setProdCategory(e.target.value)}
                  placeholder="לדוגמה: שיווק דיגיטלי"
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={inputSt} />
              </div>
            </div>
            <button onClick={addProduct} disabled={prodSaving || !prodName || !prodPrice}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
              {prodSaving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              הוסף לקטלוג
            </button>
          </div>

          {products.length === 0 ? (
            <div className="rounded-2xl p-10 text-center" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
              <div className="text-4xl mb-3">📦</div>
              <p className="text-sm font-semibold" style={{ color: c.textSecondary }}>הקטלוג ריק</p>
              <p className="text-xs mt-1" style={{ color: c.textMuted }}>הוסף את המוצרים והשירותים שאתה מציע — הם יופיעו כבחירה מהירה בטופס ההכנסות</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {products.map(p => (
                <div key={p.id} className="rounded-2xl p-4 group relative" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => deleteProduct(p.id)}
                      className="opacity-0 group-hover:opacity-100 transition-all p-1 rounded-lg flex-shrink-0"
                      style={{ color: '#ef4444' }}>
                      <Trash2 size={13} />
                    </button>
                    <div className="text-right flex-1">
                      <p className="text-sm font-bold" style={{ color: c.textPrimary }}>{p.name}</p>
                      {p.category !== p.name && <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>{p.category}</p>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${c.divider}` }}>
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                      {p.priceType === 'monthly' ? '🔄 חודשי' : p.priceType === 'one_time' ? '💫 חד-פעמי' : p.priceType === 'hourly' ? '⏰ שעתי' : '📋 פרויקט'}
                    </span>
                    <span className="text-lg font-black" style={{ color: '#6366f1' }}>{fmt(p.price)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════════ BUDGET ════════════════ */}
      {mainTab === 'budget' && (
        <div className="space-y-4">
          {/* Settings */}
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>🎯 הגדרת תקציב חודשי</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {[
                { label: 'יעד הכנסות חודשי (₪)', val: budgetIncome, setter: setBudgetIncome, color: '#10b981' },
                { label: 'תקרת הוצאות חודשית (₪)', val: budgetExpense, setter: setBudgetExpense, color: '#ef4444' },
              ].map(({ label, val, setter, color }) => (
                <div key={label}>
                  <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>{label}</label>
                  <div className="relative">
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold" style={{ color }}>{color === '#10b981' ? '📈' : '📉'}</span>
                    <input type="number" min={0} value={val} onChange={e => setter(e.target.value)}
                      className="w-full rounded-xl pr-8 pl-3 py-2.5 text-sm focus:outline-none text-right" style={inputSt} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-xs" style={{ color: c.textMuted }}>
                רווח שנתי צפוי: <strong style={{ color: '#6366f1' }}>{fmt((Number(budgetIncome) - Number(budgetExpense)) * 12)}</strong>
              </p>
              <button onClick={saveBudget} disabled={budgetSaving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
                {budgetSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={14} />}
                שמור תקציב
              </button>
            </div>
          </div>

          {/* Budget vs Actual — 6 months */}
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-4" style={{ color: c.textPrimary }}>📊 ביצוע מול תקציב — 6 חודשים</p>
            <div className="space-y-5">
              {last6.slice().reverse().map(m => {
                const incPct = budgetCfg.incomeTarget > 0 ? Math.min(100, Math.round((m.inc / budgetCfg.incomeTarget) * 100)) : 0;
                const expPct = budgetCfg.expenseLimit > 0 ? Math.min(100, Math.round((m.exp / budgetCfg.expenseLimit) * 100)) : 0;
                const profit = m.inc - m.exp;
                return (
                  <div key={m.key}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-black" style={{ color: profit >= 0 ? '#10b981' : '#ef4444' }}>
                        {profit >= 0 ? '+' : ''}{fmt(profit)}
                      </span>
                      <span className="text-xs font-bold" style={{ color: c.textSecondary }}>{m.label} {m.key.slice(0, 4)}</span>
                    </div>
                    <div className="space-y-1.5">
                      {[
                        { label: 'הכנסות', val: m.inc, target: budgetCfg.incomeTarget, pct: incPct, color: '#10b981' },
                        { label: 'הוצאות', val: m.exp, target: budgetCfg.expenseLimit, pct: expPct, color: expPct >= 90 ? '#ef4444' : '#f59e0b' },
                      ].map(row => (
                        <div key={row.label}>
                          <div className="flex justify-between text-[10px] mb-0.5" style={{ color: c.textMuted }}>
                            <span style={{ color: row.color }}>{row.pct}%</span>
                            <span>{row.label}: {fmt(row.val)} / {fmt(row.target)}</span>
                          </div>
                          <div className="h-2 rounded-full" style={{ background: c.subtleBg }}>
                            <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Annual projection */}
          <div className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <p className="text-sm font-bold mb-3" style={{ color: c.textPrimary }}>📅 תחזית שנתית על בסיס התקציב</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'יעד הכנסות שנתי',    val: fmt(budgetCfg.incomeTarget * 12),                          color: '#10b981' },
                { label: 'תקרת הוצאות שנתית',  val: fmt(budgetCfg.expenseLimit * 12),                          color: '#ef4444' },
                { label: 'רווח שנתי צפוי',     val: fmt((budgetCfg.incomeTarget - budgetCfg.expenseLimit) * 12), color: '#6366f1' },
              ].map(item => (
                <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <div className="text-base font-black" style={{ color: item.color }}>{item.val}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: c.textMuted }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ProposalManager ─────────────────────────────────────────────────────── */
function ProposalManager({ workspaceId, leads, workspaceName, workspaceEmail, defaultFooter, defaultValidDays, onToast }: {
  workspaceId: string;
  leads: Lead[];
  workspaceName: string;
  workspaceEmail: string;
  defaultFooter: string;
  defaultValidDays: number;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { c, isDark } = useTheme();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'create' | 'edit'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const blankForm = () => ({
    clientName: '',
    clientEmail: '',
    leadId: '',
    notes: '',
    footer: defaultFooter,
    validDays: defaultValidDays,
    items: [] as ProposalItem[],
  });
  const [form, setForm] = useState(blankForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // New item form
  const [newItem, setNewItem] = useState<{ name: string; description: string; price: string; priceType: 'monthly' | 'one_time'; quantity: string }>({
    name: '', description: '', price: '', priceType: 'monthly', quantity: '1',
  });

  useEffect(() => {
    const unsub1 = onSnapshot(collection(db, 'workspaces', workspaceId, 'proposals'), snap => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Proposal[];
      docs.sort((a, b) => b.createdAt?.localeCompare(a.createdAt ?? '') ?? 0);
      setProposals(docs);
      setLoading(false);
    });
    const unsub2 = onSnapshot(collection(db, 'workspaces', workspaceId, 'products'), snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]);
    });
    return () => { unsub1(); unsub2(); };
  }, [workspaceId]);

  const totalMonthly = form.items.filter(i => i.priceType === 'monthly').reduce((s, i) => s + i.price * i.quantity, 0);
  const totalOneTime = form.items.filter(i => i.priceType === 'one_time').reduce((s, i) => s + i.price * i.quantity, 0);
  const fmt = (n: number) => `₪${n.toLocaleString('he-IL')}`;

  const genToken = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  const genProposalNumber = () => {
    const d = new Date();
    return `P-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(proposals.length+1).padStart(3,'0')}`;
  };

  const openCreate = () => {
    setForm(blankForm());
    setEditingId(null);
    setView('create');
  };

  const openEdit = (p: Proposal) => {
    const validDays = p.validUntil ? Math.round((new Date(p.validUntil).getTime() - Date.now()) / 86400000) : defaultValidDays;
    setForm({
      clientName: p.clientName,
      clientEmail: p.clientEmail,
      leadId: p.leadId ?? '',
      notes: p.notes,
      footer: p.footer,
      validDays: validDays > 0 ? validDays : defaultValidDays,
      items: p.items,
    });
    setEditingId(p.id);
    setView('edit');
  };

  const pickLead = (leadId: string) => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const autoItems: ProposalItem[] = (lead.solutions ?? []).map((sol: any, idx: number) => ({
      id: `auto-${idx}`,
      name: typeof sol === 'string' ? sol : (sol?.name ?? ''),
      description: '',
      price: typeof sol === 'object' && sol?.price ? sol.price : (lead.budget ?? 0),
      priceType: 'monthly' as const,
      quantity: 1,
    }));
    setForm(f => ({
      ...f,
      leadId,
      clientName: lead.company ?? lead.name ?? '',
      clientEmail: lead.email ?? '',
      items: autoItems.length > 0 ? autoItems : f.items,
    }));
  };

  const addItem = () => {
    if (!newItem.name.trim() || !newItem.price) return;
    const item: ProposalItem = {
      id: Date.now().toString(),
      name: newItem.name.trim(),
      description: newItem.description.trim(),
      price: Number(newItem.price),
      priceType: newItem.priceType,
      quantity: Math.max(1, Number(newItem.quantity) || 1),
    };
    setForm(f => ({ ...f, items: [...f.items, item] }));
    setNewItem({ name: '', description: '', price: '', priceType: 'monthly', quantity: '1' });
  };

  const removeItem = (id: string) => setForm(f => ({ ...f, items: f.items.filter(i => i.id !== id) }));

  const pickProduct = (prod: Product) => {
    const item: ProposalItem = {
      id: Date.now().toString(),
      name: prod.name,
      description: prod.category,
      price: prod.price,
      priceType: (prod.priceType === 'monthly' ? 'monthly' : 'one_time') as 'monthly' | 'one_time',
      quantity: 1,
    };
    setForm(f => ({ ...f, items: [...f.items, item] }));
  };

  const save = async (status: 'draft' | 'sent') => {
    if (!form.clientName.trim()) { onToast('נא להזין שם לקוח', 'error'); return; }
    if (form.items.length === 0) { onToast('נא להוסיף לפחות פריט אחד', 'error'); return; }
    setSaving(true);
    try {
      const validUntil = new Date(Date.now() + form.validDays * 86400000).toISOString().slice(0, 10);
      const monthly = form.items.filter(i => i.priceType === 'monthly').reduce((s, i) => s + i.price * i.quantity, 0);
      const oneTime = form.items.filter(i => i.priceType === 'one_time').reduce((s, i) => s + i.price * i.quantity, 0);
      if (editingId) {
        await updateDoc(doc(db, 'workspaces', workspaceId, 'proposals', editingId), {
          clientName: form.clientName, clientEmail: form.clientEmail,
          leadId: form.leadId || null,
          items: form.items, notes: form.notes, footer: form.footer,
          validUntil, status, totalMonthly: monthly, totalOneTime: oneTime,
        });
        onToast('הצעת המחיר עודכנה ✓', 'success');
      } else {
        await addDoc(collection(db, 'workspaces', workspaceId, 'proposals'), {
          proposalNumber: genProposalNumber(),
          clientName: form.clientName, clientEmail: form.clientEmail,
          leadId: form.leadId || null,
          items: form.items, notes: form.notes, footer: form.footer,
          validUntil, status, totalMonthly: monthly, totalOneTime: oneTime,
          createdAt: new Date().toISOString(),
          approvalToken: genToken(),
        });
        onToast('הצעת המחיר נשמרה ✓', 'success');
      }
      setView('list');
    } catch (e) {
      onToast('שגיאה בשמירה', 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteProposal = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'workspaces', workspaceId, 'proposals', id));
      onToast('ההצעה נמחקה', 'info');
    } catch { onToast('שגיאה במחיקה', 'error'); }
    finally { setDeletingId(null); }
  };

  const updateStatus = async (id: string, status: Proposal['status']) => {
    await updateDoc(doc(db, 'workspaces', workspaceId, 'proposals', id), { status });
    onToast('סטטוס עודכן ✓', 'success');
  };

  const printProposal = (p: Proposal) => {
    const validDate = p.validUntil ? new Date(p.validUntil).toLocaleDateString('he-IL') : '';
    const createdDate = p.createdAt ? new Date(p.createdAt).toLocaleDateString('he-IL') : '';
    const monthlyRows = p.items.filter(i => i.priceType === 'monthly');
    const oneTimeRows = p.items.filter(i => i.priceType === 'one_time');

    const buildTable = (rows: ProposalItem[], label: string, color: string) => rows.length === 0 ? '' : `
      <h3 style="color:${color};font-size:14px;margin:20px 0 8px;font-weight:700">${label}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:${color}15">
            <th style="padding:10px 12px;text-align:right;border-bottom:2px solid ${color};font-weight:700">שירות / מוצר</th>
            <th style="padding:10px 12px;text-align:right;border-bottom:2px solid ${color};font-weight:700">תיאור</th>
            <th style="padding:10px 12px;text-align:center;border-bottom:2px solid ${color};font-weight:700">כמות</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid ${color};font-weight:700">מחיר</th>
            <th style="padding:10px 12px;text-align:left;border-bottom:2px solid ${color};font-weight:700">סה"כ</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((item, idx) => `
            <tr style="background:${idx%2===0?'#fafafa':'#fff'}">
              <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600">${item.name}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;color:#666;font-size:12px">${item.description}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:left">₪${item.price.toLocaleString('he-IL')}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:left;font-weight:700;color:${color}">₪${(item.price*item.quantity).toLocaleString('he-IL')}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    const html = `<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8">
      <title>הצעת מחיר ${p.proposalNumber}</title>
      <style>
        body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:0;color:#1a1a2e;direction:rtl}
        @media print{.no-print{display:none}body{padding:0}}
        .page{max-width:800px;margin:0 auto;padding:40px}
      </style></head>
      <body>
      <div class="page">
        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:3px solid #6366f1">
          <div>
            <h1 style="font-size:28px;font-weight:900;color:#6366f1;margin:0">${workspaceName}</h1>
            <p style="color:#666;margin:4px 0;font-size:13px">${workspaceEmail}</p>
          </div>
          <div style="text-align:left">
            <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;margin-bottom:6px">
              הצעת מחיר ${p.proposalNumber}
            </div>
            <p style="margin:2px 0;font-size:12px;color:#888">תאריך: ${createdDate}</p>
            <p style="margin:2px 0;font-size:12px;color:#888">תוקף עד: ${validDate}</p>
          </div>
        </div>

        <!-- Client -->
        <div style="background:#f8f9ff;border:2px solid #e0e7ff;border-radius:12px;padding:16px;margin-bottom:24px">
          <h3 style="color:#6366f1;font-size:13px;margin:0 0 8px;font-weight:700">📋 פרטי לקוח</h3>
          <p style="margin:2px 0;font-size:15px;font-weight:700">${p.clientName}</p>
          ${p.clientEmail ? `<p style="margin:2px 0;font-size:13px;color:#666">${p.clientEmail}</p>` : ''}
        </div>

        <!-- Items -->
        ${buildTable(monthlyRows, '📅 שירותים חודשיים (ריטיינר)', '#6366f1')}
        ${buildTable(oneTimeRows, '📦 תשלום חד-פעמי', '#10b981')}

        <!-- Totals -->
        <div style="margin-top:24px;padding:20px;background:linear-gradient(135deg,#f8f9ff,#eef2ff);border-radius:12px;border:2px solid #c7d2fe">
          ${monthlyRows.length > 0 ? `
          <div style="display:flex;justify-content:space-between;margin-bottom:8px">
            <span style="font-weight:600;color:#333">סה"כ חודשי</span>
            <span style="font-size:20px;font-weight:900;color:#6366f1">₪${p.totalMonthly.toLocaleString('he-IL')} / חודש</span>
          </div>` : ''}
          ${oneTimeRows.length > 0 ? `
          <div style="display:flex;justify-content:space-between">
            <span style="font-weight:600;color:#333">סה"כ חד-פעמי</span>
            <span style="font-size:20px;font-weight:900;color:#10b981">₪${p.totalOneTime.toLocaleString('he-IL')}</span>
          </div>` : ''}
        </div>

        <!-- Notes -->
        ${p.notes ? `
        <div style="margin-top:24px">
          <h3 style="font-size:13px;color:#444;margin:0 0 8px;font-weight:700">📝 הערות</h3>
          <p style="font-size:13px;color:#555;line-height:1.6;white-space:pre-line">${p.notes}</p>
        </div>` : ''}

        <!-- Signature area -->
        <div style="margin-top:40px;padding-top:24px;border-top:2px dashed #c7d2fe">
          <h3 style="font-size:14px;color:#6366f1;margin:0 0 24px;font-weight:700">✍️ אישור והסכמה</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px">
            <div>
              <p style="font-size:12px;color:#888;margin:0 0 4px">חתימת לקוח</p>
              <div style="border-bottom:2px solid #333;height:40px;margin-bottom:8px"></div>
              <p style="font-size:12px;color:#888">תאריך: ________________</p>
            </div>
            <div>
              <p style="font-size:12px;color:#888;margin:0 0 4px">שם מלא</p>
              <div style="border-bottom:2px solid #333;height:40px;margin-bottom:8px"></div>
              <p style="font-size:12px;color:#888">ת.ז.: ________________</p>
            </div>
          </div>
        </div>

        <!-- Footer -->
        ${p.footer ? `
        <div style="margin-top:32px;padding:16px;background:#f5f5f5;border-radius:8px;font-size:12px;color:#777;line-height:1.6;white-space:pre-line">
          ${p.footer}
        </div>` : ''}

        <p style="text-align:center;margin-top:32px;font-size:11px;color:#aaa">מסמך זה הופק באמצעות RAY CRM</p>
      </div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
      </body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const copyLink = (p: Proposal) => {
    const url = `${window.location.origin}?proposal=${p.approvalToken}`;
    navigator.clipboard.writeText(url).then(() => onToast('הקישור הועתק ✓', 'success'));
  };

  const statusBadge = (status: Proposal['status']) => {
    const map: Record<Proposal['status'], { label: string; color: string; bg: string }> = {
      draft:    { label: '📝 טיוטה',      color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
      sent:     { label: '📤 נשלחה',      color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
      approved: { label: '✅ אושרה',       color: '#10b981', bg: 'rgba(16,185,129,0.15)' },
      rejected: { label: '❌ נדחתה',      color: '#ef4444', bg: 'rgba(239,68,68,0.15)'  },
    };
    const s = map[status];
    return (
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
        style={{ color: s.color, background: s.bg }}>{s.label}</span>
    );
  };

  const inputCls = 'w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none';
  const inputSt = { background: c.inputBg, border: `1px solid ${c.inputBorder}`, color: c.inputText };

  // ── LIST VIEW ──
  if (view === 'list') return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold" style={{ color: c.textPrimary }}>הצעות מחיר</h3>
          <p className="text-xs mt-0.5" style={{ color: c.textMuted }}>{proposals.length} הצעות סה"כ</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
          <Plus size={14} /> הצעה חדשה
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={24} className="animate-spin" style={{ color: c.textMuted }} /></div>
      ) : proposals.length === 0 ? (
        <div className="rounded-2xl p-12 text-center" style={{ background: c.cardBg, border: `1px dashed ${c.cardBorder}` }}>
          <FileText size={40} className="mx-auto mb-3 opacity-30" style={{ color: c.textMuted }} />
          <p className="text-sm font-semibold mb-1" style={{ color: c.textSecondary }}>אין הצעות מחיר עדיין</p>
          <p className="text-xs mb-4" style={{ color: c.textMuted }}>צור הצעת מחיר מקצועית ושלח ללקוח לחתימה</p>
          <button onClick={openCreate}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <Plus size={13} className="inline ml-1" /> צור הצעה ראשונה
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map(p => (
            <div key={p.id} className="rounded-2xl p-5" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold font-mono" style={{ color: c.accentText }}>{p.proposalNumber}</span>
                    {statusBadge(p.status)}
                    <span className="text-xs" style={{ color: c.textMuted }}>
                      {p.createdAt ? new Date(p.createdAt).toLocaleDateString('he-IL') : ''}
                    </span>
                  </div>
                  <p className="text-sm font-bold" style={{ color: c.textPrimary }}>{p.clientName}</p>
                  {p.clientEmail && <p className="text-xs" style={{ color: c.textMuted }}>{p.clientEmail}</p>}
                  <div className="flex gap-4 mt-2">
                    {p.totalMonthly > 0 && (
                      <span className="text-xs font-semibold" style={{ color: '#6366f1' }}>
                        {fmt(p.totalMonthly)} / חודש
                      </span>
                    )}
                    {p.totalOneTime > 0 && (
                      <span className="text-xs font-semibold" style={{ color: '#10b981' }}>
                        {fmt(p.totalOneTime)} חד-פעמי
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => openEdit(p)} title="עריכה"
                    className="p-2 rounded-xl transition-colors"
                    style={{ background: c.subtleBg, color: c.textSecondary }}>
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => printProposal(p)} title="הדפסה / PDF"
                    className="p-2 rounded-xl transition-colors"
                    style={{ background: c.subtleBg, color: c.textSecondary }}>
                    <Printer size={14} />
                  </button>
                  <button onClick={() => copyLink(p)} title="העתק קישור"
                    className="p-2 rounded-xl transition-colors"
                    style={{ background: c.subtleBg, color: c.textSecondary }}>
                    <Copy size={14} />
                  </button>
                  <button onClick={() => deleteProposal(p.id)} title="מחיקה"
                    className="p-2 rounded-xl transition-colors"
                    style={{ background: c.subtleBg, color: deletingId === p.id ? '#ef4444' : c.textMuted }}>
                    {deletingId === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
              {/* Status update row */}
              <div className="flex gap-1.5 mt-3 pt-3 flex-wrap" style={{ borderTop: `1px solid ${c.divider}` }}>
                <span className="text-xs self-center" style={{ color: c.textMuted }}>עדכן סטטוס:</span>
                {(['draft', 'sent', 'approved', 'rejected'] as Proposal['status'][]).map(s => (
                  <button key={s} onClick={() => updateStatus(p.id, s)}
                    className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-all"
                    style={{
                      background: p.status === s ? '#6366f1' : c.subtleBg,
                      color: p.status === s ? '#fff' : c.textSecondary,
                      border: `1px solid ${p.status === s ? '#6366f1' : c.cardBorder}`,
                    }}>
                    {s === 'draft' ? 'טיוטה' : s === 'sent' ? 'נשלחה' : s === 'approved' ? 'אושרה' : 'נדחתה'}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── CREATE / EDIT VIEW ──
  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setView('list')}
          className="p-2 rounded-xl transition-colors"
          style={{ background: c.subtleBg, color: c.textSecondary }}>
          <ChevronLeft size={16} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div>
          <h3 className="text-base font-bold" style={{ color: c.textPrimary }}>
            {editingId ? 'עריכת הצעת מחיר' : 'הצעת מחיר חדשה'}
          </h3>
          <p className="text-xs" style={{ color: c.textMuted }}>מלא את הפרטים ולחץ שמור</p>
        </div>
      </div>

      {/* Client details */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
        <p className="text-sm font-bold" style={{ color: c.textPrimary }}>📋 פרטי לקוח</p>

        {/* Pick from CRM */}
        {leads.length > 0 && (
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>בחר מהלקוחות שלך</label>
            <select
              value={form.leadId}
              onChange={e => pickLead(e.target.value)}
              className={inputCls} style={inputSt}>
              <option value="">— בחר לקוח —</option>
              {leads.map(l => (
                <option key={l.id} value={l.id}>{l.company ?? l.name} {l.email ? `(${l.email})` : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>שם לקוח *</label>
            <input type="text" value={form.clientName}
              onChange={e => setForm(f => ({ ...f, clientName: e.target.value }))}
              className={inputCls} style={inputSt} placeholder="חברת X בע״מ" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>אימייל לקוח</label>
            <input type="email" value={form.clientEmail}
              onChange={e => setForm(f => ({ ...f, clientEmail: e.target.value }))}
              className={inputCls} style={inputSt} placeholder="client@email.com" dir="ltr" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תוקף הצעה (ימים)</label>
          <input type="number" min={1} max={365} value={form.validDays}
            onChange={e => setForm(f => ({ ...f, validDays: Number(e.target.value) }))}
            className={inputCls} style={inputSt} />
        </div>
      </div>

      {/* Items builder */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
        <p className="text-sm font-bold" style={{ color: c.textPrimary }}>🛒 פריטים</p>

        {/* Quick pick from product catalog */}
        {products.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: c.textSecondary }}>הוסף מקטלוג המוצרים</p>
            <div className="flex flex-wrap gap-2">
              {products.filter(p => p.active !== false).map(prod => (
                <button key={prod.id} onClick={() => pickProduct(prod)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all"
                  style={{ background: c.subtleBg, borderColor: c.cardBorder, color: c.textSecondary }}>
                  + {prod.name} — {fmt(prod.price)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Current items */}
        {form.items.length > 0 && (
          <div className="space-y-2">
            {form.items.map(item => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold" style={{ color: c.textPrimary }}>{item.name}</p>
                  {item.description && <p className="text-xs" style={{ color: c.textMuted }}>{item.description}</p>}
                  <p className="text-xs mt-0.5" style={{ color: item.priceType === 'monthly' ? '#6366f1' : '#10b981' }}>
                    {fmt(item.price)} × {item.quantity} = {fmt(item.price * item.quantity)}
                    {item.priceType === 'monthly' ? ' / חודש' : ' (חד-פעמי)'}
                  </p>
                </div>
                <button onClick={() => removeItem(item.id)}
                  className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                  style={{ color: '#ef4444' }}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new item form */}
        <div className="rounded-xl p-4 space-y-3" style={{ background: c.subtleBg, border: `1px dashed ${c.cardBorder}` }}>
          <p className="text-xs font-bold" style={{ color: c.textSecondary }}>+ הוסף פריט ידנית</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input type="text" value={newItem.name}
              onChange={e => setNewItem(n => ({ ...n, name: e.target.value }))}
              placeholder="שם השירות / מוצר *"
              className={inputCls} style={inputSt} />
            <input type="text" value={newItem.description}
              onChange={e => setNewItem(n => ({ ...n, description: e.target.value }))}
              placeholder="תיאור (אופציונלי)"
              className={inputCls} style={inputSt} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <input type="number" min={0} value={newItem.price}
              onChange={e => setNewItem(n => ({ ...n, price: e.target.value }))}
              placeholder="מחיר (₪) *"
              className={inputCls} style={inputSt} />
            <input type="number" min={1} value={newItem.quantity}
              onChange={e => setNewItem(n => ({ ...n, quantity: e.target.value }))}
              placeholder="כמות"
              className={inputCls} style={inputSt} />
            <select value={newItem.priceType}
              onChange={e => setNewItem(n => ({ ...n, priceType: e.target.value as 'monthly' | 'one_time' }))}
              className={inputCls} style={inputSt}>
              <option value="monthly">חודשי</option>
              <option value="one_time">חד-פעמי</option>
            </select>
          </div>
          <button onClick={addItem}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
            style={{ background: '#6366f1' }}>
            <Plus size={13} /> הוסף פריט
          </button>
        </div>

        {/* Totals preview */}
        {form.items.length > 0 && (
          <div className="flex gap-4 pt-3" style={{ borderTop: `1px solid ${c.divider}` }}>
            {totalMonthly > 0 && (
              <div>
                <p className="text-xs" style={{ color: c.textMuted }}>סה"כ חודשי</p>
                <p className="text-lg font-black" style={{ color: '#6366f1' }}>{fmt(totalMonthly)} / חודש</p>
              </div>
            )}
            {totalOneTime > 0 && (
              <div>
                <p className="text-xs" style={{ color: c.textMuted }}>סה"כ חד-פעמי</p>
                <p className="text-lg font-black" style={{ color: '#10b981' }}>{fmt(totalOneTime)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes & Footer */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
        <p className="text-sm font-bold" style={{ color: c.textPrimary }}>📝 הערות ותנאים</p>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>הערות להצעה</label>
          <textarea rows={3} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none resize-none"
            style={inputSt}
            placeholder="הערות נוספות שיופיעו במסמך..." />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1.5 block" style={{ color: c.textSecondary }}>תנאים / הערת סיום</label>
          <textarea rows={3} value={form.footer}
            onChange={e => setForm(f => ({ ...f, footer: e.target.value }))}
            className="w-full rounded-xl px-3 py-2.5 text-sm text-right focus:outline-none resize-none"
            style={inputSt}
            placeholder="לדוגמה: תנאי תשלום: 50% מקדמה, 50% עם סיום." />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={() => save('draft')} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-60"
          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <ClipboardList size={14} />}
          שמור כטיוטה
        </button>
        <button onClick={() => save('sent')} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          שמור וסמן כנשלחה
        </button>
      </div>
    </div>
  );
}

/* ── Small helpers ───────────────────────────────────────────────────────── */
function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <div className="rounded-2xl p-6" style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}`, boxShadow: c.shadow }}>
      <div className="flex items-center gap-2 mb-5 pb-4" style={{ borderBottom: `1px solid ${c.divider}` }}>
        <span style={{ color: c.accentText }}>{icon}</span>
        <h2 className="text-base font-bold" style={{ color: c.textPrimary }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <div>
      <label className="block text-xs font-semibold mb-1.5" style={{ color: c.textSecondary }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { c } = useTheme();
  return (
    <div className="flex justify-between items-center">
      <span style={{ color: c.textMuted }}>{label}</span>
      <span className="font-medium" style={{ color: c.textPrimary }}>{value}</span>
    </div>
  );
}
