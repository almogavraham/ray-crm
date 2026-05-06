import { useState, useMemo, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  CheckCircle2, Circle, Trash2, Building2, Search,
  AlertTriangle, CalendarClock, CalendarCheck, Plus, X,
  Clock, Flag, ChevronDown, Target, Users, LayoutList,
  Kanban, ChevronRight, User, StickyNote, ArrowRight,
} from 'lucide-react';
import type { Lead, StandaloneTask, Task, TaskPriority, TeamMember } from '../types';

/* ─── date helpers ────────────────────────────────────────────────────────── */
function parseDate(raw: string): Date {
  if (!raw) return new Date('invalid');
  // ISO format: YYYY-MM-DD  ✓
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return new Date(raw + 'T00:00:00');
  // DD/MM/YYYY  (Hebrew locale dates stored by older code)
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy)
    return new Date(`${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}T00:00:00`);
  // MM/DD/YYYY  (US locale)
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy)
    return new Date(`${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}T00:00:00`);
  // timestamp / ISO full
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  return new Date('invalid');
}
function todayMidnight() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function isToday(d: Date)    { return !isNaN(d.getTime()) && d.toDateString() === new Date().toDateString(); }
function isTomorrow(d: Date) { const t = new Date(); t.setDate(t.getDate()+1); return !isNaN(d.getTime()) && d.toDateString() === t.toDateString(); }
function isThisWeek(d: Date) { const t = todayMidnight(); const e = new Date(t); e.setDate(t.getDate()+7); return !isNaN(d.getTime()) && d > t && d <= e && !isToday(d) && !isTomorrow(d); }
function isOverdue(d: Date)  { return !isNaN(d.getTime()) && d < todayMidnight(); }
function formatDate(raw: string): string {
  try {
    const d = parseDate(raw);
    if (isNaN(d.getTime())) return raw || '—';
    return d.toLocaleDateString('he-IL', { weekday:'short', day:'numeric', month:'short' });
  } catch { return raw || '—'; }
}
function daysUntil(raw: string): number {
  const d = parseDate(raw);
  if (isNaN(d.getTime())) return 999; // push unknown dates to "later"
  return Math.ceil((d.getTime() - todayMidnight().getTime()) / 86400000);
}

/* ─── constants ───────────────────────────────────────────────────────────── */
const PRIORITY_META: Record<TaskPriority, { label: string; pill: string; dot: string; border: string; icon: string }> = {
  high:   { label:'דחוף',   pill:'bg-red-100 text-red-700 border border-red-200',        dot:'bg-red-500',    border:'border-r-red-500',    icon:'🔴' },
  medium: { label:'בינוני', pill:'bg-amber-100 text-amber-700 border border-amber-200',  dot:'bg-amber-400',  border:'border-r-amber-400',  icon:'🟠' },
  low:    { label:'נמוך',   pill:'bg-blue-100 text-blue-700 border border-blue-200',     dot:'bg-blue-400',   border:'border-r-blue-400',   icon:'🔵' },
};

/* ─── unified task type ───────────────────────────────────────────────────── */
interface UnifiedTask {
  id: string;
  description: string;
  notes?: string;
  date: string;
  time: string;
  priority: TaskPriority;
  completed: boolean;
  completedAt?: string;
  assignedTo: string;
  assignedBy?: string;
  lead?: Lead;
  isStandalone: boolean;
  standaloneId?: string; // original StandaloneTask id
}

type ViewMode      = 'list' | 'board';
type OwnerFilter   = 'all' | 'mine' | 'delegated';
type DateFilter    = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';
type PriorityFlt   = 'all' | TaskPriority;

/* ─── TasksProps ──────────────────────────────────────────────────────────── */
interface TasksProps {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  standaloneTask: StandaloneTask[];
  onLeadClick: (lead: Lead) => void;
  onLeadTaskComplete: (leadId: string, taskId: string) => void;
  onLeadTaskDelete: (leadId: string, taskId: string) => void;
  onLeadAddTask: (leadId: string, task: Task) => void;
  onStandaloneAdd: (task: StandaloneTask) => void;
  onStandaloneComplete: (taskId: string) => void;
  onStandaloneDelete: (taskId: string) => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function Tasks({
  leads, team, currentUser, standaloneTask,
  onLeadClick, onLeadTaskComplete, onLeadTaskDelete, onLeadAddTask,
  onStandaloneAdd, onStandaloneComplete, onStandaloneDelete,
}: TasksProps) {

  const [viewMode,     setViewMode]     = useState<ViewMode>('list');
  const [ownerFilter,  setOwnerFilter]  = useState<OwnerFilter>('all');
  const [dateFilter,   setDateFilter]   = useState<DateFilter>('all');
  const [priorityFlt,  setPriorityFlt]  = useState<PriorityFlt>('all');
  const [search,       setSearch]       = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);

