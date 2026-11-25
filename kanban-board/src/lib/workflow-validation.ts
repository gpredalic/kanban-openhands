/**
 * workflow-validation.ts — the workflow validation engine.
 *
 * Pure, deterministic analysis of a workflow graph. It detects structural and
 * logical problems so the canvas can highlight them and the Copilot can
 * explain them. No side effects, no I/O — everything is a function of the
 * graph.
 *
 * Issue categories:
 *  - missing_start      no start node at all
 *  - missing_end        no end node at all
 *  - unreachable        a node no path from any start can reach
 *  - dead_end           a non-end node with no outgoing edges
 *  - missing_branch     a condition node whose outgoing edges don't cover
 *                       both the true and false outcomes
 *  - broken_route       an edge whose source or target node no longer exists
 *  - invalid_condition  an edge expression that is syntactically malformed
 *  - orphan             a node with no incoming AND no outgoing edges
 */

import type { Workflow, WorkflowNode } from "../types/ai";

/** A single validation finding. */
export interface WorkflowIssue {
  /** Stable category key (see module doc). */
  code:
    | "missing_start"
    | "missing_end"
    | "unreachable"
    | "dead_end"
    | "missing_branch"
    | "broken_route"
    | "invalid_condition"
    | "orphan";
  /** Severity: error blocks execution, warning is advisory. */
  severity: "error" | "warning";
  /** Human-readable message. */
  message: string;
  /** Node the issue is about (if any). */
  nodeId?: string;
  /** Edge the issue is about (if any). */
  edgeId?: string;
}

/** The full result of validating a workflow. */
export interface WorkflowValidation {
  issues: WorkflowIssue[];
  /** True when there are no error-severity issues. */
  valid: boolean;
  /** Node ids that are unreachable from any start node. */
  unreachableNodeIds: string[];
  /** Node ids that are dead ends (non-end, no outgoing edges). */
  deadEndNodeIds: string[];
  /** Edge ids whose endpoints are missing. */
  brokenEdgeIds: string[];
}

/**
 * Validate a routing expression. Returns an error message when the expression
 * is malformed, or null when it is acceptable.
 *
 * Accepted shapes:
 *  - a comparison:  `amount > 1000`, `status == 'approved'`, `x != null`
 *  - a boolean test: `timeout == true`, `flag`
 *  - a logical combination of the above with `and` / `or` / `not`
 */
export function validateExpression(expression: string | undefined | null): string | null {
  if (expression == null || expression.trim() === "") return null; // no expression = no constraint
  const expr = expression.trim();

  // Balanced parentheses.
  let depth = 0;
  for (const ch of expr) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return "Unbalanced parentheses";
  }
  if (depth !== 0) return "Unbalanced parentheses";

  // Strip string literals so their contents don't confuse the checks.
  const stripped = expr.replace(/'[^']*'|"[^"]*"/g, "''");

  // Every comparison must have an operand on both sides.
  const comparison = stripped.match(/^(.+?)(==|!=|>=|<=|>|<)(.+)$/);
  if (comparison) {
    const left = comparison[1].trim();
    const right = comparison[3].trim();
    if (!left || !right) return `Missing operand around '${comparison[2]}'`;
  }

  // A bare identifier or boolean test is fine; a lone operator is not.
  if (/^(==|!=|>=|<=|>|<|and|or|not)\s*$/.test(stripped)) return "Incomplete expression";

  return null;
}

/**
 * Validate a workflow graph. Returns a structured report the canvas and the
 * Copilot both consume.
 */
