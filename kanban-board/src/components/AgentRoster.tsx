/**
 * AgentRoster — the "Agents" view with full Agent Lifecycle Management.
 *
 * Lists the agent profiles visible from the OpenHands API (`GET
 * /api/agent-profiles`) and lets the user manage their lifecycle against the
 * live OpenHands server:
 *   - Create / edit a profile (upsert via `POST /api/agent-profiles/{name}`).
 *   - Activate a profile (`POST /api/agent-profiles/{id}/activate`).
 *   - Delete a profile (`DELETE /api/agent-profiles/{name}`).
 *
 * After every lifecycle operation the roster re-syncs from OpenHands so the
 * UI always reflects the live server state. Each card also carries live
 * performance metrics derived from the OpenHands execution snapshot.
 */

import {
  Bot,
  Cpu,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  PenLine,
  Save,
  X,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Host } from "../types/task";
import type { OpenHandsExecution, OpenHandsState } from "../types/openhands";
import { formatCost, formatTokens } from "../lib/ai-engine";
import {
  activateAgentProfile,
  deleteAgentProfile,
  fetchAgentProfiles,
  fetchAgentProfileDetail,
  fetchLlmProfiles,
  fetchSecrets,
  materializeAgentProfile,
  renameAgentProfile,
  saveAgentProfileFull,
  TOOL_CATALOG,
} from "../lib/openhands";
import type { AgentProfile, LlmProfile, MaterializeDiagnostics, SecretRef } from "../lib/openhands";

interface AgentRosterProps {
  host: Host;
  openHandsState: OpenHandsState;
}

/** Aggregated performance metrics for one agent or model. */
interface PerformanceMetrics {
  total: number;
  running: number;
  completed: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  /** Completed / (completed + failed), or null when there is no finished run. */
  successRate: number | null;
}

const EMPTY_METRICS: PerformanceMetrics = {
  total: 0,
  running: 0,
  completed: 0,
  failed: 0,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
  successRate: null,
};

/** Aggregate the execution snapshot into per-target performance metrics. */
function computeMetrics(executions: OpenHandsExecution[]): PerformanceMetrics {
  const metrics: PerformanceMetrics = { ...EMPTY_METRICS };
  for (const run of executions) {
    metrics.total += 1;
    if (run.status === "running") metrics.running += 1;
    if (run.status === "completed") metrics.completed += 1;
    if (run.status === "failed") metrics.failed += 1;
    metrics.tokensIn += run.tokensIn;
    metrics.tokensOut += run.tokensOut;
    metrics.cost += run.cost;
  }
  const finished = metrics.completed + metrics.failed;
  metrics.successRate = finished > 0 ? metrics.completed / finished : null;
  return metrics;
}

/** Does an execution belong to the given agent profile? */
function executionMatchesAgent(run: OpenHandsExecution, profile: AgentProfile): boolean {
  const agentId = run.agentId;
  if (!agentId) return false;
  return agentId === profile.id || agentId === profile.name;
}

/** A transient lifecycle-operation status shown in the header. */
interface SyncStatus {
  kind: "idle" | "working" | "ok" | "error";
  message: string;
}

/** Tri-state mode for a nullable list field: default (null), none ([]), custom (list). */
type ListMode = "default" | "none" | "custom";

