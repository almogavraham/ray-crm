/**
 * LeadViewBar — how the leads list is displayed, and the two panels that
 * change what is in it.
 *
 * Named saved views used to live here as tabs. They were removed: three
 * display modes plus a filter panel already answer "show me X as a board", and
 * a strip of named tabs that silently drift from the filters actually applied
 * is a list you stop trusting.
 *
 * The filter and column buttons sit beside the display switcher because all
 * three answer the same question — what am I looking at — and having them in
 * one place is what stops a fifth filter control appearing in the toolbar
 * later.
 */

import { Table2, LayoutGrid, Columns3, SlidersHorizontal, Columns } from 'lucide-react';
export type ViewMode = 'table' | 'board' | 'cards';

const MODES: { key: ViewMode; icon: React.ElementType; label: string }[] = [
  { key: 'table', icon: Table2,     label: 'טבלה' },
  { key: 'board', icon: Columns3,   label: 'לוח' },
  { key: 'cards', icon: LayoutGrid, label: 'כרטיסים' },
];

interface Props {
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  /** How many filters are narrowing the list right now. */
  filterCount: number;
  filtersOpen: boolean;
  onToggleFilters: () => void;
  /** Columns only exist in table mode, so the button only appears there. */
  showColumns: boolean;
  columnsOpen: boolean;
  onToggleColumns: () => void;
}

export default function LeadViewBar({
  mode, onMode, filterCount, filtersOpen, onToggleFilters,
  showColumns, columnsOpen, onToggleColumns,
}: Props) {
  const chip =
    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all flex-shrink-0';

  return (
    <div className="flex items-center gap-2 flex-wrap justify-between mb-3" dir="rtl">

      {/* Display mode */}
      <div className="flex items-center gap-1 rounded-xl p-0.5 flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
        {MODES.map(m => {
          const on = mode === m.key;
          return (
            <button key={m.key} type="button" onClick={() => onMode(m.key)} title={m.label}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
              style={on
                ? { background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }
                : { color: 'rgba(255,255,255,0.45)' }}>
              <m.icon size={13} />
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          );
        })}
      </div>

      {/* The panels that decide what the list contains and how it is laid out */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {showColumns && (
          <button type="button" onClick={onToggleColumns}
            title="בחר אילו עמודות מוצגות ובאיזה סדר"
            className={chip}
            style={columnsOpen
              ? { background: 'rgba(99,102,241,0.22)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.45)' }}>
            <Columns size={12} />
            ערוך עמודות
          </button>
        )}

        <button type="button" onClick={onToggleFilters}
          title="כל הסינונים — מקור, סוכן, תקציב, תאריכים ומצב טיפול"
          className={chip}
          style={filtersOpen || filterCount > 0
            ? { background: 'rgba(139,92,246,0.22)', border: '1px solid rgba(139,92,246,0.5)', color: '#c4b5fd', boxShadow: '0 0 10px rgba(139,92,246,0.18)' }
            : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.45)' }}>
          <SlidersHorizontal size={12} />
          סינון מתקדם
          {filterCount > 0 && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(139,92,246,0.35)', color: '#ddd6fe' }}>
              {filterCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
