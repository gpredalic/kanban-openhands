/**
 * MonitoringView — the operational / observability area for workflows.
 *
 * The Workflow Builder is a pure authoring surface: nodes, connections, and
 * routing rules. Everything operational — the live execution routing, the
 * orchestration metrics, the live executions, and the knowledge graph — lives
 * here, in a separate view, so the builder stays clean.
 *
 * Routing is engine-driven: the same useWorkflowRouting hook the builder canvas
 * uses to highlight live nodes/edges computes the current node, next node, and
 * execution path shown here. Nothing is orchestrated separately.
 *
 * Design: a single hero readout. The node the workflow is working on is shown
 * large, with a visual progress stepper of the full execution path and the
 * next node called out. No technical jargon, no gradient wash, no redundant
 * labels. The surface is quiet and editorial.
 */

import { useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Square,
  RotateCcw,
  Play,
  Workflow as WorkflowIcon,
  Zap,
  FileText,
} from "lucide-react";
import type { Workflow, EnrichedTask, Agent } from "../types/ai";
import type { OpenHandsState, OpenHandsExecution } from "../types/openhands";
import { Badge, statusBadge } from "../lib/badges";
import { useWorkflowRouting, nodeExecState } from "../hooks/useWorkflowRouting";
import { useReveal } from "../hooks/useReveal";

