/**
 * ai.ts — the AI Work Orchestration data model.
 *
 * This layer sits on top of the existing Task model. Every AI field is
 * optional and backward-compatible: a task with no AI overlay is still a
 * valid Task, and the board renders it exactly as before. The AI layer is
 * what turns a Kanban board into an orchestration platform — it adds agents,
 * LLM providers, routing rules, agent teams, task dependencies, workflows,
 * execution history, and token/cost tracking.
 *
 * Design inspiration: Linear (clean task model), OpenRouter (multi-provider
 * model catalog), LangGraph (DAG workflows), CrewAI (agent teams), n8n
 * (routing rules), Temporal (execution history / runs).
 */

import type { Task, TaskPriority, TaskStatus } from "./task";

/** An LLM model from a provider (OpenRouter-style catalog). */
export interface LLMModel {
  id: string;
  name: string;
  /** Provider slug, e.g. "openai", "anthropic", "google", "mistral". */
  provider: string;
  /** Context window in tokens. */
  contextWindow: number;
  /** USD per 1k input tokens. */
  inputCostPer1k: number;
  /** USD per 1k output tokens. */
  outputCostPer1k: number;
  /** Approximate generation speed in tokens/second. */
  speed: number;
  /** Capability tags, e.g. "reasoning", "code", "vision". */
  tags: string[];
}

/** An AI agent that can execute tasks. */
export interface Agent {
  id: string;
  name: string;
  /** The agent's role, e.g. "Researcher", "Coder", "Reviewer". */
  role: string;
  /** The model this agent runs on. */
  modelId: string;
  /** One-line description of what the agent does. */
  description: string;
  /** Capability tags used by routing rules. */
  capabilities: string[];
  /** Max tasks this agent can run in parallel. */
  maxConcurrent: number;
  /** Live status. */
  status: "idle" | "running" | "offline";
  /** Avatar gradient (Tailwind classes). */
  avatar: string;
}

/** A team of agents working together (CrewAI-style). */
export interface AgentTeam {
  id: string;
  name: string;
  description: string;
  /** Member agent ids. */
  memberIds: string[];
  /** The lead agent that coordinates the team. */
  leadAgentId: string;
}

/**
 * A routing rule (n8n-style). Rules are evaluated in ascending `priority`
 * order; the first rule whose condition matches a task wins.
 */
export interface RoutingRule {
  id: string;
  name: string;
  /** Lower number = higher precedence. */
  priority: number;
  /** The condition that selects tasks for this rule. */
  condition: RoutingCondition;
  /** Route to a specific agent, or to a specific model (agent-agnostic). */
  target: { agentId?: string; modelId?: string };
}

/** The condition part of a routing rule. */
export type RoutingCondition =
  | { type: "tag"; tag: string }
  | { type: "priority"; priority: TaskPriority }
  | { type: "status"; status: TaskStatus }
  | { type: "always" };

/** A single execution of a task by an agent (Temporal-style run). */
export interface ExecutionRun {
  id: string;
  taskId: string;
  taskTitle: string;
  agentId: string;
  modelId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  startedAt: number | null;
  finishedAt: number | null;
  tokensIn: number;
  tokensOut: number;
  /** USD cost of this run. */
  cost: number;
  /** Ordered execution steps (the agent's trace). */
  log: ExecutionStep[];
  error?: string;
}

/** One step in an execution trace. */
export interface ExecutionStep {
  label: string;
  detail?: string;
  at: number;
}

/** A workflow: a DAG of tasks with explicit dependencies (LangGraph-style). */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** Task ids that participate in this workflow. */
  nodeIds: string[];
  /** Directed edges: from -> to (to depends on from). */
  edges: { from: string; to: string }[];
  status: "draft" | "active" | "completed";
}

/**
 * Per-task AI overlay. Stored in localStorage (like tags/dueDate) and merged
 * onto fetched tasks. All fields optional — a task with no overlay is a plain
 * Task.
 */
export interface TaskAiOverlay {
  /** The agent assigned to this task. */
  agentId?: string;
  /** The model this task runs on (overrides the agent's default). */
  modelId?: string;
  /** The team this task belongs to. */
  teamId?: string;
  /** Task ids this task depends on (must complete first). */
  dependsOn?: string[];
  /** Accumulated token usage across all runs. */
  tokensIn?: number;
  tokensOut?: number;
  /** Accumulated USD cost across all runs. */
  cost?: number;
  /** The most recent execution status. */
  executionStatus?: ExecutionRun["status"];
  /** Timestamp of the last run. */
  lastRunAt?: number;
}

/** A task with its AI overlay merged in. */
export interface EnrichedTask extends Task {
  ai: TaskAiOverlay;
}

/** The full AI configuration (agents, models, teams, rules, workflows). */
export interface AiConfig {
  agents: Agent[];
  models: LLMModel[];
  teams: AgentTeam[];
  routingRules: RoutingRule[];
  workflows: Workflow[];
}

/** The live orchestration state (ephemeral, never persisted). */
export interface ExecutionState {
  /** Whether the orchestration loop is running. */
  running: boolean;
  /** Runs currently in flight. */
  activeRuns: ExecutionRun[];
  /** Completed runs (most recent first). */
  history: ExecutionRun[];
  /** Total tokens consumed this session. */
  totalTokensIn: number;
  totalTokensOut: number;
  /** Total USD cost this session. */
  totalCost: number;
}

/** The full AI state: config + live execution + the per-task AI overlay. */
export interface AiState {
  config: AiConfig;
  execution: ExecutionState;
  /** Per-task AI overlay (agent, model, deps, tokens, cost, execution status). */
  overlay: Record<string, TaskAiOverlay>;
}

/** The result of resolving a task's routing. */
export interface RoutingResolution {
  agentId: string | null;
  modelId: string | null;
  /** The rule that matched, or null if no rule matched. */
  rule: RoutingRule | null;
}

/** A cost estimate for running a task on a model. */
export interface CostEstimate {
  tokensIn: number;
  tokensOut: number;
  cost: number;
}
