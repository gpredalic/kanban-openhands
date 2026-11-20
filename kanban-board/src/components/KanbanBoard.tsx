/**
 * KanbanBoard — the top-level board component.
 *
 * Wires the data controller to the UI: header, stats, filters, and the four
 * columns inside a DndContext. Applies the active filter and search query.
 */

import { useEffect, useMemo, useState } from "react";
import { DndContext } from "@dnd-kit/core";
import { Header } from "./Header";
import { StatsCards } from "./StatsCards";
import { FilterBar } from "./FilterBar";
import { KanbanColumn } from "./KanbanColumn";
import { ViewSwitcher } from "./ViewSwitcher";
import type { ViewId } from "./ViewSwitcher";
import { WorkflowView } from "./WorkflowView";
import { AgentRoster } from "./AgentRoster";
import { ExecutionHistory } from "./ExecutionHistory";
import { AnalyticsView } from "./AnalyticsView";
import { OpenHandsView } from "./OpenHandsView";
import { TaskDetailModal } from "./TaskDetailModal";
import { CreateTaskModal } from "./CreateTaskModal";
import { useBoardState } from "../hooks/useBoardState";
import { useDragDrop } from "../hooks/useDragDrop";
import { useAiState } from "../lib/ai-store";
import { applyAiOverlay, resetAiConfig, SEED_AGENTS } from "../lib/ai-overlay";
import { computeStats } from "../lib/board-state";
import type { Host, Task, BoardFilter } from "../types/task";
import type { Agent, EnrichedTask } from "../types/ai";
import { commandExecution, fetchAgentProfiles, useOpenHandsState } from "../lib/openhands";
import { resolveRouting } from "../lib/ai-engine";

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

function matchesSearch(task: Task, search: string): boolean {
  if (!search) return true;
  const q = search.toLowerCase();
  return (
    task.title.toLowerCase().includes(q) ||
    (task.assignee ?? "").toLowerCase().includes(q) ||
    (task.tags ?? []).some((t) => t.toLowerCase().includes(q))
  );
}

