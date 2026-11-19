/**
 * board.ts — <KanbanBoard> component (spec §3).
 *
 * The top-level board. Mounted into the page container by registerPage.
 * Owns the state store and the data controller. Renders the header (filter +
 * view toggle) and the column list. Subscribes to state changes and
 * re-renders the columns on every change.
 */

import { BoardStateStore } from "./board-state";
import { renderColumn, type ColumnHandlers } from "./column";
import { createBoardDataController } from "./use-board-data";
import type { Host, PageContext, TaskStatus } from "./types";

/**
 * Render the full Kanban board into a container.
 * Returns a cleanup function that removes the board, stops polling, and
 * unsubscribes from state changes.
 */
export function renderBoard(host: Host, ctx: PageContext): () => void {
  const { container } = ctx;

  // Root
  const root = document.createElement("div");
  root.className = "kb-board";

  // Header
  const header = document.createElement("header");
  header.className = "kb-board-header";

  const heading = document.createElement("h2");
  heading.className = "kb-board-title";
  heading.textContent = "Kanban Board";

  // Filter chips
  const filterGroup = document.createElement("div");
  filterGroup.className = "kb-board-filters";
  filterGroup.setAttribute("role", "group");
  filterGroup.setAttribute("aria-label", "Filter tasks");

  const FILTERS: Array<{ id: "all" | "active" | "assigned"; label: string }> = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "assigned", label: "Assigned" },
  ];

  const store = new BoardStateStore();
  const controller = createBoardDataController(host, store);

  const filterButtons: Array<{ id: string; btn: HTMLButtonElement }> = [];
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

  // Column list
  const columnList = document.createElement("div");
  columnList.className = "kb-board-columns";
  root.appendChild(columnList);

  container.appendChild(root);

  // Column handlers
  const columnHandlers: ColumnHandlers = {
    onMove: (taskId, toStatus) => {
      void controller.move(taskId, toStatus as TaskStatus);
    },
    onUpdate: (taskId, patch) => {
      void controller.update(taskId, patch);
    },
    onDelete: (taskId) => {
      void controller.remove(taskId);
    },
    onCreate: (title, status) => {
      void controller.create(title, status);
    },
  };

  // Render columns based on current state + filter
  let columnCleanups: Array<() => void> = [];

  function renderColumns(): void {
    // Clear existing columns
    for (const cleanup of columnCleanups) cleanup();
    columnCleanups = [];
    columnList.innerHTML = "";

    const { columns, uiState } = store.get();
    const filter = uiState.filter;

    for (const column of columns) {
      // Apply filter
      let tasks = column.tasks;
      if (filter === "active") {
        tasks = tasks.filter((t) => t.status !== "done");
      } else if (filter === "assigned") {
        tasks = tasks.filter((t) => t.assignee != null);
      }

      // Skip empty columns when a filter is active (keeps the board tidy)
      if (filter !== "all" && tasks.length === 0) continue;

      const filteredColumn = { ...column, tasks };
      columnCleanups.push(renderColumn(columnList, filteredColumn, columnHandlers));
    }

    // Update filter button active states
    for (const { id, btn } of filterButtons) {
      btn.classList.toggle("kb-active", id === filter);
      btn.setAttribute("aria-pressed", String(id === filter));
    }
  }

  // Initial render + subscribe to state changes
  renderColumns();
  const unsubscribe = store.subscribe(renderColumns);

  // Cleanup
  return () => {
    unsubscribe();
    controller.dispose();
    for (const cleanup of columnCleanups) cleanup();
    root.remove();
  };
}
