/**
 * useDragDrop — dnd-kit drag-and-drop wiring for the board.
 *
 * Returns the DndContext props (sensors, collision detection, onDragEnd)
 * plus the active task id so the board can highlight the dragged card.
 */

import { useState } from "react";
import {
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskStatus } from "../types/task";

export interface DragDropApi {
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  activeTaskId: string | null;
}

export function useDragDrop(
  onMove: (taskId: string, status: TaskStatus) => void,
): DragDropApi {
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

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

  return { sensors, onDragEnd, activeTaskId };
}
