import { useState } from 'react';
import { UserPlus, Mail, Users } from 'lucide-react';
import type { TeamMember, Lead } from '../types';
import StatusBadge from '../components/StatusBadge';

interface TeamManagementProps {
  team: TeamMember[];
  leads: Lead[];
  onUpdateRole: (id: string, role: 'מנהל' | 'סוכן') => void;
  onInvite: (email: string, role: 'מנהל' | 'סוכן') => void;
}

export default function TeamManagement({ team, leads, onUpdateRole, onInvite }: TeamManagementProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'assignment'>('members');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'מנהל' | 'סוכן'>('סוכן');
  const [inviteSent, setInviteSent] = useState(false);

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    onInvite(inviteEmail.trim(), inviteRole);
    setInviteSent(true);
    setInviteEmail('');
    setTimeout(() => setInviteSent(false), 3000);
  };

  const memberLeads = (name: string) => leads.filter(l => l.assignedTo === name);

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
      <div className="flex gap-2 bg-white rounded-xl border border-slate-200 p-1 w-fit shadow-sm">
        {[
          { key: 'members', label: 'חברי צוות' },
          { key: 'assignment', label: 'שיוך לידים' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as 'members' | 'assignment')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-indigo-900 text-white'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'members' ? (
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
                disabled={!inviteEmail.trim()}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inviteSent
                    ? 'bg-green-500 text-white'
                    : 'bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <Mail size={14} />
                {inviteSent ? 'נשלח!' : 'שלח הזמנה'}
              </button>
              <div className="flex rounded-lg overflow-hidden border border-slate-200">
                {(['מנהל', 'סוכן'] as const).map(role => (
                  <button
                    key={role}
                    onClick={() => setInviteRole(role)}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                      inviteRole === role
                        ? 'bg-indigo-900 text-white'
                        : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <input
                type="email"
                placeholder="כתובת אימייל..."
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-slate-50"
              />
            </div>
          </div>

          {/* Team Members List */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-end gap-2">
              <h3 className="font-semibold text-slate-700">חברי הצוות</h3>
              <Users size={16} className="text-slate-400" />
            </div>
            <div className="divide-y divide-slate-50">
              {team.map(member => (
                <div key={member.id} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors">
                  {/* Role selector */}
                  {member.isCurrentUser ? (
                    <span className="bg-amber-100 text-amber-700 text-xs px-3 py-1 rounded-full font-semibold">
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
                    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                      {member.name[0].toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Lead Assignment Tab */
        <div className="space-y-4">
          {team.map(member => {
            const memberLeadList = memberLeads(member.name);
            return (
              <div key={member.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                  <span className="text-sm font-bold text-indigo-700">{memberLeadList.length} לידים</span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">{member.name}</span>
                    <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">
                      {member.name[0].toUpperCase()}
                    </div>
                  </div>
                </div>
                {memberLeadList.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 text-sm">אין לידים משויכים</div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {memberLeadList.slice(0, 5).map(lead => (
                      <div key={lead.id} className="flex items-center justify-between px-5 py-3">
                        <StatusBadge status={lead.status} size="sm" />
                        <div className="text-right">
                          <div className="font-medium text-slate-800 text-sm">{lead.company}</div>
                          <div className="text-xs text-slate-400">{lead.contactName}</div>
                        </div>
                      </div>
                    ))}
                    {memberLeadList.length > 5 && (
                      <div className="px-5 py-2 text-xs text-slate-400 text-center">
                        +{memberLeadList.length - 5} לידים נוספים
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
