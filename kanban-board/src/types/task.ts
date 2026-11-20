/**
 * task.ts — Task, Column, Status, Priority unions and board state types.
 *
 * The backend data model mirrors the native Task model. Columns are derived
 * from the status enum — there is no separate column vocabulary.
 *
 * The redesign adds optional, backward-compatible fields to Task
 * (description, priority, progress) and extends the ephemeral UI state with
 * search and a richer filter set. All new fields are optional so existing
 * persisted data and API responses remain valid.
 */

/** Task status values. Each value maps to exactly one board column. */
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

/** Task priority levels, each with its own accent colour. */
export type TaskPriority = "low" | "medium" | "high";

/** A single task as returned by the host backend. */
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  projectId: string;
  /** Configured AI agent assigned to this task. */
  agentId?: string | null;
  /** OpenHands conversation correlated to this task. */
  conversationId?: string | null;
  /** OpenHands execution id (same as conversationId for 1:1 runs). */
  executionId?: string | null;
  /** OpenHands agent profile id that owns the execution. */
  profileId?: string | null;
  /** Local schedule time for OpenHands work; no server cron is required. */
  scheduledAt?: string | null;
  /** Inherited from the native Task model — a non-empty list means the task is blocked. */
  waitingOn: string[] | null;
  /** Free-form tags. Optional — absent on legacy data. */
  tags?: string[];
  /** Due date as an ISO date string (YYYY-MM-DD). Optional. */
  dueDate?: string | null;
  /** Short description shown on the card. Optional — absent on legacy data. */
  description?: string;
  /** Priority level. Optional — defaults to "medium" in the UI when absent. */
  priority?: TaskPriority;
  /** Completion percentage 0–100. Optional — defaults to 0 when absent. */
  progress?: number;
}

/** A board column: a status value plus the tasks currently in that status. */
export interface Column {
  status: TaskStatus;
  title: string;
  tasks: Task[];
}

/** A swimlane groups columns by project. */
export interface Swimlane {
  projectId: string;
  title: string;
  /** All tasks in this lane, in input order (across all status columns). */
  tasks: Task[];
  columns: Column[];
}

/** Computed board statistics (derived, never persisted). */
export interface BoardStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  blocked: number;
  overdue: number;
  dueSoon: number;
  byTag: Record<string, number>;
  byProject: Record<string, number>;
}

/** Filter pills shown in the FilterBar. */
export type BoardFilter = "all" | "active" | "assigned" | "review" | "completed";

/** Ephemeral UI state — lives only in the browser, never persisted. */
export interface BoardUiState {
  filter: BoardFilter;
  /** Free-text search query (matches title, assignee, tags). */
  search: string;
  lastLoadedAt: number;
}

/** The full board state: persisted data + ephemeral UI state. */
export interface BoardState {
  columns: Column[];
  uiState: BoardUiState;
}

/**
 * The five top-level views of the orchestration platform. The board view is
 * the Kanban board; the other four are AI views (workflow DAG, agent roster,
 * execution history, token/cost analytics).
 */
export type ViewId = "board" | "command" | "workflow" | "agents" | "history" | "analytics";

/** The host API surface injected by Agent Canvas. */
export interface HostApi {
  apiVersion: string;
  agentServer: {
    request: (opts: { method: string; path: string; body?: unknown }) => Promise<unknown>;
  };
  appBackendView?: {
    mount: (opts: { container: HTMLElement }) => { unmount: () => void };
  };
  backend?: { id: string };
}

/** The render context passed to the page render function by registerPage. */
export interface PageContext {
  container: HTMLElement;
  path: string;
}

/** The host object passed to activate(). */
export interface Host {
  apiVersion: string;
  registerPage: (id: string, render: (ctx: PageContext) => void) => () => void;
  agentServer: HostApi["agentServer"];
  appBackendView?: HostApi["appBackendView"];
  backend?: HostApi["backend"];
}
