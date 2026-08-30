import { useState, useMemo, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  CheckCircle2, Circle, Trash2, Building2, Search,
  AlertTriangle, CalendarClock, CalendarCheck, Plus, X,
  Clock, Flag, ChevronDown, Target, Users, LayoutList,
  Kanban, ChevronRight, User, StickyNote, ArrowRight,
  Pencil, CalendarPlus, Check, Sparkles,
  MessageCircle, Mail, Square, CheckSquare,
} from 'lucide-react';
import type { Lead, StandaloneTask, Task, TaskPriority, KanbanStatus, TeamMember, TaskType } from '../types';

// Activity-type metadata (icons/labels) — shared by the create/edit modals and task cards.
const TASK_TYPE_META: Record<TaskType, { label: string; emoji: string }> = {
  call:     { label: 'שיחה',    emoji: '📞' },
  email:    { label: 'מייל',    emoji: '✉️' },
  whatsapp: { label: 'וואטסאפ', emoji: '💬' },
  meeting:  { label: 'פגישה',   emoji: '📅' },
  followup: { label: 'מעקב',    emoji: '🔄' },
  proposal: { label: 'הצעה',    emoji: '📄' },
  other:    { label: 'כללי',    emoji: '📌' },
};
const TASK_TYPE_ORDER: TaskType[] = ['call','email','whatsapp','meeting','followup','proposal','other'];
import { useLang } from '../contexts/LangContext';
import TasksAIPanel from '../components/TasksAIPanel';
import TasksCalendar from '../components/TasksCalendar';
import { useTheme } from '../contexts/ThemeContext';

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

/* ─── dark priority styles ────────────────────────────────────────────────── */
const DARK_PRIORITY: Record<TaskPriority, { bg: string; text: string; border: string; borderRight: string }> = {
  high:   { bg:'rgba(239,68,68,0.18)',   text:'#f87171', border:'rgba(239,68,68,0.3)',   borderRight:'#f87171' },
  medium: { bg:'rgba(245,158,11,0.15)',  text:'#fbbf24', border:'rgba(245,158,11,0.28)', borderRight:'#fbbf24' },
  low:    { bg:'rgba(99,102,241,0.15)',  text:'#818cf8', border:'rgba(99,102,241,0.28)', borderRight:'#818cf8' },
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
  leadTaskOriginalId?: string; // original task id (without the "lead-{leadId}-" prefix)
  kanbanStatus?: KanbanStatus;
  type?: TaskType;
}

type ViewMode      = 'list' | 'board' | 'calendar';
type OwnerFilter   = 'all' | 'mine' | 'delegated';
type DateFilter    = 'all' | 'overdue' | 'today' | 'upcoming' | 'completed';
type PriorityFlt   = 'all' | TaskPriority;

/* ─── Google Calendar URL builder ────────────────────────────────────────── */
function buildGCalUrl(task: { description: string; date: string; time: string; notes?: string; lead?: Lead }): string {
  try {
    const [year, month, day] = task.date.split('-').map(Number);
    const [hour, min] = task.time.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startStr = `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(min)}00`;
    const endHour = Math.min(hour + 1, 23);
    const endStr   = `${year}${pad(month)}${pad(day)}T${pad(endHour)}${pad(min)}00`;
    const title    = task.lead ? `${task.description} — ${task.lead.company}` : task.description;
    const details  = task.notes ?? '';
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(details)}`;
  } catch { return 'https://calendar.google.com/calendar/r'; }
}

/* ─── Outlook Calendar URL builder ───────────────────────────────────────── */
function buildOutlookUrl(task: { description: string; date: string; time: string; notes?: string; lead?: Lead }): string {
  try {
    const start = new Date(`${task.date}T${task.time || '09:00'}:00`);
    const end   = new Date(start.getTime() + 60 * 60000);
    const title = task.lead ? `${task.description} — ${task.lead.company}` : task.description;
    const p = new URLSearchParams({
      path: '/calendar/action/compose', rru: 'addevent',
      subject: title,
      startdt: start.toISOString(),
      enddt: end.toISOString(),
      ...(task.notes ? { body: task.notes } : {}),
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${p.toString()}`;
  } catch { return 'https://outlook.office.com/calendar'; }
}

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
  onStandaloneEdit: (task: StandaloneTask) => void;
  onLeadTaskEdit: (leadId: string, task: Task) => void;
  onPageChange?: (page: string) => void;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */
