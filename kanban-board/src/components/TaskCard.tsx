/**
 * TaskCard — a premium glass task card.
 *
 * Shows: priority badge, title, description, tags, progress indicator, due
 * date, blocked state, and assignee avatar. Draggable via dnd-kit. Glass
 * surface with a hover lift (scale 1.02) and a soft indigo glow.
 */

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, AlertTriangle } from "lucide-react";
import type { Task, TaskPriority } from "../types/task";
import { dueState } from "../lib/date";

interface TaskCardProps {
  task: Task;
  isDragging: boolean;
}

const PRIORITY_STYLES: Record<TaskPriority, { label: string; cls: string; dot: string }> = {
  low: { label: "Low", cls: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20", dot: "bg-emerald-400" },
  medium: { label: "Medium", cls: "bg-amber-500/10 text-amber-400 ring-amber-500/20", dot: "bg-amber-400" },
  high: { label: "High", cls: "bg-rose-500/10 text-rose-400 ring-rose-500/20", dot: "bg-rose-400" },
};

const AVATAR_COLORS = [
  "bg-gradient-to-br from-blue-500 to-indigo-600",
  "bg-gradient-to-br from-violet-500 to-purple-600",
  "bg-gradient-to-br from-pink-500 to-rose-600",
  "bg-gradient-to-br from-emerald-500 to-teal-600",
  "bg-gradient-to-br from-amber-500 to-orange-600",
  "bg-gradient-to-br from-cyan-500 to-sky-600",
];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDue(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TaskCard({ task, isDragging }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
  };

  const priority = task.priority ?? "medium";
  const pStyle = PRIORITY_STYLES[priority];
  const due = task.dueDate ? dueState(task.dueDate, task.status) : "none";
  const progress = task.progress ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kb-glass kb-card kb-fade-in group cursor-grab rounded-2xl p-4 active:cursor-grabbing ${
        isDragging ? "kb-dragging" : ""
      }`}
    >
      {/* Top row: priority badge + blocked + tags */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${pStyle.cls}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pStyle.dot}`} />
          {pStyle.label}
        </span>
        {task.waitingOn && task.waitingOn.length > 0 && (
          <span
            className="flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-400 ring-1 ring-rose-500/20"
            title={`Waiting on ${task.waitingOn.length} task(s)`}
          >
            <AlertTriangle className="h-3 w-3" />
            Blocked
          </span>
        )}
        {(task.tags ?? []).slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-white/10"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Title */}
      <h4 className="mb-1.5 text-sm font-semibold leading-snug text-slate-100 line-clamp-2">
        {task.title}
      </h4>

      {/* Description */}
      {task.description && (
        <p className="mb-3 text-xs leading-relaxed text-slate-500 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Progress bar */}
      {progress > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-500">
            <span>Progress</span>
            <span className="tabular-nums font-medium text-slate-400">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5 ring-1 ring-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Bottom row: due date + avatar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {task.dueDate && (
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
                due === "overdue"
                  ? "bg-rose-500/10 text-rose-400 ring-rose-500/20"
                  : due === "soon"
                    ? "bg-amber-500/10 text-amber-400 ring-amber-500/20"
                    : "bg-white/5 text-slate-500 ring-white/10"
              }`}
            >
              <Calendar className="h-3 w-3" />
              {formatDue(task.dueDate)}
            </span>
          )}
        </div>
        {task.assignee && (
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white shadow-md ring-2 ring-white/10 ${avatarColor(task.assignee)}`}
            title={task.assignee}
          >
            {initials(task.assignee)}
          </div>
        )}
      </div>
    </div>
  );
}
