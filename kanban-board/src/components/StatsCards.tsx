/**
 * StatsCards — a single, quiet metric strip above the columns.
 *
 * One flat surface, four numbers separated by hairline dividers. No icon
 * chips, no corner glows, no per-card chrome — the numbers themselves carry
 * the hierarchy. This is the editorial, Linear-style treatment: the metric
 * is the content, not a card. The four labels (Total Tasks, In Progress,
 * Review, Completed) are preserved verbatim for the render assertions.
 */

import type { BoardStats } from "../types/task";
import { useReveal } from "../hooks/useReveal";

interface StatsCardsProps {
  stats: BoardStats;
}

interface Metric {
  label: string;
  value: number;
  /** Tailwind text color for the value. */
  valueCls: string;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const ref = useReveal<HTMLDivElement>({ delay: 0 });
  const metrics: Metric[] = [
    { label: "Total Tasks", value: stats.total, valueCls: "text-slate-50" },
    { label: "In Progress", value: stats.byStatus.in_progress, valueCls: "text-blue-400" },
    { label: "Review", value: stats.byStatus.review, valueCls: "text-amber-400" },
    { label: "Completed", value: stats.byStatus.done, valueCls: "text-emerald-400" },
  ];

  return (
    <div
      ref={ref}
      className="kb-reveal kb-glass relative z-10 flex flex-wrap items-stretch divide-x divide-white/[0.06] rounded-[16px]"
    >
      {metrics.map((m) => (
        <div key={m.label} className="flex min-w-[7rem] flex-1 flex-col gap-1 px-6 py-5">
          <p className={`text-3xl font-bold tabular-nums tracking-tight ${m.valueCls}`}>
            {m.value}
          </p>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {m.label}
          </p>
        </div>
      ))}
    </div>
  );
}
