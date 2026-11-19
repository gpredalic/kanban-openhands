import { Activity, AlertTriangle, Bot, GitPullRequest, GitCommit, Play, RotateCcw, Square, Workflow } from "lucide-react";
import type { OpenHandsState } from "../types/openhands";
import type { EnrichedTask } from "../types/ai";
import type { Agent } from "../types/ai";
import { formatCost, formatTokens } from "../lib/ai-engine";

interface OpenHandsViewProps {
  state: OpenHandsState;
  tasks: EnrichedTask[];
  agents: Agent[];
  onCommand: (command: "start" | "stop" | "retry", executionId: string) => void;
}

export function OpenHandsView({ state, tasks, agents, onCommand }: OpenHandsViewProps) {
  const { executions, events, links } = state.snapshot;
  const active = executions.filter((run) => run.status === "running").length;
  const queued = executions.filter((run) => run.status === "queued").length;
  const failed = executions.filter((run) => run.status === "failed").length;
  const completed = executions.filter((run) => run.status === "succeeded").length;
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]));
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <div className="relative z-10 flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-white">OpenHands Command Center</h2>
        <p className="mt-0.5 text-xs text-slate-400">Live operations, execution control, and activity from OpenHands</p>
      </div>
      {state.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{state.error}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Active jobs" value={active} accent="text-blue-400" />
        <Metric label="Queued jobs" value={queued} accent="text-amber-400" />
        <Metric label="Failed jobs" value={failed} accent="text-rose-400" />
        <Metric label="Completed jobs" value={completed} accent="text-emerald-400" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section>
          <SectionTitle icon={Activity} label="Live executions" />
          <div className="flex flex-col gap-2">
            {executions.length === 0 && <Empty label={state.loading ? "Connecting to OpenHands…" : "No executions reported yet."} />}
            {executions.map((run) => (
              <div key={run.id} className="kb-glass flex items-center gap-3 rounded-2xl px-4 py-3">
                <span className={`h-2 w-2 rounded-full ${run.status === "failed" ? "bg-rose-400" : run.status === "running" ? "bg-blue-400 animate-pulse" : "bg-emerald-400"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{run.title}</p>
                  <p className="text-[11px] text-slate-500">{run.taskId ? taskNames.get(run.taskId) ?? run.taskId : "OpenHands execution"} · {agentNames.get(run.agentId ?? "") ?? run.agentId ?? "unassigned"}</p>
                </div>
                <span className="text-right text-[11px] text-slate-400">{formatTokens(run.tokensIn + run.tokensOut)} tokens<br />{formatCost(run.cost)}</span>
                <div className="flex gap-1">
                  {run.status === "running" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Stop execution" onClick={() => onCommand("stop", run.id)}><Square className="h-3.5 w-3.5" /></button>}
                  {run.status === "failed" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Retry execution" onClick={() => onCommand("retry", run.id)}><RotateCcw className="h-3.5 w-3.5" /></button>}
                  {run.status === "queued" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Start execution" onClick={() => onCommand("start", run.id)}><Play className="h-3.5 w-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle icon={Workflow} label="Activity timeline" />
          <div className="kb-glass max-h-80 overflow-y-auto rounded-2xl p-4">
            {events.length === 0 && <Empty label="OpenHands events will appear here automatically." />}
            {events.slice(0, 30).map((event) => (
              <div key={event.id} className="flex gap-3 border-b border-white/5 py-3 last:border-0">
                <EventIcon type={event.type} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200">{event.title}</p>
                  <p className="truncate text-[11px] text-slate-500">{event.detail ?? event.repository ?? event.status ?? "OpenHands activity"}</p>
                </div>
                <time className="shrink-0 text-[10px] text-slate-600">{new Date(event.at).toLocaleTimeString()}</time>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section>
        <SectionTitle icon={GitCommit} label="Knowledge graph" />
        <div className="kb-glass rounded-2xl p-4">
          <p className="mb-3 text-xs text-slate-500">Relationships discovered across tasks, agents, models, repositories, conversations, and executions.</p>
          <div className="flex flex-wrap gap-2">
            {links.length === 0 && <Empty label="Relationships will appear as OpenHands work is reported." />}
            {links.slice(0, 40).map((link) => <span key={`${link.from.id}-${link.to.id}-${link.relation}`} className="rounded-lg bg-slate-800/70 px-3 py-2 text-[11px] text-slate-300">{link.from.label} <span className="text-indigo-400">→ {link.relation} →</span> {link.to.label}</span>)}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return <div className="kb-glass rounded-2xl p-4"><p className="text-xs text-slate-400">{label}</p><p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p></div>;
}

function SectionTitle({ icon: Icon, label }: { icon: typeof Activity; label: string }) {
  return <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Icon className="h-4 w-4 text-indigo-400" />{label}</h3>;
}

function Empty({ label }: { label: string }) {
  return <p className="rounded-xl bg-slate-800/30 p-5 text-center text-xs text-slate-500">{label}</p>;
}

function EventIcon({ type }: { type: string }) {
  if (type === "error") return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />;
  if (type === "pull_request") return <GitPullRequest className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />;
  if (type === "execution") return <Bot className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />;
  return <Activity className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />;
}
