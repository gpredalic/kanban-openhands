// src/board-state.ts
var COLUMN_ORDER = ["todo", "in_progress", "review", "done"];
var COLUMN_TITLES = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done"
};
function groupTasksByStatus(tasks) {
  const byStatus = /* @__PURE__ */ new Map();
  for (const status of COLUMN_ORDER) byStatus.set(status, []);
  for (const task of tasks) {
    const bucket = byStatus.get(task.status);
    if (bucket) bucket.push(task);
  }
  return COLUMN_ORDER.map((status) => ({
    status,
    title: COLUMN_TITLES[status],
    tasks: byStatus.get(status) ?? []
  }));
}
function wipExceeded(tasks, status, limits) {
  const limit = limits[status];
  if (!limit || limit <= 0) return false;
  const count = tasks.filter((t) => t.status === status).length;
  return count >= limit;
}
var BoardStateStore = class {
  state;
  listeners = /* @__PURE__ */ new Set();
  constructor() {
    this.state = {
      columns: groupTasksByStatus([]),
      uiState: {
        filter: "all",
        selectedColumn: null,
        lastLoadedAt: 0,
        search: "",
        tagFilter: null,
        view: "board",
        wipLimits: {}
      }
    };
  }
  get() {
    return this.state;
  }
  /** Replace the persisted columns (after a fetch/reconcile). */
  setColumns(columns) {
    this.state = { ...this.state, columns };
    this.notify();
  }
  /** Update a single ephemeral UI field. */
  setUiState(patch) {
    this.state = {
      ...this.state,
      uiState: { ...this.state.uiState, ...patch }
    };
    this.notify();
  }
  /** Mark the board as freshly loaded. */
  markLoaded() {
    this.state = {
      ...this.state,
      uiState: { ...this.state.uiState, lastLoadedAt: Date.now() }
    };
    this.notify();
  }
  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  notify() {
    for (const listener of this.listeners) listener();
  }
};

// src/task-card.ts
function renderTaskCard(container, task, handlers) {
  const card = document.createElement("div");
  card.className = "kb-task-card";
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.dataset.status = task.status;
  const title = document.createElement("div");
  title.className = "kb-task-title";
  title.textContent = task.title;
  title.title = task.title;
  const meta = document.createElement("div");
  meta.className = "kb-task-meta";
  if (task.assignee) {
    const assignee = document.createElement("span");
    assignee.className = "kb-task-assignee";
    assignee.textContent = task.assignee;
    meta.appendChild(assignee);
  }
  if (task.waitingOn && task.waitingOn.length > 0) {
    const blocked = document.createElement("span");
    blocked.className = "kb-task-blocked";
    blocked.textContent = "blocked";
    blocked.title = `Waiting on ${task.waitingOn.length} task(s)`;
    meta.appendChild(blocked);
  }
  const actions = document.createElement("div");
  actions.className = "kb-task-actions";
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "kb-task-delete";
  deleteBtn.type = "button";
  deleteBtn.textContent = "\xD7";
  deleteBtn.title = "Delete task";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onDelete(task.id);
  });
  actions.appendChild(deleteBtn);
  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actions);
  const onDragStart = (e) => {
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", task.id);
      e.dataTransfer.effectAllowed = "move";
    }
    card.classList.add("kb-dragging");
  };
  const onDragEnd = () => {
    card.classList.remove("kb-dragging");
  };
  card.addEventListener("dragstart", onDragStart);
  card.addEventListener("dragend", onDragEnd);
  container.appendChild(card);
  return () => {
    card.removeEventListener("dragstart", onDragStart);
    card.removeEventListener("dragend", onDragEnd);
    card.remove();
  };
}

