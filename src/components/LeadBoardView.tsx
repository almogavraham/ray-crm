/**
 * LeadBoardView / LeadCardsView — the two non-table ways to read the leads list.
 *
 * Both render whatever the current filters already produced, so switching mode
 * never changes *which* leads you see, only how. That predictability is the
 * whole point: people switch mode mid-thought and must not lose their place.
 *
 * The board is deliberately drag-free. A drag that silently rewrites a status
 * is exactly the kind of accidental bulk edit that cost this workspace its
 * pipeline once already; moving a lead stays an explicit act on the card.
 */

import type { Lead } from '../types';
import type { StatusConfig } from '../lib/statusConfig';
import { Flame, MessageSquare, ListChecks } from 'lucide-react';

const money = (n: number) => `₪${(Number(n) || 0).toLocaleString('he-IL')}`;

function initials(name: string): string {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('');
}

/* ── Board: one column per pipeline status ─────────────────────────────────── */
export function LeadBoardView({ leads, statusConfigs, onLeadClick }: {
  leads: Lead[];
  statusConfigs: StatusConfig[];
  onLeadClick: (l: Lead) => void;
}) {
  const columns = statusConfigs.filter(s => s.pipeline !== false);
  // Anything whose status has no column still has to appear, or the board would
  // quietly hide leads — the failure mode we just spent a day undoing.
  const known = new Set(columns.map(c => c.label));
  const orphans = leads.filter(l => !known.has(l.status));

  const cols = [
    ...columns.map(c => ({
      key: c.label, label: c.label, color: c.color, emoji: c.emoji,
      items: leads.filter(l => l.status === c.label),
    })),
    ...(orphans.length ? [{ key: '__orphan', label: 'ללא סטטוס מוגדר', color: '#f59e0b', emoji: '⚠️', items: orphans }] : []),
  ];

  return (
    <div className="overflow-x-auto pb-3" dir="rtl">
      <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
        {cols.map(col => {
          const total = col.items.reduce((s, l) => s + (Number(l.budget) || 0), 0);
          return (
            <div key={col.key} className="flex-shrink-0 rounded-2xl flex flex-col"
              style={{ width: 268, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', maxHeight: 660 }}>
              <div className="px-3 py-2.5 flex items-center justify-between flex-shrink-0"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
                  style={{ background: `${col.color}22`, color: col.color }}>{col.items.length}</span>
                <div className="text-right min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: col.color }}>
                    {col.emoji} {col.label}
                  </div>
                  {total > 0 && <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{money(total)}</div>}
                </div>
              </div>

              <div className="p-2 space-y-2 overflow-y-auto">
                {col.items.length === 0 && (
                  <p className="text-[11px] text-center py-6" style={{ color: 'rgba(255,255,255,0.2)' }}>ריק</p>
                )}
                {col.items.map(l => (
                  <button key={l.id} onClick={() => onLeadClick(l)}
                    className="w-full text-right rounded-xl p-2.5 transition-transform hover:scale-[1.02]"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderInlineStart: l.flagColor ? `3px solid ${l.flagColor}` : undefined,
                    }}>
                    <div className="flex items-start gap-1.5 justify-end">
                      {l.isHot && <Flame size={11} className="flex-shrink-0 mt-0.5" style={{ color: '#f97316' }} />}
                      <span className="text-xs font-bold truncate flex-1" style={{ color: 'rgba(255,255,255,0.9)' }}>
                        {l.company || '—'}
                      </span>
                    </div>
                    {l.contactName && (
                      <div className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>{l.contactName}</div>
                    )}
                    <div className="flex items-center gap-2 justify-end mt-2 text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                      {(l.tasks ?? []).filter(t => !t.completed).length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <ListChecks size={9} />{(l.tasks ?? []).filter(t => !t.completed).length}
                        </span>
                      )}
                      {(l.notes ?? []).length > 0 && (
                        <span className="flex items-center gap-0.5"><MessageSquare size={9} />{(l.notes ?? []).length}</span>
                      )}
                      {l.budget > 0 && <span className="font-bold tabular-nums" style={{ color: '#34d399' }}>{money(l.budget)}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Cards: a denser grid for scanning many leads at once ──────────────────── */
export function LeadCardsView({ leads, statusConfigs, onLeadClick }: {
  leads: Lead[];
  statusConfigs: StatusConfig[];
  onLeadClick: (l: Lead) => void;
}) {
  const colorOf = (status: string) =>
    statusConfigs.find(s => s.label === status)?.color ?? '#6366f1';

  if (!leads.length) {
    return <p className="text-center py-16 text-sm" style={{ color: 'rgba(255,255,255,0.3)' }}>אין לידים להצגה</p>;
  }

  return (
    <div dir="rtl" className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}>
      {leads.map(l => {
        const c = colorOf(l.status);
        return (
          <button key={l.id} onClick={() => onLeadClick(l)}
            className="text-right rounded-2xl p-3.5 transition-transform hover:scale-[1.02]"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderInlineStart: l.flagColor ? `3px solid ${l.flagColor}` : `3px solid ${c}55`,
            }}>
            <div className="flex items-start gap-2 justify-end">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-black flex-shrink-0"
                style={{ background: `${c}22`, color: c }}>{initials(l.company)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 justify-end">
                  {l.isHot && <Flame size={11} style={{ color: '#f97316' }} />}
                  <span className="text-sm font-bold truncate" style={{ color: 'rgba(255,255,255,0.9)' }}>{l.company || '—'}</span>
                </div>
                <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.4)' }}>{l.contactName || '—'}</div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 justify-end mt-3 flex-wrap">
              <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${c}22`, color: c }}>
                {l.status}
              </span>
              {l.source && (
                <span className="text-[9.5px] px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}>{l.source}</span>
              )}
            </div>

            <div className="flex items-center justify-between mt-2.5 text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
              <span className="tabular-nums">{l.lastUpdate || ''}</span>
              {l.budget > 0 && <span className="font-bold tabular-nums" style={{ color: '#34d399' }}>{money(l.budget)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
