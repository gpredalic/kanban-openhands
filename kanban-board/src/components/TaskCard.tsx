/**
 * TaskCard — a premium glass task card.
 *
 * Shows: priority badge, title, description, tags, progress indicator, due
 * date, blocked state, and assignee avatar. Draggable via dnd-kit. Glass
 * surface with a hover highlight (border + soft indigo glow). No scale
 * transform on hover — scaling would overflow the column and create a
 * horizontal scrollbar.
 */

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState, useRef, useEffect, type CSSProperties } from "react";
import { Calendar, AlertTriangle, Pencil, Trash2, RotateCcw, XCircle, Bot, Lock } from "lucide-react";
import type { Task, DeletePhase } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import { dueState } from "../lib/date";
import { Badge, statusBadge, priorityBadge } from "../lib/badges";

interface TaskCardProps {
  task: Task;
  agents?: Agent[];
  isDragging: boolean;
  /** True when this card is the DragOverlay clone (rendered outside the column). */
  isOverlay?: boolean;
  /** True while the task is being deleted — shows a visible "Deleting…" overlay. */
  deleting?: boolean;
  /** The current delete phase, driving the phase-specific overlay text. */
  deletePhase?: DeletePhase;
  /** Present when a delete failed — shows the "Deletion Failed" state. */
  deleteError?: string;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onRetryDelete?: (taskId: string) => void;
  onCancelDelete?: (taskId: string) => void;
}

