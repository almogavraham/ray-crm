import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { sendInviteEmail, isEmailJSConfigured } from '../lib/emailjs';
import {
  UserPlus, Mail, Users, Shield, Clock, RefreshCw, Trash2,
  CheckCircle2, AlertCircle, Loader2, Award,
} from 'lucide-react';
import type { TeamMember, Lead } from '../types';
import StatusBadge from '../components/StatusBadge';

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
  onUpdateRole: (id: string, role: 'מנהל' | 'סוכן') => void;
  onInvite: (email: string, role: 'מנהל' | 'סוכן') => void;
  onRemoveMember?: (id: string) => void;
}

type TabKey = 'members' | 'invites' | 'stats' | 'assignment';

export default function TeamManagement({
  team,
  leads,
  currentUser,
  onUpdateRole,
  onInvite,
  onRemoveMember,
}: TeamManagementProps) {
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
  const emailJSReady = isEmailJSConfigured();

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
    { key: 'members', label: 'חברי צוות' },
    { key: 'invites', label: `הזמנות (${pendingInvites.length})` },
    { key: 'stats', label: 'סטטיסטיקות' },
    { key: 'assignment', label: 'שיוך לידים' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-slate-500 text-sm">{team.length} חברי צוות</span>
        <div className="flex items-center gap-2">
          <Users size={18} className="text-indigo-600" />
          <h1 className="text-xl font-bold text-slate-800">ניהול צוות</h1>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200 p-1 w-fit shadow-sm">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-indigo-900 text-white'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── MEMBERS TAB ─── */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {/* Invite Form */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-end gap-2 mb-4">
              <h3 className="font-semibold text-slate-700">הזמן משתמש חדש</h3>
              <UserPlus size={18} className="text-indigo-600" />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleInvite}
                disabled={!inviteEmail.trim() || inviteStatus === 'loading'}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                  inviteStatus === 'sent'
                    ? 'bg-green-500 text-white'
                    : inviteStatus === 'loading'
                    ? 'bg-slate-400 text-white cursor-not-allowed'
                    : 'bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                {inviteStatus === 'loading' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : inviteStatus === 'sent' ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <Mail size={14} />
                )}
                {inviteStatus === 'sent' ? 'נשלח!' : inviteStatus === 'loading' ? 'שולח...' : 'שלח הזמנה'}
              </button>

              <div className="flex rounded-lg overflow-hidden border border-slate-200 flex-shrink-0">
                {(['מנהל', 'סוכן'] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => setInviteRole(role)}
                    className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1 ${
                      inviteRole === role
                        ? 'bg-indigo-900 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {role === 'מנהל' && <Shield size={12} />}
                    {role}
                  </button>
                ))}
              </div>

              <input
                type="email"
                placeholder="כתובת אימייל..."
                value={inviteEmail}
                onChange={e => { setInviteEmail(e.target.value); setInviteStatus('idle'); setInviteError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-slate-50"
                dir="ltr"
              />
            </div>

            {!emailJSReady && (
              <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-3 flex items-start gap-2 text-right">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>Gmail לא מחובר — ההזמנות יישמרו במערכת אך לא יישלחו מהמייל שלך. חבר Gmail בהגדרות כדי לשלוח מיילים.</span>
              </div>
            )}

            {inviteStatus === 'error' && inviteError && (
              <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-start gap-2 text-right">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{inviteError}</span>
              </div>
            )}

            {inviteStatus === 'sent' && (
              <div className="mt-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2 text-right">
                <CheckCircle2 size={16} />
                <span>ההזמנה נשלחה בהצלחה! הסוכן יקבל מייל עם קישור להצטרפות.</span>
              </div>
            )}
          </div>

          {/* Team Members List */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
              <h3 className="font-semibold text-slate-700">חברי הצוות</h3>
              <Users size={16} className="text-slate-400" />
            </div>
            <div className="divide-y divide-slate-50">
              {team.map(member => {
                const stats = agentStats(member.name);
                return (
                  <div key={member.id} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
                    {/* Actions: role selector + remove */}
                    <div className="flex items-center gap-2">
                      {!member.isCurrentUser && (
                        <button
                          onClick={() => setConfirmRemoveMember(member)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="הסר מהצוות"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      {member.isCurrentUser ? (
                        <span className="bg-amber-100 text-amber-700 text-xs px-3 py-1 rounded-full font-semibold flex items-center gap-1">
                          <Shield size={11} />
                          מנהל
                        </span>
                      ) : (
                        <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
                          {(['מנהל', 'סוכן'] as const).map(role => (
                            <button
                              key={role}
                              onClick={() => onUpdateRole(member.id, role)}
                              className={`px-3 py-1.5 font-medium transition-colors ${
                                member.role === role
                                  ? 'bg-indigo-900 text-white'
                                  : 'bg-white text-slate-500 hover:bg-slate-50'
                              }`}
                            >
                              {role}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Quick stats */}
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <div className="text-center">
                        <div className="font-bold text-slate-800 text-base">{stats.active}</div>
                        <div>פעילים</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-slate-800 text-base">{stats.total}</div>
                        <div>סה"כ לידים</div>
                      </div>
                      <div className="text-center">
                        <div className="font-bold text-indigo-600 text-base">{stats.conversion}%</div>
                        <div>המרה</div>
                      </div>
                    </div>

                    {/* Member info */}
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="font-semibold text-slate-800">
                            {member.name}
                            {member.isCurrentUser && (
                              <span className="text-slate-400 font-normal text-xs mr-1">(אתה)</span>
                            )}
                          </span>
                        </div>
                        <span className="text-sm text-slate-400">{member.email}</span>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm flex-shrink-0">
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
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
              <h3 className="font-semibold text-slate-700">הזמנות ממתינות</h3>
              <Clock size={16} className="text-slate-400" />
            </div>

            {pendingInvites.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <Mail size={32} className="mx-auto mb-3 opacity-30" />
                <div className="text-sm">אין הזמנות פתוחות</div>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {pendingInvites.map(invite => {
                  const isResending = resendingEmail === invite.email;
                  const isRevoking = revokingEmail === invite.email;
                  const invitedDate = new Date(invite.invitedAt);
                  const daysSince = Math.floor((Date.now() - invitedDate.getTime()) / (1000 * 60 * 60 * 24));
                  const isExpired = daysSince >= 3;

                  return (
                    <div key={invite.email} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50">
                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRevoke(invite)}
                          disabled={isRevoking}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          title="בטל הזמנה"
                        >
                          {isRevoking ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                        <button
                          onClick={() => handleResend(invite)}
                          disabled={isResending}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                          title="שלח מחדש"
                        >
                          {isResending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        </button>
                      </div>

                      {/* Invite details */}
                      <div className="flex items-center gap-4 text-sm">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          isExpired
                            ? 'bg-red-100 text-red-600'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {isExpired ? 'פג תוקף' : 'ממתין'}
                        </span>
                        <span className="text-slate-400 text-xs">
                          {daysSince === 0 ? 'היום' : `לפני ${daysSince} ימים`}
                        </span>
                        <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                          {invite.role}
                        </span>
                      </div>

                      {/* Email */}
                      <div className="text-right">
                        <div className="font-medium text-slate-800 text-sm" dir="ltr">{invite.email}</div>
                        <div className="text-xs text-slate-400">הוזמן ע"י {invite.invitedBy}</div>
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
                stats.avgScore >= 75 ? 'text-green-600' :
                stats.avgScore >= 50 ? 'text-orange-500' :
                'text-slate-400';
              const rankColors = ['text-yellow-500', 'text-slate-400', 'text-orange-600'];

              return (
                <div key={member.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-start justify-between">
                    {/* Right: avatar + name */}
                    <div className="flex items-center gap-3">
                      {/* Rank badge */}
                      {index < 3 && stats.total > 0 && (
                        <Award size={20} className={rankColors[index]} />
                      )}
                      <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg flex-shrink-0">
                        {member.name[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-slate-800">
                          {member.name}
                          {member.isCurrentUser && (
                            <span className="text-slate-400 font-normal text-xs mr-2">(אתה)</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400">{member.email}</div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block ${
                          member.role === 'מנהל' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'
                        }`}>
                          {member.role}
                        </span>
                      </div>
                    </div>

                    {/* Left: stats */}
                    <div className="flex items-center gap-6 text-center">
                      <div>
                        <div className="text-2xl font-bold text-slate-800">{stats.total}</div>
                        <div className="text-xs text-slate-500">סה"כ לידים</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-green-600">{stats.active}</div>
                        <div className="text-xs text-slate-500">לקוחות פעילים</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-orange-500">{stats.onboarding}</div>
                        <div className="text-xs text-slate-500">בתהליך</div>
                      </div>
                      <div>
                        <div className={`text-2xl font-bold ${scoreColor}`}>{stats.avgScore}%</div>
                        <div className="text-xs text-slate-500">ציון AI</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-indigo-600">{stats.conversion}%</div>
                        <div className="text-xs text-slate-500">המרה</div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bars */}
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{stats.conversion}%</span>
                        <span>שיעור המרה</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full">
                        <div
                          className="h-2 bg-indigo-500 rounded-full transition-all"
                          style={{ width: `${Math.min(stats.conversion, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>{stats.avgScore}%</span>
                        <span>ציון AI ממוצע</span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            stats.avgScore >= 75 ? 'bg-green-500' :
                            stats.avgScore >= 50 ? 'bg-orange-400' : 'bg-slate-300'
                          }`}
                          style={{ width: `${Math.min(stats.avgScore, 100)}%` }}
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-right" dir="rtl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">הסרת חבר צוות</h3>
                <p className="text-sm text-slate-500">פעולה זו אינה ניתנת לביטול</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-6">
              האם להסיר את <span className="font-semibold text-slate-800">{confirmRemoveMember.name}</span> ({confirmRemoveMember.email}) מהצוות?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmRemoveMember(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
              >
                ביטול
              </button>
              <button
                onClick={() => handleRemoveMember(confirmRemoveMember)}
                disabled={removingMemberId === confirmRemoveMember.id}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
              >
                {removingMemberId === confirmRemoveMember.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
                הסר מהצוות
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ASSIGNMENT TAB ─── */}
      {activeTab === 'assignment' && (
        <div className="space-y-4">
          {team.map(member => {
            const memberLeadList = memberLeads(member.name);
            const stats = agentStats(member.name);
            return (
              <div key={member.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-indigo-700">{memberLeadList.length} לידים</span>
                    <span className="text-xs text-slate-400">|</span>
                    <span className="text-xs text-green-600 font-medium">{stats.active} פעילים</span>
                    <span className="text-xs text-orange-500 font-medium">{stats.onboarding} בתהליך</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <span className="font-semibold text-slate-700">{member.name}</span>
                      <div className="text-xs text-slate-400">{member.role}</div>
                    </div>
                    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
                      {member.name[0].toUpperCase()}
                    </div>
                  </div>
                </div>
                {memberLeadList.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 text-sm">אין לידים משויכים</div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {memberLeadList.slice(0, 6).map(lead => (
                      <div key={lead.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                        <div className="flex items-center gap-2">
                          {lead.aiScore > 0 && (
                            <span className={`text-xs font-bold ${
                              lead.aiScore >= 75 ? 'text-green-600' :
                              lead.aiScore >= 50 ? 'text-orange-500' : 'text-slate-400'
                            }`}>
                              {lead.aiScore}%
                            </span>
                          )}
                          <StatusBadge status={lead.status} size="sm" />
                        </div>
                        <div className="text-right">
                          <div className="font-medium text-slate-800 text-sm">{lead.company}</div>
                          <div className="text-xs text-slate-400">{lead.contactName}</div>
                        </div>
                      </div>
                    ))}
                    {memberLeadList.length > 6 && (
                      <div className="px-5 py-2 text-xs text-slate-400 text-center bg-slate-50">
                        +{memberLeadList.length - 6} לידים נוספים
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