export function validateWorkflow(workflow: Workflow): WorkflowValidation {
  const issues: WorkflowIssue[] = [];
  const nodes = workflow.nodes;
  const edges = workflow.edges;
  const nodeIds = new Set(nodes.map((n) => n.id));

  const startNodes = nodes.filter((n) => n.type === "start");
  const endNodes = nodes.filter((n) => n.type === "end");

  // ---- Missing start / end ---------------------------------------------
  if (startNodes.length === 0) {
    issues.push({
      code: "missing_start",
      severity: "error",
      message: "Workflow has no start node. Add a start node so execution knows where to begin.",
    });
  }
  if (endNodes.length === 0) {
    issues.push({
      code: "missing_end",
      severity: "error",
      message: "Workflow has no end node. Add an end node so execution knows where to finish.",
    });
  }

  // ---- Broken routes ----------------------------------------------------
  const brokenEdgeIds: string[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      brokenEdgeIds.push(edge.id);
      issues.push({
        code: "broken_route",
        severity: "error",
        message: `Connection '${edge.name ?? edge.id}' points to a node that no longer exists.`,
        edgeId: edge.id,
      });
    }
  }

  // ---- Reachability from any start node ---------------------------------
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }

  const reachable = new Set<string>();
  const queue = startNodes.map((n) => n.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const next of outgoing.get(current) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }

  const unreachableNodeIds: string[] = [];
  for (const node of nodes) {
    if (node.type === "start") continue; // starts are reachable by definition
    if (!reachable.has(node.id)) {
      unreachableNodeIds.push(node.id);
      issues.push({
        code: "unreachable",
        severity: "error",
        message: `Node '${node.label}' is unreachable — no path from any start node leads to it.`,
        nodeId: node.id,
      });
    }
  }

  // ---- Dead ends --------------------------------------------------------
  const deadEndNodeIds: string[] = [];
  for (const node of nodes) {
    if (node.type === "end") continue;
    const hasOutgoing = (outgoing.get(node.id) ?? []).length > 0;
    if (!hasOutgoing) {
      deadEndNodeIds.push(node.id);
      issues.push({
        code: "dead_end",
        severity: "error",
        message: `Node '${node.label}' has no outgoing path. Execution would stop here.`,
        nodeId: node.id,
      });
    }
  }

  // ---- Missing branches on condition nodes ------------------------------
  for (const node of nodes) {
    if (node.type !== "condition") continue;
    const outEdges = edges.filter((e) => e.from === node.id && nodeIds.has(e.to));
    if (outEdges.length === 0) continue; // already reported as a dead end
    const hasTrue = outEdges.some((e) => e.condition === "IF_TRUE" || e.successPath === true);
    const hasFalse = outEdges.some((e) => e.condition === "IF_FALSE" || e.failurePath === true);
    if (!hasTrue || !hasFalse) {
      issues.push({
        code: "missing_branch",
        severity: "warning",
        message: `Condition '${node.label}' is missing a ${!hasTrue ? "true" : "false"} branch. Add the missing path so every outcome is handled.`,
        nodeId: node.id,
      });
    }
  }

  // ---- Invalid conditions -----------------------------------------------
  for (const edge of edges) {
    const problem = validateExpression(edge.expression);
    if (problem) {
      issues.push({
        code: "invalid_condition",
        severity: "error",
        message: `Connection '${edge.name ?? edge.id}' has an invalid condition: ${problem}`,
        edgeId: edge.id,
      });
    }
  }

  // ---- Orphans ----------------------------------------------------------
  const incoming = new Set(edges.filter((e) => nodeIds.has(e.to)).map((e) => e.to));
  for (const node of nodes) {
    const hasIncoming = incoming.has(node.id);
    const hasOutgoing = (outgoing.get(node.id) ?? []).length > 0;
    if (!hasIncoming && !hasOutgoing && node.type !== "start" && node.type !== "end") {
      issues.push({
        code: "orphan",
        severity: "warning",
        message: `Node '${node.label}' is disconnected from the rest of the workflow.`,
        nodeId: node.id,
      });
    }
  }

  const valid = !issues.some((issue) => issue.severity === "error");
  return {
    issues,
    valid,
    unreachableNodeIds,
    deadEndNodeIds,
    brokenEdgeIds,
  };
}

/**
 * Summarize a validation report into a short human-readable status line for
 * the toolbar.
 */
export function validationSummary(validation: WorkflowValidation): string {
  if (validation.valid && validation.issues.length === 0) return "Workflow is valid";
  const errors = validation.issues.filter((i) => i.severity === "error").length;
  const warnings = validation.issues.filter((i) => i.severity === "warning").length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(", ");
}

/** Convenience: the set of node ids that have at least one issue. */
export function issueNodeIds(validation: WorkflowValidation): Set<string> {
  return new Set(validation.issues.filter((i) => i.nodeId).map((i) => i.nodeId!));
}

/** Convenience: the set of edge ids that have at least one issue. */
export function issueEdgeIds(validation: WorkflowValidation): Set<string> {
  return new Set(validation.issues.filter((i) => i.edgeId).map((i) => i.edgeId!));
}

/**
 * Suggest the next node type to add after a given node, based on the node's
 * type and what already follows it. Used by the Copilot's "suggest next node"
 * feature.
 */
export function suggestNextNode(
  node: WorkflowNode,
  existingTargets: string[],
): { type: WorkflowNode["type"]; label: string; reason: string } | null {
  const hasTargets = existingTargets.length > 0;
  switch (node.type) {
    case "start":
      return hasTargets
        ? null
        : { type: "task", label: "First Task", reason: "A start node should lead into the first unit of work." };
    case "task":
      return hasTargets
        ? null
        : { type: "condition", label: "Check Result", reason: "After a task, branch on its outcome to route success and failure." };
    case "agent":
      return hasTargets
        ? null
        : { type: "condition", label: "Evaluate Output", reason: "After an agent, branch on its output to decide the next step." };
    case "condition":
      return hasTargets
        ? null
        : { type: "task", label: "Branch Action", reason: "A condition needs at least one outgoing branch to act on." };
    case "approval":
      return hasTargets
        ? null
        : { type: "task", label: "Proceed", reason: "After approval, continue with the next unit of work." };
    case "delay":
      return hasTargets
        ? null
        : { type: "task", label: "Resume Work", reason: "After a delay, resume with the next unit of work." };
    case "relay":
      return hasTargets
        ? null
        : { type: "end", label: "Finish", reason: "A relay hop typically ends the hand-off chain." };
    case "end":
      return null;
    default:
      return null;
  }
}
