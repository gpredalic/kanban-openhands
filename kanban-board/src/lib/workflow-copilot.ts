/**
 * workflow-copilot.ts — the embedded workflow intelligence assistant.
 *
 * A deterministic, dependency-free Copilot. It analyzes the graph, explains
 * behavior, suggests next nodes, generates routing conditions, and builds
 * whole workflows from natural language. Everything is a pure function of the
 * workflow plus the user's request, so it is fully testable and needs no
 * network or LLM.
 *
 * The natural-language generator recognizes a small set of well-known workflow
 * shapes (incident escalation, approval gates, success/failure/timeout
 * branching, …) and emits a ready-to-render graph. Unknown requests fall back
 * to a sensible linear skeleton.
 */

import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  EdgeCondition,
} from "../types/ai";
import {
  validateWorkflow,
  suggestNextNode,
  type WorkflowValidation,
} from "./workflow-validation";

/** A single Copilot message. */
export interface CopilotMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** A workflow the assistant proposes (rendered as a preview). */
  proposedWorkflow?: Workflow;
  /** A node the assistant proposes to insert. */
  proposedNode?: WorkflowNode;
  /** An edge the assistant proposes to add. */
  proposedEdge?: WorkflowEdge;
}

/** The result of analyzing a workflow for the Copilot panel. */
export interface CopilotAnalysis {
  validation: WorkflowValidation;
  /** Plain-language explanation of what the workflow does. */
  explanation: string;
  /** Suggested next node for the currently selected node (if any). */
  suggestion: { type: WorkflowNodeType; label: string; reason: string } | null;
  /** Routing conditions the assistant would generate for a condition node. */
  generatedConditions: { label: string; expression: string; condition: EdgeCondition }[];
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Analyze a workflow and produce the Copilot's full report: validation, a
 * plain-language explanation, a next-node suggestion, and generated routing
 * conditions for the selected condition node.
 */
export function analyzeWorkflow(
  workflow: Workflow,
  selectedNodeId?: string | null,
): CopilotAnalysis {
  const validation = validateWorkflow(workflow);
  const explanation = explainWorkflow(workflow);

  let suggestion: CopilotAnalysis["suggestion"] = null;
  if (selectedNodeId) {
    const node = workflow.nodes.find((n) => n.id === selectedNodeId);
    if (node) {
      const targets = workflow.edges
        .filter((e) => e.from === node.id)
        .map((e) => e.to);
      suggestion = suggestNextNode(node, targets);
    }
  }

  const generatedConditions = generateRoutingConditions(workflow, selectedNodeId);

  return { validation, explanation, suggestion, generatedConditions };
}

/**
 * Produce a plain-language explanation of what a workflow does, walking the
 * graph from its start node(s).
 */
export function explainWorkflow(workflow: Workflow): string {
  const nodes = workflow.nodes;
  if (nodes.length === 0) return "This workflow is empty. Add a start node to begin.";

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const edge of workflow.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }

  const starts = nodes.filter((n) => n.type === "start");
  const parts: string[] = [];

  const describe = (node: WorkflowNode): string => {
    switch (node.type) {
      case "start": return `starts here`;
      case "end": return `ends here`;
      case "task": return `runs the task "${node.label}"`;
      case "agent": return `delegates to the agent "${node.label}"`;
      case "condition": return `evaluates the condition "${node.label}"`;
      case "approval": return `waits for approval from ${node.config?.approver ?? "an approver"}`;
      case "delay": return `pauses for ${node.config?.durationSeconds ?? "a configured"} seconds`;
      case "relay": return `relays to ${node.config?.routeTarget ?? "a target"}`;
      default: return `processes "${node.label}"`;
    }
  };

  const walk = (node: WorkflowNode, depth: number, seen: Set<string>) => {
    if (depth > 12 || seen.has(node.id)) return;
    seen.add(node.id);
    const edges = outgoing.get(node.id) ?? [];
    if (edges.length === 0) {
      parts.push(`${describe(node)}.`);
      return;
    }
    for (const edge of edges) {
      const target = byId.get(edge.to);
      if (!target) continue;
      const label = edgeLabel(edge);
      parts.push(`${describe(node)} → ${label ? `via ${label} ` : ""}${describe(target)}.`);
      walk(target, depth + 1, seen);
    }
  };

