/**
 * types.ts — Task, Column, Status unions (spec §4.1, §3).
 *
 * The backend data model mirrors the native Task model. Columns are derived
 * from the status enum — there is no separate column vocabulary.
 *
 * Phase 2 adds optional, backward-compatible fields to Task (tags, dueDate)
 * and extends the ephemeral UI state with search, tag filter, view mode, and
 * WIP limits. All new fields are optional so existing persisted data and API
 * responses remain valid.
 */

/** Task status values. Each value maps to exactly one board column. */
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

/** A single task as returned by the host backend. */
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee: string | null;
  projectId: string;
  /** Inherited from the native Task model — a non-empty list means the task is blocked. */
  waitingOn: string[] | null;
  /** Phase 2: free-form tags. Optional — absent on legacy data. */
  tags?: string[];
  /** Phase 2: due date as an ISO date string (YYYY-MM-DD). Optional. */
  dueDate?: string | null;
}

/** A board column: a status value plus the tasks currently in that status. */
export interface Column {
  status: TaskStatus;
  title: string;
  tasks: Task[];
}

/**
 * Phase 2: a swimlane groups columns by project. Each lane carries the
 * project id, a display name, and the columns (with that project's tasks).
 */
export interface Swimlane {
  projectId: string;
  title: string;
  /** All tasks in this lane, in input order (across all status columns). */
  tasks: Task[];
  columns: Column[];
}

/** Phase 2: computed board statistics (derived, never persisted). */
export interface BoardStats {
  total: number;
  byStatus: Record<TaskStatus, number>;
  blocked: number;
  overdue: number;
  dueSoon: number;
  byTag: Record<string, number>;
  byProject: Record<string, number>;
}

/** Ephemeral UI state — lives only in the browser, never persisted (spec §4.2). */
export interface BoardUiState {
  filter: "all" | "active" | "assigned";
  selectedColumn: string | null;
  lastLoadedAt: number;
  /** Phase 2: free-text search query (matches title, assignee, tags). */
  search: string;
  /** Phase 2: active tag filter (null = no tag filter). */
  tagFilter: string | null;
  /** Phase 2: board view mode. */
  view: "board" | "swimlane";
  /** Phase 2: WIP limits per status (absent = unlimited). */
  wipLimits: Partial<Record<TaskStatus, number>>;
}

/** The full board state: persisted data + ephemeral UI state. */
export interface BoardState {
  columns: Column[];
  uiState: BoardUiState;
}

/** The host API surface injected by Agent Canvas (spec §5.1). */
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
