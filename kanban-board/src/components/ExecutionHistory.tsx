/**
 * ExecutionHistory — the "History" view.
 *
 * A quiet, editorial timeline of real executions. Active runs pulse; completed
 * runs are listed most-recent-first. Each entry shows the task title, status,
 * start time, duration, agent name, and cost — all business information, no raw
 * identifiers. The surface is spacious and calm, closer to Apple Activity or
 * Notion Updates than a log viewer.
 */

import { useState } from "react";
import { Loader2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
import type { OpenHandsExecution, OpenHandsState } from "../types/openhands";
import type { AiState, Agent } from "../types/ai";
import { Badge, statusBadge } from "../lib/badges";
import { ConfirmResetModal } from "./ConfirmResetModal";
import { useReveal } from "../hooks/useReveal";
import { SkeletonRow } from "./Skeleton";

interface ExecutionHistoryProps {
  openHandsState: OpenHandsState;
  aiState: AiState;
  profiles: Agent[];
  /** Clear the surfaced executions and reset the history baseline to now. */
  onReset: () => void;
}

export function ExecutionHistory({ openHandsState, profiles, onReset }: ExecutionHistoryProps) {
  const rootRef = useReveal<HTMLDivElement>();
  const executions = openHandsState.snapshot.executions;
  const { loading, error } = openHandsState;
  const [confirmReset, setConfirmReset] = useState(false);
  const active = executions.filter((e) => e.status === "running" || e.status === "queued");
  const completed = executions
    .filter((e) => e.status === "completed" || e.status === "failed" || e.status === "cancelled")
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  return (
    <div ref={rootRef} className="kb-reveal relative z-10 flex flex-col gap-10 p-8">
      {/* Header — large, editorial. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">History</h2>
          <p className="mt-2 text-sm text-slate-500">
            {active.length} active · {completed.length} completed
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="kb-glass-sm flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-400 transition-colors hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          <span>Clear</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{error}</div>
      )}

      {/* Active runs — a spacious timeline. */}
      <section>
        <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active</h3>
        {active.length === 0 ? (
          loading ? (
            <div className="flex flex-col gap-3">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <EmptyState label="No active runs — run a task from its detail view to see it here." />
          )
        ) : (
          <div className="relative flex flex-col gap-5 pl-6">
            <div className="absolute left-[7px] top-3 bottom-3 w-px bg-white/10" />
            {active.map((run) => (
              <TimelineNode key={run.id} run={run} profiles={profiles} active />
            ))}
          </div>
        )}
      </section>

      {/* Completed runs — a spacious timeline. */}
      <section>
        <h3 className="mb-5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Completed</h3>
        {completed.length === 0 ? (
          loading ? (
            <div className="flex flex-col gap-3">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <EmptyState label="No completed runs yet." />
          )
        ) : (
          <div className="relative flex flex-col gap-5 pl-6">
            <div className="absolute left-[7px] top-3 bottom-3 w-px bg-white/10" />
            {completed.map((run) => (
              <TimelineNode key={run.id} run={run} profiles={profiles} />
            ))}
          </div>
        )}
      </section>

      <ConfirmResetModal
        open={confirmReset}
        question="Clear execution history?"
        detail="This clears the surfaced executions and resets the history baseline to now. Executions started before the reset will no longer be shown."
        confirmLabel="Clear History"
        onConfirm={() => {
          onReset();
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

/** Format a duration in milliseconds as a human-friendly string. */
function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  if (min < 60) return `${min}m ${totalSec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

/** Format a timestamp as a short business-friendly date-time. */
function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const day = d.getDate();
  const month = d.toLocaleString("en", { month: "short" });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

/** A single node on the execution timeline: a status dot on the line plus a
    spacious card. The dot color encodes the run's state at a glance. */
function TimelineNode({ run, profiles, active }: { run: OpenHandsExecution; profiles: Agent[]; active?: boolean }) {
  const StatusIcon =
    run.status === "completed" ? CheckCircle2 : run.status === "failed" ? XCircle : Loader2;
  const statusColor =
    run.status === "completed"
      ? "text-emerald-400"
      : run.status === "failed"
        ? "text-rose-400"
        : "text-blue-400";
  const dotColor =
    run.status === "completed"
      ? "bg-emerald-400"
      : run.status === "failed"
        ? "bg-rose-400"
        : run.status === "queued"
          ? "bg-amber-400"
          : "bg-blue-400";

  // Resolve agent display name from the profile list.
  const agentName = run.agentId
    ? profiles.find((p) => p.id === run.agentId || p.name === run.agentId)?.name ?? "Unassigned"
    : null;

  // Duration: only show when both start and finish are known.
  const duration =
    run.startedAt && run.finishedAt ? formatDuration(run.finishedAt - run.startedAt) : null;

  // Cost: show only when reported.
  const cost = run.costReported === false ? null : `$${run.cost.toFixed(4)}`;

  return (
    <div className="relative">
      {/* Status dot on the timeline */}
      <span
        className={`absolute -left-6 top-5 h-3.5 w-3.5 rounded-full ring-4 ring-[#0a0a0c] ${dotColor} ${
          active ? "kb-sync-dot" : ""
        }`}
      />
      <div
        className={`kb-glass-sm kb-fade-in flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors hover:bg-white/[0.07] ${
          active ? "ring-1 ring-blue-400/30" : ""
        }`}
      >
        <StatusIcon
          className={`h-4 w-4 shrink-0 ${statusColor} ${active ? "animate-spin" : ""}`}
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-white">{run.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {statusBadge(run.status) && (
              <Badge style={statusBadge(run.status)!} pulse={active} />
            )}
            {run.startedAt && <span>{formatDateTime(run.startedAt)}</span>}
            {duration && <span>{duration}</span>}
            {agentName && <span>{agentName}</span>}
            {run.error && <span className="text-rose-400">{run.error}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs">
          {cost !== null && <p className="font-semibold text-slate-400">{cost}</p>}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="kb-glass-sm flex items-center justify-center rounded-2xl p-10 text-center">
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
