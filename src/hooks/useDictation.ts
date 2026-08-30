/**
 * useDictation — continuous Hebrew voice dictation with optional AI clean-up.
 *
 * Improves on the old one-shot SpeechRecognition:
 *   • continuous = true + interimResults → records until the user presses stop
 *   • auto-restarts on Chrome's silence-timeout so long dictation isn't cut off
 *   • after stop, the raw transcript is polished by Claude (fixes recognition
 *     errors + punctuation) so the note reads exactly as intended
 *
 * Usage:
 *   const dict = useDictation(setValue);          // setValue: React state setter
 *   <button onClick={() => dict.toggle(value)}>   // pass current field value
 */

import { useCallback, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySR = any;

// Chrome allows only ONE active SpeechRecognition per page. Track the live one
// so switching between fields (note ↔ contact log) aborts the previous session
// instead of silently failing to start.
let activeRecog: AnySR = null;

interface DictationOptions {
  lang?: string;
  polishWithAI?: boolean;
  onToast?: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function useDictation(
  setValue: (updater: (prev: string) => string) => void,
  opts: DictationOptions = {},
) {
  const { lang = 'he-IL', polishWithAI = true, onToast } = opts;

  const [recording, setRecording]     = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recogRef    = useRef<AnySR>(null);
  const baseRef     = useRef('');   // field text before this dictation session
  const finalRef    = useRef('');   // accumulated FINAL transcript this session
  const stoppingRef = useRef(false);

  const supported = typeof window !== 'undefined'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const compose = useCallback((interim = '') => {
    const spoken = (finalRef.current + (interim ? ' ' + interim : '')).trim();
    if (!baseRef.current) return spoken;
    if (!spoken) return baseRef.current;
    return `${baseRef.current} ${spoken}`;
  }, []);

  const start = useCallback((base: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { onToast?.('הדפדפן לא תומך בזיהוי דיבור — נסה ב-Chrome', 'error'); return; }

    // Abort any recognition already running (from another field) — Chrome allows one.
    if (activeRecog) { try { activeRecog.abort(); } catch { /* ignore */ } activeRecog = null; }

    baseRef.current  = base ?? '';
    finalRef.current = '';
    stoppingRef.current = false;

    const recog: AnySR = new SR();
    recog.lang = lang;
    recog.continuous = true;
    recog.interimResults = true;

    recog.onresult = (e: AnySR) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = (r[0]?.transcript ?? '').trim();
        if (!txt) continue;
        if (r.isFinal) finalRef.current += (finalRef.current ? ' ' : '') + txt;
        else interim += (interim ? ' ' : '') + txt;
      }
      setValue(() => compose(interim));
    };

    recog.onend = () => {
      // Chrome ends recognition after a silence window — restart to keep going
      // until the user explicitly presses stop.
      if (!stoppingRef.current) {
        try { recog.start(); } catch { /* already started / transient */ }
      } else {
        if (activeRecog === recog) activeRecog = null;
        setRecording(false);
      }
    };

    recog.onerror = (ev: AnySR) => {
      // 'no-speech' / 'aborted' are recoverable — let onend handle restart.
      if (ev?.error === 'no-speech' || ev?.error === 'aborted') return;
      if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
        onToast?.('אין הרשאת מיקרופון — אפשר גישה למיקרופון בדפדפן', 'error');
      }
      stoppingRef.current = true;
      if (activeRecog === recog) activeRecog = null;
      setRecording(false);
    };

    try {
      recog.start();
      activeRecog = recog;
    } catch {
      onToast?.('לא ניתן להתחיל הקלטה — נסה שוב', 'error');
      setRecording(false);
      return;
    }
    recogRef.current = recog;
    setRecording(true);
  }, [lang, setValue, compose, onToast]);

  const stop = useCallback(async () => {
    stoppingRef.current = true;
    try { recogRef.current?.stop(); } catch { /* ignore */ }
    if (activeRecog === recogRef.current) activeRecog = null;
    setRecording(false);

    const raw = finalRef.current.trim();
    if (!polishWithAI || !raw) return;

    setTranscribing(true);
    try {
      const { getAnthropicProxy } = await import('../lib/anthropicClient');
      const anthropic = getAnthropicProxy();
      const resp = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: 'אתה מנוע תמלול חכם בעברית. תקבל תמלול גולמי מזיהוי דיבור (עלול להכיל שגיאות זיהוי, מילים שגויות וחוסר פיסוק). תקן שגיאות זיהוי, הוסף פיסוק ורווחים נכונים, וסדר את המשפטים — אך שמור במדויק על המשמעות והתוכן המקורי. אל תוסיף, תסיר או תמציא מידע. החזר אך ורק את הטקסט המתוקן, ללא הקדמות.',
        messages: [{ role: 'user', content: raw }],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleaned = (resp.content?.find((b: any) => b.type === 'text') as any)?.text?.trim();
      if (cleaned) {
        finalRef.current = cleaned;
        setValue(() => compose());
      }
    } catch {
      /* keep the raw transcript on failure */
    } finally {
      setTranscribing(false);
    }
  }, [polishWithAI, setValue, compose]);

  const toggle = useCallback((currentValue: string) => {
    if (recording) void stop();
    else start(currentValue);
  }, [recording, start, stop]);

  return { recording, transcribing, supported, toggle };
}