  for (const start of starts) walk(start, 0, new Set());

  // Mention any unreachable nodes so the explanation is honest.
  const unreachable = validationUnreachable(workflow);
  if (unreachable.length > 0) {
    parts.push(`Note: ${unreachable.length} node(s) are not reachable from the start.`);
  }

  return parts.join(" ");
}

function validationUnreachable(workflow: Workflow): string[] {
  return validateWorkflow(workflow).unreachableNodeIds;
}

/**
 * Generate routing conditions for a condition node. If the node has outgoing
 * edges, it refines their labels/expressions; otherwise it proposes a standard
 * success / failure / timeout set.
 */
export function generateRoutingConditions(
  workflow: Workflow,
  selectedNodeId?: string | null,
): { label: string; expression: string; condition: EdgeCondition }[] {
  const node = selectedNodeId
    ? workflow.nodes.find((n) => n.id === selectedNodeId)
    : workflow.nodes.find((n) => n.type === "condition");

  if (!node || node.type !== "condition") {
    return [
      { label: "approved", expression: "status == 'approved'", condition: "IF_TRUE" },
      { label: "rejected", expression: "status == 'rejected'", condition: "IF_FALSE" },
      { label: "timeout", expression: "timeout == true", condition: "IF_TIMEOUT" },
    ];
  }

  const outEdges = workflow.edges.filter((e) => e.from === node.id);
  if (outEdges.length > 0) {
    return outEdges.map((edge) => ({
      label: edgeLabel(edge) || edge.condition,
      expression: edge.expression ?? "",
      condition: edge.condition,
    }));
  }

  return [
    { label: "approved", expression: "status == 'approved'", condition: "IF_TRUE" },
    { label: "rejected", expression: "status == 'rejected'", condition: "IF_FALSE" },
    { label: "timeout", expression: "timeout == true", condition: "IF_TIMEOUT" },
  ];
}

/**
 * Generate a workflow from a natural-language request. Recognizes a small set
 * of well-known shapes and falls back to a linear skeleton.
 */
export function generateWorkflowFromPrompt(prompt: string): Workflow {
  const text = prompt.toLowerCase();

  if (text.includes("incident") && (text.includes("escalat") || text.includes("severity"))) {
    return incidentEscalationWorkflow();
  }
  if (text.includes("approval") && /above|over|greater|>|€|\$/.test(text)) {
    return approvalThresholdWorkflow();
  }
  if (text.includes("success") && text.includes("failure") && text.includes("timeout")) {
    return successFailureTimeoutWorkflow();
  }
  if (text.includes("approval")) {
    return approvalWorkflow();
  }
  return linearSkeletonWorkflow(prompt);
}

/** Build a node with a stable id and default position. */
function makeNode(type: WorkflowNodeType, label: string, index: number, extra?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: nextId(`n-${type}`),
    type,
    label,
    x: 80 + index * 220,
    y: 200,
    ...extra,
  };
}

/** Build an edge with a stable id. */
function makeEdge(from: string, to: string, name: string, condition: EdgeCondition, extra?: Partial<WorkflowEdge>): WorkflowEdge {
  return {
    id: nextId("e"),
    from,
    to,
    name,
    condition,
    ...extra,
  };
}

/** Incident escalation: triage → severity check → escalate or resolve. */
function incidentEscalationWorkflow(): Workflow {
  const start = makeNode("start", "Incident Reported", 0);
  const triage = makeNode("task", "Triage Incident", 1, {
    config: { description: "Classify the incident and assign an initial severity." },
  });
  const severity = makeNode("condition", "Severity Check", 2, {
    config: { expression: "severity >= 3", variables: [{ name: "severity", description: "Incident severity 1-5" }] },
  });
  const escalate = makeNode("approval", "Escalate to On-Call", 3, {
    config: { approver: "on-call-engineer", slaHours: 1, escalationRules: [{ afterHours: 1, escalateTo: "engineering-manager", action: "notify" }] },
  });
  const resolve = makeNode("task", "Resolve Incident", 4, {
    config: { description: "Work the incident to resolution." },
  });
  const end = makeNode("end", "Incident Closed", 5);

  const nodes = [start, triage, severity, escalate, resolve, end];
  const edges = [
    makeEdge(start.id, triage.id, "begin", "IF_ALWAYS"),
    makeEdge(triage.id, severity.id, "triaged", "IF_ALWAYS"),
    makeEdge(severity.id, escalate.id, "critical", "IF_TRUE", { expression: "severity >= 3", successPath: false, failurePath: true }),
    makeEdge(severity.id, resolve.id, "minor", "IF_FALSE", { expression: "severity < 3", successPath: true }),
    makeEdge(escalate.id, resolve.id, "approved", "IF_ALWAYS"),
    makeEdge(resolve.id, end.id, "resolved", "IF_ALWAYS"),
  ];

  return {
    id: nextId("wf"),
    name: "Incident Escalation",
    description: "Triage an incident, escalate critical ones to on-call, then resolve.",
    nodes,
    edges,
    status: "draft",
  };
}

