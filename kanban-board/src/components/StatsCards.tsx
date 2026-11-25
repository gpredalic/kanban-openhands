/**
 * StatsCards — a bento grid of neumorphic metric cards above the columns:
 * Total Tasks (a wide hero cell), In Progress, Review, Completed. Each cell
 * has an icon in a tinted chip and reveals on scroll with a staggered
 * cascade. The asymmetric span is the editorial bento rhythm.
 */

import { ListTodo, Loader, Eye, CheckCircle2 } from "lucide-react";
import type { BoardStats } from "../types/task";
import { useReveal } from "../hooks/useReveal";

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
  /** Whether this cell spans two columns (the hero metric). */
  wide?: boolean;
}

export function StatsCards({ stats }: StatsCardsProps) {
  const metrics: Metric[] = [
    {
      label: "Total Tasks",
      value: stats.total,
      icon: ListTodo,
      accent: "from-slate-500 to-slate-600",
      valueCls: "text-slate-50",
      wide: true,
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
    <div className="kb-bento relative z-10">
      {metrics.map((m, i) => (
        <MetricCell key={m.label} metric={m} delay={i * 70} />
      ))}
    </div>
  );
}

function MetricCell({ metric, delay }: { metric: Metric; delay: number }) {
  const ref = useReveal<HTMLDivElement>({ delay });
  const Icon = metric.icon;
  return (
    <div
      ref={ref}
      className={`kb-reveal kb-glass kb-card kb-fade-in group relative overflow-hidden rounded-[20px] p-5 ${
        metric.wide ? "kb-bento--wide" : ""
      }`}
    >
      {/* Soft corner glow that intensifies on hover. */}
      <div
        className={`absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${metric.accent} opacity-15 blur-2xl transition-opacity duration-300 group-hover:opacity-30`}
      />
      <div className="relative flex items-center gap-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br ${metric.accent} shadow-lg`}
        >
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <p className={`text-3xl font-extrabold tabular-nums tracking-tight ${metric.valueCls}`}>
            {metric.value}
          </p>
          <p className="truncate text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
            {metric.label}
          </p>
        </div>
      </div>
    </div>
  );
}
