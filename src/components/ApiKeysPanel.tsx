/**
 * ApiKeysPanel — issue and revoke the credentials for the public API.
 *
 * The whole design turns on one constraint: a key is shown exactly once. Only
 * its SHA-256 hash is stored, so nobody — including us — can produce it again.
 * That is what makes a leaked database useless for API access, and it is why
 * this panel does not have a "show key" button on the list: there is nothing
 * to show.
 *
 * So the moment of creation carries the whole weight. The new key appears in a
 * panel that has to be dismissed deliberately, with copying made trivial and
 * the consequence stated before the user closes it. Getting that moment wrong
 * means a customer loses a credential and has to re-key an integration.
 *
 * Revoking marks the key rather than deleting it, so the record of what once
 * had access to the workspace survives.
 */

import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import {
  KeyRound, Plus, Copy, Check, Trash2, Loader2, AlertTriangle, X, ExternalLink,
} from 'lucide-react';
import { functions } from '../lib/firebase';
import { useTheme } from '../contexts/ThemeContext';

interface ApiKeyRow {
  id: string;
  name: string;
  hint: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const callList   = httpsCallable<{ workspaceId: string }, { keys: ApiKeyRow[] }>(functions, 'listApiKeys');
const callCreate = httpsCallable<{ workspaceId: string; name: string }, { key: string; hint: string }>(functions, 'createApiKey');
const callRevoke = httpsCallable<{ workspaceId: string; keyId: string }, { ok: boolean }>(functions, 'revokeApiKey');

const fmt = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export default function ApiKeysPanel({ workspaceId, onToast }: {
  workspaceId: string;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const { c } = useTheme();

  const [keys, setKeys]       = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  /** The plaintext key, held only until the user dismisses it. */
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true); setError('');
    try {
      const { data } = await callList({ workspaceId });
      setKeys(data?.keys ?? []);
    } catch (e) {
      setError((e as Error).message || 'לא הצלחנו לטעון את המפתחות.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    const name = newName.trim() || 'מפתח API';
    setCreating(true); setError('');
    try {
      const { data } = await callCreate({ workspaceId, name });
      if (!data?.key) throw new Error('לא התקבל מפתח מהשרת.');
      setFreshKey(data.key);
      setNewName(''); setShowForm(false);
      await load();
    } catch (e) {
      setError((e as Error).message || 'יצירת המפתח נכשלה.');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(row: ApiKeyRow) {
    // Irreversible and immediate: anything using this key stops working on the
    // next request, so it is worth one deliberate confirmation.
    const ok = window.confirm(
      `לבטל את המפתח "${row.name}"?\n\nכל אינטגרציה שמשתמשת בו תפסיק לעבוד מיד, ואי אפשר להחזיר אותו.`,
    );
    if (!ok) return;
    setRevoking(row.id);
    try {
      await callRevoke({ workspaceId, keyId: row.id });
      onToast?.('המפתח בוטל', 'success');
      await load();
    } catch (e) {
      onToast?.((e as Error).message || 'ביטול המפתח נכשל', 'error');
    } finally {
      setRevoking(null);
    }
  }

  async function copyFresh() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast?.('ההעתקה נחסמה — סמן את המפתח והעתק ידנית', 'info');
    }
  }

  const active = keys.filter(k => !k.revokedAt);
  const revoked = keys.filter(k => k.revokedAt);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-black flex items-center gap-2" style={{ color: c.textPrimary }}>
            <KeyRound size={18} style={{ color: c.accentText }} /> מפתחות API
          </h3>
          <p className="text-sm mt-1 max-w-xl leading-relaxed" style={{ color: c.textSecondary }}>
            חבר מערכות אחרות ל-RAY CRM — קריאה וכתיבה של לידים ומשימות.{' '}
            <a href="/api" target="_blank" rel="noopener noreferrer"
              className="underline font-semibold inline-flex items-center gap-1" style={{ color: c.accentText }}>
              תיעוד ה-API <ExternalLink size={12} />
            </a>
          </p>
        </div>
        {!showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors"
            style={{ background: '#6366f1' }}>
            <Plus size={15} /> מפתח חדש
          </button>
        )}
      </div>

      {/* The one and only time this value is visible. */}
      {freshKey && (
        <div className="rounded-2xl p-5 border-2" style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,0.06)' }}>
          <div className="flex items-start gap-2.5 mb-3">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
            <div>
              <p className="font-black text-sm" style={{ color: c.textPrimary }}>העתק את המפתח עכשיו</p>
              <p className="text-[13px] leading-relaxed mt-0.5" style={{ color: c.textSecondary }}>
                אנחנו שומרים רק גיבוב שלו, ולכן לא נוכל להציג אותו שוב — גם לא אם תבקש.
                אם תאבד אותו, תצטרך לבטל וליצור חדש.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <code dir="ltr"
              className="flex-1 min-w-0 overflow-x-auto rounded-xl px-3 py-2.5 text-[12px] font-mono whitespace-nowrap"
              style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}>
              {freshKey}
            </code>
            <button onClick={copyFresh}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-white flex-shrink-0"
              style={{ background: copied ? '#10b981' : '#6366f1' }}>
              {copied ? <><Check size={15} /> הועתק</> : <><Copy size={15} /> העתק</>}
            </button>
          </div>

          <button onClick={() => { setFreshKey(null); setCopied(false); }}
            className="mt-3 text-[13px] font-semibold underline" style={{ color: c.textSecondary }}>
            שמרתי את המפתח — סגור
          </button>
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl p-4" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
          <label className="block text-[13px] font-bold mb-1.5" style={{ color: c.textSecondary }}>
            שם המפתח — לזיהוי בלבד
          </label>
          <div className="flex gap-2 flex-wrap">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="למשל: Zapier, האתר שלנו, מערכת ההנהלה"
              onKeyDown={e => { if (e.key === 'Enter') void create(); }}
              className="flex-1 min-w-[200px] rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }} />
            <button onClick={() => void create()} disabled={creating}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60 flex items-center gap-1.5"
              style={{ background: '#6366f1' }}>
              {creating ? <><Loader2 size={15} className="animate-spin" /> יוצר…</> : 'צור מפתח'}
            </button>
            <button onClick={() => { setShowForm(false); setNewName(''); }}
              className="px-3 py-2.5 rounded-xl text-sm font-semibold"
              style={{ border: `1px solid ${c.cardBorder}`, color: c.textSecondary }}>
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[13px] flex items-center gap-1.5" style={{ color: '#f43f5e' }}>
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-sm" style={{ color: c.textMuted }}>
          <Loader2 size={16} className="animate-spin" /> טוען…
        </div>
      ) : active.length === 0 && revoked.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <KeyRound size={30} className="opacity-20" />
          <p className="text-sm font-semibold" style={{ color: c.textMuted }}>עדיין אין מפתחות</p>
          <p className="text-[13px] max-w-sm leading-relaxed" style={{ color: c.textMuted }}>
            צור מפתח כדי לאפשר למערכת אחרת לקרוא ולכתוב לידים ומשימות.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...active, ...revoked].map(row => (
            <div key={row.id}
              className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 flex-wrap"
              style={{
                background: row.revokedAt ? 'transparent' : c.subtleBg,
                border: `1px solid ${c.cardBorder}`,
                opacity: row.revokedAt ? 0.55 : 1,
              }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-sm" style={{ color: c.textPrimary }}>{row.name}</span>
                  {row.hint && (
                    <code dir="ltr" className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: c.cardBg, color: c.textMuted }}>
                      ····{row.hint}
                    </code>
                  )}
                  {row.revokedAt && (
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(244,63,94,0.12)', color: '#f43f5e' }}>בוטל</span>
                  )}
                </div>
                <p className="text-[12px] mt-0.5" style={{ color: c.textMuted }}>
                  נוצר {fmt(row.createdAt)}
                  {' · '}
                  {row.lastUsedAt ? `שימוש אחרון ${fmt(row.lastUsedAt)}` : 'טרם היה בשימוש'}
                </p>
              </div>

              {!row.revokedAt && (
                <button onClick={() => void revoke(row)} disabled={revoking === row.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-semibold flex-shrink-0 disabled:opacity-50"
                  style={{ color: '#f43f5e', border: '1px solid rgba(244,63,94,0.3)' }}>
                  {revoking === row.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <><Trash2 size={13} /> בטל</>}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
