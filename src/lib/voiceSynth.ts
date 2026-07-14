/**
 * voiceSynth.ts
 * Text-to-Speech wrapper using the browser's built-in SpeechSynthesis API.
 * Supports Hebrew (he-IL) and falls back to the first available voice.
 * Zero cost, zero dependencies.
 */

let _hebrewVoice: SpeechSynthesisVoice | null = null;
let _voicesLoaded = false;

function loadVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null;
  if (_voicesLoaded) return _hebrewVoice;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  _voicesLoaded = true;
  // Prefer Hebrew
  _hebrewVoice =
    voices.find(v => v.lang === 'he-IL') ??
    voices.find(v => v.lang.startsWith('he')) ??
    voices.find(v => v.lang === 'en-US') ??
    voices[0];
  return _hebrewVoice;
}

// Voices load asynchronously in some browsers
if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => { _voicesLoaded = false; loadVoice(); };
}

/** Wait up to `ms` milliseconds for voices to load (needed on mobile).
 *  Uses addEventListener to avoid clobbering the global onvoiceschanged handler. */
export function waitForVoices(ms = 2000): Promise<void> {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    if (window.speechSynthesis.getVoices().length > 0) { resolve(); return; }
    const timer = setTimeout(resolve, ms);
    const handler = () => {
      clearTimeout(timer);
      _voicesLoaded = false;
      loadVoice();
      window.speechSynthesis.removeEventListener('voiceschanged', handler);
      resolve();
    };
    window.speechSynthesis.addEventListener('voiceschanged', handler);
  });
}

export function isTTSSupported(): boolean {
  return 'speechSynthesis' in window;
}

export function isSpeaking(): boolean {
  return 'speechSynthesis' in window && window.speechSynthesis.speaking;
}

export function cancelSpeech(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/** Speak text aloud. Returns a Promise that resolves when speaking ends.
 *  Includes a hard timeout (default 6 s) so the promise never hangs forever
 *  (critical on iOS where onend/onerror sometimes never fire). */
export function speak(text: string, rate = 1.05, pitch = 1.0, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) { resolve(); return; }
    cancelSpeech();

    // Ensure voices are ready (especially first call on mobile)
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0 && !_voicesLoaded) { _voicesLoaded = false; loadVoice(); }

    const voice = loadVoice();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang  = voice?.lang ?? 'he-IL';
    utterance.rate  = rate;
    utterance.pitch = pitch;
    utterance.volume = 0.9;
    if (voice) utterance.voice = voice;

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      clearTimeout(nudge);
      fn();
    };

    // Hard timeout — resolves if onend/onerror never fire (iOS bug)
    const hardTimeout = setTimeout(() => settle(resolve), timeoutMs);

    utterance.onend   = () => settle(resolve);
    utterance.onerror = (e) => {
      const err = (e as SpeechSynthesisErrorEvent).error;
      // 'interrupted' is normal when we cancel mid-speech
      if (err === 'interrupted' || err === 'canceled') settle(resolve);
      else settle(() => reject(e));
    };

    // Chrome bug: synthesis sometimes hangs; nudge it
    window.speechSynthesis.speak(utterance);
    const nudge = setTimeout(() => {
      if (!settled && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 300);
  });
}

/** Speak a short confirmation chime text for AI actions */
export function speakAction(text: string): Promise<void> {
  return speak(text, 1.1, 1.05);
}
