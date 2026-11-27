/**
 * KanbanColumn — a single board column.
 *
 * Semi-transparent glass surface with a backdrop blur, a subtle border, a
 * colored status indicator, a task counter badge, and a column shadow.
 * Drop target for drag-and-drop moves. Resembles Linear / Jira Cloud.
 */

import { useDroppable } from "@dnd-kit/core";
import type { Column, Task, TaskStatus, DeletePhase } from "../types/task";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "./EmptyState";

interface KanbanColumnProps {
  column: Column;
  activeTaskId: string | null;
  /** Task ids currently being deleted — shows a "Deleting…" overlay on those cards. */
  deletingTaskIds?: Set<string>;
  /** The current delete phase per task id — drives the phase-specific overlay text. */
  deletePhases?: Map<string, DeletePhase>;
  /** A delete failure reason per task id — shows the "Deletion Failed" state. */
  deleteErrors?: Map<string, string>;
  onEdit?: (task: Task) => void;
  onRetryDelete?: (taskId: string) => void;
  onCancelDelete?: (taskId: string) => void;
}

/* Status-aware quiet indicator — a small, solid dot gives each column a
 * calm identity. No gradient, no glow: the dot is a structural signal, the
 * way Linear marks a lane. */
const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "bg-slate-500",
  in_progress: "bg-blue-400",
  review: "bg-amber-400",
  done: "bg-emerald-400",
};

export function KanbanColumn({ column, activeTaskId, deletingTaskIds, deletePhases, deleteErrors, onEdit, onRetryDelete, onCancelDelete }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  return (
    <div
      ref={setNodeRef}
      data-drop-status={column.status}
      className={`kb-glass-sm flex flex-col rounded-[18px] p-4 transition-all duration-200 ${
        isOver ? "kb-drop-target" : ""
      }`}
    >
      {/* Column header — a quiet status dot, the lane title, and a count
          badge. The dot is a structural signal, not a decorative gradient. */}
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[column.status]}`} />
          <h3 className="text-[0.8125rem] font-bold uppercase tracking-[0.14em] text-slate-300">
            {column.title}
          </h3>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/[0.05] px-2 text-xs font-semibold tabular-nums text-slate-400 ring-1 ring-white/[0.08]">
          {column.tasks.length}
        </span>
      </div>

      {/* Task list */}
      <div className="kb-scroll flex flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {column.tasks.length === 0 ? (
          <EmptyState columnTitle={column.title} />
        ) : (
          column.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isDragging={activeTaskId === task.id}
              deleting={deletingTaskIds?.has(task.id) ?? false}
              deletePhase={deletePhases?.get(task.id)}
              deleteError={deleteErrors?.get(task.id)}
              onEdit={onEdit}
              onRetryDelete={onRetryDelete}
              onCancelDelete={onCancelDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
