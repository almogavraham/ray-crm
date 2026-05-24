import { useState, useRef, useEffect } from 'react';
import {
  Building2, Phone, Mail, Hash, Sparkles, Users2, Image, Save, Copy,
  Lock, Eye, EyeOff, CheckCircle2, AlertCircle, UserPlus, Trash2,
  ChevronLeft, Crown, User, RefreshCw, Send, AlertTriangle,
} from 'lucide-react';
import {
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { doc, updateDoc, setDoc, deleteDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { WorkspaceProfile, TeamMember } from '../types';

interface Props {
  workspace: WorkspaceProfile;
  team: TeamMember[];
  currentUserUid: string;
  currentUserEmail: string;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate: () => Promise<void>;
}

type Section = 'workspace' | 'password' | 'team' | 'plan' | 'email';

const INDUSTRIES = [
  'סוכנות שיווק', 'נדל"ן', 'טכנולוגיה', 'פיננסים',
  'שירותים עסקיים', 'קמעונאות', 'בריאות', 'חינוך', 'אחר',
];

const INPUT = 'w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export default function WorkspaceSettings({
  workspace, team, currentUserUid, currentUserEmail, onToast, onWorkspaceUpdate,
}: Props) {
  const [section, setSection] = useState<Section>('workspace');

  // ── Workspace profile state ──────────────────────────────────────────────
  const [wsName,     setWsName]     = useState(workspace.name ?? '');
  const [wsPhone,    setWsPhone]    = useState(workspace.phone ?? '');
  const [wsBizId,    setWsBizId]    = useState(workspace.businessId ?? '');
  const [wsIndustry, setWsIndustry] = useState(workspace.industry ?? '');
  const [wsPrompt,   setWsPrompt]   = useState(workspace.prompt ?? '');
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

  // ── Logo upload ──────────────────────────────────────────────────────────
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { onToast('הלוגו חייב להיות עד 2MB', 'error'); return; }
    const reader = new FileReader();
    reader.onload = ev => setWsLogo(ev.target?.result as string ?? '');
    reader.readAsDataURL(file);
  };

  // ── Save workspace profile ───────────────────────────────────────────────
  const handleSaveWorkspace = async () => {
    if (!wsName.trim()) { onToast('שם העסק הוא שדה חובה', 'error'); return; }
    setWsSaving(true);
    try {
      const updates: Record<string, unknown> = {
        name: wsName.trim(),
        phone: wsPhone.trim(),
        businessId: wsBizId.trim(),
        prompt: wsPrompt.trim(),
      };
      if (wsIndustry) updates.industry = wsIndustry;
      if (wsLogo)     updates.logoUrl  = wsLogo;
      await updateDoc(doc(db, 'workspaces', workspace.id), updates);
      await onWorkspaceUpdate();
      onToast('הגדרות הסביבה נשמרו ✓', 'success');
    } catch (err) {
      console.error(err);
      onToast('שגיאה בשמירת ההגדרות', 'error');
    } finally {
      setWsSaving(false);
    }
  };

  // ── Change password ──────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    setPwError('');
    if (newPw.length < 6)         { setPwError('הסיסמה חייבת להכיל לפחות 6 תווים'); return; }
    if (newPw !== confirmPw)      { setPwError('הסיסמאות אינן תואמות'); return; }
    if (!auth.currentUser)        { setPwError('לא מחובר'); return; }
    setPwSaving(true);
    try {
      const cred = EmailAuthProvider.credential(currentUserEmail, currentPw);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPw);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      onToast('הסיסמה עודכנה בהצלחה ✓', 'success');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential')
        setPwError('הסיסמה הנוכחית שגויה');
      else
        setPwError('שגיאה בעדכון הסיסמה');
    } finally {
      setPwSaving(false);
    }
  };

  // ── Invite team member ───────────────────────────────────────────────────
  const handleInvite = async () => {
    if (!inviteEmail.trim()) { onToast('הזן כתובת אימייל', 'error'); return; }
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
      onToast(`קישור הזמנה נוצר ועובר ל-${inviteEmail} — הועתק ללוח ✓`, 'success');
      setInviteEmail('');
    } catch (err) {
      console.error(err);
      onToast('שגיאה ביצירת ההזמנה', 'error');
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
      onToast('הגדרות האימייל נשמרו ✓', 'success');
      setTimeout(() => setEmailSaved(false), 3000);
    } catch {
      onToast('שגיאה בשמירת הגדרות האימייל', 'error');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleTestEmail = async () => {
    if (!emailServiceId || !emailPublicKey || !emailTemplateId) {
      onToast('מלא את כל שדות ה-EmailJS לפני בדיקה', 'error');
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
          subject:   'RAY CRM — בדיקת חיבור אימייל',
          message:   'החיבור לאימייל עובד בהצלחה! 🎉',
          from_name: emailFromName || 'RAY CRM',
        },
        emailPublicKey,
      );
      onToast('מייל בדיקה נשלח בהצלחה ✓', 'success');
    } catch (e) {
      onToast('שגיאה בשליחת מייל בדיקה: ' + (e instanceof Error ? e.message : String(e)), 'error');
    } finally {
      setEmailTesting(false);
    }
  };

  // ── Remove team member ───────────────────────────────────────────────────
  const handleRemove = async (member: TeamMember) => {
    if (member.uid === currentUserUid) { onToast('לא ניתן להסיר את עצמך', 'error'); return; }
    if (!window.confirm(`להסיר את ${member.name} מהצוות?`)) return;
    try {
      // Mark user profile as removed from workspace
      if (member.uid) {
        await updateDoc(doc(db, 'users', member.uid), { workspaceId: null }).catch(() => {});
      }
      // Remove from workspace team subcollection
      await deleteDoc(doc(db, 'workspaces', workspace.id, 'team', member.id)).catch(() => {});
      onToast(`${member.name} הוסר מהצוות`, 'info');
      await onWorkspaceUpdate();
    } catch (err) {
      console.error(err);
      onToast('שגיאה בהסרת חבר הצוות', 'error');
    }
  };

  const SECTIONS: { key: Section; label: string; icon: React.ElementType }[] = [
    { key: 'workspace', label: 'פרטי סביבת העבודה', icon: Building2 },
    { key: 'team',      label: 'ניהול צוות',         icon: Users2   },
    { key: 'email',     label: 'חיבור אימייל',        icon: Mail     },
    { key: 'password',  label: 'שינוי סיסמה',         icon: Lock     },
    { key: 'plan',      label: 'תוכנית ומנוי',        icon: Crown    },
  ];

  const planLabel =
    workspace.plan === 'trial'      ? 'ניסיון חינם' :
    workspace.plan === 'basic'      ? 'Basic'        :
    workspace.plan === 'pro'        ? 'Pro'          :
    workspace.plan === 'enterprise' ? 'Enterprise'   : workspace.plan;
  const trialEnd  = workspace.trialEndsAt ? new Date(workspace.trialEndsAt).toLocaleDateString('he-IL') : '';

  return (
    <div className="max-w-4xl mx-auto" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-800">הגדרות</h1>
        <p className="text-slate-500 text-sm mt-1">ניהול סביבת העבודה שלך</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar */}
        <div className="md:w-52 flex-shrink-0">
          <nav className="bg-white rounded-2xl border border-slate-200 p-2 flex md:flex-col gap-1">
            {SECTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full text-right ${
                  section === key
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="hidden md:block">{label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">

          {/* ── Workspace Info ─────────────────────────────────────────── */}
          {section === 'workspace' && (
            <Card title="פרטי סביבת העבודה" icon={<Building2 size={18} />}>
              {/* Logo */}
              <div className="flex items-center gap-4 mb-5">
                <div
                  className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center cursor-pointer overflow-hidden hover:border-indigo-400 transition-colors bg-slate-50"
                  onClick={() => logoRef.current?.click()}
                >
                  {wsLogo
                    ? <img src={wsLogo} alt="לוגו" className="w-full h-full object-contain p-1" />
                    : <Image size={24} className="text-slate-400" />
                  }
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">לוגו העסק</p>
                  <p className="text-xs text-slate-500 mt-0.5">PNG / JPG עד 2MB</p>
                  <button
                    onClick={() => logoRef.current?.click()}
                    className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    החלף לוגו
                  </button>
                  <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                </div>
              </div>

              <div className="space-y-4">
                <Field label="שם העסק *">
                  <input value={wsName} onChange={e => setWsName(e.target.value)} className={INPUT} placeholder="שם העסק" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label='ח.פ / ע.מ'>
                    <input value={wsBizId} onChange={e => setWsBizId(e.target.value)} className={INPUT} placeholder="515123456" />
                  </Field>
                  <Field label="טלפון">
                    <input value={wsPhone} onChange={e => setWsPhone(e.target.value)} className={INPUT} placeholder="050-0000000" />
                  </Field>
                </div>
                <Field label="תחום עיסוק">
                  <select value={wsIndustry} onChange={e => setWsIndustry(e.target.value)} className={INPUT + ' appearance-none'}>
                    <option value="">בחר תחום...</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </Field>
                <Field label="הנחיות AI מותאמות">
                  <textarea
                    value={wsPrompt}
                    onChange={e => setWsPrompt(e.target.value)}
                    rows={4}
                    className={INPUT + ' resize-none'}
                    placeholder="תאר את העסק שלך, קהל היעד, מוצרים/שירותים, סגנון תקשורת מועדף..."
                  />
                </Field>
              </div>

              <div className="flex justify-end mt-6">
                <button
                  onClick={handleSaveWorkspace}
                  disabled={wsSaving}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-colors"
                >
                  {wsSaving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                  שמור שינויים
                </button>
              </div>
            </Card>
          )}

          {/* ── Team Management ────────────────────────────────────────── */}
          {section === 'team' && (
            <div className="space-y-4">
              <Card title="הזמן חבר צוות" icon={<UserPlus size={18} />}>
                <div className="space-y-3">
                  <Field label="אימייל">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      className={INPUT}
                      placeholder="email@company.com"
                      dir="ltr"
                    />
                  </Field>
                  <Field label="תפקיד">
                    <div className="flex gap-2">
                      {(['מנהל', 'סוכן'] as const).map(r => (
                        <button
                          key={r}
                          onClick={() => setInviteRole(r)}
                          className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                            inviteRole === r
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <button
                    onClick={handleInvite}
                    disabled={inviting}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                  >
                    {inviting ? <RefreshCw size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    יצירת קישור הזמנה
                  </button>
                  <p className="text-xs text-slate-500 text-center">הקישור יועתק ללוח — שלח אותו לחבר הצוות</p>
                </div>
              </Card>

              <Card title="חברי הצוות" icon={<Users2 size={18} />}>
                {team.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">אין חברי צוות עדיין</p>
                ) : (
                  <div className="space-y-2">
                    {team.map(member => (
                      <div key={member.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold">
                            {(member.name?.[0] ?? '?').toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{member.name}</p>
                            <p className="text-xs text-slate-500">{member.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            member.role === 'מנהל' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {member.role}
                          </span>
                          {member.uid !== currentUserUid && (
                            <button
                              onClick={() => handleRemove(member)}
                              className="text-slate-400 hover:text-red-500 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
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
                  <span className="text-sm text-slate-500">בודק סטטוס חיבור...</span>
                </div>
              ) : savedEmailConfigured ? (
                <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3.5">
                  <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-emerald-800">האימייל מחובר ✓</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      הגדרות EmailJS שמורות ופעילות — שליחת מיילים מהמערכת עובדת
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3.5">
                  <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-800">האימייל לא מחובר עדיין</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      מלא את הפרטים למטה ולחץ שמור כדי להפעיל שליחת מיילים
                    </p>
                  </div>
                </div>
              )}

              {/* ── Setup instructions ───────────────────────────────────── */}
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5" dir="rtl">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
                    <Mail size={12} className="text-white" />
                  </div>
                  <p className="font-bold text-indigo-900 text-sm">איך מחברים אימייל? — הגדרה חד-פעמית</p>
                </div>
                <ol className="space-y-2.5 text-sm text-indigo-800">
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                    <span>
                      צור חשבון חינמי ב-{' '}
                      <a href="https://www.emailjs.com" target="_blank" rel="noreferrer"
                        className="font-bold text-indigo-600 underline hover:text-indigo-900">
                        emailjs.com
                      </a>
                      {' '}(100 מיילים/חודש בחינם)
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                    <span>
                      הוסף <strong>Service</strong> (Gmail / Outlook / SMTP) תחת{' '}
                      <span className="font-mono text-xs bg-indigo-100 px-1.5 py-0.5 rounded">Email Services</span>
                      {' '}— קבל <strong>Service ID</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                    <span>
                      צור <strong>Email Template</strong> תחת{' '}
                      <span className="font-mono text-xs bg-indigo-100 px-1.5 py-0.5 rounded">Email Templates</span>
                      {' '}— קבל <strong>Template ID</strong>
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-200 text-indigo-800 text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                    <span>
                      העתק את ה-<strong>Public Key</strong> מתוך{' '}
                      <span className="font-mono text-xs bg-indigo-100 px-1.5 py-0.5 rounded">Account → API Keys</span>
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-xs font-black flex items-center justify-center flex-shrink-0 mt-0.5">5</span>
                    <span className="font-semibold text-indigo-900">הכנס את הפרטים בטופס למטה ולחץ <strong>שמור</strong></span>
                  </li>
                </ol>
                <a
                  href="https://www.emailjs.com"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-900 transition-colors"
                >
                  <ChevronLeft size={12} className="rotate-180" />
                  פתח את EmailJS
                </a>
              </div>

              {/* ── Config form ──────────────────────────────────────────── */}
              <Card title="פרטי חיבור EmailJS" icon={<Mail size={18} />}>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Service ID
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailServiceId} onChange={e => setEmailServiceId(e.target.value)}
                        className={INPUT} placeholder="service_xxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Public Key
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailPublicKey} onChange={e => setEmailPublicKey(e.target.value)}
                        className={INPUT} placeholder="xxxxxxxxxxxxxxxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Template ID — מיילים כלליים
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailTemplateId} onChange={e => setEmailTemplateId(e.target.value)}
                        className={INPUT} placeholder="template_xxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Template ID — הזמנות לצוות
                        <span className="text-slate-400 text-xs font-normal mr-1">(אופציונלי)</span>
                      </label>
                      <input value={emailInviteTmpl} onChange={e => setEmailInviteTmpl(e.target.value)}
                        className={INPUT} placeholder="template_xxxxxxx" dir="ltr" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">שם השולח (יוצג בנמען)</label>
                      <input value={emailFromName} onChange={e => setEmailFromName(e.target.value)}
                        className={INPUT} placeholder="שם החברה שלך" />
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-2 border-t border-slate-100">
                    <button
                      onClick={handleTestEmail}
                      disabled={emailTesting || !emailServiceId || !emailPublicKey || !emailTemplateId}
                      className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 text-sm font-semibold rounded-xl transition-colors"
                    >
                      <Send size={14} />
                      {emailTesting ? 'שולח...' : 'שלח מייל בדיקה'}
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
                        ? <><CheckCircle2 size={14} /> נשמר!</>
                        : <><Save size={14} /> שמור</>
                      }
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* ── Change Password ────────────────────────────────────────── */}
          {section === 'password' && (
            <Card title="שינוי סיסמה" icon={<Lock size={18} />}>
              <div className="space-y-4">
                <Field label="סיסמה נוכחית">
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={currentPw}
                      onChange={e => setCurrentPw(e.target.value)}
                      className={INPUT + ' pl-10'}
                      placeholder="הסיסמה הנוכחית"
                      dir="ltr"
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </Field>
                <Field label="סיסמה חדשה">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    className={INPUT}
                    placeholder="לפחות 6 תווים"
                    dir="ltr"
                  />
                </Field>
                <Field label="אימות סיסמה חדשה">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    className={INPUT}
                    placeholder="חזור על הסיסמה"
                    dir="ltr"
                  />
                </Field>

                {pwError && (
                  <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <AlertCircle size={14} className="flex-shrink-0" />{pwError}
                  </div>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
                >
                  {pwSaving ? <RefreshCw size={14} className="animate-spin" /> : <Lock size={14} />}
                  עדכן סיסמה
                </button>
              </div>
            </Card>
          )}

          {/* ── Plan Info ──────────────────────────────────────────────── */}
          {section === 'plan' && (
            <Card title="תוכנית ומנוי" icon={<Crown size={18} />}>
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
                        {workspace.status === 'trial' && trialEnd ? `תוקף ניסיון עד: ${trialEnd}` :
                         workspace.status === 'active' ? 'מנוי פעיל' : 'מנוי מושהה'}
                      </p>
                    </div>
                    <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                      workspace.status === 'active'    ? 'bg-emerald-500 text-white' :
                      workspace.status === 'trial'     ? 'bg-indigo-500 text-white'  :
                      'bg-red-500 text-white'
                    }`}>
                      {workspace.status === 'active' ? 'פעיל' : workspace.status === 'trial' ? 'ניסיון' : 'מושהה'}
                    </span>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                  <Row label="שם העסק"    value={workspace.name} />
                  <Row label="אימייל"      value={workspace.email} />
                  {workspace.phone      && <Row label="טלפון"   value={workspace.phone} />}
                  {workspace.businessId && <Row label='ח.פ'     value={workspace.businessId} />}
                  {workspace.industry   && <Row label="תחום"    value={workspace.industry} />}
                  <Row label="תאריך הצטרפות" value={new Date(workspace.createdAt).toLocaleDateString('he-IL')} />
                </div>

                {/* Unique workspace URL */}
                {workspace.slug && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-indigo-700 mb-1.5">הקישור הייחודי שלך</p>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 text-sm font-mono font-bold text-indigo-800 truncate" dir="ltr">
                        {workspace.slug}.ray-crm.com
                      </p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`https://${workspace.slug}.ray-crm.com`);
                          onToast('קישור הועתק ✓', 'success');
                        }}
                        className="text-indigo-400 hover:text-indigo-700 transition-colors flex-shrink-0"
                      >
                        <Copy size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-indigo-600 mt-1.5">
                      זהו הקישור שאיתו כל חברי הצוות שלך יכנסו למערכת
                    </p>
                  </div>
                )}

                <div className="text-center pt-2">
                  <p className="text-slate-500 text-sm">לשדרוג תוכנית, צור קשר עם המנהל שלך</p>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Small helpers ───────────────────────────────────────────────────────── */
function Card({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-5 pb-4 border-b border-slate-100">
        <span className="text-indigo-600">{icon}</span>
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-slate-600 text-xs font-semibold mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}
