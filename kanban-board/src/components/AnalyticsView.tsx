/**
 * AnalyticsView — the "Analytics" view.
 *
 * Token and cost tracking. The hierarchy is deliberate:
 *   - Total Cost is the hero KPI — large, centered, the number that matters.
 *   - Supporting metrics (tokens in/out, runs) are smaller, quiet tiles.
 *   - Per-agent and per-model breakdowns use clean, solid bars.
 *
 * All numbers are derived from the real OpenHands execution snapshot.
 * The surface is spacious and editorial, closer to Apple's Activity or
 * Notion's analytics than a dashboard.
 */

import { useMemo, useState } from "react";
import { Coins, RotateCcw } from "lucide-react";
import type { AiState } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";
import { formatCost, formatTokens } from "../lib/ai-engine";
import { ConfirmResetModal } from "./ConfirmResetModal";
import { useReveal } from "../hooks/useReveal";
import { SkeletonStat, SkeletonRow } from "./Skeleton";

interface AnalyticsViewProps {
  aiState: AiState;
  openHandsState: OpenHandsState;
  /** Clear the surfaced executions and reset the metrics baseline to now. */
  onReset: () => void;
}

interface Breakdown {
  id: string;
  name: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  runs: number;
}

export function AnalyticsView({ aiState, openHandsState, onReset }: AnalyticsViewProps) {
  const rootRef = useReveal<HTMLDivElement>();
  const { config } = aiState;
  const executions = openHandsState.snapshot.executions;
  const loading = openHandsState.loading;
  const [confirmReset, setConfirmReset] = useState(false);

  const perAgent = useMemo(() => {
    const map = new Map<string, Breakdown>();
    for (const run of executions) {
      const agentId = run.agentId ?? "unassigned";
      const agent = config.agents.find((a) => a.id === agentId);
      const entry = map.get(agentId) ?? {
        id: agentId,
        name: agent?.name ?? "Unassigned",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        runs: 0,
      };
      if (run.tokensInReported !== false) entry.tokensIn += run.tokensIn;
      if (run.tokensOutReported !== false) entry.tokensOut += run.tokensOut;
      if (run.costReported !== false) entry.cost += run.cost;
      entry.runs += 1;
      map.set(agentId, entry);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [executions, config.agents]);

  const perModel = useMemo(() => {
    const map = new Map<string, Breakdown>();
    for (const run of executions) {
      const modelId = run.modelId ?? "unassigned";
      const model = config.models.find((m) => m.id === modelId);
      const entry = map.get(modelId) ?? {
        id: modelId,
        name: model?.name ?? "Unassigned",
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        runs: 0,
      };
      if (run.tokensInReported !== false) entry.tokensIn += run.tokensIn;
      if (run.tokensOutReported !== false) entry.tokensOut += run.tokensOut;
      if (run.costReported !== false) entry.cost += run.cost;
      entry.runs += 1;
      map.set(modelId, entry);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [executions, config.models]);

  const reportedTokenIn = executions.filter((e) => e.tokensInReported !== false);
  const reportedTokenOut = executions.filter((e) => e.tokensOutReported !== false);
  const reportedCost = executions.filter((e) => e.costReported !== false);
  const totalTokensIn = reportedTokenIn.reduce((s, e) => s + e.tokensIn, 0);
  const totalTokensOut = reportedTokenOut.reduce((s, e) => s + e.tokensOut, 0);
  const totalCost = reportedCost.reduce((s, e) => s + e.cost, 0);
  const completedRuns = executions.filter(
    (e) => e.status === "completed" || e.status === "failed" || e.status === "cancelled",
  ).length;

  const maxAgentCost = Math.max(...perAgent.map((a) => a.cost), 0.0001);
  const maxModelCost = Math.max(...perModel.map((m) => m.cost), 0.0001);

  return (
    <div ref={rootRef} className="kb-reveal relative z-10 flex flex-col gap-10 p-8">
      {/* Header — large, editorial. */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="kb-type-display text-white">Analytics</h2>
          <p className="kb-type-body mt-3 text-slate-500">Token and cost usage</p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="kb-glass-sm flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-slate-400 transition-colors hover:text-white"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={2} />
          <span>Clear</span>
        </button>
      </div>

      {/* Hero KPI — Total Cost. The number that matters, shown large. An
          asymmetric bento: the hero dominates the left, supporting metrics
          stack in a quiet column on the right. */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonStat />
          <SkeletonStat />
          <SkeletonStat />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Hero — Total Cost */}
          <div className="kb-glass flex flex-col justify-center rounded-3xl p-12 lg:col-span-2">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-500">
              <Coins className="h-4 w-4" strokeWidth={1.75} />
              Total Cost
            </div>
            <p className="mt-6 text-7xl font-bold tracking-tight text-white">
              {reportedCost.length ? formatCost(totalCost) : "—"}
            </p>
            <p className="mt-4 text-sm text-slate-500">
              {completedRuns} runs completed
            </p>
          </div>
          {/* Supporting metrics — a quiet stacked column. */}
          <div className="flex flex-col gap-4">
            <SupportingMetric
              label="Tokens In"
              value={reportedTokenIn.length ? formatTokens(totalTokensIn) : "—"}
            />
            <SupportingMetric
              label="Tokens Out"
              value={reportedTokenOut.length ? formatTokens(totalTokensOut) : "—"}
            />
            <SupportingMetric
              label="Runs"
              value={String(completedRuns)}
            />
          </div>
        </div>
      )}

      {/* Per-agent breakdown */}
      <section>
        <h3 className="mb-6 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">
          Per-Agent Usage
        </h3>
        {loading ? (
          <div className="flex flex-col gap-3">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : perAgent.length === 0 ? (
          <EmptyState label="No agent usage yet." />
        ) : (
          <div className="kb-glass kb-fade-in flex flex-col gap-6 rounded-2xl p-8">
            {perAgent.map((a) => (
              <BreakdownRow
                key={a.id}
                name={a.name}
                tokensIn={a.tokensIn}
                tokensOut={a.tokensOut}
                cost={a.cost}
                runs={a.runs}
                pct={(a.cost / maxAgentCost) * 100}
              />
            ))}
          </div>
        )}
      </section>

      {/* Per-model breakdown */}
      <section>
        <h3 className="mb-6 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">
          Per-Model Usage
        </h3>
        {loading ? (
          <div className="flex flex-col gap-3">
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : perModel.length === 0 ? (
          <EmptyState label="No model usage yet." />
        ) : (
          <div className="kb-glass kb-fade-in flex flex-col gap-6 rounded-2xl p-8">
            {perModel.map((m) => (
              <BreakdownRow
                key={m.id}
                name={m.name}
                tokensIn={m.tokensIn}
                tokensOut={m.tokensOut}
                cost={m.cost}
                runs={m.runs}
                pct={(m.cost / maxModelCost) * 100}
              />
            ))}
          </div>
        )}
      </section>

      <ConfirmResetModal
        open={confirmReset}
        question="Clear analytics?"
        detail="This clears the surfaced executions and resets the metrics baseline to now."
        confirmLabel="Clear"
        onConfirm={() => {
          onReset();
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function SupportingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="kb-glass-sm flex flex-1 flex-col justify-center rounded-2xl p-6">
      <p className="text-xs font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-white">{value}</p>
    </div>
  );
}

function BreakdownRow({
  name,
  tokensIn,
  tokensOut,
  cost,
  runs,
  pct,
}: {
  name: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  runs: number;
  pct: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-base font-bold text-white">{name}</span>
        <span className="text-sm text-slate-500">
          {formatTokens(tokensIn)} in · {formatTokens(tokensOut)} out · {formatCost(cost)} · {runs} runs
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-blue-400/70 transition-all duration-500"
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="kb-glass flex items-center justify-center rounded-2xl p-10 text-center">
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
