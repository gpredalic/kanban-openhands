/**
 * ai-overlay.ts — localStorage-backed AI overlay + global AI config.
 *
 * Two storage concerns:
 *   1. Per-task AI overlay (agentId, modelId, teamId, dependsOn, tokens, cost,
 *      executionStatus) — keyed by task id, merged onto fetched tasks. This is
 *      the same pattern as tags/dueDate: the host backend doesn't persist AI
 *      fields, so the overlay is the source of truth until it does.
 *   2. Global AI config (agents, models, teams, routing rules, workflows) —
 *      a single document. Seeded with realistic data on first load so the
 *      orchestration platform is immediately usable.
 *
 * Backward compatibility: a task with no overlay entry is returned untouched.
 * A corrupt or missing config falls back to the seed, never breaking the board.
 */

import type {
  AiConfig,
  Agent,
  AgentTeam,
  EnrichedTask,
  LLMModel,
  RoutingRule,
  TaskAiOverlay,
  Workflow,
} from "../types/ai";
import type { Host, Task } from "../types/task";

/** Storage keys, namespaced to avoid collisions with other extensions. */
const AI_OVERLAY_KEY = "kanban-board.ai-overlay.v1";
const AI_CONFIG_KEY = "kanban-board.ai-config.v1";
export const ROUTING_FILE_PATH = "/home/razvijalec/.kanban-board/routing-rules.json";

/* ------------------------------------------------------------------ *
 * Seed data — a realistic multi-provider, multi-agent setup.
 * ------------------------------------------------------------------ */

/** A realistic LLM catalog (OpenRouter-style). */
export const SEED_MODELS: LLMModel[] = [
  {
    id: "gpt-5",
    name: "GPT-5",
    provider: "openai",
    contextWindow: 400_000,
    inputCostPer1k: 0.0012,
    outputCostPer1k: 0.006,
    speed: 180,
    tags: ["reasoning", "code", "vision"],
  },
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    provider: "anthropic",
    contextWindow: 200_000,
    inputCostPer1k: 0.0015,
    outputCostPer1k: 0.0075,
    speed: 120,
    tags: ["reasoning", "code", "long-context"],
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "google",
    contextWindow: 1_000_000,
    inputCostPer1k: 0.00125,
    outputCostPer1k: 0.01,
    speed: 150,
    tags: ["reasoning", "vision", "long-context"],
  },
  {
    id: "mistral-large",
    name: "Mistral Large",
    provider: "mistral",
    contextWindow: 128_000,
    inputCostPer1k: 0.0009,
    outputCostPer1k: 0.003,
    speed: 220,
    tags: ["code", "fast"],
  },
  {
    id: "llama-4-70b",
    name: "Llama 4 70B",
    provider: "meta",
    contextWindow: 128_000,
    inputCostPer1k: 0.0004,
    outputCostPer1k: 0.0012,
    speed: 260,
    tags: ["code", "fast", "open-weights"],
  },
];

/** A realistic agent roster (CrewAI-style roles). */
export const SEED_AGENTS: Agent[] = [
  {
    id: "agent-research",
    name: "Scout",
    role: "Researcher",
    modelId: "gemini-2.5-pro",
    description: "Gathers context, reads docs, and summarizes findings.",
    capabilities: ["research", "summarize", "long-context"],
    maxConcurrent: 3,
    status: "idle",
    avatar: "bg-[#3a5a6b]",
  },
  {
    id: "agent-coder",
    name: "Forge",
    role: "Coder",
    modelId: "claude-opus-4",
    description: "Implements features, writes tests, and refactors code.",
    capabilities: ["code", "reasoning", "tests"],
    maxConcurrent: 2,
    status: "idle",
    avatar: "bg-[#4a3a6b]",
  },
  {
    id: "agent-reviewer",
    name: "Sentinel",
    role: "Reviewer",
    modelId: "gpt-5",
    description: "Reviews diffs, flags risks, and enforces standards.",
    capabilities: ["review", "reasoning", "security"],
    maxConcurrent: 2,
    status: "idle",
    avatar: "bg-[#6b5a3a]",
  },
  {
    id: "agent-writer",
    name: "Quill",
    role: "Writer",
    modelId: "mistral-large",
    description: "Drafts docs, release notes, and user-facing copy.",
    capabilities: ["writing", "summarize", "fast"],
    maxConcurrent: 4,
    status: "idle",
    avatar: "bg-[#3a6b5a]",
  },
  {
    id: "agent-ops",
    name: "Relay",
    role: "Ops",
    modelId: "llama-4-70b",
    description: "Runs builds, deploys, and monitors pipelines.",
    capabilities: ["ops", "fast", "code"],
    maxConcurrent: 3,
    status: "idle",
    avatar: "bg-[#6b3a5a]",
  },
];

