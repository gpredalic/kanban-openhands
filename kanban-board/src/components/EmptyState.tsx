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
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10">
        <Inbox className="h-5 w-5 text-slate-500" strokeWidth={1.5} />
      </div>
      <p className="text-xs font-medium text-slate-500">
        No tasks in {columnTitle}
      </p>
    </div>
  );
}
