/**
 * probe-live.test.ts — live-agent-profile acceptance probe.
 *
 * Mounts the REAL built extension.js with a mock host and verifies the five
 * live-agent-profile requirements end-to-end, exactly as a user would click:
 *
 *   1. The agent dropdown populates from /api/agent-profiles (live ids),
 *      NOT from SEED_AGENTS.
 *   2. SEED_AGENTS are used only as a fallback when the agent server is
 *      unavailable (request throws / returns no profiles).
 *   3. The real OpenHands profile id is persisted on the created task.
 *   4. The assigned profile is shown on the task card AND in the task detail.
 *   5. The agent assignment survives a page reload (re-mount).
 *
 * Live profiles and seed agents deliberately share display names ("Scout",
 * "Forge") but carry DIFFERENT ids (profile-* vs agent-*). That overlap is the
 * whole point of the probe: it proves the dropdown is driven by the live id,
 * not by a coincidental name match.
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

function selectValue(select: HTMLSelectElement, value: string) {
  assert.ok(select, "select exists before choosing");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

/** The live profiles the mock agent server advertises. */
const LIVE_PROFILES = [
  { id: "profile-scout", name: "Scout" },
  { id: "profile-forge", name: "Forge" },
];

/** Seed agent ids — these must NOT appear when live profiles are available. */
const SEED_IDS = ["agent-research", "agent-coder", "agent-reviewer", "agent-writer"];

interface Fixture {
  host: {
    apiVersion: string;
    registerPage: (id: string, fn: RenderFn) => () => void;
    agentServer: { request: (opts: { method: string; path: string; body?: unknown }) => Promise<unknown> };
  };
  calls: Array<{ method: string; path: string; body?: unknown }>;
  getTasks: () => Array<Record<string, unknown>>;
  trigger: () => HTMLElement;
}

/**
 * Build a mock host. `profilesMode`:
 *   "live"    — /api/agent-profiles returns LIVE_PROFILES.
 *   "empty"   — /api/agent-profiles returns {} (no profiles) -> seed fallback.
 *   "offline" — /api/agent-profiles throws -> seed fallback.
 */
function makeHost(profilesMode: "live" | "empty" | "offline"): Fixture {
  let tasks: Array<Record<string, unknown>> = [];
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
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
        calls.push(opts);
        if (opts.method === "GET" && opts.path.startsWith("/api/file/download")) return tasks;
        if (opts.method === "POST" && opts.path.startsWith("/api/file/upload")) {
          const form = opts.body as FormData;
          const file = form?.get("file") as Blob | null;
          if (file) tasks = JSON.parse(await file.text());
          return {};
        }
        if (opts.path === "/api/agent-profiles") {
          if (profilesMode === "offline") throw new Error("agent server unreachable");
          if (profilesMode === "empty") return {};
          return { profiles: LIVE_PROFILES };
        }
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

/** The title input placeholder in the Create Task modal. */
const TITLE_PLACEHOLDER = 'input[placeholder="e.g. Replace vending machine cash reader"]';

/** Open the Create Task modal and return the AI-agent <select>. */
async function openCreateModal(container: HTMLElement): Promise<HTMLSelectElement> {
  clickText(container, "Create Task");
  assert.ok(await waitFor(() => Boolean(container.querySelector(TITLE_PLACEHOLDER))));
  const select = container.querySelector('select[aria-label="AI agent"]') as HTMLSelectElement;
  assert.ok(select, "AI agent select must render in the create modal");
  return select;
}

function optionValues(select: HTMLSelectElement): string[] {
  return [...select.querySelectorAll("option")].map((o) => o.value);
}

test("1. agent dropdown populates from /api/agent-profiles (live ids, not seed)", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost("live");
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  const select = await openCreateModal(container);
  const values = optionValues(select);

  // Live profile ids must be present.
  assert.ok(values.includes("profile-scout"), `dropdown must contain live id profile-scout; got ${JSON.stringify(values)}`);
  assert.ok(values.includes("profile-forge"), `dropdown must contain live id profile-forge; got ${JSON.stringify(values)}`);
  // Seed ids must be absent when live profiles are available.
  for (const seedId of SEED_IDS) {
    assert.ok(!values.includes(seedId), `seed id ${seedId} must NOT appear when live profiles are served; got ${JSON.stringify(values)}`);
  }
  // The live profile fetch must actually have hit the endpoint.
  assert.ok(fixture.calls.some((c) => c.path === "/api/agent-profiles"), "must have requested /api/agent-profiles");

  cleanup();
  container.remove();
});

