/**
 * ExecutionHistory — the "History" view.
 *
 * Shows real OpenHands executions from the live snapshot: active runs (with a
 * pulsing indicator) and completed runs (most recent first). Each run shows the
 * task, the agent profile, the model, the status, and the real token/cost
 * reported by the OpenHands agent server.
 */

import { useState } from "react";
import { History, Loader2, CheckCircle2, XCircle, Clock, Bot, Cpu, RotateCcw } from "lucide-react";
import type { OpenHandsExecution, OpenHandsState } from "../types/openhands";
import type { AiState } from "../types/ai";
import { Badge, statusBadge } from "../lib/badges";
import { ConfirmResetModal } from "./ConfirmResetModal";
import { SkeletonRow } from "./Skeleton";

interface ExecutionHistoryProps {
  openHandsState: OpenHandsState;
  aiState: AiState;
  /** Clear the surfaced executions and reset the history baseline to now. */
  onReset: () => void;
}

export function ExecutionHistory({ openHandsState, onReset }: ExecutionHistoryProps) {
  const executions = openHandsState.snapshot.executions;
  const { loading, error } = openHandsState;
  const [confirmReset, setConfirmReset] = useState(false);
  const active = executions.filter((e) => e.status === "running" || e.status === "queued");
  const completed = executions
    .filter((e) => e.status === "completed" || e.status === "failed" || e.status === "cancelled")
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));

  return (
    <div className="relative z-10 flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">Execution History</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {active.length} active · {completed.length} completed
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="kb-glass-sm kb-btn-glow flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
          <span>Clear History</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{error}</div>
      )}

      {/* Active runs */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" /> Active Runs
        </h3>
        {active.length === 0 ? (
          loading ? (
            <div className="flex flex-col gap-2">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <EmptyState
              label="No active runs — run a task from its detail view to see it here."
            />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {active.map((run) => (
              <RunRow key={run.id} run={run} active />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <History className="h-4 w-4 text-slate-400" /> Completed Runs
        </h3>
        {completed.length === 0 ? (
          loading ? (
            <div className="flex flex-col gap-2">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : (
            <EmptyState label="No completed runs yet." />
          )
        ) : (
          <div className="flex flex-col gap-2">
            {completed.map((run) => (
              <RunRow key={run.id} run={run} />
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

function RunRow({ run, active }: { run: OpenHandsExecution; active?: boolean }) {
  const StatusIcon =
    run.status === "completed" ? CheckCircle2 : run.status === "failed" ? XCircle : Loader2;
  const statusColor =
    run.status === "completed"
      ? "text-emerald-400"
      : run.status === "failed"
        ? "text-rose-400"
        : "text-blue-400";

  return (
    <div
      className={`kb-glass kb-fade-in flex items-center gap-3 rounded-2xl px-4 py-3 ${
        active ? "ring-1 ring-blue-400/30" : ""
      }`}
    >
      <StatusIcon
        className={`h-4 w-4 shrink-0 ${statusColor} ${active ? "animate-spin" : ""}`}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">{run.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="font-mono text-slate-500">ID: {run.id}</span>
          {statusBadge(run.status) && (
            <Badge style={statusBadge(run.status)!} pulse={active} />
          )}
          {run.agentId && (
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3 text-indigo-400" /> {run.agentId}
            </span>
          )}
          {run.modelId && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3 text-violet-400" /> {run.modelId}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {run.startedAt ? `Started ${new Date(run.startedAt).toLocaleString()}` : "Start time unavailable"}
            {run.finishedAt ? ` · Finished ${new Date(run.finishedAt).toLocaleString()}` : ""}
          </span>
          {typeof run.retries === "number" && <span>Retries: {run.retries}</span>}
          {run.error && <span className="text-rose-400">Error: {run.error}</span>}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs">
        <p className="font-medium text-slate-300">
          {run.tokensInReported !== false && run.tokensOutReported !== false
            ? `${run.tokensIn.toLocaleString()} in · ${run.tokensOut.toLocaleString()} out`
            : "Tokens unavailable"}
        </p>
        <p className="text-slate-500">{run.costReported === false ? "Cost unavailable" : `$${run.cost.toFixed(4)} reported`}</p>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="kb-glass flex items-center justify-center rounded-2xl p-8 text-center">
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
