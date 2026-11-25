/**
 * useFlipAnimation — FLIP (First, Last, Invert, Play) column-move animation.
 *
 * When a task's status changes, React unmounts the card from the old column
 * and remounts it in the new one — an instant visual jump. This hook captures
 * every card's bounding box on the previous render (First), compares it with
 * the current render (Last), and for any card that moved between columns
 * applies an inverse transform (Invert) that is then transitioned (Play).
 *
 * Motion sequence (two-phase):
 *   1. LIFT + GLIDE — the card starts at its old position, scaled up to
 *      1.02 with an increased shadow, and glides to its new position over
 *      420ms with a decelerating ease.
 *   2. SETTLE — the card eases back to scale(1) and its shadow normalizes
 *      over 200ms, so it lands softly instead of snapping.
 *
 * The destination column is highlighted with a soft pulse: a border glow and
 * background tint that fade out over 700ms. The accent color is status-aware:
 *   - done        → green  (success)
 *   - review      → amber  (failure / needs attention)
 *   - in_progress → blue   (active execution)
 *   - todo / other→ indigo (neutral)
 *
 * The hook is called once in KanbanBoard so it observes every render of the
 * board. It is a no-op when no card has changed columns (e.g. a filter change
 * or a new task appearing in an empty column).
 *
 * Technique: FLIP transitions (no Framer Motion dependency).
 */

import { useLayoutEffect, useRef } from "react";

/** How long the glide phase lasts, in ms. */
const GLIDE_DURATION = 420;
/** How long the settle phase lasts, in ms. */
const SETTLE_DURATION = 200;
/** How long the destination column highlight lingers, in ms. */
const HIGHLIGHT_DURATION = 700;

/** Decelerating ease for the glide — fast start, gentle arrival. */
const GLIDE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Gentle ease for the settle — soft landing. */
const SETTLE_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Status-specific accent colors for the lift glow and column highlight.
 * The card's lift and the destination column's pulse share the same accent
 * so the motion reads as one continuous event.
 */
const ACCENTS: Record<string, string> = {
  done: "34, 197, 94", // green-500 — success
  review: "245, 158, 11", // amber-500 — failure / needs attention
  in_progress: "59, 130, 246", // blue-500 — active execution
  todo: "99, 102, 241", // indigo-500 — neutral
};

/** Resolve the accent (RGB triplet) for a destination status. */
function accentFor(status: string | null): string {
  return ACCENTS[status ?? ""] ?? ACCENTS.todo;
}

interface CardRect {
  left: number;
  top: number;
  /** The column (`data-drop-status`) the card currently sits in. */
  status: string | null;
}

/**
 * Capture the bounding box of every `[data-task-id]` card relative to the
 * board container, together with the column it sits in. Returns a map of
 * task id → { rect, status }.
 */
function captureCardRects(container: HTMLElement): Map<string, CardRect> {
  const rects = new Map<string, CardRect>();
  const containerRect = container.getBoundingClientRect();
  for (const el of container.querySelectorAll<HTMLElement>("[data-task-id]")) {
    const r = el.getBoundingClientRect();
    const status = (el.closest("[data-drop-status]") as HTMLElement | null)?.dataset.dropStatus ?? null;
    rects.set(el.dataset.taskId!, {
      left: r.left - containerRect.left,
      top: r.top - containerRect.top,
      status,
    });
  }
  return rects;
}

/**
 * FLIP column-move animation. Call once in the board component.
 *
 * @param boardRef — ref to the element that wraps all four columns.
 */
