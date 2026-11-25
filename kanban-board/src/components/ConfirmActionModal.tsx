/**
 * ConfirmActionModal — a small confirmation dialog shown before a task
 * execution action (Stop, Run Again). The user must explicitly confirm the
 * question before the action fires.
 *
 * Reusable across the board: the caller supplies the question, the confirm
 * button label, and a tone (danger for destructive actions like Stop, primary
 * for affirmative actions like Run Again).
 */

import { Square, RotateCcw, X } from "lucide-react";

interface ConfirmActionModalProps {
  open: boolean;
  /** The question shown to the user, e.g. "Are you sure you want to stop this task?" */
  question: string;
  /** Optional supporting detail explaining what the action does. */
  detail?: string;
  /** Label for the confirm button, e.g. "Stop Task" or "Run Again". */
  confirmLabel: string;
  /** Visual tone of the confirm button. */
  tone?: "danger" | "primary";
  /** Icon shown in the leading tile. */
  icon?: "stop" | "retry";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionModal({
  open,
  question,
  detail,
  confirmLabel,
  tone = "primary",
  icon = "retry",
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  if (!open) return null;

  const Icon = icon === "stop" ? Square : RotateCcw;
  const confirmCls =
    tone === "danger"
      ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40 hover:bg-rose-500/30"
      : "kb-gradient kb-btn-glow text-white";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={question}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="kb-glass kb-fade-in w-full max-w-sm rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`kb-glass-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              tone === "danger" ? "text-rose-300" : "text-indigo-300"
            }`}
          >
            <Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">{question}</h3>
            {detail && <p className="mt-1 text-xs leading-relaxed text-slate-400">{detail}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-3.5 py-2 text-sm text-slate-400 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${confirmCls}`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
