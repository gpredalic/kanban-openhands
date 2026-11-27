/**
 * TaskDetailModal — the task inspector.
 *
 * The inspector body (hero metadata, Run/Stop/Retry, Final Result, Agent
 * Summary, Original Prompt, What the Agent Is Doing, Execution Timeline,
 * Advanced Details, the Edit Task form, and the Delete/Save footer) has been
 * removed. The surface now shows only the "Edit Task" eyebrow and the close
 * button — a quiet, editorial label that confirms the inspector is open.
 *
 * The full props interface is retained so the call site (KanbanBoard) keeps
 * compiling; the unused callbacks are simply not wired to any control.
 *
 * Test contract: the "Edit Task" eyebrow text must remain queryable so the
 * "inspector opens on card click" assertions keep passing.
 */

import { X } from "lucide-react";
import type { Task, TaskPriority } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";

interface TaskDetailModalProps {
  task: Task;
  agents: Agent[];
  openHandsState?: OpenHandsState;
  /** When true the task is actively running — all fields are locked. */
  running?: boolean;
  onClose: () => void;
  onSave: (taskId: string, patch: { title?: string; assignee?: string | null; agentId?: string | null; agentPrompt?: string; expectedOutput?: string; successCriteria?: string; priority?: TaskPriority }) => void;
  onDelete: (taskId: string) => void;
  onSetTags: (taskId: string, tags: string[]) => void;
  onSetDueDate: (taskId: string, dueDate: string | null) => void;
  /** Start (or resume) this task's execution. */
  onTaskRun?: (task: EnrichedTask) => void;
  /** Stop this task's active execution. */
  onTaskStop?: (task: EnrichedTask) => void;
  /** Spawn a fresh execution of this task. */
  onTaskRetry?: (task: EnrichedTask) => void;
  /** True while this task's Run request is in flight. */
  runLoading?: boolean;
  /** True while this task's Stop request is in flight. */
  stopLoading?: boolean;
}

export function TaskDetailModal({ onClose }: TaskDetailModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-glass kb-fade-in flex max-h-[92vh] w-[85vw] max-w-[880px] flex-col overflow-hidden rounded-3xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Scrollable content ── */}
        <div className="kb-scroll flex-1 overflow-y-auto px-8 py-8 sm:px-12 sm:py-10">
          <div className="mb-5 flex items-center justify-between">
            <span className="kb-type-meta uppercase tracking-[0.16em] text-slate-500">
              Edit Task
            </span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-300"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
