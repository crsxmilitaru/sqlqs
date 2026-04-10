import { createSignal, onMount } from "solid-js";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "primary";
}

export default function ConfirmDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={props.onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[400px] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="px-6 py-5">
          <h2 class="text-base font-semibold text-text mb-2">{props.title}</h2>
          <p class="text-sm text-text-muted leading-relaxed">
            {props.message}
          </p>
        </div>

        <div class="flex justify-end gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <button
            type="button"
            onClick={props.onCancel}
            class="btn btn-secondary px-6 py-1.5"
          >
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            class="btn btn-primary px-6 py-1.5"
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
