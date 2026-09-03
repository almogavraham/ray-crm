/**
 * LeadColumnsPanel — pick the table's columns and their order.
 *
 * Two lists side by side: what is shown, in order, and what is available. The
 * shown list is the one that carries the order, so moving a column and removing
 * a column happen in the same place rather than in two different mental models.
 *
 * Reordering is arrows, not drag. Drag looks better in a screenshot and is
 * worse to use: it needs a pointer, it fights the page scroll on a laptop
 * trackpad, and it is unusable on a touch screen — which is where half of this
 * product is read. Arrows work everywhere and are reachable from the keyboard.
 *
 * The checkbox and the actions columns are not offered. They are not data about
 * the lead; they are how you operate on the row, and hiding the checkbox would
 * silently take bulk actions away.
 */

import { X, ArrowUp, ArrowDown, Plus, Minus, RotateCcw } from 'lucide-react';
import type { LeadColumnKey } from '../lib/leadColumns';
import { LEAD_COLUMNS, COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS } from '../lib/leadColumns';

interface Props {
  keys: LeadColumnKey[];
  onChange: (next: LeadColumnKey[]) => void;
  onClose: () => void;
  /** Workspaces rename the money column, so its real label is passed in. */
  budgetLabel?: string;
}

export default function LeadColumnsPanel({ keys, onChange, onClose, budgetLabel }: Props) {
  const labelOf = (k: LeadColumnKey) =>
    k === 'budget' && budgetLabel ? budgetLabel : (COLUMN_BY_KEY[k]?.label ?? k);

  const available = LEAD_COLUMNS.filter(c => !keys.includes(c.key));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const row =
    'flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold';
  const rowStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.7)',
  };
  const iconBtn = 'p-1 rounded-md transition-colors disabled:opacity-25';

  return (
    <div className="px-3 pb-4 pt-3 space-y-3" dir="rtl"
      style={{ borderTop: '1px solid rgba(99,102,241,0.18)', background: 'rgba(99,102,241,0.05)' }}>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onChange([...DEFAULT_COLUMN_KEYS])}
            className="flex items-center gap-1 text-[10px] font-bold"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <RotateCcw size={10} /> ברירת מחדל
          </button>
          <button type="button" onClick={onClose} aria-label="סגור עריכת עמודות"
            className="p-1 rounded-lg" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <X size={13} />
          </button>
        </div>
        <span className="text-[11px] font-black" style={{ color: '#a5b4fc' }}>
          עריכת עמודות · {keys.length} מוצגות
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">

        {/* Shown, in order */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>
            מוצגות (לפי הסדר)
          </p>
          {keys.length === 0 && (
            <p className="text-[11px] py-3 text-center rounded-lg"
              style={{ color: 'rgba(255,255,255,0.3)', border: '1px dashed rgba(255,255,255,0.12)' }}>
              אין עמודות — הוסף לפחות אחת
            </p>
          )}
          {keys.map((k, i) => (
            <div key={k} className={row} style={rowStyle}>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  title="הזז ימינה" aria-label={`הזז ${labelOf(k)} ימינה`}
                  className={iconBtn} style={{ color: '#a5b4fc' }}>
                  <ArrowUp size={12} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === keys.length - 1}
                  title="הזז שמאלה" aria-label={`הזז ${labelOf(k)} שמאלה`}
                  className={iconBtn} style={{ color: '#a5b4fc' }}>
                  <ArrowDown size={12} />
                </button>
                <button type="button" onClick={() => onChange(keys.filter(x => x !== k))}
                  title="הסר עמודה" aria-label={`הסר את ${labelOf(k)}`}
                  className={iconBtn} style={{ color: '#f87171' }}>
                  <Minus size={12} />
                </button>
              </div>
              <span className="truncate">{i + 1}. {labelOf(k)}</span>
            </div>
          ))}
        </div>

        {/* Available */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>
            זמינות להוספה
          </p>
          {available.length === 0 && (
            <p className="text-[11px] py-3 text-center rounded-lg"
              style={{ color: 'rgba(255,255,255,0.3)', border: '1px dashed rgba(255,255,255,0.12)' }}>
              כל העמודות כבר מוצגות
            </p>
          )}
          {available.map(c => (
            <div key={c.key} className={row} style={rowStyle}>
              <button type="button" onClick={() => onChange([...keys, c.key])}
                title="הוסף עמודה" aria-label={`הוסף את ${labelOf(c.key)}`}
                className={iconBtn} style={{ color: '#34d399' }}>
                <Plus size={12} />
              </button>
              <span className="truncate">{labelOf(c.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
