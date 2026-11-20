import { useEffect, useState } from "react";
import { Activity, AlertTriangle, Bot, GitPullRequest, GitCommit, Play, RotateCcw, Square, Workflow, Plus, Trash2 } from "lucide-react";
import type { OpenHandsState } from "../types/openhands";
import type { EnrichedTask } from "../types/ai";
import type { Agent } from "../types/ai";
import type { Host } from "../types/task";
import { formatCost, formatTokens } from "../lib/ai-engine";
import { fetchAgentProfiles, startAgentRelay } from "../lib/openhands";
import type { AgentProfile, RelayHandle, RelayHop } from "../lib/openhands";

interface OpenHandsViewProps {
  host: Host;
  state: OpenHandsState;
  tasks: EnrichedTask[];
  agents: Agent[];
  onCommand: (command: "start" | "stop" | "retry", executionId: string) => void;
}

export function OpenHandsView({ host, state, tasks, agents, onCommand }: OpenHandsViewProps) {
  const { executions, events, links } = state.snapshot;
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [seed, setSeed] = useState("");
  const [chain, setChain] = useState<string[]>(["qwen38-openhands", "ornith-architect"]);
  const [selectedProfile, setSelectedProfile] = useState("");
  const [maxHops, setMaxHops] = useState(6);
  const [useChildren, setUseChildren] = useState(false);
  const [relayHops, setRelayHops] = useState<RelayHop[]>([]);
  const [relayHandle, setRelayHandle] = useState<RelayHandle | null>(null);
  const [relayStatus, setRelayStatus] = useState<"idle" | "running" | "stopped" | "complete" | "failed">("idle");

  useEffect(() => {
    void fetchAgentProfiles(host).then((roster) => {
      setProfiles(roster);
      if (!selectedProfile && roster.length > 0) setSelectedProfile(roster[0].name);
    }).catch(() => setProfiles([]));
  }, [host]);

  const addProfile = () => {
    if (selectedProfile && !chain.includes(selectedProfile)) setChain((current) => [...current, selectedProfile]);
  };

  const startRelay = () => {
    if (!seed.trim() || chain.length === 0 || relayStatus === "running") return;
    setRelayHops([]);
    setRelayStatus("running");
    void startAgentRelay(host, {
      seed,
      agentNames: chain,
      maxHops,
      useChildConversations: useChildren,
    }, (hop, index, running) => {
      setRelayHops((current) => {
        const next = [...current];
        next[index] = hop;
        return next;
      });
      if (!running) setRelayStatus(hop.status === "failed" ? "failed" : "complete");
    }).then((handle) => {
      if (!handle) setRelayStatus("failed");
      else setRelayHandle(handle);
    }).catch(() => setRelayStatus("failed"));
  };

  const stopRelay = () => {
    setRelayStatus("stopped");
    if (relayHandle) void relayHandle.stop().catch(() => undefined);
  };
  const active = executions.filter((run) => run.status === "running").length;
  const queued = executions.filter((run) => run.status === "queued").length;
  const failed = executions.filter((run) => run.status === "failed").length;
  const completed = executions.filter((run) => run.status === "completed").length;
  const taskNames = new Map(tasks.map((task) => [task.id, task.title]));
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

  return (
    <div className="relative z-10 flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-white">OpenHands Command Center</h2>
          <span className="text-[11px] text-slate-500">
            {state.lastSyncedAt === null ? "Not synced yet" : `Last synced ${Math.max(0, Math.floor((Date.now() - state.lastSyncedAt) / 1000))}s ago`}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">Live operations, execution control, and activity from OpenHands</p>
      </div>
      {state.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{state.error}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Active jobs" value={active} accent="text-blue-400" />
        <Metric label="Queued jobs" value={queued} accent="text-amber-400" />
        <Metric label="Failed jobs" value={failed} accent="text-rose-400" />
        <Metric label="Completed jobs" value={completed} accent="text-emerald-400" />
      </div>
      <section>
        <SectionTitle icon={Workflow} label="Multi-agent relay" />
        <div className="kb-glass rounded-2xl p-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            <div className="flex flex-col gap-3">
              <label className="text-[11px] font-medium text-slate-400">
                Seed prompt
                <textarea
                  value={seed}
                  onChange={(event) => setSeed(event.target.value)}
                  placeholder="Give the relay a prompt, or select a board task below"
                  className="mt-1 min-h-24 w-full resize-y rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none focus:border-indigo-400"
                />
              </label>
              {tasks.length > 0 && (
                <select
                  value=""
                  onChange={(event) => {
                    const task = tasks.find((item) => item.id === event.target.value);
                    if (task) setSeed(task.description ? `${task.title}\n\n${task.description}` : task.title);
                  }}
                  className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-300"
                  aria-label="Use board task as seed"
                >
                  <option value="">Use a board task as seed…</option>
                  {tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </select>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-[11px] font-medium text-slate-400">
                Add agent
                <div className="mt-1 flex gap-2">
                  <select
                    value={selectedProfile}
                    onChange={(event) => setSelectedProfile(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-xs text-slate-300"
                  >
                    {profiles.length === 0 && <option value="">No roster loaded</option>}
                    {profiles.map((profile) => <option key={profile.id} value={profile.name}>{profile.name}</option>)}
                  </select>
                  <button type="button" onClick={addProfile} disabled={!selectedProfile} className="rounded-lg bg-indigo-500/20 p-2 text-indigo-300 disabled:opacity-40" title="Add agent to chain">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </label>
              <label className="text-[11px] font-medium text-slate-400">
                Max hops
                <input type="number" min={1} max={20} value={maxHops} onChange={(event) => setMaxHops(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-300" />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={useChildren} onChange={(event) => setUseChildren(event.target.checked)} className="accent-indigo-500" />
                Spawn child conversation per hop
              </label>
              <div className="flex gap-2">
                {relayStatus !== "running" ? (
                  <button type="button" onClick={startRelay} disabled={!seed.trim() || chain.length === 0} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">
                    <Play className="h-3.5 w-3.5" /> Start relay
                  </button>
                ) : (
                  <button type="button" onClick={stopRelay} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-500/20 px-3 py-2 text-xs font-semibold text-rose-300">
                    <Square className="h-3.5 w-3.5" /> Stop relay
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {chain.map((profile, index) => (
              <div key={`${profile}-${index}`} className="flex items-center gap-1">
                <span className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200">{profile}</span>
                <button type="button" onClick={() => setChain((current) => current.filter((_, currentIndex) => currentIndex !== index))} disabled={relayStatus === "running"} className="rounded p-1 text-slate-500 hover:text-rose-300 disabled:opacity-40" title={`Remove ${profile}`}>
                  <Trash2 className="h-3 w-3" />
                </button>
                {index < chain.length - 1 && <span className="text-indigo-400">→</span>}
              </div>
            ))}
            {chain.length === 0 && <p className="text-xs text-slate-500">Add at least one agent to build the relay chain.</p>}
          </div>

          <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
            {relayHops.length === 0 && <Empty label="Relay hops will appear here live." />}
            {relayHops.map((hop, index) => (
              <div key={`${hop.agent}-${index}`} className={`rounded-xl border px-4 py-3 ${hop.status === "running" ? "border-blue-400/50 bg-blue-500/10" : hop.status === "failed" ? "border-rose-400/40 bg-rose-500/10" : "border-white/5 bg-slate-950/30"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-200">Hop {index + 1} · {hop.agent}</p>
                  <span className={`text-[10px] uppercase ${hop.status === "failed" ? "text-rose-400" : hop.status === "running" ? "text-blue-400" : "text-emerald-400"}`}>{hop.status}</span>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">Asked</p>
                <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{hop.question}</p>
                {hop.response && (
                  <>
                    <p className="mt-3 text-[11px] text-slate-500">{hop.agent} answered</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-white">{hop.response}</p>
                  </>
                )}
                {hop.error && <p className="mt-2 text-xs text-rose-300">{hop.error}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>
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
                <span className="text-right text-[11px] text-slate-400">
                  {run.tokensInReported === false && run.tokensOutReported === false
                    ? "Tokens unavailable"
                    : `${formatTokens(run.tokensIn + run.tokensOut)} tokens reported`}<br />
                  {run.costReported === false ? "Cost unavailable" : `${formatCost(run.cost)} reported`}
                </span>
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
