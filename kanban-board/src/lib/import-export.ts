/**
 * import-export.ts — JSON export / import of the board (Phase 2).
 *
 * Export serializes the current task list (with the overlay applied) to a
 * versioned JSON document and triggers a browser download. Import parses a
 * JSON document, validates it, and returns the tasks so the caller can push
 * them to the backend (create) and/or the overlay (tags/dueDate).
 *
 * The document shape is stable and versioned so future schema changes can be
 * detected. Import is defensive: malformed input yields an empty result plus
 * a human-readable error rather than throwing.
 */

import type { Task, TaskStatus } from "../types/task";
import { COLUMN_ORDER } from "./board-state";

/** Bump when the export document shape changes incompatibly. */
export const EXPORT_VERSION = 1;

/** The export document. */
export interface BoardExport {
  version: number;
  exportedAt: string; // ISO timestamp
  tasks: Task[];
}

/** Result of an import attempt. */
export interface ImportResult {
  ok: boolean;
  tasks: Task[];
  error?: string;
}

/**
 * Build an export document from a task list. The list should already have the
 * overlay applied so the exported JSON reflects what the user sees.
 */
export function buildExport(tasks: Task[]): BoardExport {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    tasks: tasks.map((t) => ({ ...t })),
  };
}

/** Serialize an export document to a pretty-printed JSON string. */
export function serializeExport(doc: BoardExport): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * Trigger a browser download of the export document.
 */
export function downloadExport(doc: BoardExport, filename = "kanban-board-export.json"): void {
  const blob = new Blob([serializeExport(doc)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Parse and validate an import document from a JSON string.
 *
 * Accepts either a full BoardExport document or a bare array of tasks. Each
 * task is validated: it must have a string id and title, and a known status
 * (unknown statuses are coerced to "todo"). tags/dueDate are optional.
 */
export function parseImport(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, tasks: [], error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Accept a bare array or a { tasks: [...] } document.
  let rawTasks: unknown;
  if (Array.isArray(parsed)) {
    rawTasks = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    rawTasks = (parsed as { tasks: unknown[] }).tasks;
  } else {
    return { ok: false, tasks: [], error: "Expected a JSON array of tasks or an object with a 'tasks' array." };
  }

  const tasks: Task[] = [];
  for (const raw of rawTasks as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const id = typeof t.id === "string" ? t.id : null;
    const title = typeof t.title === "string" ? t.title : null;
    if (!id || !title) continue; // skip malformed entries
    const status: TaskStatus = COLUMN_ORDER.includes(t.status as TaskStatus)
      ? (t.status as TaskStatus)
      : "todo";
    const task: Task = {
      id,
      title,
      status,
      assignee: typeof t.assignee === "string" ? t.assignee : null,
      projectId: typeof t.projectId === "string" ? t.projectId : "",
      waitingOn: Array.isArray(t.waitingOn) ? (t.waitingOn as string[]) : null,
    };
    if (Array.isArray(t.tags)) task.tags = (t.tags as unknown[]).filter((x) => typeof x === "string") as string[];
    if (typeof t.dueDate === "string") task.dueDate = t.dueDate;
    tasks.push(task);
  }

  return { ok: true, tasks };
}

/**
 * Read a File (from an <input type="file">) and parse it as an import.
 */
export async function importFromFile(file: File): Promise<ImportResult> {
  const text = await file.text();
  return parseImport(text);
}
