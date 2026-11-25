/**
 * probe-badges.test.ts — headless probe of the REAL built artifact.
 *
 * Mounts the self-contained `extension.js` (the exact file Agent Canvas loads)
 * with tasks that carry an OpenHands execution status and a priority, then
 * inspects the actual rendered DOM to prove the status/priority badge pattern:
 *
 *   ● Title Case label
 *
 *   - a colored dot span (h-1.5 w-1.5 shrink-0 rounded-full) before the text
 *   - flex items-center gap-1.5 for vertical centering + consistent spacing
 *   - Title Case labels (Running, Completed, Failed, Queued, Pending,
 *     Cancelled, Low, Medium, High, Critical) — never lowercase
 *   - the same pill pattern for status and priority
 */

import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** A mock host whose tasks carry execution status + priority. */
function makeHost() {
  const tasks = [
    {
      id: "b1",
      title: "Running task",
      status: "in_progress",
      assignee: "Ada",
      projectId: "p1",
      waitingOn: null,
      priority: "high",
      ai: { executionStatus: "running" },
    },
    {
      id: "b2",
      title: "Completed task",
      status: "done",
      assignee: "Grace",
      projectId: "p1",
      waitingOn: null,
      priority: "critical",
      ai: { executionStatus: "completed" },
    },
    {
      id: "b3",
      title: "Failed task",
      status: "review",
      assignee: "Alan",
      projectId: "p2",
      waitingOn: null,
      priority: "low",
      ai: { executionStatus: "failed" },
    },
    {
      id: "b4",
      title: "Queued task",
      status: "todo",
      assignee: "Katherine",
      projectId: "p1",
      waitingOn: null,
      priority: "medium",
      ai: { executionStatus: "queued" },
    },
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

test("status + priority badges render Title Case with a centered dot in the real DOM", async () => {
  // Seed the AI overlay so each task carries an OpenHands execution status.
  // The board rebuilds `task.ai` from this localStorage overlay (ai-overlay.ts),
  // so the mock task's own `ai` field would otherwise be dropped.
  localStorage.setItem(
    "kanban-board.ai-overlay.v1",
    JSON.stringify({
      b1: { executionStatus: "running" },
      b2: { executionStatus: "completed" },
      b3: { executionStatus: "failed" },
      b4: { executionStatus: "queued" },
    }),
  );
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  const html = container.innerHTML;

  // Title Case status labels — the exact strings the user sees.
  assert.match(html, />Running</, "status badge must show Title Case 'Running'");
  assert.match(html, />Completed</, "status badge must show Title Case 'Completed'");
  assert.match(html, />Failed</, "status badge must show Title Case 'Failed'");
  assert.match(html, />Queued</, "status badge must show Title Case 'Queued'");

  // Title Case priority labels.
  assert.match(html, />High</, "priority badge must show Title Case 'High'");
  assert.match(html, />Critical</, "priority badge must show Title Case 'Critical'");
  assert.match(html, />Low</, "priority badge must show Title Case 'Low'");
  assert.match(html, />Medium</, "priority badge must show Title Case 'Medium'");

  // The colored dot span must be present (one per badge).
  const dots = container.querySelectorAll("span.h-1\\.5.w-1\\.5.shrink-0.rounded-full");
  assert.ok(dots.length >= 8, `expected >=8 badge dots (4 status + 4 priority), found ${dots.length}`);

  // Every badge pill must use flex items-center gap-1.5 for vertical centering.
  const pills = container.querySelectorAll("span.flex.items-center.gap-1\\.5.rounded-full");
  assert.ok(pills.length >= 8, `expected >=8 flex-centered badge pills, found ${pills.length}`);

  // No lowercase status/priority label may leak into a badge.
  assert.doesNotMatch(html, />running</, "no lowercase 'running' label");
  assert.doesNotMatch(html, />failed</, "no lowercase 'failed' label");
  assert.doesNotMatch(html, />completed</, "no lowercase 'completed' label");
  assert.doesNotMatch(html, />critical</, "no lowercase 'critical' label");

  cleanup();
  container.remove();
});
