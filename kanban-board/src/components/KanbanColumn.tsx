/**
 * KanbanColumn — a single board column.
 *
 * Semi-transparent glass surface with a backdrop blur, a subtle border, a
 * colored status indicator, a task counter badge, and a column shadow.
 * Drop target for drag-and-drop moves. Resembles Linear / Jira Cloud.
 */

import { useDroppable } from "@dnd-kit/core";
import type { Column, TaskStatus } from "../types/task";
import { TaskCard } from "./TaskCard";
import { AddTaskCard } from "./AddTaskCard";
import { EmptyState } from "./EmptyState";

interface KanbanColumnProps {
  column: Column;
  activeTaskId: string | null;
  onCreate: (title: string, status: TaskStatus) => void;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: "bg-slate-400",
  in_progress: "bg-blue-500",
  review: "bg-amber-500",
  done: "bg-emerald-500",
};

export function KanbanColumn({ column, activeTaskId, onCreate }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const dot = STATUS_COLORS[column.status];

  return (
    <div
      ref={setNodeRef}
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
              isDragging={activeTaskId === task.id}
            />
          ))
        )}
      </div>

      {/* Add task */}
      <div className="mt-3">
        <AddTaskCard
          status={column.status}
          columnTitle={column.title}
          onCreate={onCreate}
        />
      </div>
    </div>
  );
}
