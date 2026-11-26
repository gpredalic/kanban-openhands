/**
 * MonitoringView — the "Activity" surface.
 *
 * Outcome-focused, not operational. The user should instantly understand:
 *   - What is happening?   → the hero node, shown large.
 *   - Who is working?      → the agent name, quiet and secondary.
 *   - What is blocked?     → a blocked callout, when present.
 *   - What is next?        → the "Up Next" node.
 *
 * No technical jargon, no execution identifiers, no raw IDs. The surface is
 * quiet and editorial, closer to Apple Activity or Notion Updates than a
 * workflow monitoring screen.
 */

import { useMemo } from "react";
import {
  Activity,
  Square,
  RotateCcw,
  Play,
  AlertTriangle,
} from "lucide-react";
import type { Workflow, EnrichedTask, Agent } from "../types/ai";
import type { OpenHandsState } from "../types/openhands";
import { Badge, statusBadge } from "../lib/badges";
import { useWorkflowRouting, nodeExecState } from "../hooks/useWorkflowRouting";
import { useReveal } from "../hooks/useReveal";

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
  // is visible the moment the view opens.
  const effectiveId = selectedId ?? workflows[0]?.id ?? null;
  const workflow = workflows.find((w) => w.id === effectiveId) ?? null;

  // Engine-driven routing for the selected workflow's graph.
  const { currentNode, nextNode, path } = useWorkflowRouting(
    workflow?.nodes ?? [],
    workflow?.edges ?? [],
    openHandsState,
  );

  const { executions } = openHandsState.snapshot;
  const agentNames = useMemo(() => new Map(profiles.map((agent) => [agent.id, agent.name])), [profiles]);

  // Blocked work — tasks that are waiting on something. Shown as a quiet
  // callout so the user knows what needs attention.
  const blockedTasks = useMemo(
    () => tasks.filter((t) => t.waitingOn && t.waitingOn.length > 0),
    [tasks],
  );

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
    <div ref={rootRef} className="kb-reveal flex h-full flex-col gap-8 p-8">
      {/* Toolbar — pick which workflow to observe. Quiet, no status pill. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
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
      </div>

      {/* Hero — what is happening, shown large. The node name is the focal
          point. No gradient wash, no redundant labels. */}
      {workflow && workflow.nodes.length > 0 && (
        <div className="kb-glass relative overflow-hidden rounded-3xl p-10">
          <div className="relative">
            <p className="mb-8 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current Activity</p>
            <div className="flex flex-wrap items-end justify-between gap-8">
              <div className="min-w-0">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Now Working On</p>
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
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Up Next</p>
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
            <div className="mt-10">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Workflow Structure</p>
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

      {/* Blocked — a quiet callout when tasks are waiting on something. */}
      {blockedTasks.length > 0 && (
        <div className="kb-glass-sm flex items-center gap-3 rounded-2xl px-5 py-4">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">
              {blockedTasks.length} task{blockedTasks.length > 1 ? "s" : ""} blocked
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {blockedTasks.map((t) => t.title).join(" · ")}
            </p>
          </div>
        </div>
      )}

      {/* Active work — a quiet list of what's running, queued, or failed.
          Outcome-focused: the task title is the hero, the agent is quiet. */}
      <div className="kb-glass rounded-3xl">
        <div className="flex flex-col gap-5 p-7">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Active Work</p>
          {openHandsState.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{openHandsState.error}</div>}

          {openHandsState.loading && executions.length === 0 ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : executions.length === 0 ? (
            <p className="rounded-xl bg-white/5 px-4 py-6 text-center text-sm text-slate-500">No active work yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {executions.map((run) => {
                const agentName = run.agentId ? agentNames.get(run.agentId) ?? null : null;
                return (
                  <div key={run.id} className="kb-glass-sm flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors hover:bg-white/[0.07]">
                    {statusBadge(run.status) && (
                      <Badge style={statusBadge(run.status)!} pulse={run.status === "running" || run.status === "queued"} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-white">{run.title}</p>
                      {agentName && (
                        <p className="mt-0.5 text-xs text-slate-500">{agentName}</p>
                      )}
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
