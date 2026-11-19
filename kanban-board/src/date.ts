/**
 * date.ts — small, dependency-free date helpers for due dates (spec §4.1).
 *
 * Due dates are stored as ISO date strings (YYYY-MM-DD). These helpers parse
 * them, compute "today", and classify a due date as overdue / due-soon /
 * normal so the UI can colour-code cards and the stats bar can count them.
 */

import type { TaskStatus } from "./types";

/** Parse a YYYY-MM-DD string into a local Date, or null if malformed. */
export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  // Reject out-of-range components before construction (Date would roll them
  // over into a valid date, e.g. month 13 -> next year, day 40 -> next month).
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  const d = new Date(y, mo - 1, day);
  // Round-trip check catches impossible dates like 2026-02-30 (Feb has 28/29).
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/** Today at local midnight. */
export function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/** Return a new Date `days` after `d` (days may be negative). */
export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/** A due date's urgency, used for card + stats colour coding. */
export type DueState = "overdue" | "soon" | "normal" | "none";

/**
 * Classify a task's due date.
 * - "none"     — no due date (or unparseable).
 * - "overdue"  — due date is before today and the task is not done.
 * - "soon"     — due within the next 3 days and the task is not done.
 * - "normal"   — due later, or the task is already done.
 */
export function dueState(dueDate: string | null | undefined, status: TaskStatus): DueState {
  if (!dueDate) return "none";
  const due = parseISODate(dueDate);
  if (!due) return "none";
  if (status === "done") return "normal";
  const today = startOfToday();
  if (due < today) return "overdue";
  if (due <= addDays(today, 3)) return "soon";
  return "normal";
}
