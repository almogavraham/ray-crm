/**
 * useScrollParallax — lightweight, professional scroll-driven parallax.
 *
 * Same technique used by high-end product sites (e.g. Raven Health): each
 * section is a local parallax "zone" (`data-parallax="on"`), and decorative
 * layers inside it (`data-depth="-40"`) drift at their own speed based on
 * that section's own scroll progress through the viewport — NOT a single
 * page-wide scrollY value. This is what makes it read as depth *between*
 * sections rather than one flat background sliding under everything.
 *
 * Design notes (why it's fast, and why it's reliable):
 *   - Only `transform` is ever touched → GPU-composited, never triggers
 *     layout/paint.
 *   - Recomputes are triggered by the native `scroll`/`resize` events
 *     (rAF-batched to one recompute per frame) rather than a free-running
 *     rAF loop — browsers throttle or fully suspend requestAnimationFrame on
 *     backgrounded/hidden tabs, which would silently stall a loop that only
 *     re-schedules itself.
 *   - An IntersectionObserver keeps a live "active" set of sections near the
 *     viewport, so each recompute only touches those — cheap even on a page
 *     with many sections.
 *   - `prefers-reduced-motion: reduce` disables the whole thing.
 *
 * Usage: call once near the root of the page (e.g. in <LandingPage/>).
 * Then mark sections `data-parallax="on"` and decorative children
 * `data-depth="<px multiplier, can be negative>"`.
 */

import { useEffect } from 'react';

interface Layer {
  el: HTMLElement;
  depth: number;    // translateY px multiplier
  rotate: number;   // deg multiplier (data-rotate)
  scale: number;    // scale delta multiplier (data-scale) — final = 1 + progress*scale
  section: Element;
}

export function useScrollParallax() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let layers: Layer[] = [];
    const bySection = new Map<Element, Layer[]>();

    const collect = () => {
      layers = Array.from(document.querySelectorAll<HTMLElement>('[data-depth]')).map(el => ({
        el,
        depth: parseFloat(el.dataset.depth || '0') || 0,
        rotate: parseFloat(el.dataset.rotate || '0') || 0,
        scale: parseFloat(el.dataset.scale || '0') || 0,
        section: el.closest('[data-parallax]') ?? document.body,
      }));
      bySection.clear();
      for (const l of layers) {
        const arr = bySection.get(l.section);
        if (arr) arr.push(l); else bySection.set(l.section, [l]);
      }
    };
    collect();
    // Re-collect after fonts/images settle and on resize (layout shifts change positions).
    const recollect = () => collect();
    window.addEventListener('load', recollect);
    window.addEventListener('resize', recollect);
    const settleTimer = setTimeout(recollect, 600);

    const activeSections = new Set<Element>();
    let rafId: number | null = null;

    const recompute = () => {
      rafId = null;
      const vh = window.innerHeight;
      activeSections.forEach(section => {
        const rect = section.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        // -1 → section center below viewport, 0 → centered, +1 → scrolled past above.
        const progress = Math.max(-1.4, Math.min(1.4, (vh / 2 - center) / (vh / 2 + rect.height / 2)));
        const layersHere = bySection.get(section);
        if (!layersHere) return;
        for (const l of layersHere) {
          const parts = [`translate3d(0, ${(progress * l.depth).toFixed(2)}px, 0)`];
          if (l.rotate) parts.push(`rotate(${(progress * l.rotate).toFixed(2)}deg)`);
          if (l.scale) parts.push(`scale(${(1 + progress * l.scale).toFixed(3)})`);
          l.el.style.transform = parts.join(' ');
        }
      });
    };
    const schedule = () => { if (rafId === null) rafId = requestAnimationFrame(recompute); };

    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) activeSections.add(entry.target);
        else activeSections.delete(entry.target);
      }
      schedule();
    }, { rootMargin: '25% 0px 25% 0px', threshold: 0 });

    document.querySelectorAll('[data-parallax]').forEach(s => io.observe(s));

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      io.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearTimeout(settleTimer);
      window.removeEventListener('load', recollect);
      window.removeEventListener('resize', recollect);
    };
  }, []);
}
