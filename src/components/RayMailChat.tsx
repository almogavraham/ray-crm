/**
 * RayMailChat — a personal assistant for the inbox, driven by voice.
 *
 * The loop it exists for: a mail arrives → it offers to read it → you answer
 * out loud how you want to reply → it writes the reply → you approve → it sends.
 *
 * Two rules run through the whole component:
 *
 *  • **Nothing is sent without an explicit approval of the final text.** Voice
 *    makes replying fast, and fast replying is exactly where an unreviewed send
 *    does damage. The approve button appears only once a draft exists, and the
 *    draft is editable up to the moment it goes.
 *  • **Nothing is invented.** The reply is composed through composeFromSpeech,
 *    whose prompt forbids adding any fact that was not spoken — no prices, no
 *    dates, no commitments.
 *
 * It never marks mail as read on its own either: reading a mail aloud is not
 * the same as the person having dealt with it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Mic, Square, Send, Loader2, Volume2, VolumeX, RefreshCw, Mail, MessageCircle,
  Check, AlertCircle, Sparkles, Inbox, Trash2,
} from 'lucide-react';
import { useDictation } from '../hooks/useDictation';
import { speak, stopSpeaking, isSpeechSupported, hasHebrewVoice, readableEmailText } from '../lib/speech';
import { composeFromSpeech, loadStyleLearning } from '../lib/voiceCompose';
import type { ComposedEmail, StyleLearning } from '../lib/voiceCompose';
import {
  fetchUnreadEmails, searchEmails, sendGmailReply, loadAgentConfig, askAboutEmails,
} from '../lib/gmailAgent';
import { getLiveGmailToken } from '../lib/gmailKeepAlive';
import type { GmailMessage } from '../lib/gmailAgent';
import type { EmailAgentConfig } from '../types';
import { appendMessage, setMessages, setOpen, useChatSession } from '../lib/chatSessionStore';
import { useDraggableWindow } from '../lib/useDraggableWindow';
import { useVoiceChat } from '../lib/useVoiceChat';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  /** Set on the assistant message that offers to read a specific mail. */
  offerMailId?: string;
}

/** How often to look for new mail while the chat is open. */
const POLL_MS = 60_000;

