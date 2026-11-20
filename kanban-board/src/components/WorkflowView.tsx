/**
 * WorkflowView — a DAG visualization of task workflows (LangGraph-style).
 *
 * Renders each workflow as a layered graph: nodes are positioned by their
 * dependency depth (layer) and input order (row). Edges are drawn as SVG
 * bezier curves connecting node centers. Node status is colour-coded by the
 * task's current status, and a running task pulses.
 */

import { useMemo, useState } from "react";
import { GitBranch, Circle } from "lucide-react";
import { layoutWorkflow } from "../lib/ai-engine";
import type { AiState, EnrichedTask, Workflow } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";

interface WorkflowViewProps {
  aiState: AiState;
  tasks: EnrichedTask[];
  onCreate: (workflow: Workflow) => void;
  onUpdate?: (workflow: Workflow) => void;
  onDelete?: (workflowId: string) => void;
  openHandsState?: OpenHandsState;
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

export function WorkflowView({ aiState, tasks, onCreate, onUpdate, onDelete, openHandsState }: WorkflowViewProps) {
  const { workflows } = aiState.config;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
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
        {creating ? (
          <div className="flex gap-2">
            <input aria-label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white" />
            <button type="button" onClick={() => {
              if (!name.trim()) return;
              onCreate({ id: `wf-${Date.now()}`, name: name.trim(), description: "User-created task workflow", nodeIds: tasks.map((task) => task.id), edges: [], status: "draft" });
              setCreating(false); setName("");
            }} className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white">Create</button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-indigo-500/20 px-3 py-2 text-xs font-semibold text-indigo-300">Create workflow</button>
        )}
      </div>
    );
  }

  return (
    <div className="relative z-10 flex flex-col gap-5">
      <div className="flex justify-end">
        {creating ? (
          <div className="flex gap-2">
            <input aria-label="Workflow name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Workflow name" className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white" />
            <button type="button" onClick={() => {
              if (!name.trim()) return;
              onCreate({ id: `wf-${Date.now()}`, name: name.trim(), description: "User-created task workflow", nodeIds: tasks.map((task) => task.id), edges: [], status: "draft" });
              setCreating(false); setName("");
            }} className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white">Create</button>
          </div>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-indigo-500/20 px-3 py-2 text-xs font-semibold text-indigo-300">Create workflow</button>
        )}
      </div>
      {workflows.map((wf) => (
        <WorkflowGraph
          key={wf.id}
          workflow={wf}
          tasks={tasks}
          taskById={taskById}
          onUpdate={onUpdate}
          onDelete={onDelete}
          openHandsState={openHandsState}
        />
      ))}
    </div>
  );
}

interface WorkflowGraphProps {
  workflow: Workflow;
  tasks: EnrichedTask[];
  taskById: Map<string, EnrichedTask>;
  onUpdate?: (workflow: Workflow) => void;
  onDelete?: (workflowId: string) => void;
  openHandsState?: OpenHandsState;
}

function WorkflowGraph({ workflow, tasks, taskById, onUpdate, onDelete, openHandsState }: WorkflowGraphProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [status, setStatus] = useState<Workflow["status"]>(workflow.status);
  const [nodeIds, setNodeIds] = useState<string[]>(workflow.nodeIds);
  const [edges, setEdges] = useState<Workflow["edges"]>(workflow.edges);
  const [edgeFrom, setEdgeFrom] = useState(workflow.nodeIds[0] ?? "");
  const [edgeTo, setEdgeTo] = useState(workflow.nodeIds[1] ?? "");
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
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-lg bg-indigo-500/20 px-3 py-1.5 text-xs font-semibold text-indigo-300">
            {editing ? "Close editor" : "Edit workflow"}
          </button>
          {onDelete && <button type="button" onClick={() => onDelete(workflow.id)} className="rounded-lg bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300">Delete</button>}
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
      </div>

      {editing && (
        <div className="mb-4 rounded-2xl border border-white/5 bg-slate-950/20 p-4">
          <h4 className="mb-3 text-sm font-semibold text-white">Workflow Editor</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <input aria-label="Workflow name" value={name} onChange={(event) => setName(event.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white" />
            <select aria-label="Workflow status" value={status} onChange={(event) => setStatus(event.target.value as Workflow["status"])} className="rounded-lg border border-white/10 bg-slate-900 px-3 py-2 text-xs text-white">
              <option value="draft">draft</option><option value="active">active</option><option value="completed">completed</option>
            </select>
          </div>
          <div className="mt-3">
            <p className="mb-2 text-xs text-slate-400">Nodes</p>
            <div className="flex flex-wrap gap-2">
              {tasks.map((task) => (
                <label key={task.id} className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-2 py-1 text-xs text-slate-300">
                  <input type="checkbox" checked={nodeIds.includes(task.id)} onChange={(event) => setNodeIds((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} />
                  {task.title}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <p className="mb-2 text-xs text-slate-400">Node dependencies</p>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Dependency from" value={edgeFrom} onChange={(event) => setEdgeFrom(event.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
                {nodeIds.map((id) => <option key={id} value={id}>{taskById.get(id)?.title ?? id}</option>)}
              </select>
              <span className="text-xs text-slate-500">depends on</span>
              <select aria-label="Dependency to" value={edgeTo} onChange={(event) => setEdgeTo(event.target.value)} className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs text-white">
                {nodeIds.map((id) => <option key={id} value={id}>{taskById.get(id)?.title ?? id}</option>)}
              </select>
              <button type="button" onClick={() => {
                if (!edgeFrom || !edgeTo || edgeFrom === edgeTo) return;
                if (!edges.some((edge) => edge.from === edgeFrom && edge.to === edgeTo)) setEdges((current) => [...current, { from: edgeFrom, to: edgeTo }]);
              }} className="rounded-lg bg-indigo-500/20 px-2 py-1.5 text-xs text-indigo-300">Add dependency</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {edges.map((edge, index) => (
                <button key={`${edge.from}-${edge.to}`} type="button" onClick={() => setEdges((current) => current.filter((_, i) => i !== index))} className="rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-slate-300" title="Remove dependency">
                  {taskById.get(edge.from)?.title ?? edge.from} → {taskById.get(edge.to)?.title ?? edge.to} ×
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => onUpdate?.({ ...workflow, name: name.trim() || workflow.name, status, nodeIds, edges })} className="mt-4 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white">Save workflow</button>
        </div>
      )}

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
            const execution = openHandsState?.snapshot.executions.find((run) => run.taskId === task.id);
            const executionStatus = execution?.status;
            const color = executionStatus === "running"
              ? "#3b82f6"
              : executionStatus === "failed" || executionStatus === "cancelled"
                ? "#f43f5e"
                : executionStatus === "completed"
                  ? "#22c55e"
                  : executionStatus === "queued"
                    ? "#a855f7"
                    : STATUS_COLOR[task.status] ?? "#64748b";
            const running = executionStatus === "running";
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
                  {executionStatus ?? task.status.replace("_", " ")}
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
