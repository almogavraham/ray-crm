/**
 * LeadFilterPanel — every leads filter, in one place.
 *
 * Replaces four separate surfaces (three quick chips, a "מקור" popover, a
 * standalone "לא טופלו" toggle and an advanced panel that repeated two of
 * them). The duplicates were not just clutter: source could be set in two
 * controls that did not agree, so the toolbar showed "הכל" while the list was
 * filtered.
 *
 * Grouped by the question being asked rather than by field type — "מי ומאיפה",
 * "כמה", "מתי", "מצב הטיפול" — because that is how someone arrives at the
 * panel: they want the forgotten leads, or the big ones, not "a text field".
 *
 * Every control writes through one `onChange`, and the count on the button
 * comes from the same shape, so the badge cannot disagree with the list.
 */

import { useEffect } from 'react';
import {
  X, Flame, ShieldAlert, Zap, AlertCircle, PhoneOff, Clock, CalendarDays,
  Flag, FileText, UserX, MailX, PhoneMissed, CheckSquare, RotateCcw,
} from 'lucide-react';
import type { LeadFilters, QuickFilter } from '../lib/leadFilters';
import { activeFilterCount, clearPanelFilters } from '../lib/leadFilters';

interface Props {
  filters: LeadFilters;
  onChange: (next: LeadFilters) => void;
  onClose: () => void;
  sources: string[];
  team: string[];
  untreatedCount: number;
  /** Label of the money field — workspaces rename it (e.g. "שווי עסקה"). */
  budgetLabel: string;
}

const QUICKS: { key: Exclude<QuickFilter, null>; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'hot',        label: 'חמים',       icon: Flame,       color: '#fb923c' },
  { key: 'objections', label: 'התנגדויות',  icon: ShieldAlert, color: '#f87171' },
  { key: 'new',        label: 'חדשים',      icon: Zap,         color: '#a5b4fc' },
];

