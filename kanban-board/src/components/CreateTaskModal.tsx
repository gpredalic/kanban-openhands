/**
 * CreateTaskModal — a glass modal for creating a new task.
 *
 * Fields: Title (required), Task Instructions (required), Expected Output,
 * Success Criteria, Status, Assignee, Priority, and AI Agent. The prompt is
 * the actual instruction sent to the AI — it is never derived from the title.
 */

import { useState, useEffect } from "react";
import { X, Plus, User, Bot } from "lucide-react";
import type { TaskStatus, TaskPriority } from "../types/task";
import type { Agent } from "../types/ai";
import { PRIORITY_STYLES } from "../lib/badges";

interface CreateTaskModalProps {
  onClose: () => void;
  agents: Agent[];
  onCreate: (
    title: string,
    status: TaskStatus,
    assignee?: string | null,
    agentId?: string | null,
    agentPrompt?: string,
    expectedOutput?: string,
    successCriteria?: string,
    priority?: TaskPriority,
  ) => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; dot: string }[] = [
  { value: "todo", label: "To Do", dot: "bg-slate-400" },
  { value: "in_progress", label: "In Progress", dot: "bg-blue-500" },
  { value: "review", label: "Review", dot: "bg-amber-500" },
  { value: "done", label: "Done", dot: "bg-emerald-500" },
];

export function CreateTaskModal({ onClose, agents, onCreate }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [assignee, setAssignee] = useState("");
  const [agentId, setAgentId] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = () => {
    const value = title.trim();
    const prompt = agentPrompt.trim();
    if (!value || !prompt) return;
    onCreate(
      value,
      status,
      assignee.trim() || null,
      agentId || null,
      prompt,
      expectedOutput.trim() || undefined,
      successCriteria.trim() || undefined,
      priority,
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-glass kb-fade-in flex max-h-[90vh] w-[80vw] max-w-[1200px] flex-col rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-white">Create Task</h3>
            <p className="mt-0.5 text-xs text-slate-400">Add a new task to the board.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white/5 hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Title <span className="text-rose-400">*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="e.g. Replace vending machine cash reader"
              className="w-full rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">
              Task Instructions <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              rows={8}
              placeholder="Describe what the AI agent should do. This is the actual instruction sent to the AI — not derived from the title."
              className="w-full resize-y rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Expected Output
              </label>
              <textarea
                value={expectedOutput}
                onChange={(e) => setExpectedOutput(e.target.value)}
                rows={5}
                placeholder="What should the agent produce? e.g. A comparison report with alternatives, supplier list, and pricing."
                className="w-full resize-y rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">
                Success Criteria
              </label>
              <textarea
                value={successCriteria}
                onChange={(e) => setSuccessCriteria(e.target.value)}
                rows={5}
                placeholder="How will you know the work is done? e.g. Report includes at least 3 alternatives with cost comparison."
                className="w-full resize-y rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Priority</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(["low", "medium", "high", "critical"] as TaskPriority[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setPriority(level)}
                    className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      priority === level
                        ? level === "critical"
                          ? "bg-red-600/20 text-red-300 ring-1 ring-red-500/40"
                          : level === "high"
                            ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/40"
                            : level === "medium"
                              ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40"
                              : "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                        : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_STYLES[level].dot}`} />
                    {PRIORITY_STYLES[level].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Status</label>
              <div className="grid grid-cols-2 gap-2">
                {STATUS_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
                      status === opt.value
                        ? "bg-indigo-500/20 text-white ring-1 ring-indigo-400/40"
                        : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${opt.dot}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <User className="h-3.5 w-3.5" /> Assignee (optional)
              </label>
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="e.g. Jane Doe"
                className="w-full rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                <Bot className="h-3.5 w-3.5" /> AI Agent (optional)
              </label>
              <select
                aria-label="AI agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-200"
              >
                <option value="">Unassigned</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name} - {agent.role}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-5 flex shrink-0 items-center justify-end gap-2 border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-2.5 text-sm text-slate-400 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim() || !agentPrompt.trim()}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} /> Create
          </button>
        </div>
      </div>
    </div>
  );
}
