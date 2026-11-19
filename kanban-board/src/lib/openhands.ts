import { useEffect, useState, useSyncExternalStore } from "react";
import type { Host } from "../types/task";
import type {
  OpenHandsEvent,
  OpenHandsExecution,
  OpenHandsLink,
  OpenHandsSnapshot,
  OpenHandsState,
} from "../types/openhands";
import { setTaskOverlay } from "./task-overlay";

const POLL_INTERVAL_MS = 10_000;
const EMPTY_SNAPSHOT: OpenHandsSnapshot = { executions: [], events: [], links: [], updatedAt: 0 };
const ACTIVITY_KEY = "kanban-board.openhands-activity.v1";

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
  if (status === "finished" || status === "succeeded" || status === "success" || status === "completed") return "succeeded";
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

function conversationMetrics(conversation: Record<string, unknown>): { tokensIn: number; tokensOut: number; cost: number } {
  const stats = asObject(conversation.stats) ?? {};
  const metrics = asObject(conversation.metrics) ?? {};
  const accumulated = asObject(metrics.accumulated_token_usage);
  const cost = asNumber(metrics.accumulated_cost)
    || asNumber(stats.cost)
    || asNumber(stats.total_cost)
    || asNumber(stats.accumulated_cost);
  const tokensIn = asNumber(accumulated?.prompt_tokens)
    || asNumber(stats.prompt_tokens)
    || asNumber(stats.tokens_in)
    || asNumber(stats.input_tokens);
  const tokensOut = asNumber(accumulated?.completion_tokens)
    || asNumber(stats.completion_tokens)
    || asNumber(stats.tokens_out)
    || asNumber(stats.output_tokens);
  return { tokensIn, tokensOut, cost };
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
  for (const key of ["detail", "message", "content", "text", "observation", "action"]) {
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
    return {
      id: asString(conversation.id) ?? "",
      taskId: tags.task_id,
      title: asString(conversation.title) ?? tags.task_title ?? "OpenHands conversation",
      status,
      agentId: tags.agent_profile_id ?? tags.agent_id ?? asString(conversation.agent_profile_id),
      modelId: asString(conversation.current_model_id),
      repository: tags.repository,
      startedAt: createdAt,
      finishedAt: status === "succeeded" || status === "failed" || status === "cancelled" ? updatedAt : undefined,
      tokensIn: metrics.tokensIn,
      tokensOut: metrics.tokensOut,
      cost: metrics.cost,
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
  let response: unknown;
  try {
    response = await host.agentServer.request({ method: "GET", path: "/api/conversations" });
  } catch (error) {
    try {
      response = await host.agentServer.request({
        method: "GET",
        path: "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC",
      });
    } catch {
      throw error;
    }
  }

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
        const kind = asString(event.kind) ?? asString(event.type) ?? "execution";
        const eventId = asString(event.id) ?? asString(event.event_id) ?? `${conversationId}-${kind}-${timestamp(event.timestamp)}`;
        events.push({
          id: eventId,
          type: eventType(kind),
          title: asString(event.title) ?? kind,
          detail: eventDetail(event),
          status: mapStatus(conversation.execution_status),
          at: timestamp(event.timestamp, timestamp(conversation.created_at)),
          taskId: tags.task_id,
          executionId: conversationId,
          agentId: tags.agent_profile_id ?? tags.agent_id,
          modelId: asString(conversation.current_model_id),
        });
      }
    } catch {
      // A missing event endpoint or an interrupted conversation must not fail observability.
    }
  }

  events.sort((a, b) => b.at - a.at);
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const stored = raw ? JSON.parse(raw) : [];
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        const object = asObject(entry);
        if (!object) continue;
        const action = asString(object.action);
        const taskId = asString(object.taskId);
        if (!action || !taskId) continue;
        events.push({
          id: asString(object.id) ?? `${taskId}-${timestamp(object.at)}`,
          type: "task",
          title: `Board task ${action}`,
          detail: asString(object.title) ?? asString(object.status) ?? `Task ${taskId}`,
          at: timestamp(object.at),
          taskId,
        });
      }
    }
  } catch {
    // Local activity is optional.
  }
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
  status: "running" | "succeeded" | "failed";
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
        id: asString(profile.id) ?? "",
        name: asString(profile.name) ?? asString(profile.profile_name) ?? "",
      }))
      .filter((profile) => profile.id && profile.name);
  } catch {
    return [];
  }
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
      body: {
        workspace: { type: "local", id: input.workspaceId ?? "workspace/project" },
        initial_message: { message: seed },
        agent_profile_id: await getAgentProfileId(host, agentNames[0]),
        autotitle: true,
        tags: { relay: "true" },
      },
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
          body: { profile_name: agent },
        });

        if (input.useChildConversations) {
          const childResponse = await host.agentServer.request({
            method: "POST",
            path: `/api/conversations/${encodeURIComponent(conversationId)}/children`,
            body: { task: question },
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
            status: "succeeded",
            childConversationId,
          }, index, index < hopLimit - 1 && !stopped);
        } else {
          const answerResponse = await host.agentServer.request({
            method: "POST",
            path: `/api/conversations/${encodeURIComponent(conversationId)}/ask_agent`,
            body: { question },
          });
          const answer = asObject(answerResponse);
          const response = answer ? asString(answer.response) ?? "" : "";
          if (!response) throw new Error("Agent returned an empty response");
          previousResponse = response;
          onHop({
            agent,
            question,
            response,
            status: "succeeded",
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

async function getAgentProfileId(host: Host, requestedId?: string): Promise<string | undefined> {
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

async function createConversation(host: Host, input: OpenHandsCommandInput): Promise<Record<string, unknown>> {
  const taskTitle = input.title ?? "Board task";
  const taskText = input.description ? `${taskTitle}\n\n${input.description}` : taskTitle;
  const workspacePath = input.workspaceId ?? "workspace/project";
  const agentProfileId = await getAgentProfileId(host, input.agentId);
  const body: Record<string, unknown> = {
    workspace: {
      type: "local",
      id: workspacePath,
      kind: "LocalWorkspace",
      working_dir: workspacePath,
    },
    initial_message: {
      message: taskText,
      role: "user",
      content: [{ type: "text", text: taskText }],
      run: false,
    },
    autotitle: true,
    tags: {
      task_id: input.taskId ?? "",
      task_title: taskTitle,
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      ...(agentProfileId ? { agent_profile_id: agentProfileId } : {}),
    },
  };
  if (agentProfileId) body.agent_profile_id = agentProfileId;

  const response = await host.agentServer.request({
    method: "POST",
    path: "/api/conversations",
    body,
  });
  const conversation = asObject(response);
  if (!conversation) throw new Error("OpenHands did not return a conversation");
  return conversation;
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
            taskId: tags.task_id,
            title: asString(conversation.title) ?? tags.task_title,
            agentId: tags.agent_profile_id ?? tags.agent_id,
          };
        }
      } catch {
        // Retry still creates a fresh conversation when the original cannot be read.
      }
    }
    const conversation = await createConversation(host, retryInput);
    const conversationId = asString(conversation.id);
    if (conversationId) {
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

  const conversation = await createConversation(host, input);
  const conversationId = asString(conversation.id);
  if (!conversationId) throw new Error("OpenHands conversation has no id");
  await host.agentServer.request({
    method: "POST",
    path: `/api/conversations/${encodeURIComponent(conversationId)}/run`,
  });
}

const localBoardEvents: Array<Record<string, unknown>> = [];

export async function syncBoardAction(
  host: Host,
  action: "created" | "updated" | "moved" | "deleted",
  taskId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const entry = { id: `${taskId}-${Date.now()}`, action, taskId, at: Date.now(), ...details };
  localBoardEvents.push(entry);
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const stored = raw ? JSON.parse(raw) : [];
    const events = Array.isArray(stored) ? [...stored, entry].slice(-200) : [entry];
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(events));
  } catch {
    // Local activity is best-effort and must never block board CRUD.
  }

  if (action === "deleted") return;
  try {
    const response = await host.agentServer.request({
      method: "GET",
      path: "/api/conversations/search?limit=100&sort_order=CREATED_AT_DESC",
    });
    for (const conversation of conversationArray(response)) {
      const tags = getConversationTags(conversation);
      if (tags.task_id !== taskId) continue;
      const conversationId = asString(conversation.id);
      if (!conversationId) continue;
      await host.agentServer.request({
        method: "PATCH",
        path: `/api/conversations/${encodeURIComponent(conversationId)}`,
        body: {
          title: asString(details?.title) ?? asString(conversation.title),
          tags: {
            ...tags,
            task_id: taskId,
            ...(details?.status ? { board_status: asString(details.status) } : {}),
            ...(details?.assignee ? { assignee: asString(details.assignee) ?? "" } : {}),
          },
        },
      }).catch(() => undefined);
    }
  } catch {
    // Conversation metadata is optional; board CRUD remains independent.
  }
}

export class OpenHandsStateStore {
  private state: OpenHandsState = { snapshot: EMPTY_SNAPSHOT, loading: true, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly host: Host) {
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
      this.state = { snapshot, loading: false, error: null };
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
    this.listeners.clear();
  }
}

export function useOpenHandsState(host: Host): OpenHandsState {
  const [store] = useState(() => new OpenHandsStateStore(host));
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => () => store.dispose(), [store]);
  return state;
}
