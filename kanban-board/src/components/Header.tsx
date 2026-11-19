/**
 * Header — large page title, board description, search box, notification
 * icon, user avatar, and the gradient Create Task button.
 */

import { Search, Bell, Plus, KanbanSquare } from "lucide-react";

interface HeaderProps {
  search: string;
  onSearch: (value: string) => void;
  onCreate: () => void;
}

export function Header({ search, onSearch, onCreate }: HeaderProps) {
  return (
    <header className="relative z-10 flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="kb-glass flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
            <KanbanSquare className="kb-gradient-text h-7 w-7" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Project Board
            </h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-400">
              Track work across your team — plan, build, review and ship with a
              single, focused view.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="kb-glass-sm relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="w-56 rounded-xl border-0 bg-transparent py-2.5 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <button
            type="button"
            aria-label="Notifications"
            className="kb-glass-sm kb-btn-glow relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-300 hover:text-white"
          >
            <Bell className="h-5 w-5" strokeWidth={1.75} />
            <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-[#1e293b]" />
          </button>

          <div className="kb-glass-sm flex h-11 w-11 items-center justify-center rounded-xl text-sm font-semibold text-white">
            <span className="kb-gradient flex h-full w-full items-center justify-center rounded-xl">
              GP
            </span>
          </div>

          <button
            type="button"
            onClick={onCreate}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white"
          >
            <Plus className="h-4 w-4" strokeWidth={2.25} />
            <span className="hidden sm:inline">Create Task</span>
          </button>
        </div>
      </div>

      {/* Mobile search */}
      <div className="kb-glass-sm relative md:hidden">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="w-full rounded-xl border-0 bg-transparent py-2.5 pl-9 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
      </div>
    </header>
  );
}
