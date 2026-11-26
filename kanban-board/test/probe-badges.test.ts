/**
 * probe-badges.test.ts — headless probe of the REAL built artifact.
 *
 * Mounts the self-contained `extension.js` (the exact file Agent Canvas loads),
 * opens the task detail modal, and inspects the actual rendered DOM to prove the
 * badge system survives the build:
 *
 *   ● Title Case label
 *
 *   - a colored dot before the text
 *   - Title Case labels (Low, Medium, High, Critical) — never lowercase
 *
 * The task card no longer renders badges (status is communicated by the column,
 * priority lives in the detail modal), so the real-DOM badge surface is the
 * detail modal's priority selector, which renders every priority value through
 * the shared PRIORITY_STYLES map. The shared <Badge> pill component itself is
 * covered by verify-badges.test.ts.
 */

import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** A mock host whose tasks carry a priority. */
function makeHost() {
  const tasks = [
    { id: "b1", title: "Running task", status: "in_progress", assignee: "Ada", projectId: "p1", waitingOn: null, priority: "high" },
    { id: "b2", title: "Completed task", status: "done", assignee: "Grace", projectId: "p1", waitingOn: null, priority: "critical" },
    { id: "b3", title: "Failed task", status: "review", assignee: "Alan", projectId: "p2", waitingOn: null, priority: "low" },
    { id: "b4", title: "Queued task", status: "todo", assignee: "Katherine", projectId: "p1", waitingOn: null, priority: "medium" },
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

test("detail modal renders Title Case priority badges with a centered dot in the real DOM", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // Open the detail modal by clicking the Edit button on the first card. The
  // button is hover-revealed (opacity-0 at rest) but remains in the DOM and
  // clickable, so a programmatic click opens the modal.
  const edit = container.querySelector('button[aria-label="Edit task"]') as HTMLButtonElement;
  assert.ok(edit, "Edit button exists on the card");
  edit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // The modal must open and render the priority selector.
  const opened = await waitFor(() => container.innerHTML.includes("Priority"));
  assert.ok(opened, "detail modal opens and shows the Priority section");

  const html = container.innerHTML;

  // Title Case priority labels — the exact strings the user sees.
  assert.match(html, />Low</, "priority badge must show Title Case 'Low'");
  assert.match(html, />Medium</, "priority badge must show Title Case 'Medium'");
  assert.match(html, />High</, "priority badge must show Title Case 'High'");
  assert.match(html, />Critical</, "priority badge must show Title Case 'Critical'");

  // The colored dot span must be present (one per priority level).
  const dots = container.querySelectorAll("span.h-2.w-2.shrink-0.rounded-full");
  assert.ok(dots.length >= 4, `expected >=4 priority dots, found ${dots.length}`);

  // No lowercase priority label may leak into a badge.
  assert.doesNotMatch(html, />low</, "no lowercase 'low' label");
  assert.doesNotMatch(html, />medium</, "no lowercase 'medium' label");
  assert.doesNotMatch(html, />high</, "no lowercase 'high' label");
  assert.doesNotMatch(html, />critical</, "no lowercase 'critical' label");

  cleanup();
  container.remove();
});
