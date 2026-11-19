/**
 * FilterBar — modern pill filters: All, Active, Assigned, Completed.
 * The active pill gets a gradient background and a subtle shadow.
 */

import type { BoardFilter } from "../types/task";

interface FilterBarProps {
  filter: BoardFilter;
  onFilter: (filter: BoardFilter) => void;
}

const FILTERS: { id: BoardFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "assigned", label: "Assigned" },
  { id: "completed", label: "Completed" },
];

export function FilterBar({ filter, onFilter }: FilterBarProps) {
  return (
    <div className="relative z-10 flex flex-wrap items-center gap-2">
      {FILTERS.map((f) => {
        const active = filter === f.id;
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            aria-pressed={active}
            className={`kb-pill rounded-full px-4 py-1.5 text-sm font-medium ${
              active
                ? "kb-pill--active"
                : "kb-glass-sm text-slate-400 hover:text-slate-200"
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}
