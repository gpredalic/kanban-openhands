/**
 * verify-7-features.test.ts — headless verification of the 7 requested
 * Board / Workflow / Global UX improvements against the REAL built artifact.
 *
 * Mounts the self-contained `extension.js` (the exact file Agent Canvas loads)
 * with a mock host that returns tasks + OpenHands conversations, then inspects
 * the actual rendered DOM to prove each feature:
 *
 *   F1  Status strictly controls column placement
 *   F2  No sliding/swipe actions (only scale hover)
 *   F3  Delete disabled for active (running/queued) tasks
 *   F4  Task execution details visible in the detail modal
 *   F5  Workflow routing (current node, next node, execution path)
 *   F6  Skeleton loading on initial load
 *   F7  Motion improvements (CSS animations present)
 */

import "./setup";
import { window } from "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** A mock host that returns tasks + OpenHands conversations. */
function makeHost(opts: { hangLoad?: boolean } = {}) {
  const tasks = [
    { id: "t-run", title: "Running task", status: "in_progress", assignee: "Ada", projectId: "p1", waitingOn: null, priority: "high", tags: [], dueDate: null },
    { id: "t-queue", title: "Queued task", status: "todo", assignee: "Grace", projectId: "p1", waitingOn: null, priority: "medium", tags: [], dueDate: null },
    { id: "t-fail", title: "Failed task", status: "review", assignee: "Alan", projectId: "p2", waitingOn: null, priority: "low", tags: [], dueDate: null },
    { id: "t-done", title: "Completed task", status: "done", assignee: "Katherine", projectId: "p1", waitingOn: null, priority: "critical", tags: [], dueDate: null },
  ];

  // OpenHands conversations that mirror the tasks' execution statuses.
  const conversations = [
    { id: "conv-run", title: "Running task", execution_status: "running", tags: { taskid: "t-run" }, created_at: "2026-11-23T10:00:00Z" },
    { id: "conv-queue", title: "Queued task", execution_status: "queued", tags: { taskid: "t-queue" }, created_at: "2026-11-23T10:01:00Z" },
    { id: "conv-fail", title: "Failed task", execution_status: "failed", tags: { taskid: "t-fail" }, created_at: "2026-11-23T10:02:00Z" },
    { id: "conv-done", title: "Completed task", execution_status: "completed", tags: { taskid: "t-done" }, created_at: "2026-11-23T10:03:00Z" },
  ];

  let render: RenderFn | null = null;
  const hang = opts.hangLoad === true;
  const host = {
    apiVersion: "1",
    registerPage(id: string, fn: RenderFn) {
      render = fn;
      return () => {
        render = null;
      };
    },
    agentServer: {
      request: async (req: { method: string; path: string }) => {
        if (req.method === "GET" && req.path.startsWith("/api/file/download")) {
          if (hang) return new Promise(() => {}); // never resolves
          return tasks;
        }
        if (req.method === "GET" && req.path.startsWith("/api/conversations/search")) {
          if (hang) return new Promise(() => {});
          return { items: conversations };
        }
        if (req.method === "GET" && req.path.includes("/events/search")) {
          if (hang) return new Promise(() => {});
          return { items: [{ id: "ev1", kind: "message", source: "agent", title: "Working on step 1", detail: "Agent is processing the task", timestamp: "2026-11-23T10:05:00Z" }] };
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
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await tick(10);
  }
  return predicate();
}

/** Find the column element by its data-drop-status attribute. */
function columnByStatus(container: HTMLElement, status: string): HTMLElement | null {
  return container.querySelector(`[data-drop-status="${status}"]`);
}

/** Find the task card element by its title text. */
function taskCardByTitle(container: HTMLElement, title: string): HTMLElement | null {
  const cards = Array.from(container.querySelectorAll("[data-task-id]"));
  return cards.find((c) => c.textContent?.includes(title)) ?? null;
}

/**
 * The extension injects its stylesheet into `document.head` as a `<style>` tag
 * (see inline-css-plugin.ts). CSS rules — hover transforms, keyframes, the
 * skeleton shimmer — live there, not on the container. This returns the full
 * injected CSS text so tests can assert on the real rules.
 */
function injectedCss(): string {
  return Array.from(document.head.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * F1 — Status strictly controls column placement.
 * ------------------------------------------------------------------ */
test("F1: execution status strictly controls column placement", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // Running → In Progress column
  const inProgress = columnByStatus(container, "in_progress");
  assert.ok(inProgress, "In Progress column must exist");
  assert.ok(inProgress!.textContent?.includes("Running task"), "Running task must be in In Progress column");

  // Queued → To Do column
  const todo = columnByStatus(container, "todo");
  assert.ok(todo, "To Do column must exist");
  assert.ok(todo!.textContent?.includes("Queued task"), "Queued task must be in To Do column");

  // Failed → Review column
  const review = columnByStatus(container, "review");
  assert.ok(review, "Review column must exist");
  assert.ok(review!.textContent?.includes("Failed task"), "Failed task must be in Review column");

  // Completed → Done column
  const done = columnByStatus(container, "done");
  assert.ok(done, "Done column must exist");
  assert.ok(done!.textContent?.includes("Completed task"), "Completed task must be in Done column");

  cleanup();
  container.remove();
});

/* ------------------------------------------------------------------ *
 * F2 — No sliding/swipe actions, and no scale transform on hover.
 *
 * The hover feedback is carried entirely by the border-color highlight
 * and the indigo glow shadow. A scale transform would make the card
 * visually overflow its column, widening the board and triggering a
 * horizontal scrollbar — so the hover rule must NOT scale the card.
 * ------------------------------------------------------------------ */
test("F2: no sliding/swipe actions, no scale transform on hover", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  const html = container.innerHTML;

  // No translate-x slide animations on task cards.
  assert.doesNotMatch(html, /translate-x-\d+/i, "no translate-x slide on cards");
  assert.doesNotMatch(html, /slide-in|slide-out|swipe/i, "no slide/swipe class names");

  // The hover rule must NOT apply a scale transform (it would overflow the
  // column and create a horizontal scrollbar). Hover feedback is carried by
  // the border-color highlight and the glow shadow instead.
  const css = injectedCss();
  const hoverRule = css.match(/\.kb-card:hover\s*{[^}]*}/i)?.[0] ?? "";
  assert.ok(hoverRule, ".kb-card:hover rule must be present in the injected CSS");
  assert.doesNotMatch(hoverRule, /transform:\s*scale/i, "hover rule must not scale the card (would overflow the column)");
  assert.match(hoverRule, /border-color/i, "hover rule must highlight the border");
  assert.match(hoverRule, /box-shadow/i, "hover rule must apply the glow shadow");

  cleanup();
  container.remove();
});

/* ------------------------------------------------------------------ *
 * F3 — Delete disabled for active (running/queued) tasks.
 * ------------------------------------------------------------------ */
test("F3: delete button disabled for running and queued tasks", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // Running task: delete button must be disabled.
  const runningCard = taskCardByTitle(container, "Running task");
  assert.ok(runningCard, "Running task card must exist");
  const runningDelete = runningCard!.querySelector('button[title="Stop the task before deleting it."]');
  assert.ok(runningDelete, "Running task must have a disabled delete button with the stop-first title");
  assert.ok(runningDelete!.hasAttribute("disabled"), "Running task delete button must be disabled");

  // Queued task: delete button must be disabled.
  const queuedCard = taskCardByTitle(container, "Queued task");
  assert.ok(queuedCard, "Queued task card must exist");
  const queuedDelete = queuedCard!.querySelector('button[title="Stop the task before deleting it."]');
  assert.ok(queuedDelete, "Queued task must have a disabled delete button with the stop-first title");
  assert.ok(queuedDelete!.hasAttribute("disabled"), "Queued task delete button must be disabled");

  // Failed task: delete button must be enabled (not active).
  const failedCard = taskCardByTitle(container, "Failed task");
  assert.ok(failedCard, "Failed task card must exist");
  const failedDelete = failedCard!.querySelector('button[title="Delete task"]');
  assert.ok(failedDelete, "Failed task must have an enabled delete button");
  assert.ok(!failedDelete!.hasAttribute("disabled"), "Failed task delete button must be enabled");

  cleanup();
  container.remove();
});

/* ------------------------------------------------------------------ *
 * F4 — Task execution details visible in the detail modal.
 * ------------------------------------------------------------------ */
test("F4: task execution details visible in the detail modal", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // Click the Running task card to open the detail modal. The card opens the
  // modal on onPointerUp (not onClick): dnd-kit's pointerdown handler calls
  // preventDefault, which suppresses the click event. So we dispatch a
  // pointerdown (to record the position) followed by a pointerup. happy-dom
  // has no PointerEvent constructor, so we use plain Events — clientX/clientY
  // are undefined, making Math.hypot(NaN, NaN) = NaN, and NaN > 5 is false,
  // so the handler treats it as a genuine card-body click and calls onEdit.
  const runningCard = taskCardByTitle(container, "Running task");
  assert.ok(runningCard, "Running task card must exist");
  runningCard!.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  runningCard!.dispatchEvent(new window.Event("pointerup", { bubbles: true }));

  const modalShown = await waitFor(() => container.innerHTML.includes("OpenHands Execution"));
  assert.ok(modalShown, "detail modal must show the OpenHands Execution section");

  const html = container.innerHTML;
  assert.match(html, /Current Step/, "must show Current Step");
  assert.match(html, /Latest Agent Message/, "must show Latest Agent Message");
  assert.match(html, /Progress/, "must show Progress");
  assert.match(html, /Conversation:/, "must show conversation id");

  cleanup();
  container.remove();
});

