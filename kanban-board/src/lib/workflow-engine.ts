/**
 * workflow-engine.ts — the pure execution engine for the workflow graph.
 *
 * This is the heart of the workflow redesign. Execution is driven *directly*
 * by the graph: nodes, connections (edges), and routing rules. There is no
 * separate orchestration layer, no relay chain, no hidden execution state.
 *
 * The engine is a set of pure functions that map
 *
 *     (graph, per-node execution state)  →  routing decision
 *
 * so the same graph that the user draws on the canvas is exactly what runs.
 * The UI renders the graph; the engine decides what fires next; OpenHands
 * supplies the per-node execution state. Nothing else is in between.
 *
 * Pure and dependency-free: no React, no host, no I/O. Fully unit-testable.
 */

import type { WorkflowNode, WorkflowEdge } from "../types/ai";

/* ------------------------------------------------------------------ *
 * Node execution state.
 * ------------------------------------------------------------------ */

/** The terminal or in-flight state a node can be in. */
export type NodeExecState =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "awaiting_approval";

/** The execution state of a single node, as supplied by the caller. */
export interface NodeStateInput {
  state: NodeExecState;
  /** Output variables the node produced (for conditional expressions). */
  outputs?: Record<string, string | number | boolean>;
  /** True when the node's retry budget is spent (drives IF_RETRY_EXHAUSTED). */
  retriesExhausted?: boolean;
  /** The approval decision, when the node is an approval gate. */
  approved?: boolean;
  /**
   * Monotonic completion sequence (higher = more recent). When several nodes
   * are in a terminal state at once, the engine routes from the most recently
   * completed one. Optional: when absent, the engine falls back to the terminal
   * node furthest along the execution path.
   */
  completedAt?: number;
}

/** True when the state is a terminal one that can fire outgoing edges. */
function isTerminalState(state: NodeExecState): boolean {
  return (
    state === "completed" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "timed_out" ||
    state === "awaiting_approval"
  );
}

/* ------------------------------------------------------------------ *
 * Edge evaluation.
 * ------------------------------------------------------------------ */

/**
 * Decide whether an edge fires given its source node's execution state.
 *
 * This is the single routing rule. Every branch type reduces to a check on the
 * source node's terminal state:
 *
 *   IF_SUCCESS          → node completed
 *   IF_FAILURE          → node failed
 *   IF_TIMEOUT          → node timed out
 *   IF_CANCEL           → node cancelled
 *   IF_RETRY_EXHAUSTED  → node failed and its retry budget is spent
 *   IF_MANUAL_APPROVAL  → node is waiting on a human
 *   IF_APPROVED         → node completed with an approval
 *   IF_REJECTED         → node failed with a rejection
 *   IF_TRUE / IF_FALSE  → the edge's expression evaluated against outputs
 *   IF_LOOP             → node completed (re-enter upstream, bounded by limit)
 *   IF_ALWAYS           → always
 */
export function evaluateEdge(edge: WorkflowEdge, source: NodeStateInput): boolean {
  switch (edge.condition) {
    case "IF_SUCCESS":
      return source.state === "completed";
    case "IF_FAILURE":
      return source.state === "failed";
    case "IF_TIMEOUT":
      return source.state === "timed_out";
    case "IF_CANCEL":
      return source.state === "cancelled";
    case "IF_RETRY_EXHAUSTED":
      return source.state === "failed" && source.retriesExhausted === true;
    case "IF_MANUAL_APPROVAL":
      return source.state === "awaiting_approval";
    case "IF_APPROVED":
      return source.state === "completed" && source.approved === true;
    case "IF_REJECTED":
      return source.state === "failed" && source.approved === false;
    case "IF_TRUE":
      return evaluateExpression(edge.expression, source.outputs ?? {}) === true;
    case "IF_FALSE":
      return evaluateExpression(edge.expression, source.outputs ?? {}) === false;
    case "IF_LOOP":
      // A loop edge fires when the source completes; the loop limit is enforced
      // by the caller (computeRouting) via loopCounts, not here.
      return source.state === "completed";
    case "IF_ALWAYS":
      return true;
    default:
      return false;
  }
}

