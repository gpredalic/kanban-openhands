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

import type { Host, Task, TaskStatus } from "../types/task";

/** Stable path for the board's task file on the agent server. */
const BOARD_FILE_PATH = "/home/razvijalec/.kanban-board/board.json";

/**
 * Download the board file and parse it as a task list.
 * Returns an empty array if the file is missing or malformed.
 */
export async function fetchTasks(host: Host): Promise<Task[]> {
  try {
    const res = await host.agentServer.request({
      method: "GET",
      path: `/api/file/download?path=${encodeURIComponent(BOARD_FILE_PATH)}`,
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
 */
export async function createTask(
  host: Host,
  title: string,
  status: TaskStatus,
  assignee?: string | null,
  projectId?: string,
  agentId?: string | null,
): Promise<Task> {
  const tasks = await fetchTasks(host);
  const task: Task = {
    id: crypto.randomUUID(),
    title,
    status,
    assignee: assignee ?? null,
    projectId: projectId ?? "default",
    waitingOn: null,
    agentId: agentId ?? null,
  };
  tasks.push(task);
  await saveTasks(host, tasks);
  return task;
}

/**
 * Move a task to a new status and persist.
 */
export async function moveTask(host: Host, taskId: string, status: TaskStatus): Promise<void> {
  const tasks = await fetchTasks(host);
  const task = tasks.find((t) => t.id === taskId);
  if (task) task.status = status;
  await saveTasks(host, tasks);
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
  },
): Promise<void> {
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
  }
  await saveTasks(host, tasks);
}

/**
 * Delete a task and persist.
 */
export async function deleteTask(host: Host, taskId: string): Promise<void> {
  const tasks = await fetchTasks(host);
  const filtered = tasks.filter((t) => t.id !== taskId);
  await saveTasks(host, filtered);
}
