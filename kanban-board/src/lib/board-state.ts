/**
 * board-state.ts — ephemeral UI state store (spec §3, §4.2).
 *
 * A minimal, dependency-free observable store. It holds ONLY ephemeral UI
 * state (filter, selected column, last-loaded timestamp). Task data is never
 * cached here — it is always re-fetched from the host backend so the board
 * reflects the live store (and picks up edits from the native board).
 */

import type { BoardState, BoardUiState, BoardStats, Column, Swimlane, Task, TaskStatus } from "../types/task";
import { addDays, parseISODate, startOfToday } from "./date";

type Listener = () => void;

/** Ordered list of columns, derived from the status enum. */
export const COLUMN_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done"];

/** Human-readable column titles. */
export const COLUMN_TITLES: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

/**
 * Group a flat task list into columns by status.
 * Tasks with an unknown status are dropped (defensive — the backend should
 * only emit known statuses).
 */
export function groupTasksByStatus(tasks: Task[]): Column[] {
  const byStatus = new Map<TaskStatus, Task[]>();
  for (const status of COLUMN_ORDER) byStatus.set(status, []);
  for (const task of tasks) {
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
  }
  return COLUMN_ORDER.map((status) => ({
    status,
    title: COLUMN_TITLES[status],
    tasks: byStatus.get(status) ?? [],
  }));
}

/**
 * Phase 2: group a flat task list into project swimlanes. Each lane carries
 * the project id, a display name, and the four status columns holding that
 * project's tasks. Projects are ordered by first appearance; a missing/empty
 * project id is bucketed under "Unassigned".
 */
export function groupTasksByProject(tasks: Task[]): Swimlane[] {
  const byProject = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = task.projectId || "unassigned";
    const bucket = byProject.get(key);
    if (bucket) bucket.push(task);
    else byProject.set(key, [task]);
  }
  const lanes: Swimlane[] = [];
  for (const [projectId, projectTasks] of byProject) {
    lanes.push({
      projectId,
      title: projectId === "unassigned" ? "Unassigned" : projectId,
      tasks: projectTasks,
      columns: groupTasksByStatus(projectTasks),
    });
  }
  return lanes;
}

/**
 * Phase 2: compute board statistics from a flat task list. Derived only —
 * never persisted. `overdue`/`dueSoon` ignore done tasks.
 */
export function computeStats(tasks: Task[]): BoardStats {
  const byStatus: Record<TaskStatus, number> = { todo: 0, in_progress: 0, review: 0, done: 0 };
  const byTag: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  let blocked = 0;
  let overdue = 0;
  let dueSoon = 0;
  const today = startOfToday();
  const soon = addDays(today, 3);
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    if (t.waitingOn && t.waitingOn.length > 0) blocked += 1;
    if (t.dueDate && t.status !== "done") {
      const due = parseISODate(t.dueDate);
      if (due) {
        if (due < today) overdue += 1;
        else if (due <= soon) dueSoon += 1;
      }
    }
    for (const tag of t.tags ?? []) byTag[tag] = (byTag[tag] ?? 0) + 1;
    const project = t.projectId || "unassigned";
    byProject[project] = (byProject[project] ?? 0) + 1;
  }
  return { total: tasks.length, byStatus, blocked, overdue, dueSoon, byTag, byProject };
}

/**
 * Phase 2: WIP (work-in-progress) limit check. Returns true when the number
 * of tasks in `status` meets or exceeds the configured limit. No limit (or a
 * non-positive limit) means unlimited.
 */
export function wipExceeded(
  tasks: Task[],
  status: TaskStatus,
  limits: Partial<Record<TaskStatus, number>>,
): boolean {
  const limit = limits[status];
  if (!limit || limit <= 0) return false;
  const count = tasks.filter((t) => t.status === status).length;
  return count >= limit;
}

/**
 * The board state store.
 *
 * - `columns` is the persisted data (tasks grouped by status).
 * - `uiState` is ephemeral browser-only state.
 * - `subscribe`/`notify` drive re-rendering.
 */
export class BoardStateStore {
  private state: BoardState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = {
      columns: groupTasksByStatus([]),
      uiState: {
        filter: "all",
        lastLoadedAt: 0,
        syncing: false,
        deletingTaskIds: new Set(),
        deletePhases: new Map(),
        deleteErrors: new Map(),
      },
    };
  }

  get(): BoardState {
    return this.state;
  }

  /** Replace the persisted columns (after a fetch/reconcile). */
  setColumns(columns: Column[]): void {
    this.state = { ...this.state, columns };
    this.notify();
  }

  /** Update a single ephemeral UI field. */
  setUiState(patch: Partial<BoardUiState>): void {
    this.state = {
      ...this.state,
      uiState: { ...this.state.uiState, ...patch },
    };
    this.notify();
  }

  /** Mark the board as freshly loaded. */
  markLoaded(): void {
    this.state = {
      ...this.state,
      uiState: { ...this.state.uiState, lastLoadedAt: Date.now() },
    };
    this.notify();
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
