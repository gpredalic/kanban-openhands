/**
 * use-board-data.ts — fetch / group / reconcile logic (spec §4.3).
 *
 * Data flow:
 *   Mount → GET /api/agent/tasks → group by status → render columns
 *   Drag/move → POST /api/agent/tasks/{id} → optimistic UI → await → re-fetch
 *   Poll → periodic GET to reconcile with the live backend
 *
 * All backend access goes through `host.agentServer.request` — the extension
 * never constructs backend URLs or holds credentials (spec §5.1).
 */

import { BoardStateStore, groupTasksByStatus } from "./board-state";
import { applyOverlay, loadOverlay, setTaskOverlay, clearTaskOverlay, type TaskOverlayEntry } from "./task-overlay";
import { buildExport, downloadExport, importFromFile, type ImportResult } from "./import-export";
import type { Host, Task, TaskStatus, BoardUiState } from "../types/task";
import { syncBoardAction } from "./openhands";
import { fetchTasks, moveTask, updateTask, deleteTask, createTask } from "./task-store";

/** Poll interval for reconciling with the live backend (ms). */
const POLL_INTERVAL_MS = 15_000;

/**
 * The board data controller. Owns the fetch/reconcile lifecycle and the
 * polling timer. Returns a dispose function that clears the timer.
 */
export interface BoardDataController {
  /** Load the board from the backend and update the store. */
  load: () => Promise<void>;
  /** Move a task (optimistic + reconcile). Returns false if blocked by a WIP limit. */
  move: (taskId: string, status: TaskStatus) => Promise<boolean>;
  /** Update a task field. */
  update: (taskId: string, patch: { title?: string; assignee?: string | null }) => Promise<void>;
  /** Delete a task. */
  remove: (taskId: string) => Promise<void>;
  /** Create a task in a column. Returns false if blocked by a WIP limit. */
  create: (title: string, status: TaskStatus, assignee?: string | null, projectId?: string) => Promise<boolean>;
  /** Update ephemeral UI state (filter, search). */
  setUiState: (patch: Partial<BoardUiState>) => void;
  /** Phase 2: set a task's tags (overlay-backed). */
  setTags: (taskId: string, tags: string[]) => void;
  /** Phase 2: set a task's due date (overlay-backed). null clears it. */
  setDueDate: (taskId: string, dueDate: string | null) => void;
  /** Phase 2: export the board (overlay applied) as a JSON download. */
  exportBoard: () => void;
  /** Phase 2: import tasks from a JSON file. */
  importBoard: (file: File) => Promise<ImportResult>;
  /** Stop polling and release resources. */
  dispose: () => void;
}