/** Approval gate: request → amount check → approve or reject. */
function approvalThresholdWorkflow(): Workflow {
  const start = makeNode("start", "Request Received", 0);
  const review = makeNode("task", "Review Request", 1, {
    config: { description: "Gather the details needed to evaluate the request." },
  });
  const amount = makeNode("condition", "Amount Check", 2, {
    config: { expression: "amount > 10000", variables: [{ name: "amount", description: "Request amount in EUR" }] },
  });
  const approve = makeNode("approval", "Manager Approval", 3, {
    config: { approver: "finance-manager", slaHours: 24, escalationRules: [{ afterHours: 24, escalateTo: "cfo", action: "notify" }] },
  });
  const reject = makeNode("task", "Reject Request", 4, {
    config: { description: "Notify the requester and close the request." },
  });
  const end = makeNode("end", "Request Decided", 5);

  const nodes = [start, review, amount, approve, reject, end];
  const edges = [
    makeEdge(start.id, review.id, "begin", "IF_ALWAYS"),
    makeEdge(review.id, amount.id, "reviewed", "IF_ALWAYS"),
    makeEdge(amount.id, approve.id, "above threshold", "IF_TRUE", { expression: "amount > 10000", successPath: true }),
    makeEdge(amount.id, reject.id, "below threshold", "IF_FALSE", { expression: "amount <= 10000", failurePath: true }),
    makeEdge(approve.id, end.id, "approved", "IF_ALWAYS"),
    makeEdge(reject.id, end.id, "rejected", "IF_ALWAYS"),
  ];

  return {
    id: nextId("wf"),
    name: "Approval Threshold",
    description: "Route requests above €10,000 to manager approval; reject the rest.",
    nodes,
    edges,
    status: "draft",
  };
}

/** Success / failure / timeout branching from a single condition. */
function successFailureTimeoutWorkflow(): Workflow {
  const start = makeNode("start", "Begin", 0);
  const run = makeNode("task", "Execute Step", 1, {
    config: { description: "Perform the operation that may succeed, fail, or time out." },
  });
  const outcome = makeNode("condition", "Outcome Check", 2, {
    config: { expression: "status", variables: [{ name: "status", description: "success | failure | timeout" }] },
  });
  const onSuccess = makeNode("task", "On Success", 3, {
    config: { description: "Continue the happy path." },
  });
  const onFailure = makeNode("task", "On Failure", 4, {
    config: { description: "Handle the failure and notify." },
  });
  const onTimeout = makeNode("task", "On Timeout", 5, {
    config: { description: "Retry or escalate the timed-out step." },
  });
  const end = makeNode("end", "Done", 6);

  const nodes = [start, run, outcome, onSuccess, onFailure, onTimeout, end];
  const edges = [
    makeEdge(start.id, run.id, "begin", "IF_ALWAYS"),
    makeEdge(run.id, outcome.id, "finished", "IF_ALWAYS"),
    makeEdge(outcome.id, onSuccess.id, "success", "IF_TRUE", { expression: "status == 'success'", successPath: true }),
    makeEdge(outcome.id, onFailure.id, "failure", "IF_FALSE", { expression: "status == 'failure'", failurePath: true }),
    makeEdge(outcome.id, onTimeout.id, "timeout", "IF_TIMEOUT", { expression: "timeout == true" }),
    makeEdge(onSuccess.id, end.id, "complete", "IF_ALWAYS"),
    makeEdge(onFailure.id, end.id, "complete", "IF_ALWAYS"),
    makeEdge(onTimeout.id, end.id, "complete", "IF_ALWAYS"),
  ];

  return {
    id: nextId("wf"),
    name: "Success / Failure / Timeout",
    description: "Branch on the outcome of a step into success, failure, and timeout paths.",
    nodes,
    edges,
    status: "draft",
  };
}

