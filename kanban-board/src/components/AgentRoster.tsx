/**
 * AgentRoster — the "Agents" view.
 *
 * Shows the full AI orchestration configuration:
 *   - Agent roster (cards with role, model, capabilities, status).
 *   - Agent teams (grouped members with a lead).
 *   - Routing rules (n8n-style, ordered by priority).
 *   - Model catalog (OpenRouter-style, with cost/speed).
 *
 * All data comes from the AI config store. Editing is read-only in this view —
 * the config is seeded and persisted; a "Reset" action restores the seed.
 */

import {
  Bot,
  Users,
  Route,
  Cpu,
  RotateCcw,
  Zap,
  Gauge,
  Brain,
  ShieldCheck,
  PenLine,
  Wrench,
  Search,
} from "lucide-react";
import type { AiState, Agent, AgentTeam, LLMModel, RoutingRule } from "../types/ai";
import { useMemo, useState } from "react";
import { formatCost } from "../lib/ai-engine";

interface AgentRosterProps {
  aiState: AiState;
  onReset: () => void;
  onConfigChange?: (config: AiState["config"]) => void;
}

/** Map an agent role to an icon. */
function roleIcon(role: string) {
  switch (role) {
    case "Researcher":
      return Search;
    case "Coder":
      return Brain;
    case "Reviewer":
      return ShieldCheck;
    case "Writer":
      return PenLine;
    case "Ops":
      return Wrench;
    default:
      return Bot;
  }
}

