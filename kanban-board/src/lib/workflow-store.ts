/**
 * workflow-store.ts — workflow persistence backed by the agent-server file API.
 *
 * All backend access goes through host.agentServer.request. Workflow definitions
 * live in a separate JSON file so board.json remains a flat task array.
 */

import type { Host } from "../types/task";
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeConfig,
  NodeVariable,
  RetryPolicy,
  EscalationRule,
} from "../types/ai";

export const WORKFLOW_FILE_PATH = "/home/razvijalec/.kanban-board/workflows.json";

const NODE_TYPES = ["task", "agent", "condition", "approval", "start", "end", "delay", "relay"] as const;
const EDGE_CONDITIONS = [
  "IF_SUCCESS", "IF_FAILURE", "IF_ALWAYS", "IF_APPROVED", "IF_REJECTED",
  "IF_RETRY_EXHAUSTED", "IF_MANUAL_APPROVAL", "IF_TRUE", "IF_FALSE", "IF_TIMEOUT",
] as const;

/** Coerce a raw variable list into NodeVariable[]. */
function migrateVariables(value: unknown): NodeVariable[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const vars = (value as unknown[])
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object")
    .map((v) => ({
      name: typeof v.name === "string" ? v.name : "",
      description: typeof v.description === "string" ? v.description : undefined,
      defaultValue: typeof v.defaultValue === "string" ? v.defaultValue : undefined,
    }))
    .filter((v) => v.name !== "");
  return vars.length > 0 ? vars : undefined;
}

/** Coerce a raw retry policy into RetryPolicy. */
function migrateRetryPolicy(value: unknown): RetryPolicy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return {
    maxAttempts: typeof raw.maxAttempts === "number" ? raw.maxAttempts : 0,
    backoff: (["none", "fixed", "exponential"] as const).includes(raw.backoff as never)
      ? (raw.backoff as RetryPolicy["backoff"])
      : "none",
    delaySeconds: typeof raw.delaySeconds === "number" ? raw.delaySeconds : 0,
  };
}

/** Coerce a raw escalation rule list into EscalationRule[]. */
function migrateEscalationRules(value: unknown): EscalationRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules = (value as unknown[])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r) => ({
      afterHours: typeof r.afterHours === "number" ? r.afterHours : 0,
      escalateTo: typeof r.escalateTo === "string" ? r.escalateTo : "",
      action: typeof r.action === "string" ? r.action : undefined,
    }))
    .filter((r) => r.escalateTo !== "");
  return rules.length > 0 ? rules : undefined;
}

/** Coerce a raw node config into WorkflowNodeConfig. */
function migrateNodeConfig(value: unknown): WorkflowNodeConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const config: WorkflowNodeConfig = {};
  if (typeof raw.agentProfile === "string") config.agentProfile = raw.agentProfile;
  if (typeof raw.prompt === "string") config.prompt = raw.prompt;
  if (Array.isArray(raw.tools)) config.tools = (raw.tools as unknown[]).filter((t): t is string => typeof t === "string");
  if (["none", "session", "persistent"].includes(raw.memory as string)) config.memory = raw.memory as WorkflowNodeConfig["memory"];
  if (typeof raw.timeoutSeconds === "number") config.timeoutSeconds = raw.timeoutSeconds;
  const retry = migrateRetryPolicy(raw.retryPolicy);
  if (retry) config.retryPolicy = retry;
  if (typeof raw.description === "string") config.description = raw.description;
  const inputs = migrateVariables(raw.inputs);
  if (inputs) config.inputs = inputs;
  const outputs = migrateVariables(raw.outputs);
  if (outputs) config.outputs = outputs;
  if (typeof raw.expression === "string") config.expression = raw.expression;
  const variables = migrateVariables(raw.variables);
  if (variables) config.variables = variables;
  if (typeof raw.validation === "string") config.validation = raw.validation;
  if (typeof raw.approver === "string") config.approver = raw.approver;
  const escalation = migrateEscalationRules(raw.escalationRules);
  if (escalation) config.escalationRules = escalation;
  if (typeof raw.slaHours === "number") config.slaHours = raw.slaHours;
  if (typeof raw.durationSeconds === "number") config.durationSeconds = raw.durationSeconds;
  if (typeof raw.schedule === "string") config.schedule = raw.schedule;
  if (typeof raw.routeTarget === "string") config.routeTarget = raw.routeTarget;
  const retryStrategy = migrateRetryPolicy(raw.retryStrategy);
  if (retryStrategy) config.retryStrategy = retryStrategy;
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Coerce a raw persisted workflow into the current shape. Handles both the
 * legacy form (nodeIds + bare {from,to} edges) and the current form (nodes +
 * condition-labelled edges). Legacy task ids become task nodes; legacy edges
 * become IF_SUCCESS edges.
 */
