/**
 * WorkflowView — a DAG visualization of task workflows (LangGraph-style).
 *
 * Renders each workflow as a layered graph: nodes are positioned by their
 * dependency depth (layer) and input order (row). Edges are drawn as SVG
 * bezier curves connecting node centers. Node status is colour-coded by the
 * task's current status, and a running task pulses.
 */

import { useMemo } from "react";
import { GitBranch, Circle } from "lucide-react";
import { layoutWorkflow } from "../lib/ai-engine";
import type { AiState, EnrichedTask, Workflow } from "../types/ai";

interface WorkflowViewProps {
  aiState: AiState;
  tasks: EnrichedTask[];
}

/** Node dimensions in the SVG coordinate space. */
const NODE_W = 200;
const NODE_H = 64;
const LAYER_GAP = 120;
const ROW_GAP = 28;
const PAD = 24;

const STATUS_COLOR: Record<string, string> = {
  todo: "#64748b",
  in_progress: "#3b82f6",
  review: "#f59e0b",
  done: "#22c55e",
};

export function WorkflowView({ aiState, tasks }: WorkflowViewProps) {
  const { workflows } = aiState.config;
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  if (workflows.length === 0) {
    return (
      <div className="kb-glass flex flex-col items-center justify-center gap-3 rounded-3xl p-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-700/30">
          <GitBranch className="h-7 w-7 text-slate-500" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-slate-400">No workflows defined</p>
        <p className="max-w-sm text-xs text-slate-500">
          Workflows are DAGs of tasks with explicit dependencies. Create one in
          the Agents view to see it rendered here.
        </p>
      </div>
    );
  }

  return (
    <div className="relative z-10 flex flex-col gap-5">
      {workflows.map((wf) => (
        <WorkflowGraph key={wf.id} workflow={wf} tasks={tasks} taskById={taskById} />
      ))}
    </div>
  );
}

interface WorkflowGraphProps {
  workflow: Workflow;
  tasks: EnrichedTask[];
  taskById: Map<string, EnrichedTask>;
}

function WorkflowGraph({ workflow, tasks, taskById }: WorkflowGraphProps) {
  const { nodes, layers } = useMemo(
    () => layoutWorkflow(workflow, tasks),
    [workflow, tasks],
  );

  // Compute the SVG canvas size.
  const maxRow = nodes.reduce((m, n) => Math.max(m, n.row), 0);
  const width = PAD * 2 + (layers - 1) * LAYER_GAP + NODE_W;
  const height = PAD * 2 + maxRow * (NODE_H + ROW_GAP) + NODE_H;

  // Node center positions.
  const pos = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    pos.set(node.id, {
      x: PAD + node.layer * LAYER_GAP + NODE_W / 2,
      y: PAD + node.row * (NODE_H + ROW_GAP) + NODE_H / 2,
    });
  }

  return (
    <div className="kb-glass kb-fade-in rounded-3xl p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-white">
            {workflow.name}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">{workflow.description}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
            workflow.status === "active"
              ? "bg-blue-500/15 text-blue-400 ring-blue-400/25"
              : workflow.status === "completed"
                ? "bg-emerald-500/15 text-emerald-400 ring-emerald-400/25"
                : "bg-slate-500/15 text-slate-400 ring-slate-400/25"
          }`}
        >
          {workflow.status}
        </span>
      </div>

      <div className="kb-scroll overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-full"
          role="img"
          aria-label={`${workflow.name} workflow graph`}
        >
          <defs>
            <marker
              id={`arrow-${workflow.id}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
            </marker>
          </defs>

          {/* Edges */}
          {workflow.edges.map((edge, i) => {
            const from = pos.get(edge.from);
            const to = pos.get(edge.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W / 2;
            const y1 = from.y;
            const x2 = to.x - NODE_W / 2;
            const y2 = to.y;
            const midX = (x1 + x2) / 2;
            const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={i}
                d={path}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.5}
                strokeOpacity={0.6}
                markerEnd={`url(#arrow-${workflow.id})`}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const task = taskById.get(node.id);
            if (!task) return null;
            const p = pos.get(node.id)!;
            const color = STATUS_COLOR[task.status] ?? "#64748b";
            const running = task.ai.executionStatus === "running";
            return (
              <g key={node.id} transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}>
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={14}
                  fill="rgba(30,41,59,0.7)"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.7}
                  className={running ? "kb-dag-running" : ""}
                />
                <circle cx={18} cy={NODE_H / 2} r={5} fill={color} />
                <text x={34} y={NODE_H / 2 - 4} fill="#e2e8f0" fontSize={12} fontWeight={600}>
                  {task.title.length > 22 ? task.title.slice(0, 22) + "…" : task.title}
                </text>
                <text x={34} y={NODE_H / 2 + 14} fill="#64748b" fontSize={10}>
                  {task.status.replace("_", " ")}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-slate-400" /> To Do
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-blue-500" /> In Progress
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-amber-500" /> Review
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="h-3 w-3 fill-emerald-500" /> Done
        </span>
      </div>
    </div>
  );
}
