/**
 * ConfirmResetModal — a small confirmation dialog shown before a destructive
 * reset (clearing analytics metrics or execution history). The user must
 * explicitly confirm the question before the reset fires.
 */

import { RotateCcw, X } from "lucide-react";

interface ConfirmResetModalProps {
  open: boolean;
  /** The question shown to the user. */
  question: string;
  /** Supporting detail explaining what the reset does. */
  detail: string;
  /** Label for the confirm button, e.g. "Reset Metrics". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmResetModal({
  open,
  question,
  detail,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmResetModalProps) {
  if (!open) return null;
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
          <div className="kb-glass-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-amber-300">
            <RotateCcw className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-white">{question}</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{detail}</p>
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
            className="kb-gradient kb-btn-glow flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} />
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
