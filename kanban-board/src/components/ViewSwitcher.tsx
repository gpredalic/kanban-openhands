/**
 * ViewSwitcher — top-level navigation tabs for the orchestration platform.
 *
 * Switches between the views: Board (Kanban), Workflow (pure node-graph
 * builder), and Analytics (token/cost tracking). The active tab gets a
 * gradient background.
 */

import { KanbanSquare, GitBranch, BarChart3 } from "lucide-react";
import type { ViewId } from "../types/task";

export type { ViewId };

interface ViewSwitcherProps {
  view: ViewId;
  onView: (view: ViewId) => void;
}

const VIEWS: { id: ViewId; label: string; icon: typeof KanbanSquare }[] = [
  { id: "board", label: "Board", icon: KanbanSquare },
  { id: "workflow", label: "Workflow", icon: GitBranch },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

export function ViewSwitcher({ view, onView }: ViewSwitcherProps) {
  return (
    <nav className="kb-glass-sm relative z-10 flex items-center gap-1 rounded-2xl p-1.5">
      {VIEWS.map((v) => {
        const active = view === v.id;
        const Icon = v.icon;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onView(v.id)}
            aria-pressed={active}
            className={`kb-pill flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold ${
              active ? "kb-pill--active" : "text-slate-400 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            <span className="hidden sm:inline">{v.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
