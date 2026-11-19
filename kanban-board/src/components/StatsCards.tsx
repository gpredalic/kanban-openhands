/**
 * StatsCards — a row of premium glass metric cards above the columns:
 * Total Tasks, In Progress, Review, Completed. Each card has an icon in a
 * tinted chip, a glass surface, and a hover lift animation.
 */

import { ListTodo, Loader, Eye, CheckCircle2 } from "lucide-react";
import type { BoardStats } from "../types/task";

interface StatsCardsProps {
  stats: BoardStats;
}

interface Metric {
  label: string;
  value: number;
  icon: typeof ListTodo;
  /** Tailwind gradient classes for the icon chip. */
  accent: string;
  /** Tailwind text color for the value. */
  valueCls: string;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const metrics: Metric[] = [
    {
      label: "Total Tasks",
      value: stats.total,
      icon: ListTodo,
      accent: "from-slate-500 to-slate-600",
      valueCls: "text-slate-100",
    },
    {
      label: "In Progress",
      value: stats.byStatus.in_progress,
      icon: Loader,
      accent: "from-blue-500 to-indigo-500",
      valueCls: "text-blue-400",
    },
    {
      label: "Review",
      value: stats.byStatus.review,
      icon: Eye,
      accent: "from-amber-500 to-orange-500",
      valueCls: "text-amber-400",
    },
    {
      label: "Completed",
      value: stats.byStatus.done,
      icon: CheckCircle2,
      accent: "from-emerald-500 to-teal-500",
      valueCls: "text-emerald-400",
    },
  ];

  return (
    <div className="relative z-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {metrics.map((m) => {
        const Icon = m.icon;
        return (
          <div
            key={m.label}
            className="kb-glass kb-card kb-fade-in group relative overflow-hidden rounded-2xl p-4"
          >
            {/* Soft corner glow that intensifies on hover. */}
            <div
              className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${m.accent} opacity-15 blur-2xl transition-opacity duration-200 group-hover:opacity-30`}
            />
            <div className="relative flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${m.accent} shadow-lg`}
              >
                <Icon className="h-5 w-5 text-white" strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <p className={`text-2xl font-bold tabular-nums tracking-tight ${m.valueCls}`}>
                  {m.value}
                </p>
                <p className="truncate text-xs font-medium text-slate-400">{m.label}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
