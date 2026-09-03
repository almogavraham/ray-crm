/**
 * leadColumns.ts — which columns the leads table shows, and in what order.
 *
 * The table had eight hard-coded columns. Every workspace sells something
 * different, so for some of them a third of the width went to a field they
 * never fill in while the field they actually work from — the phone number, the
 * agent it is assigned to, the next follow-up — was not on screen at all.
 *
 * A column is described once here: its label, its width, and whether the table
 * can sort by it. The table renders from this list, so adding a column is one
 * entry plus one `case` in the cell renderer, and the header, the widths and
 * the empty-state colSpan all follow automatically instead of drifting apart.
 *
 * Two columns are pinned: the selection checkbox and the row actions. They are
 * not data about the lead, they are how you operate on the row, and a table
 * where the user can hide the checkbox is a table where bulk actions silently
 * stop working.
 *
 * Stored per workspace in localStorage. Column layout is a preference about
 * one person's own screen — closer to window size than to a shared report — so
 * it deliberately does not sync to the team the way saved statuses do.
 */

export type LeadColumnKey =
  | 'createdAt' | 'company' | 'contactName' | 'phone' | 'email'
  | 'status' | 'source' | 'budget' | 'lastUpdate' | 'aiScore'
  | 'assignedTo' | 'openTasks' | 'nextFollowUp' | 'lastContact'
  | 'objection' | 'campaign';

export interface LeadColumnDef {
  key: LeadColumnKey;
  label: string;
  /** Percentage of the table, as a CSS width. The pinned columns take the rest. */
  width: string;
  /** Present when the header should be clickable to sort. */
  sortField?: 'company' | 'status' | 'budget' | 'lastUpdate' | 'aiScore' | 'createdAt';
}

export const LEAD_COLUMNS: LeadColumnDef[] = [
  { key: 'createdAt',    label: 'תאריך יצירה',   width: '9%',  sortField: 'createdAt' },
  { key: 'company',      label: 'שם / חברה',      width: '18%', sortField: 'company' },
  { key: 'contactName',  label: 'איש קשר',        width: '11%' },
  { key: 'phone',        label: 'טלפון',          width: '11%' },
  { key: 'email',        label: 'אימייל',         width: '14%' },
  { key: 'status',       label: 'סטטוס',          width: '10%', sortField: 'status' },
  { key: 'source',       label: 'מקור',           width: '9%'  },
  { key: 'budget',       label: 'תקציב',          width: '9%',  sortField: 'budget' },
  { key: 'lastUpdate',   label: 'עדכון אחרון',    width: '9%',  sortField: 'lastUpdate' },
  { key: 'aiScore',      label: 'ציון AI',        width: '6%',  sortField: 'aiScore' },
  { key: 'assignedTo',   label: 'משויך ל',        width: '10%' },
  { key: 'openTasks',    label: 'משימות פתוחות',  width: '8%'  },
  { key: 'nextFollowUp', label: 'מעקב הבא',       width: '9%'  },
  { key: 'lastContact',  label: 'מגע אחרון',      width: '9%'  },
  { key: 'objection',    label: 'התנגדות',        width: '11%' },
  { key: 'campaign',     label: 'קמפיין',         width: '11%' },
];

export const COLUMN_BY_KEY: Record<string, LeadColumnDef> =
  Object.fromEntries(LEAD_COLUMNS.map(c => [c.key, c]));

/** What the table showed before it was configurable, so nobody's screen moves
 *  on the day this ships. */
export const DEFAULT_COLUMN_KEYS: LeadColumnKey[] = [
  'createdAt', 'company', 'contactName', 'status', 'budget', 'lastUpdate', 'aiScore',
];

const storageKey = (wid: string) => `ray_lead_columns_${wid || 'default'}`;

export function loadColumnKeys(wid: string): LeadColumnKey[] {
  try {
    const raw = localStorage.getItem(storageKey(wid));
    if (!raw) return [...DEFAULT_COLUMN_KEYS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_COLUMN_KEYS];
    // Drop anything this build no longer defines, so removing a column from the
    // code does not leave a saved layout rendering a blank column forever.
    const keys = parsed.filter((k): k is LeadColumnKey => typeof k === 'string' && k in COLUMN_BY_KEY);
    return keys.length ? keys : [...DEFAULT_COLUMN_KEYS];
  } catch {
    return [...DEFAULT_COLUMN_KEYS];
  }
}

export function saveColumnKeys(wid: string, keys: LeadColumnKey[]): void {
  try { localStorage.setItem(storageKey(wid), JSON.stringify(keys)); } catch { /* private mode */ }
}
