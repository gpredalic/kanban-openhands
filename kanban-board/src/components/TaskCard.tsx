/**
 * TaskCard — an editorial task card.
 *
 * The composition is deliberately quiet so the title reads as the hero:
 *
 *   Title            Nunito Bold, the only bold text on the card
 *   Description      one muted line, clamped
 *   Progress         a hairline bar (no label) when present
 *   Footer           one row — identity (agent/assignee) on the left,
 *                    blocked / progress % / due date on the right
 *
 * Edit and delete reveal on hover (opacity, not display) so the resting card
 * stays clean while the actions remain clickable and discoverable. Status and
 * priority are no longer rendered as pills on the card — the column already
 * communicates status, and the detail modal carries the full badge set.
 *
 * Draggable via dnd-kit. Glass surface with a hover highlight (border + soft
 * status glow). No scale transform on hover — scaling would overflow the
 * column and create a horizontal scrollbar.
 */

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState, useRef, useEffect, type CSSProperties } from "react";
import { Calendar, AlertTriangle, RotateCcw, XCircle } from "lucide-react";
import type { Task, DeletePhase } from "../types/task";
import type { EnrichedTask } from "../types/ai";
import { dueState } from "../lib/date";

interface TaskCardProps {
  task: Task;
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

/**
 * Agent identity is deliberately hidden from the board card. The card shows
 * only the task title and essential status (progress, blocked, due date).
 * Agent, owner, description, and full activity history surface when the task
 * is opened in the detail modal — the way Linear keeps the board quiet and the
 * detail view rich.
 */

function formatDue(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function TaskCardInner({ task, isDragging, isOverlay = false, deleting = false, deletePhase, deleteError, onEdit, onRetryDelete, onCancelDelete }: TaskCardProps) {
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

  const due = task.dueDate ? dueState(task.dueDate, task.status) : "none";
  const progress = task.progress ?? 0;
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
      className={`kb-glass kb-card kb-fade-in group relative flex min-h-[140px] cursor-grab flex-col rounded-[18px] p-6 active:cursor-grabbing ${
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
      {/* Title — the editorial hero. Nunito Bold anchors the card; everything
          else is quiet metadata that supports it. */}
      <h4 className="kb-type-card mb-3 text-slate-50 line-clamp-2">
        {task.title}
      </h4>

      {/* Description — quiet body text, one muted line. */}
      {task.description && (
        <p className="kb-type-body mb-4 text-slate-500 line-clamp-2">
          {task.description}
        </p>
      )}

      {/* Progress — a quiet hairline, no label, no gradient. A solid, muted
          fill reads as a calm signal. The number lives in the footer. */}
      {progress > 0 && (
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/5">
          <div
            className="h-full rounded-full bg-slate-500/70 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Footer — one quiet row of status signals: blocked, progress, due date.
          Identity (agent / owner) is intentionally absent from the card; it
          surfaces in the detail modal. The card is a pure editorial surface at
          rest — no menu, no icon buttons. Clicking the card opens the Task
          Detail Inspector, which carries Edit and Delete. */}
      <div className="mt-auto flex items-center justify-end gap-2 pt-3">
        <div className="flex shrink-0 items-center gap-2">
          {task.waitingOn && task.waitingOn.length > 0 && (
            <span
              className="flex items-center gap-1 text-[0.6875rem] font-normal text-rose-400/80"
              title={`Waiting on ${task.waitingOn.length} task(s)`}
            >
              <AlertTriangle className="h-3 w-3" />
              Blocked
            </span>
          )}
          {progress > 0 && (
            <span className="text-[0.6875rem] font-normal tabular-nums text-slate-600">
              {progress}%
            </span>
          )}
          {task.dueDate && (
            <span
              className={`flex items-center gap-1 text-[0.6875rem] font-normal ${
                due === "overdue"
                  ? "text-rose-400/80"
                  : due === "soon"
                    ? "text-amber-400/80"
                    : "text-slate-600"
              }`}
            >
              <Calendar className="h-3 w-3" />
              {formatDue(task.dueDate)}
            </span>
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
