/**
 * Header — premium workspace header: large page title, board description
 * subtitle, search box, notification icon, user avatar, and a gradient
 * Create Task button. Spacious, Linear/Notion-style hero.
 */

import { Search, Bell, Plus, Play, Square } from "lucide-react";
import kanbanAiIcon from "../../icons/kanban-ai-128.svg";

interface HeaderProps {
  search: string;
  onSearch: (value: string) => void;
  onCreate: () => void;
  /** Whether the AI orchestration loop is currently running. */
  orchestrationRunning: boolean;
  /** Toggle the AI orchestration loop on/off. */
  onToggleOrchestration: () => void;
  notifications: Array<{ id: string; title: string; detail: string; at: number; read: boolean }>;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
}

export function Header({
  search,
  onSearch,
  onCreate,
  orchestrationRunning,
  onToggleOrchestration,
  notifications,
  notificationsOpen,
  onToggleNotifications,
}: HeaderProps) {
  const unread = notifications.filter((item) => !item.read).length;
  return (
    <header className="relative z-10 flex flex-col gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        {/* Title block */}
        <div className="flex items-center gap-4">
          <div className="kb-glass flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
            <img
              src={kanbanAiIcon}
              alt="Kanban AI"
              width={40}
              height={40}
              className="h-10 w-10"
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Project Board
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Plan, track and ship work across your team — in one place.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <div className="kb-glass-sm relative hidden md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              className="w-64 rounded-xl border-0 bg-transparent py-2.5 pl-10 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <button
            type="button"
            aria-label="Notifications"
            data-notifications-open={notificationsOpen ? "true" : "false"}
            onClick={onToggleNotifications}
            className="kb-glass-sm kb-btn-glow relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:text-slate-200"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
            {unread > 0 && (
              <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-[#111827]">
                {unread}
              </span>
            )}
          </button>

          <div className="kb-glass flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-white">
            GP
          </div>

          <button
            type="button"
            onClick={onToggleOrchestration}
            aria-pressed={orchestrationRunning}
            className={`kb-btn-glow flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              orchestrationRunning
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30 hover:bg-emerald-500/25"
                : "kb-glass-sm text-slate-300 hover:text-white"
            }`}
          >
            {orchestrationRunning ? (
              <Square className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <Play className="h-4 w-4" strokeWidth={2.5} />
            )}
            <span className="hidden sm:inline">
              {orchestrationRunning ? "Stop AI" : "Run AI"}
            </span>
          </button>

          <button
            type="button"
            onClick={onCreate}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            <span>Create Task</span>
          </button>
        </div>
      </div>
      {notificationsOpen && (
        <div
          data-notifications-panel="open"
          aria-label="Notification surface"
          className="absolute right-32 top-16 z-[70] w-80 rounded-2xl bg-slate-950/95 p-3 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
        >
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <span className="text-[10px] text-slate-500">{notifications.length} items</span>
          </div>
          {notifications.length === 0 ? (
            <p className="rounded-xl bg-white/5 px-3 py-6 text-center text-xs text-slate-500">No notifications</p>
          ) : (
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {notifications.map((item) => (
                <div key={item.id} className="rounded-xl px-3 py-2.5 hover:bg-white/5">
                  <p className="text-xs font-semibold text-slate-200">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{item.detail}</p>
                  <p className="mt-1 text-[9px] text-slate-600">{new Date(item.at).toLocaleTimeString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mobile search */}
      <div className="kb-glass-sm relative md:hidden">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          className="w-full rounded-xl border-0 bg-transparent py-2.5 pl-10 pr-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        />
      </div>
    </header>
  );
}