  /* ── Unified task list ────────────────────────────────────────────────── */
  const all = useMemo<UnifiedTask[]>(() => {
    const leadTasks: UnifiedTask[] = leads.flatMap(lead =>
      lead.tasks.map(t => ({
        id:          `lead-${lead.id}-${t.id}`,
        description: t.description,
        notes:       t.notes,
        date:        t.date,
        time:        t.time,
        priority:    (t.priority || 'medium') as TaskPriority,
        completed:   t.completed,
        completedAt: t.completedAt,
        assignedTo:  t.assignedTo || lead.assignedTo || currentUser,
        assignedBy:  t.assignedBy,
        lead,
        isStandalone: false,
      }))
    );
    const sTasks: UnifiedTask[] = standaloneTask.map(t => ({
      id:           `standalone-${t.id}`,
      description:  t.description,
      notes:        t.notes,
      date:         t.date,
      time:         t.time,
      priority:     t.priority,
      completed:    t.completed,
      completedAt:  t.completedAt,
      assignedTo:   t.assignedTo,
      assignedBy:   t.assignedBy,
      lead:         leads.find(l => l.id === t.leadId),
      isStandalone: true,
      standaloneId: t.id,
    }));
    return [...leadTasks, ...sTasks];
  }, [leads, standaloneTask, currentUser]);

  /* ── Stats ────────────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const open = all.filter(t => !t.completed);
    const mine = open.filter(t => t.assignedTo === currentUser || !t.assignedTo);
    return {
      overdue:        open.filter(t => isOverdue(parseDate(t.date))).length,
      todayCount:     open.filter(t => isToday(parseDate(t.date))).length,
      delegated:      open.filter(t => t.assignedTo && t.assignedTo !== currentUser).length,
      completedToday: all.filter(t => t.completed && isToday(parseDate(t.completedAt || t.date))).length,
      total:          open.length,
      mine:           mine.length,
      completionRate: all.length ? Math.round(all.filter(t => t.completed).length / all.length * 100) : 0,
    };
  }, [all, currentUser]);

  /* ── Filtered ─────────────────────────────────────────────────────────── */
  const filtered = useMemo<UnifiedTask[]>(() => {
    return all.filter(t => {
      const d = parseDate(t.date);
      // owner filter
      if (ownerFilter === 'mine'      && t.assignedTo !== currentUser && t.assignedTo) return false;
      if (ownerFilter === 'delegated' && (t.assignedTo === currentUser || !t.assignedTo)) return false;
      // date filter
      if (dateFilter === 'today'     && (t.completed || !isToday(d)))   return false;
      if (dateFilter === 'overdue'   && (t.completed || !isOverdue(d))) return false;
      if (dateFilter === 'upcoming'  && (t.completed || isOverdue(d) || isToday(d))) return false;
      if (dateFilter === 'completed' && !t.completed)                    return false;
      // priority filter
      if (priorityFlt !== 'all' && t.priority !== priorityFlt) return false;
      // search
      if (search) {
        const q = search.toLowerCase();
        const matchDesc = t.description.toLowerCase().includes(q);
        const matchComp = t.lead?.company?.toLowerCase().includes(q) ?? false;
        const matchAsgn = t.assignedTo?.toLowerCase().includes(q) ?? false;
        if (!matchDesc && !matchComp && !matchAsgn) return false;
      }
      return true;
    });
  }, [all, ownerFilter, dateFilter, priorityFlt, search, currentUser]);

  /* ── Groups for list view ─────────────────────────────────────────────── */
  const groups = useMemo(() => {
    const buckets: Record<string, { label: string; emoji: string; urgent?: boolean; highlight?: boolean; tasks: UnifiedTask[] }> = {
      overdue:   { label:'פג תוקף',    emoji:'🚨', urgent:true,    tasks:[] },
      today:     { label:'היום',        emoji:'⚡', highlight:true, tasks:[] },
      tomorrow:  { label:'מחר',         emoji:'📅',                tasks:[] },
      thisWeek:  { label:'השבוע',       emoji:'📆',                tasks:[] },
      later:     { label:'מאוחר יותר',  emoji:'🕐',                tasks:[] },
      completed: { label:'הושלמו',      emoji:'✅',                tasks:[] },
    };
    filtered.forEach(t => {
      if (t.completed)          { buckets.completed.tasks.push(t); return; }
      const d = parseDate(t.date);
      if (isOverdue(d))         buckets.overdue.tasks.push(t);
      else if (isToday(d))      buckets.today.tasks.push(t);
      else if (isTomorrow(d))   buckets.tomorrow.tasks.push(t);
      else if (isThisWeek(d))   buckets.thisWeek.tasks.push(t);
      else                      buckets.later.tasks.push(t);
    });
    const byTime = (a: UnifiedTask, b: UnifiedTask) => a.time.localeCompare(b.time);
    const byDate = (a: UnifiedTask, b: UnifiedTask) => a.date.localeCompare(b.date);
    const byPrio = (a: UnifiedTask, b: UnifiedTask) => {
      const p = { high:0, medium:1, low:2 };
      return p[a.priority] - p[b.priority];
    };
    buckets.overdue.tasks.sort((a,b) => byPrio(a,b) || byDate(a,b));
    buckets.today.tasks.sort((a,b) => byPrio(a,b) || byTime(a,b));
    buckets.tomorrow.tasks.sort((a,b) => byTime(a,b));
    buckets.thisWeek.tasks.sort(byDate);
    buckets.later.tasks.sort(byDate);
    buckets.completed.tasks.sort((a,b) => b.date.localeCompare(a.date));
    return Object.entries(buckets)
      .filter(([,g]) => g.tasks.length > 0)
      .map(([key,g]) => ({ key, ...g }));
  }, [filtered]);

