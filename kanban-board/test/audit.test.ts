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

test("user acceptance audit exercises the real extension bundle", async () => {
  (globalThis as Record<string, unknown>).FormData = window.FormData;
  localStorage.clear();
  const fixture = makeHost();
  const cleanup = activate(fixture.host);
  const container = fixture.trigger();
  assert.ok(await waitFor(() => container.textContent?.includes("Design the onboarding flow") ?? false));

  const evidence: Record<string, unknown> = {};
  evidence.initial = container.textContent?.replace(/\s+/g, " ").slice(0, 500);

  clickText(container, "Create Task");
  assert.ok(await waitFor(() => Boolean(container.querySelector('input[placeholder="What needs to be done?"]'))));
  const createTitle = container.querySelector('input[placeholder="What needs to be done?"]') as HTMLInputElement;
  changeInput(createTitle, "Persisted audit task");
  const createAgent = container.querySelector('select[aria-label="AI agent"]') as HTMLSelectElement;
  if (createAgent) {
    createAgent.value = "agent-coder";
    createAgent.dispatchEvent(new window.Event("change", { bubbles: true }));
  }
  clickText(container, "Create");
  await waitFor(() => container.textContent?.includes("Persisted audit task") ?? false);
  await waitFor(() => Boolean(fixture.getTasks().find((t) => t.title === "Persisted audit task")?.conversationId), 1500);
  const createdTask = fixture.getTasks().find((t) => t.title === "Persisted audit task");
  evidence.create = {
    visible: container.textContent?.includes("Persisted audit task"),
    persisted: Boolean(createdTask),
    agentId: createdTask?.agentId,
    conversationId: createdTask?.conversationId,
    agentCardVisible: container.textContent?.includes("Forge"),
  };
  const assignedCard = [...container.querySelectorAll<HTMLElement>(".kb-card")].find((card) => card.textContent?.includes("Persisted audit task"));
  const assignedEdit = assignedCard?.querySelector('button[aria-label="Edit task"]') as HTMLButtonElement | null;
  assignedEdit?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => container.textContent?.includes("Assigned agent: Forge") ?? false);
  evidence.assignment = {
    cardAgentVisible: Boolean(assignedCard?.textContent?.includes("Forge")),
    detailAgentVisible: container.textContent?.includes("Assigned agent: Forge"),
  };
  clickText(container, "Save");

  const addButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Add Task");
  addButtons[0]?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => Boolean(container.querySelector('input[placeholder="Task title…"]'))));
  await sleep(20);
  const addInput = container.querySelector('input[placeholder="Task title…"]') as HTMLInputElement;
  changeInput(addInput, "Inline add task");
  clickText(container, "Add");
  await waitFor(() => fixture.getTasks().some((t) => t.title === "Inline add task"));
  evidence.inlineAdd = { visible: container.textContent?.includes("Inline add task"), persisted: fixture.getTasks().some((t) => t.title === "Inline add task") };

  const notification = container.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement;
  const beforeNotification = container.textContent;
  notification.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(20);
  evidence.notifications = { domChanged: beforeNotification !== container.textContent, callCount: fixture.calls.length };

  const edit = container.querySelector('button[aria-label="Edit task"]') as HTMLButtonElement;
  edit.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false));
  await sleep(20);
  const editTitle = container.querySelector('input[type="text"]') as HTMLInputElement;
  changeInput(editTitle, "Edited audit task");
  clickText(container, "Save");
  await waitFor(() => fixture.getTasks().some((t) => t.title === "Edited audit task"));
  evidence.edit = { visible: container.textContent?.includes("Edited audit task"), persisted: fixture.getTasks().some((t) => t.title === "Edited audit task") };

  const deleteEdit = [...container.querySelectorAll('button[aria-label="Edit task"]')][1] as HTMLButtonElement;
  deleteEdit?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false));
  const deleteButton = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Delete"));
  assert.ok(deleteButton, "delete action exists");
  deleteButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.ok(await waitFor(() => container.textContent?.includes("Confirm Delete") ?? false));
  clickText(container, "Confirm Delete");
  await sleep(50);
  evidence.delete = { persistedCount: fixture.getTasks().length, remainingTitles: fixture.getTasks().map((task) => task.title) };

  const dragCard = [...container.querySelectorAll<HTMLElement>(".kb-card")].find((card) => card.textContent?.includes("Persisted audit task")) as HTMLElement;
  const inProgressColumn = [...container.querySelectorAll("h3")].find((heading) => heading.textContent === "In Progress")?.parentElement?.parentElement as HTMLElement;
  if (dragCard && inProgressColumn) {
    dragCard.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
    dragCard.dispatchEvent(new window.MouseEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    inProgressColumn.dispatchEvent(new window.MouseEvent("pointerover", { bubbles: true, clientX: 200, clientY: 200 }));
    inProgressColumn.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, clientX: 200, clientY: 200 }));
  }
  await sleep(100);
  evidence.move = {
    movedTaskStatus: fixture.getTasks().find((task) => task.title === "Persisted audit task")?.status,
    renderedInProgress: [...container.querySelectorAll<HTMLElement>("[data-drop-status='in_progress']")]
      .some((column) => column.textContent?.includes("Persisted audit task")),
    moveUploads: fixture.calls.filter((call) => call.method === "POST" && call.path.startsWith("/api/file/upload")).length,
  };

  const search = container.querySelector('input[aria-label="Search tasks"]') as HTMLInputElement;
  changeInput(search, "Edited audit");
  await sleep(50);
  evidence.search = {
    editedVisible: container.textContent?.includes("Edited audit task"),
    originalVisible: container.textContent?.includes("Design the onboarding flow"),
  };

  for (const view of ["Command Center", "Workflow", "Agents", "History", "Analytics"]) {
    clickText(container, view);
    await sleep(50);
    evidence[view] = container.textContent?.replace(/\s+/g, " ").slice(0, 350);
  }

  clickText(container, "Board");
  // The Run AI / Stop AI button is state-driven: it reads "Stop AI" once a real
  // OpenHands execution is queued/running (creating a task posts a running
  // conversation). Click whichever label is present, mirroring the acceptance test.
  const aiToggle = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Run AI" || b.textContent?.trim() === "Stop AI");
  assert.ok(aiToggle, "Run AI / Stop AI toggle present");
  aiToggle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(100);
  evidence.runAi = {
    buttonPressed: container.querySelector('button[aria-pressed="true"]')?.textContent?.trim(),
    commandPosts: fixture.calls.filter((call) => call.method === "POST" && call.path === "/api/conversations").length,
    visibleExecution: container.textContent?.includes("execution"),
  };
  clickText(container, "History");
  await sleep(50);
  evidence.historyAfterRun = {
    visible: container.textContent?.includes("Execution History"),
    completedVisible: container.textContent?.includes("Completed Runs"),
    runTitleVisible: container.textContent?.includes("Persisted audit task"),
  };
  clickText(container, "Analytics");
  await sleep(50);
  evidence.analyticsAfterRun = {
    text: container.textContent?.replace(/\s+/g, " ").slice(0, 600),
  };
  const notificationButton = container.querySelector('button[aria-label="Notifications"]') as HTMLButtonElement;
  notificationButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => container.querySelector('button[aria-label="Notifications"]')?.getAttribute("data-notifications-open") === "true", 1500);
  evidence.notificationsAfterRun = {
    visible: Boolean(container.querySelector('[aria-label="Notification surface"]')?.textContent?.includes("AI execution started")),
    text: container.textContent?.replace(/\s+/g, " ").slice(0, 500),
    panelPresent: Boolean(container.querySelector('[aria-label="Notification surface"]')),
    panelHtml: container.querySelector('[aria-label="Notification surface"]')?.outerHTML?.slice(0, 300),
  };

  clickText(container, "Command Center");
  assert.ok(await waitFor(() => container.textContent?.includes("OpenHands Command Center") ?? false));
  const seed = container.querySelector("textarea") as HTMLTextAreaElement;
  changeInput(seed, "Audit relay seed");
  await sleep(50);
  const startRelay = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Start relay")) as HTMLButtonElement;
  startRelay?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => container.textContent?.includes("Relay response from mock agent") ?? false, 1500);
  evidence.relay = {
    hopVisible: container.textContent?.includes("Relay response from mock agent"),
    conversationPosts: fixture.calls.filter((call) => call.method === "POST" && call.path === "/api/conversations").length,
    askPosts: fixture.calls.filter((call) => call.path.includes("/ask_agent")).length,
  };

  await fixture.host.agentServer.request({
    method: "POST",
    path: "/api/conversations",
    body: {
      initial_message: { content: [{ type: "text", text: "OpenHands acceptance conversation" }] },
      tags: {},
    },
  });
  evidence.openHandsInboundRequest = {
    method: "POST",
    path: "/api/conversations",
    title: "OpenHands acceptance conversation",
  };

  cleanup();
  container.remove();
  const reloadCleanup = activate(fixture.host);
  const reload = fixture.trigger();
  await waitFor(() => reload.textContent?.includes("Edited audit task") ?? false);
  await waitFor(() => reload.textContent?.includes("OpenHands acceptance conversation") ?? false, 1500);
  evidence.reload = {
    editedVisible: reload.textContent?.includes("Edited audit task"),
    inlineAddVisible: reload.textContent?.includes("Inline add task"),
    taskCountInFile: fixture.getTasks().length,
    movedTaskStatus: fixture.getTasks().find((task) => task.title === "Persisted audit task")?.status,
    movedTaskRendered: reload.textContent?.includes("Persisted audit task"),
    openHandsConversationVisible: reload.textContent?.includes("OpenHands acceptance conversation"),
  };
  reloadCleanup();
  reload.remove();
  console.log("AUDIT_EVIDENCE", JSON.stringify(evidence));
});
