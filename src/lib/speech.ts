/**
 * speech.ts — reading text aloud, in Hebrew where the browser can.
 *
 * Wraps the Web Speech API, which has three sharp edges worth hiding once
 * rather than in every caller:
 *
 *  1. `getVoices()` is empty on first call in Chrome until the async
 *     `voiceschanged` event fires, so a naive lookup silently falls back to the
 *     default (usually English) voice and reads Hebrew as gibberish.
 *  2. Long text is truncated or dropped by several engines, so it is chunked on
 *     sentence boundaries.
 *  3. Nothing cancels an in-flight utterance automatically — starting a second
 *     read while the first is speaking produces two voices at once.
 */

export interface SpeakHandle {
  /** Stop immediately. Safe to call after it has already finished. */
  stop: () => void;
  /** Resolves when the whole text has been read, or rejects if it failed. */
  done: Promise<void>;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Voices load asynchronously; resolve once they are actually available. */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) { resolve(existing); return; }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    // Some browsers never fire the event when the list is genuinely empty.
    setTimeout(finish, 1200);
  });
}

/** Best available voice for a language, or null when the browser has none. */
export async function findVoice(lang = 'he'): Promise<SpeechSynthesisVoice | null> {
  const voices = await loadVoices();
  return voices.find(v => v.lang?.toLowerCase().startsWith(lang.toLowerCase()))
      ?? null;
}

/** True when the browser can actually read Hebrew rather than mangling it. */
export async function hasHebrewVoice(): Promise<boolean> {
  return (await findVoice('he')) !== null;
}

/**
 * Split on sentence ends so each utterance stays short. Chunks are capped
 * because some engines silently drop anything past a few hundred characters.
 */
function chunk(text: string, max = 220): string[] {
  const sentences = String(text ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…:])\s+/)
    .filter(Boolean);

  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (s.length > max) {
      if (cur) { out.push(cur); cur = ''; }
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
      continue;
    }
    if ((cur + ' ' + s).trim().length > max) { out.push(cur); cur = s; }
    else cur = (cur ? `${cur} ${s}` : s);
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Read text aloud. Cancels anything already speaking, so two reads can never
 * overlap.
 */
export async function speak(
  text: string,
  opts: { lang?: string; rate?: number; onProgress?: (spokenSoFar: string) => void } = {},
): Promise<SpeakHandle> {
  if (!isSpeechSupported()) {
    throw new Error('הדפדפן לא תומך בהקראה — נסה ב-Chrome או Edge');
  }
  const { lang = 'he-IL', rate = 1, onProgress } = opts;
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('אין טקסט להקראה');

  window.speechSynthesis.cancel();

  const voice = await findVoice(lang.split('-')[0]);
  const parts = chunk(clean);
  let stopped = false;
  let spoken = '';

  const done = new Promise<void>((resolve, reject) => {
    let i = 0;
    const next = () => {
      if (stopped) { resolve(); return; }
      if (i >= parts.length) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(parts[i]);
      u.lang = lang;
      u.rate = rate;
      if (voice) u.voice = voice;
      u.onend = () => {
        spoken += (spoken ? ' ' : '') + parts[i];
        onProgress?.(spoken);
        i++;
        next();
      };
      u.onerror = ev => {
        // 'interrupted' / 'canceled' are what stop() produces — not failures.
        const err = (ev as SpeechSynthesisErrorEvent).error;
        if (stopped || err === 'interrupted' || err === 'canceled') { resolve(); return; }
        reject(new Error(`ההקראה נכשלה: ${err}`));
      };
      window.speechSynthesis.speak(u);
    };
    next();
  });

  return {
    stop: () => { stopped = true; window.speechSynthesis.cancel(); },
    done,
  };
}

/** Stop any reading in progress, wherever it was started from. */
export function stopSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}

/**
 * Strip an email body down to what is worth hearing: quoted replies,
 * signatures and link soup make a read-aloud unbearable long before they make
 * it uninformative.
 */
export function readableEmailText(body: string, maxChars = 1800): string {
  const cleaned = String(body ?? '')
    .replace(/^>.*$/gm, '')                               // quoted replies
    .replace(/^-{2,}\s*$[\s\S]*$/m, '')                   // signature block
    .replace(/https?:\/\/\S+/g, 'קישור')                  // URLs read terribly
    .replace(/[*_#|`]+/g, ' ')                            // markdown noise
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned;
}
