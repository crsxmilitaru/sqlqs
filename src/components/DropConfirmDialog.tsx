import { invoke } from "@tauri-apps/api/core";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { ExplorerObjectType } from "./objectExplorerObjectMenu";
import Tooltip from "./Tooltip";

interface Props {
  database: string;
  schema: string;
  name: string;
  objectType: ExplorerObjectType;
  onClose: () => void;
  onSuccess?: () => void;
}

function objectTypeLabel(type: ExplorerObjectType): string {
  switch (type) {
    case "TABLE": return "Table";
    case "VIEW": return "View";
    case "PROCEDURE": return "Procedure";
    case "FUNCTION": return "Function";
    case "TRIGGER": return "Trigger";
    case "TYPE": return "Type";
  }
}

export default function DropConfirmDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [executing, setExecuting] = createSignal(false);
  const [success, setSuccess] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let confirmRef: HTMLButtonElement | undefined;

  onMount(() => {
    requestAnimationFrame(() => {
      setVisible(true);
      confirmRef?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !executing()) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const fullName = () => `[${props.database}].[${props.schema}].[${props.name}]`;
  const typeLabel = () => objectTypeLabel(props.objectType);

  const handleConfirm = async () => {
    setExecuting(true);
    setError(null);

    try {
      const { sql } = await invoke<{ sql: string }>("generate_object_script", {
        database: props.database,
        schema: props.schema,
        name: props.name,
        objectType: props.objectType,
        action: "script_drop",
      });
      await invoke("execute_query", { sql });
      setSuccess(true);
      setTimeout(() => {
        props.onSuccess?.();
        props.onClose();
      }, 700);
    } catch (err) {
      const message = String(err ?? "Drop failed").replace(/^Error:\s*/i, "").replace(/^Query failed:\s*/i, "");
      setError(message);
      setExecuting(false);
    }
  };

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={() => !executing() && props.onClose()}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[480px] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-error/10 text-error shrink-0">
              <i class="fa-solid fa-trash-can text-sm" />
            </div>
            <div class="flex flex-col min-w-0">
              <h2 class="text-m font-semibold text-text">Drop {typeLabel()}</h2>
              <p class="text-xs text-text-muted font-mono truncate" title={fullName()}>{fullName()}</p>
            </div>
          </div>
          <Tooltip content="Close" placement="bottom">
            <button
              type="button"
              onClick={props.onClose}
              disabled={executing()}
              class="text-text-muted hover:bg-surface-overlay hover:text-text rounded-lg w-8 h-8 flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        <div class="px-6 py-4">
          <div class="flex items-start gap-2 p-3 rounded-lg bg-error/5 border border-error/15 text-sm text-error/90">
            <i class="fa-solid fa-triangle-exclamation mt-0.5" />
            <span>
              This will permanently drop the {typeLabel().toLowerCase()}. Dependent objects will fail until updated, and this action cannot be undone.
            </span>
          </div>
        </div>

        <Show when={error()}>
          <div class="mx-6 mb-2 text-error text-sm bg-error/5 border border-error/15 rounded-lg px-3 py-2 max-h-[140px] overflow-y-auto select-text whitespace-pre-wrap">
            {error()}
          </div>
        </Show>

        <div class="flex justify-end gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <button
            type="button"
            onClick={props.onClose}
            disabled={executing()}
            class="btn btn-secondary px-6 py-1.5"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            disabled={executing() || success()}
            class={`btn px-6 py-1.5 gap-2 transition-all ${
              success()
                ? "bg-success border-success text-white"
                : "bg-error border-error text-white hover:!bg-error/90 hover:!border-error/90"
            }`}
          >
            <Show when={success()}>
              <i class="fa-solid fa-check text-[11px]" />
            </Show>
            <Show when={executing()}>
              <div class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            </Show>
            {success() ? "Dropped" : executing() ? "Dropping..." : `Drop ${typeLabel()}`}
          </button>
        </div>
      </div>
    </div>
  );
}
