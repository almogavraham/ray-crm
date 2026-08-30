/**
 * AccessibilityWidget — the adjustments panel required of an Israeli site.
 *
 * Every option here changes something real. A widget whose buttons do nothing
 * but look compliant is worse than none: it tells a visitor who needs the
 * adjustment that the site tried and that this is as good as it gets.
 *
 * Choices persist, because someone who needs larger text needs it on every
 * visit, and re-setting it each time is itself the barrier.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Accessibility, X, RotateCcw, Type, Contrast, Link2, Eye, Pause, MousePointer2,
} from 'lucide-react';

interface A11yState {
  fontScale: number;      // 100 – 160 (%)
  contrast: boolean;      // high-contrast palette
  grayscale: boolean;
  underlineLinks: boolean;
  readableFont: boolean;
  stopMotion: boolean;
  bigCursor: boolean;
}

const DEFAULTS: A11yState = {
  fontScale: 100, contrast: false, grayscale: false,
  underlineLinks: false, readableFont: false, stopMotion: false, bigCursor: false,
};

const KEY = 'ray-a11y';

function read(): A11yState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

/** Apply to the document. Kept outside the component so start-up can call it. */
export function applyA11y(s: A11yState): void {
  const root = document.documentElement;
  root.style.setProperty('--a11y-font-scale', String(s.fontScale / 100));
  root.classList.toggle('a11y-contrast', s.contrast);
  root.classList.toggle('a11y-grayscale', s.grayscale);
  root.classList.toggle('a11y-underline', s.underlineLinks);
  root.classList.toggle('a11y-readable', s.readableFont);
  root.classList.toggle('a11y-stop-motion', s.stopMotion);
  root.classList.toggle('a11y-big-cursor', s.bigCursor);
}

/** Re-apply a stored preference before first paint. */
export function initA11y(): void { applyA11y(read()); }

export default function AccessibilityWidget() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<A11yState>(read);

  useEffect(() => {
    applyA11y(s);
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* still applies this session */ }
  }, [s]);

  // Escape closes the panel — a keyboard user must be able to leave without
  // hunting for the close button.
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open]);

  const set = useCallback(<K extends keyof A11yState>(k: K, v: A11yState[K]) =>
    setS(prev => ({ ...prev, [k]: v })), []);

  const Toggle = ({ k, label, icon: Icon }: {
    k: keyof Omit<A11yState, 'fontScale'>; label: string; icon: typeof Contrast;
  }) => (
    <button
      onClick={() => set(k, !s[k] as never)}
      aria-pressed={s[k] as boolean}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-colors text-right"
      style={s[k]
        ? { background: '#4f46e5', color: '#fff' }
        : { background: '#f1f5f9', color: '#334155' }}
    >
      <Icon size={15} className="flex-shrink-0" />
      <span className="flex-1">{label}</span>
    </button>
  );

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label="תפריט נגישות"
        className="fixed z-[60] bottom-5 left-5 w-12 h-12 rounded-full shadow-lg flex items-center
                   justify-center transition-transform hover:scale-105 focus:outline-none
                   focus:ring-4 focus:ring-indigo-300"
        style={{ background: '#1d4ed8', color: '#fff' }}
      >
        <Accessibility size={22} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="הגדרות נגישות"
          dir="rtl"
          className="fixed z-[61] bottom-20 left-5 w-[290px] max-w-[calc(100vw-2.5rem)] rounded-2xl
                     shadow-2xl border border-slate-200 bg-white p-4 max-h-[75vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setOpen(false)} aria-label="סגור תפריט נגישות"
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
              <X size={16} />
            </button>
            <h2 className="text-[15px] font-black text-slate-900">הגדרות נגישות</h2>
          </div>

          <div className="mb-3">
            <label htmlFor="a11y-font" className="flex items-center gap-2 text-[13px] font-semibold text-slate-700 mb-1.5">
              <Type size={14} /> גודל טקסט — {s.fontScale}%
            </label>
            <input
              id="a11y-font" type="range" min={100} max={160} step={10}
              value={s.fontScale}
              onChange={e => set('fontScale', Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
          </div>

          <div className="space-y-1.5">
            <Toggle k="contrast"       label="ניגודיות גבוהה"  icon={Contrast} />
            <Toggle k="grayscale"      label="גווני אפור"       icon={Eye} />
            <Toggle k="underlineLinks" label="הדגשת קישורים"    icon={Link2} />
            <Toggle k="readableFont"   label="גופן קריא"        icon={Type} />
            <Toggle k="stopMotion"     label="עצירת אנימציות"   icon={Pause} />
            <Toggle k="bigCursor"      label="סמן עכבר גדול"    icon={MousePointer2} />
          </div>

          <button
            onClick={() => setS(DEFAULTS)}
            className="w-full mt-3 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl
                       text-[13px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700"
          >
            <RotateCcw size={14} /> איפוס הגדרות
          </button>

          <a href="/accessibility"
            className="block mt-3 text-center text-[12px] text-indigo-600 hover:underline font-semibold">
            הצהרת הנגישות המלאה
          </a>
        </div>
      )}
    </>
  );
}
