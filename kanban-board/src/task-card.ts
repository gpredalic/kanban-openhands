/**
 * task-card.ts — <TaskCard> component + drag handlers (spec §3).
 *
 * A task row: title, assignee, status. Draggable; emits dragstart/drop
 * events. The move handler calls POST /api/agent/tasks/{id} to reassign or
 * change status.
 */

import type { Task } from "./types";

export interface TaskCardHandlers {
  onMove: (taskId: string, toStatus: string) => void;
  onUpdate: (taskId: string, patch: { title?: string; assignee?: string | null }) => void;
  onDelete: (taskId: string) => void;
}

/**
 * Render a single task card into a container.
 * Returns a cleanup function that removes the card and its listeners.
 */
export function renderTaskCard(
  container: HTMLElement,
  task: Task,
  handlers: TaskCardHandlers,
): () => void {
  const card = document.createElement("div");
  card.className = "kb-task-card";
  card.draggable = true;
  card.dataset.taskId = task.id;
  card.dataset.status = task.status;

  // Title
  const title = document.createElement("div");
  title.className = "kb-task-title";
  title.textContent = task.title;
  title.title = task.title;

  // Meta row: assignee + blocked flag
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

  // Actions
  const actions = document.createElement("div");
  actions.className = "kb-task-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "kb-task-delete";
  deleteBtn.type = "button";
  deleteBtn.textContent = "×";
  deleteBtn.title = "Delete task";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    handlers.onDelete(task.id);
  });
  actions.appendChild(deleteBtn);

  card.appendChild(title);
  card.appendChild(meta);
  card.appendChild(actions);

  // Drag handlers
  const onDragStart = (e: DragEvent) => {
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
