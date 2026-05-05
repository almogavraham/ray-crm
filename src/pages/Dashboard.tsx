import { useState, useMemo } from 'react';
import {
  Search, Filter, Download, Flame, CheckCircle2, Rocket, Users,
  MessageSquare, Mail, Star, ChevronDown, Bell, ArrowUpDown, ArrowUp, ArrowDown, X,
} from 'lucide-react';
import type { Lead, LeadStatus } from '../types';
import StatusBadge from '../components/StatusBadge';
import EmailModal from '../components/EmailModal';

const ALL_STATUSES: LeadStatus[] = [
  'חדש', 'בתהליך', 'לקוח פעיל', 'רימרקטינג', 'לא רלוונטי',
];

const ALL_SOURCES = ['אורגני', 'פרסום ממומן', 'הפניה', 'אינסטגרם', 'פייסבוק', 'גוגל'];

type SortField = 'company' | 'status' | 'budget' | 'lastUpdate' | 'aiScore';
type SortDir   = 'asc' | 'desc';

interface DashboardProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onNoteClick: (lead: Lead) => void;
  onTaskComplete?: (leadId: string, taskId: string) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onBulkStatusChange?: (leadIds: string[], status: LeadStatus) => void;
  compact?: boolean;
}

// ─── safe helpers ──────────────────────────────────────────────────────────────
const safeStr  = (v: unknown) => (v == null ? '' : String(v));
const safeArr  = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const safeNum  = (v: unknown) => (isFinite(Number(v)) ? Number(v) : 0);