/** Agent teams (CrewAI-style). */
export const SEED_TEAMS: AgentTeam[] = [
  {
    id: "team-build",
    name: "Build Crew",
    description: "Research → code → review pipeline for feature work.",
    memberIds: ["agent-research", "agent-coder", "agent-reviewer"],
    leadAgentId: "agent-coder",
  },
  {
    id: "team-ship",
    name: "Ship Crew",
    description: "Docs + ops for release and deployment.",
    memberIds: ["agent-writer", "agent-ops"],
    leadAgentId: "agent-ops",
  },
];

/** Routing rules (n8n-style), evaluated in ascending priority. */
export const SEED_ROUTING_RULES: RoutingRule[] = [
  {
    id: "rule-review",
    name: "Reviews go to Sentinel",
    priority: 10,
    condition: { type: "status", status: "review" },
    target: { agentId: "agent-reviewer" },
  },
  {
    id: "rule-code",
    name: "Code tasks go to Forge",
    priority: 20,
    condition: { type: "tag", tag: "backend" },
    target: { agentId: "agent-coder" },
  },
  {
    id: "rule-high",
    name: "High priority → GPT-5",
    priority: 30,
    condition: { type: "priority", priority: "high" },
    target: { modelId: "gpt-5" },
  },
  {
    id: "rule-default",
    name: "Default → Scout",
    priority: 100,
    condition: { type: "always" },
    target: { agentId: "agent-research" },
  },
];

/** A sample workflow DAG (LangGraph-style). */
export const SEED_WORKFLOWS: Workflow[] = [
  {
    id: "wf-feature",
    name: "Feature Pipeline",
    description: "Research → implement → review → ship.",
    status: "active",
    nodes: [
      { id: "t1", type: "task", label: "Research", x: 80, y: 160, taskId: "t1" },
      { id: "t2", type: "task", label: "Implement", x: 320, y: 160, taskId: "t2" },
      { id: "t3", type: "approval", label: "Review", x: 560, y: 160 },
      { id: "t4", type: "task", label: "Ship", x: 800, y: 160, taskId: "t4" },
    ],
    edges: [
      { id: "wf-e1", from: "t1", to: "t2", name: "Research Complete", condition: "IF_SUCCESS" },
      { id: "wf-e2", from: "t2", to: "t3", name: "Implementation Ready", condition: "IF_SUCCESS" },
      { id: "wf-e3", from: "t3", to: "t4", name: "Approved", condition: "IF_APPROVED" },
    ],
  },
];

/** The default AI config, used on first load and as a fallback. */
export function seedAiConfig(): AiConfig {
  return {
    agents: SEED_AGENTS.map((a) => ({ ...a })),
    models: SEED_MODELS.map((m) => ({ ...m })),
    teams: SEED_TEAMS.map((t) => ({ ...t, memberIds: [...t.memberIds] })),
    routingRules: SEED_ROUTING_RULES.map((r) => ({ ...r, condition: { ...r.condition }, target: { ...r.target } })),
    workflows: SEED_WORKFLOWS.map((w) => ({ ...w, nodes: w.nodes.map((n) => ({ ...n })), edges: w.edges.map((e) => ({ ...e })) })),
  };
}

/* ------------------------------------------------------------------ *
 * Per-task AI overlay.
 * ------------------------------------------------------------------ */

