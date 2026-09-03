/**
 * MorningPaymentsPanel — whether money is actually arriving.
 *
 * Every Morning notification was already written to Firestore, and nothing
 * could read it. The only way to tell whether the webhook was configured,
 * whether deliveries were arriving, or whether one had failed halfway was to
 * open the Cloud Functions log. A payment channel you cannot see is one you
 * find out about from the customer.
 *
 * Three questions, in the order they get asked:
 *
 *  1. Is the channel set up? The URL to paste into Morning, whether a signing
 *     secret exists on this deployment, and which environment is live — a
 *     sandbox key that quietly took over production is the failure this is
 *     here to make obvious.
 *  2. Did anything arrive?
 *  3. Did it get applied — and if not, why, and can it be retried?
 *
 * The retry matters most. The webhook acknowledges a delivery before
 * processing it, because Morning disables a webhook after 15 failures and a
 * disabled webhook loses every future payment in silence. The cost of that
 * choice is that a processing failure leaves a paying customer un-upgraded.
 * "נסה שוב" is the way back, and it is safe to press twice: the server claims
 * the Morning document id before granting anything, so a replay of an applied
 * payment fails on the claim rather than granting the plan again.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Copy, Check, ShieldCheck, ShieldAlert, AlertTriangle,
  CheckCircle2, Clock, RotateCcw, CreditCard,
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
// The app's one Functions instance, already pinned to us-central1. Creating a
// second here would work and then silently diverge the day the region moves.
import { functions } from '../lib/firebase';

interface Delivery {
  id: string;
  topic: string | null;
  signed: boolean;
  status: 'received' | 'applied' | 'failed' | string;
  receivedAt: string | null;
  appliedAt: string | null;
  workspaceId: string | null;
  type: string | null;
  planKey: string | null;
  amount: number | null;
  documentId: string | null;
  error: string | null;
}

interface Result {
  notifyUrl: string;
  signingConfigured: boolean;
  environment: 'production' | 'sandbox';
  deliveries: Delivery[];
}

const STATUS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  applied:  { label: 'הוחל',      color: '#34d399', icon: CheckCircle2 },
  received: { label: 'התקבל',     color: '#fbbf24', icon: Clock },
  failed:   { label: 'נכשל',      color: '#f87171', icon: AlertTriangle },
};

const fmtTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString('he-IL', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
};

export default function MorningPaymentsPanel({ onToast }: {
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [data, setData]       = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [copied, setCopied]   = useState(false);
  const [replaying, setReplaying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn = httpsCallable<{ limit: number }, Result>(
        functions, 'listMorningDeliveries',
      );
      setData((await fn({ limit: 50 })).data);
    } catch (e) {
      // Shown rather than swallowed: an empty list and a failed call look
      // identical on screen, and they mean opposite things.
      setError((e as Error).message || 'טעינת המשלוחים נכשלה');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copyUrl = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.notifyUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onToast?.('ההעתקה נכשלה — סמן והעתק ידנית', 'error');
    }
  };

  const replay = async (id: string) => {
    setReplaying(id);
    try {
      const fn = httpsCallable<{ deliveryId: string }, { status: string; message: string }>(
        functions, 'replayMorningDelivery',
      );
      const { data: r } = await fn({ deliveryId: id });
      onToast?.(r.message, r.status === 'applied' ? 'success' : 'error');
      await load();
    } catch (e) {
      onToast?.((e as Error).message || 'הניסיון החוזר נכשל', 'error');
    } finally {
      setReplaying(null);
    }
  };

  const card: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
  };

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full" dir="rtl">

      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold disabled:opacity-50"
          style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc' }}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> רענן
        </button>
        <div>
          <h1 className="text-xl font-black text-white">תשלומים — Morning</h1>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            מצב ערוץ הסליקה וההודעות שהתקבלו ממורנינג
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-[13px] font-semibold"
          style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* ── Channel setup ── */}
          <div className="grid gap-3 md:grid-cols-3">

            {/* The URL to paste into Morning's webhook settings. */}
            <div className="rounded-xl p-3.5 md:col-span-2" style={card}>
              <p className="text-[11px] font-black mb-1.5" style={{ color: 'rgba(255,255,255,0.4)' }}>
                כתובת ההודעות — הדבק בהגדרות ה-Webhook במורנינג
              </p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={copyUrl}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex-shrink-0"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: copied ? '#34d399' : 'rgba(255,255,255,0.6)' }}>
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'הועתק' : 'העתק'}
                </button>
                <code dir="ltr" className="flex-1 text-[11px] px-2.5 py-1.5 rounded-lg overflow-x-auto whitespace-nowrap"
                  style={{ background: 'rgba(0,0,0,0.3)', color: '#a5b4fc' }}>
                  {data.notifyUrl}
                </code>
              </div>
            </div>

            {/* Signing + environment. Both are one-glance facts that decide
                whether a delivery can be trusted and whose money moved. */}
            <div className="rounded-xl p-3.5 space-y-2.5" style={card}>
              <div className="flex items-center gap-2">
                {data.signingConfigured
                  ? <ShieldCheck size={14} style={{ color: '#34d399' }} />
                  : <ShieldAlert size={14} style={{ color: '#fbbf24' }} />}
                <span className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {data.signingConfigured ? 'חתימה מוגדרת' : 'ללא סוד חתימה'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CreditCard size={14} style={{ color: data.environment === 'production' ? '#34d399' : '#fbbf24' }} />
                <span className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {data.environment === 'production' ? 'סביבת ייצור — כסף אמיתי' : 'סביבת בדיקות (sandbox)'}
                </span>
              </div>
              {!data.signingConfigured && (
                <p className="text-[10.5px] leading-snug" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  ללא MORNING_WEBHOOK_SECRET אי אפשר לאמת חתימות. כל תשלום עדיין מאומת
                  מול ה-API של מורנינג לפני שהוא משנה מסלול, אבל זו שכבת הגנה אחת פחות.
                </p>
              )}
            </div>
          </div>

          {/* ── Deliveries ── */}
          <div className="rounded-xl overflow-hidden" style={card}>
            <div className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {data.deliveries.length} אחרונים
              </span>
              <span className="text-[12px] font-black" style={{ color: 'rgba(255,255,255,0.7)' }}>
                הודעות שהתקבלו
              </span>
            </div>

            {data.deliveries.length === 0 ? (
              /* An empty list here is information, not a blank slate: it means
                 Morning has never called, which is what an unconfigured or
                 wrongly-pasted webhook looks like. */
              <p className="px-4 py-10 text-center text-[13px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                טרם התקבלה הודעה ממורנינג.<br />
                אם כבר בוצע תשלום — בדוק שכתובת ההודעות למעלה מוגדרת בחשבון מורנינג.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                {data.deliveries.map(d => {
                  const s = STATUS[d.status] ?? STATUS.received;
                  return (
                    <div key={d.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
                      <span className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10.5px] font-black flex-shrink-0"
                        style={{ background: `${s.color}22`, color: s.color, border: `1px solid ${s.color}44` }}>
                        <s.icon size={11} />{s.label}
                      </span>

                      <div className="flex-1 min-w-[220px] space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap text-[12px]" style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {d.type && <span className="font-bold">{d.type === 'plan' ? `מסלול ${d.planKey ?? ''}` : 'טוקנים'}</span>}
                          {d.amount != null && <span className="font-black" style={{ color: '#a5b4fc' }}>₪{d.amount.toLocaleString()}</span>}
                          {d.workspaceId && <span className="text-[10.5px]" style={{ color: 'rgba(255,255,255,0.35)' }}>{d.workspaceId}</span>}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-[10.5px]" style={{ color: 'rgba(255,255,255,0.32)' }}>
                          <span>{fmtTime(d.receivedAt)}</span>
                          {d.topic && <span>· {d.topic}</span>}
                          <span>· {d.signed ? 'חתום' : 'לא חתום'}</span>
                          {d.documentId && <span dir="ltr">· doc {d.documentId}</span>}
                        </div>
                        {d.error && (
                          <p className="text-[11px] mt-1 leading-snug" style={{ color: '#fca5a5' }}>{d.error}</p>
                        )}
                      </div>

                      {/* Only what is stuck can be retried. Offering it on an
                          applied delivery would invite a click that can only
                          ever report a failure. */}
                      {d.status !== 'applied' && (
                        <button type="button" onClick={() => void replay(d.id)} disabled={replaying === d.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex-shrink-0 disabled:opacity-50"
                          style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc' }}>
                          <RotateCcw size={11} className={replaying === d.id ? 'animate-spin' : ''} />
                          {replaying === d.id ? 'מנסה...' : 'נסה שוב'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={22} className="animate-spin" style={{ color: '#6366f1' }} />
        </div>
      )}
    </div>
  );
}
