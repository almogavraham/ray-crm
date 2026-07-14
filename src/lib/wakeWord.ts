/**
 * wakeWord.ts
 * Continuous background listener for "HEY RAY" trigger phrase.
 * Uses browser's built-in Web Speech API — zero dependencies, zero cost.
 * Alternates between he-IL and en-US on every restart for best coverage.
 *
 * Permission policy:
 *  - If the user denies microphone access, we stop immediately and never retry.
 *  - We do NOT spam permission dialogs.
 *  - Mobile: caller (App.tsx) defaults this to opt-in so the status bar mic indicator
 *    never appears without the user explicitly enabling it.
 */

type OnWakeCallback = () => void;
type OnPermissionDeniedCallback = () => void;

// Hebrew mode phrases
const WAKE_PHRASES_HE = [
  'הי ריי', 'הי רי', 'היי ריי', 'היי רי', 'הי רייי',
  'hey ray', 'hi ray', 'hey rei', 'hay ray', 'hey re',
];

// English mode phrases
const WAKE_PHRASES_EN = [
  'hey ray', 'hi ray', 'hay ray', 'hey rei', 'hey re',
  'hey r', 'hey rai',
];

class WakeWordDetector {
  private recognition: SpeechRecognition | null = null;
  private onWake: OnWakeCallback | null = null;
  private onPermissionDenied: OnPermissionDeniedCallback | null = null;
  private _active = false;
  private _cooldown = false;
  private _permissionDenied = false; // latched — never retry after denial
  private _restartTimer: ReturnType<typeof setTimeout> | null = null;
  private _useEnglish = false; // alternates on each restart

  get isActive() { return this._active; }
  get isPermissionDenied() { return this._permissionDenied; }

  start(onWake: OnWakeCallback, onDenied?: OnPermissionDeniedCallback): void {
    // If mic was already denied this session, don't even try
    if (this._permissionDenied) {
      console.warn('[WakeWord] Mic permission was denied — not starting.');
      return;
    }

    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[WakeWord] SpeechRecognition not supported.');
      return;
    }
    this.onWake = onWake;
    this.onPermissionDenied = onDenied ?? null;
    this._active = true;
    this._startRecognition(SpeechRecognition);
  }

  private _startRecognition(SR: typeof window.SpeechRecognition): void {
    if (!this._active || this._permissionDenied) return;
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
    }

    // Alternate language on every restart for bilingual coverage
    this._useEnglish = !this._useEnglish;
    const phrases = this._useEnglish ? WAKE_PHRASES_EN : WAKE_PHRASES_HE;

    const rec = new SR();
    rec.lang = this._useEnglish ? 'en-US' : 'he-IL';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      if (this._cooldown) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        for (let j = 0; j < result.length; j++) {
          const transcript = result[j].transcript.toLowerCase().trim();
          if (phrases.some(p => transcript.includes(p))) {
            this._cooldown = true;
            setTimeout(() => { this._cooldown = false; }, 4000);
            this.onWake?.();
            return;
          }
        }
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        // Permission denied — latch and never retry. Don't spam the user.
        this._permissionDenied = true;
        this._active = false;
        this.recognition = null;
        this.onPermissionDenied?.();
        console.warn('[WakeWord] Mic permission denied. Wake word disabled.');
      } else if (event.error === 'network') {
        // Network error on speech service — retry with longer backoff
        this._scheduleRestart(SR, 3000);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        // Other transient errors — retry normally
        this._scheduleRestart(SR, 1200);
      }
      // 'no-speech' and 'aborted' are handled by onend
    };

    rec.onend = () => {
      if (this._active && !this._permissionDenied) this._scheduleRestart(SR, 800);
    };

    try {
      rec.start();
      this.recognition = rec;
    } catch {
      // start() can throw if another recognition is running — retry after a pause
      this._scheduleRestart(SR, 1500);
    }
  }

  private _scheduleRestart(SR: typeof window.SpeechRecognition, delay = 800): void {
    if (!this._active || this._permissionDenied) return;
    if (this._restartTimer) clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => this._startRecognition(SR), delay);
  }

  stop(): void {
    this._active = false;
    if (this._restartTimer) { clearTimeout(this._restartTimer); this._restartTimer = null; }
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
      this.recognition = null;
    }
    this.onWake = null;
    // Note: _permissionDenied is NOT reset on stop — it's a session-level latch
  }

  /** Call this if the user explicitly re-enables wake word after a denial (they may have granted permission in settings) */
  resetPermission(): void {
    this._permissionDenied = false;
  }
}

export const wakeWordDetector = new WakeWordDetector();

export function isSpeechSupported(): boolean {
  return !!(
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  );
}