/** Read the AI overlay from localStorage. Defensive — never throws. */
export function loadAiOverlay(): Record<string, TaskAiOverlay> {
  try {
    const raw = localStorage.getItem(AI_OVERLAY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, TaskAiOverlay>;
  } catch {
    return {};
  }
}

/** Persist the AI overlay. */
export function saveAiOverlay(overlay: Record<string, TaskAiOverlay>): void {
  try {
    localStorage.setItem(AI_OVERLAY_KEY, JSON.stringify(overlay));
  } catch {
    // Quota exceeded or storage disabled — the board still works.
  }
}

/**
 * Merge the AI overlay onto a flat task list, producing EnrichedTask[].
 * Tasks with no overlay entry get an empty `ai` object (still valid).
 *
 * Identity is stable: a task whose content and overlay entry are unchanged
 * returns the SAME EnrichedTask object it returned last time. This is what
 * lets React.memo(TaskCard) skip re-rendering unchanged cards when the
 * enrichedTasks memo recomputes after a real change (a task moved, a new task
 * appeared). Without this, every recompute produced fresh objects for every
 * task and the whole board re-rendered.
 */
const enrichedCache = new Map<string, { taskRef: Task; overlayFingerprint: string; enriched: EnrichedTask }>();

/** Fingerprint a task's content + its overlay entry (ignores object identity). */
function enrichedFingerprint(task: Task, overlayEntry: TaskAiOverlay | undefined): string {
  const ai = overlayEntry ?? {};
  return [
    task.id,
    task.title,
    task.status,
    task.assignee ?? "",
    task.agentId ?? "",
    ai.agentId ?? "",
    ai.modelId ?? "",
    ai.teamId ?? "",
    ai.executionStatus ?? "",
    ai.executionId ?? "",
    ai.lastRunAt ?? 0,
    ai.tokensIn ?? 0,
    ai.tokensOut ?? 0,
    ai.cost ?? 0,
    (ai.dependsOn ?? []).join(","),
  ].join("|");
}

export function applyAiOverlay(tasks: Task[], overlay: Record<string, TaskAiOverlay>): EnrichedTask[] {
  const seen = new Set<string>();
  const result: EnrichedTask[] = tasks.map((task) => {
    seen.add(task.id);
    const overlayEntry = overlay[task.id];
    const fingerprint = enrichedFingerprint(task, overlayEntry);
    const cached = enrichedCache.get(task.id);
    if (cached && cached.taskRef === task && cached.overlayFingerprint === fingerprint) {
      return cached.enriched;
    }
    const enriched: EnrichedTask = {
      ...task,
      ai: {
        ...(task.agentId ? { agentId: task.agentId } : {}),
        ...(overlayEntry ?? {}),
      },
    };
    enrichedCache.set(task.id, { taskRef: task, overlayFingerprint: fingerprint, enriched });
    return enriched;
  });
  // Prune cache entries for tasks that no longer exist so the map stays bounded.
  for (const id of enrichedCache.keys()) {
    if (!seen.has(id)) enrichedCache.delete(id);
  }
  return result;
}

/**
 * Update (or create) a single task's AI overlay entry and persist it.
 * A field set to `null`/`undefined` clears it.
 */
export function setTaskAiOverlay(taskId: string, patch: Partial<TaskAiOverlay>): Record<string, TaskAiOverlay> {
  const overlay = loadAiOverlay();
  const existing = overlay[taskId] ?? {};
  const next: TaskAiOverlay = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key as keyof TaskAiOverlay];
    else (next as Record<string, unknown>)[key] = value;
  }
  overlay[taskId] = next;
  saveAiOverlay(overlay);
  return overlay;
}

/** Remove a task's AI overlay entry (e.g. after the task is deleted). */
export function clearTaskAiOverlay(taskId: string): Record<string, TaskAiOverlay> {
  const overlay = loadAiOverlay();
  if (taskId in overlay) {
    delete overlay[taskId];
    saveAiOverlay(overlay);
  }
  return overlay;
}

/* ------------------------------------------------------------------ *
 * Global AI config.
 * ------------------------------------------------------------------ */

/** Read the AI config from localStorage, falling back to the seed. */
export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (!raw) return seedAiConfig();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return seedAiConfig();
    const p = parsed as Partial<AiConfig>;
    // Defensive: ensure every collection is an array.
    return {
      agents: Array.isArray(p.agents) ? p.agents : seedAiConfig().agents,
      models: Array.isArray(p.models) ? p.models : seedAiConfig().models,
      teams: Array.isArray(p.teams) ? p.teams : seedAiConfig().teams,
      routingRules: Array.isArray(p.routingRules) ? p.routingRules : seedAiConfig().routingRules,
      workflows: Array.isArray(p.workflows) ? p.workflows : seedAiConfig().workflows,
    };
  } catch {
    return seedAiConfig();
  }
}

/** Persist the AI config. */
export function saveAiConfig(config: AiConfig): void {
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

function isRoutingRule(value: unknown): value is RoutingRule {
  if (!value || typeof value !== "object") return false;
  const rule = value as Partial<RoutingRule>;
  return typeof rule.id === "string"
    && typeof rule.name === "string"
    && typeof rule.priority === "number"
    && !!rule.condition
    && !!rule.target;
}

export async function fetchRoutingRules(host: Host): Promise<RoutingRule[]> {
  try {
    const response = await host.agentServer.request({
      method: "GET",
      path: `/api/file/download?path=${encodeURIComponent(ROUTING_FILE_PATH)}`,
    });
    if (Array.isArray(response)) return response.filter(isRoutingRule);
    if (typeof response === "string") {
      const parsed = JSON.parse(response);
      if (Array.isArray(parsed)) return parsed.filter(isRoutingRule);
      if (parsed && Array.isArray(parsed.rules)) return parsed.rules.filter(isRoutingRule);
    }
    if (response && typeof response === "object" && Array.isArray((response as { rules?: unknown[] }).rules)) {
      return (response as { rules: unknown[] }).rules.filter(isRoutingRule);
    }
  } catch {
    // File-backed rules fall back to the local configuration.
  }
  return [];
}

export async function saveRoutingRules(host: Host, rules: RoutingRule[]): Promise<void> {
  const form = new FormData();
  form.append("file", new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" }), "routing-rules.json");
  await host.agentServer.request({
    method: "POST",
    path: `/api/file/upload?path=${encodeURIComponent(ROUTING_FILE_PATH)}`,
    body: form,
  });
}

/** Reset the AI config to the seed (used by the "Reset" action). */
export function resetAiConfig(): AiConfig {
  const config = seedAiConfig();
  saveAiConfig(config);
  return config;
}