export function KanbanBoard({ host }: KanbanBoardProps) {
  const { state, controller } = useBoardState(host);
  const { sensors, onDragEnd, onDragStart, activeTaskId } = useDragDrop(
    (taskId, status) => {
      void controller.move(taskId, status);
    },
  );
  const { state: aiState, store: aiStore } = useAiState(host);
  const openHandsState = useOpenHandsState(host);
  const [view, setView] = useState<ViewId>("board");
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; detail: string; at: number; read: boolean }>>([]);
  const [assignmentAgents, setAssignmentAgents] = useState<Agent[]>([]);

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
          role: "OpenHands agent",
          modelId: "",
          description: `OpenHands profile: ${profile.name}`,
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
  const enrichedTasks = useMemo(
    () => applyAiOverlay(allTasks, aiState.overlay).map((task) => {
      const execution = openHandsState.snapshot.executions.find((run) => run.taskId === task.id);
      return execution
        ? { ...task, ai: { ...task.ai, executionStatus: execution.status, executionId: execution.id } }
        : task;
    }),
    [allTasks, aiState.overlay, openHandsState.snapshot.executions],
  );

  // Feed the AI store with the current enriched tasks on every data change.
  useEffect(() => {
    aiStore.setTasks(enrichedTasks);
  }, [aiStore, enrichedTasks]);

  const filteredColumns = useMemo(() => {
    const enrichedById = new Map(enrichedTasks.map((t) => [t.id, t]));
    return state.columns.map((col) => ({
      ...col,
      tasks: col.tasks
        .filter(
          (t) => matchesFilter(t, state.uiState.filter) && matchesSearch(t, state.uiState.search),
        )
        .map((t) => enrichedById.get(t.id) ?? t),
    }));
  }, [state.columns, state.uiState.filter, state.uiState.search, enrichedTasks]);

  const handleCreate = (title: string, status: Task["status"], assignee?: string | null, agentId?: string | null) => {
    void controller.create(title, status, assignee, undefined, agentId);
    setNotifications((current) => [{
      id: `board-create-${Date.now()}`,
      title: "Task created",
      detail: title,
      at: Date.now(),
      read: false,
    }, ...current].slice(0, 20));
  };

  const handleEditSave = (taskId: string, patch: { title?: string; assignee?: string | null; agentId?: string | null }) => {
    void controller.update(taskId, patch);
  };

  const handleDelete = (taskId: string) => {
    void controller.remove(taskId);
  };

  const handleToggleOrchestration = () => {
    const hasActiveOpenHandsRuns = openHandsState.snapshot.executions.some(
      (item) => item.status === "queued" || item.status === "running",
    );
    if (hasActiveOpenHandsRuns) {
      for (const run of openHandsState.snapshot.executions.filter((item) => item.status === "running")) {
        void commandExecution(host, "stop", { executionId: run.id }).catch((error: unknown) => {
          console.error("[kanban-board] OpenHands stop failed:", error);
        });
      }
      return;
    }
    for (const task of enrichedTasks.filter((item) => item.status === "in_progress")) {
      // Resolve the real OpenHands profile id assigned to the task. resolveRouting
      // returns the explicit assignment (task.ai.agentId) first, which is the real
      // profile id from /api/agent-profiles (e.g. d83cb56e-...). Passing it straight
      // through — instead of the SEED_AGENTS lookup, which only knows demo agent ids
      // and would resolve the real profile to null — is what makes createConversation
      // post the correct agent_profile_id.
      const routing = resolveRouting(task, aiState.config);
      void commandExecution(host, "start", {
        taskId: task.id,
        title: task.title,
        agentId: routing.agentId ?? undefined,
        modelId: routing.modelId ?? undefined,
      }).catch((error: unknown) => {
        console.error("[kanban-board] OpenHands start failed:", error);
      });
    }
    setNotifications((current) => [{
      id: `ai-run-${Date.now()}`,
      title: "AI execution started",
      detail: `${enrichedTasks.filter((item) => item.status === "in_progress").length} task(s) sent to OpenHands`,
      at: Date.now(),
      read: false,
    }, ...current].slice(0, 20));
  };

  const handleResetAiConfig = () => {
    aiStore.setConfig(resetAiConfig());
  };

  // Per-task Run AI: starts a fresh OpenHands conversation for THIS task only,
  // using the real profile id assigned to it (task.ai.agentId). It never looks
  // at other tasks' executions, so a running Task A cannot block Task B.
  const handleTaskRun = (task: EnrichedTask) => {
    const routing = resolveRouting(task, aiState.config);
    void commandExecution(host, "start", {
      taskId: task.id,
      title: task.title,
      agentId: routing.agentId ?? undefined,
      modelId: routing.modelId ?? undefined,
    }).catch((error: unknown) => {
      console.error("[kanban-board] OpenHands task start failed:", error);
    });
    setNotifications((current) => [{
      id: `ai-task-run-${task.id}-${Date.now()}`,
      title: "AI execution started",
      detail: task.title,
      at: Date.now(),
      read: false,
    }, ...current].slice(0, 20));
  };

  // Per-task Stop AI: interrupts only this task's linked conversation.
  const handleTaskStop = (task: EnrichedTask) => {
    const executionId = task.ai.executionId;
    if (!executionId) return;
    void commandExecution(host, "stop", { executionId }).catch((error: unknown) => {
      console.error("[kanban-board] OpenHands task stop failed:", error);
    });
  };

  const handleOpenHandsCommand = (command: "start" | "stop" | "retry", executionId: string) => {
    void commandExecution(host, command, { executionId }).catch((error: unknown) => {
      console.error("[kanban-board] OpenHands command failed:", error);
    });
  };

  return (
    <div className="kb-app flex min-h-full flex-col gap-4 p-3 sm:p-4 lg:p-5">
      <Header
        search={state.uiState.search}
        onSearch={(v) => controller.setUiState({ search: v })}
        onCreate={() => setShowCreateModal(true)}
        orchestrationRunning={openHandsState.snapshot.executions.some(
          (item) => item.status === "queued" || item.status === "running",
        )}
        onToggleOrchestration={handleToggleOrchestration}
        notifications={notifications}
        notificationsOpen={notificationsOpen}
        onToggleNotifications={() => {
          setNotificationsOpen((open) => !open);
          setNotifications((current) => current.map((item) => ({ ...item, read: true })));
        }}
      />

      <ViewSwitcher view={view} onView={setView} />

      {view === "board" ? (
        <>
          <StatsCards stats={stats} />

          <FilterBar
            filter={state.uiState.filter}
            onFilter={(f) => controller.setUiState({ filter: f })}
          />

          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="relative z-10 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {filteredColumns.map((col) => (
                <KanbanColumn
                  key={col.status}
                  column={col}
                  agents={assignmentAgents}
                  activeTaskId={activeTaskId}
                  onCreate={handleCreate}
                  onEdit={setEditingTask}
                  onDelete={handleDelete}
                  onTaskRun={handleTaskRun}
                  onTaskStop={handleTaskStop}
                />
              ))}
            </div>
          </DndContext>
        </>
      ) : view === "workflow" ? (
        <WorkflowView
          aiState={aiState}
          tasks={enrichedTasks}
          openHandsState={openHandsState}
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
      ) : view === "command" ? (
        <OpenHandsView
          host={host}
          state={openHandsState}
          tasks={enrichedTasks}
          agents={aiState.config.agents}
          onCommand={handleOpenHandsCommand}
        />
      ) : view === "agents" ? (
        <AgentRoster
          aiState={aiState}
          onReset={handleResetAiConfig}
          onConfigChange={(config) => aiStore.setConfig(config)}
        />
      ) : view === "history" ? (
        <ExecutionHistory openHandsState={openHandsState} aiState={aiState} />
      ) : (
        <AnalyticsView aiState={aiState} openHandsState={openHandsState} />
      )}

      {editingTask && (
        <TaskDetailModal
          task={editingTask}
          agents={assignmentAgents}
          onClose={() => setEditingTask(null)}
          onSave={handleEditSave}
          onDelete={handleDelete}
          onSetTags={(id, tags) => controller.setTags(id, tags)}
          onSetDueDate={(id, due) => controller.setDueDate(id, due)}
        />
      )}

      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          agents={assignmentAgents}
          onCreate={(title, status, assignee, agentId) => handleCreate(title, status, assignee, agentId)}
        />
      )}
    </div>
  );
}
