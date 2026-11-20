/**
 * ai-engine.ts — pure orchestration logic.
 *
 * No React, no DOM, no timers. Everything here is a pure function so it can be
 * unit-tested in isolation and reused by the execution loop. It implements:
 *   - Routing resolution (n8n-style rule evaluation).
 *   - Cost estimation (OpenRouter-style token pricing).
 *   - Dependency graph analysis (cycle detection, ready-task computation).
 *   - Workflow DAG layout (LangGraph-style layered positioning).
 */

import type {
  AiConfig,
  Agent,
  EnrichedTask,
  LLMModel,
  RoutingResolution,
  RoutingRule,
  Workflow,
} from "../types/ai";

/* ------------------------------------------------------------------ *
 * Routing resolution.
 * ------------------------------------------------------------------ */

/** Does a routing condition match a task? */
export function conditionMatches(condition: RoutingRule["condition"], task: EnrichedTask): boolean {
  switch (condition.type) {
    case "always":
      return true;
    case "tag":
      return (task.tags ?? []).includes(condition.tag);
    case "priority":
      return (task.priority ?? "medium") === condition.priority;
    case "status":
      return task.status === condition.status;
    default:
      return false;
  }
}

/**
 * Resolve which agent/model should run a task.
 *
 * Explicit assignment (task.ai.agentId / modelId) always wins. Otherwise the
 * routing rules are evaluated in ascending priority order and the first match
 * is used. If no rule matches, the task is unrouted (agentId/modelId null).
 */
export function resolveRouting(task: EnrichedTask, config: AiConfig): RoutingResolution {
  if (task.ai.agentId || task.ai.modelId) {
    return { agentId: task.ai.agentId ?? null, modelId: task.ai.modelId ?? null, rule: null };
  }
  const rules = [...config.routingRules].sort((a, b) => a.priority - b.priority);
  for (const rule of rules) {
    if (conditionMatches(rule.condition, task)) {
      return {
        agentId: rule.target.agentId ?? null,
        modelId: rule.target.modelId ?? null,
        rule,
      };
    }
  }
  return { agentId: null, modelId: null, rule: null };
}

/** Look up an agent by id, or null. */
export function getAgent(config: AiConfig, agentId: string | null | undefined): Agent | null {
  if (!agentId) return null;
  return config.agents.find((a) => a.id === agentId) ?? null;
}

/** Look up a model by id, or null. */
export function getModel(config: AiConfig, modelId: string | null | undefined): LLMModel | null {
  if (!modelId) return null;
  return config.models.find((m) => m.id === modelId) ?? null;
}

/**
 * Resolve the effective model for a task: explicit model > agent's model >
 * null. Returns the model and the agent that would run it.
 */
export function resolveExecution(
  task: EnrichedTask,
  config: AiConfig,
): { agent: Agent | null; model: LLMModel | null } {
  const routing = resolveRouting(task, config);
  const agent = getAgent(config, routing.agentId);
  const model = getModel(config, routing.modelId) ?? (agent ? getModel(config, agent.modelId) : null);
  return { agent, model };
}

/* ------------------------------------------------------------------ *
 * Cost estimation.
 * ------------------------------------------------------------------ */