export function useFlipAnimation(boardRef: React.RefObject<HTMLElement | null>): void {
  // The card rects captured on the previous render (First).
  const prevRects = useRef<Map<string, CardRect>>(new Map());

  useLayoutEffect(() => {
    const container = boardRef.current;
    if (!container) {
      // The board content unmounted (a view switch away). Clear the captured
      // rects so a re-entry starts fresh. This hook lives in the always-mounted
      // KanbanBoard, so the ref survives the inner board's unmount; without
      // this, the stale rects from the previous mount persist and, on re-entry,
      // every card whose position differs from the stale rect is treated as
      // "moved" — triggering a spurious FLIP that reads as a flicker/jump.
      // Clearing here makes a re-entry a clean fade-in only.
      prevRects.current = new Map();
      return;
    }

    const nextRects = captureCardRects(container);

    // Find cards that moved BETWEEN columns. The decisive signal is the
    // column (`data-drop-status`) the card sits in, not its pixel position.
    // A card that shifts a few pixels within the same column — because a
    // sibling grew (a progress indicator appeared, a badge changed height) —
    // is NOT a column move and must not trigger the FLIP glide. Treating any
    // ≥1px shift as a move is what caused the spurious "reflash" the user
    // reported: every poll that changed a card's height made the cards below
    // it glide and flash.
    const moved: { el: HTMLElement; dx: number; dy: number; toStatus: string | null }[] = [];
    for (const [taskId, next] of nextRects) {
      const prev = prevRects.current.get(taskId);
      if (!prev) continue; // new card — no FLIP, the kb-fade-in entrance handles it
      // Same column → intra-column reflow, not a move. Skip.
      if (prev.status === next.status) continue;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue; // didn't move
      const el = container.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`);
      if (!el) continue;
      // Skip cards that are currently being dragged — dnd-kit owns their transform.
      if (el.classList.contains("kb-dragging")) continue;
      moved.push({ el, dx, dy, toStatus: next.status });
    }

    // Update the captured rects for the next render.
    prevRects.current = nextRects;

    if (moved.length === 0) return;

    // Invert: apply the inverse transform so the card appears at its old
    // position, then Play: glide to the new position (scaled up), then
    // settle back to scale(1).
    for (const { el, dx, dy, toStatus } of moved) {
      const accent = accentFor(toStatus);

      // Strip the entrance animation — the FLIP glide replaces it. Without
      // this, the kb-fade-in CSS animation would override the inline transform
      // for its 200ms duration, causing a visual glitch.
      el.classList.remove("kb-fade-in");

      // Lift: raise the card above its siblings. The accent color drives the
      // glow via the --kb-flip-accent custom property (see globals.css).
      el.style.setProperty("--kb-flip-accent", accent);
      el.classList.add("kb-flip-lift");
      el.style.zIndex = "60";

      // Invert: old position, scaled up (the "lifted" state).
      el.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;
      el.style.transition = "none";

      // Force a reflow so the browser registers the inverted position.
      void el.offsetHeight;

      // Play phase 1 — GLIDE: move to the new position, staying scaled up.
      el.style.transition = `transform ${GLIDE_DURATION}ms ${GLIDE_EASING}`;
      el.style.transform = "scale(1.02)";

      // Play phase 2 — SETTLE: ease back to scale(1) with a soft overshoot.
      const settle = () => {
        el.style.transition = `transform ${SETTLE_DURATION}ms ${SETTLE_EASING}`;
        el.style.transform = "";
        el.removeEventListener("transitionend", settle);
      };
      el.addEventListener("transitionend", settle);
      // Fallback in case the glide's transitionend never fires.
      setTimeout(settle, GLIDE_DURATION + 50);

      // Highlight the destination column with the same accent.
      if (toStatus) {
        const col = container.querySelector<HTMLElement>(`[data-drop-status="${toStatus}"]`);
        if (col) {
          col.style.setProperty("--kb-col-accent", accent);
          col.classList.add("kb-column-highlight");
          setTimeout(() => {
            col.classList.remove("kb-column-highlight");
            col.style.removeProperty("--kb-col-accent");
          }, HIGHLIGHT_DURATION);
        }
      }

      // Clean up the inline styles and lift class after the full sequence.
      const cleanup = () => {
        el.classList.remove("kb-flip-lift");
        el.style.zIndex = "";
        el.style.transform = "";
        el.style.transition = "";
        el.style.removeProperty("--kb-flip-accent");
        el.removeEventListener("transitionend", cleanup);
      };
      el.addEventListener("transitionend", cleanup);
      // Fallback in case transitionend never fires (e.g. reduced motion).
      setTimeout(cleanup, GLIDE_DURATION + SETTLE_DURATION + 100);
    }
  });
}
