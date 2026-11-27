/**
 * TaskDetailModal — an outcome-centric inspector for a task.
 *
 * The primary purpose of this view is NOT to edit a task. It is to quickly
 * understand the OUTCOME of a task:
 *
 *   1. What was requested?          → Original Prompt
 *   2. Which agent executed it?     → Hero (Assigned agent / Last agent)
 *   3. When did it run?             → Hero (Created / Started)
 *   4. When was it completed?       → Hero (Completed)
 *   5. What was the final result?   → Final Result (the largest section)
 *
 * Hierarchy is outcome-first, execution-second, configuration-third:
 *
 *   HERO            — title, status, priority, agent, created, completed,
 *                     duration. The at-a-glance answer to "what happened?"
 *   FINAL RESULT    — the largest section on the page. The agent's final
 *                     output. The primary focus of the entire screen.
 *   AGENT SUMMARY   — a concise explanation of what happened.
 *   ORIGINAL PROMPT — the original task request.
 *   WHAT THE AGENT  — live activity while running; a quiet one-liner once
 *   IS DOING        — the task is done. De-emphasized for completed tasks.
 *   ADVANCED DETAILS— collapsed by default. Execution timeline + debug
 *                     metadata (tokens, cost, ids).
 *   EDIT TASK       — collapsed by default. The configuration form: task
 *                     goal, agent prompt, expected output, success criteria,
 *                     assignee, AI agent, priority, tags, due date.
 *
 * Collapsed sections use the `hidden` class (display:none), NOT conditional
 * rendering, so their content stays in the DOM. This preserves the test
 * contract: "Task Goal", "Advanced Details", "Assigned agent:", and
 * select[aria-label="AI agent"] must remain queryable even when collapsed.
 *
 * Typography contract (kb-type-* system):
 *   Title          → kb-type-display  (Bold 700, 2.5rem)
 *   Section titles → kb-type-section  (Bold 700, 1.375rem)
 *   Card titles    → kb-type-card     (Bold 700, 1.0625rem)
 *   Body text      → kb-type-body     (Regular 400, 0.875rem)
 *   Metadata       → kb-type-meta     (Regular 400, 0.6875rem)
 *   Buttons/labels → kb-type-button   (SemiBold 600)
 */

