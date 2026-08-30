/**
 * useScrollReveal — bidirectional "arrives on scroll" reveal.
 *
 * Unlike a one-shot reveal-once-and-stay hook, this toggles `inView` every
 * time the element crosses the trigger threshold in EITHER direction: it
 * re-plays its entrance both scrolling down into it and scrolling back up
 * into it. Pure IntersectionObserver + a CSS `transition` on opacity/transform
 * does the actual animating — no per-frame JS work, no rAF loop to manage.
 */

import { useEffect, useRef, useState } from 'react';

export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.18) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setInView(true); return; }

    // Safety net: if this element is ALREADY on screen the moment it mounts
    // (e.g. above-the-fold content, or content revealed by a tab/route switch),
    // show it immediately rather than waiting on the observer's first async
    // callback — belt-and-suspenders against ever rendering a section that
    // looks permanently blank.
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) setInView(true);

    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold, rootMargin: '0px 0px -6% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);

  return [ref, inView] as const;
}
