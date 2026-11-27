/**
 * TaskCard — a fixed-size editorial task card.
 *
 * Every card is the same height, padding, and radius. The composition is
 * deliberately minimal:
 *
 *   Title            Nunito Bold, the only bold text on the card
 *   Status           a small dot + label for the execution state
 *
 * No description, no progress bar, no footer metadata. The card is a pure
 * editorial surface. Clicking the card opens the Task Detail Inspector, which
 * carries Edit and Delete.
 *
 * Draggable via dnd-kit. Glass surface with a hover highlight (border + soft
 * status glow). No scale transform on hover — scaling would overflow the
 * column and create a horizontal scrollbar.
 */

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { memo, useState, useRef, useEffect, type CSSProperties } from "react";
import { RotateCcw, XCircle } from "lucide-react";
import type { Task, DeletePhase } from "../types/task";
import type { EnrichedTask } from "../types/ai";

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

/** Execution status → dot color + label. */
const EXEC_STATUS: Record<string, { dot: string; label: string }> = {
  pending:   { dot: "bg-slate-400",   label: "Pending" },
  queued:    { dot: "bg-amber-400",   label: "Queued" },
  running:   { dot: "bg-blue-400",    label: "Running" },
  completed: { dot: "bg-emerald-400", label: "Completed" },
  failed:    { dot: "bg-rose-400",    label: "Failed" },
  cancelled: { dot: "bg-slate-500",   label: "Cancelled" },
};

function TaskCardInner({ task, isDragging, isOverlay = false, deleting = false, deletePhase, deleteError, onEdit, onRetryDelete, onCancelDelete }: TaskCardProps) {
  const locked = deleting || Boolean(deleteError);
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: task.id,
    disabled: locked || isOverlay,
  });
  const dndOnPointerDown = listeners?.onPointerDown;

  const style = isOverlay
    ? { zIndex: 9999 }
    : {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0 : undefined,
      };

  const executionStatus = (task as EnrichedTask).ai?.executionStatus;
  const running = executionStatus === "running" || executionStatus === "queued";

  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    if (isDragging) draggedRef.current = true;
  }, [isDragging]);

  const glowColor = (() => {
    if (task.status === "done") return "var(--kb-glow-done)";
    if (task.status === "review") return "var(--kb-glow-review)";
    if (task.status === "in_progress") return "var(--kb-glow-progress)";
    if (task.status === "todo") return "var(--kb-glow-todo)";
    if (executionStatus === "failed") return "var(--kb-glow-blocked)";
    if (executionStatus === "queued") return "var(--kb-glow-waiting)";
    return "var(--kb-glow-neutral)";
  })();

  const prevStatus = useRef(task.status);
  const prevExecStatus = useRef(executionStatus);
  const [animClass, setAnimClass] = useState("");

  useEffect(() => {
    const prevS = prevStatus.current;
    const prevE = prevExecStatus.current;
    prevStatus.current = task.status;
    prevExecStatus.current = executionStatus;

    if (prevS !== "done" && task.status === "done") {
      setAnimClass("kb-complete");
      return;
    }
    if (prevE !== "failed" && executionStatus === "failed") {
      setAnimClass("kb-failed");
      return;
    }
    if (prevS !== task.status) {
      setAnimClass("kb-status-changed");
      return;
    }
    setAnimClass("");
  }, [task.status, executionStatus]);

  useEffect(() => {
    if (!animClass) return;
    const timer = setTimeout(() => setAnimClass(""), 900);
    return () => clearTimeout(timer);
  }, [animClass]);

  const execInfo = executionStatus ? EXEC_STATUS[executionStatus] : null;

  return (
    <div
      ref={setNodeRef}
      data-task-id={task.id}
      style={{ ...style, "--kb-card-glow": glowColor, "--kb-running-accent": glowColor } as unknown as CSSProperties}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        dndOnPointerDown?.(e);
        pointerDownPos.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const down = pointerDownPos.current;
        pointerDownPos.current = null;
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        const wasDrag = draggedRef.current;
        draggedRef.current = false;
        if (deleting || deleteError) return;
        if (moved > 5 || wasDrag) return;
        onEdit?.(task);
      }}
      className={`kb-glass kb-card kb-fade-in group relative flex h-[96px] cursor-grab flex-col justify-between rounded-[18px] p-5 active:cursor-grabbing ${
        isOverlay ? "kb-dragging kb-drag-overlay" : isDragging ? "kb-drag-placeholder" : ""
      } ${deleting ? "opacity-60" : ""} ${deleteError ? "kb-delete-failed" : ""} ${deletePhase === "fading" ? "kb-delete-fading" : ""} ${running ? "kb-running" : ""} ${animClass}`}
    >
      {deleteError ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[18px] bg-slate-950/85 p-3 text-center backdrop-blur-sm">
          <XCircle className="h-5 w-5 text-rose-400" strokeWidth={2} />
          <span className="text-xs font-semibold text-rose-300">Deletion Failed</span>
          <span className="max-w-full break-words text-[10px] leading-snug text-slate-400">{deleteError}</span>
          <div className="mt-1 flex items-center gap-2">
            {onRetryDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRetryDelete(task.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-lg bg-rose-500/20 px-2.5 py-1 text-[11px] font-semibold text-rose-200 ring-1 ring-rose-400/30 transition-colors hover:bg-rose-500/30"
                aria-label="Retry deletion"
              >
                <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
                Retry
              </button>
            )}
            {onCancelDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCancelDelete(task.id); }}
                onPointerDown={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/10"
                aria-label="Cancel deletion"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : deleting ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-[18px] bg-slate-950/70 backdrop-blur-sm">
          <svg className="h-4 w-4 animate-spin text-rose-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          <span className="text-xs font-semibold text-rose-300">
            {deletePhase ? DELETE_PHASE_TEXT[deletePhase] : "Deleting…"}
          </span>
          <div className="h-0.5 w-24 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
              style={{
                width:
                  deletePhase === "deleting" ? "25%"
                  : deletePhase === "removing_conversation" ? "55%"
                  : deletePhase === "syncing" ? "80%"
                  : "100%",
              }}
            />
          </div>
        </div>
      ) : null}

      {/* Title — the editorial hero. Nunito Bold. */}
      <h4 className="kb-type-card text-slate-50 line-clamp-2">
        {task.title}
      </h4>

      {/* Status — a quiet dot + label. Always present for consistent rhythm. */}
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${execInfo?.dot ?? "bg-slate-600"}`} />
        <span className="text-[0.6875rem] font-normal text-slate-500">
          {execInfo?.label ?? "—"}
        </span>
      </div>
    </div>
  );
}

export const TaskCard = memo(TaskCardInner);
