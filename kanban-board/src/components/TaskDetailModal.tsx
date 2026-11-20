/**
 * TaskDetailModal — a glass modal for editing a task's title, assignee,
 * tags, and due date, plus a delete action with confirmation.
 */

import { useState, useEffect } from "react";
import { X, Trash2, Save, Tag, Calendar, User } from "lucide-react";
import type { Task, TaskStatus } from "../types/task";
import type { Agent } from "../types/ai";

interface TaskDetailModalProps {
  task: Task;
  agents: Agent[];
  onClose: () => void;
  onSave: (taskId: string, patch: { title?: string; assignee?: string | null; agentId?: string | null }) => void;
  onDelete: (taskId: string) => void;
  onSetTags: (taskId: string, tags: string[]) => void;
  onSetDueDate: (taskId: string, dueDate: string | null) => void;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export function TaskDetailModal({
  task,
  agents,
  onClose,
  onSave,
  onDelete,
  onSetTags,
  onSetDueDate,
}: TaskDetailModalProps) {
  const [title, setTitle] = useState(task.title);
  const [assignee, setAssignee] = useState(task.assignee ?? "");
  const [agentId, setAgentId] = useState(task.agentId ?? "");
  const [tags, setTags] = useState((task.tags ?? []).join(", "));
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = () => {
    const trimmedTitle = title.trim();
    const trimmedAssignee = assignee.trim() || null;
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const trimmedAgentId = agentId || null;
    if (trimmedTitle !== task.title || trimmedAssignee !== (task.assignee ?? null) || trimmedAgentId !== (task.agentId ?? null)) {
      onSave(task.id, {
        title: trimmedTitle !== task.title ? trimmedTitle : undefined,
        assignee: trimmedAssignee !== (task.assignee ?? null) ? trimmedAssignee : undefined,
        agentId: trimmedAgentId !== (task.agentId ?? null) ? trimmedAgentId : undefined,
      });
    }
    if (tagList.join(", ") !== (task.tags ?? []).join(", ")) {
      onSetTags(task.id, tagList);
    }
    const newDue = dueDate || null;
    if (newDue !== (task.dueDate ?? null)) {
      onSetDueDate(task.id, newDue);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="kb-glass kb-fade-in w-full max-w-lg rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div>
            <span className="mb-1 inline-block rounded-full bg-indigo-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-300 ring-1 ring-indigo-400/25">
              {STATUS_LABELS[task.status]}
            </span>
            <h3 className="text-lg font-semibold text-white">Edit Task</h3>
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

        {/* Fields */}
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <User className="h-3.5 w-3.5" /> Assignee
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
            <label className="mb-1.5 block text-xs font-medium text-slate-400">AI agent</label>
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
            {agentId && (
              <p className="mt-2 text-xs text-indigo-300">
                Assigned agent: {agents.find((agent) => agent.id === agentId)?.name ?? agentId}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Tag className="h-3.5 w-3.5" /> Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. backend, api"
              className="w-full rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-400">
              <Calendar className="h-3.5 w-3.5" /> Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border-0 bg-white/5 px-3.5 py-2.5 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 [color-scheme:dark]"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onDelete(task.id);
                  onClose();
                }}
                className="rounded-xl bg-rose-500/20 px-3.5 py-2 text-sm font-medium text-rose-300 ring-1 ring-rose-400/30 hover:bg-rose-500/30"
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-xl px-3 py-2 text-sm text-slate-400 hover:bg-white/5"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
          >
            <Save className="h-4 w-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}
