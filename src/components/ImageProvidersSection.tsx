/**
 * ImageProvidersSection — connect Google Imagen and OpenAI DALL·E.
 *
 * Image generation already runs on Pollinations, which needs no key and costs
 * nothing. These two are the paid alternatives, and until now there was
 * nowhere in the product to connect them: the AI Studio held keys for
 * ElevenLabs, Hunter and Ideogram, and image models were not among them.
 *
 * Two things this screen has to do beyond storing a string:
 *
 *  • **Say how to get the key.** A field labelled "API key" with no route to
 *    obtaining one is a dead end — the steps are the feature, not decoration.
 *
 *  • **Show whether it is actually connected.** A saved key is not a working
 *    key. The badge reflects what is stored; the note under it says plainly
 *    that storing is not verifying, so nobody reads a green pill as proof.
 *
 * Keys live on the workspace beside the other AI Studio keys, so every tool
 * that generates media reads them from one place.
 */

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Eye, EyeOff, Loader2, ExternalLink, Trash2, ImageIcon, Info } from 'lucide-react';
import { db } from '../lib/firebase';
import { useTheme } from '../contexts/ThemeContext';
import type { WorkspaceProfile } from '../types';

type ProviderId = 'imagen' | 'dalle';

interface Provider {
  id: ProviderId;
  name: string;
  emoji: string;
  color: string;
  /** Where the key is created, linked so nobody has to hunt for it. */
  consoleUrl: string;
  consoleLabel: string;
  keyLooksLike: string;
  steps: string[];
  note?: string;
}

const PROVIDERS: Provider[] = [
  {
    id: 'imagen',
    name: 'Google Imagen',
    emoji: '🎨',
    color: '#4285f4',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    consoleLabel: 'Google AI Studio → API keys',
    keyLooksLike: 'AIza…',
    steps: [
      'היכנס ל-Google AI Studio עם חשבון Google.',
      'לחץ על "Create API key" ובחר פרויקט (או צור חדש).',
      'העתק את המפתח — הוא מתחיל ב-AIza.',
      'הדבק אותו כאן ושמור.',
    ],
    note: 'Imagen דורש פרויקט Google Cloud עם חיוב פעיל. מפתח מחשבון ללא חיוב ייווצר בהצלחה אך יחזיר שגיאת מכסה בשימוש הראשון.',
  },
  {
    id: 'dalle',
    name: 'OpenAI DALL·E',
    emoji: '🖼️',
    color: '#10a37f',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'OpenAI Platform → API keys',
    keyLooksLike: 'sk-…',
    steps: [
      'היכנס ל-OpenAI Platform.',
      'לחץ על "Create new secret key".',
      'העתק את המפתח מיד — OpenAI מציגה אותו פעם אחת בלבד.',
      'הדבק אותו כאן ושמור.',
    ],
    note: 'נדרשת יתרה בחשבון OpenAI. מפתח בחשבון ללא אמצעי תשלום יחזיר שגיאת quota.',
  },
];

