/**
 * useVoiceChat — hold a spoken conversation with RAY inside any chat.
 *
 * The general assistant already had a hands-free mode; the four specialised
 * chats had no microphone at all. Rather than copy that loop four times, this
 * hook owns it once: listen → send → speak the answer → listen again, until the
 * user stops it.
 *
 * Three hazards the loop exists to handle, all of which produce baffling
 * behaviour if ignored:
 *
 *  • Chrome allows exactly ONE SpeechRecognition at a time across the page. A
 *    second one started while another lives fails silently, so this aborts its
 *    own before every start and on unmount.
 *  • Never listen while speaking. The microphone hears RAY's own voice and
 *    transcribes it as the user's next question, which turns the assistant into
 *    an infinite conversation with itself.
 *  • Never listen while the answer is being generated. Speech captured then has
 *    nowhere to go and is silently dropped, which reads as "it ignored me".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { speak, stopSpeaking, isSpeechSupported } from './speech';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

export interface VoiceChatOptions {
  /** Submit what the user said. */
  onSay: (text: string) => void;
  /**
   * The latest assistant reply. When this changes while the conversation is
   * active it is read aloud, then listening resumes.
   */
  lastReply?: string;
  /** True while an answer is being produced — the loop waits rather than listens. */
  busy?: boolean;
  lang?: string;
}

export function useVoiceChat({ onSay, lastReply, busy, lang = 'he-IL' }: VoiceChatOptions) {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');

  const recogRef = useRef<AnySR>(null);
  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const spokenRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);

  busyRef.current = !!busy;

  const supported = typeof window !== 'undefined'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    && isSpeechSupported();

  const abortRecog = useCallback(() => {
    try { recogRef.current?.abort(); } catch { /* not started */ }
    recogRef.current = null;
    setListening(false);
  }, []);

  const listen = useCallback(() => {
    if (!activeRef.current || speakingRef.current || busyRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    abortRecog();                       // Chrome: only one at a time
    const recog: AnySR = new SR();
    recog.lang = lang;
    recog.continuous = false;           // one utterance, then we decide what next
    recog.interimResults = false;

    let got = '';
    recog.onresult = (e: AnySR) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) got += e.results[i][0]?.transcript ?? '';
      }
    };
    recog.onerror = (ev: AnySR) => {
      const err = ev?.error;
      if (err === 'no-speech' || err === 'aborted') return;   // ordinary, keep going
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        setError('אין הרשאת מיקרופון — אפשר גישה בדפדפן');
        activeRef.current = false;
        setActive(false);
      }
    };
    recog.onend = () => {
      setListening(false);
      const said = got.trim();
      if (!activeRef.current) return;
      if (said) { onSay(said); return; }        // the reply will restart listening
      // Nothing heard — go round again so the user can simply keep talking.
      setTimeout(() => listen(), 300);
    };

    try { recog.start(); recogRef.current = recog; setListening(true); }
    catch { /* a start that races another abort is harmless */ }
  }, [abortRecog, lang, onSay]);

  /* Speak each new reply, then hand the turn back to the user. */
  useEffect(() => {
    if (!active || !lastReply || lastReply === spokenRef.current) return;
    spokenRef.current = lastReply;
    let cancelled = false;
    void (async () => {
      abortRecog();
      speakingRef.current = true; setSpeaking(true);
      try {
        const h = await speak(lastReply, { lang });
        await h.done;
      } catch { /* an unspeakable reply must not end the conversation */ }
      speakingRef.current = false; setSpeaking(false);
      if (!cancelled && activeRef.current) setTimeout(() => listen(), 250);
    })();
    return () => { cancelled = true; };
  }, [lastReply, active, listen, abortRecog, lang]);

  /* Resume listening once the answer has finished generating. */
  useEffect(() => {
    if (active && !busy && !speakingRef.current && !listening) {
      const id = setTimeout(() => listen(), 300);
      return () => clearTimeout(id);
    }
  }, [busy, active, listening, listen]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    abortRecog();
    stopSpeaking();
    speakingRef.current = false;
    setSpeaking(false);
  }, [abortRecog]);

  const toggle = useCallback(() => {
    if (activeRef.current) { stop(); return; }
    if (!supported) {
      setError('הדפדפן לא תומך בשיחה קולית — נסה ב-Chrome או Edge');
      return;
    }
    setError('');
    // Do not read out whatever is already on screen when the mode is switched on.
    spokenRef.current = lastReply;
    activeRef.current = true;
    setActive(true);
    listen();
  }, [supported, stop, listen, lastReply]);

  useEffect(() => () => { activeRef.current = false; abortRecog(); stopSpeaking(); }, [abortRecog]);

  return { supported, active, listening, speaking, error, toggle, stop };
}
