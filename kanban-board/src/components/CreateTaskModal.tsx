/**
 * CreateTaskModal — a glass modal for creating a new task with a title,
 * status, and optional assignee. Replaces the hardcoded "New Task" header
 * button behavior.
 */

import { useState, useEffect } from "react";
import { X, Plus, User } from "lucide-react";
import type { TaskStatus } from "../types/task";
import type { Agent } from "../types/ai";

interface CreateTaskModalProps {
  onClose: () => void;
  agents: Agent[];
  onCreate: (title: string, status: TaskStatus, assignee?: string | null, agentId?: string | null) => void;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string; dot: string }[] = [
  { value: "todo", label: "To Do", dot: "bg-slate-400" },
  { value: "in_progress", label: "In Progress", dot: "bg-blue-500" },
  { value: "review", label: "Review", dot: "bg-amber-500" },
  { value: "done", label: "Done", dot: "bg-emerald-500" },
];

export function CreateTaskModal({ onClose, agents, onCreate }: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [assignee, setAssignee] = useState("");
  const [agentId, setAgentId] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const submit = () => {
    const value = title.trim();
    if (!value) return;
    onCreate(value, status, assignee.trim() || null, agentId || null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-glass kb-fade-in w-full max-w-md rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Create Task</h3>
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

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Title</label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="What needs to be done?"
              className="w-full rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
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
            <label className="mb-1.5 block text-xs font-medium text-slate-400">AI agent (optional)</label>
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

        <div className="mt-6 flex items-center justify-end gap-2">
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
            disabled={!title.trim()}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} /> Create
          </button>
        </div>
      </div>
    </div>
  );
}
