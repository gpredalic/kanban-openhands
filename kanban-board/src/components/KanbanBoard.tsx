/**
 * KanbanBoard — the top-level board component.
 *
 * Wires the data controller to the UI: header, stats, filters, and the four
 * columns inside a DndContext. Applies the active filter and search query.
 */

import { useMemo } from "react";
import { DndContext } from "@dnd-kit/core";
import { Header } from "./Header";
import { StatsCards } from "./StatsCards";
import { FilterBar } from "./FilterBar";
import { KanbanColumn } from "./KanbanColumn";
import { useBoardState } from "../hooks/useBoardState";
import { useDragDrop } from "../hooks/useDragDrop";
import { computeStats } from "../lib/board-state";
import type { Host, Task, BoardFilter } from "../types/task";

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

  const allTasks = useMemo(
    () => state.columns.flatMap((c) => c.tasks),
    [state.columns],
  );
  const stats = useMemo(() => computeStats(allTasks), [allTasks]);

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

  return (
    <div className="kb-app flex min-h-full flex-col gap-6 p-4 sm:p-6 lg:p-8">
      {/* Floating blur blobs */}
      <div className="kb-blob kb-blob--tl" aria-hidden />
      <div className="kb-blob kb-blob--tr" aria-hidden />
      <div className="kb-blob kb-blob--br" aria-hidden />

      <Header
        search={state.uiState.search}
        onSearch={(v) => controller.setUiState({ search: v })}
        onCreate={() => handleCreate("New Task", "todo")}
      />

      <StatsCards stats={stats} />

      <FilterBar
        filter={state.uiState.filter}
        onFilter={(f) => controller.setUiState({ filter: f })}
      />

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="relative z-10 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
    </div>
  );
}