/** Phase-specific overlay copy for the transaction-based delete flow. */
const DELETE_PHASE_TEXT: Record<DeletePhase, string> = {
  deleting: "Deleting Task…",
  removing_conversation: "Removing conversation…",
  syncing: "Synchronizing…",
  fading: "Removing…",
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

function TaskCardInner({ task, agents = [], isDragging, isOverlay = false, deleting = false, deletePhase, deleteError, onEdit, onDelete, onRetryDelete, onCancelDelete }: TaskCardProps) {
  // Disable dragging while a delete is in flight or has failed — the card is
  // locked to its column during the transaction.
  const locked = deleting || Boolean(deleteError);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
    // The DragOverlay clone is a pure visual — it must not register itself as
    // a second draggable with the same id (that would double-handle pointer
    // events and fight the original card's drag).
    disabled: locked || isOverlay,
  });
  // Capture dnd-kit's pointer-down handler so we can chain our own position
  // recording onto it without overwriting it (the spread would otherwise
  // replace it and break dragging).
  const dndOnPointerDown = listeners?.onPointerDown;

  // DragOverlay pattern: the original card stays in the column as an invisible
  // placeholder (preserving layout), while a floating clone rendered by the
  // board's <DragOverlay> follows the pointer. The clone is never clipped by
  // the column's overflow container and always sits above all UI.
  const style = isOverlay
    ? { zIndex: 9999 }
    : {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
      };

  const priority = task.priority ?? "medium";
  const pStyle = priorityBadge(priority);
  const due = task.dueDate ? dueState(task.dueDate, task.status) : "none";
  const progress = task.progress ?? 0;
  const assignedAgent = task.agentId ? agents.find((agent) => agent.id === task.agentId) : undefined;
  const executionStatus = (task as EnrichedTask).ai?.executionStatus;
  // A task is "running" (and therefore edit-locked) when it is actively
  // executing or waiting to start. OpenHands reports `executing`/`started`
  // as `running` (normalized by mapStatus) and `paused` as `queued`, so this
  // single check covers running / queued / executing / started.
  const running = executionStatus === "running" || executionStatus === "queued";

  // Pointer-down position, used to distinguish a click (open the detail modal)
  // from a drag (move the card). dnd-kit owns the drag; we only open the modal
  // when the pointer barely moved between down and up. We use onPointerUp
  // (not onClick) because dnd-kit's pointer capture suppresses the click event.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  // Track whether a drag actually started so a drag-release doesn't open the
  // modal. dnd-kit sets isDragging when the drag activates.
  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);

  // Shared badge styling for the execution status (dot + Title Case label).
  const statusStyle = statusBadge(executionStatus);

  // Status-aware glow color — the card's ambient glow matches its status.
  // done → green, review → orange, in_progress → blue, todo → slate,
  // blocked → red, waiting → yellow. Falls back to neutral indigo.
  const glowColor = (() => {
    if (task.status === "done") return "var(--kb-glow-done)";
    if (task.status === "review") return "var(--kb-glow-review)";
    if (task.status === "in_progress") return "var(--kb-glow-progress)";
    if (task.status === "todo") return "var(--kb-glow-todo)";
    if (executionStatus === "failed") return "var(--kb-glow-blocked)";
    if (executionStatus === "queued") return "var(--kb-glow-waiting)";
    return "var(--kb-glow-neutral)";
  })();

  // Lifecycle animation tracking: detect status changes, completions, and
  // failures so the card can flash the appropriate animation class.
  const prevStatus = useRef(task.status);
  const prevExecStatus = useRef(executionStatus);
  const [animClass, setAnimClass] = useState("");

  useEffect(() => {
    const prevS = prevStatus.current;
    const prevE = prevExecStatus.current;
    prevStatus.current = task.status;
    prevExecStatus.current = executionStatus;

    // Status changed to "done" → green completion flash.
    if (prevS !== "done" && task.status === "done") {
      setAnimClass("kb-complete");
      return;
    }
    // Execution failed → red shake.
    if (prevE !== "failed" && executionStatus === "failed") {
      setAnimClass("kb-failed");
      return;
    }
    // Column move (status changed, not done/failed) → indigo pulse.
    if (prevS !== task.status) {
      setAnimClass("kb-status-changed");
      return;
    }
    setAnimClass("");
  }, [task.status, executionStatus]);

  // Clear the animation class after the animation finishes so it can
  // re-trigger on the next status change.
  useEffect(() => {
    if (!animClass) return;
    const timer = setTimeout(() => setAnimClass(""), 900);
    return () => clearTimeout(timer);
  }, [animClass]);

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      style={{ ...style, "--kb-card-glow": glowColor, "--kb-running-accent": glowColor } as unknown as CSSProperties}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        // Chain dnd-kit's handler (so dragging still works) and record the
        // pointer-down position so the click handler can tell a click (open
        // the modal) from a drag.
        dndOnPointerDown?.(e);
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        // Use onPointerUp (not onClick): dnd-kit's pointerdown handler calls
        // preventDefault, which suppresses the click event, so a plain onClick
        // never fires. We open the detail modal — which surfaces the live
        // OpenHands execution state — only for a genuine card-body click:
        //   - pointerDownPos is set  → the card itself received pointerdown
        //     (a child button stops pointerdown propagation, so a button click
        //     leaves it null and is skipped here).
        //   - the pointer barely moved and no drag started → it's a click.
        const down = pointerDownPos.current;
        pointerDownPos.current = null;
        if (!down) return; // a child button handled the pointerdown
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const wasDrag = draggedRef.current;
        draggedRef.current = false;
        if (deleting || deleteError) return;
        if (moved > 5 || wasDrag) return;
        onEdit?.(task);
      }}
      className={`kb-glass kb-card kb-fade-in group cursor-grab rounded-[20px] p-4 active:cursor-grabbing ${
        isOverlay ? "kb-dragging kb-drag-overlay" : isDragging ? "kb-drag-placeholder" : ""
      } ${deleting ? "opacity-60" : ""} ${deleteError ? "kb-delete-failed" : ""} ${deletePhase === "fading" ? "kb-delete-fading" : ""} ${running ? "kb-running" : ""} ${animClass}`}
    >
      {deleteError ? (
        // Deletion failed — the task was NOT removed. Show the reason and
        // Retry / Cancel so the user can recover.
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-slate-950/85 p-4 text-center backdrop-blur-sm">
          <XCircle className="h-6 w-6 text-rose-400" strokeWidth={2} />
          <span className="text-sm font-semibold text-rose-300">Deletion Failed</span>
          <span className="max-w-full break-words text-[11px] leading-snug text-slate-400">{deleteError}</span>
          <div className="mt-1 flex items-center gap-2">
            {onRetryDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetryDelete(task.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs font-semibold text-rose-200 ring-1 ring-rose-400/30 transition-colors hover:bg-rose-500/30"
                aria-label="Retry deletion"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
                Retry
              </button>
            )}
            {onCancelDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelDelete(task.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/10"
                aria-label="Cancel deletion"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : deleting ? (
        // In-flight delete — phase-specific text, spinner, reduced opacity,
        // all interactions disabled.
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-slate-950/70 backdrop-blur-sm">
          <svg className="h-5 w-5 animate-spin text-rose-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-sm font-semibold text-rose-300">
            {deletePhase ? DELETE_PHASE_TEXT[deletePhase] : "Deleting…"}
          </span>
          {/* Progress indicator */}
          <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
              style={{
                width:
                  deletePhase === "deleting"
                    ? "25%"
                    : deletePhase === "removing_conversation"
                      ? "55%"
                      : deletePhase === "syncing"
                        ? "80%"
                        : "100%",
              }}
            />
          </div>
        </div>
      ) : null}
      {/* Top row: status badge + priority badge + blocked + tags */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        {statusStyle && (
          <Badge style={statusStyle} pulse={running} />
        )}
        <Badge style={pStyle} />
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

      {/* Editing locked while the task is running / queued / executing / started. */}
      {running && (
        <div className="mb-2.5 flex items-center gap-2 rounded-xl bg-blue-500/10 px-3 py-2 text-[11px] font-medium text-blue-300 ring-1 ring-blue-500/20">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          Task is currently running and cannot be edited.
        </div>
      )}

      {/* Title */}
      <h4 className="mb-1.5 text-sm font-semibold leading-snug text-slate-100 line-clamp-2">
        {task.title}
      </h4>

      {/* Assigned agent — avatar, name, role, and running indicator */}
      {assignedAgent && (
        <div className="mb-2 flex items-center gap-2">
          <div
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white shadow-md ring-2 ring-white/10 ${avatarColor(assignedAgent.name)}`}
            title={assignedAgent.name}
          >
            <Bot className="h-3.5 w-3.5" strokeWidth={2} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1 text-[11px] font-medium text-indigo-300">
              <span className="truncate">{assignedAgent.name}</span>
              {running && (
                <span className="kb-sync-dot h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
              )}
            </span>
            {assignedAgent.role && (
              <span className="truncate text-[10px] text-slate-500">
                {assignedAgent.role}
              </span>
            )}
          </div>
        </div>
      )}

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
              className="h-full rounded-full bg-gradient-to-r from-[#0A84FF] to-[#5E5CE6] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Bottom row: due date + actions */}
      <div className="mt-3 flex items-center justify-between">
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
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                disabled={running}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={running ? "Task is running — editing locked" : "Edit task"}
                title={running ? "Task is currently running and cannot be edited." : "Edit task"}
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
                disabled={running}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={running ? "Task is running — stop it before deleting" : "Delete task"}
                title={running ? "Stop the task before deleting it." : "Delete task"}
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

/**
 * Memoized TaskCard. The board re-renders on every poll and every state change,
 * but a card whose task object, drag state, and delete state are unchanged
 * should not re-render. This is what makes the identity-stabilization in
 * applyAiOverlay / enrichedTasks pay off: unchanged cards skip the render
 * entirely, so their CSS animations (progress shimmer, status pulse) are not
 * restarted and the board does not visibly reflash.
 *
 * Props are compared by reference. The task object is identity-stable (see
 * applyAiOverlay), the callback props are useCallback-stable (see KanbanBoard),
 * and the boolean/phase props only change for the affected card.
 */
export const TaskCard = memo(TaskCardInner);
