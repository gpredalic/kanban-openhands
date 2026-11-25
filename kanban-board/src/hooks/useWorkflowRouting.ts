/**
 * useWorkflowRouting — shared, engine-driven routing for a workflow graph.
 *
 * This is the single source of truth for "what is executing / what is next".
 * It maps the graph (nodes + edges) and the OpenHands execution snapshot onto
 * the pure workflow engine, so the same routing that the builder canvas uses to
 * highlight live nodes/edges is exactly what the Monitoring view displays.
 *
 * Execution is driven directly by nodes, connections, and routing rules — there
 * is no orchestration layer, no relay chain, no hidden execution state.
 */

import { useMemo } from "react";
import type { WorkflowNode, WorkflowEdge } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";
import {
  computeRouting,
  loopEdgeIds,
  type NodeStateInput,
  type NodeExecState as EngineNodeExecState,
  type RoutingResult,
} from "../lib/workflow-engine";

/** The execution state of a node, derived from the OpenHands snapshot. */
export type NodeExecState = "idle" | "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

/**
 * Read the execution state of a single node from the OpenHands snapshot. A node
 * without a linked task is idle; a node whose task has no reported execution is
 * idle.
 */
export function nodeExecState(node: WorkflowNode, openHandsState: OpenHandsState): NodeExecState {
  if (!node.taskId) return "idle";
  const exec = openHandsState.snapshot.executions.find((e) => e.taskId === node.taskId);
  if (!exec) return "idle";
  return exec.status;
}

/**
 * Map a node to the engine's NodeStateInput. The engine routes on this; the
 * OpenHands snapshot supplies the raw execution status, and the node's config
 * supplies the retry/approval context the branch types need.
 */
export function nodeStateInput(node: WorkflowNode, openHandsState: OpenHandsState): NodeStateInput {
  const state = nodeExecState(node, openHandsState);
  // The engine's state set has no "pending"; treat it as queued.
  const engineState: EngineNodeExecState = state === "pending" ? "queued" : state;
  const input: NodeStateInput = { state: engineState };
  if (node.config?.retryPolicy) {
    input.retriesExhausted = state === "failed" && (node.config.retryPolicy.maxAttempts ?? 0) > 0;
  }
  if (node.type === "approval") {
    input.approved = state === "completed";
  }
  return input;
}

export interface WorkflowRouting {
  /** The engine's routing decision (current node, next node, path, …). */
  routing: RoutingResult;
  /** The node currently executing (running or queued). */
  currentNode: WorkflowNode | null;
  /** The node the workflow will execute next. */
  nextNode: WorkflowNode | null;
  /** The ordered execution path from the start node to the current node. */
  path: WorkflowNode[];
  /** Edges that would fire from the current node (multi-way fan-out included). */
  activeEdges: Set<string>;
  /** Nodes the engine considers live: the current node and the next node. */
  activeNodes: Set<string>;
  /** Loop edges present in the graph (for dashed rendering + limit badges). */
  loopEdgeSet: Set<string>;
  /** How many times each loop edge has fired, from real execution history. */
  loopCounts: Record<string, number>;
}

/**
 * Compute the live routing of a workflow graph from its nodes, edges, and the
 * OpenHands execution snapshot. Memoized on the inputs so the builder canvas
 * and the Monitoring view stay in sync without recomputing on unrelated renders.
 */
export function useWorkflowRouting(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  openHandsState: OpenHandsState,
): WorkflowRouting {
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const executions = openHandsState.snapshot.executions;

  // Per-node execution state, keyed by node id.
  const nodeStates = useMemo(() => {
    const map: Record<string, NodeStateInput> = {};
    for (const node of nodes) map[node.id] = nodeStateInput(node, openHandsState);
    return map;
  }, [nodes, openHandsState]);

  // Loops present in the graph (for the loop-limit badge + dashed rendering).
  const loopEdgeSet = useMemo(() => new Set(loopEdgeIds(nodes, edges)), [nodes, edges]);

  // How many times each loop edge has fired, derived from the real OpenHands
  // execution history: a loop edge fires when its source node completes, so the
  // count is the number of completed executions of that node's task. The engine
  // reads this to enforce loop limits (a loop edge that has fired loopLimit
  // times stops firing). This is the loop-limit proof — driven by real events,
  // not a local counter.
  const loopCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const edge of edges) {
      if (edge.condition !== "IF_LOOP") continue;
      const from = nodeById.get(edge.from);
      if (!from?.taskId) continue;
      counts[edge.id] = executions.filter((run) => run.taskId === from.taskId && run.status === "completed").length;
    }
    return counts;
  }, [edges, nodeById, executions]);

  const routing = useMemo(
    () => computeRouting({ nodes, edges, states: nodeStates, loopCounts }),
    [nodes, edges, nodeStates, loopCounts],
  );

  const activeEdges = useMemo(() => new Set(routing.firingEdges.map((e) => e.id)), [routing]);
  const activeNodes = useMemo(() => {
    const ids = new Set<string>();
    if (routing.currentNode) ids.add(routing.currentNode.id);
    if (routing.nextNode) ids.add(routing.nextNode.id);
    return ids;
  }, [routing]);

  return {
    routing,
    currentNode: routing.currentNode,
    nextNode: routing.nextNode,
    path: routing.path,
    activeEdges,
    activeNodes,
    loopEdgeSet,
    loopCounts,
  };
}
