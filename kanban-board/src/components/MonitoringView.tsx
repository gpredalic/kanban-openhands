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
        <div className="kb-glass relative overflow-hidden rounded-3xl p-12">
          <div className="relative">
            <p className="mb-10 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">Current Activity</p>
            <div className="flex flex-wrap items-end justify-between gap-10">
              <div className="min-w-0">
                <p className="mb-4 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">Now Working On</p>
                {currentNode ? (
                  <div className="flex items-center gap-5">
                    <span className={`h-3.5 w-3.5 shrink-0 rounded-full ${currentNode.type === "start" ? "bg-emerald-400" : currentNode.type === "end" ? "bg-slate-400" : "bg-blue-400"}`} />
                    <span className="truncate text-5xl font-bold tracking-tight text-white">{currentNode.label}</span>
                    {(() => {
                      const s = nodeExecState(currentNode, openHandsState);
                      return statusBadge(s) ? <Badge style={statusBadge(s)!} pulse={s === "running"} /> : null;
                    })()}
                  </div>
                ) : (
                  <p className="text-5xl font-bold tracking-tight text-slate-600">Nothing in progress</p>
                )}
              </div>
              {/* Up Next — a quiet secondary callout. */}
              <div className="shrink-0">
                <p className="mb-4 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">Up Next</p>
                {nextNode ? (
                  <div className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="text-xl font-bold text-slate-200">{nextNode.label}</span>
                  </div>
                ) : (
                  <p className="text-xl text-slate-500">Nothing queued</p>
                )}
              </div>
            </div>

            {/* Progress — a visual stepper of the full execution path.
                A horizontal line with dots: filled = completed, ring = current,
                hollow = upcoming. Labels sit below. The line fills proportionally. */}
            <div className="mt-14">
              <p className="mb-8 text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">Workflow Structure</p>
              {path.length > 0 ? (
                <div className="relative">
                  {/* Background line */}
                  <div className="absolute left-0 right-0 top-[7px] h-px bg-white/10" />
                  {/* Progress line — fills the full path width. The path only
                      includes nodes up to the current one, so the line extends
                      as the workflow progresses. */}
                  {path.length > 1 && (
                    <div className="absolute left-0 top-[7px] h-px w-full bg-blue-400/60" />
                  )}
                  <div className="relative flex justify-between">
                    {path.map((n, i) => {
                      const isLast = i === path.length - 1;
                      const isCurrent = isLast;
                      return (
                        <div key={n.id} className="flex flex-col items-center gap-3">
                          <span
                            className={`h-3.5 w-3.5 rounded-full transition-colors ${
                              isCurrent
                                ? "bg-blue-400 ring-4 ring-blue-400/20"
                                : "bg-slate-600"
                            }`}
                          />
                          <span
                            className={`text-sm ${
                              isCurrent
                                ? "font-semibold text-white"
                                : "font-normal text-slate-500"
                            }`}
                          >
                            {n.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xl text-slate-500">No progress yet</p>
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
        <div className="flex flex-col gap-6 p-10">
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-slate-500">Active Work</p>
          {openHandsState.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{openHandsState.error}</div>}

          {openHandsState.loading && executions.length === 0 ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : executions.length === 0 ? (
            <p className="rounded-xl bg-white/5 px-4 py-8 text-center text-base text-slate-500">No active work yet.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {executions.map((run) => {
                const agentName = run.agentId ? agentNames.get(run.agentId) ?? null : null;
                return (
                  <div key={run.id} className="kb-glass-sm flex items-center gap-5 rounded-2xl px-6 py-5 transition-colors hover:bg-white/[0.07]">
                    {statusBadge(run.status) && (
                      <Badge style={statusBadge(run.status)!} pulse={run.status === "running" || run.status === "queued"} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold text-white">{run.title}</p>
                      {agentName && (
                        <p className="mt-1 text-sm text-slate-500">{agentName}</p>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      {run.status === "running" && <button className="kb-glass-sm rounded-lg p-2.5 text-slate-300" title="Stop" onClick={() => onCommand("stop", run.id)}><Square className="h-4 w-4" /></button>}
                      {run.status === "failed" && <button className="kb-glass-sm rounded-lg p-2.5 text-slate-300" title="Retry" onClick={() => onCommand("retry", run.id)}><RotateCcw className="h-4 w-4" /></button>}
                      {run.status === "queued" && <button className="kb-glass-sm rounded-lg p-2.5 text-slate-300" title="Start" onClick={() => onCommand("start", run.id)}><Play className="h-4 w-4" /></button>}
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
