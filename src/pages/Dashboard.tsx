import { useState, useMemo } from 'react';
import {
  Search, Filter, Download, Flame, CheckCircle2, Rocket, Users,
  MessageSquare, Mail, Star, ChevronDown, Bell, ArrowUpDown, ArrowUp, ArrowDown, TrendingUp
} from 'lucide-react';
import type { Lead, LeadStatus, Bank } from '../types';
import StatusBadge from '../components/StatusBadge';
import EmailModal from '../components/EmailModal';
import { BANKS } from '../data/mockData';

const ALL_STATUSES: LeadStatus[] = [
  'חדש', 'הקמת כספת בבנק', 'הטמעה', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי'
];

type SortField = 'company' | 'status' | 'checkCount' | 'lastUpdate' | 'aiScore';
type SortDir = 'asc' | 'desc';

interface DashboardProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onNoteClick: (lead: Lead) => void;
  onTaskComplete?: (leadId: string, taskId: string) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function Dashboard({ leads, onLeadClick, onNoteClick, onTaskComplete, onToast }: DashboardProps) {
  const [search, setSearch] = useState('');
  const [activeStatus, setActiveStatus] = useState<LeadStatus | 'הכל'>('הכל');
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [bankFilter, setBankFilter] = useState<Bank | ''>('');
  const [showFilters, setShowFilters] = useState(false);
  const [emailLead, setEmailLead] = useState<Lead | null>(null);
  const [sortField, setSortField] = useState<SortField>('lastUpdate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const hotLeads = leads.filter(l => l.checkCount >= 100).length;
  const activeClients = leads.filter(l => l.status === 'לקוח פעיל').length;
  const onboarding = leads.filter(l => l.status === 'הטמעה').length;
  const newLeads = leads.filter(l => l.status === 'חדש').length;

  const cheXPending = {
    training: leads.filter(l => l.source === 'cheX' && l.status === 'הטמעה' && !l.solutions.find(s => s.name === 'cheX')?.hasTraining).length,
    installation: leads.filter(l => l.source === 'cheX' && l.status === 'הטמעה' && !l.solutions.find(s => s.name === 'cheX')?.hasInstallation).length,
  };
  const ci3Pending = {
    training: leads.filter(l => l.source === 'ci3' && l.status === 'הטמעה' && !l.solutions.find(s => s.name === 'ci3')?.hasTraining).length,
    installation: leads.filter(l => l.source === 'ci3' && l.status === 'הטמעה' && !l.solutions.find(s => s.name === 'ci3')?.hasInstallation).length,
  };
  const scannersPending = {
    training: leads.filter(l => l.source === 'סורקים' && l.status === 'הטמעה').length,
    installation: leads.filter(l => l.source === 'סורקים' && l.status === 'הטמעה').length,
  };

  const upcomingTasks = leads
    .flatMap(l => l.tasks.filter(t => !t.completed).map(t => ({ ...t, company: l.company, lead: l })))
    .slice(0, 5);

  const statusCounts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length;
    return acc;
  }, {} as Record<LeadStatus, number>);

  const parseDate = (d: string) => {
    const parts = d.split('/');
    if (parts.length !== 3) return 0;
    return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const filtered = useMemo(() => {
    const base = leads.filter(l => {
      const matchSearch = !search || [l.company, l.contactName, l.phone, l.email]
        .some(f => f.toLowerCase().includes(search.toLowerCase()));
      const matchStatus = activeStatus === 'הכל' || l.status === activeStatus;
      const matchSource = !sourceFilter || l.source === sourceFilter;
      const matchBank = !bankFilter || l.banks.includes(bankFilter as Bank);
      return matchSearch && matchStatus && matchSource && matchBank;
    });

    return [...base].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'company': cmp = a.company.localeCompare(b.company, 'he'); break;
        case 'checkCount': cmp = a.checkCount - b.checkCount; break;
        case 'aiScore': cmp = a.aiScore - b.aiScore; break;
        case 'lastUpdate': cmp = parseDate(a.lastUpdate) - parseDate(b.lastUpdate); break;
        case 'status': cmp = a.status.localeCompare(b.status, 'he'); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, search, activeStatus, sourceFilter, sortField, sortDir]);

  const exportCSV = () => {
    const headers = ['חברה', 'איש קשר', 'טלפון', 'מייל', 'סטטוס', 'בנק', "כמות צ'קים", 'מקור', 'ציון AI'];
    const rows = filtered.map(l => [
      l.company, l.contactName, l.phone, l.email, l.status,
      l.banks.join(' | '), l.checkCount, l.source, l.aiScore
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads.csv'; a.click();
    onToast?.('קובץ CSV יוצא בהצלחה', 'success');
  };

  const conversionRate = leads.length > 0
    ? Math.round((activeClients / leads.length) * 100) : 0;

  return (
    <div className="space-y-4">
      {emailLead && (
        <EmailModal lead={emailLead} onClose={() => setEmailLead(null)} />
      )}

      {/* Upcoming Tasks Panel */}
      {upcomingTasks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => setTasksExpanded(!tasksExpanded)}
          >
            <div className="flex items-center gap-2">
              <ChevronDown size={16} className={`text-slate-400 transition-transform ${tasksExpanded ? '' : '-rotate-90'}`} />
            </div>
            <div className="flex items-center gap-3">
              <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                {upcomingTasks.length} דחופות
              </span>
              <span className="font-semibold text-slate-700">המשימות שלי</span>
              <Bell size={16} className="text-slate-400" />
            </div>
          </div>
          {tasksExpanded && (
            <div className="px-5 pb-3 space-y-2">
              {upcomingTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 cursor-pointer hover:bg-orange-100 transition-colors"
                  onClick={() => onLeadClick(task.lead)}
                >
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-indigo-600 text-xs">📅 {task.date} · {task.time}</span>
                    <span className="text-orange-600 font-medium">🏢 {task.company}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{task.description}</span>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onTaskComplete?.(task.lead.id, task.id);
                      }}
                      className="bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1 rounded-lg transition-colors"
                    >
                      בצע ✓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending Tasks */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="bg-slate-700 text-white text-xs px-2.5 py-0.5 rounded-full font-medium">
              {cheXPending.training + cheXPending.installation + ci3Pending.training + ci3Pending.installation + scannersPending.training * 2} סה"כ
            </span>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-green-50 border border-green-100 rounded-full px-3 py-1">
              <TrendingUp size={11} className="text-green-600" />
              <span className="text-green-700 font-semibold">{conversionRate}% המרה</span>
            </div>
          </div>
          <h3 className="font-semibold text-slate-700">משימות ממתינות</h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'cheX', emoji: '✅', data: cheXPending, color: 'green' },
            { label: 'ci3', emoji: '🔗', data: ci3Pending, color: 'blue' },
            { label: 'סורקים', emoji: '📷', data: scannersPending, color: 'orange' },
          ].map(({ label, emoji, data, color }) => (
            <div key={label} className={`rounded-lg p-3 border ${
              color === 'green' ? 'bg-green-50 border-green-100' :
              color === 'blue' ? 'bg-blue-50 border-blue-100' :
              'bg-orange-50 border-orange-100'
            }`}>
              <div className={`font-bold text-sm mb-2 flex items-center gap-1 justify-end ${
                color === 'green' ? 'text-green-700' : color === 'blue' ? 'text-blue-700' : 'text-orange-700'
              }`}>{label} {emoji}</div>
              <div className="space-y-1">
                {[['הדרכה', data.training], ['התקנה', data.installation]].map(([name, val]) => (
                  <div key={name as string} className="flex justify-between text-sm">
                    <span className={`font-bold ${(val as number) > 0 ? (color === 'orange' ? 'text-orange-600' : color === 'blue' ? 'text-blue-600' : 'text-green-600') : 'text-slate-400'}`}>
                      {val as number}
                    </span>
                    <span className="text-slate-500">• {name as string}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="לידים חמים" value={hotLeads} sub="+100 צ'קים" icon={<Flame size={20} className="text-red-500" />} color="red" percent={Math.round(hotLeads / Math.max(leads.length, 1) * 100)} />
        <KpiCard label="לקוחות פעילים" value={activeClients} sub={`${conversionRate}% המרה`} icon={<CheckCircle2 size={20} className="text-green-500" />} color="green" percent={conversionRate} />
        <KpiCard label="בהטמעה" value={onboarding} sub="ממתינים לסיום" icon={<Rocket size={20} className="text-orange-500" />} color="orange" percent={Math.round(onboarding / Math.max(leads.length, 1) * 100)} />
        <KpiCard label={'סה"כ לידים'} value={leads.length} sub={`${newLeads} לידים חדשים`} icon={<Users size={20} className="text-indigo-500" />} color="indigo" percent={100} />
      </div>

      {/* Search + Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
              showFilters || sourceFilter ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Filter size={14} />
            פילטרים
            <ChevronDown size={12} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
          <div className="flex-1 relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="חיפוש לפי חברה, שם, טלפון, מייל..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-slate-50"
            />
          </div>
        </div>

        {showFilters && (
          <div className="space-y-2 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-500 w-8">מקור:</span>
              {['', 'cheX', 'ci3', 'סורקים'].map(s => (
                <button
                  key={s}
                  onClick={() => setSourceFilter(s)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    sourceFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {s || 'הכל'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-500 w-8">בנק:</span>
              <button
                onClick={() => setBankFilter('')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  bankFilter === '' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >הכל</button>
              {BANKS.map(b => (
                <button
                  key={b}
                  onClick={() => setBankFilter(bankFilter === b ? '' : b)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    bankFilter === b ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Status Tabs */}
        <div className="flex items-center gap-2 flex-wrap">
          <StatusTab label="הכל" count={leads.length} active={activeStatus === 'הכל'} onClick={() => setActiveStatus('הכל')} primary />
          {ALL_STATUSES.map(s => (
            <StatusTab key={s} label={s} count={statusCounts[s]} active={activeStatus === s} onClick={() => setActiveStatus(activeStatus === s ? 'הכל' : s)} />
          ))}
        </div>

        <div className="flex items-center justify-between text-sm text-slate-500">
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-xs transition-colors">
            <Download size={13} />
            ייצוא ל-CSV
          </button>
          <span className="text-slate-400">{filtered.length} לידים</span>
        </div>
      </div>

      {/* Leads Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-gradient-to-l from-slate-50 to-white">
              <SortTh label="חברה" field="company" current={sortField} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">שם איש קשר</th>
              <SortTh label="סטטוס" field="status" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh label="צ'קים" field="checkCount" current={sortField} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">בנק</th>
              <SortTh label="עדכון אחרון" field="lastUpdate" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh label="ציון AI" field="aiScore" current={sortField} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-16 text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <Search size={32} className="text-slate-200" />
                    <span>לא נמצאו לידים</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((lead, i) => (
                <tr
                  key={lead.id}
                  className={`border-b border-slate-50 hover:bg-indigo-50/40 cursor-pointer transition-colors ${i % 2 === 0 ? '' : 'bg-slate-50/30'}`}
                  onClick={() => onLeadClick(lead)}
                >
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-800 text-sm">{lead.company}</span>
                        {lead.waitingG3 && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold leading-none">G3</span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">{lead.source}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">{lead.contactName}</td>
                  <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
                  <td className="px-4 py-3 text-sm">
                    {lead.checkCount > 0 ? (
                      <span className={`font-medium ${lead.checkCount >= 100 ? 'text-red-600' : 'text-slate-700'}`}>
                        {lead.checkCount}{lead.checkCount >= 100 && ' 🔥'}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {lead.banks.length > 0 ? lead.banks.join(', ') : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">{lead.lastUpdate}</td>
                  <td className="px-4 py-3">
                    <AiScoreBadge score={lead.aiScore} />
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => onNoteClick(lead)}
                        className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                        title="שימור"
                      >
                        <Star size={12} />
                      </button>
                      <button
                        onClick={() => onLeadClick(lead)}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                        title="הערה"
                      >
                        <MessageSquare size={12} />
                      </button>
                      <button
                        onClick={() => setEmailLead(lead)}
                        className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 transition-colors"
                        title="שלח מייל"
                      >
                        <Mail size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiScoreBadge({ score }: { score: number }) {
  if (score === 0) return <span className="text-slate-300 text-xs">—</span>;
  const color = score >= 75 ? 'text-green-600 bg-green-50' : score >= 50 ? 'text-orange-500 bg-orange-50' : 'text-slate-500 bg-slate-100';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{score}%</span>
  );
}

function KpiCard({ label, value, sub, icon, color, percent }: {
  label: string; value: number; sub: string; icon: React.ReactNode;
  color: 'red' | 'green' | 'orange' | 'indigo'; percent: number;
}) {
  const barColor = { red: 'bg-red-400', green: 'bg-green-400', orange: 'bg-orange-400', indigo: 'bg-indigo-400' }[color];
  const textColor = { red: 'text-red-600', green: 'text-green-600', orange: 'text-orange-600', indigo: 'text-indigo-600' }[color];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <div className={`text-3xl font-bold ${textColor}`}>{value}</div>
        <div className="p-2 rounded-lg bg-slate-50">{icon}</div>
      </div>
      <div className="text-sm font-medium text-slate-700 text-right">{label}</div>
      <div className="text-xs text-slate-400 text-right mt-0.5">{sub}</div>
      <div className="mt-3 h-1 bg-slate-100 rounded-full">
        <div className={`h-1 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}

function SortTh({ label, field, current, dir, onSort }: {
  label: string; field: SortField; current: SortField; dir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = current === field;
  return (
    <th
      className={`text-right px-4 py-3 text-xs font-semibold cursor-pointer select-none transition-colors ${active ? 'text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1 justify-end">
        {active
          ? (dir === 'asc' ? <ArrowUp size={12} className="text-indigo-500" /> : <ArrowDown size={12} className="text-indigo-500" />)
          : <ArrowUpDown size={12} className="text-slate-300" />
        }
        {label}
      </div>
    </th>
  );
}

function StatusTab({ label, count, active, onClick, primary }: {
  label: string; count: number; active: boolean; onClick: () => void; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
        active && primary ? 'bg-indigo-900 text-white' :
        active ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' :
        'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
      <span className={`font-bold ${active && primary ? 'text-white' : active ? 'text-indigo-800' : 'text-slate-500'}`}>{count}</span>
    </button>
  );
}
