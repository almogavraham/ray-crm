/**
 * taskMeta.ts — the shared vocabulary of a task: priorities and types.
 *
 * These lived inside the tasks page. Once the create dialog moved out into a
 * component the lead card could also use, they had to be either duplicated or
 * shared — and duplicating a label table is how the same priority ends up
 * called one thing on one screen and another thing on the next.
 */

import type { TaskPriority, TaskType } from '../types';

/** Priority styling for a light surface. */
export const PRIORITY_META: Record<TaskPriority, { label: string; pill: string; dot: string; border: string; icon: string }> = {
  high:   { label:'דחוף',   pill:'bg-red-100 text-red-700 border border-red-200',        dot:'bg-red-500',    border:'border-r-red-500',    icon:'🔴' },
  medium: { label:'בינוני', pill:'bg-amber-100 text-amber-700 border border-amber-200',  dot:'bg-amber-400',  border:'border-r-amber-400',  icon:'🟠' },
  low:    { label:'נמוך',   pill:'bg-blue-100 text-blue-700 border border-blue-200',     dot:'bg-blue-400',   border:'border-r-blue-400',   icon:'🔵' },
};

/** The same priorities on a dark surface, where the light pills disappear. */
export const DARK_PRIORITY: Record<TaskPriority, { bg: string; text: string; border: string; borderRight: string }> = {
  high:   { bg:'rgba(239,68,68,0.18)',   text:'#f87171', border:'rgba(239,68,68,0.3)',   borderRight:'#f87171' },
  medium: { bg:'rgba(245,158,11,0.15)',  text:'#fbbf24', border:'rgba(245,158,11,0.28)', borderRight:'#fbbf24' },
  low:    { bg:'rgba(99,102,241,0.15)',  text:'#818cf8', border:'rgba(99,102,241,0.28)', borderRight:'#818cf8' },
};

/** Display order of task types — the order they appear as buttons. */
export const TASK_TYPE_ORDER: TaskType[] = ['call','email','whatsapp','meeting','followup','proposal','other'];

export const TASK_TYPE_META: Record<TaskType, { label: string; emoji: string }> = {
  call:     { label: 'שיחה',    emoji: '📞' },
  email:    { label: 'מייל',    emoji: '✉️' },
  whatsapp: { label: 'וואטסאפ', emoji: '💬' },
  meeting:  { label: 'פגישה',   emoji: '📅' },
  followup: { label: 'מעקב',    emoji: '🔄' },
  proposal: { label: 'הצעה',    emoji: '📄' },
  other:    { label: 'כללי',    emoji: '📌' },
};
