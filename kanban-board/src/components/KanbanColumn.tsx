/**
 * KanbanColumn — a single board column.
 *
 * Semi-transparent glass background, blur backdrop, subtle border, colored
 * status indicator, task counter badge, and a column shadow. Drop target for
 * drag-and-drop moves.
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

const STATUS_COLORS: Record<TaskStatus, { dot: string; glow: string }> = {
  todo: { dot: "bg-slate-400", glow: "shadow-slate-400/30" },
  in_progress: { dot: "bg-blue-500", glow: "shadow-blue-500/40" },
  review: { dot: "bg-amber-500", glow: "shadow-amber-500/40" },
  done: { dot: "bg-emerald-500", glow: "shadow-emerald-500/40" },
};

export function KanbanColumn({ column, activeTaskId, onCreate }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const color = STATUS_COLORS[column.status];

  return (
    <div
      ref={setNodeRef}
      className={`kb-glass flex flex-col rounded-3xl p-3 transition-all duration-200 ${
        isOver ? "kb-drop-target" : ""
      }`}
    >
      {/* Column header */}
      <div className="mb-3 flex items-center justify-between px-1.5">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2.5 w-2.5 rounded-full ${color.dot} shadow-lg ${color.glow}`}
          />
          <h3 className="text-sm font-semibold tracking-tight text-slate-100">
            {column.title}
          </h3>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-700/50 px-2 text-xs font-semibold tabular-nums text-slate-300 ring-1 ring-slate-600/30">
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
