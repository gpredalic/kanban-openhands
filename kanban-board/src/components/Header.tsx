/**
 * Header — the editorial masthead.
 *
 * A small-caps eyebrow, a large quiet display title, and a focused action row
 * on the right: a search field, a single Filter control (a dropdown that
 * replaces the old four-pill FilterBar), and the Create Task button. The
 * operational chrome (sync indicator, profile avatar) has been removed so the
 * board stays focused on the work. The whole masthead reveals on scroll.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Search, SlidersHorizontal, Check } from "lucide-react";
import kanbanAiIcon from "../../icons/kanban-ai-128.svg";
import { useReveal } from "../hooks/useReveal";
import type { BoardFilter } from "../types/task";

interface HeaderProps {
  onCreate: () => void;
  /** Current free-text search query. */
  search: string;
  /** Update the free-text search query. */
  onSearch: (query: string) => void;
  /** The active board filter. */
  filter: BoardFilter;
  /** Change the active board filter. */
  onFilter: (filter: BoardFilter) => void;
}

/** The filter options, in display order. */
const FILTER_OPTIONS: { id: BoardFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "assigned", label: "Assigned" },
  { id: "completed", label: "Completed" },
];

export function Header({ onCreate, search, onSearch, filter, onFilter }: HeaderProps) {
  const eyebrowRef = useReveal<HTMLParagraphElement>({ delay: 0 });
  const titleRef = useReveal<HTMLHeadingElement>({ delay: 60 });
  const subRef = useReveal<HTMLParagraphElement>({ delay: 120 });
  const actionRef = useReveal<HTMLDivElement>({ delay: 180 });

  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close the filter dropdown on outside click or Escape.
  useEffect(() => {
    if (!filterOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFilterOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen]);

  const activeFilterLabel =
    FILTER_OPTIONS.find((option) => option.id === filter)?.label ?? "All";

  return (
    <header className="relative z-10 flex flex-col gap-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        {/* Title block */}
        <div className="flex items-center gap-5">
          <div className="kb-glass-sm flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px]">
            <img
              src={kanbanAiIcon}
              alt="Kanban AI"
              width={36}
              height={36}
              className="h-9 w-9"
            />
          </div>
          <div>
            <p
              ref={eyebrowRef}
              className="kb-reveal text-[0.6875rem] font-semibold uppercase tracking-[0.24em] text-slate-500"
            >
              Workspace
            </p>
            <h1
              ref={titleRef}
              className="kb-reveal mt-2 text-[2.5rem] font-bold leading-[1.05] tracking-[-0.025em] text-slate-50"
            >
              Kanban Board
            </h1>
            <p
              ref={subRef}
              className="kb-reveal mt-2 text-[0.9375rem] text-slate-400"
            >
              Plan, track and ship work across your team — in one place.
            </p>
          </div>
        </div>

        {/* Actions — search, filter, create. No operational chrome. */}
        <div ref={actionRef} className="kb-reveal flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="kb-glass-sm flex items-center gap-2 rounded-[14px] px-3 py-2.5 ring-1 ring-white/[0.08] focus-within:ring-indigo-400/40">
            <Search className="h-4 w-4 shrink-0 text-slate-500" strokeWidth={2} />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Search tasks"
              aria-label="Search tasks"
              className="w-40 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none sm:w-52"
            />
          </div>

          {/* Filter — a single control that opens a dropdown of the filter options. */}
          <div ref={filterRef} className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={filterOpen}
              className="kb-glass-sm flex items-center gap-2 rounded-[14px] px-3.5 py-2.5 text-sm font-medium text-slate-300 ring-1 ring-white/[0.08] hover:text-white"
            >
              <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
              <span>Filter</span>
              <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-slate-300">
                {activeFilterLabel}
              </span>
            </button>
            {filterOpen && (
              <div
                role="menu"
                className="kb-glass absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-[14px] p-1.5 shadow-2xl"
              >
                {FILTER_OPTIONS.map((option) => {
                  const active = filter === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        onFilter(option.id);
                        setFilterOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-sm ${
                        active
                          ? "bg-indigo-500/15 font-semibold text-indigo-200"
                          : "text-slate-300 hover:bg-white/[0.04] hover:text-white"
                      }`}
                    >
                      <span>{option.label}</span>
                      {active && <Check className="h-3.5 w-3.5" strokeWidth={2.5} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onCreate}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-[14px] px-5 py-2.5 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            <span>Create Task</span>
          </button>
        </div>
      </div>
    </header>
  );
}
