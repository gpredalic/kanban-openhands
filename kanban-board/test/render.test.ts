/**
 * render.test.ts — headless render test against the REAL built artifact.
 *
 * This is the PoC validation: it imports the self-contained `extension.js`
 * (the exact file Agent Canvas loads), calls `activate(host)` with a mock host,
 * triggers the page render, and asserts the React tree actually mounts and
 * renders the premium board UI (header, stats, filters, columns, task cards).
 *
 * It proves the React + Tailwind bundle is a valid, self-contained Canvas
 * Extension with a working `activate(host)` entrypoint and no incompatible
 * runtime chunks.
 */

import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** A mock host that returns a fixed set of demo tasks. */
function makeHost() {
  const tasks = [
    {
      id: "t1",
      title: "Design the onboarding flow",
      status: "todo",
      assignee: "Ada Lovelace",
      projectId: "p1",
      waitingOn: null,
      tags: ["design", "ux"],
      dueDate: "2026-12-01",
    },
    {
      id: "t2",
      title: "Implement auth middleware",
      status: "in_progress",
      assignee: "Grace Hopper",
      projectId: "p1",
      waitingOn: null,
      tags: ["backend"],
      dueDate: "2026-11-25",
    },
    {
      id: "t3",
      title: "Review payment integration PR",
      status: "review",
      assignee: "Alan Turing",
      projectId: "p2",
      waitingOn: null,
      tags: ["review"],
      dueDate: null,
    },
    {
      id: "t4",
      title: "Ship v2.0 release notes",
      status: "done",
      assignee: "Katherine Johnson",
      projectId: "p1",
      waitingOn: null,
      tags: ["release"],
      dueDate: "2026-11-10",
    },
  ];

  let render: RenderFn | null = null;

  const host = {
    apiVersion: "1",
    registerPage(id: string, fn: RenderFn) {
      assert.equal(id, "board");
      render = fn;
      return () => {
        render = null;
      };
    },
    agentServer: {
      request: async (opts: { method: string; path: string; body?: unknown }) => {
        // The board persists tasks via the agent-server file API (see
        // task-store.ts). Serve the demo tasks from the download endpoint so
        // the headless render test exercises the real data path.
        if (opts.method === "GET" && opts.path.startsWith("/api/file/download")) {
          return tasks;
        }
        return {};
      },
    },
  };

  return {
    host,
    /** Invoke the registered render fn into a fresh container. */
    trigger: () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      render!({ container, path: "/kanban-board" });
      return container;
    },
  };
}

/** Await a macrotask so React 18's concurrent render + async data load flush. */
async function tick(ms = 0): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Poll until `predicate` is true or `timeoutMs` elapses. Returns whether it succeeded. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await tick(10);
  }
  return predicate();
}

test("activate(host) registers the board page and renders the React tree", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  assert.equal(typeof cleanup, "function", "activate must return a cleanup function");

  const container = trigger();
  // Wait for the async fetch → store update → React re-render to flush.
  const loaded = await waitFor(() => container.innerHTML.includes("Design the onboarding flow"));
  assert.ok(loaded, "task data must load and render");

  const html = container.innerHTML;
  assert.ok(html.length > 0, "container must contain rendered markup");
  assert.match(html, /Kanban Board/, "page title must render");
  assert.match(html, /Total Tasks/, "Total Tasks metric must render");
  assert.match(html, /In Progress/, "In Progress metric must render");
  assert.match(html, /Review/, "Review metric must render");
  assert.match(html, /Completed/, "Completed metric must render");
  assert.match(html, /Create Task/, "create button must render");
  assert.match(html, /Design the onboarding flow/, "todo task card must render");
  assert.match(html, /Implement auth middleware/, "in-progress task card must render");
  assert.match(html, /Review payment integration PR/, "review task card must render");
  assert.match(html, /Ship v2\.0 release notes/, "done task card must render");
  // Column-local "+ Add Task" cards were removed: task creation is a single
  // entry point (the header's "Create Task" button). No column may offer its
  // own creation affordance.
  assert.doesNotMatch(html, /Add Task/, "column-local add-task card must not render");

  // The header must render the Kanban AI icon (the same asset the manifest
  // references), not the old placeholder square. The SVG is inlined as a
  // data URL by Vite, so the <img> carries a data:image/svg src and the
  // "Kanban AI" alt text.
  const headerImg = container.querySelector("header img[alt='Kanban AI']");
  assert.ok(headerImg, "header must render the Kanban AI icon");
  assert.match(String(headerImg?.getAttribute("src")), /^data:image\/svg/, "icon must be an inlined SVG data URL");

  // The inlined Tailwind CSS must be present in the document head.
  const styleTag = document.head.querySelector("style");
  assert.ok(styleTag, "inlined <style> tag must exist");
  assert.match(String(styleTag?.textContent), /rounded-lg/, "Tailwind utilities must be inlined");

  cleanup();
  container.remove();
});

test("cleanup unmounts the React root and clears the container", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();
  const loaded = await waitFor(() => container.innerHTML.length > 0);
  assert.ok(loaded, "container rendered before cleanup");

  cleanup();
  await tick(20);
  assert.equal(container.innerHTML, "", "cleanup must unmount the React tree");
  container.remove();
});