// src/column.ts
function renderColumn(container, column, handlers) {
  const col = document.createElement("div");
  col.className = "kb-column";
  col.dataset.status = column.status;
  const header = document.createElement("div");
  header.className = "kb-column-header";
  const title = document.createElement("h3");
  title.className = "kb-column-title";
  title.textContent = column.title;
  const count = document.createElement("span");
  count.className = "kb-column-count";
  count.textContent = String(column.tasks.length);
  header.appendChild(title);
  header.appendChild(count);
  col.appendChild(header);
  const list = document.createElement("div");
  list.className = "kb-column-tasks";
  const onDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    col.classList.add("kb-drop-target");
  };
  const onDragLeave = () => {
    col.classList.remove("kb-drop-target");
  };
  const onDrop = (e) => {
    e.preventDefault();
    col.classList.remove("kb-drop-target");
    const taskId = e.dataTransfer?.getData("text/plain");
    if (taskId) handlers.onMove(taskId, column.status);
  };
  list.addEventListener("dragover", onDragOver);
  list.addEventListener("dragleave", onDragLeave);
  list.addEventListener("drop", onDrop);
  const cardCleanups = [];
  for (const task of column.tasks) {
    cardCleanups.push(renderTaskCard(list, task, handlers));
  }
  col.appendChild(list);
  const addForm = document.createElement("form");
  addForm.className = "kb-column-add";
  const input = document.createElement("input");
  input.className = "kb-column-add-input";
  input.type = "text";
  input.placeholder = "Add a task\u2026";
  input.setAttribute("aria-label", `Add a task to ${column.title}`);
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (value) {
      handlers.onCreate(value, column.status);
      input.value = "";
    }
  });
  addForm.appendChild(input);
  col.appendChild(addForm);
  container.appendChild(col);
  return () => {
    list.removeEventListener("dragover", onDragOver);
    list.removeEventListener("dragleave", onDragLeave);
    list.removeEventListener("drop", onDrop);
    for (const cleanup of cardCleanups) cleanup();
    col.remove();
  };
}