import { useState, useEffect, useMemo } from "react";
import { X, Trash2, Save, Tag, Calendar, User, Terminal, History, MessageSquare, Play, Square, RotateCcw, ChevronDown, ChevronUp, Target, ListChecks, Bot, FileText, ScrollText, Clock, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import type { Task, TaskStatus, TaskPriority } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import type { OpenHandsState, OpenHandsExecution } from "../types/openhands";
import { PRIORITY_STYLES, statusBadge } from "../lib/badges";
import { ConfirmActionModal } from "./ConfirmActionModal";

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

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

/** Format an epoch-ms timestamp as a short local string, or "—" when absent. */
function fmtTime(value?: number): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

/** Human elapsed time between two epoch-ms values, or "—" when incomplete. */
function fmtElapsed(startedAt?: number, endedAt?: number): string {
  if (!startedAt) return "—";
  const end = endedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Derive a 0–100 progress value from an execution's status. OpenHands does not
 * report a fractional progress, so progress is a status-derived indicator:
 * completed = 100, running = indeterminate (shown as an animated bar), and
 * queued/pending/failed/cancelled = 0.
 */
function executionProgress(execution?: OpenHandsExecution): number {
  if (!execution) return 0;
  if (execution.status === "completed") return 100;
  return 0;
}

export function TaskDetailModal({
  task,
  agents,
  openHandsState,
  running = false,
  onClose,
  onSave,
  onDelete,
  onSetTags,
  onSetDueDate,
  onTaskRun,
  onTaskStop,
  onTaskRetry,
  runLoading = false,
  stopLoading = false,
}: TaskDetailModalProps) {
  const [title, setTitle] = useState(task.title);
  const [agentPrompt, setAgentPrompt] = useState(task.agentPrompt ?? "");
  const [expectedOutput, setExpectedOutput] = useState(task.expectedOutput ?? "");
  const [successCriteria, setSuccessCriteria] = useState(task.successCriteria ?? "");
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [agentId, setAgentId] = useState(task.agentId ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task.priority ?? "medium");
  const [tags, setTags] = useState((task.tags ?? []).join(", "));
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Confirmation state for Stop / Run-Again actions.
  const [confirmAction, setConfirmAction] = useState<"stop" | "retry" | null>(null);
  // Collapsed-by-default sections. Toggled via the `hidden` class so the
  // content stays in the DOM (preserving the test contract).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  // Derive the execution + events for this task once, so every section reads
  // from the same stable values.
  const exec = useMemo(() => {
    const execution = openHandsState?.snapshot.executions.find(
      (run) => run.taskId === task.id || run.id === task.conversationId || run.id === task.executionId,
    );
    const events = (openHandsState?.snapshot.events ?? [])
      .filter((e) => e.taskId === task.id || e.executionId === task.conversationId || e.executionId === task.executionId)
      .sort((a, b) => b.at - a.at);
    const latest = events[0];
    const currentStep = latest?.title ?? "—";
    const latestMessage = latest?.detail ?? latest?.title ?? "—";
    const error = execution?.error ?? events.find((e) => e.type === "error")?.detail;
    const progress = executionProgress(execution);
    const isRunning = execution?.status === "running";
    const isCompleted = execution?.status === "completed";
    const statusStyle = statusBadge(execution?.status);
    // The final result is the agent's most recent message. For a completed
    // task this is the final response; for a running task it is the latest
    // activity. Falls back to the success criteria when no event exists.
    const finalResult = latest?.detail ?? latest?.title ?? task.successCriteria ?? "";
    // A concise summary of what happened: status, agent, duration, step count.
    const agentName = execution?.agentId
      ? agents.find((a) => a.id === execution.agentId)?.name ?? execution.agentId
      : execution?.profileId ?? "—";
    const duration = fmtElapsed(execution?.startedAt, execution?.finishedAt);
    const stepCount = events.length;
    return {
      execution, events, latest, currentStep, latestMessage, error, progress,
      isRunning, isCompleted, statusStyle, finalResult, agentName, duration, stepCount,
    };
  }, [openHandsState, task.id, task.conversationId, task.executionId, task.successCriteria, agents]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    const trimmedAssignee = assignee.trim() || null;
    const trimmedPrompt = agentPrompt.trim();
    const trimmedExpected = expectedOutput.trim();
    const trimmedCriteria = successCriteria.trim();
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const trimmedAgentId = agentId || null;
    if (
      trimmedTitle !== task.title ||
      trimmedAssignee !== (task.assignee ?? null) ||
      trimmedAgentId !== (task.agentId ?? null) ||
      trimmedPrompt !== (task.agentPrompt ?? "") ||
      trimmedExpected !== (task.expectedOutput ?? "") ||
      trimmedCriteria !== (task.successCriteria ?? "") ||
      priority !== (task.priority ?? "medium")
    ) {
      onSave(task.id, {
        title: trimmedTitle !== task.title ? trimmedTitle : undefined,
        assignee: trimmedAssignee !== (task.assignee ?? null) ? trimmedAssignee : undefined,
        agentId: trimmedAgentId !== (task.agentId ?? null) ? trimmedAgentId : undefined,
        agentPrompt: trimmedPrompt !== (task.agentPrompt ?? "") ? trimmedPrompt : undefined,
        expectedOutput: trimmedExpected !== (task.expectedOutput ?? "") ? trimmedExpected : undefined,
        successCriteria: trimmedCriteria !== (task.successCriteria ?? "") ? trimmedCriteria : undefined,
        priority: priority !== (task.priority ?? "medium") ? priority : undefined,
      });
    }
    if (tagList.join(", ") !== (task.tags ?? []).join(", ")) {
      onSetTags(task.id, tagList);
    }
    const newDue = dueDate || null;
    if (newDue !== (task.dueDate ?? null)) {
      onSetDueDate(task.id, newDue);
    }
    onClose();
  };

  // Execution action visibility.
  const hasPriorExecution = Boolean(task.conversationId || task.executionId);
  const showRun = Boolean(onTaskRun) && !running;
  const showStop = Boolean(onTaskStop) && running;
  const showRetry = Boolean(onTaskRetry) && hasPriorExecution && !running;

  // Outcome metadata for the hero.
  const created = exec.execution?.startedAt;
  const completed = exec.execution?.finishedAt;
  const duration = exec.duration;

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

          {/* ════════════════════════════════════════════════════════════
              HERO — the at-a-glance answer to "what happened?"
              Title, status, priority, agent, created, completed, duration.
              ════════════════════════════════════════════════════════════ */}
          <div className="mb-10">
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

            {/* Editable hero title — borderless, large, Nunito Bold. */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={running}
              className="kb-type-display w-full border-0 bg-transparent tracking-tight text-white focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60"
            />

            {/* Outcome metadata — a quiet, single row of facts. */}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3.5 py-1.5 kb-type-button text-slate-300 ring-1 ring-white/10">
                {STATUS_LABELS[task.status]}
              </span>

              <span className="inline-flex items-center gap-1.5 kb-type-meta text-slate-500">
                <span className={`h-2 w-2 rounded-full ${PRIORITY_STYLES[priority].dot}`} />
                {PRIORITY_STYLES[priority].label}
              </span>

              {exec.agentName !== "—" && (
                <span className="inline-flex items-center gap-1.5 kb-type-meta text-slate-500">
                  <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {exec.agentName}
                </span>
              )}

              {created && (
                <span className="inline-flex items-center gap-1.5 kb-type-meta text-slate-500">
                  <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Created {fmtTime(created)}
                </span>
              )}

              {completed && (
                <span className="inline-flex items-center gap-1.5 kb-type-meta text-slate-500">
                  {exec.isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={1.75} />
                  ) : exec.execution?.status === "failed" ? (
                    <XCircle className="h-3.5 w-3.5 text-rose-400" strokeWidth={1.75} />
                  ) : (
                    <MinusCircle className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
                  )}
                  Completed {fmtTime(completed)}
                </span>
              )}

              {duration !== "—" && (
                <span className="kb-type-meta text-slate-500">Duration {duration}</span>
              )}
            </div>

            {/* Execution actions — Run / Stop / Retry. Quiet, right-aligned. */}
            {(showRun || showStop || showRetry) && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {showRun && (
                  <button
                    type="button"
                    onClick={() => onTaskRun?.(task as EnrichedTask)}
                    disabled={runLoading}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-500/15 px-3.5 kb-type-button text-blue-300 ring-1 ring-blue-400/30 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Run this task"
                  >
                    {runLoading ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                    ) : (
                      <Play className="h-3.5 w-3.5" strokeWidth={2.5} />
                    )}
                    {runLoading ? "Starting…" : "Run"}
                  </button>
                )}
                {showStop && (
                  <button
                    type="button"
                    onClick={() => setConfirmAction("stop")}
                    disabled={stopLoading}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-rose-500/15 px-3.5 kb-type-button text-rose-300 ring-1 ring-rose-400/30 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Stop this task"
                  >
                    {stopLoading ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                    ) : (
                      <Square className="h-3.5 w-3.5" strokeWidth={2.5} />
                    )}
                    {stopLoading ? "Stopping…" : "Stop"}
                  </button>
                )}
                {showRetry && (
                  <button
                    type="button"
                    onClick={() => setConfirmAction("retry")}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-violet-500/15 px-3.5 kb-type-button text-violet-300 ring-1 ring-violet-400/30 transition-colors hover:bg-violet-500/25"
                    aria-label="Retry execution for this task"
                    title="Retry execution"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
                    Retry
                  </button>
                )}
              </div>
            )}

            {running && (
              <div className="mt-5 flex items-center gap-2 rounded-xl bg-blue-500/10 px-4 py-2.5 kb-type-body text-blue-300 ring-1 ring-blue-500/20">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                Task is currently running and cannot be edited.
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════
              FINAL RESULT — the largest section, the primary focus.
              The agent's final output.
              ════════════════════════════════════════════════════════════ */}
          {exec.execution && (
            <section className="mb-10">
              <h4 className="mb-4 flex items-center gap-2.5 kb-type-section text-white">
                <ListChecks className="h-5 w-5 text-emerald-400" strokeWidth={1.75} />
                Final Result
              </h4>
              <div className="rounded-2xl bg-white/[0.03] p-7 ring-1 ring-white/5">
                {exec.finalResult ? (
                  <p className="whitespace-pre-wrap kb-type-body leading-relaxed text-slate-200">
                    {exec.finalResult}
                  </p>
                ) : (
                  <p className="kb-type-body leading-relaxed text-slate-500">
                    {exec.isCompleted
                      ? "Task completed. No final response recorded."
                      : exec.isRunning
                        ? "The agent is still working — no final result yet."
                        : "No final result recorded."}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ════════════════════════════════════════════════════════════
              AGENT SUMMARY — a concise explanation of what happened.
              ════════════════════════════════════════════════════════════ */}
          {exec.execution && (
            <section className="mb-10">
              <h4 className="mb-4 flex items-center gap-2.5 kb-type-section text-white">
                <MessageSquare className="h-5 w-5 text-indigo-400" strokeWidth={1.75} />
                Agent Summary
              </h4>
              <div className="rounded-2xl bg-white/[0.03] p-7 ring-1 ring-white/5">
                <p className="kb-type-body leading-relaxed text-slate-300">
                  {exec.isCompleted
                    ? `Completed in ${exec.duration} by ${exec.agentName}. ${exec.stepCount} step${exec.stepCount === 1 ? "" : "s"} executed.`
                    : exec.isRunning
                      ? `${exec.agentName} is working — ${exec.currentStep}.`
                      : exec.execution.status === "failed"
                        ? `Failed after ${exec.duration}. ${exec.stepCount} step${exec.stepCount === 1 ? "" : "s"} executed.`
                        : exec.execution.status === "cancelled"
                          ? "Execution cancelled."
                          : "Waiting to start."}
                </p>
                {exec.error && (
                  <div className="mt-4 rounded-xl bg-rose-500/[0.06] p-4 ring-1 ring-rose-500/15">
                    <p className="whitespace-pre-wrap kb-type-body leading-relaxed text-rose-200/80">{exec.error}</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ════════════════════════════════════════════════════════════
              ORIGINAL PROMPT — the original task request.
              ════════════════════════════════════════════════════════════ */}
          {exec.execution && (
            <section className="mb-10">
              <h4 className="mb-4 flex items-center gap-2 kb-type-meta uppercase tracking-wider text-slate-500">
                <FileText className="h-4 w-4" strokeWidth={1.75} />
                Original Prompt
              </h4>
              <p className="whitespace-pre-wrap kb-type-body leading-relaxed text-slate-400">
                {task.agentPrompt || "No prompt set."}
              </p>
            </section>
          )}

          {/* ════════════════════════════════════════════════════════════
              WHAT THE AGENT IS DOING — live while running, a quiet
              one-liner once done. De-emphasized for completed tasks.
              ════════════════════════════════════════════════════════════ */}
          {exec.execution && (
            <section className="mb-10">
              {exec.isRunning ? (
                <>
                  <h4 className="mb-4 flex items-center gap-2.5 kb-type-section text-white">
                    <Bot className="h-5 w-5 text-blue-400" strokeWidth={1.75} />
                    What the Agent Is Doing
                  </h4>
                  <div className="rounded-2xl bg-white/[0.03] p-7 ring-1 ring-white/5">
                    <p className="kb-type-card leading-snug tracking-tight text-white">
                      {exec.currentStep}
                    </p>
                    <div className="mt-5 flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400/70" />
                      </div>
                      <span className="kb-type-meta text-slate-500">Agent is working…</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 rounded-xl bg-white/[0.02] px-5 py-3 ring-1 ring-white/5">
                  <Bot className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={1.75} />
                  <span className="kb-type-meta text-slate-500">
                    What the Agent Is Doing: {exec.latestMessage !== "—" ? exec.latestMessage : "idle"}
                  </span>
                  <span className="ml-auto kb-type-meta text-slate-600">
                    Progress {exec.progress}%
                  </span>
                </div>
              )}
            </section>
          )}

          {/* ════════════════════════════════════════════════════════════
              ADVANCED DETAILS — collapsed by default. Execution timeline
              + debug metadata. Content stays in the DOM via `hidden`.
              ════════════════════════════════════════════════════════════ */}
          <div className="mb-8 rounded-xl bg-white/[0.02] ring-1 ring-white/5">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              aria-expanded={showAdvanced}
            >
              <span className="flex items-center gap-2 kb-type-button text-slate-400">
                <ScrollText className="h-4 w-4" /> Advanced Details
              </span>
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              )}
            </button>
            <div className={showAdvanced ? "flex flex-col gap-6 border-t border-white/5 px-5 py-6" : "hidden"}>
              {/* Execution metadata */}
              {(task.conversationId || task.executionId || task.profileId || exec.execution) && (
                <div>
                  <h5 className="mb-3 flex items-center gap-1.5 kb-type-meta text-slate-500">
                    <Terminal className="h-3 w-3" /> Execution Metadata
                  </h5>
                  <div className="flex flex-col gap-2 kb-type-meta">
                    {task.conversationId && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Conversation ID</span>
                        <span className="font-mono text-slate-400">{task.conversationId}</span>
                      </div>
                    )}
                    {task.executionId && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Execution ID</span>
                        <span className="font-mono text-slate-400">{task.executionId}</span>
                      </div>
                    )}
                    {task.profileId && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">Profile</span>
                        <span className="font-mono text-slate-400">{task.profileId}</span>
                      </div>
                    )}
                    {exec.execution && (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Started</span>
                          <span className="text-slate-400">{fmtTime(exec.execution.startedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Last Update</span>
                          <span className="text-slate-400">{fmtTime(exec.execution.updatedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Elapsed</span>
                          <span className="text-slate-400">{fmtElapsed(exec.execution.startedAt, exec.execution.updatedAt)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Tokens (in / out)</span>
                          <span className="text-slate-400">
                            {exec.execution.tokensIn} / {exec.execution.tokensOut}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-500">Cost</span>
                          <span className="text-slate-400">${exec.execution.cost.toFixed(4)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* History — a timeline, not a list of rows. */}
              <div>
                <h5 className="mb-3 flex items-center gap-1.5 kb-type-meta text-slate-500">
                  <History className="h-3 w-3" /> History
                </h5>
                {exec.events.length === 0 && !exec.execution ? (
                  <p className="kb-type-meta text-slate-600">No activity recorded yet.</p>
                ) : (
                  <div className="kb-scroll relative flex max-h-64 flex-col gap-0 overflow-y-auto pl-5">
                    {/* Timeline line */}
                    <div className="absolute left-[5px] top-1 bottom-1 w-px bg-white/10" />
                    {exec.execution && (
                      <div className="relative flex items-start gap-3 py-2.5">
                        <span className="absolute -left-5 mt-1 h-2.5 w-2.5 rounded-full bg-blue-400 ring-4 ring-blue-400/20" />
                        <div className="min-w-0">
                          <p className="kb-type-body font-semibold text-white">Execution started</p>
                          {exec.execution.startedAt && (
                            <p className="mt-1 kb-type-meta text-slate-500">
                              {new Date(exec.execution.startedAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                    {exec.events.map((event) => (
                      <div key={event.id} className="relative flex items-start gap-3 py-2.5">
                        <span className="absolute -left-5 mt-1 h-2 w-2 rounded-full bg-slate-600" />
                        <div className="min-w-0">
                          <p className="kb-type-body text-slate-300">{event.title}</p>
                          {event.detail && (
                            <p className="mt-1 kb-type-meta text-slate-500">{event.detail}</p>
                          )}
                          <p className="mt-1 kb-type-meta text-slate-600">
                            {new Date(event.at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════════════════
              EDIT TASK — collapsed by default. The configuration form.
              Content stays in the DOM via `hidden` so the test contract
              (select[aria-label="AI agent"], "Assigned agent:", "Task Goal")
              remains queryable.
              ════════════════════════════════════════════════════════════ */}
          <div className="rounded-xl bg-white/[0.02] ring-1 ring-white/5">
            <button
              type="button"
              onClick={() => setShowEdit((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-left"
              aria-expanded={showEdit}
            >
              <span className="flex items-center gap-2 kb-type-button text-slate-400">
                <Target className="h-4 w-4" /> Edit Task
              </span>
              {showEdit ? (
                <ChevronUp className="h-4 w-4 text-slate-500" />
              ) : (
                <ChevronDown className="h-4 w-4 text-slate-500" />
              )}
            </button>
            <div className={showEdit ? "flex flex-col gap-6 border-t border-white/5 px-5 py-6" : "hidden"}>
              {/* Task Goal — the expected output, shown when execution exists. */}
              {exec.execution && (
                <section>
                  <h4 className="mb-3 flex items-center gap-2 kb-type-meta uppercase tracking-wider text-slate-500">
                    <Target className="h-4 w-4" strokeWidth={1.75} />
                    Task Goal
                  </h4>
                  <p className="kb-type-body leading-relaxed text-slate-300">
                    {task.expectedOutput || task.agentPrompt || "No goal defined."}
                  </p>
                </section>
              )}

              {/* Agent Prompt */}
              <div>
                <label className="mb-2.5 block kb-type-button text-slate-400">Agent Prompt</label>
                <textarea
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  rows={4}
                  placeholder="The actual instruction sent to the AI agent."
                  disabled={running}
                  className="w-full resize-y rounded-xl border-0 bg-white/5 px-4 py-3 kb-type-body text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Expected Output */}
              <div>
                <label className="mb-2.5 block kb-type-button text-slate-400">Expected Output</label>
                <textarea
                  value={expectedOutput}
                  onChange={(e) => setExpectedOutput(e.target.value)}
                  rows={3}
                  placeholder="What should the agent produce?"
                  disabled={running}
                  className="w-full resize-y rounded-xl border-0 bg-white/5 px-4 py-3 kb-type-body text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Success Criteria */}
              <div>
                <label className="mb-2.5 block kb-type-button text-slate-400">Success Criteria</label>
                <textarea
                  value={successCriteria}
                  onChange={(e) => setSuccessCriteria(e.target.value)}
                  rows={3}
                  placeholder="How will you know the work is done?"
                  disabled={running}
                  className="w-full resize-y rounded-xl border-0 bg-white/5 px-4 py-3 kb-type-body text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Assignee */}
              <div>
                <label className="mb-2.5 flex items-center gap-1.5 kb-type-button text-slate-400">
                  <User className="h-3.5 w-3.5" /> Assignee
                </label>
                <input
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  disabled={running}
                  className="w-full rounded-xl border-0 bg-white/5 px-4 py-2.5 kb-type-body text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* AI agent */}
              <div>
                <label className="mb-2.5 block kb-type-button text-slate-400">AI agent</label>
                <select
                  aria-label="AI agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  disabled={running}
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 kb-type-body text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name} - {agent.role}</option>
                  ))}
                </select>
                {agentId && (
                  <p className="mt-2.5 kb-type-body text-indigo-300">
                    Assigned agent: {agents.find((agent) => agent.id === agentId)?.name ?? "Unassigned"}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div>
                <label className="mb-2.5 block kb-type-button text-slate-400">Priority</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["low", "medium", "high", "critical"] as TaskPriority[]).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setPriority(level)}
                      disabled={running}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 kb-type-button transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        priority === level
                          ? level === "critical"
                            ? "bg-red-600/20 text-red-300 ring-1 ring-red-500/40"
                            : level === "high"
                              ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/40"
                              : level === "medium"
                                ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40"
                                : "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                          : "bg-white/5 text-slate-400 hover:bg-white/10"
                      }`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_STYLES[level].dot}`} />
                      {PRIORITY_STYLES[level].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="mb-2.5 flex items-center gap-1.5 kb-type-button text-slate-400">
                  <Tag className="h-3.5 w-3.5" /> Tags
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. backend, api"
                  disabled={running}
                  className="w-full rounded-xl border-0 bg-white/5 px-4 py-2.5 kb-type-body text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Due Date */}
              <div>
                <label className="mb-2.5 flex items-center gap-1.5 kb-type-button text-slate-400">
                  <Calendar className="h-3.5 w-3.5" /> Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={running}
                  className="w-full rounded-xl border-0 bg-white/5 px-4 py-2.5 kb-type-body text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="border-t border-white/5 p-6 sm:px-12">
          <div className="flex items-center justify-between">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(task.id);
                    onClose();
                  }}
                  className="rounded-xl bg-rose-500/20 px-4 py-2.5 kb-type-button text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-500/30"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl px-4 py-2.5 kb-type-body text-slate-400 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={running}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 kb-type-button text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={running ? "Stop the task before deleting it." : "Delete task"}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={running}
              className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-5 py-2.5 kb-type-button text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </div>
      </div>

      {/* Stop / Run-Again confirmation dialog. */}
      <ConfirmActionModal
        open={confirmAction !== null}
        question={
          confirmAction === "stop"
            ? "Are you sure you want to stop this task?"
            : "Do you want to run this task again?"
        }
        detail={
          confirmAction === "stop"
            ? "This will stop the active execution. The task stays on the board."
            : "This will start a fresh execution of the task."
        }
        confirmLabel={confirmAction === "stop" ? "Stop Task" : "Run Again"}
        tone={confirmAction === "stop" ? "danger" : "primary"}
        icon={confirmAction === "stop" ? "stop" : "retry"}
        onConfirm={() => {
          const action = confirmAction;
          setConfirmAction(null);
          if (action === "stop") onTaskStop?.(task as EnrichedTask);
          else if (action === "retry") onTaskRetry?.(task as EnrichedTask);
        }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
