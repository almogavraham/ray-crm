import { useState } from 'react';
import { Flame, ChevronDown, ChevronUp } from 'lucide-react';
import type { Lead, LeadStatus } from '../types';
import { STATUS_CONFIG } from '../data/mockData';

const COLUMNS: LeadStatus[] = [
  'חדש', 'הקמת כספת בבנק', 'הטמעה', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'
];

interface KanbanProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onLeadSave: (lead: Lead) => void;
}

export default function Kanban({ leads, onLeadClick }: KanbanProps) {
  const [collapsed, setCollapsed] = useState<Set<LeadStatus>>(new Set(['לא רלוונטי']));

  const toggleCollapse = (status: LeadStatus) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const byStatus = (status: LeadStatus) => leads.filter(l => l.status === status);

  const totalChecks = (status: LeadStatus) =>
    byStatus(status).reduce((sum, l) => sum + l.checkCount, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-slate-500 text-sm">{leads.length} לידים בפייפליין</span>
        <h1 className="text-xl font-bold text-slate-800">פייפליין מכירות</h1>
      </div>

      {/* Kanban columns */}
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ direction: 'rtl' }}>
        {COLUMNS.map(status => {
          const col = byStatus(status);
          const cfg = STATUS_CONFIG[status];
          const isCollapsed = collapsed.has(status);

          return (
            <div
              key={status}
              className={`flex-shrink-0 bg-slate-50 border border-slate-200 rounded-xl transition-all duration-200 ${
                isCollapsed ? 'w-14' : 'w-64'
              }`}
            >
              {/* Column header */}
              <div
                className="flex items-center justify-between px-3 py-3 border-b border-slate-200 cursor-pointer select-none"
                onClick={() => toggleCollapse(status)}
              >
                {!isCollapsed ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <ChevronUp size={14} className="text-slate-400" />
                      <span className="text-xs font-bold text-slate-500 bg-slate-200 w-5 h-5 rounded-full flex items-center justify-center">
                        {col.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-700">{status}</span>
                      <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 w-full py-1">
                    <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                    <ChevronDown size={12} className="text-slate-400" />
                  </div>
                )}
              </div>

              {/* Total checks indicator */}
              {!isCollapsed && col.length > 0 && (
                <div className="px-3 py-1.5 text-xs text-slate-400 flex justify-between border-b border-slate-100">
                  <span className="font-medium text-slate-600">{totalChecks(status)} צ'קים</span>
                  <span>סה"כ</span>
                </div>
              )}

              {/* Cards */}
              {!isCollapsed && (
                <div className="p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-280px)] overflow-y-auto">
                  {col.length === 0 ? (
                    <div className="text-center text-slate-300 text-xs py-8">אין לידים</div>
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

      {/* Summary bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-4 overflow-x-auto">
          {COLUMNS.map(status => {
            const col = byStatus(status);
            const pct = leads.length > 0 ? Math.round((col.length / leads.length) * 100) : 0;
            const cfg = STATUS_CONFIG[status];
            return (
              <div key={status} className="flex-shrink-0 text-center min-w-[80px]">
                <div className="text-lg font-bold text-slate-800">{col.length}</div>
                <div className="text-xs text-slate-500 mb-1">{status}</div>
                <div className="h-1 bg-slate-100 rounded-full w-full">
                  <div
                    className={`h-1 rounded-full ${cfg.dot}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs text-slate-400 mt-0.5">{pct}%</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KanbanCard({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  const isHot = lead.checkCount >= 100;
  const scoreColor =
    lead.aiScore >= 75 ? 'text-green-600' :
    lead.aiScore >= 50 ? 'text-orange-500' :
    'text-slate-400';

  return (
    <div
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:border-indigo-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start justify-between gap-1 mb-2">
        {isHot && (
          <span className="flex items-center gap-0.5 text-xs text-red-500 font-bold">
            <Flame size={11} />
            {lead.checkCount}
          </span>
        )}
        <div className="font-semibold text-slate-800 text-sm leading-tight text-right flex-1 truncate">
          {lead.company}
        </div>
      </div>

      <div className="text-xs text-slate-500 text-right mb-2">{lead.contactName}</div>

      <div className="flex items-center justify-between">
        <div className={`text-xs font-bold ${scoreColor}`}>
          {lead.aiScore > 0 ? `${lead.aiScore}%` : '—'}
        </div>
        <div className="flex items-center gap-1">
          {lead.banks.slice(0, 2).map(b => (
            <span key={b} className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
              {b}
            </span>
          ))}
        </div>
      </div>

      {lead.checkCount > 0 && !isHot && (
        <div className="mt-2 flex items-center gap-1 text-xs text-slate-400">
          <span className="font-medium text-slate-600">{lead.checkCount}</span>
          <span>צ'קים/חודש</span>
        </div>
      )}

      {lead.tasks.filter(t => !t.completed).length > 0 && (
        <div className="mt-2 text-xs bg-orange-50 text-orange-600 px-2 py-1 rounded text-right">
          {lead.tasks.filter(t => !t.completed).length} משימות פתוחות
        </div>
      )}
    </div>
  );
}
