import "./setup";
import { test } from "node:test";
import assert from "node:assert/strict";
import { activate } from "../extension.js";

type RenderFn = (ctx: { container: HTMLElement; path: string }) => void;

const initialTasks = [
  { id: "t1", title: "Design the onboarding flow", status: "todo", assignee: "Ada Lovelace", projectId: "p1", waitingOn: null, tags: ["design", "ux"], dueDate: "2026-12-01" },
  { id: "t2", title: "Implement auth middleware", status: "in_progress", assignee: "Grace Hopper", projectId: "p1", waitingOn: null, tags: ["backend"], dueDate: "2026-11-25" },
  { id: "t3", title: "Review payment integration PR", status: "review", assignee: "Alan Turing", projectId: "p2", waitingOn: null, tags: ["review"], dueDate: null },
  { id: "t4", title: "Ship v2.0 release notes", status: "done", assignee: "Katherine Johnson", projectId: "p1", waitingOn: null, tags: ["release"], dueDate: "2026-11-10" },
];

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
  assert.ok(el, `button "${text}" exists`);
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

function makeHost() {
  let tasks = initialTasks.map((task) => ({ ...task }));
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  let render: RenderFn | null = null;
  let conversationCounter = 0;
  const conversations: Array<Record<string, unknown>> = [];
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
        if (opts.method === "GET" && opts.path.startsWith("/api/file/download")) return tasks;
        if (opts.method === "POST" && opts.path.startsWith("/api/file/upload")) {
          const form = opts.body as FormData;
          const file = form?.get("file") as Blob | null;
          if (file) tasks = JSON.parse(await file.text());
          return {};
        }
        if (opts.path === "/api/agent-profiles") {
          return { profiles: [{ id: "profile-scout", name: "Scout" }, { id: "profile-forge", name: "Forge" }] };
        }
        if (opts.path.startsWith("/api/conversations/search")) return { conversations };
        if (opts.method === "POST" && opts.path === "/api/conversations") {
          conversationCounter += 1;
          const id = `conversation-${conversationCounter}`;
          const body = opts.body as Record<string, unknown> | undefined;
          const tags = body?.tags as Record<string, unknown> | undefined;
          conversations.push({
            id,
            title: (body?.initial_message as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? "OpenHands conversation",
            tags: tags ?? {},
            execution_status: "running",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return { id };
        }
        // Faithful to the real server: interrupting a conversation transitions it
        // out of "running" so the state-driven Run AI / Stop AI toggle can return
        // to start mode on the next poll.
        if (opts.method === "POST" && /\/api\/conversations\/[^/]+\/interrupt$/.test(opts.path)) {
          const id = opts.path.split("/")[3];
          const conv = conversations.find((c) => c.id === id);
          if (conv) conv.execution_status = "cancelled";
          return {};
        }
        if (opts.path.includes("/ask_agent")) return { response: "Relay response from mock agent" };
        if (opts.path.includes("/children")) return { conversation_id: "child-1", status: "running" };
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

test("full user-acceptance sweep: every button and interaction works", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost();
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  assert.ok(await waitFor(() => container.textContent?.includes("Design the onboarding flow") ?? false), "board loads with initial tasks");

  // 1. CREATE TASK — the title is the business identifier and the agent prompt
  // is its own required field (never derived from the title). The Create button
  // stays disabled until both are filled.
  clickText(container, "Create Task");
  assert.ok(await waitFor(() => Boolean(container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]'))), "create form opens");
  const createTitle = container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]') as HTMLInputElement;
  changeInput(createTitle, "Acceptance created task");
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Acceptance sweep: verify the task-centric execution flow.");
  clickText(container, "Create");
  assert.ok(await waitFor(() => container.textContent?.includes("Acceptance created task") ?? false), "created task visible on board");
  assert.ok(fixture.getTasks().some((t) => t.title === "Acceptance created task"), "created task persisted to file");

  // 2. EDIT TASK — clicking the card opens the Task Detail Inspector directly.
  // The card is a pure editorial surface at rest: no ellipsis, no menu.
  // Edit a pre-existing task (not the one we just created) so the created task
  // stays available for the drag + persistence steps below.
  const editCard = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("Design the onboarding flow")) as HTMLElement;
  assert.ok(editCard, "task card found on board");
  editCard.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  editCard.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false), "Task Detail Inspector opens on card click");
  const editTitle = container.querySelector('input[type="text"]') as HTMLInputElement;
  changeInput(editTitle, "Acceptance edited task");
  clickText(container, "Save");
  assert.ok(await waitFor(() => fixture.getTasks().some((t) => t.title === "Acceptance edited task") ?? false), "edited title persisted");
  assert.ok(container.textContent?.includes("Acceptance edited task"), "edited title visible on board");

  // 3. DELETE TASK — open the Inspector again, click Delete, then Confirm Delete.
  const deleteCard = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("Acceptance edited task")) as HTMLElement;
  assert.ok(deleteCard, "edited task card found on board");
  deleteCard.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  deleteCard.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false), "Task Detail Inspector opens for delete");
  clickText(container, "Delete");
  // React 18 batches the setConfirmDelete(true) update; the "Confirm Delete"
  // button only appears after React flushes the re-render. A real user sees the
  // button appear before clicking it, so wait for it rather than clicking
  // synchronously (which would query the DOM before the flush).
  assert.ok(await waitFor(() => Boolean([...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Confirm Delete"))), "Confirm Delete button appears after Delete");
  clickText(container, "Confirm Delete");
  // after delete, the edited task should be gone from the persisted file
  assert.ok(await waitFor(() => !fixture.getTasks().some((t) => t.title === "Acceptance edited task") ?? false), "deleted task removed from persisted file");

  // 4. MOVE TASK between columns (drag)
  const dragCard = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("Acceptance created task")) as HTMLElement;
  const inProgressColumn = container.querySelector('[data-drop-status="in_progress"]') as HTMLElement;
  assert.ok(dragCard && inProgressColumn, "drag card and target column found");
  dragCard.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  dragCard.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
  inProgressColumn.dispatchEvent(new window.MouseEvent("pointerover", { bubbles: true, clientX: 200, clientY: 200 }));
  inProgressColumn.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 200 }));
  assert.ok(await waitFor(() => fixture.getTasks().find((t) => t.title === "Acceptance created task")?.status === "in_progress" ?? false), "dragged task status changed to in_progress");
  assert.ok([...container.querySelectorAll<HTMLElement>("[data-drop-status='in_progress']")].some((column) => column.textContent?.includes("Acceptance created task")), "dragged task rendered in In Progress column");

  // 5. PERSISTENCE after refresh
  cleanup();
  container.remove();
  const reloadCleanup = activate(fixture.host);
  const reload = fixture.trigger();
  assert.ok(await waitFor(() => reload.textContent?.includes("Acceptance created task") ?? false), "created task survives reload");
  assert.ok(fixture.getTasks().find((t) => t.title === "Acceptance created task")?.status === "in_progress", "moved status survives reload");

  // 6. SEARCH — the board header no longer carries a search field or a Filter
  // control. The user removed both so the masthead stays focused on the work.
  assert.ok(reload.querySelector('input[aria-label="Search tasks"]') === null, "board search input is gone");
  assert.ok(reload.querySelector('button[aria-label="Filter"]') === null, "board filter control is gone");

  // 7. NOTIFICATIONS — the notification icon and its panel were removed from
  // the header; no notification button or surface may remain.
  assert.ok(reload.querySelector('button[aria-label="Notifications"]') === null, "notification button is gone");
  assert.ok(reload.querySelector('[aria-label="Notification surface"]') === null, "notification surface is gone");

  // 8. RUN AI — execution is now task-centric: the header no longer carries a
  // global Run AI / Stop AI toggle. The Run / Stop / Retry actions live in the
  // task detail modal (moved off the card). Opening a task's detail modal and
  // clicking Run posts a fresh OpenHands conversation for THAT task only, and
  // the button flips to Stop once the run is live.
  clickText(reload, "Board");
  // The card is a pure editorial surface at rest — no ellipsis, no menu.
  // Clicking the card opens the Task Detail Inspector directly, which carries
  // the Run / Stop / Retry actions.
  const runCard = [...reload.querySelectorAll<HTMLElement>("[data-task-id]")][0] as HTMLElement;
  assert.ok(runCard, "a task card is present on the board");
  runCard.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  runCard.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => reload.textContent?.includes("Edit Task") ?? false), "Task Detail Inspector opens on card click");
  assert.ok(await waitFor(() => Boolean(reload.querySelector('button[aria-label="Run this task"]')) ?? false, 2000), "Run AI button present in the task detail modal");
  const taskRunBtn = reload.querySelector('button[aria-label="Run this task"]') as HTMLButtonElement;
  taskRunBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => Boolean(reload.querySelector('button[aria-label="Stop this task"]')) ?? false), "Run AI flips the task to Stop AI once running");
  assert.ok(fixture.calls.some((c) => c.method === "POST" && c.path === "/api/conversations"), "Run AI posts a conversation to OpenHands");

  // 9. WORKFLOW BUILDER — the Workflow view is now a pure node-graph builder.
  // The operational sections (orchestration metrics, live executions, knowledge
  // graph) moved to the dedicated Monitoring view, so the builder stays clean.
  // The relay is a first-class workflow node type in the palette.
  clickText(reload, "Workflow");
  assert.ok(await waitFor(() => reload.textContent?.includes("Add node") ?? false), "Workflow view renders the node palette");
  assert.ok(!reload.textContent?.includes("Live executions"), "Workflow builder no longer hosts the orchestration panel");
  assert.ok([...reload.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Relay"), "relay is a workflow node type in the palette");

  // 9b. ACTIVITY VIEW — the operational area. Switching to Activity
  // surfaces the activity panel with active work and the workflow structure,
  // plus the engine-driven current activity readout.
  clickText(reload, "Activity");
  assert.ok(await waitFor(() => reload.textContent?.includes("Current Activity") ?? false), "Activity view renders the activity panel");
  assert.ok(await waitFor(() => reload.textContent?.includes("Active Work") ?? false), "activity panel shows active work");
  assert.ok(await waitFor(() => reload.textContent?.includes("Workflow Structure") ?? false), "activity panel shows the workflow structure");

  // 10. AGENTS VIEW
  clickText(reload, "Agents");
  assert.ok(await waitFor(() => reload.textContent?.includes("Agents") ?? false), "Agents view renders");

  // 11. HISTORY VIEW
  clickText(reload, "History");
  // The "Clear" button is unique to the History view (the nav tab also says
  // "History", so asserting on it alone would pass even if the view failed).
  assert.ok(await waitFor(() => reload.textContent?.includes("Clear") ?? false), "History view renders");

  // 12. ANALYTICS VIEW
  clickText(reload, "Analytics");
  assert.ok(await waitFor(() => reload.textContent?.includes("Analytics") ?? false), "Analytics view renders");

  // 13. OpenHands -> Board sync (inbound conversation appears)
  await fixture.host.agentServer.request({
    method: "POST",
    path: "/api/conversations",
    body: {
      initial_message: { content: [{ type: "text", text: "OpenHands inbound conversation" }] },
      tags: {},
    },
  });
  clickText(reload, "Board");
  // Poll interval is now 2s; the inbound conversation must appear well under the old 10s.
  assert.ok(await waitFor(() => reload.textContent?.includes("OpenHands inbound conversation") ?? false, 4000), "inbound OpenHands conversation reflected on board (fast poll)");

  // 14. Board -> OpenHands sync (board task creates conversation) — task-centric.
  // There is no global orchestration toggle anymore. The Run / Stop / Retry
  // actions live in the task detail modal. Feature 8 already started one task
  // (its card is now locked / kb-running). Starting a SECOND task must post its
  // own conversation without being blocked by the first task's live run — proving
  // execution is task-scoped, not global.
  clickText(reload, "Board");
  // Feature 8's task is still running — its card carries the kb-running class.
  assert.ok(await waitFor(() => reload.querySelector('[data-task-id].kb-running') !== null, 2000), "feature 8's task is still running (kb-running card present)");
  // Close feature 8's detail modal so the board is fully interactive again.
  const closeBtn = reload.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
  closeBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  // Pick a different, idle task's card (the running task's Delete is locked).
  // The card is a pure editorial surface — clicking it opens the Inspector.
  const idleCard = [...reload.querySelectorAll<HTMLElement>('[data-task-id]:not(.kb-running)')][0] as HTMLElement;
  assert.ok(idleCard, "an idle task card is available");
  idleCard.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  idleCard.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => reload.textContent?.includes("Edit Task") ?? false), "Task Detail Inspector opens for the idle task");
  assert.ok(await waitFor(() => Boolean(reload.querySelector('button[aria-label="Run this task"]')) ?? false, 2000), "Run AI button present in the idle task's detail modal");
  const idleRunBtn = reload.querySelector('button[aria-label="Run this task"]') as HTMLButtonElement;
  const isExecCall = (c: { method: string; path: string }) =>
    c.method === "POST" && (c.path === "/api/conversations" || /\/api\/conversations\/[^/]+\/run$/.test(c.path));
  const beforeRuns = fixture.calls.filter(isExecCall).length;
  idleRunBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); // start a second task
  await sleep(150);
  const afterRuns = fixture.calls.filter(isExecCall).length;
  assert.ok(afterRuns > beforeRuns, "second task's Run AI posts its own execution (task-centric, not blocked by the first)");

  // 16. MULTI-AGENT RELAY — the relay is now a first-class workflow node type
  // (not a separate panel with a seed textarea). The orchestration panel
  // (live executions + knowledge graph) moved to the Monitoring view; the
  // relay node type is in the Workflow builder's palette.
  clickText(reload, "Workflow");
  assert.ok(await waitFor(() => reload.textContent?.includes("Add node") ?? false), "Workflow view renders for relay");
  const relayNodeBtn = [...reload.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Relay");
  assert.ok(Boolean(relayNodeBtn), "relay is a workflow node type in the palette");
  relayNodeBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(50);
  assert.ok(reload.textContent?.includes("Relay") ?? false, "relay node added to the canvas");

  // 17. AGENT ASSIGNMENT — open the modal via card click, pick an agent from
  // the select, confirm it shows. The card is a pure editorial surface: no
  // ellipsis, no menu. Clicking the card body opens the Task Detail Inspector
  // directly, which carries the AI agent select.
  // Use an IDLE card (the inbound conversation card) — the created task is
  // still running from the Run AI steps above.
  clickText(reload, "Board");
  assert.ok(await waitFor(() => Boolean([...reload.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("OpenHands inbound conversation"))) ?? false), "inbound conversation card rendered on board");
  const assignedCard = [...reload.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("OpenHands inbound conversation")) as HTMLElement;
  assert.ok(assignedCard, "idle task card found on board");
  assignedCard.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  assignedCard.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => reload.textContent?.includes("Edit Task") ?? false), "Task Detail Inspector opens on card click");
  assert.ok(await waitFor(() => Boolean(reload.querySelector('select[aria-label="AI agent"]')) ?? false), "AI agent select present in modal");
  const agentSelect = reload.querySelector('select[aria-label="AI agent"]') as HTMLSelectElement;
  const agentOptions = [...agentSelect.querySelectorAll("option")].filter((o) => o.value);
  assert.ok(agentOptions.length > 0, "at least one assignable agent option");
  agentSelect.value = agentOptions[0].value;
  agentSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.ok(await waitFor(() => reload.textContent?.includes("Assigned agent:") ?? false), "agent assignment confirmation visible in detail modal");
  clickText(reload, "Save");

  // 18. AI ROUTING (Run AI routes to a conversation)
  assert.ok(fixture.calls.some((c) => c.method === "POST" && c.path === "/api/conversations"), "AI routing posts to OpenHands conversations");

  reloadCleanup();
  reload.remove();
});