/** Parse a comma-separated string into a trimmed, non-empty list. */
function parseList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function AgentRoster({ host, openHandsState }: AgentRosterProps) {
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [llmProfiles, setLlmProfiles] = useState<LlmProfile[]>([]);
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SyncStatus>({ kind: "idle", message: "" });

  // Create / edit form state. `editingName` is null when creating a new
  // profile, or the name of the profile being edited. The form manages the
  // full stored schema, not just the name and model binding.
  const [formOpen, setFormOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formLlmRef, setFormLlmRef] = useState("");
  const [formAgent, setFormAgent] = useState("CodeActAgent");
  const [formUseStandardTools, setFormUseStandardTools] = useState(true);
  const [formTools, setFormTools] = useState<Set<string>>(new Set());
  const [formPersona, setFormPersona] = useState("");
  const [formSystemMessageSuffix, setFormSystemMessageSuffix] = useState("");
  const [formMcpMode, setFormMcpMode] = useState<ListMode>("default");
  const [formMcpRefs, setFormMcpRefs] = useState("");
  const [formSecretMode, setFormSecretMode] = useState<ListMode>("default");
  const [formSecretRefs, setFormSecretRefs] = useState<Set<string>>(new Set());
  const [formPublicSkillsMode, setFormPublicSkillsMode] = useState<ListMode>("default");
  const [formPublicSkills, setFormPublicSkills] = useState("");
  const [formDisabledSkills, setFormDisabledSkills] = useState("");
  const [formConcurrency, setFormConcurrency] = useState("1");
  const [saving, setSaving] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  // The profile currently being deleted (for the confirmation dialog).
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // Rename dialog state.
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Materialize diagnostics for the profile currently being inspected.
  const [diagnostics, setDiagnostics] = useState<{ name: string; report: MaterializeDiagnostics } | null>(null);

  const sync = useCallback(async () => {
    const [agentProfiles, llm, secretRefs] = await Promise.all([
      fetchAgentProfiles(host),
      fetchLlmProfiles(host),
      fetchSecrets(host),
    ]);
    setProfiles(agentProfiles);
    setLlmProfiles(llm);
    setSecrets(secretRefs);
  }, [host]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [agentProfiles, llm, secretRefs] = await Promise.all([
        fetchAgentProfiles(host),
        fetchLlmProfiles(host),
        fetchSecrets(host),
      ]);
      if (cancelled) return;
      setProfiles(agentProfiles);
      setLlmProfiles(llm);
      setSecrets(secretRefs);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [host]);

  const executions = openHandsState.snapshot.executions;

  const agentMetrics = useMemo(
    () =>
      new Map(
        profiles.map((profile) => [
          profile.id,
          computeMetrics(executions.filter((run) => executionMatchesAgent(run, profile))),
        ]),
      ),
    [profiles, executions],
  );

  /** Re-sync from OpenHands and report the outcome. */
  const resync = useCallback(
    async (ok: boolean, message: string) => {
      setStatus({ kind: "working", message: "Syncing with OpenHands…" });
      await sync();
      setStatus({ kind: ok ? "ok" : "error", message });
    },
    [sync],
  );

  /** Reset the form to its create defaults. */
  const resetForm = () => {
    setFormName("");
    setFormLlmRef(llmProfiles[0]?.name ?? "");
    setFormAgent("CodeActAgent");
    setFormUseStandardTools(true);
    setFormTools(new Set());
    setFormPersona("");
    setFormSystemMessageSuffix("");
    setFormMcpMode("default");
    setFormMcpRefs("");
    setFormSecretMode("default");
    setFormSecretRefs(new Set());
    setFormPublicSkillsMode("default");
    setFormPublicSkills("");
    setFormDisabledSkills("");
    setFormConcurrency("1");
  };

  const openCreate = () => {
    setEditingName(null);
    resetForm();
    setFormOpen(true);
  };

  const openEdit = async (profile: AgentProfile) => {
    setEditingName(profile.name);
    resetForm();
    setFormName(profile.name);
    setFormLlmRef(profile.llmProfileRef ?? llmProfiles[0]?.name ?? "");
    setFormOpen(true);
    setFormLoading(true);
    const detail = await fetchAgentProfileDetail(host, profile.name);
    if (!detail) {
      setFormLoading(false);
      return;
    }
    setFormAgent(detail.agent ?? "CodeActAgent");
    if (detail.tools === null) {
      setFormUseStandardTools(true);
      setFormTools(new Set());
    } else {
      setFormUseStandardTools(false);
      setFormTools(new Set((detail.tools ?? []).map((tool) => tool.name)));
    }
    setFormPersona(detail.persona ?? "");
    setFormSystemMessageSuffix(detail.systemMessageSuffix ?? "");
    if (detail.mcpServerRefs === null || detail.mcpServerRefs === undefined) {
      setFormMcpMode("default");
      setFormMcpRefs("");
    } else if (detail.mcpServerRefs.length === 0) {
      setFormMcpMode("none");
      setFormMcpRefs("");
    } else {
      setFormMcpMode("custom");
      setFormMcpRefs(detail.mcpServerRefs.join(", "));
    }
    if (detail.secretRefs === null || detail.secretRefs === undefined) {
      setFormSecretMode("default");
      setFormSecretRefs(new Set());
    } else if (detail.secretRefs.length === 0) {
      setFormSecretMode("none");
      setFormSecretRefs(new Set());
    } else {
      setFormSecretMode("custom");
      setFormSecretRefs(new Set(detail.secretRefs));
    }
    if (detail.publicSkills === null || detail.publicSkills === undefined) {
      setFormPublicSkillsMode("default");
      setFormPublicSkills("");
    } else if (detail.publicSkills.length === 0) {
      setFormPublicSkillsMode("none");
      setFormPublicSkills("");
    } else {
      setFormPublicSkillsMode("custom");
      setFormPublicSkills(detail.publicSkills.join(", "));
    }
    setFormDisabledSkills((detail.disabledSkills ?? []).join(", "));
    setFormConcurrency(String(detail.toolConcurrencyLimit ?? 1));
    setFormLoading(false);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingName(null);
    resetForm();
  };

  /** Assemble the full AgentProfile from the current form state. */
  const buildProfile = (): AgentProfile => {
    const concurrency = Number(formConcurrency);
    return {
      id: "",
      name: formName.trim(),
      llmProfileRef: formLlmRef,
      agent: formAgent.trim() || undefined,
      tools: formUseStandardTools ? null : Array.from(formTools).map((name) => ({ name })),
      persona: formPersona,
      systemMessageSuffix: formSystemMessageSuffix,
      mcpServerRefs: formMcpMode === "default" ? null : formMcpMode === "none" ? [] : parseList(formMcpRefs),
      secretRefs: formSecretMode === "default" ? null : formSecretMode === "none" ? [] : Array.from(formSecretRefs),
      publicSkills: formPublicSkillsMode === "default" ? null : formPublicSkillsMode === "none" ? [] : parseList(formPublicSkills),
      disabledSkills: parseList(formDisabledSkills),
      toolConcurrencyLimit: Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : undefined,
    };
  };

  const handleSave = async () => {
    if (!formName.trim() || !formLlmRef.trim() || saving || formLoading) return;
    setSaving(true);
    const saved = await saveAgentProfileFull(host, formName, buildProfile());
    setSaving(false);
    if (saved) {
      await resync(true, `${editingName ? "Updated" : "Created"} agent "${saved}"`);
      closeForm();
    } else {
      setStatus({ kind: "error", message: `Failed to save agent "${formName}"` });
    }
  };

  const handleActivate = async (profile: AgentProfile) => {
    setStatus({ kind: "working", message: `Activating "${profile.name}"…` });
    const ok = await activateAgentProfile(host, profile.id);
    await resync(ok, ok ? `Activated "${profile.name}"` : `Failed to activate "${profile.name}"`);
  };

  const confirmDelete = async () => {
    if (!deletingName) return;
    const name = deletingName;
    setDeletingName(null);
    setStatus({ kind: "working", message: `Deleting "${name}"…` });
    const ok = await deleteAgentProfile(host, name);
    await resync(ok, ok ? `Deleted "${name}"` : `Failed to delete "${name}"`);
  };

  const openRename = (profile: AgentProfile) => {
    setRenamingName(profile.name);
    setRenameValue(profile.name);
  };

  const confirmRename = async () => {
    if (!renamingName) return;
    const oldName = renamingName;
    const newName = renameValue.trim();
    setRenamingName(null);
    if (!newName || newName === oldName) return;
    setStatus({ kind: "working", message: `Renaming "${oldName}"…` });
    const renamed = await renameAgentProfile(host, oldName, newName);
    await resync(!!renamed, renamed ? `Renamed "${oldName}" to "${newName}"` : `Failed to rename "${oldName}"`);
  };

  const handleMaterialize = async (profile: AgentProfile) => {
    setStatus({ kind: "working", message: `Materializing "${profile.name}"…` });
    const report = await materializeAgentProfile(host, profile.name);
    if (report) {
      setDiagnostics({ name: profile.name, report });
      setStatus({ kind: "ok", message: `Materialized "${profile.name}"` });
    } else {
      setStatus({ kind: "error", message: `Failed to materialize "${profile.name}"` });
    }
  };

  const toggleTool = (name: string) => {
    setFormTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSecret = (name: string) => {
    setFormSecretRefs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div className="relative z-10 flex flex-col gap-6">
      {/* Header row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">OpenHands Agents</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {profiles.length} agent profiles · full lifecycle management · sourced live from the
            OpenHands API
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void resync(true, "Synced with OpenHands")}
            className="kb-glass-sm kb-btn-glow flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            Sync
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
            New Agent
          </button>
        </div>
      </div>

      {/* Lifecycle status line */}
      {status.kind !== "idle" && (
        <div
          data-lifecycle-status={status.kind}
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ring-1 ${
            status.kind === "error"
              ? "bg-rose-500/10 text-rose-300 ring-rose-400/25"
              : status.kind === "ok"
                ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25"
                : "bg-slate-800/40 text-slate-300 ring-white/10"
          }`}
        >
          {status.kind === "working" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : status.kind === "ok" ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <XCircle className="h-3.5 w-3.5" />
          )}
          {status.message}
        </div>
      )}

      {/* Create / edit form — full agent-management editor */}
      {formOpen && (
        <div className="kb-glass kb-fade-in rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {editingName ? `Edit Agent — ${editingName}` : "New Agent"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              aria-label="Close form"
              className="text-slate-500 hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {formLoading ? (
            <p className="flex items-center gap-2 rounded-xl bg-slate-800/30 p-4 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading full profile…
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Identity + model binding */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Agent Name
                  </span>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. demo-researcher"
                    disabled={!!editingName}
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50"
                  />
                  {editingName && (
                    <span className="text-[10px] text-slate-600">
                      Name is fixed after creation — use Rename on the card.
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    LLM Profile
                  </span>
                  <select
                    value={formLlmRef}
                    onChange={(e) => setFormLlmRef(e.target.value)}
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    {llmProfiles.length === 0 && <option value="">No LLM profiles available</option>}
                    {llmProfiles.map((llm) => (
                      <option key={llm.name} value={llm.name}>
                        {llm.name} — {llm.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Agent Class
                  </span>
                  <input
                    type="text"
                    value={formAgent}
                    onChange={(e) => setFormAgent(e.target.value)}
                    placeholder="CodeActAgent"
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Tool Concurrency Limit
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={formConcurrency}
                    onChange={(e) => setFormConcurrency(e.target.value)}
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
              </div>

              {/* Persona + system message suffix */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Persona
                  </span>
                  <textarea
                    value={formPersona}
                    onChange={(e) => setFormPersona(e.target.value)}
                    rows={3}
                    placeholder="Describe the agent's role and behaviour…"
                    className="resize-y rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    System Message Suffix
                  </span>
                  <textarea
                    value={formSystemMessageSuffix}
                    onChange={(e) => setFormSystemMessageSuffix(e.target.value)}
                    rows={3}
                    placeholder="Appended to the system prompt…"
                    className="resize-y rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
              </div>

              {/* Tools */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Tools
                  </span>
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={formUseStandardTools}
                      onChange={(e) => setFormUseStandardTools(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900/60 text-indigo-500 focus:ring-indigo-500/50"
                    />
                    Use standard tools
                  </label>
                </div>
                {formUseStandardTools ? (
                  <p className="rounded-xl bg-slate-800/30 px-3 py-2 text-[11px] text-slate-500">
                    The agent uses the default tool set. Uncheck to pick specific tools.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {TOOL_CATALOG.map((tool) => (
                      <label
                        key={tool.name}
                        className={`flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-[11px] transition-colors ${
                          formTools.has(tool.name)
                            ? "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30"
                            : "bg-slate-900/40 text-slate-400 hover:bg-slate-900/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={formTools.has(tool.name)}
                          onChange={() => toggleTool(tool.name)}
                          className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900/60 text-indigo-500 focus:ring-indigo-500/50"
                        />
                        <span className="truncate" title={tool.name}>
                          {tool.label}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* MCP servers */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  MCP Servers
                </span>
                <div className="flex items-center gap-3">
                  <select
                    value={formMcpMode}
                    onChange={(e) => setFormMcpMode(e.target.value as ListMode)}
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value="default">Default (inherit)</option>
                    <option value="none">None</option>
                    <option value="custom">Custom</option>
                  </select>
                  {formMcpMode === "custom" && (
                    <input
                      type="text"
                      value={formMcpRefs}
                      onChange={(e) => setFormMcpRefs(e.target.value)}
                      placeholder="server-a, server-b"
                      className="flex-1 rounded-xl border-0 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  )}
                </div>
              </div>

              {/* Secrets */}
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Secrets
                </span>
                <div className="flex items-center gap-3">
                  <select
                    value={formSecretMode}
                    onChange={(e) => setFormSecretMode(e.target.value as ListMode)}
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value="default">Default (inherit)</option>
                    <option value="none">None</option>
                    <option value="custom">Custom</option>
                  </select>
                  {formSecretMode === "custom" && (
                    <div className="flex flex-1 flex-wrap gap-1.5">
                      {secrets.length === 0 && (
                        <span className="text-[11px] text-slate-600">No secrets available</span>
                      )}
                      {secrets.map((secret) => (
                        <label
                          key={secret.name}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] transition-colors ${
                            formSecretRefs.has(secret.name)
                              ? "bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-400/30"
                              : "bg-slate-900/40 text-slate-400 hover:bg-slate-900/60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={formSecretRefs.has(secret.name)}
                            onChange={() => toggleSecret(secret.name)}
                            className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900/60 text-indigo-500 focus:ring-indigo-500/50"
                          />
                          {secret.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Skills */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Public Skills
                  </span>
                  <select
                    value={formPublicSkillsMode}
                    onChange={(e) => setFormPublicSkillsMode(e.target.value as ListMode)}
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    <option value="default">Default (inherit)</option>
                    <option value="none">None</option>
                    <option value="custom">Custom</option>
                  </select>
                  {formPublicSkillsMode === "custom" && (
                    <input
                      type="text"
                      value={formPublicSkills}
                      onChange={(e) => setFormPublicSkills(e.target.value)}
                      placeholder="skill-a, skill-b"
                      className="rounded-xl border-0 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  )}
                </div>
                <label className="flex flex-col gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Disabled Skills
                  </span>
                  <input
                    type="text"
                    value={formDisabledSkills}
                    onChange={(e) => setFormDisabledSkills(e.target.value)}
                    placeholder="skill-a, skill-b"
                    className="rounded-xl border-0 bg-slate-900/60 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="kb-glass-sm rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || formLoading || !formName.trim() || !formLlmRef.trim()}
              className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" strokeWidth={2.5} />
              )}
              {editingName ? "Save Changes" : "Create Agent"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <p className="rounded-xl bg-slate-800/30 p-5 text-center text-xs text-slate-500">
          Loading agents from OpenHands…
        </p>
      )}

      {!loading && profiles.length === 0 && (
        <p className="rounded-xl bg-slate-800/30 p-5 text-center text-xs text-slate-500">
          No agents are visible from the OpenHands API.
        </p>
      )}

      {/* Agent profiles */}
      {profiles.length > 0 && (
        <section>
          <SectionTitle icon={Bot} label="Agent Profiles" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((profile) => (
              <AgentProfileCard
                key={profile.id}
                profile={profile}
                metrics={agentMetrics.get(profile.id) ?? EMPTY_METRICS}
                onEdit={() => void openEdit(profile)}
                onActivate={() => void handleActivate(profile)}
                onRename={() => openRename(profile)}
                onMaterialize={() => void handleMaterialize(profile)}
                onDelete={() => setDeletingName(profile.name)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Delete confirmation dialog */}
      {deletingName && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="kb-glass kb-fade-in w-full max-w-sm rounded-2xl p-5">
            <div className="mb-3 flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-rose-400" />
              <h3 className="text-sm font-semibold text-white">Delete Agent</h3>
            </div>
            <p className="text-xs text-slate-400">
              Delete agent <span className="font-semibold text-slate-200">{deletingName}</span> from
              OpenHands? This cannot be undone.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeletingName(null)}
                className="kb-glass-sm rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="flex items-center gap-2 rounded-xl bg-rose-500/80 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2.5} />
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename dialog */}
      {renamingName && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="kb-glass kb-fade-in w-full max-w-sm rounded-2xl p-5">
            <div className="mb-3 flex items-center gap-2">
              <Pencil className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">Rename Agent</h3>
            </div>
            <p className="mb-3 text-xs text-slate-400">
              Rename agent <span className="font-semibold text-slate-200">{renamingName}</span>.
            </p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void confirmRename();
              }}
              autoFocus
              className="w-full rounded-xl border-0 bg-slate-900/60 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingName(null)}
                className="kb-glass-sm rounded-xl px-3 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmRename()}
                disabled={!renameValue.trim() || renameValue.trim() === renamingName}
                className="flex items-center gap-2 rounded-xl bg-indigo-500/80 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2.5} />
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Materialize diagnostics panel */}
      {diagnostics && (
        <div className="kb-glass kb-fade-in rounded-2xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-white">
                Materialize Diagnostics — {diagnostics.name}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setDiagnostics(null)}
              aria-label="Close diagnostics"
              className="text-slate-500 hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {/* Validity banner */}
            <div
              className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 ${
                diagnostics.report.valid
                  ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25"
                  : "bg-rose-500/10 text-rose-300 ring-rose-400/25"
              }`}
            >
              {diagnostics.report.valid ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <XCircle className="h-3.5 w-3.5" />
              )}
              {diagnostics.report.valid ? "Profile materializes cleanly" : "Profile has materialization errors"}
            </div>

            {/* Agent kind + LLM resolution */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Agent Kind
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  {diagnostics.report.agentKind || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-900/40 px-3 py-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  LLM Profile
                </span>
                <span className="text-xs font-semibold text-slate-200">
                  {diagnostics.report.llmProfileRef ?? "—"}
                </span>
              </div>
            </div>

            {/* LLM resolution flags */}
            <div className="flex flex-wrap gap-2">
              <span
                className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold ring-1 ${
                  diagnostics.report.llmProfileResolved
                    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                    : "bg-rose-500/10 text-rose-300 ring-rose-400/20"
                }`}
              >
                {diagnostics.report.llmProfileResolved ? "LLM resolved" : "LLM not resolved"}
              </span>
              <span
                className={`rounded-lg px-2.5 py-1 text-[10px] font-semibold ring-1 ${
                  diagnostics.report.llmApiKeySet
                    ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
                    : "bg-amber-500/10 text-amber-300 ring-amber-400/20"
                }`}
              >
                {diagnostics.report.llmApiKeySet ? "API key set" : "API key missing"}
              </span>
            </div>

            {/* Errors */}
            {diagnostics.report.errors.length > 0 && (
              <div className="rounded-xl bg-rose-500/10 px-3 py-2 ring-1 ring-rose-400/20">
                <span className="text-[11px] font-medium uppercase tracking-wide text-rose-400">
                  Errors ({diagnostics.report.errors.length})
                </span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {diagnostics.report.errors.map((error, index) => (
                    <li key={index} className="text-[11px] text-rose-200">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Unusable tools */}
            {diagnostics.report.unusableTools.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 px-3 py-2 ring-1 ring-amber-400/20">
                <span className="text-[11px] font-medium uppercase tracking-wide text-amber-400">
                  Unusable Tools ({diagnostics.report.unusableTools.length})
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {diagnostics.report.unusableTools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-400/20"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Dangling MCP refs */}
            {diagnostics.report.danglingMcpServerRefs.length > 0 && (
              <div className="rounded-xl bg-amber-500/10 px-3 py-2 ring-1 ring-amber-400/20">
                <span className="text-[11px] font-medium uppercase tracking-wide text-amber-400">
                  Dangling MCP Server Refs ({diagnostics.report.danglingMcpServerRefs.length})
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {diagnostics.report.danglingMcpServerRefs.map((server) => (
                    <span
                      key={server}
                      className="rounded-lg bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300 ring-1 ring-cyan-400/20"
                    >
                      {server}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Resolved skills */}
            <div className="rounded-xl bg-slate-900/40 px-3 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Resolved Skills ({diagnostics.report.resolvedSkills.length})
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {diagnostics.report.resolvedSkills.length === 0 ? (
                  <span className="text-[11px] text-slate-600">none</span>
                ) : (
                  diagnostics.report.resolvedSkills.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-lg bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/20"
                    >
                      {skill}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Dangling meta profile ref */}
            {diagnostics.report.danglingMetaProfileRef && (
              <div className="rounded-xl bg-amber-500/10 px-3 py-2 ring-1 ring-amber-400/20">
                <span className="text-[11px] font-medium uppercase tracking-wide text-amber-400">
                  Dangling Meta Profile Ref
                </span>
                <p className="mt-1 text-[11px] text-amber-200">
                  {diagnostics.report.danglingMetaProfileRef}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionTitle({ icon: Icon, label }: { icon: typeof Bot; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-4 w-4 text-indigo-400" strokeWidth={1.75} />
      <h3 className="text-sm font-semibold tracking-tight text-slate-200">{label}</h3>
    </div>
  );
}

function AgentProfileCard({
  profile,
  metrics,
  onEdit,
  onActivate,
  onRename,
  onMaterialize,
  onDelete,
}: {
  profile: AgentProfile;
  metrics: PerformanceMetrics;
  onEdit: () => void;
  onActivate: () => void;
  onRename: () => void;
  onMaterialize: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="kb-glass kb-fade-in group relative overflow-hidden rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-12px_rgba(99,102,241,0.4)]">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-500 shadow-lg">
          <Bot className="h-5 w-5 text-white" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold text-white">{profile.name}</p>
            {profile.active && (
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-emerald-400/25">
                active
              </span>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Cpu className="h-3.5 w-3.5 text-indigo-400" />
            {profile.llmProfileRef ?? "no model bound"}
          </p>
        </div>
      </div>
      <MetricsGrid metrics={metrics} />
      {/* Lifecycle controls */}
      <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
        {!profile.active && (
          <button
            type="button"
            onClick={onActivate}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/20 hover:bg-emerald-500/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Activate
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800/50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-slate-800"
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
          Edit
        </button>
        <button
          type="button"
          onClick={onRename}
          aria-label={`Rename ${profile.name}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-800/50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 ring-1 ring-white/10 hover:bg-slate-800"
        >
          <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onMaterialize}
          aria-label={`Materialize ${profile.name}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-300 ring-1 ring-indigo-400/20 hover:bg-indigo-500/20"
        >
          <Wrench className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${profile.name}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-300 ring-1 ring-rose-400/20 hover:bg-rose-500/20"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

function MetricsGrid({ metrics }: { metrics: PerformanceMetrics }) {
  const successLabel = metrics.successRate === null ? "—" : `${Math.round(metrics.successRate * 100)}%`;
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-xs">
      <MetricCell label="Runs" value={String(metrics.total)} />
      <MetricCell
        label="Success"
        value={successLabel}
        accent={
          metrics.successRate === null
            ? undefined
            : metrics.successRate >= 0.5
              ? "text-emerald-400"
              : "text-rose-400"
        }
      />
      <MetricCell label="Cost" value={formatCost(metrics.cost)} />
      <div className="col-span-3 flex items-center justify-between text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <Loader2 className={`h-3 w-3 ${metrics.running > 0 ? "animate-spin text-blue-400" : "text-slate-600"}`} />
          {metrics.running} running
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          {metrics.completed} done
        </span>
        <span className="flex items-center gap-1">
          <XCircle className="h-3 w-3 text-rose-400" />
          {metrics.failed} failed
        </span>
        <span className="flex items-center gap-1">
          <Activity className="h-3 w-3 text-indigo-400" />
          {formatTokens(metrics.tokensIn + metrics.tokensOut)} tok
        </span>
      </div>
    </div>
  );
}

function MetricCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${accent ?? "text-slate-200"}`}>{value}</p>
    </div>
  );
}