/**
 * Evaluate a simple routing expression against a set of output variables.
 *
 * Supports the small expression grammar the editor lets users write:
 *   - comparisons:  `amount > 1000`, `status == 'approved'`, `count >= 3`
 *   - boolean vars: `approved`, `!approved`
 *   - logical:      `a && b`, `a || b`
 *
 * Returns true / false, or null when the expression is absent or malformed.
 * Kept deliberately small and safe — no eval, no function construction.
 */
export function evaluateExpression(
  expression: string | undefined,
  outputs: Record<string, string | number | boolean>,
): boolean | null {
  if (!expression || !expression.trim()) return null;
  const expr = expression.trim();

  // Split on logical operators (lowest precedence first).
  const orParts = splitTopLevel(expr, "||");
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateExpression(part, outputs) === true);
  }
  const andParts = splitTopLevel(expr, "&&");
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateExpression(part, outputs) === true);
  }

  // A single comparison or bare variable.
  const comparison = expr.match(/^(.+?)(==|!=|>=|<=|>|<)(.+)$/);
  if (comparison) {
    const left = resolveValue(comparison[1].trim(), outputs);
    const right = resolveValue(comparison[3].trim(), outputs);
    if (left === null || right === null) return null;
    switch (comparison[2]) {
      case "==": return looseEquals(left, right);
      case "!=": return !looseEquals(left, right);
      case ">": return Number(left) > Number(right);
      case "<": return Number(left) < Number(right);
      case ">=": return Number(left) >= Number(right);
      case "<=": return Number(left) <= Number(right);
    }
  }

  // Bare variable (possibly negated).
  if (expr.startsWith("!")) {
    const value = resolveValue(expr.slice(1).trim(), outputs);
    if (value === null) return null;
    return !truthy(value);
  }
  const value = resolveValue(expr, outputs);
  return value === null ? null : truthy(value);
}

