import { useEffect, useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "primary";
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  variant = "primary",
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  return (
    <div
      className={`absolute top-11 inset-x-0 bottom-0 bg-black/50 flex items-center justify-center z-[100] transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      onMouseDown={onCancel}
    >
      <div
        className={`bg-surface-raised border border-white/[0.08] shadow-2xl w-[400px] rounded-2xl transition-all duration-200 ${visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.97] translate-y-2"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-5">
          <h2 className="text-base font-semibold text-text mb-2">{title}</h2>
          <p className="text-sm text-text-muted leading-relaxed">
            {message}
          </p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary px-6 py-1.5"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn btn-primary px-6 py-1.5"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
