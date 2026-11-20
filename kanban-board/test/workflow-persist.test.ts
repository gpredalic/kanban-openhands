import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn: () => boolean, timeout = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return true;
    await sleep(10);
  }
  return fn();
}

function clickText(container: HTMLElement, text: string) {
  const el = [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
  assert.ok(el, `button ${text} exists`);
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function makeHost(initialTasks: Array<Record<string, unknown>> = []) {
  let tasks = initialTasks.map((task) => ({ ...task }));
  let workflows: Array<Record<string, unknown>> = [];
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let render: RenderFn | null = null;

  const host = {
    apiVersion: "1",
    registerPage(id: string, fn: RenderFn) {
      assert.equal(id, "board");
      render = fn;
      return () => { render = null; };
    },
    agentServer: {
      request: async (opts: { method: string; path: string; body?: unknown }) => {
        calls.push(opts);
        if (opts.method === "GET" && opts.path.includes("/api/file/download")) {
          if (opts.path.includes(encodeURIComponent("/home/razvijalec/.kanban-board/workflows.json"))) {
            return workflows.length === 0 ? "" : workflows;
          }
          return tasks;
        }
        if (opts.method === "POST" && opts.path.includes("/api/file/upload")) {
          const form = opts.body as FormData;
          const file = form?.get("file") as Blob | null;
          if (opts.path.includes(encodeURIComponent("/home/razvijalec/.kanban-board/workflows.json"))) {
            if (file) workflows = JSON.parse(await file.text());
          } else if (file) {
            tasks = JSON.parse(await file.text());
          }
          return {};
        }
        if (opts.path === "/api/agent-profiles") return { profiles: [] };
        return {};
      },
    },
  };

  return {
    host,
    calls,
    getWorkflows: () => workflows,
    trigger: () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      render!({ container, path: "/kanban-board" });
      return container;
    },
  };
}

test("workflow definitions persist across localStorage clear and fresh host remount", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();

  const fixture = makeHost([
    { id: "task-1", title: "Workflow acceptance task", status: "todo", assignee: null, projectId: "default", waitingOn: null },
  ]);
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  clickText(container, "Workflow");
  await waitFor(() => Boolean(container.textContent?.includes("Feature Pipeline") || container.textContent?.includes("No workflows defined")));

  clickText(container, "Create workflow");
  const input = await waitFor(() =>
    Boolean(container.querySelector('input[aria-label="Workflow name"]')),
  ).then(() => container.querySelector('input[aria-label="Workflow name"]') as HTMLInputElement);
  assert.ok(input, "workflow name input exists");
  changeInput(input, "Durable acceptance workflow");
  clickText(container, "Create");

  assert.ok(await waitFor(() => fixture.getWorkflows().some((workflow) =>
    workflow.name === "Durable acceptance workflow",
  )), "created workflow must be uploaded to workflows.json");
  assert.ok(
    fixture.calls.some((call) =>
      call.method === "POST" &&
      call.path.includes(encodeURIComponent("/home/razvijalec/.kanban-board/workflows.json")),
    ),
    "workflow upload must use the workflows file",
  );

  localStorage.clear();
  cleanup();
  container.remove();

  const persisted = fixture.getWorkflows();
  const fresh = makeHost([
    { id: "task-1", title: "Workflow acceptance task", status: "todo", assignee: null, projectId: "default", waitingOn: null },
  ]);
  // Copy the persisted file state into the fresh host before it mounts.
  (fresh.host.agentServer.request as (opts: { method: string; path: string; body?: unknown }) => Promise<unknown>);
  const freshRequest = fresh.host.agentServer.request;
  fresh.host.agentServer.request = async (opts) => {
    if (opts.method === "GET" && opts.path.includes(encodeURIComponent("/home/razvijalec/.kanban-board/workflows.json"))) {
      return persisted;
    }
    return freshRequest(opts);
  };

  const freshCleanup = activate(fresh.host);
  const freshContainer = fresh.trigger();
  await waitFor(() => Boolean(freshContainer.textContent?.includes("Create Task")));
  clickText(freshContainer, "Workflow");
  assert.ok(
    await waitFor(() => freshContainer.textContent?.includes("Durable acceptance workflow")),
    "workflow still exists and renders after localStorage clear and remount",
  );

  freshCleanup();
  freshContainer.remove();
});
