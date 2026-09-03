/**
 * leadFilters.ts — one definition of "which leads am I looking at".
 *
 * The leads screen had grown four separate filter surfaces: three quick chips,
 * a "מקור" popover, a standalone "לא טופלו" toggle, and a "סינון מתקדם" panel
 * that filtered by source and by untreated *again*. Two controls for one
 * question are worse than none: set the source in one and the other still reads
 * "הכל", so the screen contradicts itself about what it is showing.
 *
 * Everything now lives in one shape, evaluated by one predicate, edited in one
 * panel. Adding a filter means adding a field here and a control there — not a
 * new chip in the toolbar that every existing filter has to be reconciled with.
 *
 * The date helpers live here too because the predicate needs them and they were
 * previously copied per page, which is how "5.8.2026" came to parse as 0 on one
 * screen and correctly on another.
 */

import type { Lead, Task } from '../types';

/* ─── shared date parsing ───────────────────────────────────────────────────*/

/**
 * Leads are stamped with `toLocaleDateString('he-IL')`, which yields DOT
 * separators ("5.8.2026"), not slashes. Handling only '/' makes every freshly
 * created lead parse as 0 and sink to the bottom of a lastUpdate sort, looking
 * to the user like it was never saved.
 */
export function parseLeadDate(d: string | undefined): number {
  if (!d) return 0;
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const ts = new Date(s.slice(0, 10) + 'T00:00:00').getTime();
    return isNaN(ts) ? 0 : ts;
  }
  if (/^\d{10,}$/.test(s)) {
    const ts = Number(s);
    return isNaN(ts) ? 0 : ts;
  }
  const sep = s.includes('/') ? '/' : '.';
  const p = s.split(sep);
  if (p.length !== 3) return 0;
  const [day, month, yearRaw] = p.map(Number);
  if (!day || !month || !yearRaw) return 0;
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  const ts = new Date(year, month - 1, day).getTime();
  return isNaN(ts) ? 0 : ts;
}