/** Split on a top-level operator, ignoring occurrences inside quotes/parens. */
function splitTopLevel(expr: string, op: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote: string | null = null;
  let current = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (inQuote) {
      current += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (depth === 0 && expr.slice(i, i + op.length) === op) {
      parts.push(current);
      current = "";
      i += op.length - 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Resolve a token to a value: a quoted string, a number, a bool, or a var. */
function resolveValue(
  token: string,
  outputs: Record<string, string | number | boolean>,
): string | number | boolean | null {
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return token.slice(1, -1);
  }
  if (token === "true") return true;
  if (token === "false") return false;
  if (token === "null" || token === "undefined") return null;
  if (!Number.isNaN(Number(token)) && token.trim() !== "") return Number(token);
  if (token in outputs) return outputs[token];
  return null;
}

function looseEquals(a: string | number | boolean, b: string | number | boolean): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  return String(a) === String(b);
}

function truthy(value: string | number | boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return value.length > 0 && value !== "false" && value !== "0";
}

/* ------------------------------------------------------------------ *
 * Routing.
 * ------------------------------------------------------------------ */

/** The input to the routing computation. */
export interface RoutingInput {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Per-node execution state, keyed by node id. */
  states: Record<string, NodeStateInput>;
  /** How many times each loop edge has fired, keyed by edge id. */
  loopCounts?: Record<string, number>;
}

/** The routing decision the engine produces. */
export interface RoutingResult {
  /** The node currently executing (running or queued). */
  currentNode: WorkflowNode | null;
  /** The edge that will fire next from the current node. */
  nextEdge: WorkflowEdge | null;
  /** The node the workflow will execute next. */
  nextNode: WorkflowNode | null;
  /** Every edge that would fire from the current node (multi-way fan-out). */
  firingEdges: WorkflowEdge[];
  /** The ordered execution path from the start node to the current node. */
  path: WorkflowNode[];
  /** Loop edges that have reached their limit and will no longer fire. */
  exhaustedLoops: WorkflowEdge[];
  /** True when the workflow has reached a terminal state (no next node). */
  terminal: boolean;
}

/**
 * Compute the live routing state of a workflow from its graph and the
 * per-node execution states.
 *
 * This is the architecture proof: given only the graph (nodes + edges) and the
 * execution state, the engine determines what is running now, what fires next,
 * and the path taken so far. No orchestration layer is involved.
 */
export function computeRouting(input: RoutingInput): RoutingResult {
  const { nodes, edges, states, loopCounts = {} } = input;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const stateOf = (id: string): NodeStateInput => states[id] ?? { state: "idle" };

  // The node that drives routing. A node in flight (running, then queued) is
  // the obvious choice. But a node that has just reached a terminal state
  // (completed / failed / cancelled / timed_out / awaiting_approval) must also
  // be able to fire its outgoing edges — otherwise a completed node's success
  // edge never selects its next node. When several nodes are terminal at once,
  // route from the most recently completed one (by completedAt, falling back to
  // the terminal node furthest along the execution path).
  const running = nodes.find((n) => stateOf(n.id).state === "running");
  const queued = nodes.find((n) => stateOf(n.id).state === "queued");
  const inFlight = running ?? queued;
  const terminalNode = inFlight
    ? null
    : nodes
        .filter((n) => isTerminalState(stateOf(n.id).state))
        .sort((a, b) => {
          const ca = stateOf(a.id).completedAt;
          const cb = stateOf(b.id).completedAt;
          if (ca !== undefined && cb !== undefined) return cb - ca;
          // No timestamps: the node furthest along the path is the most recent.
          const pa = tracePath(nodes, edges, a.id).length;
          const pb = tracePath(nodes, edges, b.id).length;
          return pb - pa;
        })[0] ?? null;
  const currentNode = inFlight ?? terminalNode;

  // Outgoing edges from the current node, sorted by priority (lower first).
  const outgoing = currentNode
    ? edges
        .filter((e) => e.from === currentNode.id && nodeById.has(e.to))
        .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    : [];

  // Which of those edges fire, given the current node's state?
  const firingEdges = currentNode
    ? outgoing.filter((e) => evaluateEdge(e, stateOf(currentNode.id)))
    : [];

  // Enforce loop limits: a loop edge that has fired loopLimit times stops.
  const exhaustedLoops: WorkflowEdge[] = [];
  const liveFiringEdges = firingEdges.filter((e) => {
    if (e.condition === "IF_LOOP") {
      const limit = e.loopLimit ?? 10;
      if ((loopCounts[e.id] ?? 0) >= limit) {
        exhaustedLoops.push(e);
        return false;
      }
    }
    return true;
  });

  // The next edge is the highest-priority live firing edge.
  const nextEdge = liveFiringEdges[0] ?? null;
  const nextNode = nextEdge ? nodeById.get(nextEdge.to) ?? null : null;

  // The execution path from the start node to the current node.
  const path = currentNode ? tracePath(nodes, edges, currentNode.id) : [];

  // Terminal when nothing is in flight and no edge can fire. A node that is
  // running or queued is in flight (not terminal) even if no edge fires yet —
  // it is still executing. A terminal-state node with no live firing edge is
  // done. An empty graph is terminal.
  const inFlightNow = currentNode != null && (stateOf(currentNode.id).state === "running" || stateOf(currentNode.id).state === "queued");
  const terminal = inFlightNow ? false : liveFiringEdges.length === 0;

  return {
    currentNode,
    nextEdge,
    nextNode,
    firingEdges: liveFiringEdges,
    path,
    exhaustedLoops,
    terminal,
  };
}

/**
 * Trace the execution path from the start node to `targetId` by following
 * edges. Returns the ordered list of nodes (start … target).
 */
export function tracePath(nodes: WorkflowNode[], edges: WorkflowEdge[], targetId: string): WorkflowNode[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) continue;
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }

  const startNode =
    nodes.find((n) => n.type === "start") ??
    nodes.find((n) => !edges.some((e) => e.to === n.id)) ??
    nodes[0] ?? null;
  if (!startNode) return [];

  // BFS from the start, recording parents, then walk back from the target.
  const visited = new Set<string>([startNode.id]);
  const parent = new Map<string, string>();
  const queue: string[] = [startNode.id];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of adjacency.get(id) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        parent.set(next, id);
        queue.push(next);
      }
    }
  }

  // The target must actually be reachable from the start; otherwise there is no
  // path (an isolated node is not part of the execution path).
  if (!visited.has(targetId)) return [];

  const path: WorkflowNode[] = [];
  let cursor: string | undefined = targetId;
  while (cursor) {
    const node = nodeById.get(cursor);
    if (!node) break;
    path.unshift(node);
    if (cursor === startNode.id) break;
    cursor = parent.get(cursor);
  }
  return path;
}

