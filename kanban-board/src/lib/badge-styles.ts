/**
 * badge-styles.ts — the data half of the badge system.
 *
 * Pure, JSX-free: the status/priority style maps and their resolvers. Kept in a
 * `.ts` module (not `.tsx`) so headless tests can import the real source of
 * truth without a JSX transform. The <Badge> presentation component lives in
 * badges.tsx and re-exports everything from here.
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
