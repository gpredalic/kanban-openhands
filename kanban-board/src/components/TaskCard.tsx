/**
 * TaskCard — a premium glass task card.
 *
 * Shows: priority badge, title, description, tags, progress indicator, due
 * date, blocked state, and assignee avatar. Draggable via dnd-kit. Glass
 * surface with a hover lift (scale 1.02) and a soft indigo glow.
 */

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Calendar, AlertTriangle, Pencil, Trash2, Play, Square } from "lucide-react";
import type { Task, TaskPriority } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import { dueState } from "../lib/date";

interface TaskCardProps {
  task: Task;
  agents?: Agent[];
  isDragging: boolean;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onTaskRun?: (task: EnrichedTask) => void;
  onTaskStop?: (task: EnrichedTask) => void;
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

export function TaskCard({ task, agents = [], isDragging, onEdit, onDelete, onTaskRun, onTaskStop }: TaskCardProps) {
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
  const assignedAgent = task.agentId ? agents.find((agent) => agent.id === task.agentId) : undefined;
  const executionStatus = (task as EnrichedTask).ai?.executionStatus;

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      style={style}
      {...attributes}
      {...listeners}
      className={`kb-glass kb-card kb-fade-in group cursor-grab rounded-2xl p-4 active:cursor-grabbing ${
        isDragging ? "kb-dragging" : ""
      }`}
    >
      {/* Top row: priority badge + blocked + tags */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {executionStatus && (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
            executionStatus === "completed"
              ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20"
              : executionStatus === "running"
                ? "bg-blue-500/10 text-blue-400 ring-blue-500/20"
                : executionStatus === "failed" || executionStatus === "cancelled"
                  ? "bg-rose-500/10 text-rose-400 ring-rose-500/20"
                  : "bg-violet-500/10 text-violet-400 ring-violet-500/20"
          }`}>
            {executionStatus}
          </span>
        )}
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

      {/* Bottom row: due date + actions + avatar */}
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
        <div className="flex items-center gap-1.5">
          {assignedAgent && (
            <span
              className={`flex h-7 items-center gap-1.5 rounded-full bg-gradient-to-br ${assignedAgent.avatar} px-2 text-[10px] font-semibold text-white ring-1 ring-white/20`}
              aria-label={`Assigned AI agent: ${assignedAgent.name}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/20">
                {initials(assignedAgent.name)}
              </span>
              {assignedAgent.name}
            </span>
          )}
          <div className="flex items-center gap-1">
            {(onTaskRun || onTaskStop) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const running = executionStatus === "running" || executionStatus === "queued";
                  if (running) onTaskStop?.(task as EnrichedTask);
                  else onTaskRun?.(task as EnrichedTask);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold ring-1 transition-colors ${
                  executionStatus === "running" || executionStatus === "queued"
                    ? "bg-rose-500/15 text-rose-300 ring-rose-400/30 hover:bg-rose-500/25"
                    : "bg-blue-500/15 text-blue-300 ring-blue-400/30 hover:bg-blue-500/25"
                }`}
                aria-label={executionStatus === "running" || executionStatus === "queued" ? "Stop AI for this task" : "Run AI for this task"}
              >
                {executionStatus === "running" || executionStatus === "queued" ? (
                  <Square className="h-3 w-3" strokeWidth={2.5} />
                ) : (
                  <Play className="h-3 w-3" strokeWidth={2.5} />
                )}
                {executionStatus === "running" || executionStatus === "queued" ? "Stop AI" : "Run AI"}
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-slate-200"
                aria-label="Edit task"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-500/15 hover:text-rose-400"
                aria-label="Delete task"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
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
    </div>
  );
}
