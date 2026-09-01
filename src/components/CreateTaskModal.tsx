/**
 * CreateTaskModal — the one dialog for creating a task, wherever it starts.
 *
 * It used to live inside the tasks page, which meant a task started from a
 * lead card got a different, much smaller form: a description, a date and a
 * priority, and none of the type, assignee or notes the real dialog offers.
 * Two ways to create the same object, one of them quietly worse.
 *
 * Moving it here makes both entry points the same dialog. When it is opened
 * from a lead the lead is pre-selected and locked — changing which lead a task
 * belongs to from inside that lead's own card would be a way to lose the task,
 * not a feature.
 *
 * Surfaces come from the theme rather than being pinned to a dark palette; the
 * dialog is opened over both a dark page and a light one.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus, User, Building2, Search, ChevronDown, Clock, StickyNote, Flag, ArrowRight } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { Lead, Task, StandaloneTask, TeamMember, TaskPriority, TaskType } from '../types';
import { PRIORITY_META, DARK_PRIORITY, TASK_TYPE_ORDER, TASK_TYPE_META } from '../lib/taskMeta';

export default function CreateTaskModal({
  leads, team, currentUser, onClose, onAddStandalone, onAddToLead,
  lockedLead, initialTask,
}: {
  leads: Lead[];
  team: TeamMember[];
  currentUser: string;
  onClose: () => void;
  onAddStandalone: (t: StandaloneTask) => void;
  onAddToLead: (leadId: string, task: Task) => void;
  /**
   * Opened from a lead card: the task belongs to this lead and the picker is
   * fixed. Letting someone reassign the lead from inside that lead's own card
   * would be a way to make a task vanish from the screen they created it on.
   */
  lockedLead?: Lead;
  /** An existing task, opened for viewing and editing rather than creation. */
  initialTask?: Task;
}) {
  const { c } = useTheme();
  const editing = Boolean(initialTask);
  const [desc,          setDesc]         = useState(initialTask?.description ?? '');
  const [notes,         setNotes]        = useState(initialTask?.notes ?? '');
  const [date,          setDate]         = useState(initialTask?.date ?? (() => new Date().toISOString().split('T')[0])());
  const [time,          setTime]         = useState(initialTask?.time ?? '09:00');
  const [priority,      setPriority]     = useState<TaskPriority>(initialTask?.priority ?? 'medium');
  const [taskType,      setTaskType]     = useState<TaskType>(initialTask?.type ?? 'followup');
  const [assignedTo,    setAssignedTo]   = useState(initialTask?.assignedTo || currentUser);
  const [selectedLead,  setSelectedLead] = useState<Lead | null>(lockedLead ?? null);
  const [leadSearch,    setLeadSearch]   = useState('');
  const [showLeadDrop,  setShowLeadDrop] = useState(false);
  const [showNotes,     setShowNotes]    = useState(Boolean(initialTask?.notes));
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
        id: initialTask?.id ?? Date.now().toString(),
        description: desc.trim(),
        date, time,
        completed: false,
        priority,
        type: taskType,
        assignedTo,
        assignedBy: currentUser,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(initialTask?.completed ? { completed: true } : {}),
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}>
      <div
        className="rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg overflow-hidden max-h-[95vh] overflow-y-auto"
        dir="rtl"
        style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}
      >

        {/* Header */}
        <div className="px-6 py-5 flex items-center justify-between" style={{ background: c.cardBgAlt, borderBottom: `1px solid ${c.cardBorder}` }}>
          <button onClick={onClose}
            className="p-1 rounded-lg transition-colors"
            style={{ color: c.textMuted }}
            onMouseEnter={e => { e.currentTarget.style.color = c.accentText; e.currentTarget.style.background = 'rgba(99,102,241,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = c.textMuted; e.currentTarget.style.background = 'transparent'; }}>
            <X size={18} />
          </button>
          <div className="text-right">
            <h2 className="font-bold text-lg leading-none" style={{ color: c.textPrimary }}>{editing ? 'משימה' : 'משימה חדשה'}</h2>
            <p className="text-xs mt-1" style={{ color: c.textMuted }}>{editing ? 'צפייה ועריכה' : lockedLead ? `משימה עבור ${lockedLead.company || lockedLead.contactName}` : 'הוסף משימה ושייך לחבר צוות'}</p>
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
              onBlur={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.boxShadow = 'none'; }}
            />
          </div>

          {/* Notes toggle */}
          <div>
            {!showNotes ? (
              <button onClick={() => setShowNotes(true)}
                className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: c.textMuted }}
                onMouseEnter={e => e.currentTarget.style.color = c.accentText}
                onMouseLeave={e => e.currentTarget.style.color = c.textMuted}>
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
                  onBlur={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.boxShadow = 'none'; }}
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
                    : { background: c.subtleBg, border: `2px solid ${c.cardBorder}`, color: c.textSecondary }}>
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={assignedTo === m.name
                      ? { background: 'rgba(255,255,255,0.25)', color: '#ffffff' }
                      : { background: 'rgba(99,102,241,0.2)', color: c.accentText }}>
                    {m.name[0]?.toUpperCase()}
                  </div>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional lead */}
          {lockedLead ? (
            <div>
              <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: c.textSecondary }}>
                <Building2 size={13} style={{ color: c.textMuted }} /> שייך לליד
              </label>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
                style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                <Building2 size={13} className="flex-shrink-0" style={{ color: c.accentText }} />
                <div className="text-right">
                  <div className="text-sm font-medium" style={{ color: c.textPrimary }}>{lockedLead.company}</div>
                  {lockedLead.contactName && (
                    <div className="text-xs" style={{ color: c.textMuted }}>{lockedLead.contactName}</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
          <div>
            <label className="block text-sm font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: c.textSecondary }}>
              <Building2 size={13} style={{ color: c.textMuted }} /> שייך לליד <span className="font-normal" style={{ color: c.textMuted }}>(אופציונלי)</span>
            </label>
            <div className="relative" ref={dropRef}>
              <div onClick={() => setShowLeadDrop(true)}
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-text transition-all"
                style={{ background: c.subtleBg, border: `1px solid ${showLeadDrop ? 'rgba(99,102,241,0.5)' : c.cardBorder}` }}>
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
                  style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}
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
          )}

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1.5 flex items-center gap-1 justify-end" style={{ color: c.textMuted }}>שעה <Clock size={11}/></label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5 text-right" style={{ color: c.textMuted }}>תאריך</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 2px rgba(99,102,241,0.15)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = c.cardBorder; e.currentTarget.style.boxShadow = 'none'; }}
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
                    ? { background: 'rgba(99,102,241,0.3)', border: '1px solid rgba(99,102,241,0.5)', color: c.accentText }
                    : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
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
                      : { background: c.subtleBg, border: `2px solid ${c.cardBorder}`, color: c.textSecondary }}>
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
              onMouseEnter={e => e.currentTarget.style.background = c.subtleBgHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              ביטול
            </button>
            <button onClick={handleAdd} disabled={!desc.trim() || !date}
              className="flex-1 px-4 py-2.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', boxShadow: '0 0 12px rgba(99,102,241,0.3)' }}>
              <Plus size={15} /> {editing ? 'שמור שינויים' : 'צור משימה'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
