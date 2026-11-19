/**
 * ExecutionHistory — the "History" view.
 *
 * Shows the live execution state: active runs (with a pulsing indicator) and
 * the run history (most recent first). Each run shows the task, the agent that
 * ran it, the model, the status, and the token/cost it consumed.
 */

import { History, Loader2, CheckCircle2, XCircle, Clock, Bot, Cpu } from "lucide-react";
import type { AiState, Agent, ExecutionRun, LLMModel } from "../types/ai";
import { formatCost, formatTokens } from "../lib/ai-engine";

interface ExecutionHistoryProps {
  aiState: AiState;
}

export function ExecutionHistory({ aiState }: ExecutionHistoryProps) {
  const { activeRuns, history } = aiState.execution;
  const { agents, models } = aiState.config;

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const modelById = new Map(models.map((m) => [m.id, m]));

  return (
    <div className="relative z-10 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-white">Execution History</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {activeRuns.length} active · {history.length} completed
        </p>
      </div>

      {/* Active runs */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" /> Active Runs
        </h3>
        {activeRuns.length === 0 ? (
          <EmptyState label="No active runs — start orchestration from the Board header." />
        ) : (
          <div className="flex flex-col gap-2">
            {activeRuns.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                agent={agentById.get(run.agentId)}
                model={modelById.get(run.modelId)}
                active
              />
            ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <History className="h-4 w-4 text-slate-400" /> Completed Runs
        </h3>
        {history.length === 0 ? (
          <EmptyState label="No completed runs yet." />
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                agent={agentById.get(run.agentId)}
                model={modelById.get(run.modelId)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RunRow({
  run,
  agent,
  model,
  active,
}: {
  run: ExecutionRun;
  agent?: Agent;
  model?: LLMModel;
  active?: boolean;
}) {
  const StatusIcon =
    run.status === "succeeded" ? CheckCircle2 : run.status === "failed" ? XCircle : Loader2;
  const statusColor =
    run.status === "succeeded"
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
        <p className="truncate text-sm font-medium text-white">{run.taskTitle}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          {agent && (
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3 text-indigo-400" /> {agent.name}
            </span>
          )}
          {model && (
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3 text-violet-400" /> {model.name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {run.finishedAt
              ? new Date(run.finishedAt).toLocaleTimeString()
              : run.startedAt
                ? new Date(run.startedAt).toLocaleTimeString()
                : "queued"}
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right text-xs">
        <p className="font-medium text-slate-300">{formatCost(run.cost)}</p>
        <p className="text-slate-500">
          {formatTokens(run.tokensIn)} in · {formatTokens(run.tokensOut)} out
        </p>
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
