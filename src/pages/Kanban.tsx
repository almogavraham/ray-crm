import { useState } from 'react';
import {
  TrendingUp, ChevronDown, ChevronUp, CheckSquare,
  AlertCircle, Zap, Phone, Mail, Globe,
  Star, ArrowUpRight, Users, Calendar, Share2, Megaphone, Sparkles,
} from 'lucide-react';
import type { Lead, LeadStatus, LeadSource } from '../types';
import { STATUS_CONFIG } from '../data/mockData';

const COLUMNS: LeadStatus[] = [
  'חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'
];

const SOURCE_ICON: Record<LeadSource, React.ReactNode> = {
  'אורגני':      <Globe size={10} />,
  'פרסום ממומן': <Megaphone size={10} />,
  'הפניה':       <Users size={10} />,
  'אינסטגרם':    <Share2 size={10} />,
  'פייסבוק':     <Share2 size={10} />,
  'גוגל':        <Zap size={10} />,
};

const SOURCE_COLOR: Record<LeadSource, string> = {
  'אורגני':      'bg-emerald-50 text-emerald-700',
  'פרסום ממומן': 'bg-violet-50 text-violet-700',
  'הפניה':       'bg-blue-50 text-blue-700',
  'אינסטגרם':    'bg-pink-50 text-pink-700',
  'פייסבוק':     'bg-blue-50 text-blue-800',
  'גוגל':        'bg-orange-50 text-orange-700',
};

interface KanbanProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onLeadSave: (lead: Lead) => void;
  onPageChange?: (page: string) => void;
}

