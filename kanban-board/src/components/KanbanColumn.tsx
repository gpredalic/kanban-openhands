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

/* Status-aware gradient accent — the column header's left bar gives each
 * column a branded, Apple-like identity instead of a bare dot. */
const STATUS_ACCENT: Record<TaskStatus, string> = {
  todo: "from-slate-400 to-slate-500",
  in_progress: "from-blue-400 to-indigo-500",
  review: "from-amber-400 to-orange-500",
  done: "from-emerald-400 to-teal-500",
};

export function KanbanColumn({ column, activeTaskId, agents = [], deletingTaskIds, deletePhases, deleteErrors, onEdit, onDelete, onRetryDelete, onCancelDelete }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });

  return (
    <div
      ref={setNodeRef}
      data-drop-status={column.status}
      className={`kb-glass-sm flex flex-col rounded-[18px] p-4 transition-all duration-200 ${
        isOver ? "kb-drop-target" : ""
      }`}
    >
      {/* Column header — a gradient status bar on the left, the lane title,
          and a count badge. The gradient bar gives each column a branded,
          Apple-like identity instead of a bare dot. */}
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-2.5">
          <span className={`h-4 w-1 rounded-full bg-gradient-to-b ${STATUS_ACCENT[column.status]}`} />
          <h3 className="text-[0.8125rem] font-semibold uppercase tracking-[0.14em] text-slate-300">
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
