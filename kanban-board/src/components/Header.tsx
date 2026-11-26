/**
 * Header — the editorial masthead.
 *
 * A small-caps eyebrow, a large quiet display title, and a focused action row
 * on the right: the Create Task button. The search field and the single Filter
 * control have been removed so the board stays focused on the work. The whole
 * masthead reveals on scroll.
 */

import { Plus } from "lucide-react";
import kanbanAiIcon from "../../icons/kanban-ai-128.svg";
import { useReveal } from "../hooks/useReveal";

interface HeaderProps {
  onCreate: () => void;
}

export function Header({ onCreate }: HeaderProps) {
  const eyebrowRef = useReveal<HTMLParagraphElement>({ delay: 0 });
  const titleRef = useReveal<HTMLHeadingElement>({ delay: 60 });
  const subRef = useReveal<HTMLParagraphElement>({ delay: 120 });
  const actionRef = useReveal<HTMLDivElement>({ delay: 180 });

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

        {/* Actions — create only. No search, no filter, no operational chrome. */}
        <div ref={actionRef} className="kb-reveal flex flex-wrap items-center gap-3">
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
