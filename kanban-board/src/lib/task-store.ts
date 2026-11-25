/**
 * task-store.ts — task CRUD backed by the agent-server file API.
 *
 * The real agent server has no `/api/agent/tasks` endpoint. The board's task
 * persistence is rewired to the file API: a single JSON file at a stable path
 * holds the full task list. Reads download the file; writes upload the full
 * list. This is a real, working persistence surface — verified end-to-end.
 *
 * All backend access goes through `host.agentServer.request` — the extension
 * never constructs backend URLs or holds credentials.
 */

import type { Host, Task, TaskStatus, TaskPriority } from "../types/task";

/** Stable path for the board's task file on the agent server. */
const BOARD_FILE_PATH = "/home/razvijalec/.kanban-board/board.json";

/**
 * Serialize every read-modify-write cycle against the board file.
 *
 * The board file is a single JSON document holding the whole task list. Every
 * mutation (create/move/update/delete) and the inbound-conversation reconcile
 * all do fetch → mutate → save. If two of those cycles interleave, the second
 * one's fetch can read a snapshot that predates the first one's save, and its
 * save then clobbers the first one's change (a lost update). This is exactly
 * what dropped a freshly created task: `createTask` saved the new task, but a
 * concurrent `syncInboundConversations` had already fetched the pre-create list,
 * saw the new conversation with no matching task, and reconstructed a phantom
 * task that overwrote the real one.
 *
 * A module-level promise chain acts as a mutex: each critical section runs to
 * completion before the next begins, so fetch → mutate → save is atomic with
 * respect to every other board-file writer.
 */
let boardLock: Promise<unknown> = Promise.resolve();

/** Run `fn` as a serialized board-file critical section. */
export function withBoardLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = boardLock.then(fn, fn);
  // Keep the chain alive even if `fn` rejects, so a later section still runs.
  boardLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Collapse a task list to one entry per task id.
 *
 * A task id must appear at most once on the board — a duplicate id renders the
 * same card in two columns (the "task in both To Do and In Progress" bug). The
 * duplicate can be written by a lost-update race between two board-file writers
 * that both reconstructed the same task from the same conversation. When two
 * entries share an id we keep the one that is actually linked to an OpenHands
 * conversation (it carries the real execution identity); if both or neither are
 * linked we keep the first. The kept entry's status is then corrected from the
 * live conversation by the next inbound reconcile, so the column is always
 * authoritative from OpenHands.
 */
export function dedupeTasks(tasks: Task[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    const existing = byId.get(task.id);
    if (!existing) {
      byId.set(task.id, task);
      continue;
    }
    // Prefer the entry linked to a live conversation over an unlinked phantom.
    if (!existing.conversationId && task.conversationId) byId.set(task.id, task);
  }
  return [...byId.values()];
}

/**
 * Download the board file and parse it as a task list.
 * Returns an empty array if the file is missing or malformed.
 */
export async function fetchTasks(host: Host): Promise<Task[]> {
  try {
    // The board file is a read-modify-write surface, but the agent-server file
    // download endpoint returns `ETag`/`Last-Modified` with no `Cache-Control`.
    // Browsers then apply *heuristic caching* and serve a stale body for
    // repeated GETs to the same URL within a session — so a freshly saved task
    // is invisible to the next read until the page is reloaded. A per-request
    // cache-buster makes every read a unique URL the browser cannot cache.
    const res = await host.agentServer.request({
      method: "GET",
      path: `/api/file/download?path=${encodeURIComponent(BOARD_FILE_PATH)}&_cb=${Date.now()}`,
    });
    // The agent-server file download endpoint returns `application/octet-stream`,
    // so the host's `responseType: 'auto'` returns the body as a raw string
    // (not a parsed array). Parse it when needed.
    if (Array.isArray(res)) return res as Task[];
    if (typeof res === "string") {
      try {
        const parsed = JSON.parse(res);
        if (Array.isArray(parsed)) return parsed as Task[];
        if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks as Task[];
      } catch {
        // Not valid JSON — fall through to empty.
      }
    }
    if (res && typeof res === "object" && Array.isArray((res as { tasks?: Task[] }).tasks)) {
      return (res as { tasks: Task[] }).tasks;
    }
    return [];
  } catch {
    // File not found or download failed — treat as empty board.
    return [];
  }
}

