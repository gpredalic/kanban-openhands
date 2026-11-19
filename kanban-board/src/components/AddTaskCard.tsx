/**
 * AddTaskCard — a dashed-border "+ Add Task" button at the bottom of each
 * column. Expands into an inline form on click.
 */

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { TaskStatus } from "../types/task";

interface AddTaskCardProps {
  status: TaskStatus;
  columnTitle: string;
  onCreate: (title: string, status: TaskStatus) => void;
}

export function AddTaskCard({ status, columnTitle, onCreate }: AddTaskCardProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const submit = () => {
    const value = title.trim();
    if (value) {
      onCreate(value, status);
      setTitle("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kb-add flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-slate-400 hover:text-slate-200"
      >
        <Plus className="h-4 w-4" strokeWidth={2.25} />
        Add Task
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="kb-glass kb-fade-in flex flex-col gap-2 rounded-2xl p-3"
    >
      <input
        autoFocus
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Task title…"
        aria-label={`Add a task to ${columnTitle}`}
        className="w-full rounded-lg border-0 bg-slate-800/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-700/50 hover:text-slate-300"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="submit"
          className="kb-gradient kb-btn-glow flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
          Add
        </button>
      </div>
    </form>
  );
}
