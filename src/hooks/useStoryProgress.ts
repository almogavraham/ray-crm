/**
 * useStoryProgress — drives a "pinned scroll story" (Apple/Stripe-style
 * scrollytelling): a tall wrapper section holds a `position: sticky` stage
 * that stays pinned in the viewport while the user scrolls through the
 * wrapper's extra height; this hook returns how far through that pinned
 * scroll the user currently is, as a smooth 0→1 value.
 *
 * Unlike useScrollParallax (many independent decorative layers), this drives
 * ONE narrative timeline that the calling component slices into scene bands
 * (e.g. 0.05–0.25 = "scene 1"), so objects can enter, act out a beat, and
 * exit in a deliberate sequence as the user scrolls — not just drift.
 *
 * Driven by the native `scroll` event (fires reliably regardless of tab
 * visibility/compositing state — unlike a free-running rAF loop, which
 * browsers throttle or fully suspend on backgrounded/hidden tabs) and
 * rAF-batched so rapid scroll events only trigger one recompute per frame.
 * getBoundingClientRect() is cheap enough to call unconditionally on scroll
 * (already capped to ~60/s by the rAF batching), so no IntersectionObserver
 * gate is needed. Disabled entirely under prefers-reduced-motion.
 */

import { useEffect, useRef, useState } from 'react';

export function useStoryProgress(wrapperRef: React.RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);
  const lastRef = useRef(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let rafId: number | null = null;

    const recompute = () => {
      rafId = null;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const raw = total > 0 ? -rect.top / total : 0;
      const p = Math.max(0, Math.min(1, raw));
      if (Math.abs(p - lastRef.current) > 0.0015) {
        lastRef.current = p;
        setProgress(p);
      }
    };
    const schedule = () => { if (rafId === null) rafId = requestAnimationFrame(recompute); };

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule(); // catch the case where it's already in view on mount

    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [wrapperRef]);

  return progress;
}

/** Local 0→1 progress within a [start,end] band of the overall timeline. */
export function band(progress: number, start: number, end: number): number {
  return Math.max(0, Math.min(1, (progress - start) / (end - start)));
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Fade in over the first `edge` of the band, hold, fade out over the last `edge`. */
export function bandOpacity(local: number, edge = 0.25): number {
  if (local <= 0 || local >= 1) return 0;
  if (local < edge) return easeOutCubic(local / edge);
  if (local > 1 - edge) return easeOutCubic((1 - local) / edge);
  return 1;
}

/** Slide from `from`px → 0 on entry, 0 → `to`px on exit (px along Y). */
export function bandTranslateY(local: number, from = 36, to = -24, edge = 0.25): number {
  if (local <= 0) return from;
  if (local >= 1) return to;
  if (local < edge) return from * (1 - easeOutCubic(local / edge));
  if (local > 1 - edge) return to * easeOutCubic((local - (1 - edge)) / edge);
  return 0;
}

/** Same as bandTranslateY but along X — for a text block that arrives from the side. */
export function bandTranslateX(local: number, from = 120, to = -80, edge = 0.25): number {
  if (local <= 0) return from;
  if (local >= 1) return to;
  if (local < edge) return from * (1 - easeOutCubic(local / edge));
  if (local > 1 - edge) return to * easeOutCubic((local - (1 - edge)) / edge);
  return 0;
}

/**
 * "Appear once and stay" variant — for building up a sentence out of pieces
 * that should each arrive and then REMAIN on screen (not fade back out) as
 * later pieces join them. Ramps 0→1 over `edge` starting at `appearAt`, then
 * holds at 1 for the rest of the timeline.
 */
export function stayOpacity(progress: number, appearAt: number, edge = 0.1): number {
  if (progress <= appearAt) return 0;
  return easeOutCubic(Math.min(1, (progress - appearAt) / edge));
}

/** Slides from `fromPx` → 0 starting at `appearAt`, then holds at 0 (settled in place). */
export function stayTranslateX(progress: number, appearAt: number, fromPx: number, edge = 0.1): number {
  if (progress <= appearAt) return fromPx;
  return fromPx * (1 - easeOutCubic(Math.min(1, (progress - appearAt) / edge)));
}
