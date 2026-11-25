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
import type { Host, Task, TaskStatus, BoardUiState, TaskPriority, DeletePhase } from "../types/task";
import { syncBoardAction, syncInboundConversations, deleteConversation, verifyConversationGone, createConversationForTask } from "./openhands";
import { moveTask, updateTask, deleteTask, createTask, fetchTasks, dedupeTasks } from "./task-store";

/** Poll interval for reconciling with the live backend (ms). */
const POLL_INTERVAL_MS = 15_000;

/**
 * Fingerprint a flat task list by its *content*, ignoring object identity.
 * The 15-second poll re-fetches the board on every tick; when the backend
 * returns the same tasks we want to skip the column recompute and the React
 * re-render entirely. Comparing the serialized content (not the object
 * reference) is what lets an unchanged poll be a no-op.
 */
function tasksFingerprint(tasks: Task[]): string {
  return tasks
    .map((t) =>
      [
        t.id,
        t.title,
        t.status,
        t.assignee ?? "",
        t.projectId ?? "",
        t.agentId ?? "",
        t.conversationId ?? "",
        t.priority ?? "",
        (t.tags ?? []).join(","),
        t.dueDate ?? "",
        t.scheduledAt ?? "",
        (t.waitingOn ?? []).join(","),
      ].join("|"),
    )
    .join(";;");
}

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
  update: (taskId: string, patch: { title?: string; assignee?: string | null; agentId?: string | null; conversationId?: string | null; agentPrompt?: string; expectedOutput?: string; successCriteria?: string; priority?: TaskPriority }) => Promise<void>;
  /** Delete a task. */
  remove: (taskId: string) => Promise<void>;
  /** Cancel a failed delete: clear the error state and return the card to normal. */
  cancelDelete: (taskId: string) => void;
  /** Create a task in a column. Returns false if blocked by a WIP limit. */
  create: (title: string, status: TaskStatus, assignee?: string | null, projectId?: string, agentId?: string | null, agentPrompt?: string, expectedOutput?: string, successCriteria?: string, priority?: TaskPriority) => Promise<boolean>;
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

  /**
   * Resurrection guard. Maps a task id to the timestamp at which its delete
   * was confirmed. While an entry is fresh (within RECENTLY_DELETED_TTL_MS)
   * the task is passed to syncInboundConversations as an ignore id, so a
   * stale conversation still lingering in the search index cannot rebuild the
   * card after it has been removed from disk. This covers the window between
   * the delete transaction finishing (deletingTaskIds cleared) and the
   * search index catching up.
   */
  const RECENTLY_DELETED_TTL_MS = 30_000;
  const recentlyDeleted = new Map<string, number>();

  /** The set of task ids that must never be resurrected by inbound sync. */
  function ignoreSet(): Set<string> {
    const now = Date.now();
    for (const [id, at] of recentlyDeleted) {
      if (now - at > RECENTLY_DELETED_TTL_MS) recentlyDeleted.delete(id);
    }
    const ignore = new Set<string>(store.get().uiState.deletingTaskIds);
    for (const id of recentlyDeleted.keys()) ignore.add(id);
    return ignore;
  }

  /**
   * Fingerprint of the last task list we actually pushed into the store. The
   * 15-second poll re-fetches the board on every tick; when the content is
   * unchanged we skip setColumns/markLoaded so the columns array keeps its
   * reference and React.memo'd cards do not re-render. See tasksFingerprint.
   */
  let lastTasksFingerprint: string | null = null;

  async function load(): Promise<void> {
    if (disposed) return;
    store.setUiState({ syncing: true });
    try {
      const tasks = await syncInboundConversations(host, ignoreSet());
      // Defense in depth: collapse any duplicate task ids before grouping so a
      // card can never render in two columns, even if a duplicate slipped past
      // the reconcile (e.g. a stale board file read on the error path).
      const unique = dedupeTasks(tasks);
      // Phase 2: merge the localStorage overlay (tags/dueDate) onto fetched tasks.
      const overlaid = applyOverlay(unique, loadOverlay());
      const fingerprint = tasksFingerprint(overlaid);
      // Content-aware reconcile: if the backend returned the same tasks we
      // already have, skip the column recompute and the notify. The columns
      // array keeps its reference, so memoized cards and columns do not
      // re-render and no FLIP/entrance animation restarts. This is what stops
      // the board from repainting on every 15-second poll when nothing changed.
      if (fingerprint !== lastTasksFingerprint) {
        lastTasksFingerprint = fingerprint;
        store.setColumns(groupTasksByStatus(overlaid));
        store.markLoaded();
      }
    } catch (err) {
      // Leave the board in its last-known state; the next poll will retry.
      console.error("[kanban-board] failed to load tasks:", err);
    } finally {
      if (!disposed) store.setUiState({ syncing: false });
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
    patch: { title?: string; assignee?: string | null; agentId?: string | null; conversationId?: string | null; agentPrompt?: string; expectedOutput?: string; successCriteria?: string; priority?: TaskPriority },
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
      // Transaction-based delete. The card stays on the board through every
      // phase and only fades away once the OpenHands conversation is confirmed
      // gone and the board sync has finished. On any failure the task is NOT
      // removed — the card shows a "Deletion Failed" state with Retry/Cancel.
      const setPhase = (phase: DeletePhase) => {
        const phases = new Map(store.get().uiState.deletePhases);
        phases.set(taskId, phase);
        const deleting = new Set(store.get().uiState.deletingTaskIds);
        deleting.add(taskId);
        store.setUiState({ deletingTaskIds: deleting, deletePhases: phases });
      };
      const clearError = () => {
        const errors = new Map(store.get().uiState.deleteErrors);
        errors.delete(taskId);
        store.setUiState({ deleteErrors: errors });
      };
      const fail = (reason: string) => {
        const errors = new Map(store.get().uiState.deleteErrors);
        errors.set(taskId, reason);
        const phases = new Map(store.get().uiState.deletePhases);
        phases.delete(taskId);
        store.setUiState({ deleteErrors: errors, deletePhases: phases });
      };

      try {
        // Phase 1: deleting — card disabled, "Deleting Task…" shown.
        setPhase("deleting");
        clearError();

        // Capture the conversation id before the task is gone from disk, so we
        // can delete the live OpenHands conversation that syncInboundConversations
        // would otherwise resurrect on the next load(). The task's conversationId
        // field holds the raw conversation id (no oh- prefix).
        const tasks = await fetchTasks(host);
        const conversationId = tasks.find((t) => t.id === taskId)?.conversationId ?? null;

        // Phase 2: removing_conversation — delete the OpenHands conversation.
        // This happens BEFORE the task is removed from disk, so the card never
        // disappears while the conversation still exists.
        if (conversationId) {
          setPhase("removing_conversation");
          await deleteConversation(host, conversationId);
        }

        // Phase 3: syncing — verify the conversation is actually gone and the
        // board sync has finished. Only after all three checks pass do we remove
        // the task from disk.
        setPhase("syncing");
        if (conversationId) {
          const gone = await verifyConversationGone(host, conversationId);
          if (!gone) {
            fail("OpenHands conversation could not be confirmed deleted");
            return;
          }
        }
        await syncBoardAction(host, "deleted", taskId).catch((error: unknown) => {
          console.error("[kanban-board] OpenHands delete sync failed:", error);
        });

        // Phase 4: fading — backend confirmed, fade the card out (300–500ms)
        // before removing it from disk.
        setPhase("fading");
        await new Promise((resolve) => setTimeout(resolve, 400));
        await deleteTask(host, taskId);
        clearTaskOverlay(taskId);
        // Register the task as recently deleted so the final load() (and any
        // poll that lands before the search index catches up) cannot rebuild
        // the card from a stale conversation. The finally block clears the
        // deleting flag, so this TTL is what keeps the guard active after the
        // transaction completes.
        recentlyDeleted.set(taskId, Date.now());
        await load();
      } catch (err) {
        console.error("[kanban-board] delete failed:", err);
        fail(err instanceof Error ? err.message : "Unexpected error during deletion");
      } finally {
        // Clear the "deleting" flag and phase so the card returns to normal
        // (or is gone after load() re-fetches). Runs on both success and failure.
        const deleting = new Set(store.get().uiState.deletingTaskIds);
        deleting.delete(taskId);
        const phases = new Map(store.get().uiState.deletePhases);
        phases.delete(taskId);
        store.setUiState({ deletingTaskIds: deleting, deletePhases: phases });
      }
    }

    function cancelDelete(taskId: string): void {
      if (disposed) return;
      // Clear the error and phase state so the card returns to normal. The task
      // was never removed from disk on failure, so it is still there.
      const errors = new Map(store.get().uiState.deleteErrors);
      errors.delete(taskId);
      const phases = new Map(store.get().uiState.deletePhases);
      phases.delete(taskId);
      const deleting = new Set(store.get().uiState.deletingTaskIds);
      deleting.delete(taskId);
      store.setUiState({ deleteErrors: errors, deletePhases: phases, deletingTaskIds: deleting });
    }

  async function create(
    title: string,
    status: TaskStatus,
    assignee?: string | null,
    projectId?: string,
    agentId?: string | null,
    agentPrompt?: string,
    expectedOutput?: string,
    successCriteria?: string,
    priority?: TaskPriority,
  ): Promise<boolean> {
    if (disposed) return false;
    try {
      // AI-assigned tasks always start in Todo — the OpenHands execution
      // lifecycle (queued/running -> in_progress) drives the column once the
      // conversation is created and started.
      const effectiveStatus = agentId ? "todo" : status;
      // Pre-generate the task id so the OpenHands conversation can carry it in
      // its tags BEFORE the task exists on disk.
      const taskId = crypto.randomUUID();
      // Conversation-first lifecycle applies to AI-assigned tasks: the card
      // must not appear until the OpenHands conversation exists. If the
      // conversation cannot be created, no task is written and the user sees no
      // phantom card. Manual tasks (no agent) have no conversation — they are
      // persisted immediately and appear right away.
      let conversationId: string | null = null;
      if (agentId) {
        conversationId = await createConversationForTask(host, taskId, {
          title,
          agentPrompt,
          expectedOutput,
          successCriteria,
          agentId,
        });
      }
      await createTask(host, title, effectiveStatus, assignee, projectId, agentId, agentPrompt, expectedOutput, successCriteria, priority, taskId, conversationId);
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
    cancelDelete,
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
