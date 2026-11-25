/**
 * useReveal — scroll-driven reveal.
 *
 * Returns a ref to attach to an element. When the element scrolls into the
 * viewport, the hook adds the `kb-reveal--in` class, which transitions the
 * element from its hidden state (faded, nudged down, softly blurred) into
 * place. A per-element `--kb-reveal-delay` (set via the `delay` option)
 * staggers siblings into a gentle cascade.
 *
 * The reveal is one-shot: once an element has revealed, it is unobserved and
 * never re-hides. The hidden state uses opacity/transform/filter only (never
 * display or visibility), so the content stays in the DOM and the
 * accessibility tree, and text-based assertions still match.
 *
 * Degrades gracefully: if `IntersectionObserver` is unavailable (very old
 * engines, or some test environments), the element is revealed immediately.
 * `prefers-reduced-motion` is honored in CSS (the reveal becomes instant).
 */

import { useEffect, useRef } from "react";

interface RevealOptions {
  /** Stagger delay in ms, applied as `--kb-reveal-delay`. */
  delay?: number;
  /** Reveal threshold — fraction of the element that must be visible. */
  threshold?: number;
}

export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options: RevealOptions = {},
) {
  const { delay = 0, threshold = 0.15 } = options;
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Apply the stagger delay as a CSS custom property.
    if (delay > 0) {
      el.style.setProperty("--kb-reveal-delay", `${delay}ms`);
    }

    // No IntersectionObserver — reveal immediately so content is never lost.
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("kb-reveal--in");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("kb-reveal--in");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [delay, threshold]);

  return ref;
}
