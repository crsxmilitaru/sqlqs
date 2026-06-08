import { createSignal, onMount } from "solid-js";
import DialogShell from "./DialogShell";

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
    <DialogShell
      visible={visible()}
      onClose={props.onCancel}
      class="w-[400px] shadow-2xl"
      ariaLabel={props.title}
    >
        <div class="px-6 py-5">
          <h2 class="text-base font-semibold text-text mb-2">{props.title}</h2>
          <p class="text-sm text-text-muted leading-relaxed">{props.message}</p>
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
            class={
              props.variant === "danger"
                ? "btn btn-danger px-6 py-1.5"
                : "btn btn-primary px-6 py-1.5"
            }
          >
            {props.confirmLabel ?? "Confirm"}
          </button>
        </div>
    </DialogShell>
  );
}
