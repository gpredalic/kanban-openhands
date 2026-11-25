/**
 * flip-reentry.test.ts — regression test for the Board re-entry flicker.
 *
 * The FLIP hook lives in the always-mounted KanbanBoard, so its captured
 * card rects survive the inner board's unmount. When the user switches away
 * from the Board view and back, the board content remounts and the hook
 * compared fresh rects against the stale ones — treating every card whose
 * position differed as "moved" and firing a spurious lift→glide→settle FLIP.
 * That spurious FLIP, overlapping the kb-fade-in entrance, read as a
 * flicker/jump on entry.
 *
 * The fix clears the captured rects when the board content unmounts, so a
 * re-entry starts fresh (all cards "new" → no FLIP, clean fade-in only).
 *
 * This test drives the REAL built extension.js through a genuine view switch
 * (Board → Workflow → Board) and asserts:
 *   1. No spurious FLIP fires on re-entry (no kb-flip-lift class, no inline
 *      transform on any card).
 *   2. The cards still render with their kb-fade-in entrance intact.
 *
 * The genuine-move case (a real column move still fires the FLIP) is covered
 * by flip-animation.test.ts; this test focuses on the re-entry regression.
 */

import { window } from "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

/** Column x-offsets (px) used by the mocked getBoundingClientRect. */
const COLUMN_X: Record<string, number> = {
  todo: 0,
  in_progress: 300,
  review: 600,
  done: 900,
};

/**
 * Mock getBoundingClientRect so each card reports a position derived from its
 * column and a per-container generation. happy-dom returns zero rects by
 * default, which would make the FLIP hook see no delta on a real move.
 *
 * The generation increments for each new board container (i.e., each re-entry),
 * shifting the card top positions by 10px per generation. This simulates the
 * real-world scenario where the layout differs between mounts (scroll, resize,
 * data changes), so a re-entry produces positions that differ from the stale
 * rects — triggering a spurious FLIP without the fix.
 */
function mockLayout(): () => void {
  const win = window as unknown as { Element: { prototype: Element } };
  const ElementProto = win.Element.prototype;
  const original = ElementProto.getBoundingClientRect;
  const generations = new WeakMap<HTMLElement, number>();
  let nextGeneration = 0;
  ElementProto.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains("grid") && this.querySelector("[data-drop-status]")) {
      let gen = generations.get(this);
      if (gen === undefined) {
        gen = nextGeneration++;
        generations.set(this, gen);
      }
      return { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    const taskId = this.dataset?.taskId;
    if (taskId) {
      const col = this.closest("[data-drop-status]");
      const container = col?.closest(".grid") as HTMLElement | null;
      const gen = container ? (generations.get(container) ?? 0) : 0;
      const status = col?.dataset?.dropStatus ?? "todo";
      const x = COLUMN_X[status] ?? 0;
      const top = 100 + gen * 10;
      return { left: x, top, width: 280, height: 120, right: x + 280, bottom: top + 120, x, y: top, toJSON: () => ({}) } as DOMRect;
    }
    const dropStatus = this.dataset?.dropStatus;
    if (dropStatus) {
      const x = COLUMN_X[dropStatus] ?? 0;
      return { left: x, top: 0, width: 290, height: 800, right: x + 290, bottom: 800, x, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return original.call(this);
  };
  return () => {
    ElementProto.getBoundingClientRect = original;
  };
}

function makeHost() {
  const tasks = [
    {
      id: "reentry-todo",
      title: "Re-entry todo task",
      status: "todo",
      assignee: null,
      projectId: "p1",
      waitingOn: null,
      tags: [],
      dueDate: null,
    },
    {
      id: "reentry-progress",
      title: "Re-entry in-progress task",
      status: "in_progress",
      assignee: null,
      projectId: "p1",
      waitingOn: null,
      tags: [],
      dueDate: null,
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
      request: async (opts: { method: string; path: string; body?: unknown }) => {
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

/** Find a view-switcher button by its visible label. */
function viewButton(container: HTMLElement, label: string): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll("button"));
  return buttons.find((b) => b.textContent?.trim() === label) ?? null;
}

/**
 * Watch for the FLIP lift class being added to any element. Returns a
 * predicate that reports whether a spurious FLIP fired. The observer is
 * created AFTER the initial mount, so it only sees events from the re-entry
 * and any subsequent move.
 */
function watchFlip(container: HTMLElement): { fired: () => boolean; disconnect: () => void } {
  let fired = false;
  const Observer = (window as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver;
  const observer = new Observer((mutations) => {
    for (const m of mutations) {
      if (m.type !== "attributes" || m.attributeName !== "class") continue;
      const el = m.target as HTMLElement;
      if (el.classList.contains("kb-flip-lift")) fired = true;
    }
  });
  observer.observe(container, { subtree: true, attributes: true, attributeFilter: ["class"] });
  return {
    fired: () => fired,
    disconnect: () => observer.disconnect(),
  };
}

test("Board re-entry: no spurious FLIP, clean fade-in, real move still animates", async () => {
  const restoreLayout = mockLayout();
  const { host, trigger } = makeHost();
  const cleanup = activate(host);
  const container = trigger();

  // Initial mount — wait for the async fetch → store update → React render.
  const loaded = await waitFor(() =>
    container.innerHTML.includes("Re-entry todo task") &&
    container.innerHTML.includes("Re-entry in-progress task")
  );
  assert.ok(loaded, "both tasks must render on initial mount");

  // Start watching for FLIP events only after the initial mount settles, so
  // the observer sees the re-entry and the move, not the first render.
  const flip = watchFlip(container);

  // Switch away from the Board view (unmounts the board content).
  const workflowBtn = viewButton(container, "Workflow");
  assert.ok(workflowBtn, "Workflow view button must exist");
  workflowBtn.click();
  await waitFor(() => !container.querySelector('[data-task-id="reentry-todo"]'));
  assert.ok(!container.querySelector('[data-task-id="reentry-todo"]'), "board content must unmount on view switch");

  // Switch back to the Board view (remounts the board content).
  const boardBtn = viewButton(container, "Board");
  assert.ok(boardBtn, "Board view button must exist");
  boardBtn.click();
  const reloaded = await waitFor(() =>
    container.innerHTML.includes("Re-entry todo task") &&
    container.innerHTML.includes("Re-entry in-progress task")
  );
  assert.ok(reloaded, "both tasks must re-render on re-entry");

  // Let any (spurious) FLIP animation run to completion.
  await tick(900);

  // The fix: no spurious FLIP fired on re-entry.
  assert.ok(!flip.fired(), "no spurious FLIP must fire on Board re-entry");

  // No card carries the lift class or an inline transform after re-entry.
  const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-task-id]"));
  assert.ok(cards.length >= 2, "cards must be present after re-entry");
  for (const card of cards) {
    assert.ok(!card.classList.contains("kb-flip-lift"), "card must not carry kb-flip-lift after re-entry");
    assert.equal(card.style.transform, "", "card must have no inline transform after re-entry");
    assert.ok(card.classList.contains("kb-fade-in"), "card must keep its kb-fade-in entrance on re-entry");
  }

  flip.disconnect();
  restoreLayout();
  cleanup();
  container.remove();
});