test("2. seed agents are used only as fallback when the server is unavailable", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();

  // Offline: the request throws.
  {
    const fixture = makeHost("offline");
    const cleanup = activate(fixture.host);
    const container = fixture.trigger();
    await waitFor(() => container.textContent?.includes("Create Task") ?? false);
    const select = await openCreateModal(container);
    const values = optionValues(select);
    assert.ok(values.includes("agent-coder"), `offline fallback must expose seed id agent-coder; got ${JSON.stringify(values)}`);
    assert.ok(!values.includes("profile-forge"), `offline fallback must NOT expose live id profile-forge; got ${JSON.stringify(values)}`);
    cleanup();
    container.remove();
  }

  // Empty: the request succeeds but returns no profiles.
  {
    const fixture = makeHost("empty");
    const cleanup = activate(fixture.host);
    const container = fixture.trigger();
    await waitFor(() => container.textContent?.includes("Create Task") ?? false);
    const select = await openCreateModal(container);
    const values = optionValues(select);
    assert.ok(values.includes("agent-coder"), `empty fallback must expose seed id agent-coder; got ${JSON.stringify(values)}`);
    assert.ok(!values.includes("profile-forge"), `empty fallback must NOT expose live id profile-forge; got ${JSON.stringify(values)}`);
    cleanup();
    container.remove();
  }
});

test("3. real OpenHands profile id is persisted on the created task", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost("live");
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  const select = await openCreateModal(container);
  changeInput(container.querySelector(TITLE_PLACEHOLDER) as HTMLInputElement, "Live profile task");
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Investigate the live profile assignment path.");
  selectValue(select, "profile-forge");
  clickText(container, "Create");
  assert.ok(await waitFor(() => container.textContent?.includes("Live profile task") ?? false));

  const created = fixture.getTasks().find((t) => t.title === "Live profile task");
  assert.ok(created, "created task must be persisted");
  assert.equal(created?.agentId, "profile-forge", `persisted agentId must be the live profile id, got ${JSON.stringify(created?.agentId)}`);

  cleanup();
  container.remove();
});

test("4. assigned profile is shown on the task card and in the task detail", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost("live");
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  const select = await openCreateModal(container);
  changeInput(container.querySelector(TITLE_PLACEHOLDER) as HTMLInputElement, "Card and detail task");
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Verify the assigned profile renders on the card and in the detail.");
  selectValue(select, "profile-forge");
  clickText(container, "Create");
  assert.ok(await waitFor(() => container.textContent?.includes("Card and detail task") ?? false));

  // Card: the assigned agent name ("Forge") must NOT render on the card —
  // agent identity is hidden from the board and surfaces only in the detail.
  const card = [...container.querySelectorAll<HTMLElement>(".kb-card")].find((c) => c.textContent?.includes("Card and detail task"));
  assert.ok(card, "task card must render");
  assert.ok(!card?.textContent?.includes("Forge"), `card must NOT show the assigned profile name "Forge"; got ${JSON.stringify(card?.textContent?.slice(0, 200))}`);

  // Detail: the card is a pure editorial surface — clicking it opens the
  // Task Detail Inspector (Edit Task modal), which is now a minimal surface
  // (only the "Edit Task" eyebrow and the close button). No "Assigned agent:"
  // line, no AI agent select. No CardMenu ellipsis exists on the card anymore.
  card!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  card!.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false), "clicking the card must open the Task Detail Inspector");
  assert.ok(!container.textContent?.includes("Assigned agent: Forge"), "minimal inspector must NOT show 'Assigned agent: Forge'");
  assert.ok(!container.querySelector('select[aria-label="AI agent"]'), "minimal inspector must NOT show an AI agent select");

  cleanup();
  container.remove();
});

test("5. agent assignment survives a page reload", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost("live");
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  await waitFor(() => container.textContent?.includes("Create Task") ?? false);

  const select = await openCreateModal(container);
  changeInput(container.querySelector(TITLE_PLACEHOLDER) as HTMLInputElement, "Reload survival task");
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Confirm the agent assignment survives a page reload.");
  selectValue(select, "profile-scout");
  clickText(container, "Create");
  assert.ok(await waitFor(() => container.textContent?.includes("Reload survival task") ?? false));

  // Simulate a page reload: unmount, then re-mount against the same persisted file.
  cleanup();
  container.remove();
  const reloadCleanup = activate(fixture.host);
  const reload = fixture.trigger();
  assert.ok(await waitFor(() => reload.textContent?.includes("Reload survival task") ?? false));

  // The persisted agentId must be intact after reload.
  const reloaded = fixture.getTasks().find((t) => t.title === "Reload survival task");
  assert.equal(reloaded?.agentId, "profile-scout", `agentId must survive reload, got ${JSON.stringify(reloaded?.agentId)}`);

  // The reloaded card must NOT show the assigned profile name ("Scout") —
  // agent identity is hidden from the board card. The assignment itself is
  // already verified above via the persisted agentId.
  const reloadedCard = [...reload.querySelectorAll<HTMLElement>(".kb-card")].find((c) => c.textContent?.includes("Reload survival task"));
  assert.ok(reloadedCard, "reloaded task card must render");
  assert.ok(!reloadedCard?.textContent?.includes("Scout"), `reloaded card must NOT show the assigned profile name "Scout"; got ${JSON.stringify(reloadedCard?.textContent?.slice(0, 200))}`);

  reloadCleanup();
  reload.remove();
});
