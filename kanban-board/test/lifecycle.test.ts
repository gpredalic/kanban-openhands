import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Host, Task } from "../src/types/task";
import {
  createConversationForTask,
  syncInboundConversations,
  verifyConversationGone,
  deleteConversation,
} from "../src/lib/openhands";

/**
 * A mock host backed by an in-memory board file + conversation store, so the
 * board↔OpenHands lifecycle can be exercised end-to-end without a live server.
 *
 *   - GET  /api/file/download?path=...  -> board file JSON (raw string)
 *   - POST /api/file/upload?path=...    -> persist board file
 *   - GET  /api/conversations/search    -> conversation list
 *   - POST /api/conversations           -> create conversation
 *   - GET  /api/conversations/{id}      -> 200 if present, 404 if gone
 *   - DELETE /api/conversations/{id}    -> remove conversation
 */
function makeHost() {
  const state = {
    boardFile: "[]",
    conversations: new Map<string, Record<string, unknown>>(),
    calls: [] as string[],
  };
  const host: Host = {
    apiVersion: "1",
    registerPage: () => () => undefined,
    agentServer: {
      async request(opts) {
        const { method, path, body } = opts;
        state.calls.push(`${method} ${path}`);
        if (method === "GET" && path.startsWith("/api/file/download")) {
          return state.boardFile;
        }
        if (method === "POST" && path.startsWith("/api/file/upload")) {
          // saveTasks() sends a FormData with the JSON string as the `file`
          // field (a happy-dom Blob). Read it back out.
          const form = body as FormData;
          const file = form?.get("file") as Blob | null;
          if (file) state.boardFile = await file.text();
          else if (typeof body === "string") state.boardFile = body;
          return { ok: true };
        }
        if (method === "GET" && path.startsWith("/api/conversations/search")) {
          return [...state.conversations.values()];
        }
        if (method === "POST" && path === "/api/conversations") {
          const id = `conv-${state.conversations.size + 1}`;
          state.conversations.set(id, { id, ...(body as Record<string, unknown>) });
          return { id };
        }
        const convMatch = path.match(/^\/api\/conversations\/([^/]+)$/);
        if (convMatch) {
          const id = decodeURIComponent(convMatch[1]);
          if (method === "GET") {
            const conv = state.conversations.get(id);
            if (!conv) {
              const err = new Error("not found") as Error & { status?: number };
              err.status = 404;
              throw err;
            }
            return conv;
          }
          if (method === "DELETE") {
            if (!state.conversations.has(id)) {
              const err = new Error("not found") as Error & { status?: number };
              err.status = 404;
              throw err;
            }
            state.conversations.delete(id);
            return { ok: true };
          }
        }
        throw new Error(`unhandled ${method} ${path}`);
      },
    },
  };
  return { host, state };
}

test("createConversationForTask posts the task id in tags and returns the conversation id", async () => {
  const { host, state } = makeHost();
  const convId = await createConversationForTask(host, "task-1", {
    title: "Do the thing",
    agentPrompt: "Please do the thing",
  });
  assert.equal(convId, "conv-1");
  const conv = state.conversations.get("conv-1");
  assert.ok(conv, "conversation was created");
  const tags = conv?.tags as Record<string, string>;
  assert.equal(tags.taskid, "task-1");
  assert.equal(tags.tasktitle, "Do the thing");
});

test("card appears only after the conversation exists: sync builds the task from the conversation", async () => {
  const { host, state } = makeHost();
  // No task on disk yet.
  state.boardFile = "[]";
  // A conversation exists (created first, per the reversed lifecycle).
  state.conversations.set("conv-1", {
    id: "conv-1",
    title: "Please do the thing",
    execution_status: "running",
    tags: { taskid: "task-1", tasktitle: "Do the thing" },
  });
  const tasks = await syncInboundConversations(host);
  const task = tasks.find((t) => t.id === "task-1");
  assert.ok(task, "task materialized from the existing conversation");
  assert.equal(task!.conversationId, "conv-1");
  assert.equal(task!.title, "Do the thing");
  assert.equal(task!.status, "in_progress");
  // The reconcile persisted the task to the board file.
  const persisted = JSON.parse(state.boardFile) as Task[];
  assert.ok(persisted.some((t) => t.id === "task-1"), "task persisted to board file");
});

test("no conversation -> no card: sync leaves an empty board empty", async () => {
  const { host, state } = makeHost();
  state.boardFile = "[]";
  // No conversations at all.
  const tasks = await syncInboundConversations(host);
  assert.deepEqual(tasks, []);
});

test("resurrection guard: a deleted task's stale conversation is dropped, not rebuilt", async () => {
  const { host, state } = makeHost();
  state.boardFile = "[]";
  // A stale conversation still lingers in the search index for a task that was
  // just deleted. The ignore set must prevent it from rebuilding the card and
  // best-effort delete the stale conversation.
  state.conversations.set("conv-9", {
    id: "conv-9",
    title: "stale",
    execution_status: "running",
    tags: { taskid: "task-deleted", tasktitle: "Stale task" },
  });
  const tasks = await syncInboundConversations(host, new Set(["task-deleted"]));
  assert.ok(!tasks.some((t) => t.id === "task-deleted"), "stale task was NOT rebuilt");
  assert.ok(!state.conversations.has("conv-9"), "stale conversation was best-effort deleted");
});

test("verifyConversationGone returns true once the conversation 404s", async () => {
  const { host } = makeHost();
  // conv-1 does not exist -> GET 404s -> confirmed gone.
  const gone = await verifyConversationGone(host, "conv-1", { attempts: 2, delayMs: 1 });
  assert.equal(gone, true);
});

test("verifyConversationGone returns false while the conversation still exists", async () => {
  const { host, state } = makeHost();
  state.conversations.set("conv-1", { id: "conv-1", title: "alive" });
  const gone = await verifyConversationGone(host, "conv-1", { attempts: 2, delayMs: 1 });
  assert.equal(gone, false);
});

test("deleteConversation swallows a 404 (already gone) and propagates other errors", async () => {
  const { host } = makeHost();
  // Already gone -> 404 -> no throw.
  await assert.doesNotReject(() => deleteConversation(host, "conv-missing"));
  // Unknown error -> propagates.
  const boomHost: Host = {
    apiVersion: "1",
    registerPage: () => () => undefined,
    agentServer: {
      async request() {
        const err = new Error("boom") as Error & { status?: number };
        err.status = 500;
        throw err;
      },
    },
  };
  await assert.rejects(() => deleteConversation(boomHost, "conv-1"));
});
