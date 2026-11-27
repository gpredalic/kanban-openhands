/**
 * EmptyState — an elegant empty state shown when a column has no tasks.
 * Soft dashed border, a tinted icon chip, and a gentle message.
 */

import { Inbox } from "lucide-react";

interface EmptyStateProps {
  columnTitle: string;
}

export function EmptyState({ columnTitle }: EmptyStateProps) {
  return (
    <div className="kb-glass flex min-h-[140px] flex-col items-center justify-center gap-3 rounded-[18px] p-7 text-center">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.06]">
        <Inbox className="h-4 w-4 text-slate-500" strokeWidth={1.5} />
      </div>
      <p className="kb-type-body text-slate-500">
        No tasks in {columnTitle}
      </p>
      <p className="kb-type-meta text-slate-600">
        Drag a card here to move it
      </p>
    </div>
  );
}