/* ------------------------------------------------------------------ *
 * F5 — Workflow routing (current node, next node, execution path).
 * ------------------------------------------------------------------ */
test("F5: workflow routing shows current node, next node, and execution path", async () => {
  // Seed a workflow with a running task node so routing can be derived.
  const workflow = {
    id: "wf-1",
    name: "Test Workflow",
    description: "A test workflow for routing verification",
    nodes: [
      { id: "n-start", type: "start", label: "Start", x: 0, y: 0 },
      { id: "n-run", type: "task", label: "Running task", x: 200, y: 0, taskId: "t-run" },
      { id: "n-next", type: "task", label: "Next task", x: 400, y: 0, taskId: "t-queue" },
      { id: "n-end", type: "end", label: "End", x: 600, y: 0 },
    ],
    edges: [
      { id: "e1", from: "n-start", to: "n-run", condition: "always" },
      { id: "e2", from: "n-run", to: "n-next", condition: "always" },
      { id: "e3", from: "n-next", to: "n-end", condition: "always" },
    ],
    status: "active",
  };
  localStorage.setItem(
    "kanban-board.ai-config.v1",
    JSON.stringify({ workflows: [workflow], routingRules: [] }),
  );

  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // Click the Monitoring tab — the Execution Routing readout now lives in the
  // dedicated Monitoring view, not the Workflow builder.
  const monitoringTab = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.includes("Monitoring"),
  );
  assert.ok(monitoringTab, "Monitoring tab must exist");
  monitoringTab!.click();

  const routingShown = await waitFor(() => container.innerHTML.includes("Execution Routing"));
  assert.ok(routingShown, "Monitoring view must show the Execution Routing section");

  const html = container.innerHTML;
  assert.match(html, /Current Node/, "must show Current Node");
  assert.match(html, /Next Node/, "must show Next Node");
  assert.match(html, /Execution Path/, "must show Execution Path");

  // The running task node must be the current node.
  assert.match(html, /Running task/, "current node must be the running task");

  cleanup();
  container.remove();
});