/** Format a USD cost for display. */
export function formatCost(cost: number): string {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

/** Format a token count with thousands separators. */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/* ------------------------------------------------------------------ *
 * Dependency graph.
 * ------------------------------------------------------------------ */

/**
 * Detect a cycle in a dependency graph. Returns the ids involved in the cycle,
 * or an empty array if the graph is acyclic. Uses iterative DFS with a
 * three-color marking scheme.
 */
export function detectCycle(deps: Record<string, string[]>): string[] {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color: Record<string, number> = {};
  const stack: string[] = [];
  for (const id of Object.keys(deps)) color[id] = WHITE;

  const visit = (node: string): string[] | null => {
    color[node] = GRAY;
    stack.push(node);
    for (const dep of deps[node] ?? []) {
      if (!(dep in color)) continue; // dep not in the graph — ignore
      if (color[dep] === GRAY) {
        // Found a back edge: the cycle is from `dep` to the top of the stack.
        const idx = stack.indexOf(dep);
        return stack.slice(idx);
      }
      if (color[dep] === WHITE) {
        const cycle = visit(dep);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    color[node] = BLACK;
    return null;
  };

  for (const id of Object.keys(deps)) {
    if (color[id] === WHITE) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return [];
}

/**
 * Build the dependency map from a list of tasks. Each task's `ai.dependsOn`
 * lists the task ids it depends on. Returns `taskId -> [dependency ids]`.
 */
export function buildDependencyMap(tasks: EnrichedTask[]): Record<string, string[]> {
  const deps: Record<string, string[]> = {};
  for (const task of tasks) {
    deps[task.id] = (task.ai.dependsOn ?? []).filter((id) => tasks.some((t) => t.id === id));
  }
  return deps;
}

/**
 * Compute the set of tasks that are "ready" to run: their dependencies are all
 * done. A task with no dependencies is always ready.
 */
export function readyTaskIds(tasks: EnrichedTask[]): Set<string> {
  const done = new Set(tasks.filter((t) => t.status === "done").map((t) => t.id));
  const ready = new Set<string>();
  for (const task of tasks) {
    const deps = task.ai.dependsOn ?? [];
    if (deps.every((id) => done.has(id))) ready.add(task.id);
  }
  return ready;
}

/**
 * Compute the "depth" of each task in the dependency graph (longest path from
 * a root). Used for topological ordering and workflow layout. Tasks with no
 * dependencies have depth 0.
 */
export function computeDepths(deps: Record<string, string[]>): Record<string, number> {
  const depth: Record<string, number> = {};
  const visiting: Record<string, boolean> = {};

  const visit = (node: string): number => {
    if (depth[node] !== undefined) return depth[node];
    if (visiting[node]) return 0; // cycle guard — treat as depth 0
    visiting[node] = true;
    let max = 0;
    for (const dep of deps[node] ?? []) {
      if (dep in deps) max = Math.max(max, visit(dep) + 1);
    }
    visiting[node] = false;
    depth[node] = max;
    return max;
  };

  for (const id of Object.keys(deps)) visit(id);
  return depth;
}

/* ------------------------------------------------------------------ *
 * Workflow DAG layout.
 * ------------------------------------------------------------------ */

/** A positioned node in a workflow DAG. */
export interface DagNode {
  id: string;
  /** Column (depth) in the layered layout. */
  layer: number;
  /** Row within the layer. */
  row: number;
}

/**
 * Lay out a workflow's nodes into a layered DAG (LangGraph-style).
 *
 * Nodes are assigned to layers by their dependency depth. Within a layer,
 * nodes are ordered by their input order. Returns the positioned nodes and
 * the total number of layers.
 */
export function layoutWorkflow(workflow: Workflow, tasks: EnrichedTask[]): { nodes: DagNode[]; layers: number } {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  // Build the dependency map restricted to the workflow's nodes.
  const deps: Record<string, string[]> = {};
  for (const id of workflow.nodeIds) {
    const task = taskById.get(id);
    deps[id] = (task?.ai.dependsOn ?? []).filter((d) => workflow.nodeIds.includes(d));
  }
  const depth = computeDepths(deps);
  const maxLayer = workflow.nodeIds.reduce((m, id) => Math.max(m, depth[id] ?? 0), 0);

  // Group nodes by layer, preserving input order.
  const byLayer: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) byLayer.push([]);
  for (const id of workflow.nodeIds) {
    byLayer[depth[id] ?? 0].push(id);
  }

  const nodes: DagNode[] = [];
  for (let layer = 0; layer <= maxLayer; layer++) {
    byLayer[layer].forEach((id, row) => {
      nodes.push({ id, layer, row });
    });
  }
  return { nodes, layers: maxLayer + 1 };
}