export function AgentRoster({ aiState, onReset, onConfigChange }: AgentRosterProps) {
  const { agents, teams, routingRules, models } = aiState.config;
  const [editing, setEditing] = useState(false);
  const [ruleName, setRuleName] = useState("");
  const [priority, setPriority] = useState("100");
  const [conditionType, setConditionType] = useState<"always" | "tag" | "priority" | "status">("always");
  const [conditionValue, setConditionValue] = useState("");
  const [targetType, setTargetType] = useState<"agent" | "model">("agent");
  const [targetId, setTargetId] = useState(agents[0]?.id ?? "");
  const [validationError, setValidationError] = useState("");
  const preview = useMemo(() => {
    const target = targetType === "agent"
      ? agents.find((agent) => agent.id === targetId)?.name ?? "unresolved profile"
      : models.find((model) => model.id === targetId)?.name ?? "unresolved model";
    return `task -> ${target}${targetType === "agent" ? ` -> ${models.find((model) => model.id === agents.find((agent) => agent.id === targetId)?.modelId)?.name ?? "profile model"}` : ""}`;
  }, [agents, models, targetId, targetType]);

  const saveRule = () => {
    if (!ruleName.trim()) {
      setValidationError("Rule name is required.");
      return;
    }
    const priorityNumber = Number(priority);
    if (!Number.isInteger(priorityNumber) || priorityNumber < 0) {
      setValidationError("Priority must be a non-negative integer.");
      return;
    }
    if (!targetId) {
      setValidationError("A route target is required.");
      return;
    }
    if (conditionType === "tag" && !conditionValue.trim()) {
      setValidationError("Tag condition is required.");
      return;
    }
    if (conditionType === "priority" && !["low", "medium", "high"].includes(conditionValue)) {
      setValidationError("Priority must be low, medium, or high.");
      return;
    }
    if (conditionType === "status" && !["todo", "in_progress", "review", "done"].includes(conditionValue)) {
      setValidationError("Status must be todo, in_progress, review, or done.");
      return;
    }
    let condition: RoutingRule["condition"];
    if (conditionType === "always") condition = { type: "always" };
    else if (conditionType === "tag") condition = { type: "tag", tag: conditionValue.trim() };
    else if (conditionType === "priority") condition = { type: "priority", priority: conditionValue as "low" | "medium" | "high" };
    else condition = { type: "status", status: conditionValue as "todo" | "in_progress" | "review" | "done" };
    const rule: RoutingRule = {
      id: `rule-${Date.now()}`,
      name: ruleName.trim(),
      priority: priorityNumber,
      condition,
      target: targetType === "agent" ? { agentId: targetId } : { modelId: targetId },
    };
    onConfigChange?.({ ...aiState.config, routingRules: [...routingRules, rule] });
    setValidationError("");
    setEditing(false);
    setRuleName("");
  };

  return (
    <div className="relative z-10 flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">
            Orchestration Configuration
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {agents.length} agents · {teams.length} teams · {routingRules.length} routing rules ·{" "}
            {models.length} models
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="kb-glass-sm flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-slate-300 transition hover:text-white"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset config
        </button>
      </div>

      {/* Agents */}
      <section>
        <SectionTitle icon={Bot} label="Agent Roster" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} model={models.find((m) => m.id === agent.modelId)} />
          ))}
        </div>
      </section>

      {/* Teams */}
      <section>
        <SectionTitle icon={Users} label="Agent Teams" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} agents={agents} />
          ))}
        </div>
      </section>

      {/* Routing rules */}
      <section>
        <SectionTitle icon={Route} label="Routing Rules" />
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">Persisted OpenHands routing configuration</p>
          <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-lg bg-indigo-500/20 px-3 py-2 text-xs font-semibold text-indigo-300">
            {editing ? "Cancel" : "Add routing rule"}
          </button>
        </div>
        {editing && (
          <div className="kb-glass mb-3 rounded-2xl p-4">
            <h3 className="mb-3 text-sm font-semibold text-white">Routing Rule Editor</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input aria-label="Rule name" value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder="Rule name" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white" />
              <input aria-label="Rule priority" type="number" value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white" />
              <select aria-label="Rule condition" value={conditionType} onChange={(event) => setConditionType(event.target.value as typeof conditionType)} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white">
                <option value="always">Always</option><option value="tag">Tag</option><option value="priority">Priority</option><option value="status">Status</option>
              </select>
              {conditionType !== "always" && <input aria-label="Condition value" value={conditionValue} onChange={(event) => setConditionValue(event.target.value)} placeholder={conditionType} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white" />}
              <select aria-label="Target type" value={targetType} onChange={(event) => { setTargetType(event.target.value as "agent" | "model"); setTargetId(event.target.value === "agent" ? agents[0]?.id ?? "" : models[0]?.id ?? ""); }} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white">
                <option value="agent">Profile / agent</option><option value="model">Model</option>
              </select>
              <select aria-label="Target" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white">
                {(targetType === "agent" ? agents : models).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </div>
            {validationError && <p className="mt-3 text-xs text-rose-400">{validationError}</p>}
            <p className="mt-3 text-xs text-slate-400">Route preview: {preview}</p>
            <button type="button" onClick={saveRule} className="mt-3 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white">Save routing rule</button>
          </div>
        )}
        <div className="kb-glass kb-fade-in flex flex-col gap-2 rounded-2xl p-4">
          {[...routingRules]
            .sort((a, b) => a.priority - b.priority)
            .map((rule) => (
              <RoutingRuleRow key={rule.id} rule={rule} agents={agents} models={models} />
            ))}
        </div>
      </section>

      {/* Model catalog */}
      <section>
        <SectionTitle icon={Cpu} label="Model Catalog" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: typeof Bot; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-indigo-400" strokeWidth={1.75} />
      <h3 className="text-sm font-semibold tracking-tight text-slate-200">{label}</h3>
    </div>
  );
}

