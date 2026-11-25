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
  status: "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";
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

/** The kind of a workflow node. */
export type WorkflowNodeType =
  | "task"
  | "agent"
  | "condition"
  | "approval"
  | "start"
  | "end"
  | "delay"
  | "relay"
  | "loop";

/**
 * The execution rule that governs when an edge fires. Mirrors the branching
 * semantics of n8n / LangGraph: a node's outgoing edges are evaluated against
 * the node's terminal state and the matching edge(s) advance the workflow.
 *
 * The IF_TRUE / IF_FALSE / IF_TIMEOUT values support explicit conditional
 * routing on a custom expression (see WorkflowEdge.expression), e.g.
 * `status == 'approved'` or `amount > 1000`.
 */
export type EdgeCondition =
  | "IF_SUCCESS"
  | "IF_FAILURE"
  | "IF_ALWAYS"
  | "IF_APPROVED"
  | "IF_REJECTED"
  | "IF_RETRY_EXHAUSTED"
  | "IF_MANUAL_APPROVAL"
  | "IF_TRUE"
  | "IF_FALSE"
  | "IF_TIMEOUT"
  | "IF_CANCEL"
  | "IF_LOOP";

/**
 * The eight branch types a workflow edge can express. Each maps to one or more
 * EdgeCondition values so the engine can route on a node's terminal state.
 *
 *   Success          -> IF_SUCCESS
 *   Failure          -> IF_FAILURE
 *   Retry            -> IF_RETRY_EXHAUSTED (fire when retries are exhausted)
 *   Timeout          -> IF_TIMEOUT
 *   Cancel           -> IF_CANCEL
 *   Manual Approval  -> IF_MANUAL_APPROVAL / IF_APPROVED / IF_REJECTED
 *   Conditional      -> IF_TRUE / IF_FALSE (custom expression)
 *   Loop             -> IF_LOOP (re-enter an upstream node, bounded by a limit)
 */
export type BranchType =
  | "success"
  | "failure"
  | "retry"
  | "timeout"
  | "cancel"
  | "manual_approval"
  | "conditional"
  | "loop";

/** The EdgeCondition values that belong to each branch type. */
export const BRANCH_CONDITIONS: Record<BranchType, EdgeCondition[]> = {
  success: ["IF_SUCCESS"],
  failure: ["IF_FAILURE"],
  retry: ["IF_RETRY_EXHAUSTED"],
  timeout: ["IF_TIMEOUT"],
  cancel: ["IF_CANCEL"],
  manual_approval: ["IF_MANUAL_APPROVAL", "IF_APPROVED", "IF_REJECTED"],
  conditional: ["IF_TRUE", "IF_FALSE"],
  loop: ["IF_LOOP"],
};

/** Resolve the branch type an edge's condition belongs to. */
export function branchTypeForCondition(condition: EdgeCondition): BranchType {
  for (const [branch, conditions] of Object.entries(BRANCH_CONDITIONS) as [BranchType, EdgeCondition[]][]) {
    if (conditions.includes(condition)) return branch;
  }
  return "success";
}

/**
 * Type-specific node configuration. Each node type exposes its own dedicated
 * configuration panel; the fields below are the contract for those panels.
 * All fields are optional so a node with no config is still valid and the
 * editor renders sensible defaults.
 */
export interface WorkflowNodeConfig {
  /* ---- Agent ---- */
  /** Agent profile name (OpenHands agent-profile). */
  agentProfile?: string;
  /** The prompt / instruction sent to the agent. */
  prompt?: string;
  /** Tool names the agent may use (from the tool catalog). */
  tools?: string[];
  /** Memory mode: none, session, or persistent. */
  memory?: "none" | "session" | "persistent";
  /** Context mode: none, task, or workflow. */
  context?: "none" | "task" | "workflow";
  /** Timeout in seconds before the node is considered timed out. */
  timeoutSeconds?: number;
  /** Retry policy. */
  retryPolicy?: RetryPolicy;

  /* ---- Task ---- */
  /** Task description (beyond the label). */
  description?: string;
  /** Declared expected output. */
  expectedOutput?: string;
  /** Declared input variables (name → description). */
  inputs?: NodeVariable[];
  /** Declared output variables (name → description). */
  outputs?: NodeVariable[];