// src/task-overlay.ts
var OVERLAY_KEY = "kanban-board.task-overlay.v1";
function loadOverlay() {
  try {
    const raw = localStorage.getItem(OVERLAY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}
function saveOverlay(overlay) {
  try {
    localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
  }
}
function applyOverlay(tasks, overlay) {
  return tasks.map((task) => {
    const entry = overlay[task.id];
    if (!entry) return task;
    const merged = { ...task };
    if (entry.tags !== void 0) merged.tags = entry.tags;
    if (entry.dueDate !== void 0) merged.dueDate = entry.dueDate;
    return merged;
  });
}
function setTaskOverlay(taskId, patch) {
  const overlay = loadOverlay();
  const existing = overlay[taskId] ?? {};
  const next = { ...existing };
  if (patch.tags !== void 0) next.tags = patch.tags;
  if (patch.dueDate !== void 0) next.dueDate = patch.dueDate;
  overlay[taskId] = next;
  saveOverlay(overlay);
  return overlay;
}
function clearTaskOverlay(taskId) {
  const overlay = loadOverlay();
  if (taskId in overlay) {
    delete overlay[taskId];
    saveOverlay(overlay);
  }
  return overlay;
}

// src/import-export.ts
var EXPORT_VERSION = 1;
function buildExport(tasks) {
  return {
    version: EXPORT_VERSION,
    exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
    tasks: tasks.map((t) => ({ ...t }))
  };
}
function serializeExport(doc) {
  return JSON.stringify(doc, null, 2);
}
function downloadExport(doc, filename = "kanban-board-export.json") {
  const blob = new Blob([serializeExport(doc)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function parseImport(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return { ok: false, tasks: [], error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  let rawTasks;
  if (Array.isArray(parsed)) {
    rawTasks = parsed;
  } else if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)) {
    rawTasks = parsed.tasks;
  } else {
    return { ok: false, tasks: [], error: "Expected a JSON array of tasks or an object with a 'tasks' array." };
  }
  const tasks = [];
  for (const raw of rawTasks) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw;
    const id = typeof t.id === "string" ? t.id : null;
    const title = typeof t.title === "string" ? t.title : null;
    if (!id || !title) continue;
    const status = COLUMN_ORDER.includes(t.status) ? t.status : "todo";
    const task = {
      id,
      title,
      status,
      assignee: typeof t.assignee === "string" ? t.assignee : null,
      projectId: typeof t.projectId === "string" ? t.projectId : "",
      waitingOn: Array.isArray(t.waitingOn) ? t.waitingOn : null
    };
    if (Array.isArray(t.tags)) task.tags = t.tags.filter((x) => typeof x === "string");
    if (typeof t.dueDate === "string") task.dueDate = t.dueDate;
    tasks.push(task);
  }
  return { ok: true, tasks };
}
async function importFromFile(file) {
  const text = await file.text();
  return parseImport(text);
}

// src/use-board-data.ts
var POLL_INTERVAL_MS = 15e3;
async function fetchTasks(host) {
  const res = await host.agentServer.request({ method: "GET", path: "/api/agent/tasks" });
  if (Array.isArray(res)) return res;
  if (res && typeof res === "object" && Array.isArray(res.tasks)) {
    return res.tasks;
  }
  return [];
}
async function moveTask(host, taskId, status) {
  await host.agentServer.request({
    method: "POST",
    path: `/api/agent/tasks/${encodeURIComponent(taskId)}`,
    body: { status }
  });
}
async function updateTask(host, taskId, patch) {
  await host.agentServer.request({
    method: "PATCH",
    path: `/api/agent/tasks/${encodeURIComponent(taskId)}`,
    body: patch
  });
}
async function deleteTask(host, taskId) {
  await host.agentServer.request({
    method: "DELETE",
    path: `/api/agent/tasks/${encodeURIComponent(taskId)}`
  });
}
async function createTask(host, title, status, assignee, projectId) {
  const body = { title, status };
  if (assignee !== void 0) body.assignee = assignee;
  if (projectId !== void 0) body.projectId = projectId;
  const res = await host.agentServer.request({
    method: "POST",
    path: "/api/agent/tasks",
    body
  });
  if (res && typeof res === "object" && "id" in res) return res;
  return null;
}
function createBoardDataController(host, store) {
  let pollTimer = null;
  let disposed = false;
  async function load() {
    if (disposed) return;
    try {
      const tasks = await fetchTasks(host);
      const overlaid = applyOverlay(tasks, loadOverlay());
      store.setColumns(groupTasksByStatus(overlaid));
      store.markLoaded();
    } catch (err) {
      console.error("[kanban-board] failed to load tasks:", err);
    }
  }
  function applyOverlayToStore() {
    const tasks = store.get().columns.flatMap((c) => c.tasks);
    store.setColumns(groupTasksByStatus(applyOverlay(tasks, loadOverlay())));
  }
  async function move(taskId, status) {
    if (disposed) return false;
    const allTasks = store.get().columns.flatMap((c) => c.tasks);
    if (wipExceeded(allTasks, status, store.get().uiState.wipLimits)) {
      console.warn(`[kanban-board] WIP limit reached for "${status}"; move blocked.`);
      return false;
    }
    const columns = store.get().columns.map((col) => ({
      ...col,
      tasks: col.tasks.filter((t) => t.id !== taskId)
    }));
    const target = columns.find((c) => c.status === status);
    const task = store.get().columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
    if (target && task) {
      target.tasks = [...target.tasks, { ...task, status }];
    }
    store.setColumns(columns);
    try {
      await moveTask(host, taskId, status);
    } catch (err) {
      console.error("[kanban-board] move failed, reconciling:", err);
      await load();
    }
    return true;
  }
  async function update(taskId, patch) {
    if (disposed) return;
    try {
      await updateTask(host, taskId, patch);
      await load();
    } catch (err) {
      console.error("[kanban-board] update failed:", err);
    }
  }
  async function remove(taskId) {
    if (disposed) return;
    try {
      await deleteTask(host, taskId);
      clearTaskOverlay(taskId);
      await load();
    } catch (err) {
      console.error("[kanban-board] delete failed:", err);
    }
  }
  async function create(title, status, assignee, projectId) {
    if (disposed) return false;
    const allTasks = store.get().columns.flatMap((c) => c.tasks);
    if (wipExceeded(allTasks, status, store.get().uiState.wipLimits)) {
      console.warn(`[kanban-board] WIP limit reached for "${status}"; create blocked.`);
      return false;
    }
    try {
      await createTask(host, title, status, assignee, projectId);
      await load();
    } catch (err) {
      console.error("[kanban-board] create failed:", err);
    }
    return true;
  }
  function setTags(taskId, tags) {
    if (disposed) return;
    setTaskOverlay(taskId, { tags });
    applyOverlayToStore();
  }
  function setDueDate(taskId, dueDate) {
    if (disposed) return;
    setTaskOverlay(taskId, { dueDate });
    applyOverlayToStore();
  }
  function exportBoard() {
    const tasks = store.get().columns.flatMap((c) => c.tasks);
    downloadExport(buildExport(tasks));
  }
  async function importBoard(file) {
    if (disposed) return { ok: false, tasks: [], error: "Controller disposed." };
    const result = await importFromFile(file);
    if (!result.ok) return result;
    const existingIds = new Set(store.get().columns.flatMap((c) => c.tasks).map((t) => t.id));
    for (const t of result.tasks) {
      const patch = {};
      if (t.tags) patch.tags = t.tags;
      if (t.dueDate !== void 0) patch.dueDate = t.dueDate;
      if (patch.tags !== void 0 || patch.dueDate !== void 0) setTaskOverlay(t.id, patch);
      if (!existingIds.has(t.id)) {
        await createTask(host, t.title, t.status, t.assignee, t.projectId);
      }
    }
    await load();
    return result;
  }
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
  }
  void load();
  startPolling();
  return {
    load,
    move,
    update,
    remove,
    create,
    setTags,
    setDueDate,
    exportBoard,
    importBoard,
    dispose() {
      disposed = true;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  };
}

// src/board.ts
function renderBoard(host, ctx) {
  const { container } = ctx;
  const root = document.createElement("div");
  root.className = "kb-board";
  const header = document.createElement("header");
  header.className = "kb-board-header";
  const heading = document.createElement("h2");
  heading.className = "kb-board-title";
  heading.textContent = "Kanban Board";
  const filterGroup = document.createElement("div");
  filterGroup.className = "kb-board-filters";
  filterGroup.setAttribute("role", "group");
  filterGroup.setAttribute("aria-label", "Filter tasks");
  const FILTERS = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "assigned", label: "Assigned" }
  ];
  const store = new BoardStateStore();
  const controller = createBoardDataController(host, store);
  const filterButtons = [];
  for (const f of FILTERS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kb-filter-btn";
    btn.dataset.filter = f.id;
    btn.textContent = f.label;
    btn.addEventListener("click", () => {
      store.setUiState({ filter: f.id });
    });
    filterGroup.appendChild(btn);
    filterButtons.push({ id: f.id, btn });
  }
  header.appendChild(heading);
  header.appendChild(filterGroup);
  root.appendChild(header);
  const columnList = document.createElement("div");
  columnList.className = "kb-board-columns";
  root.appendChild(columnList);
  container.appendChild(root);
  const columnHandlers = {
    onMove: (taskId, toStatus) => {
      void controller.move(taskId, toStatus);
    },
    onUpdate: (taskId, patch) => {
      void controller.update(taskId, patch);
    },
    onDelete: (taskId) => {
      void controller.remove(taskId);
    },
    onCreate: (title, status) => {
      void controller.create(title, status);
    }
  };
  let columnCleanups = [];
  function renderColumns() {
    for (const cleanup of columnCleanups) cleanup();
    columnCleanups = [];
    columnList.innerHTML = "";
    const { columns, uiState } = store.get();
    const filter = uiState.filter;
    for (const column of columns) {
      let tasks = column.tasks;
      if (filter === "active") {
        tasks = tasks.filter((t) => t.status !== "done");
      } else if (filter === "assigned") {
        tasks = tasks.filter((t) => t.assignee != null);
      }
      if (filter !== "all" && tasks.length === 0) continue;
      const filteredColumn = { ...column, tasks };
      columnCleanups.push(renderColumn(columnList, filteredColumn, columnHandlers));
    }
    for (const { id, btn } of filterButtons) {
      btn.classList.toggle("kb-active", id === filter);
      btn.setAttribute("aria-pressed", String(id === filter));
    }
  }
  renderColumns();
  const unsubscribe = store.subscribe(renderColumns);
  return () => {
    unsubscribe();
    controller.dispose();
    for (const cleanup of columnCleanups) cleanup();
    root.remove();
  };
}

// src/styles.ts
var BOARD_CSS = `
.kb-board {
  --kb-bg: #0f1117;
  --kb-surface: #1a1d27;
  --kb-surface-2: #232734;
  --kb-border: #2e3340;
  --kb-text: #e6e8ee;
  --kb-text-dim: #9aa0b0;
  --kb-accent: #6c8cff;
  --kb-danger: #ff6b6b;
  --kb-radius: 8px;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--kb-text);
  background: var(--kb-bg);
  padding: 16px;
  box-sizing: border-box;
  min-height: 100%;
}
.kb-board *,
.kb-board *::before,
.kb-board *::after {
  box-sizing: border-box;
}
.kb-board-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.kb-board-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}
.kb-board-filters {
  display: flex;
  gap: 6px;
}
.kb-filter-btn {
  background: var(--kb-surface);
  color: var(--kb-text-dim);
  border: 1px solid var(--kb-border);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.kb-filter-btn:hover {
  color: var(--kb-text);
  border-color: var(--kb-accent);
}
.kb-filter-btn.kb-active {
  background: var(--kb-accent);
  color: #fff;
  border-color: var(--kb-accent);
}
.kb-board-columns {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  overflow-x: auto;
  padding-bottom: 8px;
}
.kb-column {
  flex: 0 0 280px;
  background: var(--kb-surface);
  border: 1px solid var(--kb-border);
  border-radius: var(--kb-radius);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.kb-column.kb-drop-target {
  border-color: var(--kb-accent);
  box-shadow: 0 0 0 2px rgba(108, 140, 255, 0.25);
}
.kb-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kb-column-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--kb-text);
}
.kb-column-count {
  background: var(--kb-surface-2);
  color: var(--kb-text-dim);
  border-radius: 999px;
  font-size: 0.75rem;
  padding: 2px 8px;
  min-width: 22px;
  text-align: center;
}
.kb-column-tasks {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 24px;
}
.kb-task-card {
  background: var(--kb-surface-2);
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  padding: 10px;
  cursor: grab;
  transition: border-color 0.15s, transform 0.1s, opacity 0.15s;
}
.kb-task-card:hover {
  border-color: var(--kb-accent);
}
.kb-task-card.kb-dragging {
  opacity: 0.5;
  cursor: grabbing;
}
.kb-task-title {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--kb-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kb-task-meta {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  font-size: 0.72rem;
  color: var(--kb-text-dim);
}
.kb-task-assignee {
  background: var(--kb-surface);
  border-radius: 4px;
  padding: 1px 6px;
}
.kb-task-blocked {
  color: var(--kb-danger);
  font-weight: 600;
}
.kb-task-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.kb-task-delete {
  background: transparent;
  border: none;
  color: var(--kb-text-dim);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}
.kb-task-delete:hover {
  color: var(--kb-danger);
  background: rgba(255, 107, 107, 0.12);
}
.kb-column-add {
  margin-top: auto;
}
.kb-column-add-input {
  width: 100%;
  background: var(--kb-surface-2);
  border: 1px solid var(--kb-border);
  border-radius: 6px;
  color: var(--kb-text);
  font-size: 0.8rem;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.15s;
}
.kb-column-add-input::placeholder {
  color: var(--kb-text-dim);
}
.kb-column-add-input:focus {
  border-color: var(--kb-accent);
}
@media (max-width: 640px) {
  .kb-board-columns {
    flex-direction: column;
    align-items: stretch;
  }
  .kb-column {
    flex: 1 1 auto;
    width: 100%;
  }
}
`;
function injectStyles() {
  const style = document.createElement("style");
  style.className = "kb-board-styles";
  style.textContent = BOARD_CSS;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}

// src/entry.ts
function activate(host) {
  const removeStyles = injectStyles();
  let boardCleanup = null;
  const unregisterPage = host.registerPage("board", (ctx) => {
    boardCleanup = renderBoard(host, ctx);
  });
  return () => {
    if (boardCleanup) {
      boardCleanup();
      boardCleanup = null;
    }
    unregisterPage();
    removeStyles();
  };
}
export {
  activate
};
