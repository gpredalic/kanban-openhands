/**
 * ai-store.ts — observable AI state store + the orchestration execution loop.
 *
 * Holds the AI config (agents, models, teams, rules, workflows) and the live
 * execution state (active runs, history, totals). The execution loop is a
 * setInterval that, on each tick:
 *   1. Finds ready tasks (dependencies satisfied, not done, not already running).
 *   2. Resolves routing for each and creates a run if the agent has capacity.
 *   3. Advances in-flight runs toward completion.
 *   4. Records finished runs in history and updates the task's AI overlay.
 *
 * The loop is deterministic enough to test (it's driven by the store's tick
 * method, not a real timer in tests) and safe to start/stop.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  AiConfig,
  AiState,
  EnrichedTask,
  ExecutionRun,
  TaskAiOverlay,
} from "../types/ai";
import {
  advanceRun,
  createRun,
  readyTaskIds,
  resolveExecution,
  sumRuns,
} from "./ai-engine";
import { loadAiConfig, loadAiOverlay, saveAiConfig, setTaskAiOverlay } from "./ai-overlay";

type Listener = () => void;

/** How often the orchestration loop ticks (ms). */
const TICK_MS = 1200;

/** The AI state store. */
export class AiStateStore {
  private state: AiState;
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** The current task list, set by the board so the loop knows what to run. */
  private tasks: EnrichedTask[] = [];

  constructor() {
    this.state = {
      config: loadAiConfig(),
      execution: {
        running: false,
        activeRuns: [],
        history: [],
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCost: 0,
      },
      overlay: loadAiOverlay(),
    };
  }

  get(): AiState {
    return this.state;
  }

  /** Set the current task list (called by the board on every data load). */
  setTasks(tasks: EnrichedTask[]): void {
    this.tasks = tasks;
  }

  /** Update the AI config and persist it. */
  setConfig(config: AiConfig): void {
    this.state = { ...this.state, config };
    saveAiConfig(config);
    this.notify();
  }

  /** Update a single task's AI overlay (agent, model, deps, etc.). */
  setTaskAi(taskId: string, patch: Partial<TaskAiOverlay>): void {
    const overlay = setTaskAiOverlay(taskId, patch);
    this.state = { ...this.state, overlay };
    // Reflect the change in the in-memory task list so the UI updates.
    this.tasks = this.tasks.map((t) =>
      t.id === taskId ? { ...t, ai: { ...t.ai, ...patch } } : t,
    );
    this.notify();
  }

  /** Start the orchestration loop. */
  start(): void {
    if (this.timer) return;
    this.state = { ...this.state, execution: { ...this.state.execution, running: true } };
    this.notify();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Stop the orchestration loop. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.state = { ...this.state, execution: { ...this.state.execution, running: false } };
    this.notify();
  }

  /**
   * One orchestration tick. Pure-ish: reads the current tasks + config, creates
   * and advances runs, updates the store. Exposed so tests can drive it
   * synchronously without waiting on the real timer.
   */
  tick(): void {
    const { config, execution } = this.state;
    const active = execution.activeRuns;

    // 1. Advance in-flight runs. A run completes after it has been "running"
    //    for at least one tick (we track this by log length).
    const stillActive: ExecutionRun[] = [];
    const finished: ExecutionRun[] = [];
    for (const run of active) {
      if (run.status === "queued") {
        stillActive.push(advanceRun(run, 0));
      } else if (run.status === "running") {
        // Complete the run on the next tick after it started.
        if (run.log.length >= 2) {
          finished.push(advanceRun(run, 1));
        } else {
          stillActive.push(run);
        }
      } else {
        finished.push(run);
      }
    }

    // 2. Record finished runs in history and update the task overlay.
    for (const run of finished) {
      this.recordRun(run);
    }

    // 3. Create new runs for ready tasks that have capacity.
    const runningByAgent = new Map<string, number>();
    for (const run of stillActive) {
      runningByAgent.set(run.agentId, (runningByAgent.get(run.agentId) ?? 0) + 1);
    }
    const ready = readyTaskIds(this.tasks);
    const alreadyRunning = new Set(stillActive.map((r) => r.taskId));
    for (const task of this.tasks) {
      if (!ready.has(task.id)) continue;
      if (task.status === "done") continue;
      if (alreadyRunning.has(task.id)) continue;
      const { agent } = resolveExecution(task, config);
      if (!agent) continue;
      const running = runningByAgent.get(agent.id) ?? 0;
      if (running >= agent.maxConcurrent) continue;
      const run = createRun(task, config);
      if (run) {
        stillActive.push(run);
        runningByAgent.set(agent.id, running + 1);
      }
    }

    // 4. Update the store.
    const totals = sumRuns([...finished, ...execution.history]);
    this.state = {
      ...this.state,
      execution: {
        ...execution,
        activeRuns: stillActive,
        history: [...finished, ...execution.history].slice(0, 50),
        totalTokensIn: totals.tokensIn,
        totalTokensOut: totals.tokensOut,
        totalCost: totals.cost,
      },
    };
    this.notify();
  }

  /** Record a finished run: push to history and update the task's AI overlay. */
  private recordRun(run: ExecutionRun): void {
    const task = this.tasks.find((t) => t.id === run.taskId);
    if (task) {
      const patch: Partial<TaskAiOverlay> = {
        executionStatus: run.status,
        lastRunAt: run.finishedAt ?? Date.now(),
        tokensIn: (task.ai.tokensIn ?? 0) + run.tokensIn,
        tokensOut: (task.ai.tokensOut ?? 0) + run.tokensOut,
        cost: (task.ai.cost ?? 0) + run.cost,
      };
      const overlay = setTaskAiOverlay(task.id, patch);
      this.state = { ...this.state, overlay };
      this.tasks = this.tasks.map((t) =>
        t.id === task.id ? { ...t, ai: { ...t.ai, ...patch } } : t,
      );
    }
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Stop the loop and release resources. */
  dispose(): void {
    this.stop();
    this.listeners.clear();
  }
}

/**
 * React hook that bridges the AiStateStore to React via useSyncExternalStore.
 */
export interface AiApi {
  state: AiState;
  store: AiStateStore;
}

export function useAiState(): AiApi {
  const [store] = useState(() => new AiStateStore());
  const state = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.get(),
    () => store.get(),
  );
  useEffect(() => {
    return () => store.dispose();
  }, [store]);
  return { state, store };
}

/** Re-export for convenience. */
export { loadAiOverlay };
