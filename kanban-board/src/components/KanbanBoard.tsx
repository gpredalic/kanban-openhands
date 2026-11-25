/**
 * KanbanBoard — the top-level board component.
 *
 * Wires the data controller to the UI: header, stats, filters, and the four
 * columns inside a DndContext. Applies the active filter.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { Header } from "./Header";
import { StatsCards } from "./StatsCards";
import { FilterBar } from "./FilterBar";
import { KanbanColumn } from "./KanbanColumn";
import { TaskCard } from "./TaskCard";
import { ViewSwitcher } from "./ViewSwitcher";
import type { ViewId } from "./ViewSwitcher";
import { TaskDetailModal } from "./TaskDetailModal";
import { CreateTaskModal } from "./CreateTaskModal";
import { SkeletonColumn, SkeletonStat } from "./Skeleton";
import { useBoardState } from "../hooks/useBoardState";
import { useDragDrop } from "../hooks/useDragDrop";
import { useFlipAnimation } from "../hooks/useFlipAnimation";
import { useAiState } from "../lib/ai-store";
import { applyAiOverlay, SEED_AGENTS } from "../lib/ai-overlay";
import { computeStats } from "../lib/board-state";
import type { Host, Task, BoardFilter, TaskPriority } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import { commandExecution, fetchAgentProfiles, useOpenHandsState } from "../lib/openhands";
import { resolveRouting } from "../lib/ai-engine";

/**
 * Progressive loading — the heavy secondary views are lazy-loaded so their
 * mount-time work (state init, effects, agent/profile fetches, workflow graph
 * layout) is deferred until the user actually opens the view. The board view
 * itself stays eager: it is the default and must render immediately.
 *
 * The build inlines everything into a single extension.js (inlineDynamicImports),
 * so the lazy() import resolves synchronously — but React still defers the
 * component's *mount* (its effects and initial state) until it is first
 * rendered inside the Suspense boundary. That is the real win: opening the
 * board no longer pays for the Workflow / Analytics / History / Agents /
 * Monitoring views' setup cost.
 */
const WorkflowView = lazy(() => import("./WorkflowView").then((m) => ({ default: m.WorkflowView })));
const MonitoringView = lazy(() => import("./MonitoringView").then((m) => ({ default: m.MonitoringView })));
const AgentRoster = lazy(() => import("./AgentRoster").then((m) => ({ default: m.AgentRoster })));
const ExecutionHistory = lazy(() => import("./ExecutionHistory").then((m) => ({ default: m.ExecutionHistory })));
const AnalyticsView = lazy(() => import("./AnalyticsView").then((m) => ({ default: m.AnalyticsView })));

/** Shown while a lazy view is resolving — a quiet, non-blocking placeholder. */
function ViewFallback() {
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
        Loading view…
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  host: Host;
}

function matchesFilter(task: Task, filter: BoardFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return task.status !== "done";
    case "assigned":
      return task.assignee !== null && task.assignee !== "";
    case "completed":
      return task.status === "done";
    default:
      return true;
  }
}

