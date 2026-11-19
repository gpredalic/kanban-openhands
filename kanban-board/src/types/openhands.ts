/** OpenHands activity mirrored into the board command center. */
export type OpenHandsEventType =
  | "conversation"
  | "execution"
  | "tool"
  | "repository"
  | "commit"
  | "pull_request"
  | "review"
  | "error"
  | "task";

export interface OpenHandsEvent {
  id: string;
  type: OpenHandsEventType;
  title: string;
  detail?: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  at: number;
  taskId?: string;
  executionId?: string;
  agentId?: string;
  modelId?: string;
  repository?: string;
  url?: string;
}

export interface OpenHandsExecution {
  id: string;
  taskId?: string;
  title: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  agentId?: string;
  modelId?: string;
  repository?: string;
  startedAt?: number;
  finishedAt?: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  error?: string;
}

export interface OpenHandsLink {
  from: { id: string; label: string; kind: "task" | "agent" | "model" | "repository" | "conversation" | "execution" };
  to: { id: string; label: string; kind: "task" | "agent" | "model" | "repository" | "conversation" | "execution" };
  relation: string;
}

export interface OpenHandsSnapshot {
  executions: OpenHandsExecution[];
  events: OpenHandsEvent[];
  links: OpenHandsLink[];
  updatedAt: number;
}

export interface OpenHandsState {
  snapshot: OpenHandsSnapshot;
  loading: boolean;
  error: string | null;
}
