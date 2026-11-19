/**
 * column.ts — <Column> component (spec §3).
 *
 * One column per status. Header (title + count badge), a list of <TaskCard>s,
 * and an add-task input. Drop target for drag-and-drop moves.
 */

import { renderTaskCard, type TaskCardHandlers } from "./task-card";
import type { Column as ColumnModel, TaskStatus } from "./types";

export interface ColumnHandlers extends TaskCardHandlers {
  onCreate: (title: string, status: TaskStatus) => void;
}

/**
 * Render a single column into a container.
 * Returns a cleanup function that removes the column and all its listeners.
 */
export function renderColumn(
  container: HTMLElement,
  column: ColumnModel,
  handlers: ColumnHandlers,
): () => void {
  const col = document.createElement("div");
  col.className = "kb-column";
  col.dataset.status = column.status;

  // Header
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

  // Task list (drop target)
  const list = document.createElement("div");
  list.className = "kb-column-tasks";

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    col.classList.add("kb-drop-target");
  };
  const onDragLeave = () => {
    col.classList.remove("kb-drop-target");
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    col.classList.remove("kb-drop-target");
    const taskId = e.dataTransfer?.getData("text/plain");
    if (taskId) handlers.onMove(taskId, column.status);
  };
  list.addEventListener("dragover", onDragOver);
  list.addEventListener("dragleave", onDragLeave);
  list.addEventListener("drop", onDrop);

  // Render each task card
  const cardCleanups: Array<() => void> = [];
  for (const task of column.tasks) {
    cardCleanups.push(renderTaskCard(list, task, handlers));
  }

  col.appendChild(list);

  // Add-task input
  const addForm = document.createElement("form");
  addForm.className = "kb-column-add";
  const input = document.createElement("input");
  input.className = "kb-column-add-input";
  input.type = "text";
  input.placeholder = "Add a task…";
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