function AgentCard({ agent, model }: { agent: Agent; model?: LLMModel }) {
  const Icon = roleIcon(agent.role);
  return (
    <div className="kb-glass kb-fade-in group relative overflow-hidden rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-12px_rgba(99,102,241,0.4)]">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${agent.avatar} shadow-lg`}
        >
          <Icon className="h-5 w-5 text-white" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-white">{agent.name}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                agent.status === "idle"
                  ? "bg-emerald-500/15 text-emerald-400 ring-emerald-400/25"
                  : "bg-blue-500/15 text-blue-400 ring-blue-400/25"
              }`}
            >
              {agent.status}
            </span>
          </div>
          <p className="text-xs text-slate-400">{agent.role}</p>
        </div>
      </div>

      <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-slate-400">
        {agent.description}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {agent.capabilities.map((cap) => (
          <span
            key={cap}
            className="rounded-md bg-slate-700/40 px-2 py-0.5 text-[10px] font-medium text-slate-300"
          >
            {cap}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs">
        <span className="flex items-center gap-1.5 text-slate-400">
          <Cpu className="h-3.5 w-3.5 text-indigo-400" />
          {model?.name ?? "—"}
        </span>
        <span className="text-slate-500">max {agent.maxConcurrent} parallel</span>
      </div>
    </div>
  );
}

function TeamCard({ team, agents }: { team: AgentTeam; agents: Agent[] }) {
  const members = team.memberIds
    .map((id) => agents.find((a) => a.id === id))
    .filter((a): a is Agent => Boolean(a));
  const lead = agents.find((a) => a.id === team.leadAgentId);

  return (
    <div className="kb-glass kb-fade-in rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">{team.name}</p>
        {lead && (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br ${lead.avatar} text-[10px] font-bold text-white`}
            >
              {lead.name[0]}
            </span>
            lead: {lead.name}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">{team.description}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {members.map((m) => (
          <span
            key={m.id}
            className="flex items-center gap-1.5 rounded-lg bg-slate-700/40 px-2 py-1 text-xs text-slate-300"
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br ${m.avatar} text-[9px] font-bold text-white`}
            >
              {m.name[0]}
            </span>
            {m.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function RoutingRuleRow({
  rule,
  agents,
  models,
}: {
  rule: RoutingRule;
  agents: Agent[];
  models: LLMModel[];
}) {
  const agent = agents.find((a) => a.id === rule.target.agentId);
  const model = models.find((m) => m.id === rule.target.modelId);
  const conditionLabel = describeCondition(rule.condition);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-800/40 px-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/20 text-xs font-bold text-indigo-300">
        {rule.priority}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-slate-200">{rule.name}</p>
        <p className="text-[11px] text-slate-500">when {conditionLabel}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 text-xs text-slate-300">
        {agent && (
          <span className="flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-1">
            <Bot className="h-3 w-3 text-indigo-400" /> {agent.name}
          </span>
        )}
        {model && (
          <span className="flex items-center gap-1 rounded-md bg-slate-700/50 px-2 py-1">
            <Cpu className="h-3 w-3 text-violet-400" /> {model.name}
          </span>
        )}
      </div>
    </div>
  );
}

function describeCondition(condition: RoutingRule["condition"]): string {
  switch (condition.type) {
    case "always":
      return "always";
    case "tag":
      return `tag is "${condition.tag}"`;
    case "priority":
      return `priority is ${condition.priority}`;
    case "status":
      return `status is ${condition.status.replace("_", " ")}`;
    default:
      return "unknown";
  }
}

function ModelCard({ model }: { model: LLMModel }) {
  return (
    <div className="kb-glass kb-fade-in rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">{model.name}</p>
        <span className="rounded-md bg-slate-700/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          {model.provider}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Gauge className="h-3.5 w-3.5 text-emerald-400" />
          {model.speed} tok/s
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          {(model.contextWindow / 1000).toFixed(0)}k ctx
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-xs">
        <span className="text-slate-500">
          in {formatCost(model.inputCostPer1k)}/1k · out {formatCost(model.outputCostPer1k)}/1k
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {model.tags.map((tag) => (
          <span key={tag} className="rounded bg-slate-700/40 px-1.5 py-0.5 text-[10px] text-slate-400">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
