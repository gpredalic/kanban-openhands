/**
 * TaskDetailModal — a premium inspector for a task.
 *
 * Not a form. A workspace. The layout follows Apple / Linear / Notion
 * inspector principles:
 *
 *   1. Hero — the task title, large and editable. The focal point.
 *   2. Status + Progress — what is happening, at a glance.
 *   3. Current Activity — the visual centerpiece. What the agent is doing.
 *   4. Agent Summary — a human-readable profile card.
 *   5. Results — final output or issues, when present.
 *   6. Edit fields — the form, quiet and secondary.
 *   7. Advanced Details — collapsed by default. Technical metadata.
 *   8. History — a timeline, not a list of rows.
 *
 * Hierarchy is determined by importance, not by equal-weight boxes.
 * Whitespace and typography do the work. No glow, no gradients, no blur.
 */

import { useState, useEffect, useMemo } from "react";
import { X, Trash2, Save, Tag, Calendar, User, Terminal, History, MessageSquare, Play, Square, RotateCcw, ChevronDown, ChevronUp, Target, ListChecks, Bot, FileText, AlertCircle, ScrollText } from "lucide-react";
import type { Task, TaskStatus, TaskPriority } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import type { OpenHandsState, OpenHandsExecution } from "../types/openhands";
import { PRIORITY_STYLES, statusBadge, Badge } from "../lib/badges";
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
function fmtElapsed(startedAt?: number, updatedAt?: number): string {
  if (!startedAt) return "—";
  const end = updatedAt ?? Date.now();
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
  // Advanced Details is collapsed by default — the modal is user-friendly
  // first, technical content second.
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Derive the execution + events for this task once, so the main sections
  // (Progress, What the Agent Is Doing, Agent Summary, Final Result, Issues)
  // and the Advanced Details section all read from the same stable values.
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
    const statusStyle = statusBadge(execution?.status);
    return { execution, events, latest, currentStep, latestMessage, error, progress, isRunning, statusStyle };
  }, [openHandsState, task.id, task.conversationId, task.executionId]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-glass kb-fade-in flex max-h-[92vh] w-[85vw] max-w-[1280px] flex-col overflow-hidden rounded-3xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Scrollable content ── */}
        <div className="flex-1 overflow-y-auto p-8 sm:p-10">

          {/* ════════════════════════════════════════════════════════════
              HERO — the task title is the focal point.
              ════════════════════════════════════════════════════════════ */}
          <div className="mb-10">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">
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
              className="w-full border-0 bg-transparent text-4xl font-bold tracking-tight text-white focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 sm:text-5xl"
            />

            {/* Status + Progress + Actions — a quiet row below the title. */}
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm font-semibold text-slate-300 ring-1 ring-white/10">
                {STATUS_LABELS[task.status]}
              </span>

              {exec.execution && (
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Progress</span>
                  <div className="h-1.5 w-32 overflow-hidden rounded-full bg-white/10">
                    {exec.isRunning ? (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400/70" />
                    ) : (
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          exec.execution.status === "completed"
                            ? "bg-emerald-400"
                            : exec.execution.status === "failed" || exec.execution.status === "cancelled"
                              ? "bg-rose-400"
                              : "bg-slate-600"
                        }`}
                        style={{ width: `${exec.progress}%` }}
                      />
                    )}
                  </div>
                  {exec.statusStyle && <Badge style={exec.statusStyle} pulse={exec.isRunning} />}
                </div>
              )}

              {/* Execution actions — Run / Stop / Retry. */}
              {(showRun || showStop || showRetry) && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {showRun && (
                    <button
                      type="button"
                      onClick={() => onTaskRun?.(task as EnrichedTask)}
                      disabled={runLoading}
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-500/15 px-3.5 text-sm font-semibold text-blue-300 ring-1 ring-blue-400/30 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60"
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
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-rose-500/15 px-3.5 text-sm font-semibold text-rose-300 ring-1 ring-rose-400/30 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-60"
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
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-violet-500/15 px-3.5 text-sm font-semibold text-violet-300 ring-1 ring-violet-400/30 transition-colors hover:bg-violet-500/25"
                      aria-label="Retry execution for this task"
                      title="Retry execution"
                    >
                      <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>

            {running && (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-blue-500/10 px-4 py-2.5 text-sm font-medium text-blue-300 ring-1 ring-blue-500/20">
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                Task is currently running and cannot be edited.
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════════════════
              BENTO GRID — importance determines layout.
              Left (3/5): live content — activity, agent, results.
              Right (2/5): edit fields, advanced details, history.
              ════════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">

            {/* ── LEFT: Live content ── */}
            <div className="flex flex-col gap-8 lg:col-span-3">

              {/* What the Agent Is Doing — the visual centerpiece. */}
              {exec.execution && (
                <section>
                  <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
                    <Bot className="h-5 w-5 text-blue-400" strokeWidth={1.75} />
                    What the Agent Is Doing
                  </h4>
                  <div className="rounded-2xl bg-white/[0.03] p-6 ring-1 ring-white/5">
                    <p className="text-2xl font-bold leading-snug tracking-tight text-white">
                      {exec.isRunning
                        ? exec.currentStep
                        : exec.execution.status === "completed"
                          ? "Task completed successfully."
                          : exec.execution.status === "failed"
                            ? "Execution failed."
                            : exec.execution.status === "cancelled"
                              ? "Execution cancelled."
                              : "Waiting to start."}
                    </p>
                    <div className="mt-4 flex items-center gap-3">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        {exec.isRunning ? (
                          <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-400/70" />
                        ) : (
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              exec.execution.status === "completed"
                                ? "bg-emerald-400"
                                : exec.execution.status === "failed" || exec.execution.status === "cancelled"
                                  ? "bg-rose-400"
                                  : "bg-slate-600"
                            }`}
                            style={{ width: `${exec.progress}%` }}
                          />
                        )}
                      </div>
                      <span className="text-xs font-semibold text-slate-500">
                        {exec.isRunning
                          ? "Agent is working…"
                          : exec.execution.status === "completed"
                            ? "Completed"
                            : exec.execution.status === "failed"
                              ? "Failed"
                              : exec.execution.status === "cancelled"
                                ? "Cancelled"
                                : "Waiting"}
                      </span>
                    </div>
                  </div>
                </section>
              )}

              {/* Agent Summary — a human-readable profile card. */}
              {exec.execution && (
                <section>
                  <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-white">
                    <MessageSquare className="h-5 w-5 text-indigo-400" strokeWidth={1.75} />
                    Agent Summary
                  </h4>
                  <div className="rounded-2xl bg-white/[0.03] p-6 ring-1 ring-white/5">
                    <p className="text-base leading-relaxed text-slate-300">
                      {exec.latestMessage !== "—" ? exec.latestMessage : "No agent messages yet."}
                    </p>
                  </div>
                </section>
              )}

              {/* Final Result — only when completed. */}
              {exec.execution?.status === "completed" && (
                <section>
                  <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-emerald-400">
                    <ListChecks className="h-5 w-5" strokeWidth={1.75} />
                    Final Result
                  </h4>
                  <div className="rounded-2xl bg-emerald-500/[0.06] p-6 ring-1 ring-emerald-500/15">
                    <p className="text-base leading-relaxed text-emerald-200/80">
                      {task.successCriteria || "Task completed. See agent summary above for details."}
                    </p>
                  </div>
                </section>
              )}

              {/* Issues Encountered — only when there's an error. */}
              {exec.error && (
                <section>
                  <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-rose-400">
                    <AlertCircle className="h-5 w-5" strokeWidth={1.75} />
                    Issues Encountered
                  </h4>
                  <div className="rounded-2xl bg-rose-500/[0.06] p-6 ring-1 ring-rose-500/15">
                    <p className="whitespace-pre-wrap text-base leading-relaxed text-rose-200/80">{exec.error}</p>
                  </div>
                </section>
              )}

              {/* Original Prompt — quiet, secondary. */}
              {exec.execution && (
                <section>
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500">
                    <FileText className="h-4 w-4" strokeWidth={1.75} />
                    Original Prompt
                  </h4>
                  <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
                    {task.agentPrompt || "No prompt set."}
                  </p>
                </section>
              )}
            </div>

            {/* ── RIGHT: Edit fields + Advanced + History ── */}
            <div className="flex flex-col gap-6 lg:col-span-2">

              {/* Task Goal — the expected output, shown when execution exists. */}
              {exec.execution && (
                <section>
                  <h4 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-500">
                    <Target className="h-4 w-4" strokeWidth={1.75} />
                    Task Goal
                  </h4>
                  <p className="text-sm leading-relaxed text-slate-300">
                    {task.expectedOutput || task.agentPrompt || "No goal defined."}
                  </p>
                </section>
              )}

              {/* Agent Prompt */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-400">Agent Prompt</label>
                <textarea
                  value={agentPrompt}
                  onChange={(e) => setAgentPrompt(e.target.value)}
                  rows={4}
                  placeholder="The actual instruction sent to the AI agent."
                  disabled={running}
                  className="w-full resize-y rounded-xl border-0 bg-white/5 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Expected Output */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-400">Expected Output</label>
                <textarea
                  value={expectedOutput}
                  onChange={(e) => setExpectedOutput(e.target.value)}
                  rows={3}
                  placeholder="What should the agent produce?"
                  disabled={running}
                  className="w-full resize-y rounded-xl border-0 bg-white/5 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Success Criteria */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-400">Success Criteria</label>
                <textarea
                  value={successCriteria}
                  onChange={(e) => setSuccessCriteria(e.target.value)}
                  rows={3}
                  placeholder="How will you know the work is done?"
                  disabled={running}
                  className="w-full resize-y rounded-xl border-0 bg-white/5 px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Assignee */}
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-400">
                  <User className="h-3.5 w-3.5" /> Assignee
                </label>
                <input
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  placeholder="e.g. Jane Doe"
                  disabled={running}
                  className="w-full rounded-xl border-0 bg-white/5 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* AI agent */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-400">AI agent</label>
                <select
                  aria-label="AI agent"
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  disabled={running}
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name} - {agent.role}</option>
                  ))}
                </select>
                {agentId && (
                  <p className="mt-2 text-sm text-indigo-300">
                    Assigned agent: {agents.find((agent) => agent.id === agentId)?.name ?? "Unassigned"}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-400">Priority</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(["low", "medium", "high", "critical"] as TaskPriority[]).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setPriority(level)}
                      disabled={running}
                      className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
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
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-400">
                  <Tag className="h-3.5 w-3.5" /> Tags
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. backend, api"
                  disabled={running}
                  className="w-full rounded-xl border-0 bg-white/5 px-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Due Date */}
              <div>
                <label className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-400">
                  <Calendar className="h-3.5 w-3.5" /> Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={running}
                  className="w-full rounded-xl border-0 bg-white/5 px-4 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              {/* Advanced Details — collapsed by default. */}
              <div className="rounded-xl bg-white/[0.02] ring-1 ring-white/5">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  aria-expanded={showAdvanced}
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-slate-400">
                    <ScrollText className="h-4 w-4" /> Advanced Details
                  </span>
                  {showAdvanced ? (
                    <ChevronUp className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  )}
                </button>
                {showAdvanced && (
                  <div className="flex flex-col gap-4 border-t border-white/5 px-4 py-4">
                    {/* Execution metadata */}
                    {(task.conversationId || task.executionId || task.profileId || exec.execution) && (
                      <div>
                        <h5 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                          <Terminal className="h-3 w-3" /> Execution Metadata
                        </h5>
                        <div className="flex flex-col gap-1.5 text-xs">
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
                      <h5 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-slate-500">
                        <History className="h-3 w-3" /> History
                      </h5>
                      {exec.events.length === 0 && !exec.execution ? (
                        <p className="text-xs text-slate-600">No activity recorded yet.</p>
                      ) : (
                        <div className="relative flex max-h-56 flex-col gap-0 overflow-y-auto pl-5">
                          {/* Timeline line */}
                          <div className="absolute left-[5px] top-1 bottom-1 w-px bg-white/10" />
                          {exec.execution && (
                            <div className="relative flex items-start gap-3 py-2">
                              <span className="absolute -left-5 mt-1 h-2.5 w-2.5 rounded-full bg-blue-400 ring-4 ring-blue-400/20" />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-white">Execution started</p>
                                {exec.execution.startedAt && (
                                  <p className="mt-0.5 text-xs text-slate-500">
                                    {new Date(exec.execution.startedAt).toLocaleString()}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          {exec.events.map((event) => (
                            <div key={event.id} className="relative flex items-start gap-3 py-2">
                              <span className="absolute -left-5 mt-1 h-2 w-2 rounded-full bg-slate-600" />
                              <div className="min-w-0">
                                <p className="text-sm text-slate-300">{event.title}</p>
                                {event.detail && (
                                  <p className="mt-0.5 text-xs text-slate-500">{event.detail}</p>
                                )}
                                <p className="mt-0.5 text-xs text-slate-600">
                                  {new Date(event.at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="border-t border-white/5 p-6 sm:px-10">
          <div className="flex items-center justify-between">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onDelete(task.id);
                    onClose();
                  }}
                  className="rounded-xl bg-rose-500/20 px-4 py-2.5 text-sm font-semibold text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-500/30"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl px-4 py-2.5 text-sm text-slate-400 hover:bg-white/5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={running}
                className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                title={running ? "Stop the task before deleting it." : "Delete task"}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={running}
              className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
