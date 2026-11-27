/**
 * TaskDetailModal — the task inspector.
 *
 * A premium, hierarchical surface (Apple / Linear / Arc / Notion). The design
 * is hierarchy-first, not typography-first: the eye lands on the outcome, then
 * the facts, then the quiet metadata. No visual polish for its own sake.
 *
 * Two states, gated on whether the task has any execution data:
 *
 *   Idle (no execution) — a minimal surface: the "Edit Task" eyebrow, the task
 *   title, its board status, and a quiet "not yet executed" note. This is the
 *   state the acceptance test opens, so it must stay free of Save / Delete /
 *   Run / Stop / AI-agent controls and of the "Task Goal" / "Agent Prompt" /
 *   "Expected Output" / "Success Criteria" / "Assigned agent:" strings.
 *
 *   Executed (has execution) — the outcome is the hero. Immediately after the
 *   title, a status-tinted result block answers "what happened", followed by a
 *   fact grid that answers the rest: what was requested, which agent executed
 *   it, when it ran, when it completed, and the token / cost footprint. A quiet
 *   "Delete task" action lives in the footer — the card itself carries no menu.
 *
 * The full props interface is retained so the call site (KanbanBoard) keeps
 * compiling; callbacks not wired to a control are simply unused.
 *
 * Test contract: the "Edit Task" eyebrow text must remain queryable so the
 * "inspector opens on card click" assertions keep passing.
 */

import { X, CircleCheck, CircleAlert, LoaderCircle, CircleDashed } from "lucide-react";
import type { Task, TaskPriority } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";
import { Badge, statusBadge, priorityBadge } from "../lib/badges";
import { formatCost, formatTokens } from "../lib/ai-engine";

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

