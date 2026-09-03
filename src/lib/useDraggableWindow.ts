/**
 * useDraggableWindow — turns a modal chat into a floating window you can move.
 *
 * The chats were built as modals: a full-screen backdrop that dims the app and
 * closes on click. That is the wrong shape for an assistant you consult *while*
 * working — it hides the very screen you are asking about, and any stray click
 * dismisses it. On a wide screen this hook converts them into free-floating
 * windows: no backdrop, the app behind stays live and clickable, and the window
 * goes wherever it is dragged.
 *
 * On phones it deliberately changes nothing. Dragging a panel around a 375px
 * viewport is not useful, and the bottom sheet is the right pattern there.
 *
 * Position persists per chat, because someone who moved a window to their
 * second monitor's corner meant it, and having it snap back every time is the kind
 * of small betrayal that makes a feature feel broken.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Below this width the modal/bottom-sheet behaviour is kept. */
const FLOAT_MIN_WIDTH = 640;
/** Always leave this much of the window on screen, so it can be grabbed back. */
const KEEP_VISIBLE = 80;

export interface Pos { x: number; y: number }

const storageKey = (key: string) => `ray-chat-pos:${key}`;

function readStored(key: string): Pos | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    return typeof p?.x === 'number' && typeof p?.y === 'number' ? p : null;
  } catch { return null; }
}

/** Keep the window reachable no matter how the viewport changed since. */
function clamp(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 480;
  const h = el?.offsetHeight ?? 400;
  return {
    x: Math.min(Math.max(p.x, KEEP_VISIBLE - w), window.innerWidth - KEEP_VISIBLE),
    y: Math.min(Math.max(p.y, 0), window.innerHeight - KEEP_VISIBLE),
  };
}

/**
 * Stagger the default position per chat so opening two of them does not stack
 * one exactly on top of the other.
 */
function defaultPos(key: string, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 560;
  const h = el?.offsetHeight ?? Math.round(window.innerHeight * 0.85);
  const step = [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  return {
    x: Math.max(16, (window.innerWidth - w) / 2 + step * 28 - 42),
    y: Math.max(16, (window.innerHeight - h) / 2 + step * 22 - 33),
  };
}

export function useDraggableWindow(key: string) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [floating, setFloating] = useState(
    () => typeof window !== 'undefined' && window.innerWidth >= FLOAT_MIN_WIDTH,
  );
  const [pos, setPos] = useState<Pos | null>(null);
  const [dragging, setDragging] = useState(false);
  const grab = useRef<Pos>({ x: 0, y: 0 });

  useEffect(() => {
    const onResize = () => {
      setFloating(window.innerWidth >= FLOAT_MIN_WIDTH);
      setPos(p => (p ? clamp(p, panelRef.current) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /**
   * Place the window as soon as it is in the DOM.
   *
   * This used to wait for a `requestAnimationFrame`, which does not fire while
   * the tab is hidden or throttled — and the window is `visibility: hidden`
   * until it has a position, so a chat opened in a background tab stayed
   * invisible with no way to recover. A layout effect runs synchronously after
   * mount, when the element is measurable, so the position is always set and
   * the window still never flashes at the corner first.
   */
  useLayoutEffect(() => {
    if (!floating || pos) return;
    setPos(clamp(readStored(key) ?? defaultPos(key, panelRef.current), panelRef.current));
  }, [floating, pos, key]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!floating) return;
    // Never start a drag from a control in the header — the close and refresh
    // buttons have to keep working.
    if ((e.target as HTMLElement).closest('button, a, input, textarea, select')) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    grab.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [floating]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setPos(clamp({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }, panelRef.current));
  }, [dragging]);

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    setPos(p => {
      if (p) { try { localStorage.setItem(storageKey(key), JSON.stringify(p)); } catch { /* private mode */ } }
      return p;
    });
  }, [dragging, key]);

  const resetPosition = useCallback(() => {
    try { localStorage.removeItem(storageKey(key)); } catch { /* nothing stored */ }
    setPos(clamp(defaultPos(key, panelRef.current), panelRef.current));
  }, [key]);

  /** Spread on the full-screen wrapper. */
  const backdropProps = floating
    ? {
        // Transparent and click-through: the app behind must stay usable, and a
        // stray click on it must not dismiss the assistant.
        style: { background: 'transparent', pointerEvents: 'none' as const, backdropFilter: 'none' },
        onClick: undefined,
      }
    : {
        style: { background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' },
      };

  /** Spread on the panel itself. */
  const panelProps = {
    ref: panelRef,
    style: floating
      ? {
          position: 'fixed' as const,
          left: pos?.x ?? 0,
          top: pos?.y ?? 0,
          margin: 0,
          width: 'min(92vw, 560px)',
          height: 'min(78vh, 700px)',
          maxHeight: 'min(78vh, 700px)',
          pointerEvents: 'auto' as const,
          // Hidden until measured, so it never flashes at the top-left corner.
          visibility: (pos ? 'visible' : 'hidden') as 'visible' | 'hidden',
          transition: dragging ? 'none' : 'box-shadow .15s',
          boxShadow: dragging
            ? '0 24px 60px rgba(0,0,0,0.45)'
            : '0 16px 44px rgba(0,0,0,0.30)',
        }
      : { pointerEvents: 'auto' as const },
  };

  /** Spread on the header that acts as the drag handle. */
  const handleProps = floating
    ? {
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        style: { cursor: dragging ? 'grabbing' as const : 'grab' as const, touchAction: 'none' as const },
      }
    : {};

  return { floating, dragging, backdropProps, panelProps, handleProps, resetPosition };
}
