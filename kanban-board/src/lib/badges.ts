/**
 * badges.ts — the single source of truth for status and priority badges.
 *
 * Every surface that displays a status or priority value (the detail modal,
 * the create modal, execution history, the monitoring view) reads from the
 * style maps and renders through the shared <Badge> pill, so the visual
 * pattern is identical everywhere and in both light and dark modes:
 *
 *   ● Title Case label
 *
 *   - a colored dot, vertically centered with the label via flex
 *   - consistent gap-1.5 spacing between dot and text
 *   - the same pill shape, ring, and font for status and priority
 *
 * The style maps and resolvers live in badge-styles.ts (pure data). This module
 * re-exports them and adds the <Badge> presentation component. The component is
 * written with React.createElement (no JSX) so the file stays a plain .ts that
 * both Vite and the headless Node test loader can import.
 */

import * as React from "react";
import type { BadgeStyle } from "./badge-styles";

export {
  STATUS_STYLES,
  PRIORITY_STYLES,
  statusBadge,
  priorityBadge,
  type ExecutionStatus,
  type BadgeStyle,
} from "./badge-styles";

/**
 * The shared badge pill: a flex row that vertically centers a colored dot
 * against a Title Case label. Status and priority badges both render through
 * this so they share one visual pattern.
 */
export function Badge({
  style,
  pulse = false,
  className = "",
}: {
  style: BadgeStyle;
  /** Animate the dot (used while a task is running/queued). */
  pulse?: boolean;
  /** Extra classes, e.g. to override padding in tight contexts. */
  className?: string;
}) {
  return React.createElement(
    "span",
    {
      className: `flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${style.cls} ${className}`.trim(),
    },
    React.createElement("span", {
      className: `h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${pulse ? "animate-pulse" : ""}`,
    }),
    style.label
  );
}
