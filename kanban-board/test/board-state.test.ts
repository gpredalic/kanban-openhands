import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMN_ORDER,
  COLUMN_TITLES,
  groupTasksByStatus,
  groupTasksByProject,
  computeStats,
  wipExceeded,
  BoardStateStore,
} from "../src/lib/board-state";
import type { Task } from "../src/types/task";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    title: over.id,
    status: "todo",
    assignee: null,
    projectId: "p1",
    waitingOn: null,
    ...over,
  };
}

test("groupTasksByStatus buckets tasks into the four status columns in order", () => {
  const tasks = [
    task({ id: "a", status: "done" }),
    task({ id: "b", status: "todo" }),
    task({ id: "c", status: "in_progress" }),
    task({ id: "d", status: "review" }),
    task({ id: "e", status: "todo" }),
  ];
  const cols = groupTasksByStatus(tasks);
  assert.deepEqual(
    cols.map((c) => c.status),
    COLUMN_ORDER,
  );
  assert.equal(cols[0].title, COLUMN_TITLES.todo);
  assert.deepEqual(cols[0].tasks.map((t) => t.id), ["b", "e"]);
  assert.deepEqual(cols[1].tasks.map((t) => t.id), ["c"]);
  assert.deepEqual(cols[2].tasks.map((t) => t.id), ["d"]);
  assert.deepEqual(cols[3].tasks.map((t) => t.id), ["a"]);
});

test("groupTasksByStatus drops unknown statuses and yields empty columns for none", () => {
  const cols = groupTasksByStatus([task({ id: "x", status: "bogus" as never })]);
  assert.equal(cols.length, 4);
  assert.ok(cols.every((c) => c.tasks.length === 0));
});

test("groupTasksByStatus on an empty list yields four empty columns", () => {
  const cols = groupTasksByStatus([]);
  assert.equal(cols.length, 4);
  assert.ok(cols.every((c) => c.tasks.length === 0));
});

test("groupTasksByProject groups by project and buckets missing ids under Unassigned", () => {
  const tasks = [
    task({ id: "a", projectId: "alpha" }),
    task({ id: "b", projectId: "beta" }),
    task({ id: "c", projectId: "" }),
    task({ id: "d", projectId: "alpha" }),
  ];
  const lanes = groupTasksByProject(tasks);
  assert.equal(lanes.length, 3);
  const alpha = lanes.find((l) => l.projectId === "alpha");
  assert.ok(alpha);
  assert.deepEqual(alpha!.tasks.map((t) => t.id), ["a", "d"]);
  const unassigned = lanes.find((l) => l.projectId === "unassigned");
  assert.ok(unassigned);
  assert.equal(unassigned!.title, "Unassigned");
  assert.deepEqual(unassigned!.tasks.map((t) => t.id), ["c"]);
  // Each lane carries all four status columns.
  assert.equal(alpha!.columns.length, 4);
});

test("computeStats aggregates byStatus, blocked, byTag, byProject", () => {
  const tasks = [
    task({ id: "a", status: "todo", waitingOn: ["z"], tags: ["x", "y"], projectId: "p1" }),
    task({ id: "b", status: "done", tags: ["x"], projectId: "p2" }),
    task({ id: "c", status: "in_progress", projectId: "p1" }),
  ];
  const s = computeStats(tasks);
  assert.equal(s.total, 3);
  assert.equal(s.byStatus.todo, 1);
  assert.equal(s.byStatus.done, 1);
  assert.equal(s.byStatus.in_progress, 1);
  assert.equal(s.byStatus.review, 0);
  assert.equal(s.blocked, 1);
  assert.equal(s.byTag.x, 2);
  assert.equal(s.byTag.y, 1);
  assert.equal(s.byProject.p1, 2);
  assert.equal(s.byProject.p2, 1);
});

test("computeStats counts overdue and dueSoon (ignoring done tasks)", () => {
  const today = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const shift = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return iso(d);
  };
  const tasks = [
    task({ id: "over", status: "todo", dueDate: shift(-1) }),
    task({ id: "soon", status: "todo", dueDate: shift(2) }),
    task({ id: "done-over", status: "done", dueDate: shift(-1) }),
    task({ id: "none", status: "todo" }),
  ];
  const s = computeStats(tasks);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueSoon, 1);
});

test("wipExceeded enforces limits and treats absent/non-positive as unlimited", () => {
  const tasks = [
    task({ id: "a", status: "in_progress" }),
    task({ id: "b", status: "in_progress" }),
    task({ id: "c", status: "todo" }),
  ];
  assert.equal(wipExceeded(tasks, "in_progress", { in_progress: 2 }), true); // 2 >= 2
  assert.equal(wipExceeded(tasks, "in_progress", { in_progress: 3 }), false); // 2 < 3
  assert.equal(wipExceeded(tasks, "in_progress", {}), false); // no limit
  assert.equal(wipExceeded(tasks, "in_progress", { in_progress: 0 }), false); // non-positive
  assert.equal(wipExceeded(tasks, "todo", { in_progress: 1 }), false); // different status
});

test("BoardStateStore: setColumns / setUiState / markLoaded notify subscribers", () => {
  const store = new BoardStateStore();
  let calls = 0;
  const unsub = store.subscribe(() => {
    calls += 1;
  });
  assert.equal(store.get().columns.length, 4);
  assert.equal(store.get().uiState.filter, "all");

  store.setColumns(groupTasksByStatus([task({ id: "a" })]));
  assert.equal(calls, 1);
  assert.equal(store.get().columns[0].tasks.length, 1);

  store.setUiState({ filter: "active", search: "foo" });
  assert.equal(calls, 2);
  assert.equal(store.get().uiState.filter, "active");
  assert.equal(store.get().uiState.search, "foo");

  store.markLoaded();
  assert.equal(calls, 3);
  assert.ok(store.get().uiState.lastLoadedAt > 0);

  unsub();
  store.setUiState({ filter: "assigned" });
  assert.equal(calls, 3); // no longer notified after unsubscribe
});
