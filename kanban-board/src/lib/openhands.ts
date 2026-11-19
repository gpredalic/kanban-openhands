import { useEffect, useState, useSyncExternalStore } from "react";
import type { Host } from "../types/task";
import type {
  OpenHandsEvent,
  OpenHandsExecution,
  OpenHandsLink,
  OpenHandsSnapshot,
  OpenHandsState,
} from "../types/openhands";

const POLL_INTERVAL_MS = 10_000;
const EMPTY_SNAPSHOT: OpenHandsSnapshot = { executions: [], events: [], links: [], updatedAt: 0 };

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  const object = asObject(value);
  return object && Array.isArray(object[key]) ? object[key] as T[] : [];
}

export function normalizeSnapshot(value: unknown): OpenHandsSnapshot {
  const object = asObject(value);
  return {
    executions: asArray<OpenHandsExecution>(value, "executions"),
    events: asArray<OpenHandsEvent>(value, "events"),
    links: asArray<OpenHandsLink>(value, "links"),
    updatedAt: typeof object?.updatedAt === "number" ? object.updatedAt : Date.now(),
  };
}

export async function fetchOpenHandsSnapshot(host: Host): Promise<OpenHandsSnapshot> {
  const response = await host.agentServer.request({
    method: "GET",
    path: "/api/openhands/observability",
  });
  return normalizeSnapshot(response);
}

export type OpenHandsCommand = "start" | "stop" | "retry" | "schedule";

export async function commandExecution(
  host: Host,
  command: OpenHandsCommand,
  input: { taskId?: string; executionId?: string; agentId?: string; modelId?: string; title?: string },
): Promise<void> {
  await host.agentServer.request({
    method: "POST",
    path: `/api/openhands/executions/${command}`,
    body: input,
  });
}

export async function syncBoardAction(
  host: Host,
  action: "created" | "updated" | "moved" | "deleted",
  taskId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await host.agentServer.request({
    method: "POST",
    path: `/api/openhands/board-events`,
    body: { action, taskId, ...details },
  });
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
        error: error instanceof Error ? error.message : "OpenHands observability unavailable",
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