export function KanbanBoard({ host }: KanbanBoardProps) {
  const { state, controller } = useBoardState(host);
  const { sensors, onDragEnd, onDragStart, activeTaskId } = useDragDrop(
    (taskId, status) => {
      void controller.move(taskId, status);
    },
  );
  const { state: aiState, store: aiStore } = useAiState(host);
  const { state: openHandsState, reset: resetOpenHands } = useOpenHandsState(host);
  const [view, setView] = useState<ViewId>("board");
  // Which workflow the Monitoring view is observing. Defaults to the first
  // workflow; the user can switch from the Monitoring toolbar.
  const [monitoringWorkflowId, setMonitoringWorkflowId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [assignmentAgents, setAssignmentAgents] = useState<Agent[]>([]);
  // Task ids whose Run / Stop request is in flight — drives the spinner +
  // disabled state on the card's Run/Stop button so the user sees the action
  // is being processed instead of a silent click.
  const [runLoadingTaskIds, setRunLoadingTaskIds] = useState<Set<string>>(new Set());
  const [stopLoadingTaskIds, setStopLoadingTaskIds] = useState<Set<string>>(new Set());

  // FLIP animation: captures card positions before each render and animates
  // any card that moved between columns (status change) with a lift + glide.
  const boardRef = useRef<HTMLDivElement>(null);
  useFlipAnimation(boardRef, state.columns);

  useEffect(() => {
    let cancelled = false;
    void fetchAgentProfiles(host)
      .then((profiles) => {
        if (cancelled) return;
        if (profiles.length === 0) {
          setAssignmentAgents(SEED_AGENTS);
          return;
        }
        setAssignmentAgents(profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          role: "AI agent",
          modelId: "",
          description: `Agent profile: ${profile.name}`,
          capabilities: [],
          maxConcurrent: 1,
          status: "idle",
          avatar: "from-cyan-500 to-indigo-500",
        })));
      })
      .catch(() => {
        if (!cancelled) setAssignmentAgents(SEED_AGENTS);
      });
    return () => {
      cancelled = true;
    };
  }, [host]);

  const allTasks = useMemo(
    () => state.columns.flatMap((c) => c.tasks),
    [state.columns],
  );
  const stats = useMemo(() => computeStats(allTasks), [allTasks]);

  // Enrich the board tasks with their AI overlay so the orchestration loop and
  // the AI views (workflow, agents, history, analytics) operate on live data.
  //
  // Identity is stable: a task whose execution status/id is unchanged returns
  // the SAME EnrichedTask object it returned last time. This is what lets
  // React.memo(TaskCard) skip re-rendering unchanged cards when the memo
  // recomputes after a real change (one task's execution advanced). Without
  // this, every recompute spread every task with an execution and the whole
  // board re-rendered, restarting card animations.
  const enrichedCacheRef = useRef<Map<string, { base: EnrichedTask; status: string | undefined; execId: string | undefined }>>(new Map());
  const enrichedTasks = useMemo(() => {
    const cache = enrichedCacheRef.current;
    const seen = new Set<string>();
    const result = applyAiOverlay(allTasks, aiState.overlay).map((task) => {
      seen.add(task.id);
      const execution = openHandsState.snapshot.executions.find((run) => run.taskId === task.id);
      const status = execution?.status;
      const execId = execution?.id;
      const cached = cache.get(task.id);
      if (cached && cached.base === task && cached.status === status && cached.execId === execId) {
        return cached.base;
      }
      const enriched: EnrichedTask = execution
        ? { ...task, ai: { ...task.ai, executionStatus: execution.status, executionId: execution.id } }
        : task;
      cache.set(task.id, { base: enriched, status, execId });
      return enriched;
    });
    for (const id of cache.keys()) {
      if (!seen.has(id)) cache.delete(id);
    }
    return result;
  }, [allTasks, aiState.overlay, openHandsState.snapshot.executions]);

  // Feed the AI store with the current enriched tasks on every data change.
  useEffect(() => {
    aiStore.setTasks(enrichedTasks);
  }, [aiStore, enrichedTasks]);

  const filteredColumns = useMemo(() => {
    const enrichedById = new Map(enrichedTasks.map((t) => [t.id, t]));
    return state.columns.map((col) => ({
      ...col,
      tasks: col.tasks
        .filter((t) => matchesFilter(t, state.uiState.filter))
        .map((t) => enrichedById.get(t.id) ?? t),
    }));
  }, [state.columns, state.uiState.filter, enrichedTasks]);

  const handleCreate = (title: string, status: Task["status"], assignee?: string | null, agentId?: string | null, agentPrompt?: string, expectedOutput?: string, successCriteria?: string, priority?: TaskPriority) => {
    void controller.create(title, status, assignee, undefined, agentId, agentPrompt, expectedOutput, successCriteria, priority);
  };

  const handleEditSave = useCallback((taskId: string, patch: { title?: string; assignee?: string | null; agentId?: string | null; agentPrompt?: string; expectedOutput?: string; successCriteria?: string; priority?: TaskPriority }) => {
    void controller.update(taskId, patch);
  }, [controller]);

  const handleDelete = useCallback((taskId: string) => {
    void controller.remove(taskId);
  }, [controller]);

  // Retry a failed delete: re-runs the transaction from the top. The task is
  // still on disk (it was never removed on failure), so the flow can proceed.
  const handleRetryDelete = useCallback((taskId: string) => {
    void controller.remove(taskId);
  }, [controller]);

  // Cancel a failed delete: clear the error state and return the card to normal.
  const handleCancelDelete = useCallback((taskId: string) => {
    controller.cancelDelete(taskId);
  }, [controller]);

  // Per-task Run: routes to THIS task's own conversation. If the task already
  // has a linked conversation (task.ai.executionId / task.conversationId) it is
  // reused — so editing the task (title, prompt, etc.) keeps it on the SAME
  // conversation it was first created in, instead of spawning a fresh one. Only
  // a task with no conversation yet gets a new one. It never looks at other
  // tasks' executions, so a running Task A cannot block Task B.
  const handleTaskRun = (task: EnrichedTask) => {
    const routing = resolveRouting(task, aiState.config);
    setRunLoadingTaskIds((prev) => new Set(prev).add(task.id));
    void commandExecution(host, "start", {
      taskId: task.id,
      title: task.title,
      agentPrompt: task.agentPrompt,
      expectedOutput: task.expectedOutput,
      successCriteria: task.successCriteria,
      agentId: routing.agentId ?? undefined,
      modelId: routing.modelId ?? undefined,
      executionId: task.ai.executionId ?? task.conversationId ?? undefined,
    })
      .catch((error: unknown) => {
        console.error("[kanban-board] OpenHands task start failed:", error);
      })
      .finally(() => {
        setRunLoadingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      });
  };

  // Per-task Stop: interrupts only this task's linked conversation.
  const handleTaskStop = (task: EnrichedTask) => {
    const executionId = task.ai.executionId;
    if (!executionId) return;
    setStopLoadingTaskIds((prev) => new Set(prev).add(task.id));
    void commandExecution(host, "stop", { executionId })
      .catch((error: unknown) => {
        console.error("[kanban-board] OpenHands task stop failed:", error);
      })
      .finally(() => {
        setStopLoadingTaskIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      });
  };

  // Per-task Retry: spawns a FRESH conversation carrying this task's current
  // prompt (never the title) and re-runs it. Distinct from Run, which reuses the
  // task's existing conversation. Only offered once the task has a prior
  // execution to retry.
  const handleTaskRetry = (task: EnrichedTask) => {
    const routing = resolveRouting(task, aiState.config);
    void commandExecution(host, "retry", {
      taskId: task.id,
      title: task.title,
      agentPrompt: task.agentPrompt,
      expectedOutput: task.expectedOutput,
      successCriteria: task.successCriteria,
      agentId: routing.agentId ?? undefined,
      modelId: routing.modelId ?? undefined,
    }).catch((error: unknown) => {
      console.error("[kanban-board] OpenHands task retry failed:", error);
    });
  };

  // Command Center execution control: start / stop / retry a specific execution
  // record by id. Task-centric — never a global toggle.
  const handleOpenHandsCommand = (command: "start" | "stop" | "retry", executionId: string) => {
    void commandExecution(host, command, { executionId }).catch((error: unknown) => {
      console.error("[kanban-board] OpenHands command failed:", error);
    });
  };

  // Refresh the board when the user returns to the Board view so inbound
  // OpenHands conversations (created outside the board) are reflected promptly
  // instead of waiting for the next 15s poll.
  const handleViewChange = (next: ViewId) => {
    setView(next);
    if (next === "board") void controller.load();
  };

  return (
    <div className="kb-app flex flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <Header onCreate={() => setShowCreateModal(true)} syncing={state.uiState.syncing} />

      <ViewSwitcher view={view} onView={handleViewChange} />

      {view === "board" ? (
        <>
          {state.uiState.lastLoadedAt === 0 ? (
            /* Initial load — show skeleton placeholders */
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SkeletonStat />
                <SkeletonStat />
                <SkeletonStat />
                <SkeletonStat />
              </div>
              <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <SkeletonColumn />
                <SkeletonColumn />
                <SkeletonColumn />
                <SkeletonColumn />
              </div>
            </>
          ) : (
            <>
              <StatsCards stats={stats} />

              <FilterBar
                filter={state.uiState.filter}
                onFilter={(f) => controller.setUiState({ filter: f })}
              />

              <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
                <div ref={boardRef} className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {filteredColumns.map((col) => (
                    <KanbanColumn
                      key={col.status}
                      column={col}
                      agents={assignmentAgents}
                      activeTaskId={activeTaskId}
                      deletingTaskIds={state.uiState.deletingTaskIds}
                      deletePhases={state.uiState.deletePhases}
                      deleteErrors={state.uiState.deleteErrors}
                      onEdit={setEditingTask}
                      onDelete={handleDelete}
                      onRetryDelete={handleRetryDelete}
                      onCancelDelete={handleCancelDelete}
                    />
                  ))}
                </div>
                {/* DragOverlay: renders the dragged card as a floating clone that
                    follows the pointer. It is portaled outside the column's
                    overflow container, so the card is never clipped and always
                    stays above all UI (z-index 9999). The original card in the
                    column becomes an invisible placeholder (opacity 0), so
                    there is no ghost duplicate. */}
                <DragOverlay dropAnimation={null}>
                  {activeTaskId ? (
                    (() => {
                      const activeTask = enrichedTasks.find((t) => t.id === activeTaskId);
                      if (!activeTask) return null;
                      return (
                        <TaskCard
                          task={activeTask}
                          agents={assignmentAgents}
                          isDragging
                          isOverlay
                        />
                      );
                    })()
                  ) : null}
                </DragOverlay>
              </DndContext>
            </>
          )}
        </>
      ) : (
        <Suspense fallback={<ViewFallback />}>
          {view === "workflow" ? (
            <WorkflowView
              aiState={aiState}
              tasks={enrichedTasks}
              openHandsState={openHandsState}
              profiles={assignmentAgents}
              onCreate={(workflow) => aiStore.setConfig({
                ...aiState.config,
                workflows: [...aiState.config.workflows, workflow],
              })}
              onUpdate={(workflow) => aiStore.setConfig({
                ...aiState.config,
                workflows: aiState.config.workflows.map((item) => item.id === workflow.id ? workflow : item),
              })}
              onDelete={(workflowId) => aiStore.setConfig({
                ...aiState.config,
                workflows: aiState.config.workflows.filter((item) => item.id !== workflowId),
              })}
            />
          ) : view === "monitoring" ? (
            <MonitoringView
              workflows={aiState.config.workflows}
              selectedId={monitoringWorkflowId ?? aiState.config.workflows[0]?.id ?? null}
              onSelectId={setMonitoringWorkflowId}
              openHandsState={openHandsState}
              tasks={enrichedTasks}
              profiles={assignmentAgents}
              onCommand={handleOpenHandsCommand}
            />
          ) : view === "agents" ? (
            <AgentRoster host={host} openHandsState={openHandsState} />
          ) : view === "history" ? (
            <ExecutionHistory openHandsState={openHandsState} aiState={aiState} profiles={assignmentAgents} onReset={resetOpenHands} />
          ) : (
            <AnalyticsView aiState={aiState} openHandsState={openHandsState} onReset={resetOpenHands} />
          )}
        </Suspense>
      )}

      {editingTask && (
        <TaskDetailModal
          task={editingTask}
          agents={assignmentAgents}
          openHandsState={openHandsState}
          running={
            (() => {
              const live = enrichedTasks.find((t) => t.id === editingTask.id) as EnrichedTask | undefined;
              const status = live?.ai?.executionStatus ?? (editingTask as EnrichedTask).ai?.executionStatus;
              return status === "running" || status === "queued";
            })()
          }
          onClose={() => setEditingTask(null)}
          onSave={handleEditSave}
          onDelete={handleDelete}
          onSetTags={(id, tags) => controller.setTags(id, tags)}
          onSetDueDate={(id, due) => controller.setDueDate(id, due)}
          onTaskRun={handleTaskRun}
          onTaskStop={handleTaskStop}
          onTaskRetry={handleTaskRetry}
          runLoading={runLoadingTaskIds.has(editingTask.id)}
          stopLoading={stopLoadingTaskIds.has(editingTask.id)}
        />
      )}

      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          agents={assignmentAgents}
          onCreate={(title, status, assignee, agentId, agentPrompt, expectedOutput, successCriteria, priority) =>
            handleCreate(title, status, assignee, agentId, agentPrompt, expectedOutput, successCriteria, priority)
          }
        />
      )}
    </div>
  );
}
