import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { QueryResult } from "../lib/types";
import type { ExplorerObjectType } from "./objectExplorerObjectMenu";
import Tooltip from "./Tooltip";

interface Props {
  database: string;
  schema: string;
  name: string;
  objectType: ExplorerObjectType;
  onClose: () => void;
}

interface PropertyEntry {
  label: string;
  value: string;
  raw: string | number | boolean | null;
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

function objectTypeIcon(type: ExplorerObjectType): string {
  switch (type) {
    case "TABLE": return "fa-table";
    case "VIEW": return "fa-eye";
    case "PROCEDURE": return "fa-cog";
    case "FUNCTION": return "fa-superscript";
    case "TRIGGER": return "fa-bolt";
    case "TYPE": return "fa-shapes";
  }
}

function formatColumnLabel(name: string): string {
  return name
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatCellValue(name: string, value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "—";

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    if (name.endsWith("MB")) {
      return `${value.toFixed(2)} MB`;
    }
    if (name === "RowCount" || name === "Columns" || name === "Indexes" || name === "Parameters" || name === "DefinitionLength") {
      return value.toLocaleString();
    }
    return String(value);
  }

  const str = String(value);

  if (/Date$/.test(name)) {
    const parsed = new Date(str);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString();
    }
  }

  if (/^(0|1)$/.test(str) && /^Is[A-Z]|^Uses[A-Z]|^With/.test(name)) {
    return str === "1" ? "Yes" : "No";
  }

  return str;
}

export default function PropertiesDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [entries, setEntries] = createSignal<PropertyEntry[]>([]);
  const [elapsed, setElapsed] = createSignal(0);

  onMount(async () => {
    requestAnimationFrame(() => setVisible(true));

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));

    try {
      const { sql } = await invoke<{ sql: string }>("generate_object_script", {
        database: props.database,
        schema: props.schema,
        name: props.name,
        objectType: props.objectType,
        action: "properties",
      });

      const result = await invoke<QueryResult>("execute_query", { sql });
      setElapsed(result.elapsed_ms);
      const rs = result.result_sets[0];

      if (!rs || rs.rows.length === 0) {
        setError("No properties returned for this object. It may have been dropped or you lack permission to read its catalog metadata.");
        return;
      }

      const row = rs.rows[0];
      setEntries(
        rs.columns.map((col, i) => ({
          label: formatColumnLabel(col.name),
          value: formatCellValue(col.name, row[i] ?? null),
          raw: row[i] ?? null,
        })),
      );
    } catch (err) {
      const message = String(err ?? "Failed to load properties");
      setError(message.replace(/^Error:\s*/i, "").replace(/^Query failed:\s*/i, ""));
    } finally {
      setLoading(false);
    }
  });

  const fullName = () => `[${props.database}].[${props.schema}].[${props.name}]`;

  const handleCopy = () => {
    const lines = entries().map((e) => `${e.label}: ${e.value}`);
    navigator.clipboard.writeText(`${fullName()}\n${lines.join("\n")}`);
  };

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={props.onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[560px] max-h-[80vh] flex flex-col shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-accent/10 text-accent shrink-0">
              <i class={`fa-solid ${objectTypeIcon(props.objectType)} text-sm`} />
            </div>
            <div class="flex flex-col min-w-0">
              <h2 class="text-m font-semibold text-text">{objectTypeLabel(props.objectType)} Properties</h2>
              <p class="text-xs text-text-muted font-mono truncate" title={fullName()}>{fullName()}</p>
            </div>
          </div>
          <Tooltip content="Close" placement="bottom">
            <button
              onClick={props.onClose}
              class="text-text-muted hover:bg-surface-overlay hover:text-text rounded-lg w-8 h-8 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          <Show when={loading()}>
            <div class="flex items-center gap-3 text-sm text-text-muted py-8 justify-center">
              <div class="w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              Loading properties...
            </div>
          </Show>

          <Show when={error()}>
            <div class="text-sm text-error/90 bg-error/5 border border-error/15 rounded-lg px-3 py-2 select-text">
              {error()}
            </div>
          </Show>

          <Show when={!loading() && !error()}>
            <div class="flex flex-col divide-y divide-border/30">
              <For each={entries()}>
                {(entry) => (
                  <div class="flex items-start gap-4 py-2.5">
                    <span class="text-xs font-medium text-text-muted w-[180px] shrink-0 pt-0.5">
                      {entry.label}
                    </span>
                    <span class="text-sm text-text font-mono flex-1 select-text break-words">
                      {entry.value}
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div class="flex items-center justify-between gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <span class="text-xs text-text-muted/60">
            <Show when={!loading() && !error() && elapsed() > 0}>
              Loaded in {elapsed()} ms
            </Show>
          </span>
          <div class="flex gap-3">
            <Show when={!loading() && !error() && entries().length > 0}>
              <button
                type="button"
                onClick={handleCopy}
                class="btn btn-secondary px-4 py-1.5 gap-2"
              >
                <i class="fa-solid fa-copy text-[11px]" />
                Copy
              </button>
            </Show>
            <button
              type="button"
              onClick={props.onClose}
              class="btn btn-primary px-6 py-1.5"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
