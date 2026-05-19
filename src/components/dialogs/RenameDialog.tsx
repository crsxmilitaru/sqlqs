import { invoke } from "@tauri-apps/api/core";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { loadExecutionPreferences } from "../../lib/settings";
import type { ExplorerObjectType } from "../explorer/ObjectMenu";
import Tooltip from "../ui/Tooltip";

interface Props {
  database: string;
  schema: string;
  name: string;
  objectType: ExplorerObjectType;
  onClose: () => void;
  onSuccess?: (newName: string) => void;
}

const MAX_NAME_LEN = 128;
const INVALID_RE = /['[\]]/;

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

function buildRenameSql(
  objectType: ExplorerObjectType,
  database: string,
  schema: string,
  oldName: string,
  newName: string,
): string {
  const escape = (s: string) => s.replace(/'/g, "''");
  const quoteIdentifier = (s: string) => `[${s.replace(/]/g, "]]")}]`;
  const oldQualified = escape(
    `${quoteIdentifier(schema)}.${quoteIdentifier(oldName)}`,
  );
  const newEscaped = escape(newName);
  const qdb = quoteIdentifier(database);
  if (objectType === "TYPE") {
    return `EXEC ${qdb}.sys.sp_rename N'${oldQualified}', N'${newEscaped}', N'USERDATATYPE'`;
  }
  return `EXEC ${qdb}.sys.sp_rename N'${oldQualified}', N'${newEscaped}'`;
}

export default function RenameDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [newName, setNewName] = createSignal(props.name);
  const [executing, setExecuting] = createSignal(false);
  const [success, setSuccess] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let inputRef: HTMLInputElement | undefined;

  onMount(() => {
    requestAnimationFrame(() => {
      setVisible(true);
      inputRef?.focus();
      inputRef?.select();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !executing()) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const fullName = () =>
    `[${props.database}].[${props.schema}].[${props.name}]`;

  const validation = createMemo<string | null>(() => {
    const value = newName().trim();
    if (!value) return "Name is required.";
    if (value === props.name)
      return "New name must differ from the current name.";
    if (value.length > MAX_NAME_LEN)
      return `Name cannot exceed ${MAX_NAME_LEN} characters.`;
    if (INVALID_RE.test(value))
      return "Name cannot contain quotes or square brackets.";
    return null;
  });

  const handleConfirm = async () => {
    const trimmed = newName().trim();
    const v = validation();
    if (v) {
      setError(v);
      return;
    }

    setExecuting(true);
    setError(null);

    try {
      const sql = buildRenameSql(
        props.objectType,
        props.database,
        props.schema,
        props.name,
        trimmed,
      );
      const timeout = loadExecutionPreferences().timeoutSeconds;
      await invoke("execute_query", {
        sql,
        timeoutSeconds: timeout > 0 ? timeout : null,
      });
      setSuccess(true);
      setTimeout(() => {
        props.onSuccess?.(trimmed);
        props.onClose();
      }, 700);
    } catch (err) {
      const message = String(err ?? "Rename failed")
        .replace(/^Error:\s*/i, "")
        .replace(/^Query failed:\s*/i, "");
      setError(message);
      setExecuting(false);
    }
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (executing() || success() || validation()) return;
    handleConfirm();
  };

  const confirmDisabled = () => executing() || success() || !!validation();

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
        <form onSubmit={handleSubmit}>
          <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-accent/10 text-accent shrink-0">
                <i class="fa-solid fa-i-cursor text-sm" />
              </div>
              <div class="flex flex-col min-w-0">
                <h2 class="text-m font-semibold text-text">
                  Rename {objectTypeLabel(props.objectType)}
                </h2>
                <p
                  class="text-xs text-text-muted font-mono truncate"
                  title={fullName()}
                >
                  {fullName()}
                </p>
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

          <div class="px-6 py-4 flex flex-col gap-3">
            <label class="flex flex-col gap-1.5">
              <span class="text-xs font-medium text-text-muted">New name</span>
              <input
                ref={inputRef}
                type="text"
                value={newName()}
                onInput={(e) => {
                  setNewName(e.currentTarget.value);
                  if (error()) setError(null);
                }}
                disabled={executing() || success()}
                maxLength={MAX_NAME_LEN}
                class="px-3 py-2 rounded-md bg-surface border border-border/40 text-sm text-text font-mono outline-none focus:border-accent transition-colors disabled:opacity-60"
              />
            </label>

            <div class="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/20 text-xs text-warning/90">
              <i class="fa-solid fa-triangle-exclamation mt-0.5" />
              <span>
                <code>sp_rename</code> only updates the object's name. Other
                objects that reference it by name (procedures, views, triggers,
                etc.) will break until you ALTER them.
              </span>
            </div>
          </div>

          <Show when={error()}>
            <div class="mx-6 mb-2 text-error text-sm bg-error/5 border border-error/15 rounded-lg px-3 py-2 max-h-[120px] overflow-y-auto select-text">
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
              type="submit"
              disabled={confirmDisabled()}
              class={`btn px-6 py-1.5 gap-2 transition-all ${
                success()
                  ? "bg-success border-success text-white"
                  : "btn-primary"
              }`}
            >
              <Show when={success()}>
                <i class="fa-solid fa-check text-[11px]" />
              </Show>
              <Show when={executing()}>
                <div class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              </Show>
              {success() ? "Renamed" : executing() ? "Renaming..." : "Rename"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