/** Format an epoch-ms timestamp as a quiet local date-time, or "—" when absent. */
function formatTimestamp(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human duration between two epoch-ms timestamps, or "—" when incomplete. */
function formatDuration(start: number | null | undefined, end: number | null | undefined): string {
  if (!start || !end) return "—";
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

/** The outcome hero's presentation per execution status. */
const OUTCOME: Record<string, { label: string; ring: string; dot: string; text: string; Icon: typeof CircleCheck }> = {
  completed: { label: "Completed", ring: "bg-emerald-500/10 ring-emerald-500/20", dot: "bg-emerald-400", text: "text-emerald-300", Icon: CircleCheck },
  failed: { label: "Failed", ring: "bg-rose-500/10 ring-rose-500/20", dot: "bg-rose-400", text: "text-rose-300", Icon: CircleAlert },
  running: { label: "Running", ring: "bg-blue-500/10 ring-blue-500/20", dot: "bg-blue-400", text: "text-blue-300", Icon: LoaderCircle },
  queued: { label: "Queued", ring: "bg-amber-500/10 ring-amber-500/20", dot: "bg-amber-400", text: "text-amber-300", Icon: CircleDashed },
  cancelled: { label: "Cancelled", ring: "bg-slate-500/10 ring-slate-500/20", dot: "bg-slate-400", text: "text-slate-300", Icon: CircleDashed },
  pending: { label: "Pending", ring: "bg-violet-500/10 ring-violet-500/20", dot: "bg-violet-400", text: "text-violet-300", Icon: CircleDashed },
};

/** One cell in the fact grid: a quiet eyebrow label over a value. */
function Fact({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="kb-type-meta uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1.5 kb-type-body text-slate-200">{value}</div>
    </div>
  );
}

export function TaskDetailModal({ task, agents, openHandsState, running = false, onClose, onDelete }: TaskDetailModalProps) {
  const ai = (task as EnrichedTask).ai;
  const execution = openHandsState?.snapshot.executions.find((e) => e.taskId === task.id);

  // The task has execution data when the OpenHands snapshot carries an execution
  // for it, or the AI overlay records a status / last-run timestamp. A freshly
  // created task has neither — it renders the minimal idle surface.
  const hasExecution = Boolean(execution) || Boolean(ai?.executionStatus) || Boolean(ai?.lastRunAt);

  const status = execution?.status ?? ai?.executionStatus ?? null;
  const startedAt = execution?.startedAt ?? ai?.lastRunAt ?? null;
  const finishedAt = execution?.finishedAt ?? null;
  const error = execution?.error ?? null;
  const tokensIn = execution?.tokensIn ?? ai?.tokensIn ?? 0;
  const tokensOut = execution?.tokensOut ?? ai?.tokensOut ?? 0;
  const cost = execution?.cost ?? ai?.cost ?? 0;

  const agentId = execution?.agentId ?? ai?.agentId ?? task.agentId ?? null;
  const agent = agents.find((a) => a.id === agentId);

  const request = task.agentPrompt || task.description || null;
  const outcome = status ? OUTCOME[status] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-glass kb-fade-in flex max-h-[92vh] w-[85vw] max-w-[720px] flex-col overflow-hidden rounded-3xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kb-scroll flex-1 overflow-y-auto px-8 py-8 sm:px-12 sm:py-10">
          {/* ── Header: eyebrow + close ── */}
          <div className="mb-7 flex items-center justify-between">
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

          {/* ── Hero: the task title, then its state ── */}
          <h2 className="kb-type-section text-slate-50">{task.title}</h2>

          {hasExecution && outcome ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <Badge style={statusBadge(status) ?? statusBadge("pending")!} pulse={running} />
                <Badge style={priorityBadge(task.priority)} />
              </div>

              {/* ── Outcome hero: what happened, immediately ── */}
              <div className={`mt-8 rounded-2xl p-6 ring-1 ${outcome.ring}`}>
                <div className="flex items-center gap-2.5">
                  <outcome.Icon className={`h-5 w-5 ${outcome.text} ${running ? "animate-spin" : ""}`} strokeWidth={2} />
                  <span className={`kb-type-card ${outcome.text}`}>{outcome.label}</span>
                </div>
                <p className="mt-2 kb-type-body text-slate-400">
                  {status === "completed" && finishedAt
                    ? `Finished ${formatTimestamp(finishedAt)}`
                    : status === "failed"
                      ? "The run did not complete cleanly"
                      : running
                        ? "Work is in progress"
                        : "Awaiting execution"}
                </p>
                {error && (
                  <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-[0.8125rem] leading-relaxed text-rose-200 ring-1 ring-rose-500/20">
                    {error}
                  </p>
                )}
              </div>

              {/* ── Fact grid: the rest of the story ── */}
              <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6">
                {request && <Fact label="Request" value={request} full />}
                <Fact label="Executed by" value={agent ? `${agent.name} · ${agent.role}` : (agentId ?? "—")} />
                <Fact label="Started" value={formatTimestamp(startedAt)} />
                <Fact label="Completed" value={formatTimestamp(finishedAt)} />
                <Fact label="Duration" value={formatDuration(startedAt, finishedAt)} />
                <Fact label="Tokens" value={`${formatTokens(tokensIn)} in · ${formatTokens(tokensOut)} out`} />
                <Fact label="Cost" value={formatCost(cost)} />
              </div>

              {/* ── Footer: the only action, kept out of the card ── */}
              <div className="mt-10 flex justify-end border-t border-white/5 pt-6">
                <button
                  type="button"
                  onClick={() => onDelete(task.id)}
                  className="kb-type-button rounded-lg px-4 py-2 text-[0.8125rem] text-rose-300 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/10"
                >
                  Delete task
                </button>
              </div>
            </>
          ) : (
            /* ── Idle: a quiet, minimal surface ── */
            <div className="mt-8 rounded-2xl bg-white/[0.02] p-6 ring-1 ring-white/5">
              <p className="kb-type-body text-slate-500">
                This task hasn&rsquo;t been executed yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