  /* ── Board columns ────────────────────────────────────────────────────── */
  const boardCols = useMemo(() => {
    const open = filtered.filter(t => !t.completed);
    const overdueTodayOpen = open.filter(t => isOverdue(parseDate(t.date)) || isToday(parseDate(t.date)));
    const upcomingOpen     = open.filter(t => !isOverdue(parseDate(t.date)) && !isToday(parseDate(t.date)));
    const done             = filtered.filter(t => t.completed);
    const byPrio = (a: UnifiedTask, b: UnifiedTask) => ({ high:0, medium:1, low:2 }[a.priority] - { high:0, medium:1, low:2 }[b.priority]);
    return [
      { key:'upcoming', label:'לביצוע',      emoji:'📋', color:'slate',  tasks: upcomingOpen.sort(byPrio) },
      { key:'active',   label:'היום / דחוף',  emoji:'⚡', color:'amber',  tasks: overdueTodayOpen.sort(byPrio) },
      { key:'done',     label:'הושלמו',       emoji:'✅', color:'green',  tasks: done.slice(0, 20) },
    ];
  }, [filtered]);

  /* ── Complete handler ─────────────────────────────────────────────────── */
  const handleComplete = (task: UnifiedTask) => {
    setCompletingId(task.id);
    setTimeout(() => {
      if (task.isStandalone && task.standaloneId) {
        onStandaloneComplete(task.standaloneId);
      } else if (task.lead) {
        const rawId = task.id.replace(`lead-${task.lead.id}-`, '');
        onLeadTaskComplete(task.lead.id, rawId);
      }
      setCompletingId(null);
    }, 350);
  };

