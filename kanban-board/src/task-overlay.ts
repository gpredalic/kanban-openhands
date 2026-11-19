/**
 * task-overlay.ts — localStorage-backed overlay for Phase 2 task fields.
 *
 * The host backend's Task model may not yet persist `tags` or `dueDate`
 * (both are optional Phase 2 fields). Rather than block on a backend change,
 * this module keeps a per-task overlay in localStorage that is merged onto
 * fetched tasks. The overlay is the single source of truth for these two
 * fields until the backend adopts them natively.
 *
 * Backward compatibility: the overlay is keyed by task id and only ever adds
 * `tags` / `dueDate`. A task with no overlay entry is returned untouched, so
 * legacy data and API responses remain valid.
 */

import type { Task } from "./types";

/** The overlay storage key. Namespaced to avoid collisions with other extensions. */
const OVERLAY_KEY = "kanban-board.task-overlay.v1";

/** The slice of a task the overlay can override. */
export interface TaskOverlayEntry {
  tags?: string[];
  dueDate?: string | null;
}

/** The full overlay: task id → overlay entry. */
export type TaskOverlay = Record<string, TaskOverlayEntry>;

/**
 * Read the overlay from localStorage. Returns an empty object on any parse
 * error or missing key (defensive — a corrupt overlay must never break the
 * board).
 */
export function loadOverlay(): TaskOverlay {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as TaskOverlay;
  } catch {
    return {};
  }
}

/** Persist the overlay to localStorage. */
export function saveOverlay(overlay: TaskOverlay): void {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
    // Quota exceeded or storage disabled — the board still works, the overlay
    // just won't survive a reload.
  }
}

/**
 * Merge the overlay onto a flat task list. Tasks with no overlay entry are
 * returned by reference (unchanged); tasks with an entry get a shallow copy
 * carrying the overlay's tags/dueDate.
 */
export function applyOverlay(tasks: Task[], overlay: TaskOverlay): Task[] {
  return tasks.map((task) => {
    const entry = overlay[task.id];
    if (!entry) return task;
    const merged: Task = { ...task };
    if (entry.tags !== undefined) merged.tags = entry.tags;
    if (entry.dueDate !== undefined) merged.dueDate = entry.dueDate;
    return merged;
  });
}

/**
 * Update (or create) a single task's overlay entry and persist it.
 * `patch` may set tags, dueDate, or both. A `dueDate` of `null` clears it.
 */
export function setTaskOverlay(taskId: string, patch: TaskOverlayEntry): TaskOverlay {
  const overlay = loadOverlay();
  const existing = overlay[taskId] ?? {};
  const next: TaskOverlayEntry = { ...existing };
  if (patch.tags !== undefined) next.tags = patch.tags;
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate;
  overlay[taskId] = next;
  saveOverlay(overlay);
  return overlay;
}

/** Remove a task's overlay entry (e.g. after the task is deleted). */
export function clearTaskOverlay(taskId: string): TaskOverlay {
  const overlay = loadOverlay();
  if (taskId in overlay) {
    delete overlay[taskId];
    saveOverlay(overlay);
  }
  return overlay;
}

/** Drop the entire overlay. */
export function clearOverlay(): void {
  try {
    localStorage.removeItem(OVERLAY_KEY);
  } catch {
    // ignore
  }
}
