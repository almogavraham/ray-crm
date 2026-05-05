import { useState, useMemo, useRef, useEffect } from 'react';
import {
  CheckCircle2, Circle, Trash2, Building2,
  Search, ChevronRight, Target,
  AlertTriangle, CalendarClock, CalendarCheck,
  Plus, X, Clock, Flag, ChevronDown,
} from 'lucide-react';
import type { Lead, Task, TaskPriority } from '../types';

/* ─── helpers ────────────────────────────────────────────────────────────── */
function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}
function todayMidnight() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function isToday(d: Date) {
  return d.toDateString() === new Date().toDateString();
}
function isTomorrow(d: Date) {
  const t = new Date(); t.setDate(t.getDate() + 1);
  return d.toDateString() === t.toDateString();
}
function isThisWeek(d: Date) {
  const today = todayMidnight();
  const end = new Date(today); end.setDate(today.getDate() + 7);
  return d > today && d <= end && !isToday(d) && !isTomorrow(d);
}
function isOverdue(d: Date) { return d < todayMidnight(); }

function formatDate(dateStr: string) {
  try {
    return parseDate(dateStr).toLocaleDateString('he-IL', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
  } catch { return dateStr; }
}

const PRIORITY: Record<TaskPriority, { label: string; pill: string; dot: string }> = {
  high:   { label: 'דחוף',   pill: 'bg-red-100 text-red-700 border border-red-200',       dot: 'bg-red-500' },
  medium: { label: 'בינוני', pill: 'bg-amber-100 text-amber-700 border border-amber-200', dot: 'bg-amber-400' },
  low:    { label: 'נמוך',   pill: 'bg-blue-100 text-blue-700 border border-blue-200',    dot: 'bg-blue-400' },
};

/* ─── types ──────────────────────────────────────────────────────────────── */
type TaskFilter    = 'all' | 'today' | 'overdue' | 'upcoming' | 'completed';
type PriorityFlt   = 'all' | TaskPriority;

interface TaskItem extends Task { lead: Lead }

interface TasksProps {
  leads: Lead[];
  onLeadClick: (lead: Lead) => void;
  onTaskComplete: (leadId: string, taskId: string) => void;
  onTaskDelete: (leadId: string, taskId: string) => void;
  onAddTask?: (leadId: string, task: Task) => void;
}

/* ─── CreateTaskModal ────────────────────────────────────────────────────── */
function CreateTaskModal({ leads, onClose, onAdd }: {
  leads: Lead[];
  onClose: () => void;
  onAdd: (leadId: string, task: Task) => void;
}) {
  const [leadSearch, setLeadSearch]     = useState('');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [desc, setDesc]                 = useState('');
  const [date, setDate]                 = useState(() => new Date().toISOString().split('T')[0]);
  const [time, setTime]                 = useState('09:00');
  const [priority, setPriority]         = useState<TaskPriority>('medium');
  const dropdownRef                     = useRef<HTMLDivElement>(null);

  const filteredLeads = useMemo(() =>
    leads.filter(l =>
      l.company.toLowerCase().includes(leadSearch.toLowerCase()) ||
      l.contactName.toLowerCase().includes(leadSearch.toLowerCase())
    ).slice(0, 8),
    [leads, leadSearch]
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleAdd = () => {
    if (!selectedLead || !desc.trim() || !date) return;
    const task: Task = {
      id: Date.now().toString(),
      description: desc.trim(),
      date,
      time,
      completed: false,
      priority,
    };
    onAdd(selectedLead.id, task);
    onClose();
  };

  const PRIORITY_OPTS: { value: TaskPriority; label: string; active: string; idle: string }[] = [
    { value: 'high',   label: '🔴 דחוף',   active: 'bg-red-600 text-white ring-2 ring-red-300',   idle: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' },
    { value: 'medium', label: '🟠 בינוני', active: 'bg-amber-500 text-white ring-2 ring-amber-300', idle: 'bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200' },
    { value: 'low',    label: '🔵 נמוך',   active: 'bg-blue-500 text-white ring-2 ring-blue-300',  idle: 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-l from-indigo-600 to-indigo-800 px-6 py-5 flex items-center justify-between">
          <button onClick={onClose} className="text-indigo-200 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <X size={18} />
          </button>
          <div className="text-right">
            <h2 className="text-white font-bold text-lg leading-none">צור משימה חדשה</h2>
            <p className="text-indigo-200 text-xs mt-1">הוסף משימה ללקוח קיים</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Plus size={20} className="text-white" />
          </div>
        </div>

        <div className="p-6 space-y-5">

          {/* Lead selector */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 text-right">לקוח / ליד</label>
            <div className="relative" ref={dropdownRef}>
              <div
                className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 cursor-text transition-all ${
                  showDropdown ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'
                } bg-slate-50`}
                onClick={() => setShowDropdown(true)}
              >
                <Search size={14} className="text-slate-400 flex-shrink-0" />
                <input
                  type="text"
                  value={selectedLead ? selectedLead.company : leadSearch}
                  onChange={e => {
                    setLeadSearch(e.target.value);
                    setSelectedLead(null);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="חפש לקוח..."
                  className="flex-1 bg-transparent text-sm text-right focus:outline-none text-slate-800 placeholder-slate-400"
                />
                {selectedLead ? (
                  <button onClick={e => { e.stopPropagation(); setSelectedLead(null); setLeadSearch(''); }}
                    className="text-slate-400 hover:text-slate-600 transition-colors">
                    <X size={13} />
                  </button>
                ) : (
                  <ChevronDown size={14} className="text-slate-400" />
                )}
              </div>

              {showDropdown && !selectedLead && (
                <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden max-h-52 overflow-y-auto">
                  {filteredLeads.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-slate-400 text-center">לא נמצאו לקוחות</div>
                  ) : (
                    filteredLeads.map(lead => (
                      <button
                        key={lead.id}
                        onClick={() => { setSelectedLead(lead); setLeadSearch(''); setShowDropdown(false); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-indigo-50 transition-colors group"
                      >
                        <span className="text-xs text-slate-400 group-hover:text-indigo-400">{lead.status}</span>
                        <div className="text-right">
                          <div className="text-sm font-medium text-slate-800">{lead.company}</div>
                          <div className="text-xs text-slate-400">{lead.contactName}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {selectedLead && (
              <div className="mt-2 flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 justify-end">
                <div className="text-right">
                  <div className="text-sm font-semibold text-indigo-800">{selectedLead.company}</div>
                  <div className="text-xs text-indigo-500">{selectedLead.contactName}</div>
                </div>
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0">
                  <Building2 size={13} className="text-white" />
                </div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 text-right">תיאור המשימה</label>
            <textarea
              rows={2}
              placeholder="מה צריך לעשות?"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-slate-50 placeholder-slate-400 resize-none transition-all"
            />
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 text-right flex items-center gap-1 justify-end">
                שעה <Clock size={11} />
              </label>
              <input
                type="time"
                value={time}
                onChange={e => setTime(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50 transition-all"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 text-right">תאריך</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50 transition-all"
              />
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2 text-right flex items-center gap-1.5 justify-end">
              עדיפות <Flag size={13} className="text-slate-400" />
            </label>
            <div className="flex gap-2 justify-end">
              {PRIORITY_OPTS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setPriority(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                    priority === opt.value ? opt.active : opt.idle
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              ביטול
            </button>
            <button
              onClick={handleAdd}
              disabled={!selectedLead || !desc.trim() || !date}
              className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm hover:shadow-md"
            >
              <Plus size={15} />
              צור משימה
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────────────── */
export default function Tasks({ leads, onLeadClick, onTaskComplete, onTaskDelete, onAddTask }: TasksProps) {
  const [filter, setFilter]             = useState<TaskFilter>('all');
  const [priorityFlt, setPriorityFlt]   = useState<PriorityFlt>('all');
  const [search, setSearch]             = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [showCreate, setShowCreate]     = useState(false);

  /* all tasks flat */
  const all = useMemo<TaskItem[]>(
    () => leads.flatMap(lead => lead.tasks.map(t => ({ ...t, lead }))),
    [leads],
  );

  /* stats */
  const stats = useMemo(() => {
    const incomplete = all.filter(t => !t.completed);
    return {
      overdue:       incomplete.filter(t => isOverdue(parseDate(t.date))).length,
      todayCount:    incomplete.filter(t => isToday(parseDate(t.date))).length,
      completedToday:all.filter(t => t.completed && isToday(parseDate(t.date))).length,
      completionRate:all.length
        ? Math.round(all.filter(t => t.completed).length / all.length * 100) : 0,
      total:         incomplete.length,
    };
  }, [all]);

  /* filtered */
  const filtered = useMemo<TaskItem[]>(() => {
    return all.filter(t => {
      const d = parseDate(t.date);
      if (filter === 'today')     { if (t.completed || !isToday(d))   return false; }
      if (filter === 'overdue')   { if (t.completed || !isOverdue(d)) return false; }
      if (filter === 'upcoming')  { if (t.completed || isOverdue(d))  return false; }
      if (filter === 'completed') { if (!t.completed)                  return false; }
      if (priorityFlt !== 'all' && (t.priority || 'medium') !== priorityFlt) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.description.toLowerCase().includes(q) && !t.lead.company.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [all, filter, priorityFlt, search]);

  /* group by date bucket */
  const groups = useMemo(() => {
    const buckets: Record<string, { label: string; emoji: string; urgent?: boolean; highlight?: boolean; tasks: TaskItem[] }> = {
      overdue:   { label: 'פג תוקף',       emoji: '🚨', urgent: true,    tasks: [] },
      today:     { label: 'היום',           emoji: '⚡', highlight: true, tasks: [] },
      tomorrow:  { label: 'מחר',            emoji: '📅',                  tasks: [] },
      thisWeek:  { label: 'השבוע',          emoji: '📆',                  tasks: [] },
      later:     { label: 'מאוחר יותר',     emoji: '🕐',                  tasks: [] },
      completed: { label: 'הושלמו',         emoji: '✅',                  tasks: [] },
    };
    filtered.forEach(t => {
      if (t.completed)             { buckets.completed.tasks.push(t); return; }
      const d = parseDate(t.date);
      if (isOverdue(d))            buckets.overdue.tasks.push(t);
      else if (isToday(d))         buckets.today.tasks.push(t);
      else if (isTomorrow(d))      buckets.tomorrow.tasks.push(t);
      else if (isThisWeek(d))      buckets.thisWeek.tasks.push(t);
      else                         buckets.later.tasks.push(t);
    });
    const byTime = (a: TaskItem, b: TaskItem) => a.time.localeCompare(b.time);
    const byDate = (a: TaskItem, b: TaskItem) => a.date.localeCompare(b.date);
    buckets.overdue.tasks.sort(byDate);
    buckets.today.tasks.sort(byTime);
    buckets.tomorrow.tasks.sort(byTime);
    buckets.thisWeek.tasks.sort(byDate);
    buckets.later.tasks.sort(byDate);
    buckets.completed.tasks.sort((a, b) => b.date.localeCompare(a.date));

    return Object.entries(buckets)
      .filter(([, g]) => g.tasks.length > 0)
      .map(([key, g]) => ({ key, ...g }));
  }, [filtered]);

  const handleComplete = (task: TaskItem) => {
    setCompletingId(task.id);
    setTimeout(() => {
      onTaskComplete(task.lead.id, task.id);
      setCompletingId(null);
    }, 350);
  };

  return (
    <>
      <div className="space-y-5">

        {/* ─── Page Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm hover:shadow-md active:scale-95"
          >
            <Plus size={16} />
            צור משימה
          </button>
          <div className="text-right">
            <h1 className="text-xl font-bold text-slate-800">משימות</h1>
            <p className="text-sm text-slate-400">{stats.total} משימות פתוחות</p>
          </div>
        </div>

        {/* ─── Stats Row ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            value={stats.overdue}
            label="פגי תוקף"
            icon={<AlertTriangle size={20} />}
            scheme={stats.overdue > 0 ? 'red' : 'slate'}
            onClick={() => setFilter('overdue')}
          />
          <StatCard
            value={stats.todayCount}
            label="משימות להיום"
            icon={<CalendarClock size={20} />}
            scheme="amber"
            onClick={() => setFilter('today')}
          />
          <StatCard
            value={stats.completedToday}
            label="הושלמו היום"
            icon={<CalendarCheck size={20} />}
            scheme="green"
            onClick={() => setFilter('completed')}
          />
          {/* Completion gauge */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50">
                <Target size={16} className="text-indigo-600" />
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-indigo-600">{stats.completionRate}%</div>
                <div className="text-xs text-slate-400">שיעור השלמה</div>
              </div>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-green-400 transition-all duration-700"
                style={{ width: `${stats.completionRate}%` }}
              />
            </div>
            <div className="text-xs text-slate-500 text-right">
              {all.filter(t => t.completed).length} / {all.length} משימות
            </div>
          </div>
        </div>

        {/* ─── Filter Bar ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="חיפוש לפי משימה או חברה..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 text-right bg-slate-50"
            />
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {([
              { key: 'all',       label: 'הכל',        count: stats.total },
              { key: 'overdue',   label: 'פגי תוקף',   count: stats.overdue },
              { key: 'today',     label: 'היום',        count: stats.todayCount },
              { key: 'upcoming',  label: 'קרובות',      count: undefined },
              { key: 'completed', label: 'הושלמו',      count: undefined },
            ] as { key: TaskFilter; label: string; count?: number }[]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  filter === tab.key
                    ? tab.key === 'overdue' ? 'bg-red-600 text-white shadow-sm'
                    : tab.key === 'today'   ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`min-w-[18px] text-center font-bold text-[10px] px-1 py-0.5 rounded-full ${
                    filter === tab.key ? 'bg-white/25 text-white'
                    : tab.key === 'overdue' && (tab.count ?? 0) > 0 ? 'bg-red-100 text-red-700'
                    : 'bg-white text-slate-500 border border-slate-200'
                  }`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Priority filter */}
          <div className="flex items-center gap-2 justify-end border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-400 ml-1">עדיפות:</span>
            {([
              { k: 'all',    l: 'הכל',    cls: 'bg-slate-100 text-slate-600 hover:bg-slate-200', act: 'bg-indigo-600 text-white' },
              { k: 'high',   l: '🔴 דחוף',  cls: 'bg-red-50 text-red-600 hover:bg-red-100',     act: 'bg-red-600 text-white' },
              { k: 'medium', l: '🟠 בינוני', cls: 'bg-amber-50 text-amber-600 hover:bg-amber-100', act: 'bg-amber-500 text-white' },
              { k: 'low',    l: '🔵 נמוך',   cls: 'bg-blue-50 text-blue-600 hover:bg-blue-100',  act: 'bg-blue-500 text-white' },
            ] as { k: PriorityFlt; l: string; cls: string; act: string }[]).map(p => (
              <button
                key={p.k}
                onClick={() => setPriorityFlt(p.k)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  priorityFlt === p.k ? p.act + ' shadow-sm' : p.cls
                }`}
              >
                {p.l}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Task Groups ─────────────────────────────────────────────────── */}
        {groups.length === 0 ? (
          <EmptyState filter={filter} onCreateTask={() => setShowCreate(true)} />
        ) : (
          groups.map(g => (
            <TaskGroup
              key={g.key}
              group={g}
              onComplete={handleComplete}
              onDelete={t => onTaskDelete(t.lead.id, t.id)}
              onLeadClick={onLeadClick}
              completingId={completingId}
            />
          ))
        )}
      </div>

      {/* Create Task Modal */}
      {showCreate && (
        <CreateTaskModal
          leads={leads}
          onClose={() => setShowCreate(false)}
          onAdd={(leadId, task) => {
            if (onAddTask) onAddTask(leadId, task);
            setShowCreate(false);
          }}
        />
      )}
    </>
  );
}

/* ─── StatCard ────────────────────────────────────────────────────────────── */
function StatCard({ value, label, icon, scheme, onClick }: {
  value: number; label: string; icon: React.ReactNode;
  scheme: 'red' | 'amber' | 'green' | 'slate' | 'indigo';
  onClick?: () => void;
}) {
  const colors: Record<string, { bg: string; text: string; iconBg: string }> = {
    red:   { bg: 'bg-red-50 border-red-100',    text: 'text-red-600',   iconBg: 'bg-red-100 text-red-600' },
    amber: { bg: 'bg-amber-50 border-amber-100', text: 'text-amber-600', iconBg: 'bg-amber-100 text-amber-600' },
    green: { bg: 'bg-green-50 border-green-100', text: 'text-green-600', iconBg: 'bg-green-100 text-green-600' },
    slate: { bg: 'bg-white border-slate-200',    text: 'text-slate-400', iconBg: 'bg-slate-100 text-slate-400' },
    indigo:{ bg: 'bg-white border-indigo-100',   text: 'text-indigo-600',iconBg: 'bg-indigo-100 text-indigo-600' },
  };
  const c = colors[scheme];
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 shadow-sm hover:shadow-md transition-all text-right w-full ${c.bg}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${c.iconBg}`}>
          {icon}
        </div>
        <div className={`text-3xl font-bold ${c.text}`}>{value}</div>
      </div>
      <div className="text-sm font-medium text-slate-700">{label}</div>
    </button>
  );
}

/* ─── TaskGroup ───────────────────────────────────────────────────────────── */
function TaskGroup({ group, onComplete, onDelete, onLeadClick, completingId }: {
  group: { key: string; label: string; emoji: string; urgent?: boolean; highlight?: boolean; tasks: TaskItem[] };
  onComplete: (t: TaskItem) => void;
  onDelete: (t: TaskItem) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const wrap = group.urgent
    ? 'border-red-200 bg-gradient-to-br from-red-50 to-white'
    : group.highlight
    ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'
    : 'border-slate-200 bg-white';

  const headerText = group.urgent ? 'text-red-700'
    : group.highlight ? 'text-amber-700' : 'text-slate-700';

  const badge = group.urgent ? 'bg-red-100 text-red-700'
    : group.highlight ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${wrap}`}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-black/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            size={15}
            className={`text-slate-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
          />
          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${badge}`}>
            {group.tasks.length}
          </span>
        </div>
        <div className={`flex items-center gap-2 text-sm font-semibold ${headerText}`}>
          <span>{group.label}</span>
          <span className="text-base">{group.emoji}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="divide-y divide-slate-100 border-t border-slate-100/80">
          {group.tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onComplete={onComplete}
              onDelete={onDelete}
              onLeadClick={onLeadClick}
              isCompleting={completingId === task.id}
              isUrgent={!!group.urgent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── TaskRow ─────────────────────────────────────────────────────────────── */
function TaskRow({ task, onComplete, onDelete, onLeadClick, isCompleting, isUrgent }: {
  task: TaskItem;
  onComplete: (t: TaskItem) => void;
  onDelete: (t: TaskItem) => void;
  onLeadClick: (l: Lead) => void;
  isCompleting: boolean;
  isUrgent: boolean;
}) {
  const priority = (task.priority || 'medium') as TaskPriority;
  const pc = PRIORITY[priority];

  return (
    <div
      className={`group flex items-center gap-3 px-5 py-3.5 transition-all duration-300 ${
        isCompleting ? 'opacity-40 scale-[0.98]' : ''
      } ${task.completed ? 'opacity-55' : 'hover:bg-slate-50/70'}`}
    >
      {/* Checkbox */}
      <button
        onClick={() => !task.completed && onComplete(task)}
        disabled={task.completed || isCompleting}
        className={`flex-shrink-0 transition-all duration-200 ${
          task.completed
            ? 'text-green-500 cursor-default'
            : isUrgent
            ? 'text-red-300 hover:text-red-500 hover:scale-110'
            : 'text-slate-300 hover:text-indigo-500 hover:scale-110'
        }`}
      >
        {task.completed
          ? <CheckCircle2 size={20} />
          : isCompleting
          ? <CheckCircle2 size={20} className="text-green-400 animate-pulse" />
          : <Circle size={20} />
        }
      </button>

      {/* Priority dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${pc.dot} ${task.completed ? 'opacity-40' : ''}`} />

      {/* Main content */}
      <div className="flex-1 min-w-0 text-right">
        <div className={`text-sm font-medium leading-snug ${
          task.completed ? 'line-through text-slate-400' : isUrgent ? 'text-slate-900' : 'text-slate-800'
        }`}>
          {task.description}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 justify-end">
          <span className="text-xs text-slate-400">{task.time}</span>
          <span className="text-slate-300 text-xs">·</span>
          <span className={`text-xs font-medium ${
            isUrgent && !task.completed ? 'text-red-500' : 'text-slate-400'
          }`}>
            {formatDate(task.date)}
          </span>
        </div>
      </div>

      {/* Company chip */}
      <button
        onClick={() => onLeadClick(task.lead)}
        className="flex items-center gap-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 transition-all flex-shrink-0 border border-transparent hover:border-indigo-200 hover:shadow-sm"
      >
        <Building2 size={11} />
        <span className="max-w-[90px] truncate">{task.lead.company}</span>
      </button>

      {/* Priority badge */}
      <span className={`hidden sm:inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${pc.pill}`}>
        {pc.label}
      </span>

      {/* Delete — visible on hover */}
      {!task.completed && (
        <button
          onClick={() => onDelete(task)}
          className="flex-shrink-0 text-slate-200 group-hover:text-slate-400 hover:!text-red-500 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

/* ─── EmptyState ──────────────────────────────────────────────────────────── */
function EmptyState({ filter, onCreateTask }: { filter: TaskFilter; onCreateTask: () => void }) {
  const map: Record<TaskFilter, { emoji: string; title: string; sub: string }> = {
    all:       { emoji: '🎉', title: 'אין משימות פתוחות!', sub: 'כל המשימות הושלמו — עבודה מצוינת' },
    today:     { emoji: '☀️', title: 'היום פנוי!',         sub: 'אין משימות מתוכננות להיום' },
    overdue:   { emoji: '✅', title: 'הכל בסדר!',          sub: 'אין משימות שפג תוקפן' },
    upcoming:  { emoji: '📅', title: 'לוח שנה נקי',        sub: 'אין משימות קרובות' },
    completed: { emoji: '📋', title: 'עדיין לא הושלם',     sub: 'לא בוצעו משימות בפילטר הזה' },
  };
  const { emoji, title, sub } = map[filter];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-16 text-center shadow-sm">
      <div className="text-5xl mb-4">{emoji}</div>
      <div className="text-lg font-bold text-slate-700">{title}</div>
      <div className="text-sm text-slate-400 mt-1">{sub}</div>
      <button
        onClick={onCreateTask}
        className="mt-5 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm"
      >
        <Plus size={15} />
        צור משימה חדשה
      </button>
    </div>
  );
}
