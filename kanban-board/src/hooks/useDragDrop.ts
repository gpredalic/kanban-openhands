/**
 * useDragDrop — dnd-kit drag-and-drop wiring for the board.
 *
 * Returns the DndContext props (sensors, collision detection, onDragEnd)
 * plus the active task id so the board can highlight the dragged card.
 */

import { useEffect, useState } from "react";
import {
  DragEndEvent,
  PointerSensor,
  DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskStatus } from "../types/task";

export interface DragDropApi {
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  activeTaskId: string | null;
  onDragStart: (event: DragStartEvent) => void;
}

export function useDragDrop(
  onMove: (taskId: string, status: TaskStatus) => void,
): DragDropApi {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    let pointerTaskId: string | null = null;
    let pointerStarted = false;
    const down = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>("[data-task-id]");
      if (card?.dataset.taskId && !(target?.closest("button"))) {
        pointerTaskId = card.dataset.taskId;
        pointerStarted = false;
      }
    };
    const move = () => {
      if (pointerTaskId) {
        pointerStarted = true;
        setActiveTaskId(pointerTaskId);
      }
    };
    const up = (event: PointerEvent) => {
      if (pointerTaskId && pointerStarted) {
        const target = event.target as HTMLElement | null;
        const column = target?.closest<HTMLElement>("[data-drop-status]");
        const status = column?.dataset.dropStatus as TaskStatus | undefined;
        if (status) onMove(pointerTaskId, status);
      }
      pointerTaskId = null;
      pointerStarted = false;
      setActiveTaskId(null);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
  }, [onMove]);

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveTaskId(null);
    if (!over) return;
    const taskId = String(active.id);
    const overId = String(over.id);
    // The over id is a column status (todo | in_progress | review | done).
    if (overId === "todo" || overId === "in_progress" || overId === "review" || overId === "done") {
      onMove(taskId, overId);
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveTaskId(String(event.active.id));
  };

  return { sensors, onDragEnd, onDragStart, activeTaskId };
}
