/**
 * probe-delete.test.ts — delete-task acceptance probe.
 *
 * Mounts the REAL built extension.js with a mock host and verifies, exactly as
 * a user would click, that the trash button on a task card actually deletes the
 * task from BOTH the rendered DOM and the persisted file.
 */

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
  return el as HTMLButtonElement;
}

function changeInput(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  assert.ok(input, "input exists before typing");
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function makeHost(initialTasks: Array<Record<string, unknown>> = []) {
  let tasks = initialTasks.map((task) => ({ ...task }));
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
          return tasks;
        }
        if (opts.method === "POST" && opts.path.includes("/api/file/upload")) {
          const form = opts.body as FormData;
          const file = form?.get("file") as Blob | null;
          if (file) tasks = JSON.parse(await file.text());
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
    getTasks: () => tasks,
    trigger: () => {
      const container = document.createElement("div");
      document.body.appendChild(container);
      render!({ container, path: "/kanban-board" });
      return container;
    },
  };
}

test("trash button deletes the task from DOM and persisted file", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();

  const fixture = makeHost();
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  // Create a task through the real modal. The Create button is disabled until
  // both the title and the agent prompt are filled (the prompt is its own
  // required field, never derived from the title).
  clickText(container, "Create Task");
  await waitFor(() => Boolean(container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]')));
  changeInput(container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]') as HTMLInputElement, "Delete me task");
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Delete this task after verifying the trash button works.");
  clickText(container, "Create");

  // The task must appear in the DOM and be persisted.
  assert.ok(await waitFor(() => container.textContent?.includes("Delete me task")), "created task renders");
  assert.ok(fixture.getTasks().some((t) => t.title === "Delete me task"), "created task persisted to file");

  // The trash button must be VISIBLE without hovering (no opacity-0 ancestor).
  const trash = container.querySelector('button[aria-label="Delete task"]') as HTMLButtonElement;
  assert.ok(trash, "trash button exists on the card");
  let node: HTMLElement | null = trash;
  while (node) {
    assert.ok(!node.className.includes("opacity-0"), "trash button must not be hidden behind an opacity-0 ancestor");
    node = node.parentElement;
  }

  trash.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // The task must be gone from the DOM.
  assert.ok(await waitFor(() => !container.textContent?.includes("Delete me task")), "task removed from DOM after delete click");

  // The task must be gone from the persisted file.
  assert.ok(await waitFor(() => !fixture.getTasks().some((t) => t.title === "Delete me task")), "task removed from persisted file after delete click");

  cleanup();
  container.remove();
});

test("detail modal Delete + Confirm Delete removes the task", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();

  const fixture = makeHost();
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  clickText(container, "Create Task");
  await waitFor(() => Boolean(container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]')));
  changeInput(container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]') as HTMLInputElement, "Modal delete task");
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Delete this task through the detail modal.");
  clickText(container, "Create");
  assert.ok(await waitFor(() => container.textContent?.includes("Modal delete task")), "created task renders");

  // Open the detail modal by clicking the pencil (Edit) button on the card.
  const editBtn = container.querySelector('button[aria-label="Edit task"]') as HTMLButtonElement;
  assert.ok(editBtn, "edit (pencil) button exists on the card");
  editBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // The detail modal must render with a Delete button.
  assert.ok(await waitFor(() => Boolean(container.querySelector('button[aria-label="Delete"]')) || container.textContent?.includes("Confirm Delete") || [...container.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Delete")), "detail modal Delete button renders");

  const deleteBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete");
  assert.ok(deleteBtn, "Delete button in detail modal");
  deleteBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  // Confirm the delete.
  assert.ok(await waitFor(() => Boolean([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Confirm Delete"))), "Confirm Delete button appears");
  const confirmBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Confirm Delete") as HTMLButtonElement;
  confirmBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  assert.ok(await waitFor(() => !container.textContent?.includes("Modal delete task")), "task removed from DOM after modal delete");
  assert.ok(await waitFor(() => !fixture.getTasks().some((t) => t.title === "Modal delete task")), "task removed from persisted file after modal delete");

  cleanup();
  container.remove();
});