/* ------------------------------------------------------------------ *
 * Loop detection.
 * ------------------------------------------------------------------ */

/**
 * Detect all cycles in the workflow graph. Each cycle is returned as an ordered
 * list of node ids (the path that returns to its start). Used for loop
 * visualization: the UI highlights loop edges and shows iteration counts.
 *
 * Returns an empty array when the graph is a DAG (no loops).
 */
export function detectLoops(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[][] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }

  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const visited = new Set<string>();

  const dfs = (start: string, current: string, path: string[], onPath: Set<string>) => {
    for (const next of adjacency.get(current) ?? []) {
      if (next === start && path.length > 1) {
        // Found a cycle back to the start.
        const key = path.slice().sort().join("|");
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push([...path]);
        }
        continue;
      }
      if (onPath.has(next) || visited.has(next)) continue;
      onPath.add(next);
      path.push(next);
      dfs(start, next, path, onPath);
      path.pop();
      onPath.delete(next);
    }
  };

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    dfs(node.id, node.id, [node.id], new Set([node.id]));
    visited.add(node.id);
  }
  return cycles;
}

/**
 * The set of edge ids that participate in at least one loop. Used to style loop
 * edges distinctly (dashed, accent color) and to render loop arrows.
 */
export function loopEdgeIds(nodes: WorkflowNode[], edges: WorkflowEdge[]): Set<string> {
  const cycles = detectLoops(nodes, edges);
  const ids = new Set<string>();
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const cycle of cycles) {
    // Only the closing edge — the one that routes back from the last node of the
    // cycle to its first — is the loop arrow. The forward edges of the cycle are
    // ordinary edges and must not be styled as loops.
    const from = cycle[cycle.length - 1];
    const to = cycle[0];
    const edge = edges.find((e) => e.from === from && e.to === to && nodeIds.has(e.from) && nodeIds.has(e.to));
    if (edge) ids.add(edge.id);
  }
  return ids;
}

/* ------------------------------------------------------------------ *
 * Smart geometry.
 * ------------------------------------------------------------------ */

/** The geometry of a single edge, ready to render as an SVG path. */
export interface EdgeGeometry {
  /** The SVG path `d` attribute. */
  d: string;
  /** The arrowhead tip position. */
  arrow: { x: number; y: number };
  /** The arrowhead direction angle in radians. */
  arrowAngle: number;
  /** The midpoint of the path (for labels). */
  mid: { x: number; y: number };
  /** Whether this edge routes "backwards" (a loop arrow). */
  isLoop: boolean;
}

/** Node box dimensions, shared with the canvas renderer. */
export const NODE_W = 180;
export const NODE_H = 64;

/**
 * Compute the SVG path for an edge between two nodes, with smart geometry:
 *
 *  - Forward edges (target to the right) curve gently left-to-right.
 *  - Backward edges (target to the left, i.e. loops) route around the outside
 *    with a distinctive loop arrow.
 *  - Same-column edges (target directly below/above) route with a side bow.
 *  - The arrowhead is oriented along the path's end tangent.
 *
 * `portIndex` and `portCount` let a multi-way node fan its outputs out from
 * distinct ports along the node's right edge.
 */
