import { useState, useRef, useEffect } from 'react';
import {
  User, Palette, Database, Info, Save, RefreshCw, Download,
  Upload, CheckCircle2, AlertTriangle, Shield, Zap, Bell,
  ChevronLeft, Monitor, Moon, Globe, Users2, Copy, Link,
  Mail, KeyRound, Lock, Eye, EyeOff, Users, Send, Trash2, ChevronDown,
  TrendingUp, DollarSign, BarChart3, Briefcase, ArrowUpRight, PlugZap,
} from 'lucide-react';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';
import { collection, getDocs, doc, updateDoc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import {
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import type { Lead, AppSettings, Page, UserProfile, TeamMember } from '../types';
import TeamManagement from './TeamManagement';

interface SettingsProps {
  settings: AppSettings;
  leads: Lead[];
  onSettingsChange: (s: AppSettings) => void;
  onImportLeads: (leads: Lead[]) => void;
  onResetData: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  isAdmin?: boolean;
  currentUserUid?: string;
  // Team management (merged from Team page)
  team?: TeamMember[];
  onUpdateRole?: (id: string, role: 'מנהל' | 'סוכן') => void;
  onInvite?: (email: string, role: 'מנהל' | 'סוכן') => void;
  onRemoveMember?: (id: string) => void;
  onAssignLead?: (leadId: string, assignedTo: string) => void;
  // Email integration
  workspaceId?: string; // null/undefined = admin (uses system/emailConfig)
  onNavigateTo?: (page: string) => void;
  integrationsPanel?: React.ReactNode;
  defaultSection?: Section;
}

type Section = 'profile' | 'appearance' | 'notifications' | 'data' | 'about' | 'security' | 'password' | 'team' | 'email' | 'revenue' | 'integrations';

const ALL_PAGES: { page: Page; label: string }[] = [
  { page: 'home',      label: 'לוח בקרה' },
  { page: 'dashboard', label: 'לידים' },
  { page: 'kanban',    label: 'פייפליין' },
  { page: 'deals',     label: 'ניהול לקוחות' },
  { page: 'tasks',     label: 'משימות' },
  { page: 'content',   label: 'קריאייטיב' },
  { page: 'overview',  label: 'דוחות' },
  { page: 'ai',        label: 'עוזר AI' },
  { page: 'team',      label: 'צוות' },
];

const ACCENT_COLORS: { key: AppSettings['accentColor']; label: string; swatch: string }[] = [
  { key: 'indigo',  label: 'אינדיגו',   swatch: 'bg-indigo-600' },
  { key: 'blue',    label: 'כחול',      swatch: 'bg-blue-600'   },
  { key: 'emerald', label: 'ירוק',      swatch: 'bg-emerald-600'},
  { key: 'rose',    label: 'ורוד',      swatch: 'bg-rose-600'   },
  { key: 'violet',  label: 'סגול',      swatch: 'bg-violet-600' },
];

export default function Settings({
  settings, leads, onSettingsChange, onImportLeads, onResetData, onToast,
  isAdmin = false, team = [], onUpdateRole, onInvite, onRemoveMember, onAssignLead, workspaceId,
  onNavigateTo, integrationsPanel, defaultSection,
}: SettingsProps) {
  const BASE_SECTIONS: { key: Section; label: string; desc: string; Icon: React.ElementType }[] = [
    { key: 'profile',       label: 'פרופיל',        desc: 'שם משתמש ותפקיד',         Icon: User       },
    { key: 'password',      label: 'שינוי סיסמה',   desc: 'עדכון הסיסמה שלך',         Icon: Lock       },
    { key: 'team',          label: 'ניהול צוות',    desc: 'חברי צוות והזמנות',         Icon: Users      },
    { key: 'integrations',  label: 'אינטגרציות',    desc: 'חיבורים ואינטגרציות',       Icon: PlugZap    },
    { key: 'email',         label: 'חיבור אימייל',  desc: 'שלח מיילים מהמערכת',       Icon: Mail       },
    { key: 'revenue',       label: 'הכנסות',         desc: 'ניהול וניתוח הכנסות',       Icon: TrendingUp },
    { key: 'appearance',    label: 'מראה',           desc: 'ערכת נושא ותצוגה',         Icon: Palette    },
    { key: 'notifications', label: 'התראות',         desc: 'הגדרות התראות',            Icon: Bell       },
    { key: 'data',          label: 'נתונים',         desc: 'ייצוא, ייבוא ואיפוס',       Icon: Database   },
    { key: 'about',         label: 'אודות',          desc: 'גרסה ומידע על המערכת',      Icon: Info       },
  ];

  const SECTIONS = isAdmin
    ? [
        ...BASE_SECTIONS,
        { key: 'security' as Section, label: 'אבטחה', desc: 'הגדרות גישה ואימות', Icon: Shield },
      ]
    : BASE_SECTIONS;

  const { t, lang, setLang } = useLang();
  const { isDark, c } = useTheme();
  const [section, setSection]     = useState<Section>(defaultSection ?? 'profile');

  // Respond to external navigation (e.g. sidebar → integrations → redirect here)
  useEffect(() => {
    if (defaultSection) setSection(defaultSection);
  }, [defaultSection]);
  const [local, setLocal]         = useState<AppSettings>({ ...settings });
  const [saved, setSaved]         = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef                   = useRef<HTMLInputElement>(null);

  // ── Change password state ──
  const [pwCurrent,  setPwCurrent]  = useState('');
  const [pwNew,      setPwNew]      = useState('');
  const [pwConfirm,  setPwConfirm]  = useState('');
  const [pwShowCur,  setPwShowCur]  = useState(false);
  const [pwShowNew,  setPwShowNew]  = useState(false);
  const [pwLoading,  setPwLoading]  = useState(false);
  const [pwError,    setPwError]    = useState('');
  const [pwSuccess,  setPwSuccess]  = useState(false);

  const handleChangePassword = async () => {
    setPwError('');
    if (!pwCurrent) { setPwError('הכנס את הסיסמה הנוכחית'); return; }
    if (pwNew.length < 6) { setPwError('הסיסמה החדשה חייבת להכיל לפחות 6 תווים'); return; }
    if (pwNew !== pwConfirm) { setPwError('הסיסמאות החדשות אינן תואמות'); return; }
    const currentUser = auth.currentUser;
    if (!currentUser?.email) { setPwError('לא נמצא משתמש מחובר'); return; }
    setPwLoading(true);
    try {
      const cred = EmailAuthProvider.credential(currentUser.email, pwCurrent);
      await reauthenticateWithCredential(currentUser, cred);
      await updatePassword(currentUser, pwNew);
      setPwSuccess(true);
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      onToast('הסיסמה עודכנה בהצלחה ✓', 'success');
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setPwError('הסיסמה הנוכחית שגויה');
      } else if (code === 'auth/requires-recent-login') {
        setPwError('נדרש להתחבר מחדש לפני שינוי הסיסמה');
      } else {
        setPwError(`שגיאה: ${code || 'לא ידועה'}`);
      }
    } finally {
      setPwLoading(false);
    }
  };

  // ── Email config state ──
  // ── Gmail email config state ─────────────────────────────────────────────
  const [emailGmailUser,       setEmailGmailUser]       = useState('');
  const [emailAppPassword,     setEmailAppPassword]     = useState('');
  const [emailFromName,        setEmailFromName]        = useState('');
  const [emailLoading,         setEmailLoading]         = useState(false);
  const [emailTesting,         setEmailTesting]         = useState(false);
  const [emailSaved,           setEmailSaved]           = useState(false);
  const [emailPasswordSet,     setEmailPasswordSet]     = useState(false); // true = saved server-side
  const [showPassword,         setShowPassword]         = useState(false);
  const [showGuide,            setShowGuide]            = useState(false);

  useEffect(() => {
    if (section !== 'email') return;
    const docRef = workspaceId
      ? doc(db, 'workspaces', workspaceId)
      : doc(db, 'system', 'emailConfig');
    getDoc(docRef).then(snap => {
      if (!snap.exists()) return;
      const d = workspaceId ? (snap.data().emailConfig ?? {}) : snap.data();
      setEmailGmailUser(d.gmailUser  ?? '');
      setEmailFromName(d.fromName    ?? '');
      setEmailPasswordSet(!!(d.gmailAppPasswordSet));
      // Never pre-fill the password — user must re-enter to change
    }).catch(() => {});
  }, [section, workspaceId]);

  const handleSaveEmail = async () => {
    if (!emailGmailUser.trim()) {
      onToast('הכנס כתובת Gmail', 'error');
      return;
    }
    if (!emailPasswordSet && !emailAppPassword.trim()) {
      onToast('הכנס App Password', 'error');
      return;
    }
    setEmailLoading(true);
    try {
      const config: Record<string, unknown> = {
        gmailUser:           emailGmailUser.trim(),
        fromName:            emailFromName.trim(),
        gmailAppPasswordSet: true,
        updatedAt:           new Date().toISOString(),
      };
      // Only update the password if the user entered a new one
      if (emailAppPassword.trim()) {
        config.gmailAppPassword = emailAppPassword.trim();
      }
      if (workspaceId) {
        await updateDoc(doc(db, 'workspaces', workspaceId), { emailConfig: config });
      } else {
        await setDoc(doc(db, 'system', 'emailConfig'), config, { merge: true });
      }
      setEmailSaved(true);
      setEmailPasswordSet(true);
      setEmailAppPassword(''); // clear from UI after save
      onToast('הגדרות האימייל נשמרו ✓', 'success');
      setTimeout(() => setEmailSaved(false), 3000);
    } catch {
      onToast('שגיאה בשמירת הגדרות האימייל', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailGmailUser) {
      onToast('שמור את ההגדרות לפני בדיקה', 'error');
      return;
    }
    setEmailTesting(true);
    try {
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const functions = getFunctions(undefined, 'us-central1');
      const sendFn = httpsCallable(functions, 'sendEmail');
      await sendFn({
        workspaceId: workspaceId ?? null,
        to:          auth.currentUser?.email ?? '',
        subject:     'RAY CRM — בדיקת חיבור אימייל ✓',
        htmlBody:    '<div dir="rtl" style="font-family:Arial,sans-serif;padding:20px"><h3>🎉 החיבור לאימייל עובד בהצלחה!</h3><p>המייל נשלח מ-Gmail דרך RAY CRM.</p></div>',
        textBody:    'החיבור לאימייל עובד בהצלחה!',
      });
      onToast('מייל בדיקה נשלח בהצלחה ✓', 'success');
    } catch (e) {
      onToast('שגיאה: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setEmailTesting(false);
    }
  };

  // ── Users section state ──
  const [users, setUsers]             = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editingUid, setEditingUid]   = useState<string | null>(null);
  const [editPages, setEditPages]     = useState<Page[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole]   = useState<'admin' | 'agent'>('agent');
  const [invitePages, setInvitePages] = useState<Page[]>([...ALL_PAGES.map(p => p.page)]);
  const [inviteLink, setInviteLink]   = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    if (section === 'team' && isAdmin) {
      setUsersLoading(true);
      getDocs(collection(db, 'users'))
        .then(snap => {
          setUsers(snap.docs.map(d => d.data() as UserProfile));
        })
        .catch(() => onToast('שגיאה בטעינת משתמשים', 'error'))
        .finally(() => setUsersLoading(false));
    }
  }, [section, isAdmin]); // eslint-disable-line

  const handleChange = <K extends keyof AppSettings>(key: K, val: AppSettings[K]) => {
    setLocal(s => ({ ...s, [key]: val }));
    setSaved(false);
  };

  const handleSave = () => {
    onSettingsChange(local);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    onToast('ההגדרות נשמרו ✓', 'success');
  };

  /* ── Export ── */
  const exportCSV = () => {
    const headers = ['id','company','contactName','email','phone','status','budget','source','aiScore','assignedTo','lastUpdate'];
    const rows = leads.map(l => [
      l.id, l.company, l.contactName, l.email, l.phone,
      l.status, l.budget, l.source, l.aiScore, l.assignedTo, l.lastUpdate,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    download('﻿' + csv, 'ray-leads.csv', 'text/csv;charset=utf-8;');
    onToast('CSV יוצא בהצלחה', 'success');
  };

  const exportJSON = () => {
    download(JSON.stringify({ leads, settings, exportedAt: new Date().toISOString() }, null, 2),
      'ray-backup.json', 'application/json');
    onToast('גיבוי JSON יוצא בהצלחה', 'success');
  };

  function download(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  /* ── Import CSV ── */
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text  = ev.target?.result as string;
        const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
        const [header, ...rows] = lines;
        const cols = header.split(',');
        const imported: Lead[] = rows.map((row, i) => {
          const vals = row.split(',');
          const get  = (key: string) => vals[cols.indexOf(key)] ?? '';
          return {
            id:          `import-${Date.now()}-${i}`,
            company:     get('company')     || 'לא ידוע',
            contactName: get('contactName') || '',
            email:       get('email')       || '',
            phone:       get('phone')       || '',
            status:      (get('status') as Lead['status']) || 'חדש',
            budget:      parseInt(get('budget')) || 0,
            source:      (get('source') as Lead['source']) || 'אורגני',
            aiScore:     parseInt(get('aiScore')) || 0,
            assignedTo:  get('assignedTo') || local.userName,
            lastUpdate:  get('lastUpdate') || new Date().toLocaleDateString('he-IL'),
            solutions:   [],
            tasks:       [],
            notes:       [],
            futureNotes: [],
            waitingContent: false,
          };
        });
        onImportLeads(imported);
        onToast(`${imported.length} לידים יובאו בהצלחה`, 'success');
      } catch {
        onToast('שגיאה בקריאת הקובץ', 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  /* ── Reset ── */
  const handleReset = () => {
    onResetData();
    setConfirmReset(false);
    onToast('הנתונים אופסו להגדרות ברירת המחדל', 'info');
  };

  /* ── Create invite ── */
  const handleCreateInvite = async () => {
    if (!inviteEmail.trim()) { onToast('הכנס כתובת אימייל', 'error'); return; }
    setInviteLoading(true);
    try {
      const token = crypto.randomUUID();
      await setDoc(doc(db, 'invites', token), {
        token,
        email: inviteEmail.trim(),
        role: inviteRole,
        allowedPages: invitePages,
        createdAt: new Date().toISOString(),
        used: false,
        createdBy: 'admin',
      });
      const link = `${window.location.origin}?token=${token}`;
      setInviteLink(link);
      onToast('קישור הזמנה נוצר בהצלחה ✓', 'success');
    } catch {
      onToast('שגיאה ביצירת ההזמנה', 'error');
    } finally {
      setInviteLoading(false);
    }
  };

  /* ── Update user pages ── */
  const handleSaveUserPages = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { allowedPages: editPages });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, allowedPages: editPages } : u));
      setEditingUid(null);
      onToast('הרשאות עודכנו ✓', 'success');
    } catch {
      onToast('שגיאה בעדכון הרשאות', 'error');
    }
  };

  /* ── Delete user ── */
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [deletingUid,      setDeletingUid]      = useState<string | null>(null);

  const handleDeleteUser = async (uid: string) => {
    setDeletingUid(uid);
    try {
      // Remove user profile from Firestore
      await deleteDoc(doc(db, 'users', uid));
      // Also clear workspaceId if user belonged to a workspace
      setUsers(prev => prev.filter(u => u.uid !== uid));
      onToast('המשתמש נמחק בהצלחה ✓', 'success');
    } catch {
      onToast('שגיאה במחיקת המשתמש', 'error');
    } finally {
      setDeletingUid(null);
      setConfirmDeleteUid(null);
    }
  };

  /* ── Send password reset ── */
  const handlePasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      onToast(`מייל שחזור סיסמה נשלח ל-${email}`, 'success');
    } catch {
      onToast('שגיאה בשליחת מייל שחזור', 'error');
    }
  };

  const activeLeads   = leads.filter(l => l.status === 'לקוח פעיל').length;
  const totalTasks    = leads.reduce((s, l) => s + l.tasks.length, 0);
  const overdueTasks  = leads
    .flatMap(l => l.tasks.filter(t => !t.completed))
    .filter(t => new Date(t.date + 'T00:00:00') < new Date(new Date().setHours(0,0,0,0))).length;

  const inputStyle: React.CSSProperties = {
    background: c.inputBg,
    border: `1px solid ${c.inputBorder}`,
    color: c.inputText,
  };

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6"
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
      }}
    >
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 min-h-[calc(100vh-130px)]" dir="rtl">

        {/* ── Sidebar (desktop) / Tab bar (mobile) ── */}
        <div className="w-full md:w-52 md:flex-shrink-0">
          {/* Mobile: horizontal tab strip */}
          <div
            className="md:hidden flex gap-1 overflow-x-auto pb-1 rounded-xl p-1.5" dir="ltr"
            style={{
              background: c.cardBg,
              border: `1px solid ${c.cardBorder}`,
            }}
          >
            {SECTIONS.map(s => {
              const Icon = s.Icon;
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  className="flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex-shrink-0"
                  style={
                    section === s.key
                      ? { background: c.accentBg, border: `1px solid ${c.accentBorder}`, color: c.accentText }
                      : { color: c.textMuted, border: '1px solid transparent' }
                  }
                >
                  <Icon size={14} />
                  {s.label}
                </button>
              );
            })}
          </div>
          {/* Desktop: vertical sidebar */}
          <div
            className="hidden md:block rounded-xl overflow-hidden sticky top-[80px]"
            style={{
              background: c.cardBg,
              border: `1px solid ${c.cardBorder}`,
            }}
          >
            <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${c.divider}` }}>
              <div className="font-bold" style={{ color: c.textPrimary }}>{t('settings.title')}</div>
              <div className="text-xs mt-0.5" style={{ color: c.textMuted }}>RAY Lead Manager</div>
            </div>
            <nav className="p-1.5 space-y-0.5" data-tour="settings-navigation">
              {SECTIONS.map(s => {
                const Icon = s.Icon;
                return (
                  <button
                    key={s.key}
                    onClick={() => setSection(s.key)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all"
                    style={
                      section === s.key
                        ? { background: c.accentBg, border: `1px solid ${c.accentBorder}`, color: c.accentText }
                        : { color: c.textMuted, border: '1px solid transparent' }
                    }
                    onMouseEnter={e => { if (section !== s.key) (e.currentTarget as HTMLButtonElement).style.color = c.textSecondary; }}
                    onMouseLeave={e => { if (section !== s.key) (e.currentTarget as HTMLButtonElement).style.color = c.textMuted; }}
                  >
                    <Icon size={15} />
                    <div className="text-right flex-1">
                      <div className="font-medium leading-none">{s.label}</div>
                    </div>
                    {section !== s.key && <ChevronLeft size={12} style={{ color: c.textMuted }} />}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* ── Content ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── PROFILE ── */}
          {section === 'profile' && (
            <>
              <SectionHeader icon={<User size={18} />} title="פרופיל משתמש" desc="שם תצוגה ואיניציאלים" />
              <Card>
                {/* Avatar */}
                <div className="flex items-center gap-4 mb-6 pb-6" style={{ borderBottom: `1px solid ${c.divider}` }}>
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-md select-none" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6366f1)' }}>
                    {local.userInitials || '?'}
                  </div>
                  <div className="flex-1 text-right">
                    <div className="font-bold text-lg" style={{ color: c.textPrimary }}>{local.userName || 'שם משתמש'}</div>
                    <div className="text-sm" style={{ color: c.textMuted }}>{local.companyName}</div>
                    <div className="mt-1">
                      <span
                        className="text-xs px-2.5 py-0.5 rounded-full font-medium"
                        style={{ background: c.subtleBg, color: c.textSecondary }}
                      >מנהל מערכת</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <FormField label="שם מלא">
                    <input
                      type="text"
                      value={local.userName}
                      onChange={e => handleChange('userName', e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="הכנס שם מלא"
                    />
                  </FormField>
                  <FormField label="ראשי תיבות (לאוואטר)">
                    <input
                      type="text"
                      value={local.userInitials}
                      onChange={e => handleChange('userInitials', e.target.value.slice(0, 2).toUpperCase())}
                      className={inputCls + ' w-20 text-center'}
                      style={inputStyle}
                      placeholder="AA"
                      maxLength={2}
                    />
                  </FormField>
                  <FormField label="שם החברה">
                    <input
                      type="text"
                      value={local.companyName}
                      onChange={e => handleChange('companyName', e.target.value)}
                      className={inputCls}
                      style={inputStyle}
                      placeholder="RAY Digital Agency"
                    />
                  </FormField>
                </div>
              </Card>
            </>
          )}

          {/* ── APPEARANCE ── */}
          {section === 'appearance' && (
            <>
              <SectionHeader icon={<Palette size={18} />} title={t('settings.appearance')} desc="התאם את הממשק לטעמך" />

              {/* Language section */}
              <Card>
                <div className="font-semibold mb-3 text-right flex items-center gap-2 justify-end" style={{ color: c.textSecondary }}>
                  <Globe size={15} style={{ color: c.textMuted }} />
                  {t('settings.language')}
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setLang('he')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={
                      lang === 'he'
                        ? { background: c.accentBg, border: `2px solid ${c.accentBorder}`, color: c.accentText }
                        : { background: c.subtleBg, border: `2px solid ${c.cardBorder}`, color: c.textSecondary }
                    }
                  >
                    <span className="text-base">🇮🇱</span>
                    {t('settings.hebrew')}
                  </button>
                  <button
                    onClick={() => setLang('en')}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                    style={
                      lang === 'en'
                        ? { background: c.accentBg, border: `2px solid ${c.accentBorder}`, color: c.accentText }
                        : { background: c.subtleBg, border: `2px solid ${c.cardBorder}`, color: c.textSecondary }
                    }
                  >
                    <span className="text-base">🇺🇸</span>
                    {t('settings.english')}
                  </button>
                </div>
              </Card>
              <Card>
                <FormField label="מצב תצוגה קומפקטי">
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: c.textMuted }}>שורות צפופות יותר בטבלאות</span>
                    <Toggle
                      value={local.compactMode}
                      onChange={v => handleChange('compactMode', v)}
                    />
                  </div>
                </FormField>
              </Card>

              {/* Theme Toggle */}
              <Card>
                <div className="font-semibold mb-3 text-right flex items-center gap-2 justify-end" style={{ color: c.textSecondary }}>
                  <Moon size={15} style={{ color: c.textMuted }} />
                  נושא עיצוב
                </div>
                <div className="flex gap-3">
                  {([
                    { key: 'dark',  label: 'כהה',  icon: Moon,    desc: 'ממשק כהה' },
                    { key: 'light', label: 'בהיר', icon: Monitor, desc: 'ממשק בהיר' },
                  ] as { key: 'dark' | 'light'; label: string; icon: React.ElementType; desc: string }[]).map(opt => {
                    const Icon = opt.icon;
                    const isActive = (local.theme ?? 'dark') === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => handleChange('theme', opt.key)}
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
                <p className="text-xs mt-3 text-right" style={{ color: c.textMuted }}>שינוי נושא העיצוב יכנס לתוקף מיידית</p>
              </Card>

              <Card>
                <div className="font-semibold mb-3 text-right" style={{ color: c.textSecondary }}>צבע ראשי</div>
                <div className="flex gap-3 flex-wrap justify-end">
                  {ACCENT_COLORS.map(ac => (
                    <button
                      key={ac.key}
                      onClick={() => handleChange('accentColor', ac.key)}
                      className="flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all"
                      style={
                        local.accentColor === ac.key
                          ? { border: `2px solid ${c.cardBorderStrong}`, boxShadow: '0 0 8px rgba(99,102,241,0.3)' }
                          : { border: '2px solid transparent' }
                      }
                    >
                      <div className={`w-10 h-10 rounded-xl ${ac.swatch} shadow-sm`} />
                      <span className="text-xs" style={{ color: c.textMuted }}>{ac.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs mt-3 text-right" style={{ color: c.textMuted }}>שינוי הצבע יכנס לתוקף בגרסה הבאה</p>
              </Card>

              <Card>
                <div className="font-semibold mb-3 text-right" style={{ color: c.textSecondary }}>עמוד ברירת מחדל</div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'dashboard', label: 'לידים' },
                    { key: 'overview',  label: 'דאשבורד' },
                    { key: 'kanban',    label: 'פייפליין' },
                  ] as { key: Page; label: string }[]).map(p => (
                    <button
                      key={p.key}
                      onClick={() => handleChange('defaultPage', p.key)}
                      className="py-2 px-3 rounded-lg text-sm font-medium transition-all"
                      style={
                        local.defaultPage === p.key
                          ? { background: c.accentBg, border: `1px solid ${c.accentBorder}`, color: c.accentText }
                          : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }
                      }
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </Card>
            </>
          )}

          {/* ── NOTIFICATIONS ── */}
          {section === 'notifications' && (
            <>
              <SectionHeader icon={<Bell size={18} />} title="התראות" desc="שלוט על אילו התראות להציג" />
              <Card>
                <div className="space-y-5">
                  <NotifRow
                    icon={<AlertTriangle size={16} className="text-red-400" />}
                    title="התראות משימות פגות תוקף"
                    desc="הצג badge אדום בדף המשימות"
                    value={local.showOverduePopup}
                    onChange={v => handleChange('showOverduePopup', v)}
                  />
                  <div className="pt-5" style={{ borderTop: `1px solid ${c.divider}` }}>
                    <div className="flex items-start gap-3 justify-end">
                      <div className="text-right">
                        <div className="text-sm font-semibold" style={{ color: c.textMuted }}>שליחת מייל יומי</div>
                        <div className="text-xs mt-0.5" style={{ color: c.textMuted }}>סיכום יומי במייל</div>
                      </div>
                      <div className="flex-shrink-0">
                        <div className="w-10 h-6 rounded-full cursor-not-allowed opacity-40" style={{ background: c.subtleBg }} />
                      </div>
                    </div>
                    <p className="text-xs mt-2 text-right" style={{ color: c.textMuted }}>🔜 בקרוב — דורש אינטגרציית מייל</p>
                  </div>
                </div>
              </Card>

              {/* Stats summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-3">
                {[
                  { label: 'לקוחות פעילים', value: activeLeads, color: '#34d399', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.15)' },
                  { label: 'סה"כ משימות', value: totalTasks, color: c.textSecondary, bg: c.cardBg, border: c.cardBorder },
                  { label: 'משימות פגות תוקף', value: overdueTasks, color: '#f87171', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.15)' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4" style={{ background: s.bg, border: `1px solid ${s.border}` }}>
                    <div className="text-3xl font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-sm mt-1" style={{ color: c.textMuted }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── DATA ── */}
          {section === 'data' && (
            <>
              <SectionHeader icon={<Database size={18} />} title="ניהול נתונים" desc="ייצוא, ייבוא ואיפוס נתונים" />

              {/* Export */}
              <Card>
                <div className="font-semibold mb-1 text-right flex items-center gap-2 justify-end" style={{ color: c.textSecondary }}>
                  <span>ייצוא נתונים</span>
                  <Download size={15} style={{ color: c.textMuted }} />
                </div>
                <p className="text-xs mb-4 text-right" style={{ color: c.textMuted }}>
                  הורד עותק של הנתונים שלך
                </p>
                <div className="flex flex-wrap gap-3 justify-end">
                  <button
                    onClick={exportCSV}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}
                  >
                    <span>📊</span> ייצא CSV
                  </button>
                  <button
                    onClick={exportJSON}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                    style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}
                  >
                    <span>💾</span> גיבוי JSON מלא
                  </button>
                </div>
              </Card>

              {/* Import */}
              <Card>
                <div className="font-semibold mb-1 text-right flex items-center gap-2 justify-end" style={{ color: c.textSecondary }}>
                  <span>ייבוא לידים מ-CSV</span>
                  <Upload size={15} style={{ color: c.textMuted }} />
                </div>
                <p className="text-xs mb-3 text-right" style={{ color: c.textMuted }}>
                  הקובץ צריך לכלול: company, contactName, email, phone, status, budget, source
                </p>
                <div
                  className="rounded-xl p-6 text-center cursor-pointer transition-all"
                  style={{ background: c.subtleBg, border: '2px dashed rgba(99,102,241,0.2)' }}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload size={24} className="mx-auto mb-2" style={{ color: c.textMuted }} />
                  <div className="text-sm font-medium" style={{ color: c.textSecondary }}>לחץ לבחירת קובץ CSV</div>
                  <div className="text-xs mt-1" style={{ color: c.textMuted }}>או גרור קובץ לכאן</div>
                </div>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImportFile} />
              </Card>

              {/* Danger Zone */}
              <div
                className="rounded-xl p-5"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <div className="flex items-center gap-2 justify-end mb-3">
                  <span className="font-bold" style={{ color: '#f87171' }}>אזור מסוכן</span>
                  <Shield size={16} style={{ color: '#f87171' }} />
                </div>
                <p className="text-sm text-right mb-4" style={{ color: 'rgba(239,68,68,0.8)' }}>
                  איפוס הנתונים ישחזר את כל הלידים לנתוני ברירת המחדל. לא ניתן לבטל פעולה זו.
                </p>
                {!confirmReset ? (
                  <div className="flex justify-end">
                    <button
                      onClick={() => setConfirmReset(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                      style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.32)', color: '#f87171' }}
                    >
                      <RefreshCw size={14} />
                      אפס לנתוני ברירת מחדל
                    </button>
                  </div>
                ) : (
                  <div
                    className="rounded-xl p-4 space-y-3"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(239,68,68,0.2)' }}
                  >
                    <div className="text-sm font-semibold text-right" style={{ color: '#f87171' }}>⚠️ האם אתה בטוח? פעולה זו בלתי הפיכה!</div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setConfirmReset(false)}
                        className="px-4 py-2 text-sm rounded-lg transition-colors"
                        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}
                      >
                        ביטול
                      </button>
                      <button
                        onClick={handleReset}
                        className="px-4 py-2 text-sm rounded-lg font-semibold transition-colors"
                        style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.32)', color: '#f87171' }}
                      >
                        כן, אפס הכל
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── INTEGRATIONS ─────────────────────────────────────────────── */}
          {section === 'integrations' && (
            <div className="-mx-0">
              {integrationsPanel ?? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                  <PlugZap size={32} className="opacity-20"/>
                  <p className="text-sm font-semibold opacity-40">לא נמצאו אינטגרציות</p>
                </div>
              )}
            </div>
          )}

          {/* ── TEAM ── */}
          {section === 'team' && (
            <>
              <SectionHeader icon={<Users size={18} />} title="צוות ומשתמשים" desc="חברי צוות, הזמנות, הרשאות וסטטיסטיקות" />

              {/* ── TeamManagement (members / invites / stats / assignment) ── */}
              <TeamManagement
                team={team}
                leads={leads}
                workspaceId={workspaceId}
                emailConfigured={!!(emailGmailUser && emailPasswordSet)}
                onUpdateRole={onUpdateRole ?? (() => {})}
                onInvite={onInvite ?? (() => {})}
                onRemoveMember={onRemoveMember}
                onAssignLead={onAssignLead}
              />

              {/* ── Registered users + invite link (admin only) ── */}
              {isAdmin && (
                <div className="space-y-4 mt-6">
                  <div className="flex items-center gap-2 justify-end">
                    <h3 className="font-bold" style={{ color: c.textSecondary }}>משתמשים רשומים והרשאות</h3>
                    <Users2 size={16} style={{ color: c.textMuted }} />
                  </div>

                  {/* Create Invite link */}
                  <Card>
                    <div className="font-semibold mb-4 text-right flex items-center gap-2 justify-end" style={{ color: c.textSecondary }}>
                      <span>יצירת קישור הזמנה</span>
                      <Link size={15} style={{ color: c.textMuted }} />
                    </div>
                    <div className="space-y-4">
                      <FormField label="אימייל מוזמן">
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={e => setInviteEmail(e.target.value)}
                          className={inputCls}
                          style={inputStyle}
                          placeholder="user@example.com"
                          dir="ltr"
                        />
                      </FormField>
                      <FormField label="תפקיד">
                        <select
                          value={inviteRole}
                          onChange={e => setInviteRole(e.target.value as 'admin' | 'agent')}
                          className={inputCls}
                          style={inputStyle}
                        >
                          <option value="agent" style={{ background: '#0a0f1e' }}>סוכן</option>
                          <option value="admin" style={{ background: '#0a0f1e' }}>מנהל</option>
                        </select>
                      </FormField>
                      <div>
                        <div className="text-sm font-medium mb-2 text-right" style={{ color: c.textSecondary }}>עמודים מורשים</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {ALL_PAGES.map(({ page, label }) => (
                            <label key={page} className="flex items-center gap-2 cursor-pointer select-none justify-end">
                              <span className="text-xs" style={{ color: c.textSecondary }}>{label}</span>
                              <input
                                type="checkbox"
                                checked={invitePages.includes(page)}
                                onChange={e => {
                                  if (e.target.checked) setInvitePages(prev => [...prev, page]);
                                  else setInvitePages(prev => prev.filter(p => p !== page));
                                }}
                                className="w-4 h-4 rounded accent-indigo-600"
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={handleCreateInvite}
                          disabled={inviteLoading}
                          className="flex items-center gap-2 px-5 py-2.5 disabled:opacity-50 text-sm font-semibold rounded-xl transition-colors"
                          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
                        >
                          <Link size={14} />
                          {inviteLoading ? 'יוצר...' : 'צור קישור הזמנה'}
                        </button>
                      </div>
                      {inviteLink && (
                        <div
                          className="rounded-xl p-4"
                          style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}
                        >
                          <div className="text-xs font-semibold mb-2 text-right" style={{ color: '#818cf8' }}>קישור הזמנה:</div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => { navigator.clipboard.writeText(inviteLink); onToast('הקישור הועתק ✓', 'success'); }}
                              className="flex-shrink-0 p-2 rounded-lg transition-colors"
                              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)' }}
                            >
                              <Copy size={14} style={{ color: '#818cf8' }} />
                            </button>
                            <input
                              readOnly value={inviteLink}
                              className="flex-1 min-w-0 text-xs rounded-lg px-3 py-2 truncate"
                              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#818cf8' }}
                              dir="ltr"
                              onClick={e => (e.target as HTMLInputElement).select()}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>

                  {/* Users list */}
                  <Card>
                    <div className="font-semibold mb-4 text-right flex items-center gap-2 justify-end" style={{ color: c.textSecondary }}>
                      <span>משתמשים רשומים</span>
                      <Users2 size={15} style={{ color: c.textMuted }} />
                    </div>
                    {usersLoading ? (
                      <div className="flex justify-center py-8">
                        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : users.length === 0 ? (
                      <p className="text-sm text-right py-4" style={{ color: c.textMuted }}>אין משתמשים רשומים עדיין</p>
                    ) : (
                      <div className="space-y-3">
                        {users.map(u => (
                          <div
                            key={u.uid}
                            className="rounded-xl p-4"
                            style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => setConfirmDeleteUid(u.uid)}
                                  className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
                                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
                                  title="מחק משתמש"
                                >
                                  <Trash2 size={12} />
                                  <span>מחק</span>
                                </button>
                                <button
                                  onClick={() => handlePasswordReset(u.email)}
                                  className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
                                  style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}
                                >
                                  <KeyRound size={12} />
                                  <span>שחזור סיסמה</span>
                                </button>
                                <button
                                  onClick={() => {
                                    if (editingUid === u.uid) { setEditingUid(null); }
                                    else { setEditingUid(u.uid); setEditPages([...u.allowedPages]); }
                                  }}
                                  className="flex items-center gap-1 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
                                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}
                                >
                                  {editingUid === u.uid ? 'ביטול' : 'ערוך הרשאות'}
                                </button>
                              </div>
                              <div className="text-right">
                                <div className="flex items-center gap-2 justify-end">
                                  <span
                                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    style={
                                      u.role === 'admin'
                                        ? { background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.3)' }
                                        : { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }
                                    }
                                  >
                                    {u.role === 'admin' ? 'מנהל' : 'סוכן'}
                                  </span>
                                  <p className="text-sm font-semibold" style={{ color: c.textPrimary }}>{u.firstName} {u.lastName}</p>
                                </div>
                                <div className="flex items-center gap-1 justify-end mt-0.5">
                                  <Mail size={10} style={{ color: c.textMuted }} />
                                  <p className="text-xs" style={{ color: c.textMuted }} dir="ltr">{u.email}</p>
                                </div>
                              </div>
                            </div>
                            {editingUid === u.uid && (
                              <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${c.divider}` }}>
                                <div className="text-xs font-semibold mb-2 text-right" style={{ color: c.textMuted }}>עמודים מורשים:</div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                                  {ALL_PAGES.map(({ page, label }) => (
                                    <label key={page} className="flex items-center gap-2 cursor-pointer select-none justify-end">
                                      <span className="text-xs" style={{ color: c.textSecondary }}>{label}</span>
                                      <input
                                        type="checkbox"
                                        checked={editPages.includes(page)}
                                        onChange={e => {
                                          if (e.target.checked) setEditPages(prev => [...prev, page]);
                                          else setEditPages(prev => prev.filter(p => p !== page));
                                        }}
                                        className="w-4 h-4 rounded accent-indigo-600"
                                      />
                                    </label>
                                  ))}
                                </div>
                                <div className="flex justify-end">
                                  <button
                                    onClick={() => handleSaveUserPages(u.uid)}
                                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors"
                                    style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.35)', color: '#818cf8' }}
                                  >
                                    <CheckCircle2 size={12} />
                                    שמור הרשאות
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              )}

              {/* ── Confirm Delete Dialog ── */}
              {confirmDeleteUid && (() => {
                const target = users.find(u => u.uid === confirmDeleteUid);
                if (!target) return null;
                return (
                  <div className="fixed inset-0 backdrop-blur-sm z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
                    <div
                      className="rounded-2xl shadow-2xl max-w-sm w-full p-6 text-right"
                      style={{ background: c.cardBg, border: `1px solid ${c.cardBorderStrong}` }}
                      dir="rtl"
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                          <Trash2 size={18} style={{ color: '#f87171' }} />
                        </div>
                        <div>
                          <h3 className="font-bold" style={{ color: c.textPrimary }}>מחיקת משתמש</h3>
                          <p className="text-xs" style={{ color: c.textMuted }}>פעולה זו אינה ניתנת לביטול</p>
                        </div>
                      </div>
                      <p className="text-sm mb-6" style={{ color: c.textSecondary }}>
                        האם למחוק את{' '}
                        <span className="font-semibold" style={{ color: c.textPrimary }}>{target.firstName} {target.lastName}</span>
                        {' '}({target.email})?
                        <br />
                        <span className="text-xs block mt-1" style={{ color: c.textMuted }}>המשתמש יאבד גישה מיידית למערכת.</span>
                      </p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setConfirmDeleteUid(null)}
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                          style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}
                        >
                          ביטול
                        </button>
                        <button
                          onClick={() => handleDeleteUser(confirmDeleteUid)}
                          disabled={deletingUid === confirmDeleteUid}
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                          style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.32)', color: '#f87171' }}
                        >
                          {deletingUid === confirmDeleteUid
                            ? <><div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />מוחק...</>
                            : <><Trash2 size={14} />מחק משתמש</>
                          }
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* ── EMAIL — moved to Integrations ── */}
          {section === 'email' && (
            <>
              <SectionHeader icon={<Mail size={18} />} title="חיבור אימייל" desc="הגדרות האימייל עברו לדף האינטגרציות" />
              <Card>
                <div className="flex flex-col items-center gap-4 py-6 text-center">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
                    style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
                    📨
                  </div>
                  <div>
                    <p className="font-bold mb-1" style={{ color: c.textPrimary }}>הגדרות אימייל הועברו לדף האינטגרציות</p>
                    <p className="text-sm" style={{ color: c.textSecondary }}>
                      ניתן לחבר Gmail, Outlook, או EmailJS ישירות מדף האינטגרציות —
                      עם הוראות מלאות לכל ספק.
                    </p>
                  </div>
                  {onNavigateTo && (
                    <button
                      onClick={() => onNavigateTo('integrations')}
                      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                      style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
                    >
                      <Mail size={15} />
                      עבור לאינטגרציות
                    </button>
                  )}
                </div>
              </Card>
            </>
          )}

          {/* ── REVENUE ── */}
          {section === 'revenue' && <RevenueSection leads={leads} c={c as Record<string, string>} isDark={isDark} />}

          {/* ── ABOUT ── */}
          {section === 'about' && (
            <>
              <SectionHeader icon={<Info size={18} />} title="אודות RAY Lead Manager" desc="מידע על המערכת" />
              <Card>
                <div className="flex items-center gap-4 mb-6">
                  <svg width="56" height="56" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0 rounded-2xl shadow-md">
                    <rect width="100" height="100" rx="16" fill="black"/>
                    <rect x="22" y="62" width="56" height="8" rx="4" fill="white"/>
                    <rect x="22" y="48" width="40" height="7" rx="3.5" fill="white"/>
                    <rect x="22" y="30" width="56" height="12" rx="6" fill="white"/>
                    <rect x="52" y="48" width="26" height="22" rx="4" fill="white"/>
                  </svg>
                  <div className="text-right flex-1">
                    <div className="font-black text-xl tracking-tight" style={{ color: c.textPrimary }}>RAY</div>
                    <div className="font-semibold" style={{ color: c.textSecondary }}>Lead Manager</div>
                    <div className="text-sm" style={{ color: c.textMuted }}>RAY Digital Agency</div>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { label: 'גרסה',        value: 'v2.4.0',         icon: <Zap size={14} /> },
                    { label: 'מסד נתונים',  value: 'Firebase Firestore', icon: <Database size={14} /> },
                    { label: 'ממשק',        value: 'React + TypeScript + Tailwind', icon: <Monitor size={14} /> },
                    { label: 'AI',          value: 'Claude (Anthropic)', icon: <SparklesIcon size={14} /> },
                    { label: 'אחסון',       value: 'Vercel Edge Network', icon: <Globe size={14} /> },
                    { label: 'עיצוב',       value: 'RTL Hebrew, Dark/Light', icon: <Moon size={14} /> },
                  ].map(({ label, value, icon }) => (
                    <div key={label} className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${c.divider}` }}>
                      <div className="text-sm font-medium" style={{ color: c.textSecondary }}>{value}</div>
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: c.textMuted }}>
                        <span>{label}</span>
                        <span style={{ color: c.textMuted }}>{icon}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              <div
                className="rounded-xl p-5"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                <div className="font-bold text-lg mb-1 text-right" style={{ color: '#a78bfa' }}>סטטיסטיקות המערכת</div>
                <div className="grid grid-cols-3 gap-3 md:gap-4 mt-4">
                  {[
                    { label: 'לידים',   value: leads.length },
                    { label: 'משימות',  value: totalTasks },
                    { label: 'הערות',   value: leads.reduce((s, l) => s + l.notes.length, 0) },
                  ].map(s => (
                    <div
                      key={s.label}
                      className="text-center rounded-xl py-3"
                      style={{ background: 'rgba(139,92,246,0.12)' }}
                    >
                      <div className="text-2xl font-bold" style={{ color: '#a78bfa' }}>{s.value}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'rgba(167,139,250,0.6)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}


          {/* ── CHANGE PASSWORD ── */}
          {section === 'password' && (
            <>
              <SectionHeader icon={<Lock size={18} />} title="שינוי סיסמה" desc="עדכן את הסיסמה שלך ישירות — ללא צורך בשליחת מייל" />
              <Card>
                {pwSuccess && (
                  <div
                    className="flex items-center gap-2 rounded-xl px-4 py-3 mb-5 text-right"
                    style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}
                  >
                    <CheckCircle2 size={16} className="flex-shrink-0" style={{ color: '#34d399' }} />
                    <span className="text-sm font-semibold" style={{ color: '#34d399' }}>הסיסמה עודכנה בהצלחה!</span>
                  </div>
                )}
                <div className="space-y-4">
                  {/* Current password */}
                  <div>
                    <label className="block text-sm font-semibold mb-1.5 text-right" style={{ color: c.textSecondary }}>סיסמה נוכחית</label>
                    <div className="relative">
                      <input
                        type={pwShowCur ? 'text' : 'password'}
                        value={pwCurrent}
                        onChange={e => setPwCurrent(e.target.value)}
                        placeholder="הסיסמה שלך כרגע"
                        className="w-full rounded-xl px-4 pl-10 py-2.5 text-sm text-right focus:outline-none"
                        style={inputStyle}
                        dir="ltr"
                      />
                      <button type="button" onClick={() => setPwShowCur(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors" style={{ color: c.textMuted }}>
                        {pwShowCur ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                  {/* New password */}
                  <div>
                    <label className="block text-sm font-semibold mb-1.5 text-right" style={{ color: c.textSecondary }}>סיסמה חדשה</label>
                    <div className="relative">
                      <input
                        type={pwShowNew ? 'text' : 'password'}
                        value={pwNew}
                        onChange={e => setPwNew(e.target.value)}
                        placeholder="לפחות 6 תווים"
                        className="w-full rounded-xl px-4 pl-10 py-2.5 text-sm text-right focus:outline-none"
                        style={inputStyle}
                        dir="ltr"
                      />
                      <button type="button" onClick={() => setPwShowNew(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 transition-colors" style={{ color: c.textMuted }}>
                        {pwShowNew ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    {/* Strength bar */}
                    {pwNew.length > 0 && (
                      <div className="flex gap-1 mt-2">
                        {[1,2,3,4].map(i => (
                          <div key={i} className={`h-1 flex-1 rounded-full`} style={{ background: pwNew.length >= i * 3 ? (pwNew.length >= 10 ? '#34d399' : pwNew.length >= 6 ? '#fbbf24' : '#f87171') : 'rgba(255,255,255,0.1)' }} />
                        ))}
                        <span className="text-[10px] w-10 text-left" style={{ color: c.textMuted }}>{pwNew.length < 6 ? 'חלשה' : pwNew.length < 10 ? 'בינונית' : 'חזקה'}</span>
                      </div>
                    )}
                  </div>
                  {/* Confirm */}
                  <div>
                    <label className="block text-sm font-semibold mb-1.5 text-right" style={{ color: c.textSecondary }}>אימות סיסמה חדשה</label>
                    <input
                      type={pwShowNew ? 'text' : 'password'}
                      value={pwConfirm}
                      onChange={e => setPwConfirm(e.target.value)}
                      placeholder="הכנס שוב את הסיסמה החדשה"
                      className="w-full rounded-xl px-4 py-2.5 text-sm text-right focus:outline-none"
                      style={inputStyle}
                      dir="ltr"
                    />
                  </div>
                  {/* Error */}
                  {pwError && (
                    <div
                      className="flex items-center gap-2 text-sm rounded-xl px-4 py-3 text-right"
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
                    >
                      <AlertTriangle size={14} className="flex-shrink-0" />
                      {pwError}
                    </div>
                  )}
                  <button
                    onClick={handleChangePassword}
                    disabled={pwLoading}
                    className="w-full disabled:opacity-50 font-bold py-3 rounded-xl transition-colors"
                    style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
                  >
                    {pwLoading ? 'מעדכן...' : 'עדכן סיסמה'}
                  </button>
                </div>
              </Card>
            </>
          )}

          {/* ── SECURITY (admin only) ── */}
          {section === 'security' && isAdmin && (
            <>
              <SectionHeader icon={<Shield size={18} />} title="אבטחה וגישה" desc="שליטה על אימות וכניסת משתמשים" />

              <Card>
                <div className="text-right mb-5">
                  <p className="font-semibold mb-1" style={{ color: c.textSecondary }}>כניסה ללא אימות (Dev Mode)</p>
                  <p className="text-sm" style={{ color: c.textMuted }}>פיצ'ר זה פעיל <strong style={{ color: c.textSecondary }}>אוטומטית</strong> בסביבת פיתוח מקומית (localhost) בלבד — ללא צורך בהגדרה כאן</p>
                </div>

                <div
                  className="rounded-xl p-4 text-right"
                  style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}
                >
                  <div className="flex items-start gap-2">
                    <Info size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#60a5fa' }} />
                    <div>
                      <p className="text-sm font-semibold mb-1" style={{ color: '#60a5fa' }}>הגדרת Dev Mode</p>
                      <p className="text-xs leading-relaxed" style={{ color: 'rgba(96,165,250,0.8)' }}>
                        כאשר האפליקציה רצה על <code className="px-1 rounded" style={{ background: 'rgba(59,130,246,0.15)', color: '#93c5fd' }}>localhost</code> ואין משתמש מחובר, המערכת מאפשרת כניסה ישירה לצרכי פיתוח. בסביבת Production (ray-crm-app.web.app) נדרש אימות תמיד.
                      </p>
                      <p className="text-xs mt-2 font-medium" style={{ color: 'rgba(96,165,250,0.7)' }}>⚙️ לשינוי התנהגות זו — ערוך את קובץ App.tsx שורה: const bypassAuth = isLocalhost && !user</p>
                    </div>
                  </div>
                </div>

                <div
                  className="mt-4 flex items-start gap-2 rounded-xl p-3 text-right"
                  style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}
                >
                  <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#fbbf24' }} />
                  <p className="text-xs" style={{ color: '#fbbf24' }}>
                    <strong>אזהרה:</strong> לעולם אל תפרוס ל-Production ללא אימות. Firestore Security Rules חייבים לדרוש auth בסביבת ייצור.
                  </p>
                </div>
              </Card>
            </>
          )}

          {/* ── Save Button ── */}
          {section !== 'data' && section !== 'about' && section !== 'users' && section !== 'security' && section !== 'password' && section !== 'team' && section !== 'email' && section !== 'revenue' && (
            <div className="flex justify-start">
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold text-sm transition-all text-white"
                style={
                  saved
                    ? { background: 'rgba(52,211,153,0.2)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399' }
                    : { background: 'linear-gradient(135deg,#8b5cf6,#6366f1)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }
                }
              >
                {saved ? <><CheckCircle2 size={15} />נשמר!</> : <><Save size={15} />שמור שינויים</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */
function SectionHeader({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  const { c } = useTheme();
  return (
    <div className="flex items-center gap-3 justify-end">
      <div className="text-right">
        <h2 className="text-lg font-bold" style={{ color: c.textPrimary }}>{title}</h2>
        <p className="text-xs" style={{ color: c.textMuted }}>{desc}</p>
      </div>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center"
        style={{ background: c.accentBg, color: c.accentText }}
      >
        {icon}
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: c.cardBg,
        border: `1px solid ${c.cardBorder}`,
      }}
    >
      {children}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
      <label className="text-sm font-medium text-right sm:min-w-[120px] sm:order-last" style={{ color: c.textSecondary }}>{label}</label>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { c } = useTheme();
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ background: value ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : c.subtleBg }}
    >
      <div
        className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all duration-200"
        style={{ left: value ? '1.25rem' : '0.125rem', boxShadow: value ? '0 0 6px rgba(99,102,241,0.5)' : 'none' }}
      />
    </button>
  );
}

function NotifRow({ icon, title, desc, value, onChange }: {
  icon: React.ReactNode; title: string; desc: string;
  value: boolean; onChange: (v: boolean) => void;
}) {
  const { c } = useTheme();
  return (
    <div className="flex items-center gap-3 justify-between">
      <Toggle value={value} onChange={onChange} />
      <div className="flex-1 text-right">
        <div className="text-sm font-semibold flex items-center gap-1.5 justify-end" style={{ color: c.textSecondary }}>
          {title}
          {icon}
        </div>
        <div className="text-xs mt-0.5" style={{ color: c.textMuted }}>{desc}</div>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm text-right focus:outline-none transition-all';

// SparklesIcon used in about section
function SparklesIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   REVENUE SECTION — professional revenue management dashboard
───────────────────────────────────────────────────────────────────────────── */
function RevenueSection({ leads, c, isDark }: { leads: Lead[]; c: Record<string, string>; isDark: boolean }) {
  // ── Derive revenue data from solutions ────────────────────────────────────
  const activeLeadsWithRevenue = leads.filter(
    l => l.status === 'לקוח פעיל' && l.solutions.some(s => s.price && s.price > 0)
  );
  const pipelineLeads = leads.filter(
    l => !['לקוח פעיל', 'לא רלוונטי'].includes(l.status) && l.solutions.some(s => s.price && s.price > 0)
  );

  // Monthly recurring revenue (active clients, monthly-type solutions)
  const mrr = leads
    .filter(l => l.status === 'לקוח פעיל')
    .reduce((sum, l) => sum + l.solutions.reduce((s2, sol) =>
      s2 + ((!sol.priceType || sol.priceType === 'monthly') ? (sol.price ?? 0) : 0), 0), 0);

  // One-time revenue (active clients)
  const oneTimeRevenue = leads
    .filter(l => l.status === 'לקוח פעיל')
    .reduce((sum, l) => sum + l.solutions.reduce((s2, sol) =>
      s2 + (sol.priceType === 'one_time' ? (sol.price ?? 0) : 0), 0), 0);

  // Pipeline potential revenue (monthly)
  const pipelinePotential = pipelineLeads.reduce((sum, l) =>
    sum + l.solutions.reduce((s2, sol) => s2 + (sol.price ?? 0), 0), 0);

  // Annual recurring (MRR × 12)
  const arr = mrr * 12;

  // ── By solution type ───────────────────────────────────────────────────────
  const solutionMap = new Map<string, { monthly: number; oneTime: number; count: number }>();
  leads.filter(l => l.status === 'לקוח פעיל').forEach(l => {
    l.solutions.forEach(sol => {
      if (!sol.price || sol.price <= 0) return;
      const existing = solutionMap.get(sol.name) ?? { monthly: 0, oneTime: 0, count: 0 };
      if (!sol.priceType || sol.priceType === 'monthly') existing.monthly += sol.price;
      else existing.oneTime += sol.price;
      existing.count += 1;
      solutionMap.set(sol.name, existing);
    });
  });
  const solutionBreakdown = Array.from(solutionMap.entries())
    .map(([name, data]) => ({ name, ...data, total: data.monthly + data.oneTime }))
    .sort((a, b) => b.total - a.total);

  const maxSolRevenue = Math.max(...solutionBreakdown.map(s => s.total), 1);

  // ── Top clients by revenue ─────────────────────────────────────────────────
  const clientRevenue = leads
    .filter(l => l.solutions.some(s => s.price && s.price > 0))
    .map(l => ({
      lead: l,
      monthly: l.solutions.filter(s => !s.priceType || s.priceType === 'monthly').reduce((s, sol) => s + (sol.price ?? 0), 0),
      oneTime: l.solutions.filter(s => s.priceType === 'one_time').reduce((s, sol) => s + (sol.price ?? 0), 0),
      total: l.solutions.reduce((s, sol) => s + (sol.price ?? 0), 0),
    }))
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const maxClientRevenue = Math.max(...clientRevenue.map(c => c.total), 1);

  const fmt = (n: number) => '₪' + n.toLocaleString('he-IL');

  const statusColor = (status: string) => {
    if (status === 'לקוח פעיל') return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.25)', text: '#34d399' };
    if (status === 'לא רלוונטי') return { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', text: '#f87171' };
    return { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.2)', text: '#818cf8' };
  };

  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader icon={<TrendingUp size={18} />} title="ניהול הכנסות" desc="סקירת הכנסות לפי לקוחות ושירותים" />

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'הכנסה חודשית (MRR)',
            value: fmt(mrr),
            sub: `${activeLeadsWithRevenue.length} לקוחות פעילים`,
            icon: <DollarSign size={16} />,
            color: '#10b981',
            bg: 'rgba(16,185,129,0.08)',
            border: 'rgba(16,185,129,0.2)',
          },
          {
            label: 'הכנסה שנתית (ARR)',
            value: fmt(arr),
            sub: 'MRR × 12',
            icon: <BarChart3 size={16} />,
            color: '#6366f1',
            bg: 'rgba(99,102,241,0.08)',
            border: 'rgba(99,102,241,0.2)',
          },
          {
            label: 'חד-פעמי (פעיל)',
            value: fmt(oneTimeRevenue),
            sub: 'פרויקטים ועסקאות',
            icon: <Briefcase size={16} />,
            color: '#f97316',
            bg: 'rgba(249,115,22,0.08)',
            border: 'rgba(249,115,22,0.2)',
          },
          {
            label: 'פוטנציאל פייפליין',
            value: fmt(pipelinePotential),
            sub: `${pipelineLeads.length} לידים עם מחיר`,
            icon: <ArrowUpRight size={16} />,
            color: '#a78bfa',
            bg: 'rgba(139,92,246,0.08)',
            border: 'rgba(139,92,246,0.2)',
          },
        ].map(kpi => (
          <div
            key={kpi.label}
            className="rounded-xl p-4"
            style={{ background: kpi.bg, border: `1px solid ${kpi.border}` }}
          >
            <div className="flex items-center gap-1.5 mb-2" style={{ color: kpi.color }}>
              {kpi.icon}
              <span className="text-[10px] font-semibold uppercase tracking-wide">{kpi.label}</span>
            </div>
            <div className="text-xl font-black" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="text-[10px] mt-0.5" style={{ color: c.textMuted }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Revenue by Solution ── */}
      <div
        className="rounded-xl p-5"
        style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}
      >
        <div className="flex items-center gap-2 justify-end mb-4">
          <h3 className="font-bold text-sm" style={{ color: c.textPrimary }}>הכנסות לפי שירות</h3>
          <BarChart3 size={15} style={{ color: c.textMuted }} />
        </div>

        {solutionBreakdown.length === 0 ? (
          <div className="text-center py-8" style={{ color: c.textMuted }}>
            <DollarSign size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">לא הוגדרו מחירים לשירותים עדיין</p>
            <p className="text-xs mt-1">הכנס מחירים בכרטיסי הלידים ← לשונית שירותים</p>
          </div>
        ) : (
          <div className="space-y-3">
            {solutionBreakdown.map(sol => (
              <div key={sol.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {sol.monthly > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399' }}>
                        {fmt(sol.monthly)}/חודש
                      </span>
                    )}
                    {sol.oneTime > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                        style={{ background: 'rgba(249,115,22,0.12)', color: '#fb923c' }}>
                        {fmt(sol.oneTime)} חד-פ'
                      </span>
                    )}
                    <span className="text-[10px]" style={{ color: c.textMuted }}>{sol.count} לקוחות</span>
                  </div>
                  <span className="text-sm font-bold" style={{ color: c.textPrimary }}>{sol.name}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(sol.total / maxSolRevenue) * 100}%`,
                      background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Top Clients Table ── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}
      >
        <div className="flex items-center gap-2 justify-end px-5 py-4" style={{ borderBottom: `1px solid ${c.divider}` }}>
          <h3 className="font-bold text-sm" style={{ color: c.textPrimary }}>הכנסות לפי לקוח</h3>
          <Briefcase size={15} style={{ color: c.textMuted }} />
        </div>

        {clientRevenue.length === 0 ? (
          <div className="text-center py-8" style={{ color: c.textMuted }}>
            <p className="text-sm">אין לקוחות עם מחירים מוגדרים</p>
          </div>
        ) : (
          <div>
            {clientRevenue.map((item, idx) => {
              const sc = statusColor(item.lead.status);
              const pct = (item.total / maxClientRevenue) * 100;
              return (
                <div
                  key={item.lead.id}
                  className="px-5 py-3 flex items-center gap-3"
                  style={{
                    borderBottom: idx < clientRevenue.length - 1 ? `1px solid ${c.divider}` : 'none',
                    background: idx % 2 === 0 ? 'transparent' : (isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.015)'),
                  }}
                >
                  {/* Rank */}
                  <div className="text-xs font-bold w-5 text-center flex-shrink-0" style={{ color: c.textMuted }}>
                    {idx + 1}
                  </div>

                  {/* Bar + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <div className="flex items-center gap-2">
                        {item.monthly > 0 && (
                          <span className="text-[10px] font-semibold" style={{ color: '#34d399' }}>
                            {fmt(item.monthly)}/חו'
                          </span>
                        )}
                        {item.oneTime > 0 && (
                          <span className="text-[10px] font-semibold" style={{ color: '#fb923c' }}>
                            {fmt(item.oneTime)} ח"פ
                          </span>
                        )}
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                          style={{ background: sc.bg, border: `1px solid ${sc.border}`, color: sc.text }}
                        >
                          {item.lead.status}
                        </span>
                      </div>
                      <span className="text-sm font-bold truncate" style={{ color: c.textPrimary }}>
                        {item.lead.company}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' }}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: item.lead.status === 'לקוח פעיל'
                            ? 'linear-gradient(90deg,#10b981,#34d399)'
                            : 'linear-gradient(90deg,#6366f1,#8b5cf6)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Total */}
                  <div className="text-sm font-black flex-shrink-0" style={{ color: item.lead.status === 'לקוח פעיל' ? '#34d399' : c.textSecondary }}>
                    {fmt(item.total)}
                  </div>
                </div>
              );
            })}

            {/* Footer totals */}
            <div
              className="px-5 py-3 flex items-center justify-between"
              style={{ borderTop: `1px solid ${c.divider}`, background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }}
            >
              <div className="text-sm font-black" style={{ color: '#10b981' }}>{fmt(mrr + oneTimeRevenue)}</div>
              <div className="text-xs font-semibold" style={{ color: c.textMuted }}>סה"כ הכנסות (לקוחות פעילים)</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Pipeline Potential ── */}
      {pipelineLeads.length > 0 && (
        <div
          className="rounded-xl p-5"
          style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)' }}
        >
          <div className="flex items-center gap-2 justify-end mb-4">
            <h3 className="font-bold text-sm" style={{ color: '#a78bfa' }}>פוטנציאל מהפייפליין</h3>
            <ArrowUpRight size={15} style={{ color: '#a78bfa' }} />
          </div>
          <div className="space-y-2">
            {pipelineLeads
              .map(l => ({
                lead: l,
                total: l.solutions.reduce((s, sol) => s + (sol.price ?? 0), 0),
              }))
              .sort((a, b) => b.total - a.total)
              .map(item => (
                <div key={item.lead.id} className="flex items-center justify-between">
                  <span className="text-sm font-bold" style={{ color: '#a78bfa' }}>{fmt(item.total)}</span>
                  <div className="text-right">
                    <span className="text-sm" style={{ color: c.textSecondary }}>{item.lead.company}</span>
                    <span className="text-xs mr-2" style={{ color: c.textMuted }}>{item.lead.status}</span>
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(139,92,246,0.2)' }}>
            <span className="text-base font-black" style={{ color: '#a78bfa' }}>{fmt(pipelinePotential)}</span>
            <span className="text-xs" style={{ color: 'rgba(167,139,250,0.7)' }}>סה"כ פוטנציאל חודשי</span>
          </div>
        </div>
      )}
    </div>
  );
}
