/**
 * Header — premium workspace header: large page title, board description
 * subtitle, user avatar, and a gradient Create Task button. Spacious,
 * Linear/Notion-style hero.
 */

import { Plus } from "lucide-react";
import kanbanAiIcon from "../../icons/kanban-ai-128.svg";

interface HeaderProps {
  onCreate: () => void;
  syncing?: boolean;
}

export function Header({ onCreate, syncing = false }: HeaderProps) {
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
              Kanban Board
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Plan, track and ship work across your team — in one place.
            </p>
            <p className="mt-1.5 font-mono text-[10px] leading-tight text-slate-600">
              Build: {__BUILD_TIME__} · Commit: {__COMMIT__}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Sync indicator — always visible, pulses while syncing */}
          <div
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/10"
            title={syncing ? "Syncing with OpenHands…" : "Synced"}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                syncing ? "kb-sync-dot bg-indigo-400" : "bg-emerald-400"
              }`}
            />
            <span className={syncing ? "text-indigo-300" : "text-slate-400"}>
              {syncing ? "Syncing" : "Synced"}
            </span>
          </div>
          <div className="kb-glass flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-white">
            GP
          </div>

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
    </header>
  );
}