/** A simple approval workflow. */
function approvalWorkflow(): Workflow {
  const start = makeNode("start", "Request", 0);
  const approve = makeNode("approval", "Approval", 1, {
    config: { approver: "manager", slaHours: 24 },
  });
  const proceed = makeNode("task", "Proceed", 2, {
    config: { description: "Continue once approved." },
  });
  const end = makeNode("end", "Complete", 3);

  const nodes = [start, approve, proceed, end];
  const edges = [
    makeEdge(start.id, approve.id, "submit", "IF_ALWAYS"),
    makeEdge(approve.id, proceed.id, "approved", "IF_TRUE", { successPath: true }),
    makeEdge(proceed.id, end.id, "done", "IF_ALWAYS"),
  ];

  return {
    id: nextId("wf"),
    name: "Approval Workflow",
    description: "A request that requires approval before proceeding.",
    nodes,
    edges,
    status: "draft",
  };
}

/** A linear skeleton for unrecognized prompts. */
function linearSkeletonWorkflow(prompt: string): Workflow {
  const title = prompt.trim().slice(0, 40) || "New Workflow";
  const start = makeNode("start", "Start", 0);
  const task = makeNode("task", title, 1, {
    config: { description: prompt.trim() },
  });
  const end = makeNode("end", "End", 2);

  const nodes = [start, task, end];
  const edges = [
    makeEdge(start.id, task.id, "begin", "IF_ALWAYS"),
    makeEdge(task.id, end.id, "done", "IF_ALWAYS"),
  ];

  return {
    id: nextId("wf"),
    name: title,
    description: `Generated from: ${prompt.trim()}`,
    nodes,
    edges,
    status: "draft",
  };
}

/**
 * The label to display on an edge: prefer the custom expression, then the
 * name, then the condition.
 */
export function edgeLabel(edge: WorkflowEdge): string {
  if (edge.expression && edge.expression.trim()) return edge.expression.trim();
  if (edge.name && edge.name.trim()) return edge.name.trim();
  return edge.condition;
}

/**
 * Build a Copilot assistant reply for a user prompt. Returns the message plus
 * any proposed workflow/node/edge the assistant wants to apply.
 */
export function copilotReply(prompt: string, workflow: Workflow): CopilotMessage {
  const text = prompt.toLowerCase();

  if (text.includes("explain") || text.includes("what does") || text.includes("how does")) {
    return {
      id: nextId("msg"),
      role: "assistant",
      text: explainWorkflow(workflow),
    };
  }

  if (text.includes("unreachable") || text.includes("dead end") || text.includes("validate") || text.includes("check")) {
    const validation = validateWorkflow(workflow);
    if (validation.valid && validation.issues.length === 0) {
      return { id: nextId("msg"), role: "assistant", text: "The workflow is valid — no structural or logical issues found." };
    }
    const lines = validation.issues.map((issue) => `• ${issue.message}`);
    return { id: nextId("msg"), role: "assistant", text: `Found ${validation.issues.length} issue(s):\n${lines.join("\n")}` };
  }

  if (text.includes("condition") && (text.includes("generate") || text.includes("create") || text.includes("success"))) {
    const conditions = generateRoutingConditions(workflow);
    const lines = conditions.map((c) => `• ${c.label}: ${c.expression || c.condition}`);
    return { id: nextId("msg"), role: "assistant", text: `Routing conditions:\n${lines.join("\n")}` };
  }

  // Default: generate a workflow from the prompt.
  const proposed = generateWorkflowFromPrompt(prompt);
  return {
    id: nextId("msg"),
    role: "assistant",
    text: `Here's a workflow for "${prompt.trim()}". Review the preview and apply it.`,
    proposedWorkflow: proposed,
  };
}
