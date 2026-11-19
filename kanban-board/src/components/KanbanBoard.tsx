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
import { useBoardState } from "../hooks/useBoardState";
import { useDragDrop } from "../hooks/useDragDrop";
import { useAiState } from "../lib/ai-store";
import { applyAiOverlay, resetAiConfig } from "../lib/ai-overlay";
import { computeStats } from "../lib/board-state";
import type { Host, Task, BoardFilter } from "../types/task";
import { commandExecution, useOpenHandsState } from "../lib/openhands";
import { resolveExecution } from "../lib/ai-engine";

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
  const { sensors, onDragEnd, activeTaskId } = useDragDrop(
    (taskId, status) => {
      void controller.move(taskId, status);
    },
  );
  const { state: aiState, store: aiStore } = useAiState();
  const openHandsState = useOpenHandsState(host);
  const [view, setView] = useState<ViewId>("board");

  const allTasks = useMemo(
    () => state.columns.flatMap((c) => c.tasks),
    [state.columns],
  );
  const stats = useMemo(() => computeStats(allTasks), [allTasks]);

  // Enrich the board tasks with their AI overlay so the orchestration loop and
  // the AI views (workflow, agents, history, analytics) operate on live data.
  const enrichedTasks = useMemo(
    () => applyAiOverlay(allTasks, aiState.overlay),
    [allTasks, aiState.overlay],
  );

  // Feed the AI store with the current enriched tasks on every data change.
  useEffect(() => {
    aiStore.setTasks(enrichedTasks);
  }, [aiStore, enrichedTasks]);

  const filteredColumns = useMemo(() => {
    return state.columns.map((col) => ({
      ...col,
      tasks: col.tasks.filter(
        (t) => matchesFilter(t, state.uiState.filter) && matchesSearch(t, state.uiState.search),
      ),
    }));
  }, [state.columns, state.uiState.filter, state.uiState.search]);

  const handleCreate = (title: string, status: Task["status"]) => {
    void controller.create(title, status);
  };

  const handleToggleOrchestration = () => {
    if (aiState.execution.running) {
      aiStore.stop();
      for (const run of openHandsState.snapshot.executions.filter((item) => item.status === "running")) {
        void commandExecution(host, "stop", { executionId: run.id }).catch((error: unknown) => {
          console.error("[kanban-board] OpenHands stop failed:", error);
        });
      }
      return;
    }
    for (const task of enrichedTasks.filter((item) => item.status === "in_progress")) {
      const { agent, model } = resolveExecution(task, aiState.config);
      void commandExecution(host, "start", {
        taskId: task.id,
        title: task.title,
        agentId: agent?.id,
        modelId: model?.id,
      }).catch((error: unknown) => {
        console.error("[kanban-board] OpenHands start failed:", error);
      });
    }
    aiStore.start();
  };

  const handleResetAiConfig = () => {
    aiStore.setConfig(resetAiConfig());
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
        onCreate={() => handleCreate("New Task", "todo")}
        orchestrationRunning={aiState.execution.running}
        onToggleOrchestration={handleToggleOrchestration}
      />

      <ViewSwitcher view={view} onView={setView} />

      {view === "board" ? (
        <>
          <StatsCards stats={stats} />

          <FilterBar
            filter={state.uiState.filter}
            onFilter={(f) => controller.setUiState({ filter: f })}
          />

          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="relative z-10 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {filteredColumns.map((col) => (
                <KanbanColumn
                  key={col.status}
                  column={col}
                  activeTaskId={activeTaskId}
                  onCreate={handleCreate}
                />
              ))}
            </div>
          </DndContext>
        </>
      ) : view === "workflow" ? (
        <WorkflowView aiState={aiState} tasks={enrichedTasks} />
      ) : view === "command" ? (
        <OpenHandsView
          host={host}
          state={openHandsState}
          tasks={enrichedTasks}
          agents={aiState.config.agents}
          onCommand={handleOpenHandsCommand}
        />
      ) : view === "agents" ? (
        <AgentRoster aiState={aiState} onReset={handleResetAiConfig} />
      ) : view === "history" ? (
        <ExecutionHistory aiState={aiState} />
      ) : (
        <AnalyticsView aiState={aiState} />
      )}
    </div>
  );
}
