import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sendInviteEmail } from '../lib/email';
import {
  UserPlus, Mail, Users, Shield, Clock, RefreshCw, Trash2,
  CheckCircle2, AlertCircle, Loader2, Award,
} from 'lucide-react';
import type { TeamMember, Lead } from '../types';
import StatusBadge from '../components/StatusBadge';
import { useLang } from '../contexts/LangContext';
import { useTheme } from '../contexts/ThemeContext';

const APP_URL = 'https://ray-crm.vercel.app';

interface PendingInvite {
  email: string;
  role: 'מנהל' | 'סוכן';
  status: 'pending' | 'expired';
  invitedAt: string;
  invitedBy: string;
}

interface TeamManagementProps {
  team: TeamMember[];
  leads: Lead[];
  currentUser?: string;
  workspaceId?: string;
  emailConfigured?: boolean;
  onUpdateRole: (id: string, role: 'מנהל' | 'סוכן') => void;
  onInvite: (email: string, role: 'מנהל' | 'סוכן') => void;
  onRemoveMember?: (id: string) => void;
  onAssignLead?: (leadId: string, assignedTo: string) => void;
}

type TabKey = 'members' | 'invites' | 'stats' | 'assignment';

/* ── shared style tokens ──────────────────────────────────────────────────── */
const glassCard: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.07)',
  backdropFilter: 'blur(8px)',
};

const darkInp: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'white',
};

const dividerStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