export function edgeGeometry(
  from: WorkflowNode,
  to: WorkflowNode,
  portIndex = 0,
  portCount = 1,
): EdgeGeometry {
  // Source anchor: right edge of the source node, offset by the port index.
  const portOffset = portCount > 1 ? (portIndex / (portCount - 1) - 0.5) * (NODE_H - 24) : 0;
  const sx = from.x + NODE_W;
  const sy = from.y + NODE_H / 2 + portOffset;

  // Target anchor: left edge of the target node.
  const tx = to.x;
  const ty = to.y + NODE_H / 2;

  const dx = tx - sx;
  const dy = ty - sy;

  // Classify by node-center positions, not anchor positions. The anchor dx
  // already includes the source node's width, so a same-column edge (target
  // directly below) has anchor dx === -NODE_W and would be misread as a loop.
  const centerDx = to.x - from.x;
  const centerDy = to.y - from.y;

  // Decide the routing direction.
  const isLoop = centerDx < -NODE_W / 2; // target clearly to the left → loop arrow
  const isVertical = Math.abs(centerDx) < NODE_W / 2 && Math.abs(centerDy) > NODE_H; // same column

  let d: string;
  let arrow: { x: number; y: number };
  let arrowAngle: number;
  let mid: { x: number; y: number };

  if (isLoop) {
    // Route the loop arrow around the outside (below both nodes).
    const loopY = Math.max(from.y, to.y) + NODE_H + 48;
    const c1x = sx + 60;
    const c1y = loopY;
    const c2x = tx - 60;
    const c2y = loopY;
    d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
    arrow = { x: tx, y: ty };
    // The path approaches the target from below-right; point the arrow up-left.
    arrowAngle = Math.atan2(ty - c2y, tx - c2x);
    mid = { x: (sx + tx) / 2, y: loopY - 12 };
  } else if (isVertical) {
    // Same column: bow out to the side.
    const bowX = sx + (dy > 0 ? 90 : -90);
    const c1y = sy + dy * 0.4;
    const c2y = ty - dy * 0.4;
    d = `M ${sx} ${sy} C ${bowX} ${c1y}, ${bowX} ${c2y}, ${tx} ${ty}`;
    arrow = { x: tx, y: ty };
    arrowAngle = Math.atan2(ty - c2y, tx - bowX);
    mid = { x: (sx + tx) / 2 + (dy > 0 ? 40 : -40), y: (sy + ty) / 2 };
  } else {
    // Forward edge: gentle cubic bezier.
    const c1x = sx + Math.max(40, dx * 0.5);
    const c1y = sy;
    const c2x = tx - Math.max(40, dx * 0.5);
    const c2y = ty;
    d = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
    arrow = { x: tx, y: ty };
    arrowAngle = Math.atan2(ty - c2y, tx - c2x);
    mid = { x: (sx + tx) / 2, y: (sy + ty) / 2 };
  }

  return { d, arrow, arrowAngle, mid, isLoop };
}

/**
 * Render an arrowhead as an SVG path centered at (x, y) and oriented by angle.
 * Returns the `d` attribute for a small triangle.
 */
export function arrowheadPath(x: number, y: number, angle: number, size = 9): string {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Triangle points: tip at (x,y), base perpendicular.
  const tipX = x;
  const tipY = y;
  const backX = x - size * cos;
  const backY = y - size * sin;
  const perpX = -sin;
  const perpY = cos;
  const half = size * 0.5;
  const p1x = backX + perpX * half;
  const p1y = backY + perpY * half;
  const p2x = backX - perpX * half;
  const p2y = backY - perpY * half;
  return `M ${tipX} ${tipY} L ${p1x} ${p1y} L ${p2x} ${p2y} Z`;
}
