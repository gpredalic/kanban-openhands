import { test } from "node:test";
import assert from "node:assert/strict";
import { parseISODate, startOfToday, addDays, dueState } from "../src/lib/date";

test("parseISODate parses a valid YYYY-MM-DD into a local Date", () => {
  const d = parseISODate("2026-11-18");
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 10); // November is month index 10
  assert.equal(d.getDate(), 18);
});

test("parseISODate returns null for malformed input", () => {
  assert.equal(parseISODate("not-a-date"), null);
  assert.equal(parseISODate("2026-13-40"), null); // invalid month/day
  assert.equal(parseISODate("2026/11/18"), null);
  assert.equal(parseISODate(""), null);
});

test("startOfToday returns today at local midnight", () => {
  const t = startOfToday();
  const n = new Date();
  assert.equal(t.getFullYear(), n.getFullYear());
  assert.equal(t.getMonth(), n.getMonth());
  assert.equal(t.getDate(), n.getDate());
  assert.equal(t.getHours(), 0);
  assert.equal(t.getMinutes(), 0);
  assert.equal(t.getSeconds(), 0);
});

test("addDays adds and subtracts days", () => {
  const base = new Date(2026, 0, 15); // Jan 15 2026
  assert.equal(addDays(base, 1).getDate(), 16);
  assert.equal(addDays(base, -1).getDate(), 14);
  assert.equal(addDays(base, 0).getDate(), 15);
  // Month rollover
  assert.equal(addDays(new Date(2026, 0, 31), 1).getDate(), 1);
  assert.equal(addDays(new Date(2026, 0, 31), 1).getMonth(), 1); // February
});

test("dueState classifies overdue / soon / normal / none", () => {
  const today = startOfToday();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  assert.equal(dueState(iso(addDays(today, -1)), "todo"), "overdue");
  assert.equal(dueState(iso(addDays(today, 0)), "todo"), "soon"); // due today
  assert.equal(dueState(iso(addDays(today, 3)), "todo"), "soon"); // boundary
  assert.equal(dueState(iso(addDays(today, 4)), "todo"), "normal");
  assert.equal(dueState(null, "todo"), "none");
  assert.equal(dueState(undefined, "todo"), "none");
  assert.equal(dueState("garbage", "todo"), "none");
  // A done task is never overdue/soon.
  assert.equal(dueState(iso(addDays(today, -5)), "done"), "normal");
});