export default function TeamManagement({
  team,
  leads,
  currentUser,
  workspaceId,
  emailConfigured,
  onUpdateRole,
  onInvite,
  onRemoveMember,
  onAssignLead,
}: TeamManagementProps) {
  const { t } = useLang();
  const { isDark, c } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('members');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'מנהל' | 'סוכן'>('סוכן');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle');
  const [inviteError, setInviteError] = useState('');
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [revokingEmail, setRevokingEmail] = useState<string | null>(null);
  const [confirmRemoveMember, setConfirmRemoveMember] = useState<TeamMember | null>(null);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [reassigningLeadId, setReassigningLeadId] = useState<string | null>(null);
  const emailJSReady = !!emailConfigured;

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'invites'), snapshot => {
      const invites: PendingInvite[] = [];
      snapshot.forEach(docSnap => {
        invites.push(docSnap.data() as PendingInvite);
      });
      invites.sort((a, b) => b.invitedAt.localeCompare(a.invitedAt));
      setPendingInvites(invites);
    });
    return () => unsub();
  }, []);

  const agentStats = (name: string) => {
    const agentLeads = leads.filter(l => l.assignedTo === name);
    const active = agentLeads.filter(l => l.status === 'לקוח פעיל').length;
    const onboarding = agentLeads.filter(l => l.status === 'בתהליך').length;
    const avgScore =
      agentLeads.length > 0
        ? Math.round(agentLeads.reduce((s, l) => s + l.aiScore, 0) / agentLeads.length)
        : 0;
    const conversion =
      agentLeads.length > 0 ? Math.round((active / agentLeads.length) * 100) : 0;
    return { total: agentLeads.length, active, onboarding, avgScore, conversion };
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviteStatus('loading');
    setInviteError('');
    try {
      const email = inviteEmail.trim();
      const inviteLink = `${APP_URL}?invite=${encodeURIComponent(email)}`;

      if (emailJSReady) {
        await sendInviteEmail({
          toEmail:    email,
          invitedBy:  currentUser || 'מנהל',
          role:        inviteRole,
          inviteLink,
          workspaceId,
        });
      }

      await setDoc(doc(db, 'invites', email.replace('@', '_at_')), {
        email,
        role: inviteRole,
        status: 'pending',
        invitedAt: new Date().toISOString(),
        invitedBy: currentUser || 'מנהל',
      });

      onInvite(email, inviteRole);
      setInviteStatus('sent');
      setInviteEmail('');
      setTimeout(() => setInviteStatus('idle'), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'שגיאה לא ידועה';
      setInviteError('שגיאה בשליחת ההזמנה: ' + msg);
      setInviteStatus('error');
    }
  };

  const handleResend = async (invite: PendingInvite) => {
    setResendingEmail(invite.email);
    try {
      const inviteLink = `${APP_URL}?invite=${encodeURIComponent(invite.email)}`;
      if (emailJSReady) {
        await sendInviteEmail({
          toEmail:    invite.email,
          invitedBy:  currentUser || 'מנהל',
          role:        invite.role,
          inviteLink,
          workspaceId,
        });
      }
      await setDoc(doc(db, 'invites', invite.email.replace('@', '_at_')), {
        ...invite,
        invitedAt: new Date().toISOString(),
        status: 'pending',
      });
    } catch {
      // silently fail resend
    } finally {
      setResendingEmail(null);
    }
  };

  const handleRevoke = async (invite: PendingInvite) => {
    setRevokingEmail(invite.email);
    try {
      await deleteDoc(doc(db, 'invites', invite.email.replace('@', '_at_')));
    } catch {
      // silently fail revoke
    } finally {
      setRevokingEmail(null);
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    setRemovingMemberId(member.id);
    try {
      await deleteDoc(doc(db, 'team', member.id));
      onRemoveMember?.(member.id);
    } catch {
      // silently fail
    } finally {
      setRemovingMemberId(null);
      setConfirmRemoveMember(null);
    }
  };

  const memberLeads = (name: string) => leads.filter(l => l.assignedTo === name);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'members',    label: t('teamMgmt.tab.members') },
    { key: 'invites',    label: `${t('teamMgmt.tab.invites')} (${pendingInvites.length})` },
    { key: 'stats',      label: t('teamMgmt.tab.stats') },
    { key: 'assignment', label: t('teamMgmt.tab.assignment') },
  ];

  return (
    <div
      className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6 space-y-5"
      style={{
        background: c.pageBg,
        backgroundImage: c.pageBgImage,
        backgroundSize: c.pageBgSize,
        minHeight: 'calc(100vh - 56px)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>{team.length} {t('teamMgmt.membersCount')}</span>
        <div className="flex items-center gap-2">
          <Users size={18} color="#818cf8" />
          <h1 className="text-xl font-bold" style={{ color: 'white' }}>{t('teamMgmt.title')}</h1>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 rounded-xl p-1 w-full overflow-x-auto" dir="ltr"
        style={{
          background: 'rgba(10,15,30,0.88)',
          border: '1px solid rgba(99,102,241,0.2)',
          backdropFilter: 'blur(16px)',
        }}
      >
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            style={
              activeTab === tab.key
                ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: '#818cf8' }
                : { background: 'transparent', border: '1px solid transparent', color: 'rgba(255,255,255,0.4)' }
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── MEMBERS TAB ─── */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {/* Invite Form */}
          <div className="rounded-xl p-5" style={glassCard}>
            <div className="flex items-center justify-end gap-2 mb-4">
              <h3 className="font-semibold" style={{ color: 'rgba(255,255,255,0.8)' }}>{t('teamMgmt.inviteNew')}</h3>
              <UserPlus size={18} color="#818cf8" />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || inviteStatus === 'loading'}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                style={
                  inviteStatus === 'sent'
                    ? { background: 'rgba(16,185,129,0.2)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399' }
                    : inviteStatus === 'loading'
                    ? { background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)', cursor: 'not-allowed' }
                    : { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }
                }
              >
                {inviteStatus === 'loading' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : inviteStatus === 'sent' ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <Mail size={14} />
                )}
                {inviteStatus === 'sent' ? t('teamMgmt.sent') : inviteStatus === 'loading' ? t('teamMgmt.sending') : t('teamMgmt.sendInvite')}
              </button>

              <div
                className="flex rounded-lg overflow-hidden flex-shrink-0"
                style={{ border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {(['מנהל', 'סוכן'] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => setInviteRole(role)}
                    className="px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1"
                    style={
                      inviteRole === role
                        ? { background: 'rgba(99,102,241,0.22)', color: '#818cf8' }
                        : { background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.45)' }
                    }
                  >
                    {role === 'מנהל' && <Shield size={12} />}
                    {role === 'מנהל' ? t('teamMgmt.roleManager') : t('teamMgmt.roleAgent')}
                  </button>
                ))}
              </div>

              <input
                type="email"
                placeholder={t('teamMgmt.emailPlaceholder')}
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteStatus('idle'); setInviteError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none text-right"
                style={darkInp}
                dir="ltr"
              />
            </div>

            {!emailJSReady && (
              <div
                className="mt-3 text-xs rounded-lg px-4 py-3 flex items-start gap-2 text-right"
                style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}
              >
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{t('teamMgmt.gmailNotConnected')}</span>
              </div>
            )}

            {inviteStatus === 'error' && inviteError && (
              <div
                className="mt-3 text-sm rounded-lg px-4 py-3 flex items-start gap-2 text-right"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
              >
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{inviteError}</span>
              </div>
            )}

            {inviteStatus === 'sent' && (
              <div
                className="mt-3 text-sm rounded-lg px-4 py-3 flex items-center gap-2 text-right"
                style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', color: '#34d399' }}
              >
                <CheckCircle2 size={16} />
                <span>{t('teamMgmt.inviteSentSuccess')}</span>
              </div>
            )}
          </div>

          {/* Team Members List */}
          <div className="rounded-xl overflow-hidden" style={glassCard}>
            <div
              className="px-5 py-3 flex items-center justify-end gap-2"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
            >
              <h3 className="font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>{t('teamMgmt.teamMembers')}</h3>
              <Users size={16} color="rgba(255,255,255,0.35)" />
            </div>
            <div>
              {team.map(member => {
                const stats = agentStats(member.name);
                return (
                  <div
                    key={member.id}
                    className="flex items-center justify-between px-5 py-4 transition-colors"
                    style={dividerStyle}
                  >
                    {/* Actions: role selector + remove */}
                    <div className="flex items-center gap-2">
                      {!member.isCurrentUser && (
                        <button
                          onClick={() => setConfirmRemoveMember(member)}
                          className="p-1.5 rounded-lg transition-colors"
                          style={{ color: 'rgba(255,255,255,0.25)', border: '1px solid transparent' }}
                          title={t('teamMgmt.removeFromTeam')}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      {member.isCurrentUser ? (
                        <span
                          className="text-xs px-3 py-1 rounded-full font-semibold flex items-center gap-1"
                          style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24' }}
                        >
                          <Shield size={11} />
                          {t('teamMgmt.roleManager')}
                        </span>
                      ) : (
                        <div
                          className="flex rounded-lg overflow-hidden text-xs"
                          style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                        >
                          {(['מנהל', 'סוכן'] as const).map(role => (
                            <button
                              key={role}
                              onClick={() => onUpdateRole(member.id, role)}
                              className="px-3 py-1.5 font-medium transition-colors"
                              style={
                                member.role === role
                                  ? { background: 'rgba(99,102,241,0.22)', color: '#818cf8' }
                                  : { background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.4)' }
                              }
                            >
                              {role === 'מנהל' ? t('teamMgmt.roleManager') : t('teamMgmt.roleAgent')}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Quick stats */}
                    <div className="flex items-center gap-4 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      <div className="text-center">
                        <div className="font-bold text-base" style={{ color: 'white' }}>{stats.active}</div>
                        <div>{t('teamMgmt.activeClients')}</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-base" style={{ color: 'white' }}>{stats.total}</div>
                        <div>{t('teamMgmt.totalLeads')}</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-base" style={{ color: '#818cf8' }}>{stats.conversion}%</div>
                        <div>{t('teamMgmt.conversion')}</div>
                      </div>
                    </div>

                    {/* Member info */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="font-semibold" style={{ color: 'white' }}>
                            {member.name}
                            {member.isCurrentUser && (
                              <span className="font-normal text-xs mr-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('teamMgmt.you')}</span>
                            )}
                          </span>
                        </div>
                        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{member.email}</span>
                      </div>
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                        style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
                      >
                        {member.name[0].toUpperCase()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── INVITES TAB ─── */}
      {activeTab === 'invites' && (
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden" style={glassCard}>
            <div
              className="px-5 py-3 flex items-center justify-end gap-2"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
            >
              <h3 className="font-semibold" style={{ color: 'rgba(255,255,255,0.75)' }}>{t('teamMgmt.pendingInvites')}</h3>
              <Clock size={16} color="rgba(255,255,255,0.35)" />
            </div>

            {pendingInvites.length === 0 ? (
              <div className="py-12 text-center">
                <Mail size={32} className="mx-auto mb-3 opacity-30" color="rgba(255,255,255,0.4)" />
                <div className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('teamMgmt.noOpenInvites')}</div>
              </div>
            ) : (
              <div>
                {pendingInvites.map(invite => {
                  const isResending = resendingEmail === invite.email;
                  const isRevoking = revokingEmail === invite.email;
                  const invitedDate = new Date(invite.invitedAt);
                  const daysSince = Math.floor((Date.now() - invitedDate.getTime()) / (1000 * 60 * 60 * 24));
                  const isExpired = daysSince >= 3;

                  return (
                    <div
                      key={invite.email}
                      className="flex items-center justify-between px-5 py-4"
                      style={dividerStyle}
                    >
                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRevoke(invite)}
                          disabled={isRevoking}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                          style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid transparent' }}
                          title={t('teamMgmt.cancelInvite')}
                        >
                          {isRevoking ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                        <button
                          onClick={() => handleResend(invite)}
                          disabled={isResending}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-50"
                          style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid transparent' }}
                          title={t('teamMgmt.resend')}
                        >
                          {isResending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        </button>
                      </div>

                      {/* Invite details */}
                      <div className="flex items-center gap-4 text-sm">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={
                            isExpired
                              ? { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.28)' }
                              : { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.28)' }
                          }
                        >
                          {isExpired ? t('teamMgmt.expired') : t('teamMgmt.pending')}
                        </span>
                        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {daysSince === 0 ? t('teamMgmt.today') : `${daysSince} ${t('teamMgmt.days')}`}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={
                            invite.role === 'מנהל'
                              ? { background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.35)' }
                              : { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.28)' }
                          }
                        >
                          {invite.role === 'מנהל' ? t('teamMgmt.roleManager') : t('teamMgmt.roleAgent')}
                        </span>
                      </div>

                      {/* Email */}
                      <div className="text-right">
                        <div className="font-medium text-sm" style={{ color: 'white' }} dir="ltr">{invite.email}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('teamMgmt.invitedBy')} {invite.invitedBy}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── STATS TAB ─── */}
      {activeTab === 'stats' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            {team.map((member, index) => {
              const stats = agentStats(member.name);
              const scoreColor =
                stats.avgScore >= 75 ? '#34d399' :
                stats.avgScore >= 50 ? '#fb923c' :
                'rgba(255,255,255,0.35)';
              const rankColors = ['#eab308', 'rgba(255,255,255,0.5)', '#f97316'];

              return (
                <div key={member.id} className="rounded-xl p-5" style={glassCard}>
                  <div className="flex items-start justify-between">
                    {/* Right: avatar + name */}
                    <div className="flex items-center gap-3">
                      {index < 3 && stats.total > 0 && (
                        <Award size={20} color={rankColors[index]} />
                      )}
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0"
                        style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
                      >
                        {member.name[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold" style={{ color: 'white' }}>
                          {member.name}
                          {member.isCurrentUser && (
                            <span className="font-normal text-xs mr-2" style={{ color: 'rgba(255,255,255,0.35)' }}>{t('teamMgmt.you')}</span>
                          )}
                        </div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{member.email}</div>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block"
                          style={
                            member.role === 'מנהל'
                              ? { background: 'rgba(139,92,246,0.2)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.35)' }
                              : { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.28)' }
                          }
                        >
                          {member.role === 'מנהל' ? t('teamMgmt.roleManager') : t('teamMgmt.roleAgent')}
                        </span>
                      </div>
                    </div>

                    {/* Left: stats */}
                    <div className="flex items-center gap-6 text-center">
                      <div>
                        <div className="text-2xl font-bold" style={{ color: 'white' }}>{stats.total}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('teamMgmt.totalLeads')}</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold" style={{ color: '#34d399' }}>{stats.active}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('teamMgmt.activeClients')}</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold" style={{ color: '#fb923c' }}>{stats.onboarding}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('teamMgmt.inProgress')}</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold" style={{ color: scoreColor }}>{stats.avgScore}%</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('teamMgmt.aiScore')}</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold" style={{ color: '#818cf8' }}>{stats.conversion}%</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{t('teamMgmt.conversion')}</div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bars */}
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        <span>{stats.conversion}%</span>
                        <span>{t('teamMgmt.conversionRate')}</span>
                      </div>
                      <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{ width: `${Math.min(stats.conversion, 100)}%`, background: '#6366f1' }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                        <span>{stats.avgScore}%</span>
                        <span>{t('teamMgmt.aiScore')}</span>
                      </div>
                      <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${Math.min(stats.avgScore, 100)}%`,
                            background: stats.avgScore >= 75 ? '#10b981' : stats.avgScore >= 50 ? '#f97316' : 'rgba(255,255,255,0.2)',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── REMOVE MEMBER CONFIRMATION DIALOG ─── */}
      {confirmRemoveMember && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="rounded-2xl shadow-2xl max-w-sm w-full p-6 text-right"
            style={{ background: '#0d1526', border: '1px solid rgba(99,102,241,0.25)' }}
            dir="rtl"
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <Trash2 size={18} color="#f87171" />
              </div>
              <div>
                <h3 className="font-bold" style={{ color: 'white' }}>{t('teamMgmt.removeConfirmTitle')}</h3>
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>{t('teamMgmt.removeConfirmDesc')}</p>
              </div>
            </div>
            <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.6)' }}>
              {t('teamMgmt.removeConfirmMsg')} <span className="font-semibold" style={{ color: 'white' }}>{confirmRemoveMember.name}</span> ({confirmRemoveMember.email}) {t('teamMgmt.removeConfirmFrom')}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemoveMember(null)}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
              >
                {t('teamMgmt.cancel')}
              </button>
              <button
                onClick={() => handleRemoveMember(confirmRemoveMember)}
                disabled={removingMemberId === confirmRemoveMember.id}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
                style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}
              >
                {removingMemberId === confirmRemoveMember.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                {t('teamMgmt.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ASSIGNMENT TAB ─── */}
      {activeTab === 'assignment' && (
        <div className="space-y-4" dir="rtl">

          {/* ── Unassigned leads ─────────────────────────────────────────── */}
          {(() => {
            const unassigned = leads.filter(l => !l.assignedTo || l.assignedTo.trim() === '');
            if (unassigned.length === 0) return null;
            return (
              <div className="rounded-xl overflow-hidden" style={{ ...glassCard, border: '1px solid rgba(245,158,11,0.25)' }}>
                <div className="px-5 py-3 flex items-center justify-between"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(245,158,11,0.05)' }}>
                  <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    לחץ על ↗ כדי לשייך
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="font-semibold" style={{ color: '#fbbf24' }}>לידים לא משויכים</span>
                      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{unassigned.length} לידים</div>
                    </div>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm"
                      style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)' }}>
                      ?
                    </div>
                  </div>
                </div>
                <div>
                  {unassigned.slice(0, 8).map(lead => (
                    <div key={lead.id} className="flex items-center justify-between px-5 py-2.5" style={dividerStyle}>
                      <div className="flex items-center gap-2 flex-wrap">
                        {onAssignLead && team.length > 0 && (
                          <div className="relative">
                            {reassigningLeadId === lead.id ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                {team.map(m => (
                                  <button key={m.id}
                                    onClick={() => { onAssignLead(lead.id, m.name); setReassigningLeadId(null); }}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg transition-colors"
                                    style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                                    {m.name}
                                  </button>
                                ))}
                                <button onClick={() => setReassigningLeadId(null)}
                                  className="text-[10px] px-1.5 py-1 rounded-lg"
                                  style={{ color: 'rgba(255,255,255,0.3)' }}>✕</button>
                              </div>
                            ) : (
                              <button onClick={() => setReassigningLeadId(lead.id)}
                                className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
                                style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                                ↗ שייך
                              </button>
                            )}
                          </div>
                        )}
                        {lead.aiScore > 0 && (
                          <span className="text-xs font-bold"
                            style={{ color: lead.aiScore >= 75 ? '#34d399' : lead.aiScore >= 50 ? '#fb923c' : 'rgba(255,255,255,0.35)' }}>
                            {lead.aiScore}%
                          </span>
                        )}
                        <StatusBadge status={lead.status} size="sm" />
                      </div>
                      <div className="text-right">
                        <div className="font-medium text-sm" style={{ color: 'white' }}>{lead.company}</div>
                        <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{lead.contactName}</div>
                      </div>
                    </div>
                  ))}
                  {unassigned.length > 8 && (
                    <div className="px-5 py-2 text-xs text-center"
                      style={{ color: 'rgba(255,255,255,0.3)', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                      +{unassigned.length - 8} לידים נוספים
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ── Per-member sections ───────────────────────────────────────── */}
          {team.map(member => {
            const memberLeadList = memberLeads(member.name);
            const stats = agentStats(member.name);
            return (
              <div key={member.id} className="rounded-xl overflow-hidden" style={glassCard}>
                <div className="px-5 py-3 flex items-center justify-between"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold" style={{ color: '#818cf8' }}>{memberLeadList.length} {t('teamMgmt.totalLeads')}</span>
                    <span style={{ color: 'rgba(255,255,255,0.2)' }}>|</span>
                    <span className="text-xs font-medium" style={{ color: '#34d399' }}>{stats.active} {t('teamMgmt.activeClients')}</span>
                    <span className="text-xs font-medium" style={{ color: '#fb923c' }}>{stats.onboarding} {t('teamMgmt.inProgress')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>{member.name}</span>
                      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{member.role === 'מנהל' ? t('teamMgmt.roleManager') : t('teamMgmt.roleAgent')}</div>
                    </div>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm"
                      style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                      {member.name[0].toUpperCase()}
                    </div>
                  </div>
                </div>

                {memberLeadList.length === 0 ? (
                  <div className="py-6 text-center text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {t('teamMgmt.noAssignedLeads')}
                  </div>
                ) : (
                  <div>
                    {memberLeadList.slice(0, 8).map(lead => (
                      <div key={lead.id} className="flex items-center justify-between px-5 py-2.5" style={dividerStyle}>
                        {/* Left — actions */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {onAssignLead && (
                            <div className="relative">
                              {reassigningLeadId === lead.id ? (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>שייך ל:</span>
                                  {team.filter(m => m.name !== member.name).map(m => (
                                    <button key={m.id}
                                      onClick={() => { onAssignLead(lead.id, m.name); setReassigningLeadId(null); }}
                                      className="text-[10px] font-bold px-2 py-1 rounded-lg transition-colors"
                                      style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}>
                                      {m.name}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => { onAssignLead(lead.id, ''); setReassigningLeadId(null); }}
                                    className="text-[10px] font-bold px-2 py-1 rounded-lg transition-colors"
                                    style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                                    הסר שיוך
                                  </button>
                                  <button onClick={() => setReassigningLeadId(null)}
                                    className="text-[10px] px-1.5 py-1 rounded-lg"
                                    style={{ color: 'rgba(255,255,255,0.3)' }}>✕</button>
                                </div>
                              ) : (
                                <button onClick={() => setReassigningLeadId(lead.id)}
                                  className="text-[10px] font-semibold px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
                                  style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                  ⇄ שנה
                                </button>
                              )}
                            </div>
                          )}
                          {lead.aiScore > 0 && (
                            <span className="text-xs font-bold"
                              style={{ color: lead.aiScore >= 75 ? '#34d399' : lead.aiScore >= 50 ? '#fb923c' : 'rgba(255,255,255,0.35)' }}>
                              {lead.aiScore}%
                            </span>
                          )}
                          <StatusBadge status={lead.status} size="sm" />
                        </div>
                        {/* Right — lead info */}
                        <div className="text-right">
                          <div className="font-medium text-sm" style={{ color: 'white' }}>{lead.company}</div>
                          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>{lead.contactName}</div>
                        </div>
                      </div>
                    ))}
                    {memberLeadList.length > 8 && (
                      <div className="px-5 py-2 text-xs text-center"
                        style={{ color: 'rgba(255,255,255,0.3)', borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
                        +{memberLeadList.length - 8} {t('teamMgmt.moreLeads')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
