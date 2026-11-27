/**
 * probe-outcome.test.ts — headless probe of the REAL built artifact.
 *
 * The Task Detail Inspector has two states, gated on whether the task has any
 * execution data:
 *
 *   Idle (no execution) — a minimal surface: the "Edit Task" eyebrow, the task
 *   title, and a quiet "not yet executed" note. No outcome hero, no fact grid,
 *   no Delete button.
 *
 *   Executed (has execution) — the outcome is the hero. Immediately after the
 *   title, a status-tinted result block answers "what happened", followed by a
 *   fact grid that answers the rest: what was requested, which agent executed
 *   it, when it ran, when it completed, and the token / cost footprint. A quiet
 *   "Delete task" action lives in the footer.
 *
 * This probe mounts the self-contained `extension.js` (the exact file Agent
 * Canvas loads), feeds it a snapshot with completed / failed / running
 * executions, and inspects the actual rendered DOM to prove the premium
 * outcome surface renders for each state.
 */

import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** A mock host whose tasks carry execution data via the snapshot. */
function makeHost() {
  const tasks = [
    { id: "c1", title: "Completed task", status: "done", assignee: "Grace", projectId: "p1", waitingOn: null, priority: "high", agentPrompt: "Refactor the auth module", description: "Refactor the auth module" },
    { id: "f1", title: "Failed task", status: "review", assignee: "Alan", projectId: "p2", waitingOn: null, priority: "medium", agentPrompt: "Fix the flaky test", description: "Fix the flaky test" },
    { id: "r1", title: "Running task", status: "in_progress", assignee: "Ada", projectId: "p1", waitingOn: null, priority: "low", agentPrompt: "Write the onboarding flow", description: "Write the onboarding flow" },
    { id: "i1", title: "Idle task", status: "todo", assignee: "Katherine", projectId: "p1", waitingOn: null, priority: "medium", agentPrompt: "", description: "" },
  ];

  const executions = [
    { id: "conv-c1", taskId: "c1", title: "Completed task", status: "completed", agentId: "agent-grace", startedAt: 1700000000000, finishedAt: 1700000120000, tokensIn: 1200, tokensOut: 800, cost: 0.042, error: undefined },
    { id: "conv-f1", taskId: "f1", title: "Failed task", status: "failed", agentId: "agent-alan", startedAt: 1700000200000, finishedAt: 1700000260000, tokensIn: 900, tokensOut: 300, cost: 0.018, error: "AssertionError: expected 200, got 500" },
    { id: "conv-r1", taskId: "r1", title: "Running task", status: "running", agentId: "agent-ada", startedAt: 1700000300000, finishedAt: undefined, tokensIn: 400, tokensOut: 100, cost: 0.006, error: undefined },
  ];

  let render: RenderFn | null = null;
  const host = {
    apiVersion: "1",
    registerPage(id: string, fn: RenderFn) {
      render = fn;
      return () => {
        render = null;
      };
    },
    agentServer: {
      request: async (opts: { method: string; path: string }) => {
        if (opts.method === "GET" && opts.path.startsWith("/api/file/download")) {
          return tasks;
        }
        if (opts.method === "GET" && opts.path.startsWith("/api/conversations/search")) {
          return { executions, events: [], links: [], updatedAt: Date.now() };
        }
        return {};
      },
    },
  };

  return {
    host,
    trigger: () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      render!({ container, path: "/kanban-board" });
      return container;
    },
  };
}

async function tick(ms = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await tick(10);
  }
  return predicate();
}

/** Open the detail inspector for the task whose card contains `title`. */
async function openInspector(container: HTMLElement, title: string): Promise<void> {
  const card = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((c) => c.textContent?.includes(title)) as HTMLElement;
  assert.ok(card, `task card for "${title}" exists on the board`);
  card.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  card.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  const opened = await waitFor(() => container.innerHTML.includes("Edit Task"));
  assert.ok(opened, `detail inspector opens for "${title}"`);
}

test("completed task: outcome hero + fact grid + delete", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Completed task"));
  assert.ok(loaded, "tasks must load and render");

  await openInspector(container, "Completed task");
  const html = container.innerHTML;

  // The outcome hero answers "what happened" immediately.
  assert.ok(html.includes("Completed"), "outcome hero shows the Completed label");

  // The fact grid answers the rest of the story.
  assert.ok(html.includes("Request"), "fact grid shows the Request label");
  assert.ok(html.includes("Refactor the auth module"), "fact grid shows the request text");
  assert.ok(html.includes("Executed by"), "fact grid shows the Executed by label");
  assert.ok(html.includes("Started"), "fact grid shows the Started label");
  assert.ok(html.includes("Duration"), "fact grid shows the Duration label");
  assert.ok(html.includes("Tokens"), "fact grid shows the Tokens label");
  assert.ok(html.includes("Cost"), "fact grid shows the Cost label");

  // The quiet Delete action lives in the footer.
  assert.ok(html.includes("Delete task"), "footer shows the Delete task action");

  cleanup();
  container.remove();
});

test("failed task: outcome hero + error message", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Failed task"));
  assert.ok(loaded, "tasks must load and render");

  await openInspector(container, "Failed task");
  const html = container.innerHTML;

  assert.ok(html.includes("Failed"), "outcome hero shows the Failed label");
  assert.ok(html.includes("AssertionError: expected 200, got 500"), "error message is surfaced");
  assert.ok(html.includes("Delete task"), "footer shows the Delete task action");

  cleanup();
  container.remove();
});

test("running task: outcome hero shows Running", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  await openInspector(container, "Running task");
  const html = container.innerHTML;

  assert.ok(html.includes("Running"), "outcome hero shows the Running label");
  assert.ok(html.includes("Write the onboarding flow"), "fact grid shows the request text");
  assert.ok(html.includes("Delete task"), "footer shows the Delete task action");

  cleanup();
  container.remove();
});

test("idle task: minimal surface, no outcome hero", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Idle task"));
  assert.ok(loaded, "tasks must load and render");

  await openInspector(container, "Idle task");
  const html = container.innerHTML;

  // The minimal idle surface shows the quiet note.
  assert.ok(html.includes("hasn\u2019t been executed yet"), "idle surface shows the not-yet-executed note");

  // No outcome hero, no fact grid, no Delete button.
  assert.ok(!html.includes("Request"), "idle surface must NOT show the Request label");
  assert.ok(!html.includes("Executed by"), "idle surface must NOT show the Executed by label");
  assert.ok(!html.includes("Delete task"), "idle surface must NOT show the Delete task action");

  cleanup();
  container.remove();
});