function migrateWorkflow(value: unknown): Workflow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const description = typeof raw.description === "string" ? raw.description : "";
  const status = raw.status === "active" || raw.status === "completed" ? raw.status : "draft";

  // Current shape: explicit nodes array.
  if (Array.isArray(raw.nodes)) {
    const nodes: WorkflowNode[] = (raw.nodes as unknown[])
      .filter((n): n is Record<string, unknown> => Boolean(n) && typeof n === "object")
      .map((n) => ({
        id: String(n.id),
        type: NODE_TYPES.includes(n.type as never)
          ? (n.type as WorkflowNode["type"])
          : "task",
        label: typeof n.label === "string" ? n.label : String(n.id),
        x: typeof n.x === "number" ? n.x : 0,
        y: typeof n.y === "number" ? n.y : 0,
        profileId: typeof n.profileId === "string" ? n.profileId : null,
        agentId: typeof n.agentId === "string" ? n.agentId : null,
        modelId: typeof n.modelId === "string" ? n.modelId : null,
        taskId: typeof n.taskId === "string" ? n.taskId : null,
        config: migrateNodeConfig(n.config),
      }));
    const edges: WorkflowEdge[] = Array.isArray(raw.edges)
      ? (raw.edges as unknown[])
          .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
          .map((e, i) => ({
            id: typeof e.id === "string" ? e.id : `e-${i}`,
            from: String(e.from),
            to: String(e.to),
            name: typeof e.name === "string" ? e.name : undefined,
            condition: EDGE_CONDITIONS.includes(e.condition as never)
              ? (e.condition as WorkflowEdge["condition"])
              : "IF_SUCCESS",
            expression: typeof e.expression === "string" ? e.expression : undefined,
            priority: typeof e.priority === "number" ? e.priority : undefined,
            successPath: typeof e.successPath === "boolean" ? e.successPath : undefined,
            failurePath: typeof e.failurePath === "boolean" ? e.failurePath : undefined,
            metadata: e.metadata && typeof e.metadata === "object"
              ? Object.fromEntries(
                  Object.entries(e.metadata as Record<string, unknown>)
                    .filter(([, v]) => typeof v === "string")
                    .map(([k, v]) => [k, v as string]),
                )
              : undefined,
          }))
      : [];
    return { id: raw.id, name: raw.name, description, nodes, edges, status };
  }

  // Legacy shape: nodeIds + bare edges.
  if (Array.isArray(raw.nodeIds)) {
    const nodes: WorkflowNode[] = (raw.nodeIds as unknown[])
      .filter((id): id is string => typeof id === "string")
      .map((id, i) => ({ id, type: "task", label: id, x: 80 + (i % 4) * 240, y: 80 + Math.floor(i / 4) * 140, taskId: id }));
    const edges: WorkflowEdge[] = Array.isArray(raw.edges)
      ? (raw.edges as unknown[])
          .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
          .map((e, i) => ({ id: `e-${i}`, from: String(e.from), to: String(e.to), condition: "IF_SUCCESS" as const }))
      : [];
    return { id: raw.id, name: raw.name, description, nodes, edges, status };
  }

  return null;
}

/** Download workflows and defensively accept raw JSON or known object envelopes. */
export async function fetchWorkflows(host: Host): Promise<Workflow[]> {
  try {
    const res = await host.agentServer.request({
      method: "GET",
      path: `/api/file/download?path=${encodeURIComponent(WORKFLOW_FILE_PATH)}`,
    });
    const rawList: unknown[] = [];
    if (Array.isArray(res)) rawList.push(...res);
    else if (typeof res === "string") {
      try {
        const parsed = JSON.parse(res);
        if (Array.isArray(parsed)) rawList.push(...parsed);
        else if (parsed && Array.isArray((parsed as { workflows?: unknown[] }).workflows)) {
          rawList.push(...(parsed as { workflows: unknown[] }).workflows);
        }
      } catch {
        // Not valid JSON — fall through to empty.
      }
    } else if (res && typeof res === "object" && Array.isArray((res as { workflows?: unknown[] }).workflows)) {
      rawList.push(...(res as { workflows: unknown[] }).workflows);
    }
    return rawList.map(migrateWorkflow).filter((w): w is Workflow => w !== null);
  } catch {
    return [];
  }
}

/** Upload the full workflow list to the workflows file. */
export async function saveWorkflows(host: Host, workflows: Workflow[]): Promise<void> {
  const json = JSON.stringify(workflows, null, 2);
  const form = new FormData();
  form.append("file", new Blob([json], { type: "application/json" }), "workflows.json");
  await host.agentServer.request({
    method: "POST",
    path: `/api/file/upload?path=${encodeURIComponent(WORKFLOW_FILE_PATH)}`,
    body: form,
  });
}