/**
 * Upload the full task list to the board file.
 * The body is a FormData with the JSON string as the `file` field.
 */
export async function saveTasks(host: Host, tasks: Task[]): Promise<void> {
  const json = JSON.stringify(tasks, null, 2);
  const form = new FormData();
  form.append("file", new Blob([json], { type: "application/json" }), "board.json");
  await host.agentServer.request({
    method: "POST",
    path: `/api/file/upload?path=${encodeURIComponent(BOARD_FILE_PATH)}`,
    body: form,
  });
}

/**
 * Create a new task and persist the updated list.
 * Returns the created task.
 *
 * Accepts an optional pre-generated `id` and `conversationId` so the caller
 * can create the OpenHands conversation first (with the task id in its tags)
 * and then persist the task with the conversation already linked. This is what
 * makes the card appear only after the conversation exists.
 */
export async function createTask(
  host: Host,
  title: string,
  status: TaskStatus,
  assignee?: string | null,
  projectId?: string,
  agentId?: string | null,
  agentPrompt?: string,
  expectedOutput?: string,
  successCriteria?: string,
  priority?: TaskPriority,
  id?: string,
  conversationId?: string | null,
): Promise<Task> {
  return withBoardLock(async () => {
    const tasks = await fetchTasks(host);
    const task: Task = {
      id: id ?? crypto.randomUUID(),
      title,
      status,
      assignee: assignee ?? null,
      projectId: projectId ?? "default",
      waitingOn: null,
      agentId: agentId ?? null,
      agentPrompt: agentPrompt ?? "",
      expectedOutput: expectedOutput ?? "",
      successCriteria: successCriteria ?? "",
      priority: priority ?? "medium",
      ...(conversationId ? { conversationId, executionId: conversationId } : {}),
    };
    tasks.push(task);
    await saveTasks(host, tasks);
    return task;
  });
}

/**
 * Move a task to a new status and persist.
 */
export async function moveTask(host: Host, taskId: string, status: TaskStatus): Promise<void> {
  await withBoardLock(async () => {
    const tasks = await fetchTasks(host);
    const task = tasks.find((t) => t.id === taskId);
    if (task) task.status = status;
    await saveTasks(host, tasks);
  });
}

/**
 * Update a task's title or assignee and persist.
 */
export async function updateTask(
  host: Host,
  taskId: string,
  patch: {
    title?: string;
    assignee?: string | null;
    agentId?: string | null;
    conversationId?: string | null;
    executionId?: string | null;
    profileId?: string | null;
    status?: TaskStatus;
    agentPrompt?: string;
    expectedOutput?: string;
    successCriteria?: string;
    priority?: TaskPriority;
  },
): Promise<void> {
  await withBoardLock(async () => {
    const tasks = await fetchTasks(host);
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      if (patch.title !== undefined) task.title = patch.title;
      if (patch.assignee !== undefined) task.assignee = patch.assignee;
      if (patch.agentId !== undefined) task.agentId = patch.agentId;
      if (patch.conversationId !== undefined) task.conversationId = patch.conversationId;
      if (patch.executionId !== undefined) task.executionId = patch.executionId;
      if (patch.profileId !== undefined) task.profileId = patch.profileId;
      if (patch.status !== undefined) task.status = patch.status;
      if (patch.agentPrompt !== undefined) task.agentPrompt = patch.agentPrompt;
      if (patch.expectedOutput !== undefined) task.expectedOutput = patch.expectedOutput;
      if (patch.successCriteria !== undefined) task.successCriteria = patch.successCriteria;
      if (patch.priority !== undefined) task.priority = patch.priority;
    }
    await saveTasks(host, tasks);
  });
}

/**
 * Delete a task and persist.
 */
export async function deleteTask(host: Host, taskId: string): Promise<void> {
  await withBoardLock(async () => {
    const tasks = await fetchTasks(host);
    const filtered = tasks.filter((t) => t.id !== taskId);
    await saveTasks(host, filtered);
  });
}
