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
 */

import { useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  GitCommit,
  Square,
  RotateCcw,
  Play,
  ChevronUp,
  ChevronDown,
  Workflow as WorkflowIcon,
  Zap,
  FileText,
} from "lucide-react";
import type { Workflow, EnrichedTask, Agent } from "../types/ai";
import type { OpenHandsState, OpenHandsExecution } from "../types/openhands";
import { formatCost, formatTokens } from "../lib/ai-engine";
import { Badge, statusBadge } from "../lib/badges";
import { useWorkflowRouting, nodeExecState } from "../hooks/useWorkflowRouting";

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
  // Default to the first workflow when none is selected, so the routing readout
  // and orchestration panel are visible the moment the view opens.
  const effectiveId = selectedId ?? workflows[0]?.id ?? null;
  const workflow = workflows.find((w) => w.id === effectiveId) ?? null;
  const [orchOpen, setOrchOpen] = useState(true);

  // Engine-driven routing for the selected workflow's graph.
  const { currentNode, nextNode, path } = useWorkflowRouting(
    workflow?.nodes ?? [],
    workflow?.edges ?? [],
    openHandsState,
  );

  const { executions, links } = openHandsState.snapshot;
  const active = executions.filter((run) => run.status === "running").length;
  const queued = executions.filter((run) => run.status === "queued").length;
  const failed = executions.filter((run) => run.status === "failed").length;
  const completed = executions.filter((run) => run.status === "completed").length;
  const taskNames = useMemo(() => new Map(tasks.map((task) => [task.id, task.title])), [tasks]);
  const agentNames = useMemo(() => new Map(profiles.map((agent) => [agent.id, agent.name])), [profiles]);

  if (workflows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <div className="kb-glass flex h-16 w-16 items-center justify-center rounded-2xl">
          <Activity className="h-8 w-8 text-indigo-300" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-white">Nothing to track yet</h2>
          <p className="mt-1 text-sm text-slate-400">Create a workflow to see its progress and executions here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
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

      {/* Current Activity — now working on, up next, progress */}
      {workflow && workflow.nodes.length > 0 && (
        <div className="kb-glass rounded-2xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <GitCommit className="h-4 w-4 text-indigo-400" strokeWidth={2} />
            <h3 className="text-sm font-semibold text-white">Current Activity</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-[11px] font-medium text-slate-500">Now Working On</p>
              {currentNode ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${currentNode.type === "start" ? "bg-emerald-400" : currentNode.type === "end" ? "bg-slate-400" : "bg-blue-400"}`} />
                  <span className="text-sm font-medium text-white">{currentNode.label}</span>
                  {(() => {
                    const s = nodeExecState(currentNode, openHandsState);
                    return statusBadge(s) ? <Badge style={statusBadge(s)!} pulse={s === "running"} /> : null;
                  })()}
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Nothing in progress</p>
              )}
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-[11px] font-medium text-slate-500">Up Next</p>
              {nextNode ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <span className="text-sm font-medium text-white">{nextNode.label}</span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">Nothing queued</p>
              )}
            </div>
            <div className="rounded-xl bg-white/5 p-3">
              <p className="text-[11px] font-medium text-slate-500">Progress</p>
              {path.length > 0 ? (
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {path.map((n, i) => (
                    <span key={n.id} className="flex items-center gap-1">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${i === path.length - 1 ? "bg-blue-500/20 text-blue-300" : "bg-white/5 text-slate-400"}`}>
                        {n.label}
                      </span>
                      {i < path.length - 1 && <span className="text-slate-600">→</span>}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">No progress yet</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Activity panel — metrics, live executions, connections */}
      <div className="kb-glass rounded-2xl">
        <button
          type="button"
          onClick={() => setOrchOpen((open) => !open)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          aria-expanded={orchOpen}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-indigo-400" strokeWidth={2} />
            Activity
            <span className="text-[11px] font-normal text-slate-500">
              {openHandsState.lastSyncedAt === null ? "Not synced yet" : `Updated ${Math.max(0, Math.floor((Date.now() - openHandsState.lastSyncedAt) / 1000))}s ago`}
            </span>
          </span>
          {orchOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {orchOpen && (
          <div className="flex flex-col gap-4 border-t border-white/5 p-4">
            {openHandsState.error && <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-xs text-rose-300">{openHandsState.error}</div>}

            {/* Metrics */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <OrchMetric label="Active" value={active} accent="text-blue-400" />
              <OrchMetric label="Queued" value={queued} accent="text-amber-400" />
              <OrchMetric label="Failed" value={failed} accent="text-rose-400" />
              <OrchMetric label="Completed" value={completed} accent="text-emerald-400" />
            </div>

            {/* Active work */}
            <section>
              <OrchSectionTitle icon={Activity} label="Active Work" />
              <div className="flex flex-col gap-2">
                {openHandsState.loading && executions.length === 0 ? (
                  <>
                    <SkeletonRow />
                    <SkeletonRow />
                  </>
                ) : executions.length === 0 ? (
                  <OrchEmpty label="No executions reported yet." />
                ) : (
                  executions.map((run) => {
                    const etype = executionType(run);
                    const EIcon = etype.icon;
                    return (
                    <div key={run.id} className="kb-glass flex items-center gap-3 rounded-2xl px-4 py-3">
                      {statusBadge(run.status) && (
                        <Badge style={statusBadge(run.status)!} pulse={run.status === "running" || run.status === "queued"} />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-white">{run.title}</span>
                          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${etype.cls}`}>
                            <EIcon className="h-3 w-3" strokeWidth={2} />
                            {etype.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">{run.taskId ? taskNames.get(run.taskId) ?? "Untitled task" : "Workflow execution"} · {agentNames.get(run.agentId ?? "") ?? "Unassigned"}</p>
                      </div>
                      <span className="text-right text-[11px] text-slate-400">
                        {run.tokensInReported === false && run.tokensOutReported === false
                          ? "Usage not reported"
                          : `${formatTokens(run.tokensIn + run.tokensOut)} tokens`}<br />
                        {run.costReported === false ? "Cost not reported" : formatCost(run.cost)}
                      </span>
                      <div className="flex gap-1">
                        {run.status === "running" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Stop execution" onClick={() => onCommand("stop", run.id)}><Square className="h-3.5 w-3.5" /></button>}
                        {run.status === "failed" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Retry execution" onClick={() => onCommand("retry", run.id)}><RotateCcw className="h-3.5 w-3.5" /></button>}
                        {run.status === "queued" && <button className="kb-glass-sm rounded-lg p-2 text-slate-300" title="Start execution" onClick={() => onCommand("start", run.id)}><Play className="h-3.5 w-3.5" /></button>}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* Workflow structure */}
            <section>
              <OrchSectionTitle icon={GitCommit} label="Workflow Structure" />
              <div className="kb-glass rounded-2xl p-4">
                <p className="mb-3 text-xs text-slate-500">How your tasks and agents relate to each other.</p>
                <div className="flex flex-wrap gap-2">
                  {links.length === 0 && <OrchEmpty label="Workflow structure will appear as work is reported." />}
                  {links.slice(0, 40).map((link) => <span key={`${link.from.id}-${link.to.id}-${link.relation}`} className="rounded-lg bg-slate-800/70 px-3 py-2 text-[11px] text-slate-300">{link.from.label} <span className="text-indigo-400">→ {link.relation} →</span> {link.to.label}</span>)}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Orchestration panel sub-components.
 * ------------------------------------------------------------------ */

function OrchMetric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="kb-glass rounded-2xl p-3">
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{label}</p>
    </div>
  );
}

function OrchSectionTitle({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <Icon className="h-4 w-4 text-indigo-400" strokeWidth={2} />
      <h3 className="text-sm font-semibold text-white">{label}</h3>
    </div>
  );
}

function OrchEmpty({ label }: { label: string }) {
  return <p className="rounded-xl bg-white/5 px-4 py-6 text-center text-xs text-slate-500">{label}</p>;
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
