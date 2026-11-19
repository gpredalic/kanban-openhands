/**
 * StatsCards — a row of four glassmorphism stat cards above the columns:
 * Total Tasks, In Progress, Review, Completed. Each has an icon, a value,
 * and a hover lift.
 */

import { ListTodo, Loader, GitPullRequest, CheckCircle2 } from "lucide-react";
import type { BoardStats } from "../types/task";

interface StatsCardsProps {
  stats: BoardStats;
}

interface StatCard {
  label: string;
  value: number;
  icon: typeof ListTodo;
  accent: string;
  ring: string;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const cards: StatCard[] = [
    {
      label: "Total Tasks",
      value: stats.total,
      icon: ListTodo,
      accent: "from-slate-500/20 to-slate-400/10 text-slate-300",
      ring: "ring-slate-400/20",
    },
    {
      label: "In Progress",
      value: stats.byStatus.in_progress,
      icon: Loader,
      accent: "from-blue-500/25 to-indigo-500/10 text-blue-400",
      ring: "ring-blue-400/25",
    },
    {
      label: "Review",
      value: stats.byStatus.review,
      icon: GitPullRequest,
      accent: "from-amber-500/25 to-orange-500/10 text-amber-400",
      ring: "ring-amber-400/25",
    },
    {
      label: "Completed",
      value: stats.byStatus.done,
      icon: CheckCircle2,
      accent: "from-emerald-500/25 to-green-500/10 text-emerald-400",
      ring: "ring-emerald-400/25",
    },
  ];

  return (
    <div className="relative z-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="kb-glass kb-card group flex items-center gap-4 rounded-2xl p-4"
          >
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ${card.accent} ${card.ring}`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-2xl font-semibold tracking-tight text-white tabular-nums">
                {card.value}
              </div>
              <div className="truncate text-xs font-medium uppercase tracking-wider text-slate-400">
                {card.label}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