export default function ImageProvidersSection({ workspace, onToast, onWorkspaceUpdate }: {
  workspace: WorkspaceProfile;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onWorkspaceUpdate: () => void | Promise<void>;
}) {
  const { c } = useTheme();
  const stored = (workspace as { aiStudioKeys?: Record<string, string> }).aiStudioKeys ?? {};

  const [values, setValues] = useState<Record<string, string>>({
    imagen: stored.imagen ?? '',
    dalle:  stored.dalle  ?? '',
  });
  const [reveal, setReveal]   = useState<Record<string, boolean>>({});
  const [saving, setSaving]   = useState<ProviderId | null>(null);
  const [openId, setOpenId]   = useState<ProviderId | null>(null);

  async function save(p: Provider, clear = false) {
    setSaving(p.id);
    const next = clear ? '' : values[p.id].trim();
    try {
      // Merged rather than replaced: writing the whole object would drop the
      // keys the AI Studio stores for its own tools.
      await updateDoc(doc(db, 'workspaces', workspace.id), {
        [`aiStudioKeys.${p.id}`]: next || null,
      });
      setValues(v => ({ ...v, [p.id]: next }));
      await onWorkspaceUpdate();
      onToast(next ? `${p.name} חובר ✓` : `${p.name} נותק`, next ? 'success' : 'info');
    } catch {
      onToast('שגיאה בשמירת המפתח', 'error');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 px-1">
        <ImageIcon size={15} style={{ color: c.accentText }} />
        <div>
          <h3 className="text-[14px] font-black" style={{ color: c.textPrimary }}>יצירת תמונות AI</h3>
          <p className="text-[11px]" style={{ color: c.textMuted }}>
            חבר ספק תמונות בתשלום. ללא חיבור המערכת ממשיכה לעבוד עם המנוע החינמי המובנה.
          </p>
        </div>
      </div>

      {PROVIDERS.map(p => {
        const connected = Boolean(stored[p.id]);
        const open = openId === p.id;
        const busy = saving === p.id;

        return (
          <div key={p.id} className="rounded-2xl overflow-hidden"
            style={{ background: c.cardBg, border: `1px solid ${connected ? p.color + '55' : c.cardBorder}` }}>

            <button onClick={() => setOpenId(open ? null : p.id)}
              className="w-full flex items-center justify-between px-5 py-4 transition-all"
              style={{ background: `linear-gradient(135deg,${p.color}12,${p.color}04)` }}>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5"
                style={connected
                  ? { background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981' }
                  : { background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textMuted }}>
                {connected
                  ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> מחובר</>
                  : 'לא מחובר'}
              </span>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-bold text-[14px]" style={{ color: c.textPrimary }}>{p.name}</p>
                  <p className="text-[10px]" style={{ color: c.textMuted }}>
                    {connected ? `מפתח שמור · ${p.keyLooksLike}` : `נדרש מפתח API (${p.keyLooksLike})`}
                  </p>
                </div>
                <span className="text-xl">{p.emoji}</span>
              </div>
            </button>

            {open && (
              <div className="px-5 pb-5 pt-1 space-y-4">
                {/* How to obtain the key. Without this the field is a dead end. */}
                <div className="rounded-xl p-4" style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}` }}>
                  <p className="text-[12px] font-black mb-2.5" style={{ color: c.textSecondary }}>איך משיגים מפתח</p>
                  <ol className="space-y-1.5">
                    {p.steps.map((s, i) => (
                      <li key={i} className="flex gap-2.5 text-[12.5px] leading-relaxed" style={{ color: c.textSecondary }}>
                        <span className="flex-shrink-0 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center mt-0.5"
                          style={{ background: p.color + '22', color: p.color }}>{i + 1}</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ol>
                  <a href={p.consoleUrl} target="_blank" rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold underline"
                    style={{ color: p.color }}>
                    <ExternalLink size={12} /> {p.consoleLabel}
                  </a>
                </div>

                {p.note && (
                  <div className="flex gap-2 rounded-xl p-3"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                    <Info size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
                    <p className="text-[12px] leading-relaxed" style={{ color: c.textSecondary }}>{p.note}</p>
                  </div>
                )}

                <div>
                  <label className="block text-[12px] font-bold mb-1.5" style={{ color: c.textSecondary }}>
                    מפתח API
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[220px]">
                      <input
                        type={reveal[p.id] ? 'text' : 'password'}
                        dir="ltr"
                        value={values[p.id]}
                        placeholder={p.keyLooksLike}
                        onChange={e => setValues(v => ({ ...v, [p.id]: e.target.value }))}
                        className="w-full rounded-xl px-3 py-2.5 pl-10 text-[13px] font-mono focus:outline-none"
                        style={{ background: c.subtleBg, border: `1px solid ${c.cardBorder}`, color: c.textPrimary }}
                      />
                      <button type="button" onClick={() => setReveal(r => ({ ...r, [p.id]: !r[p.id] }))}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1"
                        style={{ color: c.textMuted }}
                        aria-label={reveal[p.id] ? 'הסתר' : 'הצג'}>
                        {reveal[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>

                    <button onClick={() => void save(p)} disabled={busy || !values[p.id].trim()}
                      className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-50 flex items-center gap-1.5"
                      style={{ background: p.color }}>
                      {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                      {connected ? 'עדכן מפתח' : 'חבר'}
                    </button>

                    {connected && (
                      <button onClick={() => { if (window.confirm(`לנתק את ${p.name}?`)) void save(p, true); }}
                        disabled={busy}
                        className="px-3 py-2.5 rounded-xl text-[13px] font-semibold flex items-center gap-1.5"
                        style={{ color: '#f43f5e', border: '1px solid rgba(244,63,94,0.3)' }}>
                        <Trash2 size={13} /> נתק
                      </button>
                    )}
                  </div>

                  {/* A saved key is not a verified key, and the badge above only
                      reports what is stored. Said here so a green pill is not
                      mistaken for proof the provider works. */}
                  <p className="text-[11px] mt-2" style={{ color: c.textMuted }}>
                    המפתח נשמר בסביבת העבודה שלך. החיווי מציין שקיים מפתח שמור — תקינותו מול הספק
                    תיבדק בשימוש הראשון ביצירת תמונה.
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