export function createBoardDataController(host: Host, store: BoardStateStore): BoardDataController {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  async function load(): Promise<void> {
    if (disposed) return;
    try {
      const tasks = await fetchTasks(host);
      // Phase 2: merge the localStorage overlay (tags/dueDate) onto fetched tasks.
      const overlaid = applyOverlay(tasks, loadOverlay());
      store.setColumns(groupTasksByStatus(overlaid));
      store.markLoaded();
    } catch (err) {
      // Leave the board in its last-known state; the next poll will retry.
      console.error("[kanban-board] failed to load tasks:", err);
    }
  }

  /** Re-apply the overlay to the current columns without a network fetch. */
  function applyOverlayToStore(): void {
    const tasks = store.get().columns.flatMap((c) => c.tasks);
    store.setColumns(groupTasksByStatus(applyOverlay(tasks, loadOverlay())));
  }

  async function move(taskId: string, status: TaskStatus): Promise<boolean> {
    if (disposed) return false;
    // Optimistic update: move the task in the local store immediately.
    const columns = store.get().columns.map((col) => ({
      ...col,
      tasks: col.tasks.filter((t) => t.id !== taskId),
    }));
    const target = columns.find((c) => c.status === status);
    const task = store.get().columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
    if (target && task) {
      target.tasks = [...target.tasks, { ...task, status }];
    }
    store.setColumns(columns);
    try {
      await moveTask(host, taskId, status);
      void syncBoardAction(host, "moved", taskId, { status }).catch((error: unknown) => {
        console.error("[kanban-board] OpenHands move sync failed:", error);
      });
    } catch (err) {
      console.error("[kanban-board] move failed, reconciling:", err);
      await load();
    }
    return true;
  }

  async function update(
    taskId: string,
    patch: { title?: string; assignee?: string | null },
  ): Promise<void> {
    if (disposed) return;
    try {
      await updateTask(host, taskId, patch);
      void syncBoardAction(host, "updated", taskId, patch).catch((error: unknown) => {
        console.error("[kanban-board] OpenHands update sync failed:", error);
      });
      await load();
    } catch (err) {
      console.error("[kanban-board] update failed:", err);
    }
  }

  async function remove(taskId: string): Promise<void> {
    if (disposed) return;
    try {
      await deleteTask(host, taskId);
      void syncBoardAction(host, "deleted", taskId).catch((error: unknown) => {
        console.error("[kanban-board] OpenHands delete sync failed:", error);
      });
      clearTaskOverlay(taskId);
      await load();
    } catch (err) {
      console.error("[kanban-board] delete failed:", err);
    }
  }

  async function create(
    title: string,
    status: TaskStatus,
    assignee?: string | null,
    projectId?: string,
  ): Promise<boolean> {
    if (disposed) return false;
    try {
      const created = await createTask(host, title, status, assignee, projectId);
      if (created) {
        void syncBoardAction(host, "created", created.id, { title, status, assignee, projectId }).catch((error: unknown) => {
          console.error("[kanban-board] OpenHands create sync failed:", error);
        });
      }
      await load();
    } catch (err) {
      console.error("[kanban-board] create failed:", err);
    }
    return true;
  }

  function setUiState(patch: Partial<BoardUiState>): void {
    if (disposed) return;
    store.setUiState(patch);
  }

  function setTags(taskId: string, tags: string[]): void {
    if (disposed) return;
    setTaskOverlay(taskId, { tags });
    applyOverlayToStore();
  }

  function setDueDate(taskId: string, dueDate: string | null): void {
    if (disposed) return;
    setTaskOverlay(taskId, { dueDate });
    applyOverlayToStore();
  }

  function exportBoard(): void {
    const tasks = store.get().columns.flatMap((c) => c.tasks);
    downloadExport(buildExport(tasks));
  }

  async function importBoard(file: File): Promise<ImportResult> {
    if (disposed) return { ok: false, tasks: [], error: "Controller disposed." };
    const result = await importFromFile(file);
    if (!result.ok) return result;
    const existingIds = new Set(store.get().columns.flatMap((c) => c.tasks).map((t) => t.id));
    for (const t of result.tasks) {
      const patch: TaskOverlayEntry = {};
      if (t.tags) patch.tags = t.tags;
      if (t.dueDate !== undefined) patch.dueDate = t.dueDate;
      if (patch.tags !== undefined || patch.dueDate !== undefined) setTaskOverlay(t.id, patch);
      if (!existingIds.has(t.id)) {
        const created = await createTask(host, t.title, t.status, t.assignee, t.projectId);
        if (created) {
          void syncBoardAction(host, "created", created.id, {
            title: t.title,
            status: t.status,
            assignee: t.assignee,
            projectId: t.projectId,
          }).catch((error: unknown) => {
            console.error("[kanban-board] OpenHands import create sync failed:", error);
          });
        }
      }
    }
    await load();
    return result;
  }

  function startPolling(): void {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
  }

  // Initial load + start polling.
  void load();
  startPolling();

  return {
    load,
    move,
    update,
    remove,
    create,
    setUiState,
    setTags,
    setDueDate,
    exportBoard,
    importBoard,
    dispose() {
      disposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
  };
}
