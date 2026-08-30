/**
 * leadViews.ts — named, shareable views of the leads screen.
 *
 * Two things people do constantly and could not do before:
 *
 *  1. Keep a filter. Every filter was one-shot — set it, use it, lose it on
 *     reload. Zoho's saved custom views ("כל הלידים", "לידים בתהליך") are the
 *     single most-used thing on that screen, and the cheapest gap to close.
 *  2. Look at the same set a different way. A pipeline reads better as a board,
 *     a call list reads better as a table.
 *
 * A view therefore stores BOTH the filter set and the display mode, because in
 * practice they travel together: "my hot leads, as a board" is one thought, not
 * two settings.
 *
 * Stored per workspace under `config/leadViews`, so a view a manager builds is
 * visible to the whole team. Personal scratch state stays in the URL/local
 * state and is never written here.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

export type ViewMode = 'table' | 'board' | 'cards';

export interface LeadViewFilters {
  search: string;
  activeStatus: string;         // 'הכל' or a status label
  sourceFilter: string;
  quickFilter: string | null;   // 'hot' | 'objections' | 'new' | null
  filterObjection: string;
  filterSource: string;
  filterNoAnswer: boolean;
  filterUntreated: boolean;
  sortField: string;
  sortDir: 'asc' | 'desc';
}

export interface LeadView {
  id: string;
  name: string;
  mode: ViewMode;
  filters: LeadViewFilters;
  /** Views shipped with the product cannot be renamed or deleted. */
  builtIn?: boolean;
  createdBy?: string;
  createdAt?: number;
}

export const EMPTY_FILTERS: LeadViewFilters = {
  search: '',
  activeStatus: 'הכל',
  sourceFilter: '',
  quickFilter: null,
  filterObjection: '',
  filterSource: '',
  filterNoAnswer: false,
  filterUntreated: false,
  sortField: 'lastUpdate',
  sortDir: 'desc',
};

/**
 * Always-present views. They cover the three questions people open the leads
 * screen to answer, so a new workspace is useful before anyone configures
 * anything.
 */
export const BUILT_IN_VIEWS: LeadView[] = [
  {
    id: 'all', name: 'כל הלידים', mode: 'table', builtIn: true,
    filters: { ...EMPTY_FILTERS },
  },
  {
    id: 'pipeline', name: 'פייפליין', mode: 'board', builtIn: true,
    filters: { ...EMPTY_FILTERS },
  },
  {
    id: 'hot', name: 'לידים חמים', mode: 'cards', builtIn: true,
    filters: { ...EMPTY_FILTERS, quickFilter: 'hot' },
  },
  {
    id: 'untouched', name: 'ללא מגע', mode: 'table', builtIn: true,
    filters: { ...EMPTY_FILTERS, filterUntreated: true },
  },
];

const viewsDoc = (wid: string) => doc(db, 'workspaces', wid, 'config', 'leadViews');

export async function loadLeadViews(wid: string): Promise<LeadView[]> {
  try {
    const snap = await getDoc(viewsDoc(wid));
    const saved = snap.exists() ? ((snap.data().views ?? []) as LeadView[]) : [];
    // Built-ins are re-derived from code rather than stored, so improving one
    // improves it for every existing workspace.
    return [...BUILT_IN_VIEWS, ...saved.filter(v => !v.builtIn)];
  } catch {
    return [...BUILT_IN_VIEWS];
  }
}

export async function saveLeadViews(wid: string, views: LeadView[]): Promise<void> {
  await setDoc(viewsDoc(wid), { views: views.filter(v => !v.builtIn) }, { merge: true });
}

/** True when the live filter state differs from what the view stored. */
export function isDirty(view: LeadView | null, current: LeadViewFilters, mode: ViewMode): boolean {
  if (!view) return false;
  if (view.mode !== mode) return true;
  return (Object.keys(EMPTY_FILTERS) as (keyof LeadViewFilters)[])
    .some(k => (view.filters[k] ?? EMPTY_FILTERS[k]) !== current[k]);
}

/** How many filters are actually narrowing the list — drives the "N פילטרים" chip. */
export function activeFilterCount(f: LeadViewFilters): number {
  let n = 0;
  if (f.search) n++;
  if (f.activeStatus && f.activeStatus !== 'הכל') n++;
  if (f.sourceFilter) n++;
  if (f.quickFilter) n++;
  if (f.filterObjection) n++;
  if (f.filterSource) n++;
  if (f.filterNoAnswer) n++;
  if (f.filterUntreated) n++;
  return n;
}