export function daysSinceLeadDate(s: string | undefined): number {
  const ts = parseLeadDate(s);
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

export function isTaskOverdue(dateStr: string): boolean {
  try {
    return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
  } catch { return false; }
}

/* ─── the filter shape ──────────────────────────────────────────────────────*/

export type QuickFilter = 'hot' | 'objections' | 'new' | null;

export interface LeadFilters {
  /** Free text across company, contact, phone and email. */
  search: string;
  /** A status label, or 'הכל'. Driven by the status tabs; stored here so the
   *  filtering logic has one input and not two. */
  status: string;
  quick: QuickFilter;

  source: string;
  assignedTo: string;
  campaign: string;
  objection: string;

  budgetMin: string;
  budgetMax: string;
  scoreMin: string;

  /** Created on/after and on/before, as yyyy-mm-dd from a date input. */
  createdFrom: string;
  createdTo: string;
  /** Touched within the last N days — "מה זז השבוע". */
  updatedWithin: string;
  /** Untouched for at least N days — the opposite question, and the one that
   *  actually finds forgotten leads. */
  staleOver: string;

  untreated: boolean;
  noAnswer: boolean;
  overdueTask: boolean;
  noOpenTask: boolean;
  waitingContent: boolean;
  flagged: boolean;
  missingPhone: boolean;
  missingEmail: boolean;
  unassigned: boolean;
}

export const EMPTY_LEAD_FILTERS: LeadFilters = {
  search: '', status: 'הכל', quick: null,
  source: '', assignedTo: '', campaign: '', objection: '',
  budgetMin: '', budgetMax: '', scoreMin: '',
  createdFrom: '', createdTo: '', updatedWithin: '', staleOver: '',
  untreated: false, noAnswer: false, overdueTask: false, noOpenTask: false,
  waitingContent: false, flagged: false,
  missingPhone: false, missingEmail: false, unassigned: false,
};

/** Filters the panel owns. "נקה הכל" clears these and leaves search and status
 *  alone — those are set elsewhere on screen, and a button inside the panel
 *  silently emptying the search box reads as a bug. */
export const PANEL_KEYS: (keyof LeadFilters)[] = [
  'quick', 'source', 'assignedTo', 'campaign', 'objection',
  'budgetMin', 'budgetMax', 'scoreMin',
  'createdFrom', 'createdTo', 'updatedWithin', 'staleOver',
  'untreated', 'noAnswer', 'overdueTask', 'noOpenTask',
  'waitingContent', 'flagged', 'missingPhone', 'missingEmail', 'unassigned',
];

const isSet = (f: LeadFilters, k: keyof LeadFilters): boolean => {
  const v = f[k];
  if (k === 'status') return typeof v === 'string' && v !== '' && v !== 'הכל';
  if (typeof v === 'boolean') return v;
  return v != null && v !== '';
};

/** How many panel filters are actually narrowing the list — drives the badge. */
export function activeFilterCount(f: LeadFilters): number {
  return PANEL_KEYS.filter(k => isSet(f, k)).length;
}

export function clearPanelFilters(f: LeadFilters): LeadFilters {
  const next: LeadFilters = { ...f };
  for (const k of PANEL_KEYS) {
    (next as unknown as Record<string, unknown>)[k] =
      (EMPTY_LEAD_FILTERS as unknown as Record<string, unknown>)[k];
  }
  return next;
}

/* ─── the predicate ─────────────────────────────────────────────────────────*/

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (isFinite(Number(v)) ? Number(v) : 0);

/** A lead that was created and then never worked. */
export const isUntreated = (l: Lead): boolean =>
  l.status === 'חדש' && !arr(l.activityLog).length && !l.lastContactDate;

export interface FilterContext {
  /** "Hot" is a tunable judgement the screen owns, so the caller supplies it. */
  isHot: (l: Lead) => boolean;
}

export function matchesLeadFilters(l: Lead, f: LeadFilters, ctx: FilterContext): boolean {
  const q = f.search.trim().toLowerCase();
  if (q && ![l.company, l.contactName, l.phone, l.email]
    .some(v => str(v).toLowerCase().includes(q))) return false;

  if (f.status && f.status !== 'הכל' && l.status !== f.status) return false;

  if (f.quick === 'hot' && !ctx.isHot(l)) return false;
  if (f.quick === 'objections' && !l.objection) return false;
  if (f.quick === 'new') {
    const weekAgo = Date.now() - 7 * 86400000;
    if (!(parseLeadDate(l.lastUpdate) >= weekAgo || l.status === 'חדש')) return false;
  }

  if (f.source && l.source !== f.source) return false;
  if (f.assignedTo && l.assignedTo !== f.assignedTo) return false;
  if (f.campaign && !str(l.utmCampaign).toLowerCase().includes(f.campaign.toLowerCase())) return false;
  if (f.objection && !str(l.objection).toLowerCase().includes(f.objection.toLowerCase())) return false;

  if (f.budgetMin !== '' && num(l.budget) < Number(f.budgetMin)) return false;
  if (f.budgetMax !== '' && num(l.budget) > Number(f.budgetMax)) return false;
  if (f.scoreMin !== '' && num(l.aiScore) < Number(f.scoreMin)) return false;

  // A date input gives a local yyyy-mm-dd. Comparing against midnight and
  // end-of-day means "from 1.9" includes a lead created at 09:00 on 1.9, which
  // is what the person picking the date meant.
  if (f.createdFrom) {
    const from = new Date(f.createdFrom + 'T00:00:00').getTime();
    if (!l.createdAt || l.createdAt < from) return false;
  }
  if (f.createdTo) {
    const to = new Date(f.createdTo + 'T23:59:59').getTime();
    if (!l.createdAt || l.createdAt > to) return false;
  }
  if (f.updatedWithin !== '' && daysSinceLeadDate(l.lastUpdate) > Number(f.updatedWithin)) return false;
  if (f.staleOver !== '' && daysSinceLeadDate(l.lastUpdate) < Number(f.staleOver)) return false;

  if (f.untreated && !isUntreated(l)) return false;
  if (f.noAnswer && !(l.nextFollowUpDate && new Date(l.nextFollowUpDate) < new Date())) return false;

  const openTasks = arr<Task>(l.tasks).filter(t => !t.completed);
  if (f.overdueTask && !openTasks.some(t => isTaskOverdue(t.date))) return false;
  if (f.noOpenTask && openTasks.length > 0) return false;

  if (f.waitingContent && !l.waitingContent) return false;
  if (f.flagged && !l.flagColor) return false;
  if (f.missingPhone && str(l.phone).trim()) return false;
  if (f.missingEmail && str(l.email).trim()) return false;
  if (f.unassigned && str(l.assignedTo).trim()) return false;

  return true;
}
