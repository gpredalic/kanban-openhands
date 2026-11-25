import { test } from "node:test";
import assert from "node:assert";
import "./setup";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** Demo tasks covering every status and priority value. */
const tasks = [
  { id: "t1", title: "Running task", status: "in_progress", assignee: null, projectId: "p1", waitingOn: null, tags: [], dueDate: null, priority: "high" },
  { id: "t2", title: "Failed task", status: "todo", assignee: null, projectId: "p1", waitingOn: null, tags: [], dueDate: null, priority: "critical" },
  { id: "t3", title: "Completed task", status: "done", assignee: null, projectId: "p1", waitingOn: null, tags: [], dueDate: null, priority: "low" },
  { id: "t4", title: "Pending task", status: "review", assignee: null, projectId: "p1", waitingOn: null, tags: [], dueDate: null, priority: "medium" },
];

function makeHost() {
  let render: RenderFn | null = null;
  const host = {
    apiVersion: "1",
    registerPage(id: string, fn: RenderFn) {
      render = fn;
      return () => { render = null; };
    },
    agentServer: {
      request: async (opts: { method: string; path: string }) => {
        if (opts.method === "GET" && opts.path.startsWith("/api/file/download")) return tasks;
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

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return predicate();
}

test("Status + Priority badges: Title Case, colored dot, flex-centered", async () => {
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();

  const loaded = await waitFor(() => container.innerHTML.includes("Running task"));
  assert.ok(loaded, "tasks must load and render");

  // 1. The shared Badge pill pattern must be present in the DOM.
  const badgePills = container.querySelectorAll("span[class*='flex items-center gap-1.5 rounded-full px-2.5 py-0.5']");
  assert.ok(badgePills.length >= 4, `expected >=4 badge pills (4 priority badges minimum), found ${badgePills.length}`);

  // 2. Every badge pill must contain a dot that is vertically centered (flex items-center).
  let pillsWithDot = 0;
  badgePills.forEach((pill) => {
    const dot = pill.querySelector("span[class*='h-1.5 w-1.5 shrink-0 rounded-full']");
    if (dot) pillsWithDot++;
  });
  assert.strictEqual(pillsWithDot, badgePills.length, "every badge pill must contain a centered dot");

  // 3. Title Case labels must render for every priority value.
  const text = container.textContent ?? "";
  for (const label of ["Low", "Medium", "High", "Critical"]) {
    assert.ok(text.includes(label), `priority label "${label}" must be Title Case in the DOM`);
  }

  // 4. No lowercase raw values may leak into badge text.
  const badgeTexts = Array.from(badgePills).map((p) => p.textContent?.trim() ?? "");
  for (const t of badgeTexts) {
    assert.ok(!/^(low|medium|high|critical|running|failed|completed|pending|queued|cancelled)$/.test(t), `badge text must be Title Case, got "${t}"`);
  }

  console.log(`Badge pills: ${badgePills.length}, all with centered dot: ${pillsWithDot}`);
  console.log(`Sample badge texts: ${badgeTexts.slice(0, 6).join(" | ")}`);

  cleanup();
  container.remove();
});
