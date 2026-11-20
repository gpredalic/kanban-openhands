/**
 * AI configuration store.
 *
 * Execution state is owned exclusively by OpenHands. This store contains only
 * routing/profile/workflow configuration and task overlays.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type { AiConfig, AiState, EnrichedTask, TaskAiOverlay } from "../types/ai";
import type { Host } from "../types/task";
import { fetchRoutingRules, loadAiConfig, loadAiOverlay, saveAiConfig, saveRoutingRules, setTaskAiOverlay } from "./ai-overlay";
import { fetchWorkflows, saveWorkflows } from "./workflow-store";

type Listener = () => void;

export class AiStateStore {
  private state: AiState;
  private listeners = new Set<Listener>();
  private tasks: EnrichedTask[] = [];
  private host: Host | null = null;

  constructor() {
    this.state = {
      config: loadAiConfig(),
      overlay: loadAiOverlay(),
    };
  }

  get(): AiState {
    return this.state;
  }

  setTasks(tasks: EnrichedTask[]): void {
    this.tasks = tasks;
  }

  setHost(host: Host): void {
    this.host = host;
  }

  async loadFileWorkflows(): Promise<void> {
    if (!this.host) return;
    const workflows = await fetchWorkflows(this.host);
    const routingRules = await fetchRoutingRules(this.host);
    if (workflows.length > 0) {
      this.state = {
        ...this.state,
        config: { ...this.state.config, workflows, routingRules: routingRules.length > 0 ? routingRules : this.state.config.routingRules },
      };
      saveAiConfig(this.state.config);
      this.notify();
    } else if (routingRules.length > 0) {
      this.state = { ...this.state, config: { ...this.state.config, routingRules } };
      saveAiConfig(this.state.config);
      this.notify();
    }
  }

  setConfig(config: AiConfig): void {
    this.state = { ...this.state, config };
    saveAiConfig(config);
    if (this.host) {
      void saveWorkflows(this.host, config.workflows).catch((error: unknown) => {
        console.error("[kanban-board] failed to persist workflows:", error);
      });
      void saveRoutingRules(this.host, config.routingRules).catch((error: unknown) => {
        console.error("[kanban-board] failed to persist routing rules:", error);
      });
    }
    this.notify();
  }

  setTaskAi(taskId: string, patch: Partial<TaskAiOverlay>): void {
    const overlay = setTaskAiOverlay(taskId, patch);
    this.state = { ...this.state, overlay };
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, ai: { ...task.ai, ...patch } } : task,
    );
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export interface AiApi {
  state: AiState;
  store: AiStateStore;
}

export function useAiState(host: Host): AiApi {
  const [store] = useState(() => new AiStateStore());
  useEffect(() => {
    store.setHost(host);
    void store.loadFileWorkflows();
  }, [host, store]);
  const state = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => store.get(),
  );
  useEffect(() => () => store.dispose(), [store]);
  return { state, store };
}

export { loadAiOverlay };