  const handleDelete = (task: UnifiedTask) => {
    if (task.isStandalone && task.standaloneId) {
      onStandaloneDelete(task.standaloneId);
    } else if (task.lead) {
      const rawId = task.id.replace(`lead-${task.lead.id}-`, '');
      onLeadTaskDelete(task.lead.id, rawId);
    }
  };

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <>
      <div className="space-y-4">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <button onClick={() => setViewMode('list')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                <LayoutList size={14} /> רשימה
              </button>
              <button onClick={() => setViewMode('board')}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${viewMode === 'board' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                <Kanban size={14} /> לוח
              </button>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm active:scale-95"
            >
              <Plus size={15} /> משימה חדשה
            </button>
          </div>
          <div className="text-right">
            <h1 className="text-xl font-bold text-slate-800">משימות</h1>
            <p className="text-sm text-slate-400">{stats.total} פתוחות · {stats.mine} שלי</p>
          </div>
        </div>

        {/* ── Stats Row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard value={stats.overdue}    label="פגי תוקף"     icon={<AlertTriangle size={18}/>}  scheme={stats.overdue>0?'red':'slate'}  onClick={() => { setDateFilter('overdue'); setOwnerFilter('all'); }} />
          <StatCard value={stats.todayCount} label="להיום"         icon={<CalendarClock size={18}/>}  scheme="amber"  onClick={() => { setDateFilter('today');   setOwnerFilter('all'); }} />
          <StatCard value={stats.delegated}  label="הקצאתי לצוות"  icon={<Users size={18}/>}          scheme="indigo" onClick={() => { setOwnerFilter('delegated'); setDateFilter('all'); }} />
          <StatCard value={stats.completedToday} label="הושלמו היום" icon={<CalendarCheck size={18}/>} scheme="green" onClick={() => { setDateFilter('completed'); setOwnerFilter('all'); }} />
          {/* Gauge */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm col-span-2 md:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Target size={15} className="text-indigo-600" />
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-indigo-600">{stats.completionRate}%</div>
                <div className="text-xs text-slate-400">השלמה</div>
              </div>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-all duration-700"
                style={{ width:`${stats.completionRate}%` }} />
            </div>
            <div className="text-[11px] text-slate-400 text-right mt-1.5">
              {all.filter(t=>t.completed).length} / {all.length} משימות
            </div>
          </div>
        </div>

        {/* ── Filter Bar ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="text" placeholder="חיפוש לפי משימה, חברה, שם..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 text-right bg-slate-50" />
            {search && <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={13}/></button>}
          </div>

          <div className="flex flex-wrap gap-2 items-center justify-between">
            {/* Owner filter */}
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
              {([
                { k:'all',       l:'הכל',            icon:<LayoutList size={12}/> },
                { k:'mine',      l:'שלי',             icon:<User size={12}/> },
                { k:'delegated', l:'הצוות שלי',       icon:<Users size={12}/> },
              ] as { k:OwnerFilter; l:string; icon:ReactNode }[]).map(o => (
                <button key={o.k} onClick={() => setOwnerFilter(o.k)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${ownerFilter === o.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {o.icon}{o.l}
                </button>
              ))}
            </div>

            {/* Date filter */}
            <div className="flex items-center gap-1 flex-wrap">
              {([
                { k:'all',       l:'כל הזמנים' },
                { k:'overdue',   l:'פגי תוקף',  badge:stats.overdue > 0 ? stats.overdue : undefined, urgent:true },
                { k:'today',     l:'היום',       badge:stats.todayCount > 0 ? stats.todayCount : undefined },
                { k:'upcoming',  l:'קרובות' },
                { k:'completed', l:'הושלמו' },
              ] as { k:DateFilter; l:string; badge?:number; urgent?:boolean }[]).map(tab => (
                <button key={tab.k} onClick={() => setDateFilter(tab.k)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    dateFilter === tab.k
                      ? tab.urgent ? 'bg-red-600 text-white shadow-sm' : 'bg-slate-900 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}>
                  {tab.l}
                  {tab.badge !== undefined && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center ${dateFilter === tab.k ? 'bg-white/25 text-white' : tab.urgent ? 'bg-red-100 text-red-700' : 'bg-white text-slate-600 border border-slate-200'}`}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Priority filter */}
          <div className="flex items-center gap-2 justify-end pt-1 border-t border-slate-100">
            <span className="text-xs text-slate-400">עדיפות:</span>
            {([
              { k:'all',    l:'הכל' },
              { k:'high',   l:'🔴 דחוף' },
              { k:'medium', l:'🟠 בינוני' },
              { k:'low',    l:'🔵 נמוך' },
            ] as { k:PriorityFlt; l:string }[]).map(p => (
              <button key={p.k} onClick={() => setPriorityFlt(p.k)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  priorityFlt === p.k ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}>
                {p.l}
              </button>
            ))}
          </div>
        </div>

        {/* ── BOARD VIEW ───────────────────────────────────────────────── */}
        {viewMode === 'board' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {boardCols.map(col => (
              <BoardColumn key={col.key} col={col}
                onComplete={handleComplete} onDelete={handleDelete}
                onLeadClick={onLeadClick} completingId={completingId}
                currentUser={currentUser}
              />
            ))}
          </div>
        )}

        {/* ── LIST VIEW ────────────────────────────────────────────────── */}
        {viewMode === 'list' && (
          <>
            {groups.length === 0 ? (
              <EmptyState dateFilter={dateFilter} ownerFilter={ownerFilter} onCreateTask={() => setShowCreate(true)} />
            ) : (
              groups.map(g => (
                <TaskGroup key={g.key} group={g}
                  onComplete={handleComplete} onDelete={handleDelete}
                  onLeadClick={onLeadClick} completingId={completingId}
                  currentUser={currentUser}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Create Task Modal */}
      {showCreate && (
        <CreateTaskModal
          leads={leads} team={team} currentUser={currentUser}
          onClose={() => setShowCreate(false)}
          onAddStandalone={task => { onStandaloneAdd(task); setShowCreate(false); }}
          onAddToLead={(leadId, task) => { onLeadAddTask(leadId, task); setShowCreate(false); }}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE TASK MODAL
═══════════════════════════════════════════════════════════════════════════ */
function CreateTaskModal({ leads, team, currentUser, onClose, onAddStandalone, onAddToLead }: {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  onClose: () => void;
  onAddStandalone: (t: StandaloneTask) => void;
  onAddToLead: (leadId: string, task: Task) => void;
}) {
  const [desc,          setDesc]         = useState('');
  const [notes,         setNotes]        = useState('');
  const [date,          setDate]         = useState(() => new Date().toISOString().split('T')[0]);
  const [time,          setTime]         = useState('09:00');
  const [priority,      setPriority]     = useState<TaskPriority>('medium');
  const [assignedTo,    setAssignedTo]   = useState(currentUser);
  const [selectedLead,  setSelectedLead] = useState<Lead | null>(null);
  const [leadSearch,    setLeadSearch]   = useState('');
  const [showLeadDrop,  setShowLeadDrop] = useState(false);
  const [showNotes,     setShowNotes]    = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowLeadDrop(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filteredLeads = useMemo(() =>
    leads.filter(l =>
      l.company.toLowerCase().includes(leadSearch.toLowerCase()) ||
      l.contactName.toLowerCase().includes(leadSearch.toLowerCase())
    ).slice(0, 8), [leads, leadSearch]);

  const handleAdd = () => {
    if (!desc.trim() || !date) return;
    if (selectedLead) {
      const task: Task = {
        id: Date.now().toString(),
        description: desc.trim(),
        notes: notes.trim() || undefined,
        date, time,
        completed: false,
        priority,
        assignedTo,
        assignedBy: currentUser,
      };
      onAddToLead(selectedLead.id, task);
    } else {
      const task: StandaloneTask = {
        id: Date.now().toString(),
        description: desc.trim(),
        notes: notes.trim() || undefined,
        date, time,
        priority,
        completed: false,
        assignedTo,
        assignedBy: currentUser,
        leadId: undefined,
        createdAt: new Date().toISOString(),
      };
      onAddStandalone(task);
    }
  };

  const membersList = [
    { name: currentUser, label: `${currentUser} (אני)` },
    ...team.filter(m => m.name !== currentUser).map(m => ({ name: m.name, label: m.name })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden" dir="rtl">

        {/* Header */}
        <div className="bg-gradient-to-l from-slate-900 to-slate-800 px-6 py-5 flex items-center justify-between">
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
            <X size={18} />
          </button>
          <div className="text-right">
            <h2 className="text-white font-bold text-lg leading-none">משימה חדשה</h2>
            <p className="text-slate-400 text-xs mt-1">הוסף משימה ושייך לחבר צוות</p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Plus size={20} className="text-white" />
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">מה צריך לעשות? *</label>
            <textarea rows={2} placeholder="תיאור המשימה..."
              value={desc} onChange={e => setDesc(e.target.value)}
              autoFocus
              className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-300 bg-slate-50 placeholder-slate-400 resize-none" />
          </div>

          {/* Notes toggle */}
          <div>
            {!showNotes ? (
              <button onClick={() => setShowNotes(true)}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                <StickyNote size={13} /> הוסף פרטים נוספים
              </button>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <StickyNote size={13} className="text-slate-400" /> פרטים נוספים
                </label>
                <textarea rows={3} placeholder="הוראות, קישורים, הערות..."
                  value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-300 bg-slate-50 placeholder-slate-400 resize-none" />
              </div>
            )}
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <User size={13} className="text-slate-400" /> הקצה ל
            </label>
            <div className="flex flex-wrap gap-2">
              {membersList.map(m => (
                <button key={m.name} onClick={() => setAssignedTo(m.name)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all ${
                    assignedTo === m.name
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 text-slate-600 hover:border-slate-400 bg-white'
                  }`}>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${assignedTo === m.name ? 'bg-white/20 text-white' : 'bg-indigo-100 text-indigo-700'}`}>
                    {m.name[0]?.toUpperCase()}
                  </div>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional lead */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
              <Building2 size={13} className="text-slate-400" /> שייך לליד <span className="font-normal text-slate-400">(אופציונלי)</span>
            </label>
            <div className="relative" ref={dropRef}>
              <div onClick={() => setShowLeadDrop(true)}
                className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 cursor-text transition-all ${showLeadDrop ? 'border-slate-400 ring-2 ring-slate-100' : 'border-slate-200 hover:border-slate-300'} bg-slate-50`}>
                <Search size={13} className="text-slate-400 flex-shrink-0" />
                <input type="text"
                  value={selectedLead ? selectedLead.company : leadSearch}
                  onChange={e => { setLeadSearch(e.target.value); setSelectedLead(null); setShowLeadDrop(true); }}
                  onFocus={() => setShowLeadDrop(true)}
                  placeholder="חיפוש ליד..."
                  className="flex-1 bg-transparent text-sm text-right focus:outline-none placeholder-slate-400" />
                {selectedLead
                  ? <button onClick={e => { e.stopPropagation(); setSelectedLead(null); setLeadSearch(''); }} className="text-slate-400 hover:text-slate-600"><X size={13}/></button>
                  : <ChevronDown size={13} className="text-slate-400" />}
              </div>
              {showLeadDrop && !selectedLead && (
                <div className="absolute top-full mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg z-10 overflow-hidden max-h-44 overflow-y-auto">
                  {filteredLeads.length === 0
                    ? <div className="px-4 py-3 text-sm text-slate-400 text-center">לא נמצאו לידים</div>
                    : filteredLeads.map(lead => (
                      <button key={lead.id} onClick={() => { setSelectedLead(lead); setLeadSearch(''); setShowLeadDrop(false); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 transition-colors">
                        <span className="text-xs text-slate-400">{lead.status}</span>
                        <div className="text-right">
                          <div className="text-sm font-medium text-slate-800">{lead.company}</div>
                          <div className="text-xs text-slate-400">{lead.contactName}</div>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1 justify-end">שעה <Clock size={11}/></label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5 text-right">תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-slate-50" />
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5 justify-end"><Flag size={13} className="text-slate-400"/>עדיפות</label>
            <div className="flex gap-2">
              {(['high','medium','low'] as TaskPriority[]).map(p => {
                const m = PRIORITY_META[p];
                const active = priority === p;
                return (
                  <button key={p} onClick={() => setPriority(p)}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all border-2 ${
                      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400 bg-white'
                    }`}>
                    {m.icon} {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          {assignedTo !== currentUser && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex items-center gap-2 justify-end">
              <div className="text-sm text-indigo-800 text-right">
                <span className="font-semibold">{assignedTo}</span> יראה משימה זו בדף המשימות שלו
              </div>
              <ArrowRight size={14} className="text-indigo-500 flex-shrink-0" />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors">
              ביטול
            </button>
            <button onClick={handleAdd} disabled={!desc.trim() || !date}
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm">
              <Plus size={15} /> צור משימה
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   BOARD COLUMN
═══════════════════════════════════════════════════════════════════════════ */
const COL_COLORS: Record<string, { header: string; bg: string; border: string; badge: string }> = {
  upcoming: { header:'text-slate-700', bg:'bg-slate-50',   border:'border-slate-200', badge:'bg-slate-200 text-slate-700' },
  active:   { header:'text-amber-700', bg:'bg-amber-50',   border:'border-amber-200', badge:'bg-amber-200 text-amber-800' },
  done:     { header:'text-green-700', bg:'bg-green-50',   border:'border-green-200', badge:'bg-green-200 text-green-800' },
};

function BoardColumn({ col, onComplete, onDelete, onLeadClick, completingId, currentUser }: {
  col: { key: string; label: string; emoji: string; color: string; tasks: UnifiedTask[] };
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
  currentUser: string;
}) {
  const c = COL_COLORS[col.key];
  return (
    <div className={`rounded-xl border ${c.border} overflow-hidden`}>
      <div className={`px-4 py-3 flex items-center justify-between ${c.bg} border-b ${c.border}`}>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.badge}`}>{col.tasks.length}</span>
        <div className={`flex items-center gap-2 font-semibold text-sm ${c.header}`}>
          <span>{col.label}</span>
          <span className="text-base">{col.emoji}</span>
        </div>
      </div>
      <div className={`min-h-[120px] p-2 space-y-2 ${c.bg}`}>
        {col.tasks.length === 0
          ? <div className="py-8 text-center text-slate-400 text-xs">אין משימות</div>
          : col.tasks.map(task => (
            <BoardTaskCard key={task.id} task={task}
              onComplete={onComplete} onDelete={onDelete} onLeadClick={onLeadClick}
              isCompleting={completingId === task.id} currentUser={currentUser} />
          ))
        }
      </div>
    </div>
  );
}

function BoardTaskCard({ task, onComplete, onDelete, onLeadClick, isCompleting, currentUser }: {
  task: UnifiedTask;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  isCompleting: boolean;
  currentUser: string;
}) {
  const pm = PRIORITY_META[task.priority];
  const days = daysUntil(task.date);
  const overdue = !task.completed && days < 0;
  return (
    <div className={`bg-white rounded-xl border border-r-4 ${pm.border} shadow-sm p-3 transition-all ${isCompleting ? 'opacity-40 scale-[0.98]' : 'hover:shadow-md'} ${task.completed ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <button onClick={() => !task.completed && onComplete(task)} disabled={task.completed || isCompleting}
          className={`flex-shrink-0 mt-0.5 transition-colors ${task.completed ? 'text-green-500 cursor-default' : 'text-slate-300 hover:text-slate-600'}`}>
          {task.completed ? <CheckCircle2 size={16}/> : <Circle size={16}/>}
        </button>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${task.completed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
            {task.description}
          </p>
          {task.notes && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{task.notes}</p>}
        </div>
        {!task.completed && (
          <button onClick={() => onDelete(task)} className="text-slate-200 hover:text-red-400 transition-colors flex-shrink-0">
            <Trash2 size={13}/>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
        <div className="flex items-center gap-1">
          {task.lead && (
            <button onClick={() => task.lead && onLeadClick(task.lead)}
              className="flex items-center gap-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 px-2 py-0.5 rounded text-[10px] font-medium text-slate-500 transition-colors">
              <Building2 size={9}/> {task.lead.company}
            </button>
          )}
          {task.assignedTo && task.assignedTo !== currentUser && (
            <span className="flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded text-[10px] font-medium text-indigo-600">
              <User size={9}/> {task.assignedTo}
            </span>
          )}
        </div>
        <span className={`text-[11px] font-medium ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
          {task.time} · {overdue ? `פג לפני ${Math.abs(days)}י'` : days === 0 ? 'היום' : days === 1 ? 'מחר' : formatDate(task.date)}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASK GROUP (List view)
═══════════════════════════════════════════════════════════════════════════ */
function TaskGroup({ group, onComplete, onDelete, onLeadClick, completingId, currentUser }: {
  group: { key: string; label: string; emoji: string; urgent?: boolean; highlight?: boolean; tasks: UnifiedTask[] };
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
  currentUser: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const wrap = group.urgent ? 'border-red-200 bg-gradient-to-br from-red-50 to-white'
    : group.highlight ? 'border-amber-200 bg-gradient-to-br from-amber-50 to-white'
    : 'border-slate-200 bg-white';
  const headerText = group.urgent ? 'text-red-700' : group.highlight ? 'text-amber-700' : 'text-slate-700';
  const badge = group.urgent ? 'bg-red-100 text-red-700' : group.highlight ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600';

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${wrap}`}>
      <button onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-black/[0.02] transition-colors">
        <div className="flex items-center gap-2">
          <ChevronRight size={15} className={`text-slate-400 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}/>
          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${badge}`}>{group.tasks.length}</span>
        </div>
        <div className={`flex items-center gap-2 text-sm font-semibold ${headerText}`}>
          <span>{group.label}</span>
          <span className="text-base">{group.emoji}</span>
        </div>
      </button>
      {!collapsed && (
        <div className="divide-y divide-slate-100 border-t border-slate-100/80">
          {group.tasks.map(task => (
            <TaskRow key={task.id} task={task}
              onComplete={onComplete} onDelete={onDelete} onLeadClick={onLeadClick}
              isCompleting={completingId === task.id} isUrgent={!!group.urgent}
              currentUser={currentUser}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASK ROW
═══════════════════════════════════════════════════════════════════════════ */
function TaskRow({ task, onComplete, onDelete, onLeadClick, isCompleting, isUrgent, currentUser }: {
  task: UnifiedTask;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  isCompleting: boolean;
  isUrgent: boolean;
  currentUser: string;
}) {
  const pm = PRIORITY_META[task.priority];
  const [showNotes, setShowNotes] = useState(false);
  const isDelegate = task.assignedTo && task.assignedTo !== currentUser;

  return (
    <div className={`group transition-all duration-300 ${isCompleting ? 'opacity-40 scale-[0.99]' : ''} ${task.completed ? 'opacity-55' : 'hover:bg-slate-50/70'}`}>
      <div className={`flex items-center gap-3 px-5 py-3.5 border-r-4 ${pm.border}`}>
        {/* Checkbox */}
        <button onClick={() => !task.completed && onComplete(task)} disabled={task.completed || isCompleting}
          className={`flex-shrink-0 transition-all duration-200 ${
            task.completed ? 'text-green-500 cursor-default'
            : isCompleting ? 'text-green-400 animate-pulse'
            : isUrgent ? 'text-red-300 hover:text-red-500 hover:scale-110'
            : 'text-slate-300 hover:text-slate-600 hover:scale-110'
          }`}>
          {task.completed ? <CheckCircle2 size={20}/> : isCompleting ? <CheckCircle2 size={20} className="animate-pulse"/> : <Circle size={20}/>}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0 text-right">
          <div className={`text-sm font-medium leading-snug ${task.completed ? 'line-through text-slate-400' : isUrgent ? 'text-slate-900' : 'text-slate-800'}`}>
            {task.description}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 justify-end flex-wrap">
            <span className="text-xs text-slate-400">{task.time}</span>
            <span className="text-slate-200 text-xs">·</span>
            <span className={`text-xs font-medium ${isUrgent && !task.completed ? 'text-red-500' : 'text-slate-400'}`}>
              {formatDate(task.date)}
            </span>
            {task.notes && (
              <button onClick={() => setShowNotes(v => !v)}
                className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-indigo-500 transition-colors">
                <StickyNote size={10}/> פרטים
              </button>
            )}
          </div>
          {showNotes && task.notes && (
            <div className="mt-1.5 text-xs text-slate-500 bg-slate-100 rounded-lg px-3 py-2 text-right leading-relaxed">
              {task.notes}
            </div>
          )}
        </div>

        {/* Chips */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Assignee */}
          {isDelegate && (
            <span className="flex items-center gap-1 bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded-lg text-[11px] font-semibold">
              <div className="w-4 h-4 rounded-full bg-indigo-200 flex items-center justify-center text-[9px] font-bold">
                {task.assignedTo[0]?.toUpperCase()}
              </div>
              {task.assignedTo}
            </span>
          )}
          {/* Lead */}
          {task.lead && (
            <button onClick={() => task.lead && onLeadClick(task.lead)}
              className="flex items-center gap-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 px-2.5 py-1 rounded-lg text-[11px] font-medium text-slate-600 transition-all border border-transparent hover:border-indigo-200">
              <Building2 size={10}/> {task.lead.company}
            </button>
          )}
          {/* Priority */}
          <span className={`hidden sm:flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${pm.pill}`}>
            {pm.icon} {pm.label}
          </span>
        </div>

        {/* Delete */}
        {!task.completed && (
          <button onClick={() => onDelete(task)}
            className="flex-shrink-0 text-slate-200 group-hover:text-slate-400 hover:!text-red-500 transition-colors">
            <Trash2 size={14}/>
          </button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   STAT CARD
═══════════════════════════════════════════════════════════════════════════ */
function StatCard({ value, label, icon, scheme, onClick }: {
  value: number; label: string; icon: ReactNode;
  scheme: 'red' | 'amber' | 'green' | 'slate' | 'indigo';
  onClick?: () => void;
}) {
  const C: Record<string, { bg: string; text: string; iconBg: string }> = {
    red:    { bg:'bg-red-50 border-red-100',    text:'text-red-600',    iconBg:'bg-red-100 text-red-600' },
    amber:  { bg:'bg-amber-50 border-amber-100',text:'text-amber-600',  iconBg:'bg-amber-100 text-amber-600' },
    green:  { bg:'bg-green-50 border-green-100',text:'text-green-600',  iconBg:'bg-green-100 text-green-600' },
    slate:  { bg:'bg-white border-slate-200',   text:'text-slate-400',  iconBg:'bg-slate-100 text-slate-400' },
    indigo: { bg:'bg-indigo-50 border-indigo-100',text:'text-indigo-600',iconBg:'bg-indigo-100 text-indigo-600' },
  };
  const c = C[scheme];
  return (
    <button onClick={onClick} className={`rounded-xl border p-4 shadow-sm hover:shadow-md transition-all text-right w-full ${c.bg}`}>
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.iconBg}`}>{icon}</div>
        <div className={`text-3xl font-bold ${c.text}`}>{value}</div>
      </div>
      <div className="text-xs font-medium text-slate-600">{label}</div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════════════════════════════════════ */
function EmptyState({ dateFilter, ownerFilter, onCreateTask }: {
  dateFilter: DateFilter; ownerFilter: OwnerFilter; onCreateTask: () => void;
}) {
  const map: Record<string, { emoji: string; title: string; sub: string }> = {
    'all-all':       { emoji:'🎉', title:'אין משימות פתוחות!',  sub:'כל המשימות הושלמו — עבודה מצוינת' },
    'all-mine':      { emoji:'😎', title:'אין משימות שלך',      sub:'אין משימות מוקצות אליך כרגע' },
    'all-delegated': { emoji:'👥', title:'לא הקצית משימות',     sub:'הקצה משימות לחברי הצוות' },
    'today-all':     { emoji:'☀️', title:'היום פנוי!',           sub:'אין משימות מתוכננות להיום' },
    'overdue-all':   { emoji:'✅', title:'הכל בסדר!',           sub:'אין משימות שפג תוקפן' },
    'upcoming-all':  { emoji:'📅', title:'לוח שנה נקי',         sub:'אין משימות קרובות' },
    'completed-all': { emoji:'📋', title:'עדיין לא הושלם',      sub:'לא בוצעו משימות בפילטר זה' },
  };
  const key = `${dateFilter}-${ownerFilter}`;
  const { emoji, title, sub } = map[key] || map['all-all'];
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-16 text-center shadow-sm">
      <div className="text-5xl mb-4">{emoji}</div>
      <div className="text-lg font-bold text-slate-700">{title}</div>
      <div className="text-sm text-slate-400 mt-1">{sub}</div>
      <button onClick={onCreateTask}
        className="mt-5 inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm">
        <Plus size={15}/> צור משימה חדשה
      </button>
    </div>
  );
}
