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
import { fetchTasks, saveTasks, updateTask } from "./task-store";

const POLL_INTERVAL_MS = 2_000;
const EMPTY_SNAPSHOT: OpenHandsSnapshot = { executions: [], events: [], links: [], updatedAt: 0 };

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
  if (status === "running" || status === "waiting_for_confirmation") return "running";
  if (status === "finished" || status === "succeeded" || status === "success" || status === "completed") return "completed";
  if (status === "error" || status === "stuck" || status === "failed") return "failed";
  if (status === "deleting" || status === "cancelled" || status === "canceled") return "cancelled";
  if (status === "paused") return "queued";
  return "queued";
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
          title: asString(event.title) ?? asString(event.key) ?? kind,
          detail: eventDetail(event),
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
  workspaceId?: string;
  scheduledAt?: string;
}

export interface AgentProfile {
  id: string;
  name: string;
}

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
    return object.profiles
      .filter((item): item is Record<string, unknown> => !!asObject(item))
      .map((profile) => ({
        id: asString(profile.id) ?? asString(profile.name) ?? asString(profile.profile_name) ?? "",
        name: asString(profile.name) ?? asString(profile.profile_name) ?? "",
      }))
      .filter((profile) => profile.id && profile.name);
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
  const taskText = input.description ? `${taskTitle}\n\n${input.description}` : taskTitle;
  const workspacePath = input.workspaceId ?? "workspace/project";
  const body: Record<string, unknown> = {
    workspace: {
      working_dir: workspacePath,
      kind: "LocalWorkspace",
    },
    initial_message: {
      role: "user",
      content: [{ type: "text", text: taskText }],
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
 * column is a projection of it:
 *   queued/running  -> in_progress
 *   completed       -> done
 *   failed/cancelled-> review (a failed run needs human attention)
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
  const status = mapStatus(conversation.execution_status);
  if (status === "queued" || status === "running") return "in_progress";
  if (status === "completed") return "done";
  if (status === "failed" || status === "cancelled") return "review";
  return "todo";
}

export async function syncInboundConversations(host: Host): Promise<Task[]> {
  try {
    const response = await host.agentServer.request({
      method: "GET",
      path: "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC",
    });
    const conversations = conversationArray(response);
    if (conversations.length === 0) return fetchTasks(host);
    const tasks = await fetchTasks(host);
    let changed = false;

    // The search is sorted CREATED_AT_DESC, so the first conversation seen for a
    // given task is the newest. Reconcile identity and status from that newest
    // conversation only — older conversations for the same task must not clobber
    // the link (this is what previously pinned a task to a stale conversation).
    const seenTaskIds = new Set<string>();
    for (const conversation of conversations) {
      const id = asString(conversation.id);
      if (!id) continue;
      const tags = getConversationTags(conversation);
      const title = asString(conversation.title) ?? tags.tasktitle ?? "OpenHands conversation";
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
          title,
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
      if (task.title !== title) { task.title = title; changed = true; }
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
 * The status is mapped onto the board's task lifecycle:
 *   queued/running  -> in_progress
 *   completed       -> done
 *   failed/cancelled-> review (a failed run needs human attention)
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
  if (status === "queued" || status === "running") patch.status = "in_progress";
  else if (status === "completed") patch.status = "done";
  else if (status === "failed" || status === "cancelled") patch.status = "review";
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

  if (input.executionId && !input.taskId) {
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

  async refresh(): Promise<void> {
    if (this.disposed) return;
    try {
      const snapshot = await fetchOpenHandsSnapshot(this.host);
      this.state = { snapshot, loading: false, error: null, lastSyncedAt: Date.now() };
    } catch (error) {
      this.state = {
        ...this.state,
        loading: false,
        error: error instanceof Error ? error.message : "OpenHands agent server unavailable",
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

export function useOpenHandsState(host: Host): OpenHandsState {
  const [store] = useState(() => new OpenHandsStateStore(host));
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => () => store.dispose(), [store]);
  return state;
}
