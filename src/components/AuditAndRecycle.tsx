/**
 * AuditAndRecycle — the "what happened / undo it" screen.
 *
 * Two tabs because they answer two different questions people ask in a panic:
 * "who changed this?" and "can I get it back?". Keeping them together means one
 * place to look when something is wrong.
 *
 * The recycle bin lists what was deleted with its age, and restore puts the
 * original document back untouched. Permanent purge is deliberately awkward —
 * one row at a time, with a confirm — because there is no undo behind it.
 */

import { useEffect, useState } from 'react';
import {
  History, Trash2, RotateCcw, Loader2, ShieldCheck, AlertTriangle, RefreshCw,
} from 'lucide-react';
import {
  loadAudit, loadRecycleBin, restoreFromBin, purgeFromBin, daysInBin,
} from '../lib/auditTrail';
import type { AuditEntry, DeletedLead } from '../lib/auditTrail';

const ICON: Record<string, string> = {
  'lead.create': '➕', 'lead.update': '✏️', 'lead.delete': '🗑️', 'lead.restore': '♻️',
  'lead.status': '🔄', 'lead.bulk_delete': '🗑️', 'lead.bulk_status': '🔄',
  'lead.import': '📥', 'lead.export': '📤',
  'settings.status': '⚙️', 'settings.update': '⚙️',
  'team.invite': '✉️', 'team.remove': '👤', 'automation.run': '⚡',
};

/** Actions that changed many records at once get visual weight — they are the
 *  ones worth noticing in a long list. */
const HEAVY = new Set(['lead.import', 'lead.bulk_delete', 'lead.bulk_status']);

const when = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'עכשיו';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return new Date(t).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function AuditAndRecycle({ workspaceId, onToast, onRestored }: {
  workspaceId: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onRestored?: () => void;
}) {
  const [tab, setTab] = useState<'audit' | 'bin'>('audit');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [bin, setBin] = useState<DeletedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [a, b] = await Promise.all([loadAudit(workspaceId), loadRecycleBin(workspaceId)]);
      setAudit(a); setBin(b);
    } catch (e) {
      onToast(`טעינה נכשלה: ${(e as Error).message}`, 'error');
    } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); /* eslint-disable-next-line */ }, [workspaceId]);

  const restore = async (e: DeletedLead) => {
    setBusy(e.id);
    try {
      await restoreFromBin(workspaceId, e);
      setBin(prev => prev.filter(x => x.id !== e.id));
      onToast(`"${e.lead?.company || e.id}" שוחזר ✓`, 'success');
      onRestored?.();
    } catch (err) {
      onToast(`השחזור נכשל: ${(err as Error).message}`, 'error');
    } finally { setBusy(null); }
  };

  const purge = async (e: DeletedLead) => {
    if (!window.confirm(`למחוק לצמיתות את "${e.lead?.company || e.id}"?\n\nאין לזה ביטול.`)) return;
    setBusy(e.id);
    try {
      await purgeFromBin(workspaceId, e.id);
      setBin(prev => prev.filter(x => x.id !== e.id));
      onToast('נמחק לצמיתות', 'info');
    } catch (err) {
      onToast(`המחיקה נכשלה: ${(err as Error).message}`, 'error');
    } finally { setBusy(null); }
  };

  const Tab = ({ id, icon: Icon, label, n }: { id: 'audit' | 'bin'; icon: React.ElementType; label: string; n: number }) => (
    <button onClick={() => setTab(id)}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors"
      style={tab === id
        ? { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.45)', color: '#a5b4fc' }
        : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}>
      <Icon size={13} />{label}
      {n > 0 && <span className="tabular-nums opacity-70">({n})</span>}
    </button>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-2 justify-end flex-wrap">
        <button onClick={refresh} disabled={loading}
          className="p-2 rounded-xl disabled:opacity-40"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.45)' }}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
        <Tab id="bin"   icon={Trash2}  label="סל מיחזור" n={bin.length} />
        <Tab id="audit" icon={History} label="יומן פעילות" n={audit.length} />
      </div>

      {tab === 'audit' && (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          {loading ? (
            <p className="text-center py-12 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>טוען…</p>
          ) : audit.length === 0 ? (
            <div className="text-center py-14 px-6">
              <ShieldCheck size={26} className="mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.2)' }} />
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                היומן ריק. מכאן והלאה כל מחיקה, ייבוא ושינוי קבוצתי יתועדו כאן.
              </p>
            </div>
          ) : audit.map(e => (
            <div key={e.id} className="px-4 py-3 flex items-start gap-3 justify-end"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: HEAVY.has(e.action) ? 'rgba(245,158,11,0.05)' : undefined,
              }}>
              <div className="text-[10px] whitespace-nowrap flex-shrink-0 tabular-nums pt-0.5"
                style={{ color: 'rgba(255,255,255,0.3)' }}>{when(e.at)}</div>
              <div className="flex-1 min-w-0 text-right">
                <p className="text-[13px] leading-snug" style={{ color: 'rgba(255,255,255,0.82)' }}>{e.summary}</p>
                <p className="text-[10px] mt-0.5" style={{ color: 'rgba(255,255,255,0.32)' }}>
                  {e.actor || 'מערכת'}
                  {e.count ? ` · ${e.count} רשומות` : ''}
                </p>
              </div>
              <span className="text-sm flex-shrink-0">{ICON[e.action] ?? '•'}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'bin' && (
        <div className="space-y-3">
          <div className="rounded-xl px-4 py-2.5 text-[11px] flex items-start gap-2 justify-end"
            style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#a5b4fc' }}>
            <span className="text-right">לידים שנמחקו נשמרים כאן במלואם — כולל הערות, פעילות ופתרונות — וניתן להחזיר אותם בלחיצה.</span>
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          </div>

          <div className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {loading ? (
              <p className="text-center py-12 text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>טוען…</p>
            ) : bin.length === 0 ? (
              <div className="text-center py-14 px-6">
                <Trash2 size={26} className="mx-auto mb-2" style={{ color: 'rgba(255,255,255,0.2)' }} />
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>סל המיחזור ריק</p>
              </div>
            ) : bin.map(e => (
              <div key={e.id} className="px-4 py-3 flex items-center gap-3 justify-between"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => purge(e)} disabled={busy === e.id}
                    title="מחק לצמיתות"
                    className="p-1.5 rounded-lg disabled:opacity-40"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                    <Trash2 size={12} />
                  </button>
                  <button onClick={() => restore(e)} disabled={busy === e.id}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 disabled:opacity-40"
                    style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
                    {busy === e.id ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                    שחזר
                  </button>
                </div>
                <div className="text-right min-w-0 flex-1">
                  <p className="text-[13px] font-bold truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {e.lead?.company || e.id}
                  </p>
                  <p className="text-[10px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
                    {e.lead?.contactName ? `${e.lead.contactName} · ` : ''}
                    {e.lead?.status ? `${e.lead.status} · ` : ''}
                    נמחק {daysInBin(e) === 0 ? 'היום' : `לפני ${daysInBin(e)} ימים`}
                    {e.deletedBy ? ` ע״י ${e.deletedBy}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