export default function Kanban({ leads, onLeadClick, onPageChange }: KanbanProps) {
  const [collapsed, setCollapsed] = useState<Set<LeadStatus>>(new Set(['לא רלוונטי']));

  const toggleCollapse = (status: LeadStatus) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(status) ? next.delete(status) : next.add(status);
      return next;
    });
  };

  const byStatus = (status: LeadStatus) => leads.filter(l => l.status === status);
  const totalBudget = (status: LeadStatus) =>
    byStatus(status).reduce((sum, l) => sum + (l.budget ?? 0), 0);

  const totalAll = leads.reduce((s, l) => s + (l.budget ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 text-sm">{leads.length} לידים</span>
          {totalAll > 0 && (
            <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full font-semibold">
              ₪{totalAll.toLocaleString()} פוטנציאל
            </span>
          )}
          {onPageChange && (
            <button
              onClick={() => onPageChange('agents')}
              className="flex items-center gap-1.5 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-full font-semibold hover:bg-indigo-100 transition-colors"
            >
              <Sparkles size={11} /> בונה Workflow ⚡
            </button>
          )}
        </div>
        <h1 className="text-xl font-bold text-slate-800">פייפליין מכירות</h1>
      </div>

      {/* Kanban board */}
      <div className="flex gap-3 overflow-x-auto pb-3" style={{ direction: 'rtl' }}>
        {COLUMNS.map(status => {
          const col      = byStatus(status);
          const cfg      = STATUS_CONFIG[status];
          const isColl   = collapsed.has(status);
          const budget   = totalBudget(status);
          const avgScore = col.length
            ? Math.round(col.reduce((s, l) => s + l.aiScore, 0) / col.length)
            : 0;

          return (
            <div
              key={status}
              className={`flex-shrink-0 rounded-2xl border transition-all duration-300 ${
                isColl ? 'w-14 bg-slate-50 border-slate-200' : 'w-64 bg-slate-50/80 border-slate-200'
              }`}
            >
              {/* Column header */}
              <div
                className="flex items-center justify-between px-3 py-3 cursor-pointer select-none"
                onClick={() => toggleCollapse(status)}
              >
                {!isColl ? (
                  <>
                    <div className="flex items-center gap-2">
                      <ChevronUp size={14} className="text-slate-400" />
                      <span className="text-xs font-bold text-white bg-slate-600 w-5 h-5 rounded-full flex items-center justify-center">
                        {col.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-700">{status}</span>
                      <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 w-full py-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                    <span className="text-[10px] font-bold text-slate-500">{col.length}</span>
                    <ChevronDown size={12} className="text-slate-400" />
                  </div>
                )}
              </div>

              {/* Column stats */}
              {!isColl && col.length > 0 && (
                <div className="mx-3 mb-2 bg-white rounded-xl border border-slate-200 px-3 py-2 flex justify-between items-center">
                  <div className="text-center">
                    <div className="text-xs font-bold text-slate-700">
                      {avgScore > 0 ? `${avgScore}%` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400">AI ממוצע</div>
                  </div>
                  <div className="w-px h-6 bg-slate-200" />
                  <div className="text-center">
                    <div className="text-xs font-bold text-emerald-700">
                      {budget > 0 ? `₪${(budget / 1000).toFixed(0)}K` : '—'}
                    </div>
                    <div className="text-[10px] text-slate-400">פוטנציאל</div>
                  </div>
                </div>
              )}

              {/* Cards */}
              {!isColl && (
                <div className="p-2 space-y-2.5 min-h-[120px] max-h-[calc(100vh-300px)] overflow-y-auto">
                  {col.length === 0 ? (
                    <div className="text-center text-slate-300 text-xs py-10 flex flex-col items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
                        <ArrowUpRight size={14} className="text-slate-400" />
                      </div>
                      אין לידים
                    </div>
                  ) : (
                    col.map(lead => (
                      <KanbanCard key={lead.id} lead={lead} onClick={() => onLeadClick(lead)} />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary funnel */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-end gap-2 overflow-x-auto" dir="rtl">
          {COLUMNS.map((status, idx) => {
            const col = byStatus(status);
            const pct = leads.length > 0 ? (col.length / leads.length) * 100 : 0;
            const cfg = STATUS_CONFIG[status];
            const w   = Math.max(40, 100 - idx * 12);
            return (
              <div key={status} className="flex-shrink-0 flex flex-col items-center gap-1.5 min-w-[70px]">
                <div className="text-lg font-black text-slate-800">{col.length}</div>
                <div
                  className={`${cfg.dot} rounded-t-lg opacity-80 w-full transition-all`}
                  style={{ height: `${Math.max(6, pct * 0.8)}px`, maxWidth: `${w}%`, margin: '0 auto' }}
                />
                <div className="text-[10px] text-slate-500 font-medium text-center leading-tight">{status}</div>
                <div className="text-[10px] text-slate-400">{Math.round(pct)}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── Kanban Card ──────────────────────────────────────────────────────────── */
function KanbanCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const isVIP      = (lead.budget ?? 0) >= 15000;
  const openTasks  = lead.tasks.filter(t => !t.completed);
  const overdue    = openTasks.filter(t => {
    try { return new Date(t.date + 'T00:00:00') < new Date(new Date().toDateString()); }
    catch { return false; }
  });
  const nextTask   = openTasks.sort((a, b) => a.date.localeCompare(b.date))[0];

  const scoreColor =
    lead.aiScore >= 75 ? 'text-emerald-600' :
    lead.aiScore >= 50 ? 'text-amber-500' :
    lead.aiScore > 0   ? 'text-red-400' : 'text-slate-300';

  const scoreBg =
    lead.aiScore >= 75 ? 'bg-emerald-500' :
    lead.aiScore >= 50 ? 'bg-amber-400' :
    lead.aiScore > 0   ? 'bg-red-400' : 'bg-slate-200';

  const initials = (lead.assignedTo ?? '')
    .split(' ').map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();

  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-xl p-3 cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all duration-150 group relative overflow-hidden"
    >
      {/* VIP accent */}
      {isVIP && (
        <div className="absolute top-0 right-0 w-1 h-full bg-gradient-to-b from-amber-400 to-orange-400 rounded-r-xl" />
      )}

      {/* Top row: company + VIP */}
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="flex items-center gap-1">
          {isVIP && <Star size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
          {lead.aiScore > 0 && (
            <span className={`text-[10px] font-black ${scoreColor}`}>{lead.aiScore}%</span>
          )}
        </div>
        <div className="font-bold text-slate-800 text-sm leading-tight text-right truncate flex-1">
          {lead.company}
        </div>
      </div>

      {/* AI Score bar */}
      {lead.aiScore > 0 && (
        <div className="h-0.5 bg-slate-100 rounded-full mb-2">
          <div
            className={`h-0.5 rounded-full transition-all ${scoreBg}`}
            style={{ width: `${lead.aiScore}%` }}
          />
        </div>
      )}

      {/* Contact row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          {lead.email && <Mail size={10} className="text-slate-300" />}
          {lead.phone && <Phone size={10} className="text-slate-300" />}
        </div>
        <div className="text-xs text-slate-500 truncate text-right">{lead.contactName}</div>
      </div>

      {/* Budget + Source */}
      <div className="flex items-center justify-between mb-2">
        {lead.source && (
          <span className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLOR[lead.source]}`}>
            {SOURCE_ICON[lead.source]}
            {lead.source}
          </span>
        )}
        {(lead.budget ?? 0) > 0 && (
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-lg">
            ₪{(lead.budget ?? 0).toLocaleString()}
          </span>
        )}
      </div>

      {/* Solutions */}
      {lead.solutions.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {lead.solutions.slice(0, 2).map(s => (
            <span
              key={s.name}
              className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                s.delivered ? 'bg-emerald-50 text-emerald-700 line-through opacity-60' :
                s.inProgress ? 'bg-indigo-50 text-indigo-700' :
                'bg-slate-100 text-slate-600'
              }`}
            >
              {s.name}
            </span>
          ))}
          {lead.solutions.length > 2 && (
            <span className="text-[10px] text-slate-400">+{lead.solutions.length - 2}</span>
          )}
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between pt-1.5 border-t border-slate-100">
        {/* Assignee avatar */}
        <div className="flex items-center gap-1.5">
          {initials && (
            <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-[9px] font-black flex items-center justify-center">
              {initials}
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className="flex items-center gap-1">
          {lead.waitingContent && (
            <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full font-medium">
              ממתין לתוכן
            </span>
          )}
          {overdue.length > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full font-medium">
              <AlertCircle size={8} />
              {overdue.length} באיחור
            </span>
          )}
          {openTasks.length > 0 && overdue.length === 0 && (
            <span className="flex items-center gap-0.5 text-[9px] bg-slate-50 text-slate-500 border border-slate-200 px-1.5 py-0.5 rounded-full">
              <CheckSquare size={8} />
              {openTasks.length}
            </span>
          )}
        </div>
      </div>

      {/* Next task */}
      {nextTask && (
        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-400">
          <Calendar size={9} />
          <span className="truncate">{nextTask.date} · {nextTask.description}</span>
        </div>
      )}

      {/* TrendingUp hover indicator */}
      {isVIP && (
        <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <TrendingUp size={12} className="text-amber-400" />
        </div>
      )}
    </div>
  );
}
