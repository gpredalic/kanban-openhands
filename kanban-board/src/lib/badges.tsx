/**
 * badges.tsx — the single source of truth for status and priority badges.
 *
 * Every surface that displays a status or priority value (task cards, the
 * detail modal, the create modal, execution history, the workflow view) reads
 * from these maps and renders through the shared <Badge> pill, so the visual
 * pattern is identical everywhere and in both light and dark modes:
 *
 *   ● Title Case label
 *
 *   - a colored dot, vertically centered with the label via flex
 *   - consistent gap-1.5 spacing between dot and text
 *   - the same pill shape, ring, and font for status and priority
 *
 * Colors are preserved from the pre-existing card badges; `pending` and
 * `critical` are new values that map to the neutral-violet and deep-red
 * accents respectively.
 */

import type { TaskPriority } from "../types/task";

/** Execution status values that can appear on a task or a run. */
export type ExecutionStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** The styling for a single badge value. */
export interface BadgeStyle {
  /** Title Case label shown to the user. */
  label: string;
  /** Pill background + text + ring classes. */
  cls: string;
  /** Dot background class. */
  dot: string;
}

/** Status badge styling. Colors match the pre-existing card badges. */
export const STATUS_STYLES: Record<ExecutionStatus, BadgeStyle> = {
  pending: { label: "Pending", cls: "bg-violet-500/10 text-violet-400 ring-violet-500/20", dot: "bg-violet-400" },
  queued: { label: "Queued", cls: "bg-blue-500/10 text-blue-400 ring-blue-500/20", dot: "bg-blue-400" },
  running: { label: "Running", cls: "bg-blue-500/10 text-blue-400 ring-blue-500/20", dot: "bg-blue-400" },
  completed: { label: "Completed", cls: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20", dot: "bg-emerald-400" },
  failed: { label: "Failed", cls: "bg-rose-500/10 text-rose-400 ring-rose-500/20", dot: "bg-rose-400" },
  cancelled: { label: "Cancelled", cls: "bg-rose-500/10 text-rose-400 ring-rose-500/20", dot: "bg-rose-400" },
};

/** Priority badge styling. Colors match the pre-existing card badges. */
export const PRIORITY_STYLES: Record<TaskPriority, BadgeStyle> = {
  low: { label: "Low", cls: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20", dot: "bg-emerald-400" },
  medium: { label: "Medium", cls: "bg-amber-500/10 text-amber-400 ring-amber-500/20", dot: "bg-amber-400" },
  high: { label: "High", cls: "bg-rose-500/10 text-rose-400 ring-rose-500/20", dot: "bg-rose-400" },
  critical: { label: "Critical", cls: "bg-red-600/15 text-red-400 ring-red-500/30", dot: "bg-red-500" },
};

/**
 * Resolve a status value to its badge style. Unknown or absent values return
 * null (no badge) for an empty value, or the neutral `pending` style for a
 * value that is present but not in the known set.
 */
export function statusBadge(value: string | null | undefined): BadgeStyle | null {
  if (!value) return null;
  return STATUS_STYLES[value as ExecutionStatus] ?? STATUS_STYLES.pending;
}

/** Resolve a priority value to its badge style, defaulting to `medium`. */
export function priorityBadge(value: TaskPriority | null | undefined): BadgeStyle {
  return PRIORITY_STYLES[value ?? "medium"] ?? PRIORITY_STYLES.medium;
}

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
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${style.cls} ${className}`.trim()}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot} ${pulse ? "animate-pulse" : ""}`} />
      {style.label}
    </span>
  );
}
