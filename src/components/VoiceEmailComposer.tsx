/**
 * VoiceEmailComposer — speak an email, review it, send it.
 *
 * The flow is deliberately: record → transcript → draft → **review** → send.
 * The review step is not skippable and the send button never appears before a
 * draft exists, because dictation is used when someone is in a hurry and that
 * is exactly when an unreviewed send does damage.
 *
 * The transcript stays visible and editable next to the draft. Speech
 * recognition mishears names and numbers constantly, and a user who can see
 * what was heard can fix it; one who only sees the polished result has no way
 * to know a digit changed.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Mic, Square, Loader2, Wand2, Send, Copy, Check, RefreshCw, Sparkles,
  AlertCircle, GraduationCap, Trash2, ChevronDown, Mail,
} from 'lucide-react';
import { useDictation } from '../hooks/useDictation';
import {
  composeFromSpeech, learnFromSentMail, loadStyleLearning, saveStyleLearning,
} from '../lib/voiceCompose';
import type { ComposedEmail, StyleLearning, SuggestedEmail } from '../lib/voiceCompose';
import { getActiveToken, sendGmailNew } from '../lib/gmailAgent';
import type { EmailAgentConfig, Lead } from '../types';

interface Props {
  workspaceId?: string;
  config?: EmailAgentConfig | null;
  leads?: Lead[];
  isDark?: boolean;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}

type Phase = 'idle' | 'composing' | 'sending';

export default function VoiceEmailComposer({ workspaceId, config, leads = [], isDark, onToast }: Props) {
  const [transcript, setTranscript] = useState('');
  const [draft, setDraft] = useState<ComposedEmail | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [leadId, setLeadId] = useState('');
  const [toEmail, setToEmail] = useState('');
  const [tweak, setTweak] = useState('');

  const [learning, setLearning] = useState<StyleLearning | null>(null);
  const [learnBusy, setLearnBusy] = useState('');
  const [openSug, setOpenSug] = useState<string | null>(null);

  const dict = useDictation(setTranscript, { onToast });

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    void loadStyleLearning(workspaceId).then(l => { if (alive) setLearning(l); });
    return () => { alive = false; };
  }, [workspaceId]);

  const lead = useMemo(() => leads.find(l => l.id === leadId), [leads, leadId]);

  // Picking a lead fills the address, but never overwrites one typed by hand.
  useEffect(() => {
    if (lead?.email) setToEmail(lead.email);
  }, [lead]);

  const leadContext = useMemo(() => {
    if (!lead) return undefined;
    const bits = [
      lead.status && `סטטוס: ${lead.status}`,
      lead.source && `מקור: ${lead.source}`,
      lead.solutions?.length && `פתרונות: ${lead.solutions.map(s => s.name).join(', ')}`,
      lead.notes?.length && `הערה אחרונה: ${lead.notes[lead.notes.length - 1]?.text?.slice(0, 300)}`,
    ].filter(Boolean);
    return bits.length ? bits.join('\n') : undefined;
  }, [lead]);

  const c = {
    card:   isDark ? 'rgba(255,255,255,0.04)' : '#ffffff',
    border: isDark ? 'rgba(255,255,255,0.10)' : '#e2e8f0',
    text:   isDark ? 'rgba(255,255,255,0.90)' : '#0f172a',
    dim:    isDark ? 'rgba(255,255,255,0.55)' : '#64748b',
    faint:  isDark ? 'rgba(255,255,255,0.35)' : '#94a3b8',
    inputBg: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc',
  };
  const input: React.CSSProperties = {
    background: c.inputBg, border: `1px solid ${c.border}`, color: c.text,
    borderRadius: 12, padding: '10px 12px', fontSize: 14, width: '100%',
  };

  const compose = async (instruction?: string) => {
    setError('');
    if (!transcript.trim() && !instruction) {
      setError('אין תוכן — הקלט או כתוב מה לשלוח');
      return;
    }
    setPhase('composing');
    try {
      const result = await composeFromSpeech({
        transcript,
        config,
        recipientName: lead?.contactName,
        recipientCompany: lead?.company,
        context: leadContext,
        styleProfile: learning?.styleProfile,
        previous: instruction && draft ? draft : undefined,
        instruction,
      });
      setDraft(result);
      setTweak('');
    } catch (e) {
      setError((e as Error).message || 'הניסוח נכשל');
    } finally {
      setPhase('idle');
    }
  };

  const send = async () => {
    if (!draft) return;
    const to = toEmail.trim();
    if (!to) { setError('אין כתובת נמען'); return; }

    const token = getActiveToken();
    if (!token) {
      setError('אין חיבור פעיל ל-Gmail — התחבר בלשונית ההגדרות, או העתק את המייל ושלח ידנית');
      return;
    }
    if (!window.confirm(`לשלוח את המייל אל ${to}?`)) return;

    setPhase('sending'); setError('');
    try {
      await sendGmailNew(token, to, draft.subject, draft.body);
      onToast(`המייל נשלח אל ${to} ✓`, 'success');
      setDraft(null); setTranscript(''); setLeadId(''); setToEmail('');
    } catch (e) {
      // Never clear the draft on failure — the user would lose the text and
      // have no way to tell whether it went out.
      setError(`השליחה נכשלה: ${(e as Error).message}. הטיוטה נשמרה — אפשר להעתיק ולשלוח ידנית.`);
    } finally {
      setPhase('idle');
    }
  };

  const copy = () => {
    if (!draft) return;
    navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
    onToast('המייל הועתק', 'success');
  };

  const learn = async () => {
    if (!workspaceId) return;
    const token = getActiveToken();
    if (!token) { onToast('צריך חיבור פעיל ל-Gmail כדי ללמוד מהמיילים שלך', 'error'); return; }
    setLearnBusy('מתחיל…');
    try {
      const result = await learnFromSentMail(token, msg => setLearnBusy(msg));
      await saveStyleLearning(workspaceId, result);
      setLearning(result);
      onToast(`למדתי מ-${result.sampleCount} מיילים ומצאתי ${result.suggestions.length} תבניות חוזרות ✓`, 'success');
    } catch (e) {
      onToast(`הלמידה נכשלה: ${(e as Error).message}`, 'error');
    } finally {
      setLearnBusy('');
    }
  };

  const useSuggestion = (s: SuggestedEmail) => {
    setDraft({ subject: s.subject, body: s.body });
    setOpenSug(null);
    onToast('התבנית נטענה — ערוך או הקלט תוספת ולחץ "נסח מחדש"', 'info');
  };

  const busy = phase !== 'idle';

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Recording ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ background: c.card, border: `1px solid ${c.border}` }}>
        <div className="flex items-start gap-4 flex-wrap">
          <button
            onClick={() => dict.toggle(transcript)}
            disabled={!dict.supported || dict.transcribing}
            aria-label={dict.recording ? 'עצור הקלטה' : 'התחל הקלטה'}
            className="flex-shrink-0 w-16 h-16 rounded-full flex items-center justify-center text-white transition-transform hover:scale-105 disabled:opacity-50"
            style={{
              background: dict.recording ? '#dc2626' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
              boxShadow: dict.recording ? '0 0 0 6px rgba(220,38,38,0.18)' : '0 4px 14px rgba(99,102,241,0.35)',
              animation: dict.recording ? 'pulse 1.6s ease-in-out infinite' : undefined,
            }}
          >
            {dict.transcribing ? <Loader2 size={24} className="animate-spin" />
              : dict.recording ? <Square size={22} /> : <Mic size={24} />}
          </button>

          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-black mb-1" style={{ color: c.text }}>
              {dict.recording ? 'מקליט… דבר חופשי' : dict.transcribing ? 'מתמלל…' : 'הקלט את המייל'}
            </h3>
            <p className="text-[12.5px] leading-relaxed" style={{ color: c.dim }}>
              {dict.supported
                ? 'לחץ על המיקרופון ותגיד מה אתה רוצה לשלוח — בשפה חופשית. הסוכן ינסח מזה מייל מקצועי, בסגנון שלך.'
                : 'הדפדפן הזה לא תומך בזיהוי דיבור (נסה Chrome). אפשר גם פשוט לכתוב למטה מה לשלוח.'}
            </p>
          </div>
        </div>

        <textarea
          value={transcript}
          onChange={e => setTranscript(e.target.value)}
          rows={4}
          placeholder="מה שאמרת יופיע כאן — אפשר לתקן לפני הניסוח…"
          className="mt-4"
          style={{ ...input, resize: 'vertical', lineHeight: 1.7 }}
        />
        <p className="text-[11px] mt-1.5" style={{ color: c.faint }}>
          זיהוי דיבור טועה לעיתים בשמות ובמספרים — כדאי לעבור על הטקסט לפני הניסוח.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <label className="text-[11px] font-bold block mb-1.5" style={{ color: c.dim }}>ליד (לא חובה)</label>
            <select value={leadId} onChange={e => setLeadId(e.target.value)} style={input}>
              <option value="">בלי הקשר של ליד</option>
              {leads.map(l => (
                <option key={l.id} value={l.id}>{l.company}{l.contactName ? ` — ${l.contactName}` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold block mb-1.5" style={{ color: c.dim }}>נמען</label>
            <input value={toEmail} onChange={e => setToEmail(e.target.value)}
              placeholder="name@company.co.il" dir="ltr" style={input} />
          </div>
        </div>

        <button
          onClick={() => void compose()}
          disabled={busy || dict.recording || (!transcript.trim() && !draft)}
          className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl
                     text-white text-[14px] font-bold disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)' }}
        >
          {phase === 'composing'
            ? <><Loader2 size={16} className="animate-spin" /> מנסח…</>
            : <><Wand2 size={16} /> נסח מייל מקצועי</>}
        </button>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 text-[13px] font-semibold" style={{ color: '#dc2626' }}>
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />{error}
        </p>
      )}

      {/* ── Draft (review before anything leaves) ─────────────────────────── */}
      {draft && (
        <div className="rounded-2xl p-5" style={{ background: c.card, border: `1px solid ${c.border}` }}>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={15} style={{ color: '#8b5cf6' }} />
            <h3 className="text-[15px] font-black" style={{ color: c.text }}>הטיוטה</h3>
            <span className="text-[11px]" style={{ color: c.faint }}>· עבור עליה לפני השליחה</span>
          </div>

          <input
            value={draft.subject}
            onChange={e => setDraft({ ...draft, subject: e.target.value })}
            placeholder="נושא"
            style={{ ...input, fontWeight: 700, marginBottom: 10 }}
          />
          <textarea
            value={draft.body}
            onChange={e => setDraft({ ...draft, body: e.target.value })}
            rows={12}
            style={{ ...input, resize: 'vertical', lineHeight: 1.8 }}
          />

          <div className="flex gap-2 mt-3 flex-wrap">
            <input
              value={tweak}
              onChange={e => setTweak(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && tweak.trim()) void compose(tweak.trim()); }}
              placeholder="בקש שינוי: קצר יותר, פחות רשמי, הוסף קריאה לפעולה…"
              style={{ ...input, flex: 1, minWidth: 220 }}
            />
            <button
              onClick={() => tweak.trim() && void compose(tweak.trim())}
              disabled={busy || !tweak.trim()}
              className="px-4 py-2.5 rounded-xl text-[13px] font-bold flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}
            >
              <RefreshCw size={14} /> נסח מחדש
            </button>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <button
              onClick={() => void send()}
              disabled={busy}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-[14px] font-bold disabled:opacity-50"
              style={{ background: '#059669' }}
            >
              {phase === 'sending'
                ? <><Loader2 size={15} className="animate-spin" /> שולח…</>
                : <><Send size={15} /> שלח</>}
            </button>
            <button onClick={copy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold"
              style={{ background: c.inputBg, border: `1px solid ${c.border}`, color: c.text }}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'הועתק' : 'העתק'}
            </button>
            <button onClick={() => { setDraft(null); setError(''); }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#dc2626' }}>
              <Trash2 size={14} /> מחק טיוטה
            </button>
          </div>
        </div>
      )}

      {/* ── Learned style + recurring emails ─────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ background: c.card, border: `1px solid ${c.border}` }}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <button
            onClick={() => void learn()}
            disabled={!!learnBusy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-bold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)' }}
          >
            {learnBusy
              ? <><Loader2 size={15} className="animate-spin" /> {learnBusy}</>
              : <><GraduationCap size={15} /> {learning ? 'למד מחדש' : 'למד את הסגנון שלי'}</>}
          </button>
          <div className="text-right min-w-0 flex-1">
            <h3 className="text-[15px] font-black" style={{ color: c.text }}>המיילים שאתה בדרך כלל שולח</h3>
            <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: c.dim }}>
              {learning
                ? `נלמד מ-${learning.sampleCount} מיילים שנשלחו · עודכן ${new Date(learning.learnedAt).toLocaleDateString('he-IL')}`
                : 'הסוכן יקרא את המיילים ששלחת מהחשבון המחובר, ילמד את סגנון הכתיבה שלך, ויציע את התבניות שאתה שולח שוב ושוב.'}
            </p>
          </div>
        </div>

        {learning?.styleProfile && (
          <div className="rounded-xl p-3.5 mb-3" style={{ background: c.inputBg, border: `1px solid ${c.border}` }}>
            <div className="text-[10px] font-mono tracking-wider mb-1.5" style={{ color: c.faint }}>הסגנון שלך</div>
            <p className="text-[12.5px] leading-relaxed" style={{ color: c.dim }}>{learning.styleProfile}</p>
          </div>
        )}

        {!learning ? (
          <div className="rounded-xl py-8 text-center" style={{ border: `1px dashed ${c.border}` }}>
            <Mail size={22} className="mx-auto mb-2" style={{ color: c.faint }} />
            <p className="text-[12.5px]" style={{ color: c.faint }}>עדיין לא למדתי את הסגנון שלך.</p>
          </div>
        ) : learning.suggestions.length === 0 ? (
          <p className="text-[12.5px] py-4 text-center" style={{ color: c.faint }}>
            לא מצאתי מייל שחוזר על עצמו מספיק פעמים כדי להציע ממנו תבנית.
          </p>
        ) : (
          <div className="space-y-2">
            {learning.suggestions.map(s => {
              const open = openSug === s.id;
              return (
                <div key={s.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${c.border}` }}>
                  <button onClick={() => setOpenSug(open ? null : s.id)}
                    className="w-full px-3.5 py-3 flex items-center gap-3 text-right">
                    <ChevronDown size={14} className="flex-shrink-0"
                      style={{ color: c.faint, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ background: c.inputBg, color: c.faint }}>×{s.seenTimes}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold truncate" style={{ color: c.text }}>{s.title}</span>
                      <span className="block text-[11px] truncate" style={{ color: c.faint }}>{s.whenToUse}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="px-3.5 pb-3.5" style={{ borderTop: `1px solid ${c.border}` }}>
                      {s.subject && (
                        <p className="text-[12.5px] font-bold pt-3 mb-1.5" style={{ color: c.text }}>{s.subject}</p>
                      )}
                      <p className="text-[12.5px] whitespace-pre-wrap leading-relaxed" style={{ color: c.dim }}>{s.body}</p>
                      <button onClick={() => useSuggestion(s)}
                        className="mt-3 px-4 py-2 rounded-lg text-[12px] font-bold text-white"
                        style={{ background: '#6366f1' }}>
                        השתמש בתבנית הזו
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
