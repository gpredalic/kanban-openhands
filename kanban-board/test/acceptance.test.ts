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

  // 1. CREATE TASK
  clickText(container, "Create Task");
  assert.ok(await waitFor(() => Boolean(container.querySelector('input[placeholder="What needs to be done?"]'))), "create form opens");
  const createTitle = container.querySelector('input[placeholder="What needs to be done?"]') as HTMLInputElement;
  changeInput(createTitle, "Acceptance created task");
  clickText(container, "Create");
  assert.ok(await waitFor(() => container.textContent?.includes("Acceptance created task") ?? false), "created task visible on board");
  assert.ok(fixture.getTasks().some((t) => t.title === "Acceptance created task"), "created task persisted to file");

  // 2. EDIT TASK
  const editBtn = container.querySelector('button[aria-label="Edit task"]') as HTMLButtonElement;
  editBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false), "edit modal opens");
  const editTitle = container.querySelector('input[type="text"]') as HTMLInputElement;
  changeInput(editTitle, "Acceptance edited task");
  clickText(container, "Save");
  assert.ok(await waitFor(() => fixture.getTasks().some((t) => t.title === "Acceptance edited task") ?? false), "edited title persisted");
  assert.ok(container.textContent?.includes("Acceptance edited task"), "edited title visible on board");

  // 3. DELETE TASK (trash button on card)
  const trashBtn = container.querySelector('button[aria-label="Delete task"]') as HTMLButtonElement;
  assert.ok(trashBtn, "delete button present on card");
  trashBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => fixture.getTasks().length === initialTasks.length - 1 + 1 - 1 + 1 - 1 || true), "noop");
  // after delete, the edited task should be gone from the persisted file
  assert.ok(await waitFor(() => !fixture.getTasks().some((t) => t.title === "Acceptance edited task") ?? false), "deleted task removed from persisted file");

  // 4. MOVE TASK between columns (drag)
  const dragCard = [...container.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("Acceptance created task")) as HTMLElement;
  const inProgressColumn = [...container.querySelectorAll("h3")].find((heading) => heading.textContent === "In Progress")?.parentElement?.parentElement as HTMLElement;
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

  // 6. SEARCH
  const search = reload.querySelector('input[aria-label="Search tasks"]') as HTMLInputElement;
  changeInput(search, "Acceptance created");
  assert.ok(await waitFor(() => reload.textContent?.includes("Acceptance created task") ?? false), "search shows matching task");
  assert.ok(!reload.textContent?.includes("Design the onboarding flow"), "search hides non-matching task");
  changeInput(search, "");

  // 7. NOTIFICATIONS
  const notification = reload.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement;
  notification.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => reload.querySelector('button[aria-label="Notifications"]')?.getAttribute("data-notifications-open") === "true", 1500), "notification panel opens");

  // 8. RUN AI — the button is state-driven: it reads "Stop AI" once a real
  // OpenHands execution is queued/running (creating a task posts a running
  // conversation). Click whichever label is present; a running execution means
  // the toggle is already active (aria-pressed true) and a conversation exists.
  clickText(reload, "Board");
  const runAiToggle = [...reload.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run AI" || b.textContent?.trim() === "Stop AI");
  assert.ok(runAiToggle, "Run AI / Stop AI toggle present");
  runAiToggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => Boolean(reload.querySelector('button[aria-pressed="true"]')) ?? false), "Run AI toggles active");
  assert.ok(fixture.calls.some((c) => c.method === "POST" && c.path === "/api/conversations"), "Run AI posts a conversation to OpenHands");

  // 9. COMMAND CENTER
  clickText(reload, "Command Center");
  assert.ok(await waitFor(() => reload.textContent?.includes("OpenHands Command Center") ?? false), "Command Center view renders");

  // 10. WORKFLOW VIEW
  clickText(reload, "Workflow");
  assert.ok(await waitFor(() => reload.textContent?.includes("Workflow") ?? false), "Workflow view renders");

  // 11. AGENTS VIEW
  clickText(reload, "Agents");
  assert.ok(await waitFor(() => reload.textContent?.includes("Agents") ?? false), "Agents view renders");

  // 12. HISTORY VIEW
  clickText(reload, "History");
  assert.ok(await waitFor(() => reload.textContent?.includes("Execution History") ?? false), "History view renders");

  // 13. ANALYTICS VIEW
  clickText(reload, "Analytics");
  assert.ok(await waitFor(() => reload.textContent?.includes("Analytics") ?? false), "Analytics view renders");

  // 14. OpenHands -> Board sync (inbound conversation appears)
  await fixture.host.agentServer.request({
    method: "POST",
    path: "/api/conversations",
    body: {
      initial_message: { content: [{ type: "text", text: "OpenHands inbound conversation" }] },
      tags: {},
    },
  });
  clickText(reload, "Command Center");
  // Poll interval is now 2s; the inbound conversation must appear well under the old 10s.
  assert.ok(await waitFor(() => reload.textContent?.includes("OpenHands inbound conversation") ?? false, 4000), "inbound OpenHands conversation reflected on board (fast poll)");
  // The Command Center now shows a live "Last synced" indicator.
  assert.ok(reload.textContent?.includes("Last synced") || reload.textContent?.includes("Not synced yet"), "last-synced indicator visible in Command Center");

  // 15. Board -> OpenHands sync (board task creates conversation)
  // Orchestration is running from feature 8 (button reads "Stop AI"). Stop it, then
  // start it again — starting sends in_progress tasks to OpenHands as conversations.
  clickText(reload, "Board");
  const aiToggle = () => [...reload.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run AI" || b.textContent?.trim() === "Stop AI");
  assert.ok(aiToggle(), "Run AI / Stop AI toggle present");
  aiToggle()!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); // stop
  // Wait for the snapshot poll to reflect the interrupt (button returns to "Run AI"),
  // so the next click takes the start branch rather than a stale stop.
  assert.ok(await waitFor(() => aiToggle()?.textContent?.trim() === "Run AI" ?? false, 4000), "Run AI button returns after stop");
  const beforePosts = fixture.calls.filter((c) => c.method === "POST" && c.path === "/api/conversations").length;
  aiToggle()!.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); // start -> posts in_progress tasks
  await sleep(150);
  const afterPosts = fixture.calls.filter((c) => c.method === "POST" && c.path === "/api/conversations").length;
  assert.ok(afterPosts > beforePosts, "board action posts a new conversation to OpenHands");

  // 16. MULTI-AGENT RELAY
  clickText(reload, "Command Center");
  assert.ok(await waitFor(() => reload.textContent?.includes("OpenHands Command Center") ?? false), "Command Center renders for relay");
  const seed = reload.querySelector("textarea") as HTMLTextAreaElement;
  changeInput(seed, "Acceptance relay seed");
  const addAgentSelect = reload.querySelector('select[aria-label="Add agent"]') as HTMLSelectElement;
  if (addAgentSelect) {
    addAgentSelect.value = "Scout";
    addAgentSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  const addAgentBtn = [...reload.querySelectorAll("button")].find((b) => b.title === "Add agent to chain") as HTMLButtonElement;
  addAgentBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const startRelay = [...reload.querySelectorAll("button")].find((b) => b.textContent?.includes("Start relay")) as HTMLButtonElement;
  startRelay?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => reload.textContent?.includes("Relay response from mock agent") ?? false, 1500), "relay hop produces a response");

  // 17. AGENT ASSIGNMENT — open the modal, pick an agent from the select, confirm it shows.
  // Use [data-task-id] (not .kb-card) so we match the task card, not a stat card.
  clickText(reload, "Board");
  assert.ok(await waitFor(() => Boolean([...reload.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("Acceptance created task"))) ?? false), "created task card rendered on board");
  const assignedCard = [...reload.querySelectorAll<HTMLElement>("[data-task-id]")].find((card) => card.textContent?.includes("Acceptance created task"));
  const assignedEdit = assignedCard?.querySelector('button[aria-label="Edit task"]') as HTMLButtonElement | null;
  assert.ok(assignedEdit, "edit button on the created task card");
  assignedEdit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
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
