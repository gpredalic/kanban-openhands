/**
 * AnalyticsView — the "Analytics" view.
 *
 * Token and cost tracking (OpenRouter-style). Shows:
 *   - Totals: tokens in/out, total cost, runs completed.
 *   - Per-agent breakdown (tokens + cost, with a proportional bar).
 *   - Per-model breakdown (tokens + cost, with a proportional bar).
 *
 * All numbers are derived from the execution history + active runs.
 */

import { useMemo } from "react";
import { BarChart3, Coins, Cpu, Bot, Activity } from "lucide-react";
import type { AiState } from "../types/ai";
import { formatCost, formatTokens } from "../lib/ai-engine";

interface AnalyticsViewProps {
  aiState: AiState;
}

interface Breakdown {
  id: string;
  name: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  runs: number;
}

export function AnalyticsView({ aiState }: AnalyticsViewProps) {
  const { execution, config } = aiState;
  const allRuns = [...execution.activeRuns, ...execution.history];

  const perAgent = useMemo(() => {
    const map = new Map<string, Breakdown>();
    for (const run of allRuns) {
      const agent = config.agents.find((a) => a.id === run.agentId);
      if (!agent) continue;
      const entry = map.get(agent.id) ?? {
        id: agent.id,
        name: agent.name,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        runs: 0,
      };
      entry.tokensIn += run.tokensIn;
      entry.tokensOut += run.tokensOut;
      entry.cost += run.cost;
      entry.runs += 1;
      map.set(agent.id, entry);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [allRuns, config.agents]);

  const perModel = useMemo(() => {
    const map = new Map<string, Breakdown>();
    for (const run of allRuns) {
      const model = config.models.find((m) => m.id === run.modelId);
      if (!model) continue;
      const entry = map.get(model.id) ?? {
        id: model.id,
        name: model.name,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        runs: 0,
      };
      entry.tokensIn += run.tokensIn;
      entry.tokensOut += run.tokensOut;
      entry.cost += run.cost;
      entry.runs += 1;
      map.set(model.id, entry);
    }
    return [...map.values()].sort((a, b) => b.cost - a.cost);
  }, [allRuns, config.models]);

  const maxAgentCost = Math.max(...perAgent.map((a) => a.cost), 0.0001);
  const maxModelCost = Math.max(...perModel.map((m) => m.cost), 0.0001);

  return (
    <div className="relative z-10 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-white">Analytics</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Token & cost tracking across all executions
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard
          icon={Activity}
          label="Total Tokens In"
          value={formatTokens(execution.totalTokensIn)}
          accent="from-blue-500 to-indigo-500"
        />
        <TotalCard
          icon={Activity}
          label="Total Tokens Out"
          value={formatTokens(execution.totalTokensOut)}
          accent="from-violet-500 to-purple-500"
        />
        <TotalCard
          icon={Coins}
          label="Total Cost"
          value={formatCost(execution.totalCost)}
          accent="from-emerald-500 to-teal-500"
        />
        <TotalCard
          icon={BarChart3}
          label="Runs Completed"
          value={String(execution.history.length)}
          accent="from-amber-500 to-orange-500"
        />
      </div>

      {/* Per-agent breakdown */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Bot className="h-4 w-4 text-indigo-400" /> Per-Agent Usage
        </h3>
        {perAgent.length === 0 ? (
          <EmptyState label="No agent usage yet — start orchestration to populate analytics." />
        ) : (
          <div className="kb-glass kb-fade-in flex flex-col gap-3 rounded-2xl p-4">
            {perAgent.map((a) => (
              <BreakdownRow
                key={a.id}
                name={a.name}
                tokensIn={a.tokensIn}
                tokensOut={a.tokensOut}
                cost={a.cost}
                runs={a.runs}
                pct={(a.cost / maxAgentCost) * 100}
                barClass="bg-gradient-to-r from-blue-500 to-indigo-500"
              />
            ))}
          </div>
        )}
      </section>

      {/* Per-model breakdown */}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Cpu className="h-4 w-4 text-violet-400" /> Per-Model Usage
        </h3>
        {perModel.length === 0 ? (
          <EmptyState label="No model usage yet." />
        ) : (
          <div className="kb-glass kb-fade-in flex flex-col gap-3 rounded-2xl p-4">
            {perModel.map((m) => (
              <BreakdownRow
                key={m.id}
                name={m.name}
                tokensIn={m.tokensIn}
                tokensOut={m.tokensOut}
                cost={m.cost}
                runs={m.runs}
                pct={(m.cost / maxModelCost) * 100}
                barClass="bg-gradient-to-r from-violet-500 to-purple-500"
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TotalCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="kb-glass kb-fade-in relative overflow-hidden rounded-2xl p-4">
      <div
        className={`absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${accent} opacity-20 blur-2xl`}
      />
      <div className="relative">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {label}
        </div>
        <p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p>
      </div>
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
  barClass,
}: {
  name: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  runs: number;
  pct: number;
  barClass: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-200">{name}</span>
        <span className="text-slate-400">
          {formatTokens(tokensIn)} in · {formatTokens(tokensOut)} out · {formatCost(cost)} ·{" "}
          {runs} runs
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-700/40">
        <div
          className={`h-full rounded-full ${barClass} transition-all duration-500`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
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
