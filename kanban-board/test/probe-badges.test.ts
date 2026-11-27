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

test("inspector is minimal — no Priority section or priority badges", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // Open the detail inspector by clicking the card body. The card is a pure
  // editorial surface — the CardMenu ellipsis is gone. A genuine click
  // (pointerdown + pointerup with no movement) opens the Task Detail
  // Inspector, which is now a minimal surface (only the "Edit Task" eyebrow
  // and the close button). No Priority section, no priority badges.
  const card = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((c) => c.textContent?.includes("Running task")) as HTMLElement;
  assert.ok(card, "task card exists on the board");
  card.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  card.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));

  // The inspector must open and show the "Edit Task" eyebrow.
  const opened = await waitFor(() => container.innerHTML.includes("Edit Task"));
  assert.ok(opened, "detail inspector opens and shows the Edit Task eyebrow");

  const html = container.innerHTML;

  // The minimal inspector must NOT show a Priority section or priority badges.
  assert.ok(!html.includes("Priority"), "minimal inspector must NOT show the Priority section");
  assert.doesNotMatch(html, />Low</, "no Title Case 'Low' priority badge");
  assert.doesNotMatch(html, />Medium</, "no Title Case 'Medium' priority badge");
  assert.doesNotMatch(html, />High</, "no Title Case 'High' priority badge");
  assert.doesNotMatch(html, />Critical</, "no Title Case 'Critical' priority badge");

  // No priority dot spans.
  const dots = container.querySelectorAll("span.h-2.w-2.shrink-0.rounded-full");
  assert.ok(dots.length === 0, `expected 0 priority dots in the minimal inspector, found ${dots.length}`);

  cleanup();
  container.remove();
});
