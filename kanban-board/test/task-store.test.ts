/**
 * task-store.test.ts — verifies fetchTasks handles the REAL host response shape.
 *
 * The agent-server file download endpoint returns `application/octet-stream`,
 * so the host's `responseType: 'auto'` returns the body as a raw string (not a
 * parsed array). This test reproduces that exact behavior and proves fetchTasks
 * parses the string into a task list — the regression that made the board load
 * empty despite persisted tasks.
 */

import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchTasks } from "../src/lib/task-store";
import type { Host, Task } from "../src/types/task";

const TASKS: Task[] = [
  {
    id: "tetx",
    title: "tetx",
    status: "todo",
    assignee: null,
    projectId: "default",
    waitingOn: null,
  },
];

/** Build a mock host whose agentServer.request returns `res` for the download. */
function makeHost(res: unknown): Host {
  return {
    apiVersion: "1",
    registerPage: () => () => {},
    agentServer: {
      request: async () => res,
    },
  };
}

test("fetchTasks parses a raw JSON string (real host: octet-stream + auto)", async () => {
  // The real host returns the file body as a string, not a parsed array.
  const host = makeHost(JSON.stringify(TASKS));
  const tasks = await fetchTasks(host);
  assert.equal(tasks.length, 1, "must parse the string into one task");
  assert.equal(tasks[0].id, "tetx");
  assert.equal(tasks[0].title, "tetx");
  assert.equal(tasks[0].status, "todo");
});

test("fetchTasks still accepts a pre-parsed array (legacy/test host)", async () => {
  const host = makeHost(TASKS);
  const tasks = await fetchTasks(host);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "tetx");
});

test("fetchTasks accepts a { tasks: [...] } object envelope", async () => {
  const host = makeHost({ tasks: TASKS });
  const tasks = await fetchTasks(host);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "tetx");
});

test("fetchTasks parses a { tasks: [...] } envelope from a raw string", async () => {
  const host = makeHost(JSON.stringify({ tasks: TASKS }));
  const tasks = await fetchTasks(host);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "tetx");
});

test("fetchTasks returns [] for an empty-string body", async () => {
  const host = makeHost("");
  const tasks = await fetchTasks(host);
  assert.deepEqual(tasks, []);
});

test("fetchTasks returns [] for a malformed (non-JSON) string", async () => {
  const host = makeHost("not-json-at-all");
  const tasks = await fetchTasks(host);
  assert.deepEqual(tasks, []);
});

test("fetchTasks returns [] when the download throws (file missing)", async () => {
  const host: Host = {
    apiVersion: "1",
    registerPage: () => () => {},
    agentServer: {
      request: async () => {
        throw new Error("404 file not found");
      },
    },
  };
  const tasks = await fetchTasks(host);
  assert.deepEqual(tasks, []);
});
