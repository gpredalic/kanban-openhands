/**
 * Header — the editorial masthead.
 *
 * A small-caps eyebrow, a large quiet display title, and a single confident
 * action on the right. The whole masthead reveals on scroll (it is the first
 * thing in the viewport, so it reveals on mount). The sync indicator and
 * avatar are preserved.
 */

import { Plus } from "lucide-react";
import kanbanAiIcon from "../../icons/kanban-ai-128.svg";
import { useReveal } from "../hooks/useReveal";

interface HeaderProps {
  onCreate: () => void;
  syncing?: boolean;
}

export function Header({ onCreate, syncing = false }: HeaderProps) {
  const eyebrowRef = useReveal<HTMLParagraphElement>({ delay: 0 });
  const titleRef = useReveal<HTMLHeadingElement>({ delay: 60 });
  const subRef = useReveal<HTMLParagraphElement>({ delay: 120 });
  const actionRef = useReveal<HTMLDivElement>({ delay: 180 });

  return (
    <header className="relative z-10 flex flex-col gap-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        {/* Title block */}
        <div className="flex items-center gap-4">
          <div className="kb-glass flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px]">
            <img
              src={kanbanAiIcon}
              alt="Kanban AI"
              width={40}
              height={40}
              className="h-10 w-10"
            />
          </div>
          <div>
            <p
              ref={eyebrowRef}
              className="kb-reveal text-[0.6875rem] font-semibold uppercase tracking-[0.22em] text-slate-500"
            >
              Workspace
            </p>
            <h1
              ref={titleRef}
              className="kb-reveal mt-1 text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.02em] text-slate-50"
            >
              Kanban Board
            </h1>
            <p
              ref={subRef}
              className="kb-reveal mt-1.5 text-sm text-slate-400"
            >
              Plan, track and ship work across your team — in one place.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div ref={actionRef} className="kb-reveal flex items-center gap-3">
          {/* Sync indicator — always visible, pulses while syncing */}
          <div
            className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium ring-1 ring-white/10"
            title={syncing ? "Syncing…" : "Synced"}
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
          <div className="kb-glass flex h-10 w-10 items-center justify-center rounded-[14px] text-sm font-semibold text-white">
            GP
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
