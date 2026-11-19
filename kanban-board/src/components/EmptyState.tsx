/**
 * EmptyState — an elegant empty state shown when a column has no tasks.
 */

import { Inbox } from "lucide-react";

interface EmptyStateProps {
  columnTitle: string;
}

export function EmptyState({ columnTitle }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-700/40 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-700/30">
        <Inbox className="h-5 w-5 text-slate-500" strokeWidth={1.5} />
      </div>
      <p className="text-xs font-medium text-slate-500">
        No tasks in {columnTitle}
      </p>
    </div>
  );
}
