/**
 * LeadViewBar — the saved-view + display-mode strip above the leads table.
 *
 * Sits where the eye already goes before scanning rows, so switching context
 * ("show me the pipeline as a board") is one click rather than re-applying four
 * filters. Mirrors the pattern people already know from other CRMs: named tabs
 * on the right, display toggle on the left.
 *
 * The "unsaved changes" state is explicit on purpose. Silently drifting away
 * from a named view is how people end up trusting a list that no longer means
 * what its name says.
 */

import { useState } from 'react';
import { Table2, LayoutGrid, Columns3, Plus, Check, X, Trash2, RotateCcw } from 'lucide-react';
import type { LeadView, ViewMode, LeadViewFilters } from '../lib/leadViews';
import { activeFilterCount } from '../lib/leadViews';

const MODES: { key: ViewMode; icon: React.ElementType; label: string }[] = [
  { key: 'table', icon: Table2,     label: 'טבלה' },
  { key: 'board', icon: Columns3,   label: 'לוח' },
  { key: 'cards', icon: LayoutGrid, label: 'כרטיסים' },
];

interface Props {
  views: LeadView[];
  activeId: string;
  mode: ViewMode;
  filters: LeadViewFilters;
  dirty: boolean;
  onPick: (v: LeadView) => void;
  onMode: (m: ViewMode) => void;
  onSaveAs: (name: string) => void;
  onUpdate: () => void;
  onRevert: () => void;
  onDelete: (id: string) => void;
}

export default function LeadViewBar({
  views, activeId, mode, filters, dirty,
  onPick, onMode, onSaveAs, onUpdate, onRevert, onDelete,
}: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const active = views.find(v => v.id === activeId) ?? null;
  const count = activeFilterCount(filters);

  const commit = () => {
    const n = name.trim();
    if (!n) return;
    onSaveAs(n);
    setName(''); setNaming(false);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap-reverse justify-between mb-3" dir="rtl">

      {/* Display mode — left side, away from the view tabs it does not belong to */}
      <div className="flex items-center gap-1 rounded-xl p-0.5 flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
        {MODES.map(m => {
          const on = mode === m.key;
          return (
            <button key={m.key} onClick={() => onMode(m.key)} title={m.label}
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

      {/* Saved views */}
      <div className="flex items-center gap-1.5 flex-wrap justify-end flex-1 min-w-0">
        {dirty && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={onRevert} title="בטל שינויים וחזור לתצוגה השמורה"
              className="p-1.5 rounded-lg text-[11px]"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)' }}>
              <RotateCcw size={12} />
            </button>
            {active && !active.builtIn && (
              <button onClick={onUpdate}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1"
                style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399' }}>
                <Check size={12} />עדכן
              </button>
            )}
          </div>
        )}

        {naming ? (
          <div className="flex items-center gap-1 flex-shrink-0">
            <input
              autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setNaming(false); setName(''); } }}
              placeholder="שם התצוגה"
              className="w-32 rounded-lg px-2 py-1.5 text-[11px] text-right focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(99,102,241,0.5)', color: '#fff' }} />
            <button onClick={commit} className="p-1.5 rounded-lg"
              style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc' }}><Check size={12} /></button>
            <button onClick={() => { setNaming(false); setName(''); }} className="p-1.5 rounded-lg"
              style={{ color: 'rgba(255,255,255,0.35)' }}><X size={12} /></button>
          </div>
        ) : (
          <button onClick={() => setNaming(true)}
            title={count ? `שמור את ${count} הפילטרים הפעילים כתצוגה` : 'שמור תצוגה חדשה'}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.5)' }}>
            <Plus size={12} />שמור תצוגה
          </button>
        )}

        <div className="w-px h-5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

        {views.map(v => {
          const on = v.id === activeId;
          return (
            <div key={v.id} className="relative group flex-shrink-0">
              <button onClick={() => onPick(v)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors"
                style={on
                  ? { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.45)', color: '#a5b4fc' }
                  : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}>
                {v.name}
                {on && dirty && <span title="יש שינויים שלא נשמרו" className="mr-1" style={{ color: '#fbbf24' }}>•</span>}
              </button>
              {!v.builtIn && (
                <button onClick={() => onDelete(v.id)} title="מחק תצוגה"
                  className="absolute -top-1.5 -left-1.5 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: '#7f1d1d', color: '#fca5a5' }}>
                  <Trash2 size={9} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
