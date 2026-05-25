import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Building2, Mail, Users2, Image, Save, Copy,
  Lock, Eye, EyeOff, CheckCircle2, AlertCircle, UserPlus, Trash2,
  ChevronLeft, Crown, RefreshCw, Send, AlertTriangle,
  Link, Loader2, ExternalLink,
  BarChart3, TrendingUp, Target, Award,
} from 'lucide-react';
import { useLang } from '../contexts/LangContext';
import {
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from 'firebase/auth';
import { doc, updateDoc, setDoc, deleteDoc, getDoc, getDocs, collection } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { WorkspaceProfile, TeamMember, Lead, StandaloneTask } from '../types';

interface Props {
  workspace: WorkspaceProfile;
  team: TeamMember[];
  leads: Lead[];
  standaloneTask: StandaloneTask[];
  currentUserUid: string;
  currentUserEmail: string;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate: () => Promise<void>;
}

type Section = 'workspace' | 'password' | 'team' | 'performance' | 'plan' | 'email' | 'portal';

const INDUSTRIES = [
  'סוכנות שיווק', 'נדל"ן', 'טכנולוגיה', 'פיננסים',
  'שירותים עסקיים', 'קמעונאות', 'בריאות', 'חינוך', 'אחר',
];

const INPUT = 'w-full bg-white border border-slate-200 text-slate-800 placeholder-slate-400 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500';

export default function WorkspaceSettings({
  workspace, team, leads, standaloneTask, currentUserUid, currentUserEmail, onToast, onWorkspaceUpdate,
}: Props) {
  const { t, dir } = useLang();
  const [section, setSection] = useState<Section>('workspace');

  // ── Auto-fix: update current user's team record email if it's wrong ──────
  useEffect(() => {
    if (!currentUserUid || !currentUserEmail) return;
    const myRecord = team.find(m => m.uid === currentUserUid);
    if (!myRecord) return;
    if (myRecord.email === currentUserEmail) return; // already correct
    // Email mismatch — silently patch the team record in Firestore
    updateDoc(doc(db, 'workspaces', workspace.id, 'team', myRecord.id), {
      email: currentUserEmail,
    }).catch(() => {});
  }, [currentUserUid, currentUserEmail, team, workspace.id]); // eslint-disable-line

  // ── Workspace profile state ──────────────────────────────────────────────
  const [wsName,     setWsName]     = useState(workspace.name ?? '');
  const [wsEmail,    setWsEmail]    = useState(workspace.email ?? currentUserEmail);
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

  const activePerfStats = perfStats.filter(s => s.total > 0);

  const SECTIONS: { key: Section; label: string; icon: React.ElementType }[] = [
    { key: 'workspace',   label: t('settings.workspaceProfile'), icon: Building2 },
    { key: 'team',        label: t('settings.teamManagement'),   icon: Users2    },
    { key: 'performance', label: 'ביצועי צוות',                  icon: BarChart3 },
    { key: 'portal',      label: 'פורטל לקוחות',                 icon: Link      },
    { key: 'email',       label: t('settings.emailSettings'),    icon: Mail      },
    { key: 'password',    label: t('settings.changePassword'),   icon: Lock      },
    { key: 'plan',        label: t('settings.planManagement'),   icon: Crown     },
  ];

  const planLabel =
    workspace.plan === 'trial'      ? t('billing.trial') :
    workspace.plan === 'basic'      ? 'Basic'             :
    workspace.plan === 'pro'        ? 'Pro'               :
    workspace.plan === 'enterprise' ? 'Enterprise'        : workspace.plan;
  const trialEnd  = workspace.trialEndsAt ? new Date(workspace.trialEndsAt).toLocaleDateString('he-IL') : '';

  return (
    <div className="max-w-4xl mx-auto" dir={dir}>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-800">{t('settings.title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('settings.workspace')}</p>
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
                  <input value={wsName} onChange={e => setWsName(e.target.value)} className={INPUT} placeholder={t('settings.businessName')} />
                </Field>
                <Field label="מייל עסקי">
                  <input
                    type="email"
                    value={wsEmail}
                    onChange={e => setWsEmail(e.target.value)}
                    className={INPUT}
                    placeholder="email@company.com"
                    dir="ltr"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('settings.businessId')}>
                    <input value={wsBizId} onChange={e => setWsBizId(e.target.value)} className={INPUT} placeholder="515123456" />
                  </Field>
                  <Field label={t('settings.businessPhone')}>
                    <input value={wsPhone} onChange={e => setWsPhone(e.target.value)} className={INPUT} placeholder="050-0000000" />
                  </Field>
                </div>
                <Field label={t('settings.industry')}>
                  <select value={wsIndustry} onChange={e => setWsIndustry(e.target.value)} className={INPUT + ' appearance-none'}>
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
                    placeholder={t('settings.businessDescPlaceholder')}
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
                  {t('settings.saveSettings')}
                </button>
              </div>
            </Card>
          )}

          {/* ── Team Management ────────────────────────────────────────── */}
          {section === 'team' && (
            <div className="space-y-4">
              <Card title={t('settings.inviteTeamMember')} icon={<UserPlus size={18} />}>
                <div className="space-y-3">
                  <Field label={t('team.email')}>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      className={INPUT}
                      placeholder="email@company.com"
                      dir="ltr"
                    />
                  </Field>
                  <Field label={t('team.role')}>
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
                          {r === 'מנהל' ? t('team.manager') : t('team.agent')}
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
                    {t('team.sendInvite')}
                  </button>
                  <p className="text-xs text-slate-500 text-center">{t('team.inviteSent')}</p>
                </div>
              </Card>

              <Card title={t('team.title')} icon={<Users2 size={18} />}>
                {team.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">{t('team.noMembers')}</p>
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
                            <p className="text-xs text-slate-500">
                              {member.uid === currentUserUid ? currentUserEmail : member.email}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            member.role === 'מנהל' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {member.role === 'מנהל' ? t('team.manager') : t('team.agent')}
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
                      val: `${Math.round(activePerfStats.reduce((s,a)=>s+a.closeRate,0) / activePerfStats.length)}%`,
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
                    <p className="text-slate-500 font-medium">אין נתונים עדיין</p>
                    <p className="text-slate-400 text-sm mt-1">שייך לידים לאנשי הצוות כדי לראות ביצועים</p>
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
                              <div className="flex items-center gap-2 mb-2.5">
                                <span className="font-bold text-slate-800">{s.member.name}</span>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                  s.member.role === 'מנהל'
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {s.member.role}
                                </span>
                              </div>

                              {/* Metrics grid */}
                              <div className="grid grid-cols-4 gap-2 mb-3">
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
                        {t('settings.emailTemplateGeneral')}
                        <span className="text-red-500 mr-0.5">*</span>
                      </label>
                      <input value={emailTemplateId} onChange={e => setEmailTemplateId(e.target.value)}
                        className={INPUT} placeholder="template_xxxxxxx" dir="ltr" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                        {t('settings.emailTemplateInvite')}
                        <span className="text-slate-400 text-xs font-normal mr-1">{t('settings.emailTemplateInviteOptional')}</span>
                      </label>
                      <input value={emailInviteTmpl} onChange={e => setEmailInviteTmpl(e.target.value)}
                        className={INPUT} placeholder="template_xxxxxxx" dir="ltr" />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">{t('settings.emailSenderName')}</label>
                      <input value={emailFromName} onChange={e => setEmailFromName(e.target.value)}
                        className={INPUT} placeholder={t('settings.emailSenderPlaceholder')} />
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

          {/* ── Change Password ────────────────────────────────────────── */}
          {section === 'password' && (
            <Card title={t('settings.changePassword')} icon={<Lock size={18} />}>
              <div className="space-y-4">
                <Field label={t('settings.currentPassword')}>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={currentPw}
                      onChange={e => setCurrentPw(e.target.value)}
                      className={INPUT + ' pl-10'}
                      placeholder={t('settings.passwordCurrentPlaceholder')}
                      dir="ltr"
                    />
                    <button type="button" onClick={() => setShowPw(p => !p)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </Field>
                <Field label={t('settings.newPassword')}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    className={INPUT}
                    placeholder={t('settings.passwordNewPlaceholder')}
                    dir="ltr"
                  />
                </Field>
                <Field label={t('settings.confirmPassword')}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    className={INPUT}
                    placeholder={t('settings.passwordConfirmPlaceholder')}
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
                  {t('settings.updatePassword')}
                </button>
              </div>
            </Card>
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
                  <p className="text-slate-500 text-sm">{t('settings.upgradePlan')}</p>
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