/** Derive the execution type label from its identifiers. */
function executionType(run: OpenHandsExecution): { label: string; icon: LucideIcon; cls: string } {
  if (run.workflowId) return { label: "Workflow", icon: Zap, cls: "bg-indigo-500/15 text-indigo-300 ring-indigo-400/30" };
  if (run.taskId) return { label: "Task", icon: FileText, cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" };
  return { label: "Workflow", icon: WorkflowIcon, cls: "bg-amber-500/15 text-amber-300 ring-amber-400/30" };
}

interface MonitoringViewProps {
  workflows: Workflow[];
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  openHandsState: OpenHandsState;
  tasks: EnrichedTask[];
  profiles: Agent[];
  /** Per-execution command (start / stop / retry) — task-centric, never global. */
  onCommand: (command: "start" | "stop" | "retry", executionId: string) => void;
}

export function MonitoringView({
  workflows,
  selectedId,
  onSelectId,
  openHandsState,
  tasks,
  profiles,
  onCommand,
}: MonitoringViewProps) {
  const rootRef = useReveal<HTMLDivElement>();
  // Default to the first workflow when none is selected, so the routing readout
  // and orchestration panel are visible the moment the view opens.
  const effectiveId = selectedId ?? workflows[0]?.id ?? null;
  const workflow = workflows.find((w) => w.id === effectiveId) ?? null;

  // Engine-driven routing for the selected workflow's graph.
  const { currentNode, nextNode, path } = useWorkflowRouting(
    workflow?.nodes ?? [],
    workflow?.edges ?? [],
    openHandsState,
  );

  const { executions } = openHandsState.snapshot;
  const taskNames = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks]);
  const agentNames = useMemo(() => new Map(profiles.map((agent) => [agent.id, agent.name])), [profiles]);

  if (workflows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="kb-glass flex h-16 w-16 items-center justify-center rounded-2xl">
          <Activity className="h-8 w-8 text-indigo-300" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-white">Nothing to track yet</h2>
          <p className="mt-1 text-sm text-slate-400">Create a workflow to see its progress and executions here.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="kb-reveal flex h-full flex-col gap-6 p-8">
      {/* Toolbar — pick which workflow to observe */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={effectiveId ?? ""}
            onChange={(e) => onSelectId(e.target.value)}
            aria-label="Select workflow to monitor"
            className="kb-glass-sm rounded-xl border-0 bg-transparent px-3 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          >
            {workflows.map((w) => (
              <option key={w.id} value={w.id} className="bg-slate-900">
                {w.name}
              </option>
            ))}
          </select>
          {workflow && (
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${workflow.status === "active" ? "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30" : workflow.status === "completed" ? "bg-slate-500/15 text-slate-300 ring-slate-400/30" : "bg-amber-500/15 text-amber-300 ring-amber-400/30"}`}>
              {workflow.status}
            </span>
          )}
        </div>
      </div>

      {/* Hero — the node the workflow is working on, shown large. No gradient
          wash, no redundant labels. The node name is the focal point. */}
      {workflow && workflow.nodes.length > 0 && (
        <div className="kb-glass relative overflow-hidden rounded-3xl p-8">
          <div className="relative">
            <p className="mb-6 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Activity</p>
            {/* Now Working On — the focal node, shown very large. */}
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="min-w-0">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Now Working On</p>
                {currentNode ? (
                  <div className="flex items-center gap-4">
                    <span className={`h-3 w-3 rounded-full ${currentNode.type === "start" ? "bg-emerald-400" : currentNode.type === "end" ? "bg-slate-400" : "bg-blue-400"}`} />
                    <span className="truncate text-4xl font-bold tracking-tight text-white">{currentNode.label}</span>
                    {(() => {
                      const s = nodeExecState(currentNode, openHandsState);
                      return statusBadge(s) ? <Badge style={statusBadge(s)!} pulse={s === "running"} /> : null;
                    })()}
                  </div>
                ) : (
                  <p className="text-4xl font-bold tracking-tight text-slate-600">Nothing in progress</p>
                )}
              </div>
              {/* Up Next — a quiet secondary callout. */}
              <div className="shrink-0">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Up Next</p>
                {nextNode ? (
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span className="text-base font-semibold text-slate-200">{nextNode.label}</span>
                  </div>
                ) : (
                  <p className="text-base text-slate-500">Nothing queued</p>
                )}
              </div>
            </div>

            {/* Progress — a visual stepper of the full execution path. */}
            <div className="mt-8">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workflow Structure</p>
              <p className="mb-3 text-xs text-slate-500">Progress</p>
              {path.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {path.map((n, i) => (
                    <span key={n.id} className="flex items-center gap-2">
                      <span className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ring-1 ${i === path.length - 1 ? "bg-blue-500/20 text-blue-200 ring-blue-400/40" : "bg-white/5 text-slate-400 ring-white/10"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${i === path.length - 1 ? "bg-blue-400" : "bg-slate-600"}`} />
                        {n.label}
                      </span>
                      {i < path.length - 1 && <span className="text-slate-600">→</span>}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-base text-slate-500">No progress yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active executions — a quiet list of what's running, queued, or failed. */}
      <div className="kb-glass rounded-3xl">
        <div className="flex flex-col gap-4 p-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active Work</p>
          {openHandsState.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{openHandsState.error}</div>}

          {openHandsState.loading && executions.length === 0 ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : executions.length === 0 ? (
            <p className="rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-slate-500">No executions yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {executions.map((run) => {
                const etype = executionType(run);
                const EIcon = etype.icon;
                return (
                  <div key={run.id} className="kb-glass-sm flex items-center gap-3 rounded-2xl px-4 py-3 transition-colors hover:bg-white/[0.07]">
                    {statusBadge(run.status) && (
                      <Badge style={statusBadge(run.status)!} pulse={run.status === "running" || run.status === "queued"} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">{run.title}</span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${etype.cls}`}>
                          <EIcon className="h-3 w-3" strokeWidth={2} />
                          {etype.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {run.taskId ? taskNames.get(run.taskId) ?? "Untitled" : "Workflow"} · {agentNames.get(run.agentId ?? "") ?? "—"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {run.status === "running" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Stop" onClick={() => onCommand("stop", run.id)}><Square className="h-3.5 w-3.5" /></button>}
                      {run.status === "failed" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Retry" onClick={() => onCommand("retry", run.id)}><RotateCcw className="h-3.5 w-3.5" /></button>}
                      {run.status === "queued" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Start" onClick={() => onCommand("start", run.id)}><Play className="h-3.5 w-3.5" /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2.5">
      <div className="h-3 w-3 animate-pulse rounded-full bg-slate-600/60" />
      <div className="h-3 flex-1 animate-pulse rounded bg-slate-600/40" />
      <div className="h-3 w-10 animate-pulse rounded bg-slate-600/40" />
    </div>
  );
}
