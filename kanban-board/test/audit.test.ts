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
  assert.ok(await waitFor(() => Boolean(container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]'))));
  const createTitle = container.querySelector('input[placeholder="e.g. Replace vending machine cash reader"]') as HTMLInputElement;
  changeInput(createTitle, "Persisted audit task");
  // The agent prompt is its own required field (never derived from the title);
  // the Create button stays disabled until both are filled.
  changeInput(container.querySelector('textarea[placeholder^="Describe what the AI agent"]') as HTMLTextAreaElement, "Audit: verify the task-centric create and execution flow.");
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
  // The card is a pure editorial surface — clicking it opens the Task Detail
  // Inspector, which carries the "Assigned agent:" line. No CardMenu ellipsis
  // exists on the card anymore.
  assignedCard?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  assignedCard?.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  await waitFor(() => container.textContent?.includes("Assigned agent: Forge") ?? false);
  evidence.assignment = {
    cardAgentVisible: Boolean(assignedCard?.textContent?.includes("Forge")),
    detailAgentVisible: container.textContent?.includes("Assigned agent: Forge"),
  };
  clickText(container, "Save");

  // Task creation has a single entry point: the header's "Create Task" button.
  // The column-local "Add Task" cards are gone — no column may offer its own
  // inline creation form.
  const addButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Add Task");
  evidence.inlineAdd = {
    columnAddTaskButtons: addButtons.length,
    noColumnAddTask: addButtons.length === 0,
    noInlineTitleInput: container.querySelector('input[placeholder="Task title…"]') === null,
  };

  // The notification icon and its panel were removed from the header; no
  // notification button or surface may remain.
  evidence.notifications = {
    buttonPresent: container.querySelector('button[aria-label="Notifications"]') !== null,
    surfacePresent: container.querySelector('[aria-label="Notification surface"]') !== null,
    callCount: fixture.calls.length,
  };

  // The card is a pure editorial surface — clicking it opens the Task Detail
  // Inspector (Edit Task modal), which carries Edit and Delete. No CardMenu
  // ellipsis exists on the card anymore.
  const editCard = [...container.querySelectorAll<HTMLElement>(".kb-card")].find((card) => card.textContent?.includes("Persisted audit task"));
  editCard?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  editCard?.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => container.textContent?.includes("Edit Task") ?? false));
  await sleep(20);
  const editTitle = container.querySelector('input[type="text"]') as HTMLInputElement;
  changeInput(editTitle, "Edited audit task");
  clickText(container, "Save");
  await waitFor(() => fixture.getTasks().some((t) => t.title === "Edited audit task"));
  evidence.edit = { visible: container.textContent?.includes("Edited audit task"), persisted: fixture.getTasks().some((t) => t.title === "Edited audit task") };

  // Re-open the detail inspector by clicking the card again, then delete.
  const deleteCard = [...container.querySelectorAll<HTMLElement>(".kb-card")].find((card) => card.textContent?.includes("Edited audit task"));
  deleteCard?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  deleteCard?.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
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

  // Board search was removed: the header no longer carries a search box and the
  // board no longer filters by free-text query.
  evidence.search = {
    searchInputPresent: container.querySelector('input[aria-label="Search tasks"]') !== null,
  };

  for (const view of ["Workflow", "Analytics"]) {
    clickText(container, view);
    await sleep(50);
    evidence[view] = container.textContent?.replace(/\s+/g, " ").slice(0, 350);
  }

  clickText(container, "Board");
  // Wait for React to re-render the board view after the view switch. The
  // task card (.kb-card) is a reliable board-rendered signal.
  assert.ok(await waitFor(() => container.querySelectorAll(".kb-card").length > 0, 2000), "board view renders with task cards after view switch");
  // Execution is task-centric: the header no longer carries a global Run AI /
  // Stop AI toggle. The Run / Stop / Retry actions live in the task detail
  // modal (moved off the card). Opening a task's detail modal and clicking Run
  // posts a fresh OpenHands conversation for THAT task only, and the button
  // flips to Stop AI once the run is live. The card is a pure editorial
  // surface — clicking it opens the Task Detail Inspector. No CardMenu
  // ellipsis exists on the card anymore.
  const auditCard = container.querySelector(".kb-card") as HTMLElement | null;
  auditCard?.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
  auditCard?.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10 }));
  assert.ok(await waitFor(() => Boolean(container.querySelector('button[aria-label="Run this task"]')) ?? false, 2000), "Run AI button present in the task detail modal");
  const taskRunBtn = container.querySelector('button[aria-label="Run this task"]') as HTMLButtonElement;
  taskRunBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(100);
  evidence.runAi = {
    perTaskRunButtonPresent: Boolean(taskRunBtn),
    stopButtonAppears: Boolean(container.querySelector('button[aria-label="Stop this task"]')),
    commandPosts: fixture.calls.filter((call) => call.method === "POST" && call.path === "/api/conversations").length,
    visibleExecution: container.textContent?.includes("execution"),
  };
  clickText(container, "Analytics");
  await sleep(50);
  const resetMetricsBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Clear Analytics"));
  resetMetricsBtn?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(20);
  const analyticsConfirmDialog = container.querySelector('[role="dialog"][aria-label="Clear analytics?"]');
  evidence.analyticsAfterRun = {
    text: container.textContent?.replace(/\s+/g, " ").slice(0, 600),
    resetMetricsButtonPresent: Boolean(resetMetricsBtn),
    confirmDialogOpens: Boolean(analyticsConfirmDialog),
    confirmQuestionShown: analyticsConfirmDialog?.textContent?.includes("Clear analytics?") ?? false,
  };
  // Cancel the confirmation so the reset does not fire.
  [...(analyticsConfirmDialog?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.includes("Cancel"))?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(20);
  evidence.analyticsConfirmCancelled = {
    dialogClosed: container.querySelector('[role="dialog"][aria-label="Clear analytics?"]') === null,
  };
  // The notification icon and its panel were removed from the header; no
  // notification button or surface may remain.
  evidence.notificationsAfterRun = {
    buttonPresent: container.querySelector('button[aria-label="Notifications"]') !== null,
    surfacePresent: container.querySelector('[aria-label="Notification surface"]') !== null,
  };

  // The relay is a workflow node type (not a separate panel). The Workflow
  // builder is a pure node-graph editor, and the node palette exposes the relay
  // as a first-class node type.
  clickText(container, "Workflow");
  assert.ok(await waitFor(() => container.textContent?.includes("Add node") ?? false));
  // The relay is a node type in the palette.
  const relayNodeButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Relay");
  relayNodeButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await sleep(50);
  evidence.relay = {
    relayNodeTypeInPalette: Boolean(relayNodeButton),
    relayNodeAdded: container.textContent?.includes("Relay") ?? false,
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
    taskCountInFile: fixture.getTasks().length,
    movedTaskStatus: fixture.getTasks().find((task) => task.title === "Persisted audit task")?.status,
    movedTaskRendered: reload.textContent?.includes("Persisted audit task"),
    openHandsConversationVisible: reload.textContent?.includes("OpenHands acceptance conversation"),
  };
  reloadCleanup();
  reload.remove();
  console.log("AUDIT_EVIDENCE", JSON.stringify(evidence));
});
