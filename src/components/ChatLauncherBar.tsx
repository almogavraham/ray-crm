/**
 * ChatLauncherBar — the row of chat buttons, movable and collapsible.
 *
 * The bar was pinned to the top centre, which is directly over the page title
 * and the toolbar beneath it on most screens. There was no way to move it and
 * no way to make it smaller, so on a narrow window it covered the thing the
 * user was trying to read.
 *
 * Three details that decide whether dragging feels right:
 *
 *  • **A grip, not the whole bar.** If the buttons themselves dragged, every
 *    click would risk being read as a one-pixel drag and the chat would not
 *    open. The grip is the only drag surface; the buttons stay buttons.
 *
 *  • **Pointer events, with capture.** Mouse events lose the element the moment
 *    the cursor outruns it, which on a fast drag leaves the bar stuck
 *    mid-flight. Capturing the pointer keeps the moves coming until release.
 *
 *  • **Clamped back into view on resize.** A bar parked at the right edge of a
 *    wide window would otherwise be off-screen — and therefore unreachable —
 *    on a narrow one.
 *
 * Position and collapsed state persist per workspace, because this is a
 * preference about someone's own screen, not a setting worth syncing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Minimize2, Maximize2 } from 'lucide-react';

/** Keep at least this much of the bar on screen, whatever the window does. */
const KEEP_VISIBLE = 60;

interface Pos { x: number; y: number }

export interface ChatLauncherItem {
  key: string;
  label: string;
  title: string;
  bg: string;
  shadow: string;
  icon: React.ComponentType<{ size?: number }>;
  badge?: React.ReactNode;
  open: () => void;
}

export default function ChatLauncherBar({ items, storageKey }: {
  items: ChatLauncherItem[];
  /** Scoped per workspace so one person's layout is not another's. */
  storageKey: string;
}) {
  const posKey = `${storageKey}_pos`;
  const minKey = `${storageKey}_min`;

  const barRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => {
    try {
      const raw = localStorage.getItem(posKey);
      return raw ? JSON.parse(raw) as Pos : null;
    } catch { return null; }
  });
  const [minimized, setMinimized] = useState(() => {
    try { return localStorage.getItem(minKey) === '1'; } catch { return false; }
  });

  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const clamp = useCallback((p: Pos): Pos => {
    const el = barRef.current;
    const w = el?.offsetWidth ?? 300;
    const h = el?.offsetHeight ?? 48;
    return {
      x: Math.min(Math.max(p.x, KEEP_VISIBLE - w), window.innerWidth - KEEP_VISIBLE),
      y: Math.min(Math.max(p.y, 0), window.innerHeight - h),
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    // Without capture, a drag faster than the browser's hit-testing drops the
    // element and the bar freezes partway.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos(clamp({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    setPos(p => {
      if (p) { try { localStorage.setItem(posKey, JSON.stringify(p)); } catch { /* private mode */ } }
      return p;
    });
  };

  // A position saved on a wide window can be off-screen on a narrow one, which
  // would leave the bar unreachable with no way to bring it back.
  useEffect(() => {
    const onResize = () => setPos(p => (p ? clamp(p) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const toggleMin = () => {
    setMinimized(m => {
      const next = !m;
      try { localStorage.setItem(minKey, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  };

  // Until it is moved, the bar keeps its original centred position — physical
  // left/translate rather than a logical inset, which under dir="rtl" would
  // resolve to the right edge where the sidebar sits.
  const placement: React.CSSProperties = pos
    ? { top: pos.y, left: pos.x }
    : { top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)', left: '50%', transform: 'translateX(-50%)' };

  return (
    <div
      ref={barRef}
      className="fixed z-50 flex items-center gap-2 flex-wrap justify-center px-2"
      style={{ ...placement, maxWidth: 'min(96vw, 900px)' }}
    >
      {/* Drag grip — the only surface that moves the bar. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="גרור כדי להזיז"
        className="flex items-center justify-center rounded-xl cursor-grab active:cursor-grabbing select-none touch-none"
        style={{
          width: 22, height: 34,
          background: 'rgba(15,23,42,0.55)',
          border: '1px solid rgba(255,255,255,0.18)',
          backdropFilter: 'blur(6px)',
        }}
      >
        <GripVertical size={13} color="rgba(255,255,255,0.75)" />
      </div>

      {items.map(b => (
        <button
          key={b.key}
          onClick={b.open}
          title={minimized ? `${b.title} — ${b.label}` : b.title}
          aria-label={b.label}
          className={`flex items-center gap-2 text-white font-bold text-[13px] transition-transform hover:scale-105 active:scale-95 ${
            minimized ? 'justify-center rounded-full' : 'px-3.5 py-2.5 rounded-2xl'
          }`}
          style={{
            background: b.bg,
            boxShadow: `0 8px 28px ${b.shadow}`,
            // Matches the general assistant's launcher, which is the size the
            // note asked these to shrink to.
            ...(minimized ? { width: 44, height: 44, padding: 0 } : {}),
          }}
        >
          <b.icon size={16} />
          {!minimized && <span>{b.label}</span>}
          {b.badge}
        </button>
      ))}

      <button
        onClick={toggleMin}
        title={minimized ? 'הצג שמות' : 'מזער לאייקונים'}
        aria-label={minimized ? 'הצג שמות' : 'מזער לאייקונים'}
        className="flex items-center justify-center rounded-xl transition-colors"
        style={{
          width: 30, height: 34,
          background: 'rgba(15,23,42,0.55)',
          border: '1px solid rgba(255,255,255,0.18)',
          backdropFilter: 'blur(6px)',
        }}
      >
        {minimized
          ? <Maximize2 size={13} color="rgba(255,255,255,0.75)" />
          : <Minimize2 size={13} color="rgba(255,255,255,0.75)" />}
      </button>
    </div>
  );
}