export default function RayMailChat({
  workspaceId, clientId, onToast, onClose,
}: {
  workspaceId?: string;
  /** OAuth client id, so a lapsed token can be re-minted without a popup. */
  clientId?: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onClose: () => void;
}) {
  const { backdropProps, panelProps, handleProps } = useDraggableWindow('mail');
  const session = useChatSession<Msg>('mail');
  const msgs = session.msgs;
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [mails, setMails] = useState<GmailMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [active, setActive] = useState<GmailMessage | null>(null);
  const [draft, setDraft] = useState<ComposedEmail | null>(null);
  const [sending, setSending] = useState(false);

  const [reading, setReading] = useState(false);
  const [hebrewVoice, setHebrewVoice] = useState<boolean | null>(null);
  const [config, setConfig] = useState<EmailAgentConfig | null>(null);
  // Three states, because "connected" and "can actually read mail" are not the
  // same thing. Showing a stored account as connected while every fetch failed
  // is what made the app claim an empty inbox that was not empty.
  const [auth, setAuth] = useState<'checking' | 'live' | 'reauth' | 'none'>('checking');
  const [reconnecting, setReconnecting] = useState(false);
  /** Which mailbox is actually connected, and whether it survives a restart. */
  const [account, setAccount] = useState<{ email: string; permanent: boolean } | null>(null);
  const [triaging, setTriaging] = useState(false);
  const triagedRef = useRef(false);
  const [learning, setLearning] = useState<StyleLearning | null>(null);

  const speakRef = useRef<{ stop: () => void } | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const dict = useDictation(setInput, { onToast });

  // Full spoken conversation, alongside the dictation mic. Dictation writes into
  // the composer for a reply you are about to send; this one is a back-and-forth
  // with RAY, the same as in the personal assistant.
  const lastReply = [...msgs].reverse().find(m => m.role === 'assistant')?.text;
  const voice = useVoiceChat({
    onSay: t => { setInput(''); void (active ? composeReply(t) : askInbox(t)); },
    lastReply,
    busy,
  });

  // Straight into the shared store: closing the window must not lose the thread,
  // and an answer that lands while it is closed should raise the badge.
  const push = useCallback((m: Msg) => appendMessage<Msg>('mail', m), []);

  /* ── Session restore + one-time setup ─────────────────────────────────── */
  useEffect(() => {
    setOpen('mail', true);
    return () => { setOpen('mail', false); stopSpeaking(); };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    if (msgs.length === 0) {
      setMessages<Msg>('mail', [{
        role: 'assistant',
        text: 'שלום 📬 אני RAY MAIL — העוזר האישי שלך למיילים.\n\n'
            + 'כשמגיע מייל חדש אשאל אם להקריא לך אותו. אחרי ההקראה תוכל פשוט להגיד לי '
            + 'מה לענות — אני אנסח את התשובה ואבקש את אישורך לפני שליחה.\n\n'
            + 'אפשר גם לשאול אותי על התיבה: "מה הגיע היום?", "מי מחכה לתשובה?"',
      }]);
    }
    void loadAgentConfig(workspaceId).then(setConfig);
    void loadStyleLearning(workspaceId).then(setLearning);
  }, [workspaceId]);

  useEffect(() => {
    void hasHebrewVoice().then(setHebrewVoice);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, draft]);

  /* ── Watch the inbox ──────────────────────────────────────────────────── */
  const checkMail = useCallback(async (announce: boolean) => {
    const token = await getLiveGmailToken(workspaceId, clientId);
    if (!token) {
      setAuth((config?.accounts?.length ?? 0) > 0 ? 'reauth' : 'none');
      return;
    }
    try {
      // Read the inbox, not only what is unread. Asking for is:unread meant a
      // mailbox whose mail had all been opened reported itself as empty — which
      // is true of the query and useless as an answer.
      const [inbox, unread] = await Promise.all([
        searchEmails(token, 'in:inbox', 15),
        fetchUnreadEmails(token, 10),
      ]);
      setAuth('live');
      setMails(inbox.length ? inbox : unread);
      setUnreadCount(unread.length);

      // Name the mailbox. Worth showing plainly: this app has already had an
      // episode of being connected to an account the user did not expect.
      if (!account) {
        const { getServerGmailToken } = await import('../lib/gmailServerAuth');
        const permanent = (await getServerGmailToken(workspaceId)) !== null;
        const email = config?.accounts?.[0]?.email
          ?? (await import('../lib/gmailKeepAlive')).getKeepAliveState().email
          ?? '';
        setAccount({ email, permanent });
      }
      // Announcements still key on unread — an already-read mail is not news.
      if (!announce) { unread.forEach(m => seenRef.current.add(m.id)); return; }
      for (const m of unread) {
        if (seenRef.current.has(m.id)) continue;
        seenRef.current.add(m.id);
        push({
          role: 'assistant',
          offerMailId: m.id,
          text: `📬 הגיע מייל חדש מ־${m.fromName || m.from}\nנושא: ${m.subject}\n\nלהקריא לך אותו?`,
        });
      }
    } catch (e) {
      // A polling failure must not spam the conversation on every tick — but it
      // must not read as "no mail" either. Gmail answers 401 for a token it no
      // longer accepts, which needs a real reconnect, not a retry.
      console.error('[RayMail] inbox poll failed', e);
      const msg = (e as Error).message ?? '';
      setAuth(/401|403|invalid|unauthor/i.test(msg) ? 'reauth' : 'live');
      setError(`לא הצלחתי לקרוא את תיבת הדואר: ${msg}`);
    }
  }, [push, workspaceId, clientId, config, account]);

  useEffect(() => {
    void checkMail(false);
    const id = setInterval(() => void checkMail(true), POLL_MS);
    return () => clearInterval(id);
  }, [checkMail]);

  /* ── What to do next ──────────────────────────────────────────────────── */
  /**
   * Triage the inbox into a short, ordered list of actions.
   *
   * Deliberately opinionated: an assistant that lists everything has just
   * reproduced the inbox, which the user can already see. The value is in
   * saying what deserves attention and what does not, so the prompt asks for a
   * ranking and an explicit "no action needed" bucket.
   */
  const recommend = useCallback(async (auto: boolean) => {
    if (triaging || !mails.length) return;
    setTriaging(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const digest = mails.slice(0, 15).map((m, idx) =>
        `${idx + 1}. מאת: ${m.fromName || m.from} <${m.from}>\n`
        + `   נושא: ${m.subject}\n`
        + `   תאריך: ${new Date(m.date).toLocaleDateString('he-IL')}\n`
        + `   תקציר: ${readableEmailText(m.body || m.snippet, 300)}`).join('\n\n');

      const resp = await getAnthropicProxy().messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1200,
        system: [
          `אתה עוזר אישי למיילים של ${config?.agentName || 'המשתמש'}`
            + (config?.agentRole ? ` (${config.agentRole})` : '') + '.',
          config?.businessDescription ? `רקע על העסק: ${config.businessDescription}` : '',
          '',
          'עבור על תיבת הדואר וקבע מה באמת דורש טיפול. כתוב בעברית, קצר וישיר.',
          '',
          'מבנה התשובה:',
          '• עד 4 פריטים שדורשים פעולה, מהדחוף לפחות דחוף. לכל אחד: שם השולח,',
          '  מה רוצים ממך במשפט אחד, ומה הפעולה המומלצת.',
          '• בסוף שורה אחת: מה אפשר להתעלם ממנו.',
          '',
          'כללים:',
          '• אל תמציא עובדות שלא מופיעות במיילים — לא סכומים, לא תאריכים, לא הבטחות.',
          '• אם משהו לא ברור, אמור שהוא לא ברור במקום לנחש.',
          '• אל תפרט את כל התיבה. אם רוב המיילים לא דורשים כלום — תגיד את זה.',
          '• בלי כותרות Markdown ובלי טבלאות. שורות קצרות.',
        ].filter(Boolean).join('\n'),
        messages: [{ role: 'user', content: digest }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (resp.content?.find((b: any) => b.type === 'text') as any)?.text?.trim();
      if (text) {
        const head = auto ? '📋 מה מחכה לך בתיבה:' : '📋 המלצות:';
        push({ role: 'assistant', text: head + '\n\n' + text });
      }
    } catch (e) {
      // Only surface a failure the user asked for. An automatic briefing that
      // fails should stay quiet rather than open the chat with an error.
      if (!auto) setError(`לא הצלחתי לנתח את התיבה: ${(e as Error).message}`);
    } finally { setTriaging(false); }
  }, [mails, config, push, triaging]);

  // Brief once, the first time real mail arrives — the point of opening this
  // chat is usually "what needs me?", not "let me type a question".
  useEffect(() => {
    if (auth === 'live' && mails.length && !triagedRef.current) {
      triagedRef.current = true;
      void recommend(true);
    }
  }, [auth, mails, recommend]);

  /* ── Reading aloud ────────────────────────────────────────────────────── */
  const readAloud = async (m: GmailMessage) => {
    setActive(m);
    setError('');
    const text = `מייל מ־${m.fromName || m.from}. נושא: ${m.subject}. ${readableEmailText(m.body || m.snippet)}`;
    try {
      setReading(true);
      const h = await speak(text, { lang: 'he-IL' });
      speakRef.current = h;
      await h.done;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
      speakRef.current = null;
    }
  };

  const stopRead = () => { speakRef.current?.stop(); stopSpeaking(); setReading(false); };

  /* ── Composing a reply from what the user said ────────────────────────── */
  const composeReply = async (said: string) => {
    if (!active) { setError('אין מייל פתוח לתשובה — בחר מייל או בקש ממני להקריא אחד'); return; }
    setBusy(true); setError('');
    try {
      const result = await composeFromSpeech({
        transcript: said,
        config,
        recipientName: active.fromName,
        styleProfile: learning?.styleProfile,
        context: `אתה כותב תשובה למייל הבא.\nמאת: ${active.fromName} <${active.from}>\n`
               + `נושא: ${active.subject}\n\n${readableEmailText(active.body || active.snippet, 1200)}`,
        previous: draft ?? undefined,
        instruction: draft ? said : undefined,
      });
      setDraft(result);
      push({ role: 'assistant', text: 'ניסחתי תשובה — עבור עליה ואשר לפני שליחה 👇' });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  /* ── Free-form questions about the inbox ──────────────────────────────── */
  const askInbox = async (question: string) => {
    const token = await getLiveGmailToken(workspaceId, clientId);
    if (!token) { setError('אין חיבור פעיל ל-Gmail — התחבר בלשונית ההגדרות של סוכן המכירות'); return; }
    setBusy(true); setError('');
    try {
      const res = await askAboutEmails(question, mails, config ?? ({} as EmailAgentConfig));
      const cited = (res.sources ?? []).slice(0, 3)
        .map(s2 => `• ${s2.subject} — ${s2.from}`).join('\n');
      push({
        role: 'assistant',
        text: (res.answer || 'לא הצלחתי לענות על זה.')
            + (cited ? `\n\nמבוסס על:\n${cited}` : ''),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const submit = async () => {
    const said = input.trim();
    if (!said || busy) return;
    push({ role: 'user', text: said });
    setInput('');
    // With a mail open the natural reading of anything said is "reply like this";
    // otherwise it is a question about the inbox.
    if (active) await composeReply(said);
    else await askInbox(said);
  };

  const send = async () => {
    if (!draft || !active) return;
    const token = await getLiveGmailToken(workspaceId, clientId);
    if (!token) { setError('אין חיבור פעיל ל-Gmail — התחבר מחדש ונסה שוב'); return; }
    if (!window.confirm(`לשלוח את התשובה אל ${active.from}?`)) return;
    setSending(true); setError('');
    try {
      await sendGmailReply(token, active.from, active.subject, draft.body, active.threadId, active.id);
      onToast(`התשובה נשלחה אל ${active.fromName || active.from} ✓`, 'success');
      push({ role: 'assistant', text: `✅ נשלח אל ${active.fromName || active.from}.` });
      setDraft(null); setActive(null);
    } catch (e) {
      // Keep the draft: losing the text after a failed send is worse than the
      // failure itself, and the user has no other copy.
      setError(`השליחה נכשלה: ${(e as Error).message}. הטיוטה נשמרה.`);
    } finally { setSending(false); }
  };

  const reconnect = async () => {
    if (!workspaceId) { setError('אין סביבת עבודה פעילה'); return; }
    setReconnecting(true); setError('');
    try {
      // Interactive on purpose. The background refresh needs a popup Google
      // opens for it, and a browser blocks popups that no click asked for —
      // which is exactly why the silent renewal kept failing.
      // Permanent connection: the server takes a refresh token, so this is the
      // last time anyone has to do this. Navigates away to Google's consent
      // screen and comes back through the callback.
      const { connectGmailPermanently } = await import('../lib/gmailServerAuth');
      await connectGmailPermanently(workspaceId!, config?.accounts?.[0]?.email);
    } catch (e) {
      setError(`ההתחברות נכשלה: ${(e as Error).message}`);
    } finally { setReconnecting(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      {...backdropProps} dir="rtl" onClick={backdropProps.onClick === undefined ? undefined : onClose}>
      <div onClick={e => e.stopPropagation()} ref={panelProps.ref}
        className="w-full sm:max-w-2xl h-[92vh] sm:h-[85vh] rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden"
        style={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.10)', ...panelProps.style }}>

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          {...handleProps}
          style={{ background: 'linear-gradient(135deg,#0369a1,#0891b2)', ...handleProps.style }}>
          <button onClick={onClose} className="p-1.5 rounded-lg text-white/90 hover:bg-white/15">
            <X size={17} />
          </button>
          {reading && (
            <button onClick={stopRead}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 text-white"
              style={{ background: 'rgba(0,0,0,0.25)' }}>
              <VolumeX size={13} /> עצור הקראה
            </button>
          )}
          <button onClick={() => void recommend(false)} disabled={triaging || !mails.length}
            title="מה כדאי לעשות עכשיו?"
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-white flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: 'rgba(0,0,0,0.22)' }}>
            {triaging ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            מה לעשות
          </button>
          <button onClick={() => void checkMail(true)} title="בדוק מיילים חדשים"
            className="p-1.5 rounded-lg text-white/90 hover:bg-white/15">
            <RefreshCw size={15} />
          </button>
          <div className="flex-1 text-right min-w-0">
            <div className="text-white font-black text-[15px] flex items-center gap-2 justify-end">
              RAY MAIL <Mail size={16} />
            </div>
            <div className="text-white/80 text-[11px] truncate">
              {auth === 'live'     ? `${account?.email ?? 'מחובר'} · ${mails.length} בתיבה${unreadCount ? ` · ${unreadCount} לא נקראו` : ''}`
             : auth === 'reauth'   ? 'החיבור פג — נדרשת התחברות מחדש'
             : auth === 'checking' ? 'בודק חיבור…'
             :                       'לא מחובר ל-Gmail'}
            </div>
          </div>
        </div>

        {auth === 'reauth' && (
          <div className="px-4 py-2.5 text-[12px] flex items-center gap-2 flex-wrap"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
            <AlertCircle size={14} className="flex-shrink-0" />
            <span className="flex-1 min-w-[180px]">
              החיבור ל-Gmail פג. חיבור קבוע יישמר בשרת ולא יתנתק שוב — גם כשהמערכת
              סגורה לגמרי.
            </span>
            <button onClick={() => void reconnect()} disabled={reconnecting}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white disabled:opacity-60"
              style={{ background: '#d97706' }}>
              {reconnecting ? 'מתחבר…' : 'חבר לצמיתות'}
            </button>
          </div>
        )}
        {auth === 'none' && (
          <div className="px-4 py-2.5 text-[12px] flex items-center gap-2 flex-wrap"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>
            <AlertCircle size={14} className="flex-shrink-0" />
            <span className="flex-1 min-w-[180px]">אין חשבון Gmail מחובר.</span>
            <button onClick={() => void reconnect()} disabled={reconnecting}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white disabled:opacity-60"
              style={{ background: '#d97706' }}>
              {reconnecting ? 'מתחבר…' : 'חבר את Gmail'}
            </button>
          </div>
        )}
        {hebrewVoice === false && (
          <div className="px-4 py-2.5 text-[12px] flex items-center gap-2"
            style={{ background: 'rgba(245,158,11,0.10)', color: '#fbbf24' }}>
            <AlertCircle size={14} className="flex-shrink-0" />
            לדפדפן אין קול עברי מותקן — ההקראה תישמע במבטא זר.
          </div>
        )}

        {/* Conversation */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap"
                style={m.role === 'user'
                  ? { background: 'linear-gradient(135deg,#0369a1,#0891b2)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.88)' }}>
                {m.text}
                {m.offerMailId && (
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => {
                        const mail = mails.find(x => x.id === m.offerMailId);
                        if (mail) void readAloud(mail);
                      }}
                      disabled={!isSpeechSupported()}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white flex items-center gap-1.5 disabled:opacity-50"
                      style={{ background: '#0891b2' }}>
                      <Volume2 size={12} /> כן, הקרא
                    </button>
                    <button
                      onClick={() => {
                        const mail = mails.find(x => x.id === m.offerMailId);
                        if (mail) { setActive(mail); push({ role: 'assistant', text: `פתחתי את המייל מ־${mail.fromName}. מה לענות לו?` }); }
                      }}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.7)' }}>
                      לא, רק פתח
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-end">
              <div className="rounded-2xl px-3.5 py-2.5 flex items-center gap-2 text-[12px]"
                style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)' }}>
                <Loader2 size={13} className="animate-spin" /> חושב…
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="text-[12px] flex items-start gap-1.5" style={{ color: '#f87171' }}>
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />{error}
            </p>
          )}
        </div>

        {/* Draft awaiting approval */}
        {draft && (
          <div className="px-4 py-3 flex-shrink-0 space-y-2"
            style={{ borderTop: '1px solid rgba(255,255,255,0.09)', background: 'rgba(8,145,178,0.07)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-mono tracking-wider"
              style={{ color: 'rgba(255,255,255,0.45)' }}>
              <Sparkles size={11} /> טיוטת תשובה — עבור עליה לפני שליחה
            </div>
            <textarea
              value={draft.body}
              onChange={e => setDraft({ ...draft, body: e.target.value })}
              rows={7}
              className="w-full rounded-xl p-3 text-[13px] leading-relaxed"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', resize: 'vertical' }}
            />
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => void send()} disabled={sending}
                className="px-5 py-2 rounded-xl text-[13px] font-bold text-white flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: '#059669' }}>
                {sending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                {sending ? 'שולח…' : 'אשר ושלח'}
              </button>
              <button onClick={() => setDraft(null)}
                className="px-4 py-2 rounded-xl text-[13px] font-bold flex items-center gap-1.5"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.28)', color: '#f87171' }}>
                <Trash2 size={13} /> בטל
              </button>
              <span className="text-[11px] self-center" style={{ color: 'rgba(255,255,255,0.4)' }}>
                או הקלט שוב כדי לשנות את הניסוח
              </span>
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="px-3 py-3 flex-shrink-0 flex items-end gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }}>
          <button
            onClick={voice.toggle}
            title={voice.active ? 'עצור שיחה קולית' : 'דבר עם RAY'}
            aria-pressed={voice.active}
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
            style={{ background: voice.active ? '#dc2626' : 'rgba(255,255,255,0.08)' }}>
            {voice.speaking ? <Volume2 size={16} />
              : voice.active ? <Square size={15} />
              : <MessageCircle size={16} />}
          </button>
          <button
            onClick={() => dict.toggle(input)}
            disabled={!dict.supported || dict.transcribing}
            aria-label={dict.recording ? 'עצור הקלטה' : 'דבר'}
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-50"
            style={{ background: dict.recording ? '#dc2626' : 'rgba(255,255,255,0.08)' }}>
            {dict.transcribing ? <Loader2 size={16} className="animate-spin" />
              : dict.recording ? <Square size={15} /> : <Mic size={16} />}
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            rows={1}
            placeholder={active ? `מה לענות ל־${active.fromName}? אפשר לדבר…` : 'שאל על התיבה, או בחר מייל…'}
            className="flex-1 rounded-xl px-3 py-2.5 text-[13px] resize-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', maxHeight: 120 }}
          />
          <button onClick={() => void submit()} disabled={busy || !input.trim()}
            className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#0369a1,#0891b2)' }}>
            <Send size={16} />
          </button>
        </div>

        {active && !draft && (
          <div className="px-4 pb-3 -mt-1 text-[11px] flex items-center gap-1.5 flex-shrink-0"
            style={{ color: 'rgba(255,255,255,0.4)' }}>
            <Inbox size={11} /> מייל פתוח: {active.subject}
            <button onClick={() => setActive(null)} className="underline">סגור</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
