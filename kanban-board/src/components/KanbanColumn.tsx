/**
 * KanbanColumn — a single board column.
 *
 * Semi-transparent glass surface with a backdrop blur, a subtle border, a
 * colored status indicator, a task counter badge, and a column shadow.
 * Drop target for drag-and-drop moves. Resembles Linear / Jira Cloud.
 */

import { useDroppable } from "@dnd-kit/core";
import type { Column, Task, TaskStatus, DeletePhase } from "../types/task";
import type { Agent } from "../types/ai";
import { TaskCard } from "./TaskCard";
import { EmptyState } from "./EmptyState";

interface KanbanColumnProps {
  column: Column;
  activeTaskId: string | null;
  agents?: Agent[];
  /** Task ids currently being deleted — shows a "Deleting…" overlay on those cards. */
  deletingTaskIds?: Set<string>;
  /** The current delete phase per task id — drives the phase-specific overlay text. */
  deletePhases?: Map<string, DeletePhase>;
  /** A delete failure reason per task id — shows the "Deletion Failed" state. */
  deleteErrors?: Map<string, string>;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onRetryDelete?: (taskId: string) => void;
  onCancelDelete?: (taskId: string) => void;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-blue-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};

export function KanbanColumn({ column, activeTaskId, agents = [], deletingTaskIds, deletePhases, deleteErrors, onEdit, onDelete, onRetryDelete, onCancelDelete }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const dot = STATUS_COLORS[column.status];

  return (
    <div
      ref={setNodeRef}
      data-drop-status={column.status}
      className={`kb-glass flex flex-col rounded-2xl p-3 transition-all duration-200 ${
        isOver ? "kb-drop-target" : ""
      }`}
    >
      {/* Column header */}
      <div className="mb-3 flex items-center justify-between px-1.5">
        <div className="flex items-center gap-2.5">
          <span className={`h-2.5 w-2.5 rounded-full ${dot} shadow-[0_0_10px_rgba(99,102,241,0.55)]`} />
          <h3 className="text-sm font-semibold tracking-tight text-slate-200">
            {column.title}
          </h3>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/5 px-2 text-xs font-semibold tabular-nums text-slate-400 ring-1 ring-white/10">
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
              agents={agents}
              isDragging={activeTaskId === task.id}
              deleting={deletingTaskIds?.has(task.id) ?? false}
              deletePhase={deletePhases?.get(task.id)}
              deleteError={deleteErrors?.get(task.id)}
              onEdit={onEdit}
              onDelete={onDelete}
              onRetryDelete={onRetryDelete}
              onCancelDelete={onCancelDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