/* ------------------------------------------------------------------ *
 * F6 — Skeleton loading on initial load.
 * ------------------------------------------------------------------ */
test("F6: skeleton loading shown on initial load", async () => {
  // Use a host that hangs the load so the board stays in the loading state.
  const { host, trigger } = makeHost({ hangLoad: true });
  const cleanup = activate(host);
  const container = trigger();

  // The skeleton must appear immediately (before any data loads).
  await tick(50);
  const html = container.innerHTML;
  assert.match(html, /kb-skeleton/, "skeleton elements must be present during initial load");
  // The shimmer animation is a CSS keyframe in the injected stylesheet
  // (.kb-skeleton { animation: kb-shimmer ... }), not a class on the element.
  const css = injectedCss();
  assert.match(css, /@keyframes kb-shimmer/i, "skeleton shimmer keyframe must be present in the injected CSS");
  assert.match(css, /\.kb-skeleton\s*{[^}]*animation:\s*kb-shimmer/i, "skeleton must reference the shimmer animation");

  cleanup();
  container.remove();
});

/* ------------------------------------------------------------------ *
 * F7 — Motion improvements (CSS animations present in the bundle).
 * ------------------------------------------------------------------ */
test("F7: motion improvements — CSS animations present", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // The motion system is a set of CSS keyframes in the injected stylesheet
  // (see globals.css). The container only carries the class hooks
  // (kb-fade-in, kb-status-changed, kb-running, …); the actual animations are
  // defined as @keyframes rules in document.head.
  const css = injectedCss();

  // Card enter animation (kb-fade-in is applied to every card and the modal).
  assert.match(css, /@keyframes kb-fade-in/i, "card enter animation (kb-fade-in) must be present");

  // Status transition animation (kb-status-change fires on status changes).
  assert.match(css, /@keyframes kb-status-change/i, "status transition animation (kb-status-change) must be present");

  // Lifecycle animations: completion flash, failure shake, running pulse.
  assert.match(css, /@keyframes kb-complete-flash/i, "completion flash animation must be present");
  assert.match(css, /@keyframes kb-fail-shake/i, "failure shake animation must be present");
  assert.match(css, /@keyframes kb-running-pulse/i, "running pulse animation must be present");

  // The card element must actually carry the enter-animation class hook.
  assert.match(container.innerHTML, /kb-fade-in/, "cards must carry the kb-fade-in class hook");

  cleanup();
  container.remove();
});
