import { createSignal, onMount, Show } from "solid-js";
import DialogShell from "./DialogShell";

interface ConfirmDialogResult {
  suppressFuture: boolean;
}

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (result?: ConfirmDialogResult) => void;
  onCancel: (result?: ConfirmDialogResult) => void;
  variant?: "danger" | "primary";
  suppressFutureLabel?: string;
}

export default function ConfirmDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [suppressFuture, setSuppressFuture] = createSignal(false);

  let confirmRef: HTMLButtonElement | undefined;

  onMount(() => {
    requestAnimationFrame(() => {
      setVisible(true);
      confirmRef?.focus();
    });
  });

  const result = (): ConfirmDialogResult => ({
    suppressFuture: suppressFuture(),
  });

  return (
    <DialogShell
      visible={visible()}
      onClose={() => props.onCancel(result())}
      class="w-[400px] shadow-2xl"
      ariaLabel={props.title}
    >
        <div class="px-6 py-5">
          <h2 class="text-base font-semibold text-text mb-2">{props.title}</h2>
          <p class="text-sm text-text-muted leading-relaxed">{props.message}</p>
          <Show when={props.suppressFutureLabel}>
            <label class="mt-4 flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                name="suppress-future"
                checked={suppressFuture()}
                onChange={(event) =>
                  setSuppressFuture(event.currentTarget.checked)
                }
              />
              <span>{props.suppressFutureLabel}</span>
            </label>
          </Show>
        </div>

        <div class="flex justify-end gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <button
            type="button"
            onClick={() => props.onCancel(result())}
            class="btn btn-secondary px-6 py-1.5"
          >
            {props.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => props.onConfirm(result())}
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