export default function Tasks({
  leads, team, currentUser, standaloneTask,
  onLeadClick, onLeadTaskComplete, onLeadTaskDelete, onLeadAddTask,
  onStandaloneAdd, onStandaloneComplete, onStandaloneDelete, onStandaloneEdit, onLeadTaskEdit, onPageChange,
  onToast,
}: TasksProps) {
  const { t } = useLang();
  const { isDark, c } = useTheme();

  const [viewMode,     setViewMode]     = useState<ViewMode>('board');
  const [ownerFilter,  setOwnerFilter]  = useState<OwnerFilter>('all');
  const [dateFilter,   setDateFilter]   = useState<DateFilter>('all');
  const [priorityFlt,  setPriorityFlt]  = useState<PriorityFlt>('all');
  const [search,       setSearch]       = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editingTask,  setEditingTask]  = useState<UnifiedTask | null>(null);
  const [selectMode,   setSelectMode]   = useState(false);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [focusMode,    setFocusMode]    = useState(false);

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
        leadTaskOriginalId: t.id,
        kanbanStatus: t.kanbanStatus,
        type: t.type,
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
      kanbanStatus: t.kanbanStatus,
      type: t.type,
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
    };
  }, [all, currentUser]);

  const weekStart = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0,0,0,0); return d; }, []);
  const weekTasks = useMemo(() => all.filter(t => { const d = parseDate(t.date); return !isNaN(d.getTime()) && d >= weekStart; }), [all, weekStart]);
  const weekDone = useMemo(() => weekTasks.filter(t => t.completed).length, [weekTasks]);
  const completionRate = weekTasks.length ? Math.round(weekDone / weekTasks.length * 100) : 0;

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
      // focus mode: today + overdue only (open tasks)
      if (focusMode && !t.completed && !isOverdue(d) && !isToday(d)) return false;
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
  }, [all, ownerFilter, dateFilter, priorityFlt, search, currentUser, focusMode]);

  /* ── Kanban status resolver (must be before groups) ─────────────────── */
  const getKanbanCol = (t: UnifiedTask): KanbanStatus => {
    if (t.kanbanStatus) return t.kanbanStatus;
    if (t.completed)    return 'done';
    return 'todo';
  };

  /* ── Groups for list view (kanban-status based) ───────────────────────── */
  const groups = useMemo(() => {
    const statusGroups: { key: string; label: string; emoji: string; accent: string; tasks: UnifiedTask[] }[] = [
      { key: 'todo',       label: 'לביצוע',  emoji: '📋', accent: '#6366f1', tasks: [] },
      { key: 'inprogress', label: 'בתהליך',  emoji: '⚡', accent: '#f97316', tasks: [] },
      { key: 'waiting',    label: 'ממתין ללקוח', emoji: '⏳', accent: '#eab308', tasks: [] },
      { key: 'done',       label: 'הושלם',   emoji: '✅', accent: '#10b981', tasks: [] },
      { key: 'cancelled',  label: 'בוטל',    emoji: '❌', accent: '#64748b', tasks: [] },
    ];
    filtered.forEach(t => {
      const col = getKanbanCol(t);
      const g = statusGroups.find(g => g.key === col);
      if (g) g.tasks.push(t);
    });
    const byPrio = (a: UnifiedTask, b: UnifiedTask) => ({ high:0, medium:1, low:2 }[a.priority] - { high:0, medium:1, low:2 }[b.priority]);
    statusGroups.forEach(g => g.tasks.sort(byPrio));
    return statusGroups.filter(g => g.tasks.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const kanbanCols: { key: KanbanStatus; label: string; emoji: string; accent: string; headerBg: string; colBg: string; count: number; tasks: UnifiedTask[] }[] = useMemo(() => {
    const byPrio = (a: UnifiedTask, b: UnifiedTask) => ({ high:0, medium:1, low:2 }[a.priority] - { high:0, medium:1, low:2 }[b.priority]);
    const cols: KanbanStatus[] = ['todo','inprogress','waiting','done','cancelled'];
    return cols.map(col => {
      const tasks = all.filter(t => getKanbanCol(t) === col).sort(byPrio);
      const meta: Record<KanbanStatus, { label: string; emoji: string; accent: string; headerBg: string; colBg: string }> = {
        todo:        { label:'לביצוע',   emoji:'📋', accent:'#6366f1', headerBg:'rgba(99,102,241,0.12)',  colBg:'rgba(99,102,241,0.04)' },
        inprogress:  { label:'בתהליך',   emoji:'⚡', accent:'#f97316', headerBg:'rgba(249,115,22,0.12)',  colBg:'rgba(249,115,22,0.04)' },
        waiting:     { label:'ממתין ללקוח', emoji:'⏳', accent:'#eab308', headerBg:'rgba(234,179,8,0.12)', colBg:'rgba(234,179,8,0.04)' },
        done:        { label:'הושלם',    emoji:'✅', accent:'#10b981', headerBg:'rgba(16,185,129,0.12)',   colBg:'rgba(16,185,129,0.04)' },
        cancelled:   { label:'בוטל',    emoji:'❌', accent:'#64748b', headerBg:'rgba(100,116,139,0.1)',   colBg:'rgba(100,116,139,0.03)' },
      };
      return { key: col, ...meta[col], tasks, count: tasks.length };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

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

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBatchComplete = () => {
    filtered.filter(t => selected.has(t.id) && !t.completed).forEach(t => handleComplete(t));
    setSelected(new Set());
    setSelectMode(false);
  };

  const handleBatchDelete = () => {
    filtered.filter(t => selected.has(t.id)).forEach(t => handleDelete(t));
    setSelected(new Set());
    setSelectMode(false);
  };

  const handleEdit = (task: UnifiedTask) => {
    setEditingTask(task); // open for ALL tasks, not just standalone
  };

  const handleEditSave = (updated: StandaloneTask, leadId?: string, leadTask?: Task) => {
    if (leadId && leadTask) {
      onLeadTaskEdit(leadId, leadTask);
    } else {
      onStandaloneEdit(updated);
    }
    setEditingTask(null);
  };

  /* ── Kanban drag-and-drop handler ────────────────────────────────────── */
  const handleKanbanMove = (task: UnifiedTask, targetCol: KanbanStatus) => {
    const currentCol = getKanbanCol(task);
    if (currentCol === targetCol) return;

    if (task.isStandalone && task.standaloneId) {
      const orig = standaloneTask.find(t => t.id === task.standaloneId);
      if (!orig) return;
      const updated: StandaloneTask = {
        ...orig,
        kanbanStatus: targetCol,
        completed: targetCol === 'done',
        completedAt: targetCol === 'done' ? new Date().toISOString() : undefined,
      };
      onStandaloneEdit(updated);
    } else if (task.lead && task.leadTaskOriginalId) {
      const updatedTask: Task = {
        id: task.leadTaskOriginalId,
        description: task.description,
        notes: task.notes,
        date: task.date,
        time: task.time,
        priority: task.priority,
        completed: targetCol === 'done',
        completedAt: targetCol === 'done' ? new Date().toISOString() : undefined,
        assignedTo: task.assignedTo,
        assignedBy: task.assignedBy,
        kanbanStatus: targetCol,
      };
      onLeadTaskEdit(task.lead.id, updatedTask);
    }
  };

  /* ── Quick-add per kanban column ─────────────────────────────────────── */
  const handleQuickAdd = (status: KanbanStatus, description: string) => {
    const task: StandaloneTask = {
      id: Date.now().toString(),
      description,
      date: new Date().toISOString().split('T')[0],
      time: '09:00',
      priority: 'medium',
      completed: status === 'done',
      completedAt: status === 'done' ? new Date().toISOString() : undefined,
      assignedTo: currentUser,
      assignedBy: currentUser,
      createdAt: new Date().toISOString(),
      kanbanStatus: status,
    };
    onStandaloneAdd(task);
  };

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <>
      <div
        className="-mx-4 md:-mx-6 -mt-4 md:-mt-6 -mb-4 md:-mb-6 p-4 md:p-6 space-y-4"
        style={{
          background: c.pageBg,
          backgroundImage: c.pageBgImage,
          backgroundSize: c.pageBgSize,
          minHeight: 'calc(100vh - 56px)',
        }}
      >

        {/* ── AI task assistant (natural-language creation + morning briefing) ── */}
        <TasksAIPanel
          leads={leads}
          openTasks={all.filter(t => !t.completed).map(t => ({
            description: t.description, date: t.date, priority: t.priority,
            completed: t.completed, leadCompany: t.lead?.company,
          }))}
          currentUser={currentUser}
          onCreateTask={onStandaloneAdd}
          onToast={onToast}
        />

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* View toggle */}
            <div
              className="flex overflow-hidden rounded-xl"
              style={{ background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}
            >
              <button onClick={() => setViewMode('list')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                style={viewMode === 'list'
                  ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white' }
                  : { color: c.textMuted }}>
                <LayoutList size={14} /> רשימה
              </button>
              <button onClick={() => setViewMode('board')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                style={viewMode === 'board'
                  ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: c.textPrimary }
                  : { color: c.textMuted }}>
                <Kanban size={14} /> לוח
              </button>
              <button onClick={() => setViewMode('calendar')}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors"
                style={viewMode === 'calendar'
                  ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
                  : { color: c.textMuted }}>
                <CalendarClock size={14} /> לוח שנה
              </button>
            </div>
            <button
              onClick={() => setFocusMode(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all"
              style={focusMode
                ? { background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.45)', color: '#f87171' }
                : { background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', color: 'rgba(255,255,255,0.5)' }}
              title="הצג רק משימות דחופות והיום">
              ⚡ {focusMode ? 'מצב מיקוד פעיל' : 'מצב מיקוד'}
            </button>
            <button
              onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all"
              style={selectMode
                ? { background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.5)', color: '#818cf8' }
                : { background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', color: 'rgba(255,255,255,0.5)' }}>
              <CheckSquare size={13} /> {selectMode ? 'בטל בחירה' : 'בחר'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}
            >
              <Plus size={15} /> {t('tasks.new')}
            </button>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 justify-end flex-wrap">
              <h1 className="text-xl font-bold" style={{ color: c.textPrimary }}>{t('tasks.title')}</h1>
              {stats.overdue > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
                  style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}>
                  🔴 {stats.overdue} פגות תוקף
                </span>
              )}
            </div>
            <p className="text-sm" style={{ color: c.textMuted }}>{stats.total} פתוחות · {stats.mine} שלי</p>
          </div>
        </div>

        {/* ── Stats Row ────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard value={stats.overdue}    label={t('tasks.overdue')}    icon={<AlertTriangle size={18}/>}  scheme={stats.overdue>0?'red':'slate'}  onClick={() => { setDateFilter('overdue'); setOwnerFilter('all'); }} />
          <StatCard value={stats.todayCount} label={t('tasks.today')}     icon={<CalendarClock size={18}/>}  scheme="amber"  onClick={() => { setDateFilter('today');   setOwnerFilter('all'); }} />
          <StatCard value={stats.delegated}  label="הקצאתי לצוות"          icon={<Users size={18}/>}          scheme="indigo" onClick={() => { setOwnerFilter('delegated'); setDateFilter('all'); }} />
          <StatCard value={stats.completedToday} label={t('tasks.completed')} icon={<CalendarCheck size={18}/>} scheme="green" onClick={() => { setDateFilter('completed'); setOwnerFilter('all'); }} />
          {/* Gauge */}
          <div
            className="rounded-xl p-4 col-span-2 md:col-span-1"
            style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(99,102,241,0.2)' }}>
                <Target size={15} style={{ color: c.accentText }} />
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold" style={{ color: c.accentText }}>{completionRate}%</div>
                <div className="text-xs" style={{ color: c.textMuted }}>השלמה השבוע</div>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: c.subtleBg }}>
              <div className="h-2 rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-all duration-700"
                style={{ width:`${completionRate}%` }} />
            </div>
            <div className="text-[11px] text-right mt-1.5" style={{ color: c.textMuted }}>
              {weekDone} / {weekTasks.length} השבוע
            </div>
          </div>
        </div>

        {/* ── Filter Bar ───────────────────────────────────────────────── */}
        <div
          className="rounded-xl p-4 space-y-3"
          style={{ background: 'rgba(10,15,30,0.88)', border: '1px solid rgba(99,102,241,0.2)', backdropFilter: 'blur(16px)' }}
        >
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: c.textMuted }} />
            <input type="text" placeholder="חיפוש לפי משימה, חברה, שם..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 rounded-lg text-sm focus:outline-none text-right"
              style={{
                background: c.subtleBg,
                border: `1px solid ${c.cardBorder}`,
                color: c.textPrimary,
              }}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: c.textMuted }}>
                <X size={13}/>
              </button>
            )}
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-start sm:items-center justify-between">
            {/* Owner filter */}
            <div className="flex items-center gap-1 p-1 rounded-xl overflow-x-auto" dir="ltr" style={{ background: c.subtleBg }}>
              {([
                { k:'all',       l:'הכל',            icon:<LayoutList size={12}/> },
                { k:'mine',      l:'שלי',             icon:<User size={12}/> },
                ...(team.length > 1 ? [{ k:'delegated' as OwnerFilter, l:'הצוות שלי', icon:<Users size={12}/> }] : []),
              ] as { k:OwnerFilter; l:string; icon:ReactNode }[]).map(o => (
                <button key={o.k} onClick={() => setOwnerFilter(o.k)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={ownerFilter === o.k
                    ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.4)', color: c.accentText }
                    : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                  style={dateFilter === tab.k
                    ? tab.urgent
                      ? { background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }
                      : { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: '1px solid transparent', color: c.textPrimary }
                    : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                  {tab.l}
                  {tab.badge !== undefined && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                      style={dateFilter === tab.k
                        ? { background: 'rgba(255,255,255,0.2)', color: c.textPrimary }
                        : tab.urgent
                          ? { background: 'rgba(239,68,68,0.2)', color: '#f87171' }
                          : { background: 'rgba(255,255,255,0.1)', color: c.textSecondary }}>
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Priority filter */}
          <div className="flex items-center gap-2 justify-end pt-1" style={{ borderTop: `1px solid ${c.divider}` }}>
            <span className="text-xs" style={{ color: c.textMuted }}>עדיפות:</span>
            {([
              { k:'all',    l:'הכל' },
              { k:'high',   l:'🔴 דחוף' },
              { k:'medium', l:'🟠 בינוני' },
              { k:'low',    l:'🔵 נמוך' },
            ] as { k:PriorityFlt; l:string }[]).map(p => (
              <button key={p.k} onClick={() => setPriorityFlt(p.k)}
                className="px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                style={priorityFlt === p.k
                  ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: '1px solid transparent' }
                  : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                {p.l}
              </button>
            ))}
          </div>
        </div>

        {/* ── KANBAN BOARD VIEW ────────────────────────────────────────── */}
        {viewMode === 'board' && (
          <KanbanBoard
            cols={kanbanCols}
            onMove={handleKanbanMove}
            onComplete={handleComplete}
            onDelete={handleDelete}
            onEdit={handleEdit}
            onLeadClick={onLeadClick}
            completingId={completingId}
            currentUser={currentUser}
            onQuickAdd={handleQuickAdd}
          />
        )}

        {/* ── CALENDAR VIEW ────────────────────────────────────────────── */}
        {viewMode === 'calendar' && (
          <TasksCalendar
            tasks={all.map(t => ({
              id: t.id, description: t.description, date: t.date,
              priority: t.priority, completed: t.completed, type: t.type,
              leadCompany: t.lead?.company,
            }))}
            onTaskClick={(id) => {
              const task = all.find(t => t.id === id);
              if (task) handleEdit(task);
            }}
          />
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
                  onEdit={handleEdit}
                  onLeadClick={onLeadClick} completingId={completingId}
                  currentUser={currentUser}
                  selectMode={selectMode} selected={selected} toggleSelect={toggleSelect}
                  onQuickAdd={handleQuickAdd}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Floating batch action bar */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl"
          style={{ background: 'rgba(10,15,30,0.95)', border: '1px solid rgba(99,102,241,0.4)', backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
          <span className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>{selected.size} נבחרו</span>
          <button onClick={handleBatchComplete}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all"
            style={{ background: 'linear-gradient(135deg,#10b981,#059669)' }}>
            <CheckCircle2 size={14}/> בצע הכל
          </button>
          <button onClick={handleBatchDelete}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171' }}>
            <Trash2 size={14}/> מחק הכל
          </button>
          <button onClick={() => { setSelectMode(false); setSelected(new Set()); }}
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <X size={16}/>
          </button>
        </div>
      )}

      {/* Create Task Modal */}
      {showCreate && (
        <CreateTaskModal
          leads={leads} team={team} currentUser={currentUser}
          onClose={() => setShowCreate(false)}
          onAddStandalone={task => { onStandaloneAdd(task); setShowCreate(false); }}
          onAddToLead={(leadId, task) => { onLeadAddTask(leadId, task); setShowCreate(false); }}
        />
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <EditTaskModal
          task={editingTask}
          leads={leads} team={team} currentUser={currentUser}
          onClose={() => setEditingTask(null)}
          onSave={(updated, leadId, leadTask) => handleEditSave(updated, leadId, leadTask)}
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
  const { c } = useTheme();
  const [desc,          setDesc]         = useState('');
  const [notes,         setNotes]        = useState('');
  const [date,          setDate]         = useState(() => new Date().toISOString().split('T')[0]);
  const [time,          setTime]         = useState('09:00');
  const [priority,      setPriority]     = useState<TaskPriority>('medium');
  const [taskType,      setTaskType]     = useState<TaskType>('followup');
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
      // Strip undefined fields — Firestore rejects them
      const task: Task = {
        id: Date.now().toString(),
        description: desc.trim(),
        date, time,
        completed: false,
        priority,
        type: taskType,
        assignedTo,
        assignedBy: currentUser,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      onAddToLead(selectedLead.id, task);
    } else {
      const task: StandaloneTask = {
        id: Date.now().toString(),
        description: desc.trim(),
        date, time,
        priority,
        type: taskType,
        completed: false,
        assignedTo,
        assignedBy: currentUser,
        createdAt: new Date().toISOString(),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      onAddStandalone(task);
    }
  };

  const membersList = [
    { name: currentUser, label: `${currentUser} (אני)` },
    ...team.filter(m => m.name !== currentUser).map(m => ({ name: m.name, label: m.name })),
  ];

  const inputStyle = {
    background: c.subtleBg,
    border: `1px solid ${c.cardBorder}`,
    color: c.textPrimary,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
      <div
        className="rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg overflow-hidden max-h-[95vh] overflow-y-auto"
        dir="rtl"
        style={{ background: '#0d1526', border: '1px solid rgba(99,102,241,0.2)' }}
      >

        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between" style={{ background: 'rgba(99,102,241,0.08)', borderBottom: '1px solid rgba(99,102,241,0.2)' }}>
          <button onClick={onClose}
            className="p-1 rounded-lg transition-colors"
            style={{ color: c.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.color = '#818cf8'; e.currentTarget.style.background = 'rgba(99,102,241,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'transparent'; }}>
            <X size={18} />
          </button>
          <div className="text-right">
            <h2 className="font-bold text-lg leading-none" style={{ background: 'linear-gradient(135deg,#818cf8,#a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>משימה חדשה</h2>
            <p className="text-xs mt-1" style={{ color: c.textMuted }}>הוסף משימה ושייך לחבר צוות</p>
          </div>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}>
            <Plus size={20} className="text-white" />
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* Description */}
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: c.textSecondary }}>מה צריך לעשות? *</label>
            <textarea rows={2} placeholder="תיאור המשימה..."
              value={desc} onChange={e => setDesc(e.target.value)}
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-sm text-right focus:outline-none resize-none placeholder-slate-500"
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Notes toggle */}
          <div>
            {!showNotes ? (
              <button onClick={() => setShowNotes(true)}
                className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: c.textMuted }}
                onMouseEnter={e => e.currentTarget.style.color = '#818cf8'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
                <StickyNote size={13} /> הוסף פרטים נוספים
              </button>
            ) : (
              <div>
                <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: c.textSecondary }}>
                  <StickyNote size={13} style={{ color: c.textMuted }} /> פרטים נוספים
                </label>
                <textarea rows={3} placeholder="הוראות, קישורים, הערות..."
                  value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-sm text-right focus:outline-none resize-none placeholder-slate-500"
                  style={inputStyle}
                  onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
            )}
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: c.textSecondary }}>
              <User size={13} style={{ color: c.textMuted }} /> הקצה ל
            </label>
            <div className="flex flex-wrap gap-2">
              {membersList.map(m => (
                <button key={m.name} onClick={() => setAssignedTo(m.name)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                  style={assignedTo === m.name
                    ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', border: '2px solid transparent' }
                    : { background: c.subtleBg, border: '2px solid rgba(255,255,255,0.1)', color: c.textSecondary }}>
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={assignedTo === m.name
                      ? { background: 'rgba(255,255,255,0.2)', color: c.textPrimary }
                      : { background: 'rgba(99,102,241,0.2)', color: c.accentText }}>
                    {m.name[0]?.toUpperCase()}
                  </div>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional lead */}
          <div>
            <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: c.textSecondary }}>
              <Building2 size={13} style={{ color: c.textMuted }} /> שייך לליד <span className="font-normal" style={{ color: c.textMuted }}>(אופציונלי)</span>
            </label>
            <div className="relative" ref={dropRef}>
              <div onClick={() => setShowLeadDrop(true)}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-text transition-all"
                style={{ background: c.subtleBg, border: `1px solid ${showLeadDrop ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.1)'}` }}>
                <Search size={13} className="flex-shrink-0" style={{ color: c.textMuted }} />
                <input type="text"
                  value={selectedLead ? selectedLead.company : leadSearch}
                  onChange={e => { setLeadSearch(e.target.value); setSelectedLead(null); setShowLeadDrop(true); }}
                  onFocus={() => setShowLeadDrop(true)}
                  placeholder="חיפוש ליד..."
                  className="flex-1 bg-transparent text-sm text-right focus:outline-none placeholder-slate-500"
                  style={{ color: c.textPrimary }} />
                {selectedLead
                  ? <button onClick={e => { e.stopPropagation(); setSelectedLead(null); setLeadSearch(''); }} style={{ color: c.textMuted }}><X size={13}/></button>
                  : <ChevronDown size={13} style={{ color: c.textMuted }} />}
              </div>
              {showLeadDrop && !selectedLead && (
                <div
                  className="absolute top-full mt-1 w-full rounded-xl shadow-lg z-10 overflow-hidden max-h-44 overflow-y-auto"
                  style={{ background: 'rgba(10,15,30,0.95)', border: `1px solid ${c.cardBorder}` }}
                >
                  {filteredLeads.length === 0
                    ? <div className="px-4 py-3 text-sm text-center" style={{ color: c.textMuted }}>לא נמצאו לידים</div>
                    : filteredLeads.map(lead => (
                      <button key={lead.id} onClick={() => { setSelectedLead(lead); setLeadSearch(''); setShowLeadDrop(false); }}
                        className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
                        style={{ color: c.textPrimary }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <span className="text-xs" style={{ color: c.textMuted }}>{lead.status}</span>
                        <div className="text-right">
                          <div className="text-sm font-medium" style={{ color: c.textPrimary }}>{lead.company}</div>
                          <div className="text-xs" style={{ color: c.textMuted }}>{lead.contactName}</div>
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
              <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1 justify-end" style={{ color: c.textMuted }}>שעה <Clock size={11}/></label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
          </div>
          {/* Quick date buttons */}
          <div className="flex gap-2 justify-end mt-1">
            {[
              { label: 'היום', days: 0 },
              { label: 'מחר', days: 1 },
              { label: '+3 ימים', days: 3 },
              { label: '+7 ימים', days: 7 },
            ].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days);
              const val = d.toISOString().split('T')[0];
              return (
                <button key={label} onClick={() => setDate(val)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all"
                  style={date === val
                    ? { background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.5)', color: '#818cf8' }
                    : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Task type */}
          <div>
            <label className="block text-sm font-semibold mb-1.5 text-right" style={{ color: c.textSecondary }}>סוג משימה</label>
            <div className="flex flex-wrap gap-1.5 justify-end">
              {TASK_TYPE_ORDER.map(tp => {
                const m = TASK_TYPE_META[tp];
                const active = taskType === tp;
                return (
                  <button key={tp} onClick={() => setTaskType(tp)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={active
                      ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: '1px solid transparent' }
                      : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}>
                    {m.emoji} {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5 justify-end" style={{ color: c.textSecondary }}>
              <Flag size={13} style={{ color: c.textMuted }}/>עדיפות
            </label>
            <div className="flex gap-2">
              {(['high','medium','low'] as TaskPriority[]).map(p => {
                const m = PRIORITY_META[p];
                const dp = DARK_PRIORITY[p];
                const active = priority === p;
                return (
                  <button key={p} onClick={() => setPriority(p)}
                    className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all"
                    style={active
                      ? { background: dp.bg, color: dp.text, border: `2px solid ${dp.border}` }
                      : { background: c.subtleBg, border: '2px solid rgba(255,255,255,0.1)', color: c.textSecondary }}>
                    {m.icon} {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preview */}
          {assignedTo !== currentUser && (
            <div className="rounded-xl px-4 py-3 flex items-center gap-2 justify-end" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)' }}>
              <div className="text-sm text-right" style={{ color: c.accentText }}>
                <span className="font-semibold">{assignedTo}</span> יראה משימה זו בדף המשימות שלו
              </div>
              <ArrowRight size={14} style={{ color: c.accentText, flexShrink: 0 }} />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{ border: `1px solid ${c.cardBorder}`, color: c.textSecondary, background: 'transparent' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              ביטול
            </button>
            <button onClick={handleAdd} disabled={!desc.trim() || !date}
              className="flex-1 px-4 py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
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
const DARK_COL: Record<string, { headerText: string; accentBorder: string; badgeBg: string; badgeText: string }> = {
  upcoming: { headerText:'rgba(255,255,255,0.7)', accentBorder:'rgba(99,102,241,0.3)',  badgeBg:'rgba(99,102,241,0.2)',  badgeText:'#818cf8' },
  active:   { headerText:'#fbbf24',               accentBorder:'rgba(245,158,11,0.35)', badgeBg:'rgba(245,158,11,0.2)', badgeText:'#fbbf24' },
  done:     { headerText:'#4ade80',               accentBorder:'rgba(74,222,128,0.3)',  badgeBg:'rgba(74,222,128,0.15)',badgeText:'#4ade80' },
};

/* ═══════════════════════════════════════════════════════════════════════════
   KANBAN BOARD — drag-and-drop columns (pipeline style, theme-aware)
═══════════════════════════════════════════════════════════════════════════ */
function KanbanBoard({
  cols, onMove, onComplete, onDelete, onEdit, onLeadClick, completingId, currentUser, onQuickAdd,
}: {
  cols: { key: KanbanStatus; label: string; emoji: string; accent: string; headerBg: string; colBg: string; count: number; tasks: UnifiedTask[] }[];
  onMove: (task: UnifiedTask, col: KanbanStatus) => void;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
  currentUser: string;
  onQuickAdd: (status: KanbanStatus, description: string) => void;
}) {
  const dragRef = useRef<UnifiedTask | null>(null);
  const [dragOver, setDragOver] = useState<KanbanStatus | null>(null);
  const { isDark, c } = useTheme();

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: '70vh', alignItems: 'flex-start', direction: 'rtl' }}>
      {cols.map(col => (
        <KanbanColumn
          key={col.key}
          col={col}
          isDragOver={dragOver === col.key}
          isDark={isDark}
          themeC={c}
          dragRef={dragRef}
          onDragOver={setDragOver}
          onDrop={(targetCol) => {
            if (dragRef.current) {
              onMove(dragRef.current, targetCol);
              dragRef.current = null;
            }
            setDragOver(null);
          }}
          onComplete={onComplete}
          onDelete={onDelete}
          onEdit={onEdit}
          onLeadClick={onLeadClick}
          completingId={completingId}
          currentUser={currentUser}
          onQuickAdd={onQuickAdd}
        />
      ))}
    </div>
  );
}

function KanbanColumn({
  col, isDragOver, isDark, themeC, dragRef, onDragOver, onDrop,
  onComplete, onDelete, onEdit, onLeadClick, completingId, currentUser, onQuickAdd,
}: {
  col: { key: KanbanStatus; label: string; emoji: string; accent: string; headerBg: string; colBg: string; count: number; tasks: UnifiedTask[] };
  isDragOver: boolean;
  isDark: boolean;
  themeC: import('../contexts/ThemeContext').ThemeColors;
  dragRef: React.MutableRefObject<UnifiedTask | null>;
  onDragOver: (col: KanbanStatus | null) => void;
  onDrop: (col: KanbanStatus) => void;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
  currentUser: string;
  onQuickAdd: (status: KanbanStatus, description: string) => void;
}) {
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickText,    setQuickText]    = useState('');
  const quickRef = useRef<HTMLInputElement>(null);

  const colBg = isDark
    ? isDragOver ? `${col.accent}18` : 'rgba(255,255,255,0.025)'
    : isDragOver ? `${col.accent}10` : themeC.subtleBg;

  const overdueCount = col.tasks.filter(t =>
    !t.completed && t.kanbanStatus !== 'done' && t.kanbanStatus !== 'cancelled' && isOverdue(parseDate(t.date))
  ).length;

  const handleQuickSubmit = () => {
    if (!quickText.trim()) return;
    onQuickAdd(col.key, quickText.trim());
    setQuickText('');
    setShowQuickAdd(false);
  };

  return (
    <div
      className="flex-shrink-0 flex flex-col rounded-2xl overflow-hidden"
      style={{
        width: '280px',
        minWidth: '260px',
        direction: 'rtl',
        background: colBg,
        border: isDragOver
          ? `2px solid ${col.accent}70`
          : `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : themeC.cardBorder}`,
        boxShadow: isDragOver
          ? `0 0 24px ${col.accent}25`
          : isDark ? '0 2px 16px rgba(0,0,0,0.25)' : themeC.shadow,
        transition: 'all 0.15s ease',
      }}
      onDragOver={e => { e.preventDefault(); onDragOver(col.key); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragOver(null); }}
      onDrop={e => { e.preventDefault(); onDrop(col.key); }}
    >
      {/* ── Column header ── */}
      <div
        className="px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{
          background: isDark ? `${col.accent}14` : `${col.accent}12`,
          borderBottom: `2px solid ${col.accent}40`,
        }}
      >
        {/* Right: emoji + label */}
        <div className="flex items-center gap-2">
          <span className="text-lg leading-none">{col.emoji}</span>
          <span className="font-bold text-sm" style={{ color: isDark ? 'rgba(255,255,255,0.9)' : themeC.textPrimary }}>
            {col.label}
          </span>
          {overdueCount > 0 && (
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}>
              🔴 {overdueCount}
            </span>
          )}
        </div>
        {/* Left: count badge */}
        <div
          className="text-xs font-black px-2.5 py-1 rounded-full"
          style={{ background: `${col.accent}22`, color: col.accent, border: `1px solid ${col.accent}40` }}
        >
          {col.count}
        </div>
      </div>

      {/* ── Cards area ── */}
      <div className="flex-1 p-2.5 space-y-2 overflow-y-auto" style={{ minHeight: '200px', maxHeight: 'calc(100vh - 300px)' }}>
        {isDragOver && (
          <div
            className="rounded-xl border-2 border-dashed flex items-center justify-center py-5 mb-1"
            style={{ borderColor: `${col.accent}55`, background: `${col.accent}08` }}
          >
            <span className="text-xs font-bold" style={{ color: col.accent }}>שחרר כאן ↓</span>
          </div>
        )}
        {col.tasks.length === 0 && !isDragOver && (
          <div className="py-10 flex flex-col items-center gap-2 select-none pointer-events-none">
            <span className="text-3xl" style={{ opacity: isDark ? 0.15 : 0.2 }}>{col.emoji}</span>
            <span className="text-xs font-medium" style={{ color: isDark ? 'rgba(255,255,255,0.18)' : themeC.textMuted }}>
              אין משימות
            </span>
          </div>
        )}
        {col.tasks.map(task => (
          <KanbanCard
            key={task.id}
            task={task}
            accent={col.accent}
            isDark={isDark}
            themeC={themeC}
            dragRef={dragRef}
            onComplete={onComplete}
            onDelete={onDelete}
            onEdit={onEdit}
            onLeadClick={onLeadClick}
            isCompleting={completingId === task.id}
            currentUser={currentUser}
          />
        ))}
      </div>

      {/* ── Quick-add footer ── */}
      <div className="px-2.5 pb-2.5 flex-shrink-0" style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : themeC.cardBorder}`, paddingTop: '8px' }}>
        {showQuickAdd ? (
          <div className="space-y-1.5">
            <input
              ref={quickRef}
              type="text"
              value={quickText}
              onChange={e => setQuickText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleQuickSubmit();
                if (e.key === 'Escape') { setShowQuickAdd(false); setQuickText(''); }
              }}
              placeholder="תיאור המשימה..."
              autoFocus
              className="w-full rounded-xl px-3 py-2 text-sm text-right focus:outline-none"
              style={{
                background: isDark ? 'rgba(255,255,255,0.07)' : themeC.inputBg,
                border: `1px solid ${col.accent}55`,
                color: isDark ? 'rgba(255,255,255,0.9)' : themeC.textPrimary,
                boxShadow: `0 0 0 2px ${col.accent}18`,
              }}
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => { setShowQuickAdd(false); setQuickText(''); }}
                className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: isDark ? 'rgba(255,255,255,0.06)' : themeC.subtleBg, color: isDark ? 'rgba(255,255,255,0.4)' : themeC.textMuted, border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : themeC.cardBorder}` }}>
                ביטול
              </button>
              <button
                onClick={handleQuickSubmit}
                disabled={!quickText.trim()}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-40"
                style={{ background: `${col.accent}cc`, color: 'white', border: 'none' }}>
                הוסף
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setShowQuickAdd(true); setTimeout(() => quickRef.current?.focus(), 50); }}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all"
            style={{
              background: isDark ? 'rgba(255,255,255,0.03)' : 'transparent',
              color: isDark ? 'rgba(255,255,255,0.25)' : themeC.textMuted,
              border: `1px dashed ${isDark ? 'rgba(255,255,255,0.1)' : themeC.cardBorder}`,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${col.accent}12`; (e.currentTarget as HTMLElement).style.color = col.accent; (e.currentTarget as HTMLElement).style.borderColor = `${col.accent}50`; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isDark ? 'rgba(255,255,255,0.03)' : 'transparent'; (e.currentTarget as HTMLElement).style.color = isDark ? 'rgba(255,255,255,0.25)' : themeC.textMuted; (e.currentTarget as HTMLElement).style.borderColor = isDark ? 'rgba(255,255,255,0.1)' : themeC.cardBorder; }}
          >
            <Plus size={12} /> הוסף משימה
          </button>
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  task, accent, isDark, themeC, dragRef, onComplete, onDelete, onEdit, onLeadClick, isCompleting,
}: {
  task: UnifiedTask;
  accent: string;
  isDark: boolean;
  themeC: import('../contexts/ThemeContext').ThemeColors;
  dragRef: React.MutableRefObject<UnifiedTask | null>;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  isCompleting: boolean;
  currentUser: string;
}) {
  const pm      = PRIORITY_META[task.priority];
  const days    = daysUntil(task.date);
  const isOv    = !task.completed && days < 0;
  const isDone  = task.completed || task.kanbanStatus === 'done';
  const isCancelled = task.kanbanStatus === 'cancelled';
  const faded   = isDone || isCancelled;

  const cardBg     = isDark
    ? faded ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)'
    : faded ? themeC.subtleBg : themeC.cardBg;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : themeC.cardBorder;
  const textMain   = isDark ? (faded ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.9)') : (faded ? themeC.textMuted : themeC.textPrimary);
  const textSub    = isDark ? 'rgba(255,255,255,0.35)' : themeC.textSecondary;

  /* priority accent bar color */
  const pBar = task.priority === 'high' ? '#ef4444' : task.priority === 'medium' ? '#f97316' : '#3b82f6';

  return (
    <div
      draggable
      onDragStart={e => {
        dragRef.current = task;
        e.dataTransfer.effectAllowed = 'move';
        (e.currentTarget as HTMLElement).style.opacity = '0.45';
        (e.currentTarget as HTMLElement).style.transform = 'rotate(2deg) scale(1.03)';
      }}
      onDragEnd={e => {
        (e.currentTarget as HTMLElement).style.opacity = '1';
        (e.currentTarget as HTMLElement).style.transform = '';
      }}
      className={`relative rounded-xl overflow-hidden cursor-grab active:cursor-grabbing select-none transition-all duration-150 ${isCompleting ? 'opacity-40 scale-[0.97]' : ''}`}
      style={{
        background: cardBg,
        border: `1px solid ${cardBorder}`,
        borderRight: `3px solid ${faded ? (isDark ? 'rgba(255,255,255,0.12)' : themeC.divider) : pBar}`,
        boxShadow: isDark ? '0 2px 10px rgba(0,0,0,0.25)' : '0 1px 6px rgba(0,0,0,0.07)',
      }}
      onMouseEnter={e => {
        if (!faded) {
          (e.currentTarget as HTMLElement).style.background = isDark ? 'rgba(255,255,255,0.08)' : themeC.subtleBgHover;
          (e.currentTarget as HTMLElement).style.borderColor = isDark ? `${accent}50` : themeC.cardBorderStrong;
          (e.currentTarget as HTMLElement).style.boxShadow = isDark ? `0 4px 20px ${accent}20` : `0 2px 12px rgba(0,0,0,0.1)`;
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
        }
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = cardBg;
        (e.currentTarget as HTMLElement).style.borderColor = cardBorder;
        (e.currentTarget as HTMLElement).style.boxShadow = isDark ? '0 2px 10px rgba(0,0,0,0.25)' : '0 1px 6px rgba(0,0,0,0.07)';
        (e.currentTarget as HTMLElement).style.transform = '';
      }}
    >
      <div className="p-3">
        {/* ── Top row: priority + action buttons ── */}
        <div className="flex items-center justify-between mb-2" dir="rtl">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${pm.pill}`}>
            {pm.icon} {pm.label}
          </span>
          <div className="flex items-center gap-1">
            {!faded && (
              <button
                onClick={() => onEdit(task)}
                title="ערוך"
                className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
                style={{ color: isDark ? 'rgba(255,255,255,0.3)' : themeC.textMuted }}
                onMouseEnter={e => { e.currentTarget.style.color = accent; e.currentTarget.style.background = `${accent}15`; }}
                onMouseLeave={e => { e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.3)' : themeC.textMuted; e.currentTarget.style.background = 'transparent'; }}
              >
                <Pencil size={11} />
              </button>
            )}
            <button
              onClick={() => onDelete(task)}
              title="מחק"
              className="w-6 h-6 rounded-md flex items-center justify-center transition-colors"
              style={{ color: isDark ? 'rgba(255,255,255,0.25)' : themeC.textMuted }}
              onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = isDark ? 'rgba(255,255,255,0.25)' : themeC.textMuted; e.currentTarget.style.background = 'transparent'; }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        {/* ── Task description ── */}
        <p
          className="text-sm font-semibold leading-snug mb-1.5"
          style={{
            color: textMain,
            textDecoration: faded ? 'line-through' : 'none',
          }}
          dir="rtl"
        >
          {task.type && <span title={TASK_TYPE_META[task.type].label}>{TASK_TYPE_META[task.type].emoji} </span>}
          {task.description}
        </p>

        {/* ── Notes ── */}
        {task.notes && (
          <p className="text-[11px] mb-2 line-clamp-2 text-right" style={{ color: textSub }}>
            {task.notes}
          </p>
        )}

        {/* ── Footer ── */}
        <div
          className="flex items-center justify-between gap-1 pt-2 flex-wrap"
          style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : themeC.divider}` }}
          dir="rtl"
        >
          <div className="flex items-center gap-1 flex-wrap">
            {task.date && (
              <span
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                style={{
                  background: isOv
                    ? 'rgba(239,68,68,0.12)'
                    : isDark ? 'rgba(255,255,255,0.06)' : themeC.subtleBg,
                  color: isOv ? '#ef4444' : textSub,
                  border: isOv ? '1px solid rgba(239,68,68,0.25)' : `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : themeC.cardBorder}`,
                }}
              >
                {isOv ? '⚠️' : '📅'} {formatDate(task.date)}
              </span>
            )}
            {task.lead && (
              <button
                onClick={() => task.lead && onLeadClick(task.lead)}
                className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium transition-colors"
                style={{
                  background: isDark ? 'rgba(99,102,241,0.1)' : themeC.accentBg,
                  color: isDark ? '#a5b4fc' : themeC.accentText,
                  border: `1px solid ${isDark ? 'rgba(99,102,241,0.22)' : themeC.accentBorder}`,
                }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(99,102,241,0.2)' : '#dde6ff'}
                onMouseLeave={e => e.currentTarget.style.background = isDark ? 'rgba(99,102,241,0.1)' : themeC.accentBg}
              >
                <Building2 size={9} /> {task.lead.company}
              </button>
            )}
          </div>

          {/* Right side: avatar + complete */}
          <div className="flex items-center gap-1">
            {task.assignedTo && (
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                style={{
                  background: isDark ? 'rgba(99,102,241,0.3)' : themeC.accentBg,
                  color: isDark ? '#e0e7ff' : themeC.accentText,
                  border: `1px solid ${isDark ? 'rgba(99,102,241,0.4)' : themeC.accentBorder}`,
                }}
                title={task.assignedTo}
              >
                {task.assignedTo[0]?.toUpperCase()}
              </div>
            )}
            {!faded && (
              <button
                onClick={() => onComplete(task)}
                title="סמן כהושלם"
                className="w-6 h-6 rounded-full flex items-center justify-center transition-all flex-shrink-0"
                style={{
                  background: isDark ? 'rgba(16,185,129,0.12)' : '#d1fae5',
                  color: '#10b981',
                  border: `1px solid ${isDark ? 'rgba(16,185,129,0.28)' : '#6ee7b7'}`,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.28)'; e.currentTarget.style.boxShadow = '0 0 8px rgba(16,185,129,0.3)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = isDark ? 'rgba(16,185,129,0.12)' : '#d1fae5'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <Check size={11} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── legacy board column (kept for fallback) ────────────────────────────── */
function BoardColumn({ col, onComplete, onDelete, onEdit, onLeadClick, completingId, currentUser }: {
  col: { key: string; label: string; emoji: string; color: string; tasks: UnifiedTask[] };
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
  currentUser: string;
}) {
  const c = DARK_COL[col.key];
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: c.subtleBg, border: `1px solid ${c.accentBorder}`, backdropFilter: 'blur(8px)' }}
    >
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: 'rgba(10,15,30,0.6)', borderBottom: `1px solid ${c.accentBorder}` }}
      >
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full"
          style={{ background: c.badgeBg, color: c.badgeText }}>
          {col.tasks.length}
        </span>
        <div className="flex items-center gap-2 font-semibold text-sm" style={{ color: c.headerText }}>
          <span>{col.label}</span>
          <span className="text-base">{col.emoji}</span>
        </div>
      </div>
      <div className="min-h-[120px] p-2 space-y-2">
        {col.tasks.length === 0
          ? <div className="py-8 text-center text-xs" style={{ color: c.textMuted }}>אין משימות</div>
          : col.tasks.map(task => (
            <BoardTaskCard key={task.id} task={task}
              onComplete={onComplete} onDelete={onDelete} onEdit={onEdit} onLeadClick={onLeadClick}
              isCompleting={completingId === task.id} currentUser={currentUser} />
          ))
        }
      </div>
    </div>
  );
}

function BoardTaskCard({ task, onComplete, onDelete, onEdit, onLeadClick, isCompleting, currentUser }: {
  task: UnifiedTask;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  isCompleting: boolean;
  currentUser: string;
}) {
  const { c } = useTheme();
  const dp = DARK_PRIORITY[task.priority];
  const days = daysUntil(task.date);
  const overdue = !task.completed && days < 0;
  return (
    <div
      className={`rounded-xl p-3 transition-all border-r-4 ${isCompleting ? 'opacity-40 scale-[0.98]' : ''} ${task.completed ? 'opacity-50' : ''}`}
      style={{
        background: task.completed ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
        border: `1px solid rgba(255,255,255,0.06)`,
        borderRightColor: dp.borderRight,
        borderRightWidth: '3px',
      }}
      onMouseEnter={e => { if (!task.completed && !isCompleting) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = task.completed ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)'; }}
    >
      <div className="flex items-start gap-2">
        <button onClick={() => !task.completed && onComplete(task)} disabled={task.completed || isCompleting}
          className={`flex-shrink-0 mt-0.5 transition-colors ${task.completed ? 'cursor-default' : ''}`}
          style={{ color: task.completed ? '#4ade80' : 'rgba(255,255,255,0.25)' }}
          onMouseEnter={e => { if (!task.completed) e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          onMouseLeave={e => { if (!task.completed) e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; }}>
          {task.completed ? <CheckCircle2 size={16}/> : <Circle size={16}/>}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug" style={{ color: task.completed ? 'rgba(255,255,255,0.3)' : 'white', textDecoration: task.completed ? 'line-through' : 'none' }}>
            {task.type && <span title={TASK_TYPE_META[task.type].label}>{TASK_TYPE_META[task.type].emoji} </span>}
            {task.description}
          </p>
          {task.notes && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: c.textMuted }}>{task.notes}</p>}
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          {!task.completed && (
            <button onClick={() => onEdit(task)} className="transition-colors" title="ערוך משימה"
              style={{ color: c.textMuted }}
              onMouseEnter={e => e.currentTarget.style.color = '#818cf8'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}>
              <Pencil size={12}/>
            </button>
          )}
          {!task.completed && (
            <button onClick={() => onDelete(task)} className="transition-colors"
              style={{ color: c.textMuted }}
              onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}>
              <Trash2 size={12}/>
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: `1px solid ${c.divider}` }}>
        <div className="flex items-center gap-1">
          <a href={buildGCalUrl(task)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{ background: 'rgba(99,102,241,0.15)', color: c.accentText }}
            title="הוסף ל-Google Calendar">
            <CalendarPlus size={9}/> GCal
          </a>
          <a href={buildOutlookUrl(task)} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{ background: 'rgba(14,165,233,0.15)', color: '#0ea5e9' }}
            title="הוסף ל-Outlook Calendar">
            <CalendarPlus size={9}/> Outlook
          </a>
          {task.lead && (
            <button onClick={() => task.lead && onLeadClick(task.lead)}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
              style={{ background: c.subtleBg, color: c.textSecondary }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.15)'; e.currentTarget.style.color = '#818cf8'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}>
              <Building2 size={9}/> {task.lead.company}
            </button>
          )}
          {task.lead?.phone && !task.completed && (
            <a href={`https://wa.me/${task.lead.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}
              title="שלח WhatsApp" onClick={e => e.stopPropagation()}>
              <MessageCircle size={9}/> WA
            </a>
          )}
          {task.lead?.email && !task.completed && (
            <a href={`mailto:${task.lead.email}`}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all"
              style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}
              title="שלח מייל" onClick={e => e.stopPropagation()}>
              <Mail size={9}/> מייל
            </a>
          )}
          {task.assignedTo && task.assignedTo !== currentUser && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(99,102,241,0.15)', color: c.accentText }}>
              <User size={9}/> {task.assignedTo}
            </span>
          )}
        </div>
        <span className="text-[11px] font-medium" style={{ color: overdue ? '#f87171' : 'rgba(255,255,255,0.35)' }}>
          {task.time} · {overdue ? `פג לפני ${Math.abs(days)}י'` : days === 0 ? 'היום' : days === 1 ? 'מחר' : formatDate(task.date)}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASK GROUP (List view)
═══════════════════════════════════════════════════════════════════════════ */
function TaskGroup({ group, onComplete, onDelete, onEdit, onLeadClick, completingId, currentUser, selectMode, selected, toggleSelect, onQuickAdd }: {
  group: { key: string; label: string; emoji: string; accent?: string; tasks: UnifiedTask[] };
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  completingId: string | null;
  currentUser: string;
  selectMode: boolean;
  selected: Set<string>;
  toggleSelect: (id: string) => void;
  onQuickAdd?: (status: KanbanStatus, description: string) => void;
}) {
  const { isDark, c } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickText,    setQuickText]    = useState('');

  const accent = group.accent ?? '#6366f1';
  const groupBg     = isDark ? `${accent}0a` : `${accent}08`;
  const groupBorder = `${accent}30`;
  const headerText  = accent;

  const overdueCount = group.tasks.filter(t => !t.completed && isOverdue(parseDate(t.date))).length;

  const handleQuickSubmit = () => {
    if (!quickText.trim() || !onQuickAdd) return;
    onQuickAdd(group.key as KanbanStatus, quickText.trim());
    setQuickText('');
    setShowQuickAdd(false);
  };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: isDark ? groupBg : `${accent}06`, border: `1px solid ${groupBorder}`, backdropFilter: 'blur(8px)' }}
    >
      {/* Header */}
      <button onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 transition-colors"
        style={{ color: headerText }}
        onMouseEnter={e => e.currentTarget.style.background = `${accent}08`}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        <div className="flex items-center gap-2">
          <ChevronRight size={15} className={`transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} style={{ color: isDark ? 'rgba(255,255,255,0.3)' : c.textMuted }}/>
          <span className="text-xs font-black px-2.5 py-0.5 rounded-full"
            style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}40` }}>
            {group.tasks.length}
          </span>
          {overdueCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
              🔴 {overdueCount} פגות תוקף
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm font-bold">
          <span style={{ color: isDark ? 'rgba(255,255,255,0.85)' : c.textPrimary }}>{group.label}</span>
          <span className="text-lg leading-none">{group.emoji}</span>
        </div>
      </button>

      {!collapsed && (
        <>
          <div style={{ borderTop: `1px solid ${groupBorder}` }}>
            {group.tasks.map(task => (
              <TaskRow key={task.id} task={task}
                onComplete={onComplete} onDelete={onDelete} onEdit={onEdit} onLeadClick={onLeadClick}
                isCompleting={completingId === task.id} isUrgent={false}
                currentUser={currentUser}
                selectMode={selectMode} selected={selected} toggleSelect={toggleSelect}
              />
            ))}
          </div>
          {/* Quick-add for this status group */}
          {onQuickAdd && (
            <div className="px-4 py-2.5" style={{ borderTop: `1px solid ${groupBorder}` }}>
              {showQuickAdd ? (
                <div className="flex gap-2 items-center">
                  <button
                    onClick={() => { setShowQuickAdd(false); setQuickText(''); }}
                    className="text-xs px-2 py-1.5 rounded-lg transition-colors flex-shrink-0"
                    style={{ color: isDark ? 'rgba(255,255,255,0.4)' : c.textMuted, background: isDark ? 'rgba(255,255,255,0.05)' : c.subtleBg }}>
                    ביטול
                  </button>
                  <button
                    onClick={handleQuickSubmit}
                    disabled={!quickText.trim()}
                    className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all disabled:opacity-40 flex-shrink-0"
                    style={{ background: `${accent}cc`, color: 'white' }}>
                    הוסף
                  </button>
                  <input
                    type="text"
                    value={quickText}
                    onChange={e => setQuickText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleQuickSubmit(); if (e.key === 'Escape') { setShowQuickAdd(false); setQuickText(''); } }}
                    placeholder="שם המשימה..."
                    autoFocus
                    className="flex-1 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none"
                    style={{
                      background: isDark ? 'rgba(255,255,255,0.07)' : c.inputBg,
                      border: `1px solid ${accent}55`,
                      color: isDark ? 'rgba(255,255,255,0.9)' : c.textPrimary,
                    }}
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowQuickAdd(true)}
                  className="flex items-center gap-1.5 text-xs font-medium transition-colors"
                  style={{ color: isDark ? 'rgba(255,255,255,0.25)' : c.textMuted }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = accent; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = isDark ? 'rgba(255,255,255,0.25)' : c.textMuted; }}>
                  <Plus size={13} /> הוסף משימה לסטטוס זה
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TASK ROW
═══════════════════════════════════════════════════════════════════════════ */
function TaskRow({ task, onComplete, onDelete, onEdit, onLeadClick, isCompleting, isUrgent, currentUser, selectMode, selected, toggleSelect }: {
  task: UnifiedTask;
  onComplete: (t: UnifiedTask) => void;
  onDelete: (t: UnifiedTask) => void;
  onEdit: (t: UnifiedTask) => void;
  onLeadClick: (l: Lead) => void;
  isCompleting: boolean;
  isUrgent: boolean;
  currentUser: string;
  selectMode: boolean;
  selected: Set<string>;
  toggleSelect: (id: string) => void;
}) {
  const { c } = useTheme();
  const dp = DARK_PRIORITY[task.priority];
  const [showNotes, setShowNotes] = useState(false);
  const [hovered, setHovered] = useState(false);
  const isDelegate = task.assignedTo && task.assignedTo !== currentUser;

  return (
    <div
      className={`group transition-all duration-300 ${isCompleting ? 'opacity-40 scale-[0.99]' : ''}`}
      style={{ background: hovered && !task.completed ? 'rgba(255,255,255,0.04)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="flex items-center gap-3 px-5 py-3.5"
        style={{ borderRight: `4px solid ${dp.borderRight}`, borderBottom: `1px solid ${c.divider}` }}
      >
        {/* Selection checkbox */}
        {selectMode && (
          <button onClick={e => { e.stopPropagation(); toggleSelect(task.id); }}
            className="flex-shrink-0"
            style={{ color: selected.has(task.id) ? '#818cf8' : 'rgba(255,255,255,0.2)' }}>
            {selected.has(task.id) ? <CheckSquare size={16}/> : <Square size={16}/>}
          </button>
        )}

        {/* Checkbox */}
        <button onClick={() => !task.completed && onComplete(task)} disabled={task.completed || isCompleting}
          className={`flex-shrink-0 transition-all duration-200 ${task.completed ? 'cursor-default' : ''} ${isCompleting ? 'animate-pulse' : ''}`}
          style={{ color: task.completed ? '#4ade80' : isUrgent ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.2)' }}
          onMouseEnter={e => { if (!task.completed) e.currentTarget.style.color = isUrgent ? '#f87171' : 'rgba(255,255,255,0.7)'; }}
          onMouseLeave={e => { if (!task.completed) e.currentTarget.style.color = isUrgent ? 'rgba(248,113,113,0.4)' : 'rgba(255,255,255,0.2)'; }}>
          {task.completed ? <CheckCircle2 size={20}/> : isCompleting ? <CheckCircle2 size={20} className="animate-pulse"/> : <Circle size={20}/>}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0 text-right">
          <div
            className="text-sm font-medium leading-snug"
            style={{
              color: task.completed ? 'rgba(255,255,255,0.3)' : 'white',
              textDecoration: task.completed ? 'line-through' : 'none',
            }}>
            {task.description}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 justify-end flex-wrap">
            <span className="text-xs" style={{ color: c.textMuted }}>{task.time}</span>
            <span className="text-xs" style={{ color: c.textMuted }}>·</span>
            <span className="text-xs font-medium" style={{ color: isUrgent && !task.completed ? '#f87171' : 'rgba(255,255,255,0.35)' }}>
              {formatDate(task.date)}
            </span>
            {task.notes && (
              <button onClick={() => setShowNotes(v => !v)}
                className="flex items-center gap-0.5 text-xs transition-colors"
                style={{ color: c.textMuted }}
                onMouseEnter={e => e.currentTarget.style.color = '#818cf8'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
                <StickyNote size={10}/> פרטים
              </button>
            )}
          </div>
          {showNotes && task.notes && (
            <div className="mt-1.5 text-xs rounded-lg px-3 py-2 text-right leading-relaxed" style={{ color: c.textSecondary, background: c.subtleBg }}>
              {task.notes}
            </div>
          )}
        </div>

        {/* Chips */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Assignee */}
          {isDelegate && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold" style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)', color: c.accentText }}>
              <div className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: 'rgba(99,102,241,0.3)', color: c.accentText }}>
                {task.assignedTo[0]?.toUpperCase()}
              </div>
              {task.assignedTo}
            </span>
          )}
          {/* Lead */}
          {task.lead && (
            <button onClick={() => task.lead && onLeadClick(task.lead)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all"
              style={{ background: c.subtleBg, color: c.textSecondary, border: '1px solid transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.15)'; e.currentTarget.style.color = '#818cf8'; e.currentTarget.style.borderColor = 'rgba(99,102,241,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; e.currentTarget.style.borderColor = 'transparent'; }}>
              <Building2 size={10}/> {task.lead.company}
            </button>
          )}
          {/* WA quick action */}
          {task.lead?.phone && !task.completed && (
            <a href={`https://wa.me/${task.lead.phone.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all"
              style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' }}
              title="שלח WhatsApp" onClick={e => e.stopPropagation()}>
              <MessageCircle size={9}/> WA
            </a>
          )}
          {/* Email quick action */}
          {task.lead?.email && !task.completed && (
            <a href={`mailto:${task.lead.email}`}
              className="flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[10px] font-medium transition-all"
              style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)' }}
              title="שלח מייל" onClick={e => e.stopPropagation()}>
              <Mail size={9}/> מייל
            </a>
          )}
          {/* Priority */}
          <span
            className="hidden sm:flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: dp.bg, color: dp.text, border: `1px solid ${dp.border}` }}>
            {PRIORITY_META[task.priority].icon} {PRIORITY_META[task.priority].label}
          </span>
        </div>

        {/* Actions */}
        {!task.completed && (
          <div className={`flex items-center gap-1 flex-shrink-0 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}>
            {/* Google Calendar */}
            <a href={buildGCalUrl(task)} target="_blank" rel="noreferrer"
              title="הוסף ל-Google Calendar"
              className="p-1.5 rounded-lg transition-all"
              style={{ color: c.textMuted }}
              onMouseEnter={e => { e.currentTarget.style.color = '#818cf8'; e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'transparent'; }}>
              <CalendarPlus size={14}/>
            </a>
            {/* Outlook Calendar */}
            <a href={buildOutlookUrl(task)} target="_blank" rel="noreferrer"
              title="הוסף ל-Outlook Calendar"
              className="p-1.5 rounded-lg transition-all"
              style={{ color: c.textMuted }}
              onMouseEnter={e => { e.currentTarget.style.color = '#0ea5e9'; e.currentTarget.style.background = 'rgba(14,165,233,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'transparent'; }}>
              <CalendarPlus size={14}/>
            </a>
            {/* Edit (all tasks) */}
            <button onClick={() => onEdit(task)} title="ערוך משימה"
              className="p-1.5 rounded-lg transition-all"
              style={{ color: c.textMuted }}
              onMouseEnter={e => { e.currentTarget.style.color = '#818cf8'; e.currentTarget.style.background = 'rgba(99,102,241,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'transparent'; }}>
              <Pencil size={14}/>
            </button>
            {/* Delete */}
            <button onClick={() => onDelete(task)}
              className="p-1.5 rounded-lg transition-all"
              style={{ color: c.textMuted }}
              onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; e.currentTarget.style.background = 'transparent'; }}>
              <Trash2 size={14}/>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EDIT TASK MODAL
═══════════════════════════════════════════════════════════════════════════ */
function EditTaskModal({ task, leads, team, currentUser, onClose, onSave }: {
  task: UnifiedTask;
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  onClose: () => void;
  onSave: (t: StandaloneTask, leadId?: string, leadTask?: Task) => void;
}) {
  const { isDark, c } = useTheme();
  const [desc,       setDesc]       = useState(task.description);
  const [notes,      setNotes]      = useState(task.notes ?? '');
  const [date,       setDate]       = useState(task.date);
  const [time,       setTime]       = useState(task.time);
  const [priority,   setPriority]   = useState<TaskPriority>(task.priority);
  const [taskType,   setTaskType]   = useState<TaskType>(task.type ?? 'followup');
  const [assignedTo, setAssignedTo] = useState(task.assignedTo);
  const [addedToGcal,setAddedToGcal] = useState(false);

  const membersList = [
    { name: currentUser, label: `${currentUser} (אני)` },
    ...team.filter(m => m.name !== currentUser).map(m => ({ name: m.name, label: m.name })),
  ];

  const handleSave = () => {
    if (!desc.trim() || !date) return;
    if (!task.isStandalone && task.lead && task.leadTaskOriginalId) {
      const leadTask: Task = {
        id: task.leadTaskOriginalId,
        description: desc.trim(),
        date, time, priority,
        type: taskType,
        completed: task.completed,
        assignedTo,
        assignedBy: task.assignedBy ?? currentUser,
        ...(task.kanbanStatus ? { kanbanStatus: task.kanbanStatus } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      onSave({} as StandaloneTask, task.lead.id, leadTask);
      return;
    }
    const updated: StandaloneTask = {
      id:          task.standaloneId!,
      description: desc.trim(),
      date,
      time,
      priority,
      type:        taskType,
      completed:   task.completed,
      assignedTo,
      assignedBy:  task.assignedBy ?? currentUser,
      createdAt:   new Date().toISOString(),
      ...(task.kanbanStatus ? { kanbanStatus: task.kanbanStatus } : {}),
      ...(notes.trim()   ? { notes: notes.trim() } : {}),
      ...(task.lead?.id  ? { leadId: task.lead.id } : {}),
      ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    };
    onSave(updated);
  };

  const previewUrl = buildGCalUrl({ description: desc, date, time, notes: notes || undefined, lead: task.lead ?? leads.find(l => l.id === task.lead?.id) });

  const inputStyle = {
    background: c.subtleBg,
    border: `1px solid ${c.cardBorder}`,
    color: c.textPrimary,
  };

  const modalBg     = '#ffffff';
  const fieldBg     = '#f1f5f9';
  const fieldBorder = '#e2e8f0';
  const labelColor  = '#475569';
  const textColor   = '#0f172a';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
      <div
        className="rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg overflow-hidden"
        dir="rtl"
        style={{
          background: modalBg,
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {/* Top accent bar */}
        <div className="h-1" style={{ background: 'linear-gradient(90deg,#6366f1,#8b5cf6,#06b6d4)' }} />

        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid #e2e8f0' }}>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all"
            style={{ color: '#64748b', background: '#f1f5f9' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#eef2ff'; e.currentTarget.style.color = '#4f46e5'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}>
            <X size={16} />
          </button>
          <div className="text-right">
            <h2 className="font-black text-base leading-none" style={{ color: '#0f172a' }}>✏️ עריכת משימה</h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#64748b' }}>עדכן פרטי המשימה</p>
          </div>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.35)' }}>
            <Pencil size={14} className="text-white" />
          </div>
        </div>

        <div className="px-6 pb-6 pt-4 space-y-4 max-h-[80vh] overflow-y-auto">

          {/* Description */}
          <div className="rounded-2xl p-4"
            style={{ background: fieldBg, border: `1px solid ${fieldBorder}` }}>
            <label className="block text-[11px] font-bold mb-2 uppercase tracking-wide" style={{ color: labelColor }}>תיאור המשימה</label>
            <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} autoFocus
              className="w-full bg-transparent text-sm text-right focus:outline-none resize-none"
              style={{ color: textColor }}
              placeholder="תיאור המשימה..."
              onFocus={e => { (e.currentTarget.closest('.rounded-2xl') as HTMLElement)!.style.borderColor = '#a5b4fc'; }}
              onBlur={e => { (e.currentTarget.closest('.rounded-2xl') as HTMLElement)!.style.borderColor = fieldBorder; }}
            />
          </div>

          {/* Notes */}
          <div className="rounded-2xl p-4"
            style={{ background: fieldBg, border: `1px solid ${fieldBorder}` }}>
            <label className="block text-[11px] font-bold mb-2 uppercase tracking-wide flex items-center gap-1.5" style={{ color: labelColor }}>
              <StickyNote size={11} /> פרטים נוספים
            </label>
            <textarea rows={2} placeholder="הוראות, קישורים, הערות..."
              value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full bg-transparent text-sm text-right focus:outline-none resize-none"
              style={{ color: textColor }}
              onFocus={e => { (e.currentTarget.closest('.rounded-2xl') as HTMLElement)!.style.borderColor = '#a5b4fc'; }}
              onBlur={e => { (e.currentTarget.closest('.rounded-2xl') as HTMLElement)!.style.borderColor = fieldBorder; }}
            />
          </div>

          {/* Date + Time row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl p-3" style={{ background: fieldBg, border: `1px solid ${fieldBorder}` }}>
              <label className="block text-[10px] font-bold mb-1.5 flex items-center gap-1" style={{ color: labelColor }}>
                <Clock size={10}/> שעה
              </label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none"
                style={{ color: textColor, colorScheme: 'light' }}
              />
            </div>
            <div className="rounded-2xl p-3" style={{ background: fieldBg, border: `1px solid ${fieldBorder}` }}>
              <label className="block text-[10px] font-bold mb-1.5 text-right" style={{ color: labelColor }}>📅 תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full bg-transparent text-sm focus:outline-none"
                style={{ color: textColor, colorScheme: 'light' }}
              />
            </div>
          </div>

          {/* Quick date chips */}
          <div className="flex gap-2 flex-wrap">
            {[
              { label: '☀️ היום', days: 0 },
              { label: '→ מחר', days: 1 },
              { label: '+3', days: 3 },
              { label: '+7', days: 7 },
            ].map(({ label, days }) => {
              const d = new Date(); d.setDate(d.getDate() + days);
              const val = d.toISOString().split('T')[0];
              const active = date === val;
              return (
                <button key={label} onClick={() => setDate(val)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold transition-all"
                  style={active
                    ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: 'white', boxShadow: '0 0 10px rgba(99,102,241,0.3)', border: '1px solid transparent' }
                    : { background: '#f8fafc', border: '1px solid #e2e8f0', color: '#64748b' }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Task type */}
          <div>
            <label className="block text-[11px] font-bold mb-2 uppercase tracking-wide" style={{ color: labelColor }}>סוג משימה</label>
            <div className="flex flex-wrap gap-1.5">
              {TASK_TYPE_ORDER.map(tp => {
                const m = TASK_TYPE_META[tp];
                const active = taskType === tp;
                return (
                  <button key={tp} onClick={() => setTaskType(tp)}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                    style={active
                      ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: '1px solid transparent' }
                      : { background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#64748b' }}>
                    {m.emoji} {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-[11px] font-bold mb-2 uppercase tracking-wide flex items-center gap-1.5" style={{ color: labelColor }}>
              <Flag size={11} /> עדיפות
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { p: 'high'   as TaskPriority, label: 'דחוף',   emoji: '🔴',
                  activeGrad: '#fef2f2', activeBorder: '#fca5a5', activeColor: '#dc2626' },
                { p: 'medium' as TaskPriority, label: 'בינוני', emoji: '🟡',
                  activeGrad: '#fffbeb', activeBorder: '#fde68a', activeColor: '#d97706' },
                { p: 'low'    as TaskPriority, label: 'נמוך',   emoji: '🟢',
                  activeGrad: '#f0fdf4', activeBorder: '#86efac', activeColor: '#16a34a' },
              ].map(({ p, label, emoji, activeGrad, activeBorder, activeColor }) => (
                <button key={p} onClick={() => setPriority(p)}
                  className="py-3 rounded-2xl text-sm font-bold transition-all flex flex-col items-center gap-1"
                  style={priority === p
                    ? { background: activeGrad, color: activeColor, border: `1.5px solid ${activeBorder}`, boxShadow: `0 2px 8px ${activeBorder}60` }
                    : { background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#94a3b8' }}>
                  <span className="text-lg leading-none">{emoji}</span>
                  <span className="text-xs font-semibold">{label}</span>
                </button>
              )))}
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-[11px] font-bold mb-2 uppercase tracking-wide flex items-center gap-1.5" style={{ color: labelColor }}>
              <User size={11} /> הקצאה
            </label>
            <div className="flex flex-wrap gap-2">
              {membersList.map(m => {
                const active = assignedTo === m.name;
                return (
                  <button key={m.name} onClick={() => setAssignedTo(m.name)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                    style={active
                      ? { background: '#eef2ff', color: '#4f46e5', border: '1.5px solid #c7d2fe' }
                      : { background: '#f8fafc', border: '1.5px solid #e2e8f0', color: '#475569' }}>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                      style={active
                        ? { background: '#4f46e5', color: 'white' }
                        : { background: '#cbd5e1', color: '#64748b' }}>
                      {m.name[0]?.toUpperCase()}
                    </div>
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calendar sync — Google + Outlook */}
          <div className="rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
            style={{ background: '#eef2ff', border: '1px solid #c7d2fe' }}>
            <p className="text-[10px] flex-shrink-0" style={{ color: '#6366f1' }}>שמור לפני הוספה</p>
            <div className="flex gap-2">
              <a href={previewUrl} target="_blank" rel="noreferrer"
                onClick={() => setAddedToGcal(true)}
                className="flex items-center gap-1.5 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all"
                style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 2px 10px rgba(99,102,241,0.3)' }}>
                <CalendarPlus size={13} /> Google
              </a>
              <a href={buildOutlookUrl({ description: desc, date, time, notes: notes || undefined, lead: task.lead ?? leads.find(l => l.id === task.lead?.id) })}
                target="_blank" rel="noreferrer" onClick={() => setAddedToGcal(true)}
                className="flex items-center gap-1.5 text-white px-3 py-2 rounded-xl text-xs font-bold transition-all"
                style={{ background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', boxShadow: '0 2px 10px rgba(14,165,233,0.3)' }}>
                <CalendarPlus size={13} /> Outlook
              </a>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button onClick={onClose}
              className="flex-1 px-4 py-3 rounded-2xl text-sm font-semibold transition-all"
              style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#475569' }}
              onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
              onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}>
              ביטול
            </button>
            <button onClick={handleSave} disabled={!desc.trim() || !date}
              className="flex-1 px-4 py-3 rounded-2xl disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 2px 12px rgba(99,102,241,0.3)' }}>
              <Check size={14} /> שמור שינויים
            </button>
          </div>
        </div>
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
  const C: Record<string, { bg: string; border: string; iconBg: string; iconColor: string; valueColor: string }> = {
    red:    { bg:'rgba(239,68,68,0.08)',   border:'rgba(239,68,68,0.2)',   iconBg:'rgba(239,68,68,0.15)',   iconColor:'#f87171', valueColor:'#f87171' },
    amber:  { bg:'rgba(245,158,11,0.08)',  border:'rgba(245,158,11,0.2)',  iconBg:'rgba(245,158,11,0.15)',  iconColor:'#fbbf24', valueColor:'#fbbf24' },
    green:  { bg:'rgba(74,222,128,0.07)',  border:'rgba(74,222,128,0.18)', iconBg:'rgba(74,222,128,0.12)',  iconColor:'#4ade80', valueColor:'#4ade80' },
    slate:  { bg:'rgba(255,255,255,0.03)', border:'rgba(255,255,255,0.07)',iconBg:'rgba(255,255,255,0.08)', iconColor:'rgba(255,255,255,0.4)', valueColor:'rgba(255,255,255,0.5)' },
    indigo: { bg:'rgba(99,102,241,0.08)',  border:'rgba(99,102,241,0.2)',  iconBg:'rgba(99,102,241,0.18)',  iconColor:'#818cf8', valueColor:'#818cf8' },
  };
  const c = C[scheme];
  return (
    <button
      onClick={onClick}
      className="rounded-xl p-4 transition-all text-right w-full"
      style={{ background: c.bg, border: `1px solid ${c.border}`, backdropFilter: 'blur(8px)' }}
      onMouseEnter={e => e.currentTarget.style.background = scheme === 'slate' ? 'rgba(255,255,255,0.05)' : c.bg.replace('0.08','0.12').replace('0.07','0.1')}
      onMouseLeave={e => e.currentTarget.style.background = c.bg}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: c.iconBg, color: c.iconColor }}>{icon}</div>
        <div className="text-3xl font-bold" style={{ color: c.valueColor }}>{value}</div>
      </div>
      <div className="text-xs font-medium" style={{ color: c.textSecondary }}>{label}</div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY STATE
═══════════════════════════════════════════════════════════════════════════ */
function EmptyState({ dateFilter, ownerFilter, onCreateTask }: {
  dateFilter: DateFilter; ownerFilter: OwnerFilter; onCreateTask: () => void;
}) {
  const { c } = useTheme();
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
    <div
      className="rounded-xl p-16 text-center"
      style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, backdropFilter: 'blur(8px)' }}
    >
      <div className="text-5xl mb-4">{emoji}</div>
      <div className="text-lg font-bold" style={{ color: c.textPrimary }}>{title}</div>
      <div className="text-sm mt-1" style={{ color: c.textMuted }}>{sub}</div>
      <button onClick={onCreateTask}
        className="mt-5 inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
        <Plus size={15}/> צור משימה חדשה
      </button>
    </div>
  );
}
