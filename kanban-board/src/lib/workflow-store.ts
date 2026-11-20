/**
 * workflow-store.ts — workflow persistence backed by the agent-server file API.
 *
 * All backend access goes through host.agentServer.request. Workflow definitions
 * live in a separate JSON file so board.json remains a flat task array.
 */

import type { Host } from "../types/task";
import type { Workflow } from "../types/ai";

export const WORKFLOW_FILE_PATH = "/home/razvijalec/.kanban-board/workflows.json";

function isWorkflow(value: unknown): value is Workflow {
  if (!value || typeof value !== "object") return false;
  const workflow = value as Partial<Workflow>;
  return (
    typeof workflow.id === "string" &&
    typeof workflow.name === "string" &&
    typeof workflow.description === "string" &&
    Array.isArray(workflow.nodeIds) &&
    Array.isArray(workflow.edges) &&
    (workflow.status === "draft" || workflow.status === "active" || workflow.status === "completed")
  );
}

/** Download workflows and defensively accept raw JSON or known object envelopes. */
export async function fetchWorkflows(host: Host): Promise<Workflow[]> {
  try {
    const res = await host.agentServer.request({
      method: "GET",
      path: `/api/file/download?path=${encodeURIComponent(WORKFLOW_FILE_PATH)}`,
    });
    if (Array.isArray(res)) return res.filter(isWorkflow);
    if (typeof res === "string") {
      try {
        const parsed = JSON.parse(res);
        if (Array.isArray(parsed)) return parsed.filter(isWorkflow);
        if (parsed && Array.isArray((parsed as { workflows?: unknown[] }).workflows)) {
          return (parsed as { workflows: unknown[] }).workflows.filter(isWorkflow);
        }
      } catch {
        // Not valid JSON — fall through to empty.
      }
    }
    if (res && typeof res === "object" && Array.isArray((res as { workflows?: unknown[] }).workflows)) {
      return (res as { workflows: unknown[] }).workflows.filter(isWorkflow);
    }
    return [];
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