export default function LeadFilterPanel({
  filters, onChange, onClose, sources, team, untreatedCount, budgetLabel,
}: Props) {
  const set = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) =>
    onChange({ ...filters, [k]: v });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const count = activeFilterCount(filters);

  const field =
    'w-full px-2.5 py-1.5 rounded-lg text-[12px] outline-none transition-colors';
  const fieldStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#fff',
  };

  const Label = ({ children }: { children: React.ReactNode }) => (
    <span className="block text-[10px] font-bold mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
      {children}
    </span>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="space-y-2.5">
      <p className="text-[11px] font-black tracking-wide" style={{ color: '#c4b5fd' }}>{title}</p>
      {children}
    </section>
  );

  /** A boolean filter. Reads as a sentence so its meaning survives without a
   *  tooltip — "לידים ללא טלפון" rather than a bare "טלפון". */
  const Toggle = ({ k, label, icon: Icon, color, badge }: {
    k: keyof LeadFilters; label: string; icon: React.ElementType; color: string; badge?: number;
  }) => {
    const on = Boolean(filters[k]);
    return (
      <button type="button" onClick={() => set(k, !on as never)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all"
        style={on
          ? { background: `${color}2e`, border: `1px solid ${color}80`, color }
          : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }}>
        <Icon size={11} />
        {label}
        {badge != null && badge > 0 && (
          <span className="text-[9px] font-black px-1 rounded-full"
            style={{ background: `${color}30`, color }}>{badge}</span>
        )}
      </button>
    );
  };

  return (
    <div className="px-3 pb-4 pt-3 space-y-4" dir="rtl"
      style={{ borderTop: '1px solid rgba(139,92,246,0.18)', background: 'rgba(139,92,246,0.05)' }}>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onChange(clearPanelFilters(filters))}
            disabled={count === 0}
            className="flex items-center gap-1 text-[10px] font-bold disabled:opacity-30"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <RotateCcw size={10} /> נקה הכל
          </button>
          <button type="button" onClick={onClose} aria-label="סגור סינון"
            className="p-1 rounded-lg" style={{ color: 'rgba(255,255,255,0.35)' }}>
            <X size={13} />
          </button>
        </div>
        <span className="text-[11px] font-black" style={{ color: '#c4b5fd' }}>
          סינון מתקדם{count > 0 && ` · ${count} פעילים`}
        </span>
      </div>

      {/* Quick filters — the three most-asked questions, kept as one-click
          chips but living inside the panel so there is no second copy in the
          toolbar to disagree with. */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {QUICKS.map(q => {
          const on = filters.quick === q.key;
          return (
            <button type="button" key={q.key}
              onClick={() => set('quick', on ? null : q.key)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-bold transition-all"
              style={on
                ? { background: `${q.color}2e`, border: `1px solid ${q.color}80`, color: q.color }
                : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.4)' }}>
              <q.icon size={11} />{q.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

        <Section title="מי ומאיפה">
          <div>
            <Label>מקור</Label>
            <select value={filters.source} onChange={e => set('source', e.target.value)}
              className={field} style={fieldStyle}>
              <option value="">הכל</option>
              {sources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <Label>משויך ל</Label>
            <select value={filters.assignedTo} onChange={e => set('assignedTo', e.target.value)}
              className={field} style={fieldStyle}>
              <option value="">כולם</option>
              {team.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <Label>קמפיין</Label>
            <input value={filters.campaign} onChange={e => set('campaign', e.target.value)}
              placeholder="utm_campaign..." className={field} style={fieldStyle} />
          </div>
        </Section>

        <Section title="כמה">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>{budgetLabel} — מ־</Label>
              <input type="number" inputMode="numeric" value={filters.budgetMin}
                onChange={e => set('budgetMin', e.target.value)}
                placeholder="0" className={field} style={fieldStyle} />
            </div>
            <div className="flex-1">
              <Label>עד</Label>
              <input type="number" inputMode="numeric" value={filters.budgetMax}
                onChange={e => set('budgetMax', e.target.value)}
                placeholder="∞" className={field} style={fieldStyle} />
            </div>
          </div>
          <div>
            <Label>ציון AI מינימלי</Label>
            <input type="number" inputMode="numeric" min={0} max={100} value={filters.scoreMin}
              onChange={e => set('scoreMin', e.target.value)}
              placeholder="0–100" className={field} style={fieldStyle} />
          </div>
          <div>
            <Label>התנגדות מכילה</Label>
            <input value={filters.objection} onChange={e => set('objection', e.target.value)}
              placeholder="יקר מדי..." className={field} style={fieldStyle} />
          </div>
        </Section>

        <Section title="מתי">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>נוצר מ־</Label>
              <input type="date" value={filters.createdFrom}
                onChange={e => set('createdFrom', e.target.value)}
                className={field} style={fieldStyle} />
            </div>
            <div className="flex-1">
              <Label>עד</Label>
              <input type="date" value={filters.createdTo}
                onChange={e => set('createdTo', e.target.value)}
                className={field} style={fieldStyle} />
            </div>
          </div>
          <div>
            <Label>עודכן ב־X הימים האחרונים</Label>
            <div className="flex items-center gap-1.5">
              <Clock size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input type="number" inputMode="numeric" min={0} value={filters.updatedWithin}
                onChange={e => set('updatedWithin', e.target.value)}
                placeholder="7" className={field} style={fieldStyle} />
            </div>
          </div>
          <div>
            {/* The one that finds forgotten leads — the inverse of the filter
                above, and the reason both are offered rather than one range. */}
            <Label>ללא מגע יותר מ־X ימים</Label>
            <div className="flex items-center gap-1.5">
              <CalendarDays size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
              <input type="number" inputMode="numeric" min={0} value={filters.staleOver}
                onChange={e => set('staleOver', e.target.value)}
                placeholder="14" className={field} style={fieldStyle} />
            </div>
          </div>
        </Section>

        <Section title="מצב הטיפול">
          <div className="flex flex-wrap gap-1.5">
            <Toggle k="untreated"      label="לא טופלו"        icon={AlertCircle}  color="#fbbf24" badge={untreatedCount} />
            <Toggle k="noAnswer"       label="מעקב שעבר"       icon={PhoneOff}     color="#f87171" />
            <Toggle k="overdueTask"    label="משימה באיחור"    icon={CheckSquare}  color="#f87171" />
            <Toggle k="noOpenTask"     label="ללא משימה פתוחה" icon={CheckSquare}  color="#94a3b8" />
            <Toggle k="waitingContent" label="ממתין לתוכן"     icon={FileText}     color="#fbbf24" />
            <Toggle k="flagged"        label="מסומן"           icon={Flag}         color="#c4b5fd" />
            <Toggle k="unassigned"     label="לא משויך"        icon={UserX}        color="#94a3b8" />
            <Toggle k="missingPhone"   label="ללא טלפון"       icon={PhoneMissed}  color="#94a3b8" />
            <Toggle k="missingEmail"   label="ללא אימייל"      icon={MailX}        color="#94a3b8" />
          </div>
        </Section>
      </div>
    </div>
  );
}