function parseDate(d: string | undefined): number {
  if (!d) return 0;
  const p = d.split('/');
  if (p.length !== 3) return 0;
  const ts = new Date(`${p[2]}-${p[1]}-${p[0]}`).getTime();
  return isNaN(ts) ? 0 : ts;
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard({
  leads, onLeadClick, onNoteClick, onTaskComplete, onToast, onBulkStatusChange, compact = false,
}: DashboardProps) {
  const [search,       setSearch]       = useState('');
  const [activeStatus, setActiveStatus] = useState<LeadStatus | 'הכל'>('הכל');
  const [tasksExpanded,setTasksExpanded]= useState(true);
  const [sourceFilter, setSourceFilter] = useState('');
  const [showFilters,  setShowFilters]  = useState(false);
  const [emailLead,    setEmailLead]    = useState<Lead | null>(null);
  const [sortField,    setSortField]    = useState<SortField>('lastUpdate');
  const [sortDir,      setSortDir]      = useState<SortDir>('desc');
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [bulkStatus,   setBulkStatus]   = useState<LeadStatus | ''>('');

  // ── KPI counts ──────────────────────────────────────────────────────────────
  const hotLeads     = leads.filter(l => safeNum(l.budget) >= 15000).length;
  const activeClients= leads.filter(l => l.status === 'לקוח פעיל').length;
  const onboarding   = leads.filter(l => l.status === 'בתהליך').length;
  const newLeads     = leads.filter(l => l.status === 'חדש').length;
  const conversionRate = leads.length > 0 ? Math.round((activeClients / leads.length) * 100) : 0;

  const upcomingTasks = leads
    .flatMap(l => safeArr<import('../types').Task>(l.tasks).filter(t => !t.completed).map(t => ({ ...t, company: safeStr(l.company), lead: l })))
    .slice(0, 5);

  const statusCounts = ALL_STATUSES.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.status === s).length;
    return acc;
  }, {} as Record<LeadStatus, number>);

  // ── Sort handler ─────────────────────────────────────────────────────────────
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  // ── Filtered + sorted leads ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = safeStr(search).toLowerCase();
    const base = leads.filter(l => {
      const matchSearch = !q
        || [l.company, l.contactName, l.phone, l.email].some(f => safeStr(f).toLowerCase().includes(q));
      const matchStatus = activeStatus === 'הכל' || l.status === activeStatus;
      const matchSource = !sourceFilter || l.source === sourceFilter;
      return matchSearch && matchStatus && matchSource;
    });

    return [...base].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'company')    cmp = safeStr(a.company).localeCompare(safeStr(b.company), 'he');
      if (sortField === 'status')     cmp = safeStr(a.status).localeCompare(safeStr(b.status), 'he');
      if (sortField === 'budget')     cmp = safeNum(a.budget) - safeNum(b.budget);
      if (sortField === 'aiScore')    cmp = safeNum(a.aiScore)    - safeNum(b.aiScore);
      if (sortField === 'lastUpdate') cmp = parseDate(a.lastUpdate) - parseDate(b.lastUpdate);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [leads, search, activeStatus, sourceFilter, sortField, sortDir]);

  // ── CSV Export ───────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ['חברה', 'איש קשר', 'טלפון', 'מייל', 'סטטוס', 'תקציב', 'מקור', 'ציון AI'];
    const rows = filtered.map(l => [
      safeStr(l.company), safeStr(l.contactName), safeStr(l.phone), safeStr(l.email),
      safeStr(l.status), safeNum(l.budget),
      safeStr(l.source), safeNum(l.aiScore),
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'leads.csv'; a.click();
    onToast?.('קובץ CSV יוצא בהצלחה', 'success');
  };

  // ── Selection ────────────────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleSelectAll = () =>
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)));
  const clearSelection  = () => { setSelected(new Set()); setBulkStatus(''); };
  const applyBulkStatus = () => {
    if (!bulkStatus || selected.size === 0) return;
    onBulkStatusChange?.([...selected], bulkStatus as LeadStatus);
    clearSelection();
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {emailLead && <EmailModal lead={emailLead} onClose={() => setEmailLead(null)} />}

      {/* Upcoming Tasks */}
      {upcomingTasks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div
            className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
            onClick={() => setTasksExpanded(v => !v)}
          >
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${tasksExpanded ? '' : '-rotate-90'}`} />
            <div className="flex items-center gap-3">
              <span className="bg-red-500 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">{upcomingTasks.length} דחופות</span>
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
                    <span className="text-slate-500 text-xs">📅 {task.date} · {task.time}</span>
                    <span className="text-orange-600 font-medium">🏢 {task.company}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800">{task.description}</span>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); onTaskComplete?.(task.lead.id, task.id); }}
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard label="לידים VIP"      value={hotLeads}      sub="תקציב ₪15K+"        icon={<Flame      size={20} className="text-red-500"    />} color="red"    percent={Math.round(hotLeads / Math.max(leads.length, 1) * 100)} />
        <KpiCard label="לקוחות פעילים" value={activeClients} sub={`${conversionRate}% המרה`} icon={<CheckCircle2 size={20} className="text-green-500"  />} color="green"  percent={conversionRate} />
        <KpiCard label="בתהליך"         value={onboarding}    sub="פרויקטים פעילים"     icon={<Rocket     size={20} className="text-orange-500"  />} color="orange" percent={Math.round(onboarding / Math.max(leads.length, 1) * 100)} />
        <KpiCard label={'סה"כ לידים'}   value={leads.length}  sub={`${newLeads} חדשים`} icon={<Users      size={20} className="text-slate-600"  />} color="indigo" percent={100} />
      </div>

      {/* Search + Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 space-y-2.5">

        {/* Row 1 */}
        <div className="flex items-center gap-2">

          {/* ── SEARCH INPUT ─────────────────────────────────────────────────── */}
          <div className="relative flex-1">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="חיפוש..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => {
                // stop EVERY key from bubbling to window listeners
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === 'Escape') e.preventDefault();
              }}
              className="w-full pr-8 pl-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-slate-50"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                tabIndex={-1}
              >
                <X size={13} />
              </button>
            )}
          </div>

          <span className="text-xs text-slate-400 whitespace-nowrap hidden sm:block">{filtered.length} לידים</span>

          <button
            type="button"
            onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1 px-2.5 py-2 rounded-lg border text-xs transition-colors flex-shrink-0 ${
              showFilters || sourceFilter
                ? 'bg-neutral-100 border-neutral-300 text-neutral-800'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Filter size={12} />
            <span className="hidden sm:inline">פילטרים</span>
            {sourceFilter && <span className="w-1.5 h-1.5 bg-black rounded-full" />}
          </button>

          <button
            type="button"
            onClick={exportCSV}
            className="hidden sm:flex items-center gap-1 px-2.5 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 text-xs text-slate-500 transition-colors"
          >
            <Download size={12} />CSV
          </button>
        </div>

        {/* Row 2: Status tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <StatusTab label="הכל" count={leads.length} active={activeStatus === 'הכל'} onClick={() => setActiveStatus('הכל')} primary />
          {ALL_STATUSES.map(s => (
            <StatusTab key={s} label={s} count={statusCounts[s] ?? 0} active={activeStatus === s} onClick={() => setActiveStatus(activeStatus === s ? 'הכל' : s)} />
          ))}
        </div>

        {/* Advanced filters */}
        {showFilters && (
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400 font-medium">מקור:</span>
              {['', ...ALL_SOURCES].map(s => (
                <button type="button" key={s} onClick={() => setSourceFilter(s)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${sourceFilter === s ? 'bg-black text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {s || 'הכל'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bulk Action Bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4 border border-slate-700">
          <button type="button" onClick={clearSelection} className="text-slate-400 hover:text-white text-xs transition-colors">✕ ביטול</button>
          <div className="w-px h-5 bg-slate-700" />
          <span className="text-sm font-bold text-white">{selected.size} נבחרו</span>
          <div className="w-px h-5 bg-slate-700" />
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value as LeadStatus | '')}
            className="bg-slate-800 text-white text-sm rounded-lg px-3 py-1.5 border border-slate-600 focus:outline-none cursor-pointer">
            <option value="">שנה סטטוס...</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" onClick={applyBulkStatus} disabled={!bulkStatus}
            className="bg-white hover:bg-neutral-100 disabled:opacity-40 text-black text-sm px-4 py-1.5 rounded-lg font-medium transition-colors">
            החל
          </button>
          <div className="w-px h-5 bg-slate-700" />
          <button type="button" onClick={exportCSV} className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors">
            <Download size={13} /> ייצא
          </button>
        </div>
      )}

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400">
            <Search size={28} className="mx-auto mb-2 text-slate-200" />
            לא נמצאו לידים
          </div>
        ) : filtered.map(lead => (
          <div key={lead.id} onClick={() => onLeadClick(lead)}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 active:bg-slate-50 transition-colors cursor-pointer">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 flex-shrink-0">
                <button type="button" onClick={e => { e.stopPropagation(); setEmailLead(lead); }}
                  className="p-1.5 rounded-lg bg-neutral-100 text-neutral-700">
                  <Mail size={13} />
                </button>
                <AiScoreBadge score={safeNum(lead.aiScore)} />
              </div>
              <div className="flex-1 text-right">
                <div className="font-semibold text-slate-800 text-sm leading-tight">{safeStr(lead.company)}</div>
                <div className="text-xs text-slate-400">{safeStr(lead.contactName)}</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {safeNum(lead.budget) > 0 && (
                  <span className={`text-xs font-bold ${safeNum(lead.budget) >= 15000 ? 'text-emerald-600' : 'text-slate-600'}`}>
                    ₪{safeNum(lead.budget).toLocaleString()}{safeNum(lead.budget) >= 15000 ? ' 🌟' : ''}
                  </span>
                )}
                <span className="text-xs text-slate-400">{safeStr(lead.lastUpdate)}</span>
              </div>
              <StatusBadge status={lead.status} />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-gradient-to-l from-slate-50 to-white">
              <th className="px-4 py-3 w-10">
                <input type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="rounded accent-indigo-600 cursor-pointer" />
              </th>
              <SortTh label="חברה"        field="company"    current={sortField} dir={sortDir} onSort={handleSort} />
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500">שם איש קשר</th>
              <SortTh label="סטטוס"       field="status"     current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh label="תקציב"       field="budget"     current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh label="עדכון אחרון" field="lastUpdate" current={sortField} dir={sortDir} onSort={handleSort} />
              <SortTh label="ציון AI"     field="aiScore"    current={sortField} dir={sortDir} onSort={handleSort} />
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
            ) : filtered.map((lead, i) => {
              const isSelected = selected.has(lead.id);
              const budget = safeNum(lead.budget);
              return (
                <tr key={lead.id}
                  className={`border-b border-slate-50 transition-colors cursor-pointer ${
                    isSelected ? 'bg-neutral-100 hover:bg-neutral-200'
                    : i % 2 === 0 ? 'hover:bg-neutral-50'
                    : 'bg-slate-50/30 hover:bg-neutral-50'
                  }`}
                  onClick={() => onLeadClick(lead)}
                >
                  <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)}
                      className="rounded accent-indigo-600 cursor-pointer" />
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`}>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-800 text-sm">{safeStr(lead.company)}</span>
                        {lead.waitingContent && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold leading-none">תוכן</span>}
                      </div>
                      <span className="text-xs text-slate-400">{safeStr(lead.source)}</span>
                    </div>
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-sm text-slate-700`}>{safeStr(lead.contactName)}</td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`}><StatusBadge status={lead.status} /></td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-sm`}>
                    {budget > 0
                      ? <span className={`font-medium ${budget >= 15000 ? 'text-emerald-600' : 'text-slate-700'}`}>₪{budget.toLocaleString()}{budget >= 15000 && ' 🌟'}</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'} text-sm text-slate-500`}>{safeStr(lead.lastUpdate)}</td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`}><AiScoreBadge score={safeNum(lead.aiScore)} /></td>
                  <td className={`px-4 ${compact ? 'py-2' : 'py-3'}`} onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => onNoteClick(lead)}  title="שימור"  className="text-xs text-slate-600 hover:text-black px-2 py-1 rounded hover:bg-neutral-100 transition-colors"><Star        size={12} /></button>
                      <button type="button" onClick={() => onLeadClick(lead)}  title="פרטים"  className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded hover:bg-slate-100 transition-colors"><MessageSquare size={12} /></button>
                      <button type="button" onClick={() => setEmailLead(lead)} title="מייל"   className="text-xs text-slate-500 hover:text-black px-2 py-1 rounded hover:bg-neutral-100 transition-colors"><Mail         size={12} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function AiScoreBadge({ score }: { score: number }) {
  if (!score) return <span className="text-slate-300 text-xs">—</span>;
  const color = score >= 75 ? 'text-green-600 bg-green-50' : score >= 50 ? 'text-orange-500 bg-orange-50' : 'text-slate-500 bg-slate-100';
  return <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{score}%</span>;
}

function KpiCard({ label, value, sub, icon, color, percent }: {
  label: string; value: number; sub: string; icon: React.ReactNode;
  color: 'red' | 'green' | 'orange' | 'indigo'; percent: number;
  // indigo → slate for Ray brand
}) {
  const barColor  = { red: 'bg-red-400', green: 'bg-green-400', orange: 'bg-orange-400', indigo: 'bg-slate-500' }[color];
  const textColor = { red: 'text-red-600', green: 'text-green-600', orange: 'text-orange-600', indigo: 'text-slate-700' }[color];
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
  label: string; field: SortField; current: SortField; dir: SortDir; onSort: (f: SortField) => void;
}) {
  const active = current === field;
  return (
    <th className={`text-right px-4 py-3 text-xs font-semibold cursor-pointer select-none transition-colors ${active ? 'text-black' : 'text-slate-500 hover:text-slate-700'}`}
      onClick={() => onSort(field)}>
      <div className="flex items-center gap-1 justify-end">
        {active ? (dir === 'asc' ? <ArrowUp size={12} className="text-black" /> : <ArrowDown size={12} className="text-black" />) : <ArrowUpDown size={12} className="text-slate-300" />}
        {label}
      </div>
    </th>
  );
}

function StatusTab({ label, count, active, onClick, primary }: {
  label: string; count: number; active: boolean; onClick: () => void; primary?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
        active && primary ? 'bg-black text-white' :
        active            ? 'bg-neutral-100 text-black border border-neutral-300' :
                            'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}>
      {label}
      <span className={`font-bold ${active && primary ? 'text-white' : active ? 'text-black' : 'text-slate-500'}`}>{count}</span>
    </button>
  );
}