  /* ---- Condition ---- */
  /** The routing expression, e.g. `amount > 1000`. */
  expression?: string;
  /** Variables the expression may reference. */
  variables?: NodeVariable[];
  /** Validation message shown when the expression is malformed. */
  validation?: string;

  /* ---- Approval ---- */
  /** The approver (profile name or user). */
  approver?: string;
  /** Escalation rules applied when the SLA is breached. */
  escalationRules?: EscalationRule[];
  /** Service-level agreement in hours. */
  slaHours?: number;

  /* ---- Delay ---- */
  /** Duration in seconds. */
  durationSeconds?: number;
  /** Optional schedule (ISO 8601 timestamp or cron expression). */
  schedule?: string;

  /* ---- Relay ---- */
  /** The route target (profile name or endpoint). */
  routeTarget?: string;
  /** Retry strategy for the relay hop. */
  retryStrategy?: RetryPolicy;

  /* ---- Loop ---- */
  /** Maximum number of times this loop may re-enter before it is cut off. */
  maxIterations?: number;
  /** The node id the loop returns to (the loop's entry point). */
  loopTargetId?: string;
  /** A guard expression that, when false, exits the loop early. */
  loopCondition?: string;
}

/** A named variable with an optional description and default. */
export interface NodeVariable {
  name: string;
  description?: string;
  defaultValue?: string;
}

/** A retry policy: how many times and with what backoff. */
export interface RetryPolicy {
  /** Maximum retry attempts (0 = no retry). */
  maxAttempts: number;
  /** Backoff strategy. */
  backoff: "none" | "fixed" | "exponential";
  /** Delay between retries in seconds (fixed) or base delay (exponential). */
  delaySeconds: number;
}

/** An escalation rule triggered when an SLA is breached. */
export interface EscalationRule {
  /** When to escalate, in hours after the SLA deadline. */
  afterHours: number;
  /** Who to escalate to. */
  escalateTo: string;
  /** Optional action, e.g. "notify", "reassign", "block". */
  action?: string;
}

/** A single node in a workflow graph. */
export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  /** Display label (task title, agent name, condition name, …). */
  label: string;
  /** Canvas position in pixels. */
  x: number;
  y: number;
  /** OpenHands profile id assigned to this node (agent orchestration). */
  profileId?: string | null;
  /** Agent id assigned to this node. */
  agentId?: string | null;
  /** Model id assigned to this node. */
  modelId?: string | null;
  /** For task nodes: the board task id this node wraps. */
  taskId?: string | null;
  /** Type-specific configuration (see WorkflowNodeConfig). */
  config?: WorkflowNodeConfig;
  /**
   * Number of output ports this node exposes. A node with `outputPorts: 3`
   * renders three distinct output handles (port 0, 1, 2) so the user can wire
   * a 3-way / 4-way / N-way branch directly from the node. Defaults to 1.
   */
  outputPorts?: number;
}

/** A directed edge between two workflow nodes. */
export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  /** Human-readable connection name, e.g. "Research Complete". */
  name?: string;
  /** The execution rule that governs this connection. */
  condition: EdgeCondition;
  /** A custom routing expression, e.g. `status == 'approved'`. */
  expression?: string;
  /** Lower number = higher precedence when multiple edges could fire. */
  priority?: number;
  /** Whether this edge is the designated success path. */
  successPath?: boolean;
  /** Whether this edge is the designated failure path. */
  failurePath?: boolean;
  /**
   * For loop edges (condition === "IF_LOOP"): the maximum number of times this
   * edge may fire before the loop is cut off. Defaults to a safe ceiling when
   * absent. This is the loop-limit that prevents infinite A → B → C → A cycles.
   */
  loopLimit?: number;
  /** Free-form metadata (key → value). */
  metadata?: Record<string, string>;
}

/** A workflow: a directed graph of typed nodes with conditional edges. */
export interface Workflow {
  id: string;
  name: string;
  description: string;
  /** The graph nodes (each carries its own canvas position). */
  nodes: WorkflowNode[];
  /** The directed, condition-labelled edges. */
  edges: WorkflowEdge[];
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
  /** The OpenHands conversation id backing the current execution (for stop). */
  executionId?: string;
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

/**
 * The full AI state: routing/profile/workflow config + the per-task AI overlay.
 * Execution state (runs, tokens, cost, history) is owned exclusively by the
 * OpenHands snapshot — there is no local execution reality here.
 */
export interface AiState {
  config: AiConfig;
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
