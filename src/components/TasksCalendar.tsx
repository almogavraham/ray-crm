/**
 * TasksCalendar — month calendar view for the Tasks page.
 * Shows tasks on their due dates in a Sunday-first Hebrew grid.
 */

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { TaskPriority, TaskType } from '../types';

interface CalTask {
  id: string;
  description: string;
  date: string;          // ISO or dd.mm.yyyy — parsed leniently
  priority: TaskPriority;
  completed: boolean;
  type?: TaskType;
  leadCompany?: string;
}

interface Props {
  tasks: CalTask[];
  onTaskClick: (id: string) => void;
}

const DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const TYPE_EMOJI: Record<TaskType, string> = { call: '📞', email: '✉️', whatsapp: '💬', meeting: '📅', followup: '🔄', proposal: '📄', other: '📌' };
const PRIO_COLOR: Record<TaskPriority, string> = { high: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };

/** Parse both ISO (yyyy-mm-dd / full ISO) and dd.mm.yy(yy) into a local Date. */
function parseTaskDate(s: string): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s.slice(0, 10) + 'T00:00:00'); return isNaN(d.getTime()) ? null : d; }
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
  if (m) {
    let y = parseInt(m[3]); if (y < 100) y += 2000;
    const d = new Date(y, parseInt(m[2]) - 1, parseInt(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function TasksCalendar({ tasks, onTaskClick }: Props) {
  const { c: tc, isDark } = useTheme();
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() }; });

  const todayKey = keyOf(new Date());

  // Bucket tasks by day-key
  const byDay = useMemo(() => {
    const map: Record<string, CalTask[]> = {};
    tasks.forEach(t => {
      const d = parseTaskDate(t.date);
      if (!d) return;
      const k = keyOf(d);
      (map[k] = map[k] || []).push(t);
    });
    return map;
  }, [tasks]);

  // Build the 6-week grid
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());           // back to Sunday
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  const move = (delta: number) => setCursor(c => {
    const m = c.m + delta;
    return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  });

  const cellBg = isDark ? 'rgba(255,255,255,0.02)' : '#fff';
  const border = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';

  return (
    <div className="rounded-2xl overflow-hidden" dir="rtl" style={{ border: `1px solid ${border}`, background: cellBg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${border}` }}>
        <button onClick={() => move(-1)} className="p-1.5 rounded-lg hover:bg-white/10" style={{ color: tc.textMuted }}><ChevronRight size={18} /></button>
        <div className="flex items-center gap-2">
          <span className="font-black text-base" style={{ color: tc.textPrimary }}>{MONTHS[cursor.m]} {cursor.y}</span>
          <button onClick={() => setCursor({ y: new Date().getFullYear(), m: new Date().getMonth() })}
            className="text-[11px] px-2 py-0.5 rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', color: '#6366f1' }}>היום</button>
        </div>
        <button onClick={() => move(1)} className="p-1.5 rounded-lg hover:bg-white/10" style={{ color: tc.textMuted }}><ChevronLeft size={18} /></button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7">
        {DOW.map(d => (
          <div key={d} className="text-center py-2 text-xs font-bold" style={{ color: tc.textMuted }}>{d}</div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const k = keyOf(d);
          const inMonth = d.getMonth() === cursor.m;
          const isToday = k === todayKey;
          const dayTasks = byDay[k] || [];
          return (
            <div key={i} className="min-h-[92px] p-1.5 border-t border-l"
              style={{ borderColor: border, background: inMonth ? cellBg : (isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.02)'), opacity: inMonth ? 1 : 0.5 }}>
              <div className="flex justify-end mb-1">
                <span className={`text-[11px] font-semibold ${isToday ? 'text-white' : ''}`}
                  style={isToday
                    ? { background: '#6366f1', borderRadius: '999px', width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
                    : { color: tc.textMuted }}>
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-1">
                {dayTasks.slice(0, 3).map(t => (
                  <button key={t.id} onClick={() => onTaskClick(t.id)}
                    title={`${t.description}${t.leadCompany ? ' — ' + t.leadCompany : ''}`}
                    className="w-full text-right truncate rounded px-1 py-0.5 text-[10px] font-medium transition-all hover:opacity-80"
                    style={{
                      background: `${PRIO_COLOR[t.priority]}22`,
                      color: t.completed ? tc.textMuted : PRIO_COLOR[t.priority],
                      textDecoration: t.completed ? 'line-through' : 'none',
                      borderRight: `2px solid ${PRIO_COLOR[t.priority]}`,
                    }}>
                    {t.type ? TYPE_EMOJI[t.type] + ' ' : ''}{t.description}
                  </button>
                ))}
                {dayTasks.length > 3 && (
                  <div className="text-[10px] text-center" style={{ color: tc.textMuted }}>+{dayTasks.length - 3} נוספות</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
