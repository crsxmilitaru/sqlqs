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
      className="dialog-overlay"
      data-visible={visible}
      onMouseDown={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="dialog-surface w-[400px] shadow-2xl"
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
