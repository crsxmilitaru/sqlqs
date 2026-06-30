import { invoke } from "@tauri-apps/api/core";
import { createSignal, onMount, Show } from "solid-js";
import { loadExecutionPreferences } from "../../lib/settings";
import type { ExplorerObjectType } from "../explorer/ObjectMenu";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";
import { Icon } from "../ui/Icons";

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
    case "TABLE":
      return "Table";
    case "VIEW":
      return "View";
    case "PROCEDURE":
      return "Procedure";
    case "FUNCTION":
      return "Function";
    case "TRIGGER":
      return "Trigger";
    case "TYPE":
      return "Type";
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

  });

  const fullName = () =>
    `[${props.database}].[${props.schema}].[${props.name}]`;
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
      const timeout = loadExecutionPreferences().timeoutSeconds;
      await invoke("execute_query", {
        sql,
        timeoutSeconds: timeout > 0 ? timeout : null,
      });
      setSuccess(true);
      setTimeout(() => {
        props.onSuccess?.();
        props.onClose();
      }, 700);
    } catch (err) {
      const message = String(err ?? "Drop failed")
        .replace(/^Error:\s*/i, "")
        .replace(/^Query failed:\s*/i, "");
      setError(message);
      setExecuting(false);
    }
  };

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[480px] shadow-2xl"
      ariaLabel={`Drop ${typeLabel()}`}
      closeOnOverlay={!executing()}
      closeOnEscape={!executing()}
    >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-error/10 text-error shrink-0">
              <Icon name="trash-can" class="text-sm" />
            </div>
            <div class="flex flex-col min-w-0">
              <h2 class="text-m font-semibold text-text">Drop {typeLabel()}</h2>
              <p
                class="text-xs text-text-muted font-mono truncate"
                title={fullName()}
              >
                {fullName()}
              </p>
            </div>
          </div>
          <DialogCloseButton onClick={props.onClose} disabled={executing()} />
        </div>

        <div class="px-6 py-4">
          <div class="flex items-start gap-2 p-3 rounded-lg bg-error/5 border border-error/15 text-sm text-error/90">
            <Icon name="triangle-exclamation" class="mt-0.5" />
            <span>
              Risky action: this will permanently drop the{" "}
              {typeLabel().toLowerCase()}. Dependent objects will fail until
              updated, and this action cannot be undone.
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
            class={`btn px-6 py-1.5 gap-2 ${success() ? "btn-success" : "btn-danger"}`}
          >
            <Show when={success()}>
              <Icon name="check" class="text-[11px]" />
            </Show>
            <Show when={executing()}>
              <div class="w-3.5 h-3.5 rounded-full border-2 border-accent-text/30 border-t-accent-text animate-spin" />
            </Show>
            {success()
              ? "Dropped"
              : executing()
                ? "Dropping…"
                : `Drop ${typeLabel()}`}
          </button>
        </div>
    </DialogShell>
  );
}
