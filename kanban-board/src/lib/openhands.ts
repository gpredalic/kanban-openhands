import { useEffect, useState, useSyncExternalStore } from "react";
import type { Host, Task, TaskStatus } from "../types/task";
import type {
  OpenHandsEvent,
  OpenHandsExecution,
  OpenHandsLink,
  OpenHandsSnapshot,
  OpenHandsState,
} from "../types/openhands";
import { setTaskOverlay } from "./task-overlay";
import { fetchTasks, saveTasks, updateTask, withBoardLock, dedupeTasks } from "./task-store";

const POLL_INTERVAL_MS = 2_000;
const EMPTY_SNAPSHOT: OpenHandsSnapshot = { executions: [], events: [], links: [], updatedAt: 0 };

/**
 * Fingerprint the *content* of a snapshot, excluding `updatedAt` (which is
 * refreshed on every poll and would defeat the comparison). Two snapshots with
 * identical executions, events, and links produce the same fingerprint even
 * though their `updatedAt` differs. This is what lets the 2-second poll skip
 * the notify when nothing actually changed, stopping the board from
 * re-rendering 30 times a minute for no reason.
 */
function snapshotFingerprint(snapshot: OpenHandsSnapshot): string {
  const execs = snapshot.executions
    .map((e) => `${e.id}|${e.status}|${e.taskId ?? ""}|${e.agentId ?? ""}|${e.modelId ?? ""}|${e.startedAt ?? 0}|${e.updatedAt ?? 0}|${e.finishedAt ?? 0}|${e.tokensIn}|${e.tokensOut}|${e.cost}|${e.retries ?? 0}|${e.error ?? ""}`)
    .join(";");
  const events = snapshot.events
    .map((e) => `${e.id}|${e.type}|${e.status ?? ""}|${e.at}|${e.taskId ?? ""}|${e.executionId ?? ""}`)
    .join(";");
  const links = snapshot.links
    .map((l) => `${l.from.id}->${l.to.id}:${l.relation}`)
    .join(";");
  return `${execs}||${events}||${links}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function timestamp(value: unknown, fallback = Date.now()): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function conversationArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!asObject(item));
  const object = asObject(value);
  if (!object) return [];
  for (const key of ["items", "conversations", "results"]) {
    if (Array.isArray(object[key])) {
      return object[key].filter((item): item is Record<string, unknown> => !!asObject(item));
    }
  }
  return [];
}

function eventArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!asObject(item));
  const object = asObject(value);
  if (!object) return [];
  for (const key of ["items", "events", "results"]) {
    if (Array.isArray(object[key])) {
      return object[key].filter((item): item is Record<string, unknown> => !!asObject(item));
    }
  }
  return [];
}

function mapStatus(value: unknown): OpenHandsExecution["status"] {
  const status = asString(value)?.toLowerCase();
  if (status === "running" || status === "waiting_for_confirmation" || status === "executing" || status === "started") return "running";
  if (status === "finished" || status === "succeeded" || status === "success" || status === "completed") return "completed";
  if (status === "error" || status === "stuck" || status === "failed") return "failed";
  if (status === "deleting" || status === "cancelled" || status === "canceled" || status === "stopped") return "cancelled";
  if (status === "pending") return "pending";
  if (status === "paused") return "queued";
  return "queued";
}

/**
 * The single source of truth for mapping an OpenHands execution status onto a
 * board column. Every surface that derives a column from an execution status
 * (recordExecution, statusForConversation, the inbound reconcile) reads from
 * this map, so the status → column contract is defined exactly once:
 *
 *   Queued / Pending            -> todo         (not started yet)
 *   Running / Executing / Started -> in_progress (actively executing)
 *   Failed / Error              -> review       (needs human attention)
 *   Cancelled / Stopped         -> review       (needs human attention)
 *   Completed                   -> done
 */
export const EXECUTION_STATUS_TO_COLUMN: Record<OpenHandsExecution["status"], TaskStatus> = {
  pending: "todo",
  queued: "todo",
  running: "in_progress",
  completed: "done",
  failed: "review",
  cancelled: "review",
};

/** Resolve an execution status to its board column. */
export function executionStatusToColumn(status: OpenHandsExecution["status"]): TaskStatus {
  return EXECUTION_STATUS_TO_COLUMN[status];
}

function getConversationTags(conversation: Record<string, unknown>): Record<string, string> {
  const tags = asObject(conversation.tags);
  if (!tags) return {};
  return Object.fromEntries(Object.entries(tags).filter(([, value]) => typeof value === "string")) as Record<string, string>;
}

function conversationMetrics(conversation: Record<string, unknown>): {
  tokensIn: number;
  tokensOut: number;
  cost: number;
  tokensInReported: boolean;
  tokensOutReported: boolean;
  costReported: boolean;
} {
  const stats = asObject(conversation.stats) ?? {};
  const metrics = asObject(conversation.metrics) ?? {};
  const accumulated = asObject(metrics.accumulated_token_usage);
  const usageToMetrics = asObject(stats.usage_to_metrics) ?? {};
  let realUsageTokensIn = 0;
  let realUsageTokensOut = 0;
  let realCost = 0;
  for (const value of Object.values(usageToMetrics)) {
    const metric = asObject(value);
    if (!metric) continue;
    realCost += asNumber(metric.accumulated_cost);
    const usage = asObject(metric.accumulated_token_usage);
    realUsageTokensIn += asNumber(usage?.prompt_tokens);
    realUsageTokensOut += asNumber(usage?.completion_tokens);
  }
  const cost = asNumber(metrics.accumulated_cost)
    || realCost
    || asNumber(stats.cost)
    || asNumber(stats.total_cost)
    || asNumber(stats.accumulated_cost);
  const tokensIn = asNumber(accumulated?.prompt_tokens)
    || realUsageTokensIn
    || asNumber(stats.prompt_tokens)
    || asNumber(stats.tokens_in)
    || asNumber(stats.input_tokens);
  const tokensOut = asNumber(accumulated?.completion_tokens)
    || realUsageTokensOut
    || asNumber(stats.completion_tokens)
    || asNumber(stats.tokens_out)
    || asNumber(stats.output_tokens);
  return {
    tokensIn,
    tokensOut,
    cost,
    tokensInReported: tokensIn !== 0
      || accumulated?.prompt_tokens !== undefined
      || stats.prompt_tokens !== undefined
      || stats.tokens_in !== undefined
      || stats.input_tokens !== undefined,
    tokensOutReported: tokensOut !== 0
      || accumulated?.completion_tokens !== undefined
      || stats.completion_tokens !== undefined
      || stats.tokens_out !== undefined
      || stats.output_tokens !== undefined,
    costReported: cost !== 0
      || metrics.accumulated_cost !== undefined
      || stats.cost !== undefined
      || stats.total_cost !== undefined
      || stats.accumulated_cost !== undefined,
  };
}

function eventType(kind: string): OpenHandsEvent["type"] {
  const lower = kind.toLowerCase();
  if (lower.includes("error")) return "error";
  if (lower.includes("commit")) return "commit";
  if (lower.includes("pull")) return "pull_request";
  if (lower.includes("action") || lower.includes("observation") || lower.includes("tool")) return "tool";
  if (lower.includes("message") || lower.includes("conversation")) return "conversation";
  return "execution";
}

function eventDetail(event: Record<string, unknown>): string | undefined {
  for (const key of ["detail", "message", "content", "text", "observation", "action", "key"]) {
    const value = event[key];
    if (typeof value === "string") return value;
  }
  const content = asObject(event.content);
  if (content) {
    const text = asString(content.text);
    if (text) return text;
  }
  return undefined;
}

/** Concatenate the text parts of an LLM content array (MessageEvent.llm_message.content). */
function llmContentText(value: unknown): string | undefined {
  const message = asObject(value);
  const content = message?.content;
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => asString(asObject(part)?.text))
      .filter((part): part is string => !!part);
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof content === "string") return content;
  return undefined;
}

/**
 * A human-readable "current step" label for an event. This is what the
 * execution-visibility panel shows as the agent's active step. It prefers the
 * tool being invoked (ActionEvent), then the message role, then the raw kind.
 */
function eventStepTitle(event: Record<string, unknown>, kind: string): string {
  const toolName = asString(event.tool_name);
  const action = asObject(event.action);
  const actionKind = asString(action?.kind);
  const command = asString(action?.command);
  if (toolName) {
    const label = toolName.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return command ? `${label} · ${command}` : label;
  }
  if (actionKind) return actionKind.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const source = asString(event.source);
  if (kind.toLowerCase().includes("message")) {
    return source === "user" ? "User message" : "Agent message";
  }
  if (kind.toLowerCase().includes("observation")) return "Observation";
  return kind.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The most recent agent-facing text for an event: the agent's reasoning, the
 * message body, or the observation text. Used as the "Latest Agent Message".
 */
function eventAgentMessage(event: Record<string, unknown>): string | undefined {
  const reasoning = asString(event.reasoning_content);
  if (reasoning) return reasoning;
  const messageText = llmContentText(event.llm_message);
  if (messageText) return messageText;
  const observation = asObject(event.observation);
  const observationText = llmContentText(observation?.content) ?? asString(observation?.text);
  if (observationText) return observationText;
  return eventDetail(event);
}

export function normalizeSnapshot(value: unknown): OpenHandsSnapshot {
  const object = asObject(value);
  if (object?.executions || object?.events || object?.links) {
    return {
      executions: Array.isArray(object.executions) ? object.executions as OpenHandsExecution[] : [],
      events: Array.isArray(object.events) ? object.events as OpenHandsEvent[] : [],
      links: Array.isArray(object.links) ? object.links as OpenHandsLink[] : [],
      updatedAt: typeof object.updatedAt === "number" ? object.updatedAt : Date.now(),
    };
  }

  const conversations = conversationArray(value);
  const executions: OpenHandsExecution[] = conversations.map((conversation) => {
    const tags = getConversationTags(conversation);
    const metrics = conversationMetrics(conversation);
    const status = mapStatus(conversation.execution_status);
    const createdAt = timestamp(conversation.created_at);
    const updatedAt = timestamp(conversation.updated_at, createdAt);
    const launchedProfile = asObject(conversation.launched_agent_profile);
    const retriesValue = asNumber(conversation.retry_count ?? conversation.retries ?? conversation.attempt_count);
    const error = asString(conversation.error)
      ?? asString(conversation.error_message)
      ?? (conversation.execution_status === "error" ? asString(conversation.message) : undefined);
    return {
      id: asString(conversation.id) ?? "",
      taskId: tags.taskid,
      workflowId: tags.workflowid,
      title: asString(conversation.title) ?? tags.tasktitle ?? "OpenHands conversation",
      status,
      agentId: tags.agentprofileid ?? tags.agentid
        ?? asString(conversation.agent_profile_id)
        ?? asString(launchedProfile?.agent_profile_id),
      profileId: asString(conversation.agent_profile_id)
        ?? asString(launchedProfile?.agent_profile_id)
        ?? tags.agentprofileid
        ?? tags.agentid,
      modelId: asString(conversation.current_model_id),
      repository: tags.repository,
      startedAt: createdAt,
      updatedAt,
      finishedAt: status === "completed" || status === "failed" || status === "cancelled" ? updatedAt : undefined,
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut,
      cost: metrics.cost,
      tokensInReported: metrics.tokensInReported,
      tokensOutReported: metrics.tokensOutReported,
      costReported: metrics.costReported,
      retries: retriesValue,
      error,
    };
  }).filter((execution) => execution.id);

  const events: OpenHandsEvent[] = executions.map((execution) => ({
    id: `conversation-${execution.id}`,
    type: "conversation",
    title: execution.title,
    detail: `Conversation ${execution.status}`,
    status: execution.status,
    at: execution.startedAt ?? Date.now(),
    taskId: execution.taskId,
    executionId: execution.id,
    agentId: execution.agentId,
    modelId: execution.modelId,
  }));

  const links: OpenHandsLink[] = [];
  for (const execution of executions) {
    const conversation = { id: `conversation:${execution.id}`, label: execution.title, kind: "conversation" as const };
    if (execution.taskId) {
      links.push({
        from: { id: execution.taskId, label: execution.title, kind: "task" },
        to: conversation,
        relation: "runs",
      });
    }
    if (execution.agentId) {
      links.push({
        from: conversation,
        to: { id: execution.agentId, label: execution.agentId, kind: "agent" },
        relation: "assigned to",
      });
    }
  }

  return { executions, events, links, updatedAt: Date.now() };
}

export async function fetchOpenHandsSnapshot(host: Host): Promise<OpenHandsSnapshot> {
  const response = await host.agentServer.request({
    method: "GET",
    path: "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC",
  });

  const snapshot = normalizeSnapshot(response);
  const conversationMap = conversationArray(response);

  const events: OpenHandsEvent[] = [];
  for (const conversation of conversationMap) {
    const conversationId = asString(conversation.id);
    if (!conversationId) continue;
    try {
      const eventResponse = await host.agentServer.request({
        method: "GET",
        path: `/api/conversations/${encodeURIComponent(conversationId)}/events/search?limit=100&sort_order=TIMESTAMP`,
      });
      const tags = getConversationTags(conversation);
      for (const event of eventArray(eventResponse)) {
        const kind = asString(event.kind) ?? asString(event.type) ?? asString(event.key) ?? "execution";
        const source = asString(event.source);
        const eventId = asString(event.id) ?? asString(event.event_id) ?? `${conversationId}-${kind}-${timestamp(event.timestamp)}`;
        events.push({
          id: eventId,
          type: eventType(source ? `${source}-${kind}` : kind),
          title: eventStepTitle(event, kind),
          detail: eventAgentMessage(event),
          status: mapStatus(conversation.execution_status),
          at: timestamp(event.timestamp, timestamp(conversation.created_at)),
          taskId: tags.taskid,
          executionId: conversationId,
          agentId: tags.agentprofileid ?? tags.agentid,
          modelId: asString(conversation.current_model_id),
        });
      }
    } catch {
      // A missing event endpoint or an interrupted conversation must not fail observability.
    }
  }

  events.sort((a, b) => b.at - a.at);
  events.sort((a, b) => b.at - a.at);
  return { ...snapshot, events: events.length > 0 ? events : snapshot.events, updatedAt: Date.now() };
}


export type OpenHandsCommand = "start" | "stop" | "retry" | "schedule";

export interface OpenHandsCommandInput {
  taskId?: string;
  executionId?: string;
  agentId?: string;
  modelId?: string;
  title?: string;
  description?: string;
  /** The actual instruction sent to the AI. When present, this is the prompt — never the title. */
  agentPrompt?: string;
  /** Structured execution-planning field: what the agent should produce. */
  expectedOutput?: string;
  /** Structured execution-planning field: how to verify the work is done. */
  successCriteria?: string;
  workspaceId?: string;
  scheduledAt?: string;
}

/** A single tool selection in a profile's `tools` list. */
export interface AgentToolRef {
  name: string;
  params?: Record<string, unknown>;
}

/**
 * An agent profile as returned by the OpenHands agent-profile API.
 *
 * The list endpoint (`GET /api/agent-profiles`) returns only a summary
 * projection (id, name, llm_profile_ref, mcp_server_refs). The detail endpoint
 * (`GET /api/agent-profiles/{name}`) returns the full stored profile. This
 * interface models the full schema; summary fields are simply absent on list
 * results. All optional fields default to the OpenHands built-in behavior when
 * omitted, so a profile with only id/name/llmProfileRef is still valid.
 */
export interface AgentProfile {
  id: string;
  name: string;
  /** The LLM profile this agent runs on (its `llm_profile_ref`). */
  llmProfileRef?: string;
  /** Whether this is the currently active agent profile. */
  active?: boolean;
  /** Monotonic revision counter, bumped on each saved edit. */
  revision?: number;
  /** Agent class to build (default "CodeActAgent"). */
  agent?: string;
  /**
   * Tool selection. null = the server's standard tool set; [] = an explicitly
   * bare agent; a non-empty list is used exactly as given.
   */
  tools?: AgentToolRef[] | null;
  /** Persona text that replaces OpenHands' built-in persona. null = built-in. */
  persona?: string | null;
  /** Optional suffix appended to the system prompt. */
  systemMessageSuffix?: string | null;
  /**
   * Which of the user's globally configured MCP servers to expose.
   * null = all; [] = none; a non-null list = filter to the named keys.
   */
  mcpServerRefs?: string[] | null;
  /**
   * Which of the user's saved secrets to expose. null = all; [] = none; a
   * non-null list = filter to the named keys.
   */
  secretRefs?: string[] | null;
  /** Which public-catalog skills to load. null = all; [] = none; a list = only those. */
  publicSkills?: string[] | null;
  /** Deny-list of server-discovered skills to exclude. [] = all discovered. */
  disabledSkills?: string[];
  /** Maximum concurrent tool calls per agent step (default 1 = sequential). */
  toolConcurrencyLimit?: number;
}

/** The canonical tool catalog the editor offers as selectable tools. */
export const TOOL_CATALOG: ReadonlyArray<{ name: string; label: string }> = [
  { name: "terminal", label: "Terminal" },
  { name: "file_editor", label: "File Editor" },
  { name: "task_tracker", label: "Task Tracker" },
  { name: "browser_tool_set", label: "Browser" },
  { name: "task_tool_set", label: "Sub-agents" },
  { name: "switch_llm", label: "Switch LLM" },
  { name: "glob", label: "Glob" },
  { name: "grep", label: "Grep" },
];

export interface RelayHop {
  agent: string;
  question: string;
  response: string;
  status: "running" | "completed" | "failed";
  childConversationId?: string;
  error?: string;
}

export interface RelayInput {
  seed: string;
  agentNames: string[];
  maxHops: number;
  workspaceId?: string;
  useChildConversations?: boolean;
  delayMs?: number;
}

export interface RelayHandle {
  conversationId: string;
  stop: () => Promise<void>;
}

export async function fetchAgentProfiles(host: Host): Promise<AgentProfile[]> {
  try {
    const response = await host.agentServer.request({ method: "GET", path: "/api/agent-profiles" });
    const object = asObject(response);
    if (!object || !Array.isArray(object.profiles)) return [];
    const activeId = asString(object.active_agent_profile_id);
    return object.profiles
      .filter((item): item is Record<string, unknown> => !!asObject(item))
      .map((profile) => ({
        id: asString(profile.id) ?? asString(profile.name) ?? asString(profile.profile_name) ?? "",
        name: asString(profile.name) ?? asString(profile.profile_name) ?? "",
        llmProfileRef: asString(profile.llm_profile_ref),
        active: activeId !== undefined && activeId === asString(profile.id),
      }))
      .filter((profile) => profile.id && profile.name);
  } catch {
    return [];
  }
}

/**
 * Create or update an agent profile (upsert).
 *
 * The OpenHands API exposes a single write endpoint for profiles:
 * `POST /api/agent-profiles/{name}` with a body of `{ "llm_profile_ref": "…" }`.
 * The URL path segment is the profile name; posting to an existing name edits
 * that profile, posting to a new name creates it. There is no separate
 * create/update verb — this is the full write surface.
 *
 * Returns the saved profile name on success, or null on failure.
 */
export async function saveAgentProfile(
  host: Host,
  name: string,
  llmProfileRef: string,
): Promise<string | null> {
  const trimmedName = name.trim();
  const trimmedRef = llmProfileRef.trim();
  if (!trimmedName || !trimmedRef) return null;
  try {
    const response = await host.agentServer.request({
      method: "POST",
      path: `/api/agent-profiles/${encodeURIComponent(trimmedName)}`,
      body: { llm_profile_ref: trimmedRef },
    });
    // A 4xx/5xx response surfaces as a thrown error in the host client, so a
    // resolved response means the profile was saved.
    void response;
    return trimmedName;
  } catch {
    return null;
  }
}

/**
 * Activate an agent profile so it becomes the default for new conversations.
 * Uses the profile's stable id: `POST /api/agent-profiles/{id}/activate`.
 * Returns true on success.
 */
export async function activateAgentProfile(host: Host, profileId: string): Promise<boolean> {
  if (!profileId) return false;
  try {
    await host.agentServer.request({
      method: "POST",
      path: `/api/agent-profiles/${encodeURIComponent(profileId)}/activate`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an agent profile.
 *
 * The delete endpoint is keyed by profile NAME, not id:
 * `DELETE /api/agent-profiles/{name}`. Deleting by id returns a success
 * message but is a no-op, so the name must be used. Returns true on success.
 */
export async function deleteAgentProfile(host: Host, profileName: string): Promise<boolean> {
  const trimmedName = profileName.trim();
  if (!trimmedName) return false;
  try {
    await host.agentServer.request({
      method: "DELETE",
      path: `/api/agent-profiles/${encodeURIComponent(trimmedName)}`,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch the full stored profile for a name (`GET /api/agent-profiles/{name}`).
 * The response body is `{ name, profile }` where `profile` is the complete
 * schema dump. Returns the mapped profile, or null when the profile is missing
 * or the request fails.
 */
export async function fetchAgentProfileDetail(host: Host, name: string): Promise<AgentProfile | null> {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  try {
    const response = await host.agentServer.request({
      method: "GET",
      path: `/api/agent-profiles/${encodeURIComponent(trimmedName)}`,
    });
    const object = asObject(response);
    const profile = object ? asObject(object.profile) : null;
    if (!profile) return null;
    return mapProfileDetail(profile, trimmedName);
  } catch {
    return null;
  }
}

/** Map a raw profile-detail payload onto the AgentProfile interface. */
function mapProfileDetail(profile: Record<string, unknown>, name: string): AgentProfile {
  const tools = Array.isArray(profile.tools)
    ? profile.tools
        .filter((item): item is Record<string, unknown> => !!asObject(item))
        .map((tool) => ({
          name: asString(tool.name) ?? "",
          params: asObject(tool.params) ?? undefined,
        }))
        .filter((tool) => tool.name)
    : profile.tools === null
      ? null
      : undefined;
  return {
    id: asString(profile.id) ?? name,
    name: asString(profile.name) ?? name,
    llmProfileRef: asString(profile.llm_profile_ref),
    revision: typeof profile.revision === "number" ? profile.revision : undefined,
    agent: asString(profile.agent),
    tools,
    persona: typeof profile.persona === "string" ? profile.persona : null,
    systemMessageSuffix: typeof profile.system_message_suffix === "string" ? profile.system_message_suffix : null,
    mcpServerRefs: Array.isArray(profile.mcp_server_refs)
      ? profile.mcp_server_refs.map((item) => asString(item) ?? "").filter(Boolean)
      : profile.mcp_server_refs === null
        ? null
        : undefined,
    secretRefs: Array.isArray(profile.secret_refs)
      ? profile.secret_refs.map((item) => asString(item) ?? "").filter(Boolean)
      : profile.secret_refs === null
        ? null
        : undefined,
    publicSkills: Array.isArray(profile.public_skills)
      ? profile.public_skills.map((item) => asString(item) ?? "").filter(Boolean)
      : profile.public_skills === null
        ? null
        : undefined,
    disabledSkills: Array.isArray(profile.disabled_skills)
      ? profile.disabled_skills.map((item) => asString(item) ?? "").filter(Boolean)
      : [],
    toolConcurrencyLimit: typeof profile.tool_concurrency_limit === "number" ? profile.tool_concurrency_limit : undefined,
  };
}

/**
 * Build the POST body for saving a profile from an AgentProfile. Only fields
 * the editor manages are emitted; the server fills the rest with defaults.
 * The `id` is intentionally omitted — the server mints it on create and keeps
 * the namesake's id on overwrite.
 */
export function buildProfileBody(profile: AgentProfile): Record<string, unknown> {
  const body: Record<string, unknown> = {
    agent_kind: "openhands",
    llm_profile_ref: profile.llmProfileRef ?? "",
  };
  if (profile.agent) body.agent = profile.agent;
  if (profile.tools !== undefined) body.tools = profile.tools;
  if (profile.persona !== undefined) body.persona = profile.persona;
  if (profile.systemMessageSuffix !== undefined) body.system_message_suffix = profile.systemMessageSuffix;
  if (profile.mcpServerRefs !== undefined) body.mcp_server_refs = profile.mcpServerRefs;
  if (profile.secretRefs !== undefined) body.secret_refs = profile.secretRefs;
  if (profile.publicSkills !== undefined) body.public_skills = profile.publicSkills;
  if (profile.disabledSkills !== undefined) body.disabled_skills = profile.disabledSkills;
  if (profile.toolConcurrencyLimit !== undefined) body.tool_concurrency_limit = profile.toolConcurrencyLimit;
  return body;
}

/**
 * Save a full profile (upsert) via `POST /api/agent-profiles/{name}`. The path
 * name is authoritative and overrides any name in the body. Returns the saved
 * name on success, or null on failure.
 */
export async function saveAgentProfileFull(host: Host, name: string, profile: AgentProfile): Promise<string | null> {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  try {
    await host.agentServer.request({
      method: "POST",
      path: `/api/agent-profiles/${encodeURIComponent(trimmedName)}`,
      body: buildProfileBody(profile),
    });
    return trimmedName;
  } catch {
    return null;
  }
}

/**
 * Rename a profile via `POST /api/agent-profiles/{oldName}/rename`. The stable
 * id survives the rename. Returns the new name on success, or null on failure.
 */
export async function renameAgentProfile(host: Host, oldName: string, newName: string): Promise<string | null> {
  const trimmedOld = oldName.trim();
  const trimmedNew = newName.trim();
  if (!trimmedOld || !trimmedNew) return null;
  try {
    await host.agentServer.request({
      method: "POST",
      path: `/api/agent-profiles/${encodeURIComponent(trimmedOld)}/rename`,
      body: { new_name: trimmedNew },
    });
    return trimmedNew;
  } catch {
    return null;
  }
}

/** A saved secret as returned by `GET /api/settings/secrets`. */
export interface SecretRef {
  name: string;
  description?: string;
}

/**
 * Fetch the user's saved secrets (`GET /api/settings/secrets`). These are the
 * names a profile's `secret_refs` can reference. Returns an empty list on any
 * failure.
 */
export async function fetchSecrets(host: Host): Promise<SecretRef[]> {
  try {
    const response = await host.agentServer.request({ method: "GET", path: "/api/settings/secrets" });
    const object = asObject(response);
    if (!object || !Array.isArray(object.secrets)) return [];
    return object.secrets
      .filter((item): item is Record<string, unknown> => !!asObject(item))
      .map((secret) => ({
        name: asString(secret.name) ?? "",
        description: asString(secret.description),
      }))
      .filter((secret) => secret.name);
  } catch {
    return [];
  }
}

/** The diagnostics report returned by `POST /api/agent-profiles/{name}/materialize`. */
export interface MaterializeDiagnostics {
  agentKind: string;
  valid: boolean;
  errors: string[];
  unusableTools: string[];
  llmProfileRef: string | null;
  llmProfileResolved: boolean;
  llmApiKeySet: boolean;
  danglingMcpServerRefs: string[];
  resolvedSkills: string[];
  danglingMetaProfileRef: string | null;
}

/**
 * Dry-run resolve a stored profile (`POST /api/agent-profiles/{name}/materialize`).
 * Returns the diagnostics report, or null when the profile is missing or the
 * request fails.
 */
export async function materializeAgentProfile(host: Host, name: string): Promise<MaterializeDiagnostics | null> {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  try {
    const response = await host.agentServer.request({
      method: "POST",
      path: `/api/agent-profiles/${encodeURIComponent(trimmedName)}/materialize`,
    });
    const object = asObject(response);
    if (!object) return null;
    return {
      agentKind: asString(object.agent_kind) ?? "",
      valid: object.valid === true,
      errors: Array.isArray(object.errors) ? object.errors.map((item) => asString(item) ?? "").filter(Boolean) : [],
      unusableTools: Array.isArray(object.unusable_tools) ? object.unusable_tools.map((item) => asString(item) ?? "").filter(Boolean) : [],
      llmProfileRef: asString(object.llm_profile_ref) ?? null,
      llmProfileResolved: object.llm_profile_resolved === true,
      llmApiKeySet: object.llm_api_key_set === true,
      danglingMcpServerRefs: Array.isArray(object.dangling_mcp_server_refs) ? object.dangling_mcp_server_refs.map((item) => asString(item) ?? "").filter(Boolean) : [],
      resolvedSkills: Array.isArray(object.resolved_skills) ? object.resolved_skills.map((item) => asString(item) ?? "").filter(Boolean) : [],
      danglingMetaProfileRef: asString(object.dangling_meta_profile_ref) ?? null,
    };
  } catch {
    return null;
  }
}

/** An LLM profile as returned by the OpenHands `/api/profiles` endpoint. */
export interface LlmProfile {
  name: string;
  model: string;
  baseUrl: string;
  active: boolean;
  apiKeySet: boolean;
}

/**
 * Fetch the LLM profiles visible from the OpenHands API (`GET /api/profiles`).
 * These are the only models the platform can actually run — the local model
 * catalog is not a source of truth. Returns an empty list on any failure.
 */
export async function fetchLlmProfiles(host: Host): Promise<LlmProfile[]> {
  try {
    const response = await host.agentServer.request({ method: "GET", path: "/api/profiles" });
    const object = asObject(response);
    if (!object || !Array.isArray(object.profiles)) return [];
    const activeName = asString(object.active_profile);
    return object.profiles
      .filter((item): item is Record<string, unknown> => !!asObject(item))
      .map((profile) => ({
        name: asString(profile.name) ?? "",
        model: asString(profile.model) ?? "",
        baseUrl: asString(profile.base_url) ?? "",
        active: asString(profile.name) === activeName,
        apiKeySet: profile.api_key_set === true,
      }))
      .filter((profile) => profile.name);
  } catch {
    return [];
  }
}

export function buildRelayConversationRequest(
  seed: string,
  workspaceId: string,
  agentProfileId: string | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    workspace: { working_dir: workspaceId, kind: "LocalWorkspace" },
    initial_message: { role: "user", content: [{ type: "text", text: seed }], run: false },
    autotitle: true,
    tags: { relay: "true" },
  };
  if (agentProfileId) body.agent_profile_id = agentProfileId;
  return body;
}

export function buildSwitchProfileRequest(profileName: string): { profile_name: string } {
  return { profile_name: profileName };
}

export function buildAskAgentRequest(question: string): { question: string } {
  return { question };
}

export function buildChildConversationRequest(task: string): { task: string } {
  return { task };
}

export function relayHopQuestion(previousResponse: string, index: number): string {
  return index === 0 ? previousResponse : previousResponse;
}

export async function startAgentRelay(
  host: Host,
  input: RelayInput,
  onHop: (hop: RelayHop, index: number, running: boolean) => void,
): Promise<RelayHandle | null> {
  const seed = input.seed.trim();
  const agentNames = input.agentNames.map((name) => name.trim()).filter(Boolean);
  if (!seed || agentNames.length === 0) return null;

  let conversationId = "";
  try {
    const response = await host.agentServer.request({
      method: "POST",
      path: "/api/conversations",
      body: buildRelayConversationRequest(
        seed,
        input.workspaceId ?? "workspace/project",
        await getAgentProfileId(host, agentNames[0]),
      ),
    });
    const conversation = asObject(response);
    conversationId = conversation ? asString(conversation.id) ?? "" : "";
  } catch (error) {
    onHop({
      agent: agentNames[0],
      question: seed,
      response: "",
      status: "failed",
      error: error instanceof Error ? error.message : "Could not create relay conversation",
    }, 0, false);
    return null;
  }
  if (!conversationId) {
    onHop({
      agent: agentNames[0],
      question: seed,
      response: "",
      status: "failed",
      error: "Relay conversation has no id",
    }, 0, false);
    return null;
  }

  let stopped = false;
  let previousResponse = seed;
  const hopLimit = Math.max(1, Math.min(input.maxHops, agentNames.length));

  const stop = async (): Promise<void> => {
    stopped = true;
    try {
      await host.agentServer.request({
        method: "POST",
        path: `/api/conversations/${encodeURIComponent(conversationId)}/interrupt`,
      });
    } catch {
      // Stopping is best-effort; the local loop is stopped regardless.
    }
  };

  void (async () => {
    for (let index = 0; index < hopLimit && !stopped; index += 1) {
      const agent = agentNames[index];
      const question = previousResponse;
      onHop({ agent, question, response: "", status: "running" }, index, true);

      try {
        await host.agentServer.request({
          method: "POST",
          path: `/api/conversations/${encodeURIComponent(conversationId)}/switch_profile`,
          body: buildSwitchProfileRequest(agent),
        });

        if (input.useChildConversations) {
          const childResponse = await host.agentServer.request({
            method: "POST",
            path: `/api/conversations/${encodeURIComponent(conversationId)}/children`,
            body: buildChildConversationRequest(question),
          });
          const child = asObject(childResponse);
          const childConversationId = child ? asString(child.conversation_id) : undefined;
          const status = child ? asString(child.status) : undefined;
          const response = childConversationId
            ? `Child conversation ${childConversationId} started${status ? ` (${status})` : ""}.`
            : "Child conversation started.";
          previousResponse = response;
          onHop({
            agent,
            question,
            response,
            status: "completed",
            childConversationId,
          }, index, index < hopLimit - 1 && !stopped);
        } else {
          const answerResponse = await host.agentServer.request({
            method: "POST",
            path: `/api/conversations/${encodeURIComponent(conversationId)}/ask_agent`,
            body: buildAskAgentRequest(question),
          });
          const answer = asObject(answerResponse);
          const response = answer ? asString(answer.response) ?? "" : "";
          if (!response) throw new Error("Agent returned an empty response");
          previousResponse = response;
          onHop({
            agent,
            question,
            response,
            status: "completed",
          }, index, index < hopLimit - 1 && !stopped);
        }
      } catch (error) {
        onHop({
          agent,
          question,
          response: "",
          status: "failed",
          error: error instanceof Error ? error.message : "Relay hop failed",
        }, index, false);
        break;
      }

      if (index < hopLimit - 1 && !stopped) {
        await new Promise((resolve) => setTimeout(resolve, input.delayMs ?? 650));
      }
    }
  })();

  return { conversationId, stop };
}

export async function getAgentProfileId(host: Host, requestedId?: string): Promise<string | undefined> {
  try {
    const response = await host.agentServer.request({ method: "GET", path: "/api/agent-profiles" });
    const object = asObject(response);
    const profiles = object && Array.isArray(object.profiles)
      ? object.profiles.filter((item): item is Record<string, unknown> => !!asObject(item))
      : [];
    if (requestedId) {
      const exact = profiles.find((profile) => asString(profile.id) === requestedId
        || asString(profile.name) === requestedId);
      if (exact && asString(exact.id)) return asString(exact.id);
      if (/^[0-9a-f-]{36}$/i.test(requestedId)) return requestedId;
    }
    const activeId = object ? asString(object.active_agent_profile_id) : undefined;
    if (activeId) return activeId;
    const firstId = profiles.map((profile) => asString(profile.id)).find(Boolean);
    return firstId;
  } catch {
    return /^[0-9a-f-]{36}$/i.test(requestedId ?? "") ? requestedId : undefined;
  }
}

export function buildConversationRequest(input: OpenHandsCommandInput): Record<string, unknown> {
  const taskTitle = input.title ?? "Board task";
  // The agent prompt is the actual instruction sent to the AI. When present it
  // is used verbatim as the initial message. The title is only the business
  // identifier — it is never used as the prompt.
  const promptText = input.agentPrompt?.trim()
    ? input.agentPrompt.trim()
    : input.description?.trim()
      ? `${taskTitle}\n\n${input.description.trim()}`
      : taskTitle;
  // Structured execution-planning fields are appended as explicit sections so
  // the agent knows what to produce and how to verify it. They are only added
  // when present, so legacy tasks without them are unaffected.
  const sections: string[] = [];
  if (input.expectedOutput?.trim()) {
    sections.push(`Expected Output:\n${input.expectedOutput.trim()}`);
  }
  if (input.successCriteria?.trim()) {
    sections.push(`Success Criteria:\n${input.successCriteria.trim()}`);
  }
  const fullPrompt = sections.length > 0 ? `${promptText}\n\n${sections.join("\n\n")}` : promptText;
  const workspacePath = input.workspaceId ?? "workspace/project";
  const body: Record<string, unknown> = {
    workspace: {
      working_dir: workspacePath,
      kind: "LocalWorkspace",
    },
    initial_message: {
      role: "user",
      content: [{ type: "text", text: fullPrompt }],
      run: false,
    },
    autotitle: true,
    tags: {
      taskid: input.taskId ?? "",
      tasktitle: taskTitle,
      ...(input.agentId ? { agentid: input.agentId } : {}),
    },
  };
  return body;
}

/**
 * Map an OpenHands execution status onto the board's task lifecycle.
 *
 * OpenHands is the single source of truth for execution status. The board
 * column is a projection of it, defined once in executionStatusToColumn:
 *   queued/pending  -> todo
 *   running         -> in_progress
 *   completed       -> done
 *   failed/cancelled-> review (a failed or stopped run needs human attention)
 * A `boardstatus` tag set by the user (e.g. via drag-and-drop) is authoritative
 * for the column and is returned as-is; this mapping is only used when the
 * conversation carries no explicit boardstatus.
 */
function statusForConversation(
  conversation: Record<string, unknown>,
  tags: Record<string, string>,
): TaskStatus {
  const explicit = tags.boardstatus as TaskStatus | undefined;
  if (explicit && ["todo", "in_progress", "review", "done"].includes(explicit)) return explicit;
  // The execution status → column contract lives in executionStatusToColumn.
  return executionStatusToColumn(mapStatus(conversation.execution_status));
}

/**
 * Reconcile inbound OpenHands conversations into board tasks.
 *
 * `ignoreTaskIds` is the resurrection guard. A task that is being deleted (or
 * was deleted moments ago) must never be rebuilt from a conversation that is
 * still lingering in the search index — the conversation delete is eventually
 * consistent, so a stale entry can outlive the task's removal from disk. Any
 * conversation whose task id (or `oh-<id>` phantom id) is in the ignore set is
 * skipped AND best-effort deleted, so it cannot resurrect the card on this or
 * a later poll.
 */
export async function syncInboundConversations(host: Host, ignoreTaskIds?: ReadonlySet<string>): Promise<Task[]> {
  try {
    const response = await host.agentServer.request({
      method: "GET",
      path: "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC",
    });
    const conversations = conversationArray(response);
    if (conversations.length === 0) return fetchTasks(host);
    // The fetch → reconcile → save cycle is a read-modify-write against the
    // board file. Serialize it with the other board-file writers (create/move/
    // update/delete) so a concurrent mutation cannot be clobbered by a stale
    // snapshot — the exact race that dropped a freshly created task.
    return withBoardLock(async () => {
      // Collapse any duplicate task ids before reconciling. A duplicate id is
      // what renders the same card in two columns; deduping here also cleans
      // the board file on the next save (the `changed` flag below is set when
      // the list actually shrank).
      const fetched = await fetchTasks(host);
      const tasks = dedupeTasks(fetched);
      let changed = tasks.length !== fetched.length;

    // The search is sorted CREATED_AT_DESC, so the first conversation seen for a
    // given task is the newest. Reconcile identity and status from that newest
    // conversation only — older conversations for the same task must not clobber
    // the link (this is what previously pinned a task to a stale conversation).
    const seenTaskIds = new Set<string>();
    for (const conversation of conversations) {
      const id = asString(conversation.id);
      if (!id) continue;
      const tags = getConversationTags(conversation);
      // Resurrection guard: a conversation belonging to a task that is being
      // deleted (or was just deleted) must not rebuild that task. Skip it and
      // best-effort delete the stale conversation so it cannot resurrect the
      // card on this or a later poll.
      if (ignoreTaskIds) {
        const guardId = tags.taskid ?? `oh-${id}`;
        if (ignoreTaskIds.has(guardId) || ignoreTaskIds.has(id)) {
          void deleteConversation(host, id).catch(() => { /* already gone */ });
          continue;
        }
      }
      // The conversation title is the prompt (or an auto-generated title), NOT
      // the business title. The business title lives in tags.tasktitle. For
      // phantom tasks we prefer the tag; for existing tasks we never clobber
      // the title — it is the business identifier, not the AI instruction.
      const conversationTitle = asString(conversation.title) ?? "OpenHands conversation";
      const businessTitle = tags.tasktitle ?? conversationTitle;
      const profileId = asString(conversation.agent_profile_id)
        ?? asString(asObject(conversation.launched_agent_profile)?.agent_profile_id)
        ?? tags.agentprofileid
        ?? tags.agentid;
      let task = tags.taskid ? tasks.find((item) => item.id === tags.taskid) : undefined;
      if (!task) task = tasks.find((item) => item.conversationId === id);
      if (!task) {
        const status = statusForConversation(conversation, tags);
        task = {
          id: tags.taskid ?? `oh-${id}`,
          title: businessTitle,
          status,
          assignee: tags.assignee ?? null,
          projectId: tags.projectid ?? "default",
          waitingOn: null,
          conversationId: id,
          executionId: id,
          profileId: profileId ?? null,
          agentId: tags.agentprofileid ?? tags.agentid ?? null,
        };
        tasks.push(task);
        changed = true;
        if (tags.taskid) seenTaskIds.add(tags.taskid);
        continue;
      }
      // Only the newest conversation for a task reconciles identity/status.
      if (tags.taskid && seenTaskIds.has(tags.taskid)) continue;
      if (tags.taskid) seenTaskIds.add(tags.taskid);
      // Never overwrite the business title with the conversation title.
      if (task.conversationId !== id) { task.conversationId = id; changed = true; }
      if (task.executionId !== id) { task.executionId = id; changed = true; }
      if (profileId && task.profileId !== profileId) { task.profileId = profileId; changed = true; }
      if (tags.assignee && task.assignee !== tags.assignee) { task.assignee = tags.assignee; changed = true; }
      if (tags.agentprofileid && task.agentId !== tags.agentprofileid) { task.agentId = tags.agentprofileid; changed = true; }
      const status = statusForConversation(conversation, tags);
      if (task.status !== status) { task.status = status; changed = true; }
    }
    if (changed) await saveTasks(host, tasks);
    return tasks;
    });
  } catch {
    return fetchTasks(host);
  }
}

async function createConversation(
  host: Host,
  input: OpenHandsCommandInput,
): Promise<{ conversation: Record<string, unknown>; profileId?: string }> {
  const body = buildConversationRequest(input);
  const agentProfileId = await getAgentProfileId(host, input.agentId);
  if (agentProfileId) body.agent_profile_id = agentProfileId;
  const conversationTags = asObject(body.tags) ?? {};
  if (agentProfileId) conversationTags.agentprofileid = agentProfileId;
  body.tags = conversationTags;
  if (agentProfileId) body.agent_profile_id = agentProfileId;

  const response = await host.agentServer.request({
    method: "POST",
    path: "/api/conversations",
    body,
  });
  const conversation = asObject(response);
  if (!conversation) throw new Error("OpenHands did not return a conversation");
  return { conversation, profileId: agentProfileId };
}

/**
 * Persist the OpenHands execution identity and status onto a board task.
 *
 * OpenHands is the single source of truth for execution identity
 * (conversationId / executionId / profileId) and execution status. This is the
 * one place that writes those fields to the board, so the board never invents
 * its own identity — it always mirrors what OpenHands reports.
 *
 * The status is mapped onto the board's task lifecycle via the single source
 * of truth, executionStatusToColumn:
 *   queued/pending  -> todo
 *   running         -> in_progress
 *   completed       -> done
 *   failed/cancelled-> review (a failed or stopped run needs human attention)
 *
 * A `status` of `null` means "identity only" — the run was just created and is
 * about to be queued, so we pin the identity without forcing a column move yet.
 */
export async function recordExecution(
  host: Host,
  taskId: string,
  conversationId: string,
  profileId: string | undefined,
  status: OpenHandsExecution["status"] | null,
): Promise<void> {
  const patch: {
    conversationId: string;
    executionId: string;
    profileId?: string | null;
    status?: TaskStatus;
  } = { conversationId, executionId: conversationId };
  if (profileId) patch.profileId = profileId;
  if (status) patch.status = executionStatusToColumn(status);
  await updateTask(host, taskId, patch);
}

export async function commandExecution(
  host: Host,
  command: OpenHandsCommand,
  input: OpenHandsCommandInput,
): Promise<void> {
  if (command === "schedule") {
    if (input.taskId) setTaskOverlay(input.taskId, { scheduledAt: input.scheduledAt ?? null });
    if (input.taskId) await syncBoardAction(host, "updated", input.taskId, { scheduledAt: input.scheduledAt });
    return;
  }

  if (command === "stop") {
    if (!input.executionId) return;
    await host.agentServer.request({
      method: "POST",
      path: `/api/conversations/${encodeURIComponent(input.executionId)}/interrupt`,
    });
    return;
  }

  if (command === "retry") {
    let retryInput = { ...input };
    if (!retryInput.taskId && retryInput.executionId) {
      try {
        const original = await host.agentServer.request({
          method: "GET",
          path: `/api/conversations/${encodeURIComponent(retryInput.executionId)}`,
        });
        const conversation = asObject(original);
        if (conversation) {
          const tags = getConversationTags(conversation);
          retryInput = {
            ...retryInput,
            taskId: tags.taskid,
            title: asString(conversation.title) ?? tags.tasktitle,
            agentId: tags.agentprofileid ?? tags.agentid,
          };
        }
      } catch {
        // Retry still creates a fresh conversation when the original cannot be read.
      }
    }
    const { conversation, profileId } = await createConversation(host, retryInput);
    const conversationId = asString(conversation.id);
    if (conversationId) {
      // Persist the new execution identity immediately so the board mirrors
      // OpenHands the moment the run is created, not only after the next poll.
      if (retryInput.taskId) {
        await recordExecution(host, retryInput.taskId, conversationId, profileId, "queued");
      }
      await host.agentServer.request({
        method: "POST",
        path: `/api/conversations/${encodeURIComponent(conversationId)}/run`,
      });
    }
    return;
  }

  // Reuse the task's existing conversation whenever one is already linked. This
  // is what keeps an edited task on the SAME conversation it was first created
  // in — only a task with no conversation yet falls through to createConversation.
  if (input.executionId) {
    if (input.taskId) {
      // Re-pin the identity and move the task to in_progress immediately, so the
      // board reflects the re-run before the next inbound poll.
      await recordExecution(host, input.taskId, input.executionId, undefined, "queued");
    }
    await host.agentServer.request({
      method: "POST",
      path: `/api/conversations/${encodeURIComponent(input.executionId)}/run`,
    });
    return;
  }

  const { conversation, profileId } = await createConversation(host, input);
  const conversationId = asString(conversation.id);
  if (!conversationId) throw new Error("OpenHands conversation has no id");
  // Persist the execution identity immediately so the board mirrors OpenHands
  // the moment the run is created, not only after the next inbound poll.
  if (input.taskId) {
    await recordExecution(host, input.taskId, conversationId, profileId, "queued");
  }
  await host.agentServer.request({
    method: "POST",
    path: `/api/conversations/${encodeURIComponent(conversationId)}/run`,
  });
}

/**
 * Delete a live OpenHands conversation by its raw conversation id.
 *
 * Called from the board's delete flow so that removing a task also removes the
 * conversation that `syncInboundConversations` would otherwise resurrect on the
 * next load(). The task's `conversationId` field holds the raw conversation id
 * (no `oh-` prefix), so this is a direct DELETE. A 404 (already gone) is
 * swallowed — the conversation is already absent, which is the desired state.
 */
export async function deleteConversation(host: Host, conversationId: string): Promise<void> {
  try {
    await host.agentServer.request({
      method: "DELETE",
      path: `/api/conversations/${encodeURIComponent(conversationId)}`,
    });
  } catch (error) {
    // A 404 means the conversation is already gone — the desired end state.
    // Swallow it so a stale/phantom conversationId (the task's conversation was
    // already deleted) doesn't surface as a visible error during task delete.
    if (error && (error as { status?: number }).status === 404) return;
    throw error;
  }
}

/**
 * Verify that an OpenHands conversation is actually gone from the backend.
 *
 * A DELETE can return success while the conversation is still being torn down
 * (or the delete is eventually consistent). This polls `GET /api/conversations/{id}`
 * until it 404s (gone) or a hard error surfaces. Returns true when the
 * conversation is confirmed absent, false when it is still present after the
 * retry budget is exhausted.
 *
 * Used by the transaction-based delete flow so the board card only fades away
 * once the conversation is verifiably gone — never before.
 */
export async function verifyConversationGone(
  host: Host,
  conversationId: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = Math.max(1, options?.attempts ?? 5);
  const delayMs = Math.max(0, options?.delayMs ?? 400);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await host.agentServer.request({
        method: "GET",
        path: `/api/conversations/${encodeURIComponent(conversationId)}`,
      });
      // A 200 means the conversation still exists — wait and retry.
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return false;
    } catch (error) {
      // A 404 means the conversation is gone — the desired end state.
      if (error && (error as { status?: number }).status === 404) return true;
      // Any other error (network, 5xx) is treated as "not yet confirmed gone";
      // the caller decides whether to surface it. We keep retrying.
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      return false;
    }
  }
  return false;
}

/**
 * Create an OpenHands conversation for a board task BEFORE the task is
 * persisted to disk. The conversation carries the task id in its tags so
 * `syncInboundConversations` can link them. Returns the conversation id, or
 * null if the conversation could not be created.
 *
 * This is the first step of the "card appears only after conversation exists"
 * lifecycle: the conversation is created first, and only if it succeeds is the
 * task written to the board file.
 */
export async function createConversationForTask(
  host: Host,
  taskId: string,
  details: { title?: string; description?: string; agentPrompt?: string; expectedOutput?: string; successCriteria?: string; agentId?: string },
): Promise<string | null> {
  const body = buildConversationRequest({
    taskId,
    title: details.title ?? "Board task",
    description: details.description,
    agentPrompt: details.agentPrompt,
    expectedOutput: details.expectedOutput,
    successCriteria: details.successCriteria,
    agentId: details.agentId,
  });
  const agentProfileId = await getAgentProfileId(host, details.agentId);
  if (agentProfileId) {
    body.agent_profile_id = agentProfileId;
    const tags = asObject(body.tags) ?? {};
    tags.agentprofileid = agentProfileId;
    body.tags = tags;
  }
  const response = await host.agentServer.request({
    method: "POST",
    path: "/api/conversations",
    body,
  });
  const conversation = asObject(response);
  return conversation ? asString(conversation.id) ?? null : null;
}

export async function syncBoardAction(
  host: Host,
  action: "created" | "updated" | "moved" | "deleted",
  taskId: string,
  details?: Record<string, unknown>,
): Promise<string | null> {
  const entry: Record<string, unknown> & { id: string; action: typeof action; taskId: string; at: number } =
    { id: `${taskId}-${Date.now()}`, action, taskId, at: Date.now(), ...details };

  try {
    if (action === "created") {
      // The agent server rejects a conversation POST that carries none of
      // `agent`, `agent_settings`, or `agent_profile_id` (HTTP 422). Resolve the
      // profile id from the requested agent name before posting, mirroring
      // createConversation, so the board->OpenHands sync actually succeeds.
      const body = buildConversationRequest({
        taskId,
        title: asString(details?.title) ?? "Board task",
        description: asString(details?.description),
        agentPrompt: asString(details?.agentPrompt),
        expectedOutput: asString(details?.expectedOutput),
        successCriteria: asString(details?.successCriteria),
        agentId: asString(details?.agentId),
      });
      const agentProfileId = await getAgentProfileId(host, asString(details?.agentId));
      if (agentProfileId) {
        body.agent_profile_id = agentProfileId;
        const tags = asObject(body.tags) ?? {};
        tags.agentprofileid = agentProfileId;
        body.tags = tags;
      }
      const response = await host.agentServer.request({
        method: "POST",
        path: "/api/conversations",
        body,
      });
      const conversation = asObject(response);
      const conversationId = conversation ? asString(conversation.id) : undefined;
      if (conversationId) {
        entry.conversationId = conversationId;
        return conversationId;
      }
    }
    const response = await host.agentServer.request({
      method: "GET",
      path: "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC",
    });
    for (const conversation of conversationArray(response)) {
      const tags = getConversationTags(conversation);
      if (tags.taskid !== taskId) continue;
      const conversationId = asString(conversation.id);
      if (!conversationId) continue;
      if (action === "deleted") {
        await host.agentServer.request({
          method: "DELETE",
          path: `/api/conversations/${encodeURIComponent(conversationId)}`,
        }).catch(() => undefined);
        continue;
      }
      await host.agentServer.request({
        method: "PATCH",
        path: `/api/conversations/${encodeURIComponent(conversationId)}`,
        body: {
          title: asString(details?.title) ?? asString(conversation.title),
          tags: {
            ...tags,
            taskid: taskId,
            ...(details?.status ? { boardstatus: asString(details.status) } : {}),
            ...(details?.assignee ? { assignee: asString(details.assignee) ?? "" } : {}),
          },
        },
      }).catch(() => undefined);
    }
  } catch {
    // Conversation metadata is optional; board CRUD remains independent.
  }
  return null;
}

export class OpenHandsStateStore {
  private state: OpenHandsState = { snapshot: EMPTY_SNAPSHOT, loading: true, error: null, lastSyncedAt: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly host: Host;
  /**
   * Reset baseline. When set, only executions started at or after this
   * timestamp are surfaced. This is what makes "Reset Metrics" / "Reset
   * History" meaningful: the snapshot is re-fetched from the live agent server
   * on every poll, so a plain clear would be undone on the next refresh. The
   * baseline survives polling and re-applies on each fetch.
   */
  private resetAt: number | null = null;
  /**
   * Fingerprint of the last snapshot we actually surfaced. The 2-second poll
   * re-fetches the snapshot on every tick; when the content is unchanged we
   * skip the notify so the board does not re-render. See snapshotFingerprint.
   */
  private lastFingerprint: string | null = null;
  private readonly handleFocus = (): void => {
    void this.refresh();
  };
  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === "visible") void this.refresh();
  };

  constructor(host: Host) {
    this.host = host;
    window.addEventListener("focus", this.handleFocus);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_INTERVAL_MS);
  }

  get = (): OpenHandsState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * Clear the surfaced executions and set the reset baseline to "now".
   * Executions started before this moment are hidden from the Analytics and
   * History views until the next reset. The baseline is re-applied on every
   * poll, so the reset persists across the 15s refresh cycle.
   */
  reset = (): void => {
    this.resetAt = Date.now();
    this.state = {
      snapshot: { ...EMPTY_SNAPSHOT, updatedAt: Date.now() },
      loading: false,
      error: null,
      lastSyncedAt: Date.now(),
    };
    for (const listener of this.listeners) listener();
  };

  async refresh(): Promise<void> {
    if (this.disposed) return;
    try {
      const snapshot = await fetchOpenHandsSnapshot(this.host);
      const resetAt = this.resetAt;
      const executions = resetAt
        ? snapshot.executions.filter((execution) => (execution.startedAt ?? 0) >= resetAt)
        : snapshot.executions;
      const nextSnapshot: OpenHandsSnapshot = { ...snapshot, executions, updatedAt: Date.now() };
      const fingerprint = snapshotFingerprint(nextSnapshot);
      const prev = this.state;
      // Content-aware notify: the snapshot's `updatedAt` is refreshed on every
      // poll, so a naive object comparison would always differ and the board
      // would re-render 30 times a minute for no reason. We only replace the
      // state and notify when the *content* (executions/events/links) changed,
      // or when the loading/error flag flipped. An unchanged poll is a no-op.
      const contentChanged = fingerprint !== this.lastFingerprint;
      const flagChanged = prev.loading !== false || prev.error !== null;
      if (!contentChanged && !flagChanged) {
        // Nothing to surface — keep the existing state object so React's
        // useSyncExternalStore sees an identical reference and skips the render.
        return;
      }
      this.lastFingerprint = fingerprint;
      this.state = {
        snapshot: nextSnapshot,
        loading: false,
        error: null,
        lastSyncedAt: Date.now(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenHands agent server unavailable";
      const prev = this.state;
      // Only notify when the error/loading state actually changed, so a
      // repeated failure on every poll does not re-render the board.
      if (prev.error === message && prev.loading === false) return;
      this.state = {
        ...prev,
        loading: false,
        error: message,
      };
    }
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener("focus", this.handleFocus);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.listeners.clear();
  }
}

export function useOpenHandsState(host: Host): { state: OpenHandsState; reset: () => void } {
  const [store] = useState(() => new OpenHandsStateStore(host));
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => () => store.dispose(), [store]);
  return { state, reset: store.reset };
}
