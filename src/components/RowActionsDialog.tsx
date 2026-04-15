import { invoke } from "@tauri-apps/api/core";
import { createEffect, createMemo, createSignal, For, onMount, Show } from "solid-js";
import type { ResultSet } from "../lib/types";
import Tooltip from "./Tooltip";

export type RowActionMode = "edit" | "duplicate" | "delete";

type EditableValue = string | boolean | null;
type InputKind =
  | "text"
  | "textarea"
  | "checkbox"
  | "date"
  | "datetime-local"
  | "guid"
  | "binary";

interface Props {
  mode: RowActionMode;
  columns: ResultSet["columns"];
  row: ResultSet["rows"][number];
  sourceSql: string;
  onClose: () => void;
  onSuccess?: () => void;
}

interface TableColumnMetadata {
  name: string;
  type_name: string;
  is_identity: boolean;
  is_nullable: boolean;
}

const GUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractKnownSqlServerErrorCode(message: string): number | null {
  const match = message.match(/\b(50000|2601|2627|547)\b/);
  return match ? Number(match[1]) : null;
}

function normalizeRowActionError(err: unknown): string {
  const raw = String(err ?? "Unknown error");
  const message = raw
    .replace(/^Error:\s*/i, "")
    .replace(/^Query failed:\s*/i, "")
    .replace(/^Batch \d+ failed:\s*/i, "")
    .trim();
  const code = extractKnownSqlServerErrorCode(message);

  if (message.includes("Cannot insert explicit value for identity column")) {
    return "Identity columns are auto-generated and can't be set manually.";
  }

  if (code === 50000 || message.includes("Expected 1 row")) {
    return "This row no longer matches exactly one record. Refresh the query and try again.";
  }

  if (
    code === 547 ||
    /foreign key|reference constraint|conflicted with the (?:reference|foreign key|check) constraint/i.test(
      message,
    )
  ) {
    return "This change violates a foreign key or related constraint.";
  }

  if (
    code === 2627 ||
    code === 2601 ||
    /duplicate key|unique constraint|primary key constraint/i.test(message)
  ) {
    return "This change would create a duplicate value in a unique or primary key column.";
  }

  return message;
}

function baseSqlType(typeName: string): string {
  return typeName.trim().toLowerCase().split("(")[0] ?? "";
}

function isBitType(typeName: string): boolean {
  return baseSqlType(typeName) === "bit";
}

function isDateType(typeName: string): boolean {
  return baseSqlType(typeName) === "date";
}

function isDateTimeType(typeName: string): boolean {
  return ["datetime", "datetime2", "smalldatetime"].includes(baseSqlType(typeName));
}

function isGuidType(typeName: string): boolean {
  return baseSqlType(typeName) === "uniqueidentifier";
}

function isBinaryType(typeName: string): boolean {
  return ["binary", "varbinary", "image", "rowversion", "timestamp"].includes(
    baseSqlType(typeName),
  );
}

function isLongTextType(typeName: string): boolean {
  const normalized = typeName.trim().toLowerCase();
  const base = baseSqlType(typeName);
  return (
    normalized.includes("(max)") ||
    ["text", "ntext", "xml"].includes(base)
  );
}

function normalizeDateValue(value: string): string {
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? value;
}

function normalizeDateTimeValue(value: string): string {
  const trimmed = value.trim().replace(" ", "T");
  const match = trimmed.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?/,
  );
  return match?.[0] ?? trimmed;
}

function toEditorValue(
  cell: string | number | boolean | null,
  column: TableColumnMetadata,
): EditableValue {
  if (cell == null) {
    return null;
  }

  if (isBitType(column.type_name)) {
    if (typeof cell === "boolean") {
      return cell;
    }

    const normalized = String(cell).trim().toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }

  const text = String(cell);
  if (isDateType(column.type_name)) {
    return normalizeDateValue(text);
  }
  if (isDateTimeType(column.type_name)) {
    return normalizeDateTimeValue(text);
  }

  return text;
}

function getInputKind(column: TableColumnMetadata, value: EditableValue): InputKind {
  if (isBinaryType(column.type_name)) {
    return "binary";
  }
  if (isBitType(column.type_name)) {
    return "checkbox";
  }
  if (isDateType(column.type_name)) {
    return "date";
  }
  if (isDateTimeType(column.type_name)) {
    return "datetime-local";
  }
  if (isGuidType(column.type_name)) {
    return "guid";
  }
  if (
    isLongTextType(column.type_name) ||
    (typeof value === "string" && (value.length > 120 || value.includes("\n")))
  ) {
    return "textarea";
  }
  return "text";
}

function formatBinaryValue(value: EditableValue): string {
  if (value == null) {
    return "NULL";
  }
  const text = String(value);
  if (/^0x[0-9a-f]+$/i.test(text)) {
    return text;
  }
  return text;
}

export default function RowActionsDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [tableColumns, setTableColumns] = createSignal<TableColumnMetadata[]>([]);
  const [values, setValues] = createSignal<EditableValue[]>([]);
  const [primaryKeyCols, setPrimaryKeyCols] = createSignal<Set<string>>(new Set());
  const [metadataLoading, setMetadataLoading] = createSignal(true);
  const [metadataError, setMetadataError] = createSignal<string | null>(null);
  const [executing, setExecuting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal(false);
  const [hydrated, setHydrated] = createSignal(false);

  const findTableColumn = (name: string) =>
    tableColumns().find((column) => column.name === name) ??
    tableColumns().find((column) => column.name.toLowerCase() === name.toLowerCase());

  const mergedColumns = createMemo<TableColumnMetadata[]>(() =>
    props.columns.map((column) => {
      const tableColumn = findTableColumn(column.name);
      return (
        tableColumn ?? {
          name: column.name,
          type_name: column.type_name,
          is_identity: false,
          is_nullable: true,
        }
      );
    }),
  );

  createEffect(() => {
    if (hydrated() || metadataLoading()) {
      return;
    }

    const columns = mergedColumns();
    if (columns.length === 0) {
      return;
    }

    setValues(props.row.map((cell, index) => toEditorValue(cell, columns[index]!)));
    setHydrated(true);
  });

  onMount(async () => {
    requestAnimationFrame(() => setVisible(true));

    const [columnsResult, primaryKeyResult] = await Promise.allSettled([
      invoke<TableColumnMetadata[]>("get_table_column_metadata", {
        sourceSql: props.sourceSql,
      }),
      invoke<string[]>("get_primary_key_columns", {
        sourceSql: props.sourceSql,
      }),
    ]);

    if (columnsResult.status === "fulfilled") {
      setTableColumns(columnsResult.value);
    }

    if (primaryKeyResult.status === "fulfilled") {
      setPrimaryKeyCols(new Set(primaryKeyResult.value));
      if (props.mode !== "duplicate" && primaryKeyResult.value.length === 0) {
        setMetadataError(
          "This table has no primary key. Edit and delete are disabled for safety.",
        );
      }
    } else if (props.mode !== "duplicate") {
      setMetadataError(
        "Could not determine the table's primary key columns. Edit and delete are disabled for safety.",
      );
    }

    setMetadataLoading(false);
  });

  const isIdentity = (column: TableColumnMetadata) => column.is_identity;
  const isPrimaryKey = (column: TableColumnMetadata) => primaryKeyCols().has(column.name);
  const isRequired = (column: TableColumnMetadata) =>
    !column.is_nullable && !column.is_identity;
  const isEditable = () => props.mode !== "delete";

  const missingPrimaryKeyColumns = createMemo(() => {
    const available = new Set(mergedColumns().map((column) => column.name.toLowerCase()));
    return Array.from(primaryKeyCols()).filter(
      (name) => !available.has(name.toLowerCase()),
    );
  });

  const blockedReason = createMemo(() => {
    if (props.mode === "duplicate") return null;
    if (metadataLoading()) return "Loading primary key metadata...";
    if (metadataError()) return metadataError();
    if (primaryKeyCols().size === 0) {
      return "This table has no primary key. Edit and delete are disabled for safety.";
    }
    if (missingPrimaryKeyColumns().length > 0) {
      const names = missingPrimaryKeyColumns().join(", ");
      return `This result set must include the primary key column${missingPrimaryKeyColumns().length === 1 ? "" : "s"}: ${names}. Re-run a query that includes them to edit or delete safely.`;
    }
    return null;
  });

  const validationErrors = createMemo<Record<number, string>>(() => {
    if (props.mode === "delete") {
      return {};
    }

    const errors: Record<number, string> = {};
    mergedColumns().forEach((column, index) => {
      if (column.is_identity) {
        return;
      }

      const value = values()[index];
      if (!column.is_nullable && value === null) {
        errors[index] = "Required";
        return;
      }

      if (value !== null && isGuidType(column.type_name)) {
        const trimmed = String(value).trim();
        if (!GUID_REGEX.test(trimmed)) {
          errors[index] = "Enter a valid GUID.";
        }
      }
    });

    return errors;
  });

  const title = () => {
    switch (props.mode) {
      case "edit":
        return "Edit Row";
      case "duplicate":
        return "Duplicate Row";
      case "delete":
        return "Delete Row";
    }
  };

  const confirmLabel = () => {
    if (success()) {
      switch (props.mode) {
        case "edit":
          return "Saved";
        case "duplicate":
          return "Inserted";
        case "delete":
          return "Deleted";
      }
    }

    if (executing()) {
      switch (props.mode) {
        case "edit":
          return "Saving...";
        case "duplicate":
          return "Inserting...";
        case "delete":
          return "Deleting...";
      }
    }

    switch (props.mode) {
      case "edit":
        return "Save Changes";
      case "duplicate":
        return "Insert Row";
      case "delete":
        return "Delete Row";
    }
  };

  const modeIcon = () => {
    switch (props.mode) {
      case "edit":
        return "fa-pen-to-square";
      case "duplicate":
        return "fa-clone";
      case "delete":
        return "fa-trash-can";
    }
  };

  const updateValue = (index: number, value: EditableValue) => {
    setValues((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const getTypedRow = (): (string | number | boolean | null)[] => {
    return mergedColumns().map((column, index) => {
      const value = values()[index];
      if (value === null) {
        return null;
      }

      if (isBitType(column.type_name)) {
        return value === true;
      }

      if (isGuidType(column.type_name)) {
        return String(value).trim();
      }

      const original = props.row[index];
      if (typeof original === "number") {
        const num = Number(value);
        if (!Number.isNaN(num)) {
          return num;
        }
      }

      if (typeof original === "boolean") {
        const lower = String(value).toLowerCase();
        if (lower === "true" || lower === "1") return true;
        if (lower === "false" || lower === "0") return false;
      }

      return String(value);
    });
  };

  const handleConfirm = async () => {
    if (metadataLoading()) {
      setError("Loading table metadata. Try again in a moment.");
      return;
    }

    if (blockedReason()) {
      setError(blockedReason());
      return;
    }

    const firstValidationError = Object.values(validationErrors())[0];
    if (firstValidationError) {
      setError(firstValidationError);
      return;
    }

    setExecuting(true);
    setError(null);

    try {
      let sql: string;
      const primaryKeyColumns = Array.from(primaryKeyCols());
      const columns = mergedColumns().map((column) => ({
        name: column.name,
        type_name: column.type_name,
        is_identity: column.is_identity,
        is_nullable: column.is_nullable,
      }));

      switch (props.mode) {
        case "delete":
          sql = await invoke<string>("build_row_sql", {
            operation: "delete",
            sourceSql: props.sourceSql,
            columns,
            row: props.row,
            primaryKeyColumns,
          });
          break;

        case "duplicate":
          sql = await invoke<string>("build_row_sql", {
            operation: "insert",
            sourceSql: props.sourceSql,
            columns,
            row: getTypedRow(),
          });
          break;

        case "edit":
          sql = await invoke<string>("build_row_update_with_edits", {
            sourceSql: props.sourceSql,
            columns,
            oldRow: props.row,
            newRow: getTypedRow(),
            primaryKeyColumns,
          });
          break;
      }

      await invoke("execute_query", { sql });
      setSuccess(true);
      setTimeout(() => {
        props.onSuccess?.();
        props.onClose();
      }, 800);
    } catch (err: unknown) {
      setError(normalizeRowActionError(err));
    } finally {
      setExecuting(false);
    }
  };

  const isDanger = () => props.mode === "delete";
  const confirmDisabled = () =>
    executing() ||
    success() ||
    metadataLoading() ||
    !!blockedReason() ||
    Object.keys(validationErrors()).length > 0;

  const isChanged = (index: number) => {
    if (props.mode !== "edit") return false;
    const original = toEditorValue(props.row[index], mergedColumns()[index]!);
    const current = values()[index];
    if (original === null || current === null) {
      return original !== current;
    }
    return String(original) !== String(current);
  };

  const canSetNull = (column: TableColumnMetadata) =>
    isEditable() &&
    !column.is_identity &&
    column.is_nullable &&
    !isBinaryType(column.type_name);

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={props.onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[600px] max-h-[80vh] flex flex-col shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
          <div class="flex items-center gap-3">
            <div
              class={`w-8 h-8 rounded-lg flex items-center justify-center ${
                isDanger() ? "bg-error/10 text-error" : "bg-accent/10 text-accent"
              }`}
            >
              <i class={`fa-solid ${modeIcon()} text-sm`} />
            </div>
            <h2 class="text-m font-semibold text-text">{title()}</h2>
          </div>
          <Tooltip content="Close" placement="bottom">
            <button
              onClick={props.onClose}
              class="text-text-muted hover:bg-surface-overlay hover:text-text rounded-lg w-8 h-8 flex items-center justify-center transition-colors cursor-pointer"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        <Show when={props.mode === "delete"}>
          <div class="mx-6 mt-4 p-3 rounded-lg bg-error/5 border border-error/15">
            <p class="text-sm text-error/90 flex items-center gap-2">
              <i class="fa-solid fa-triangle-exclamation" />
              This will permanently delete this row. This action cannot be undone.
            </p>
          </div>
        </Show>

        <Show when={blockedReason()}>
          {(reason) => (
            <div class="mx-6 mt-4 p-3 rounded-lg bg-warning/5 border border-warning/20">
              <p class="text-sm text-warning/90 flex items-center gap-2">
                <i class="fa-solid fa-shield-halved" />
                {reason()}
              </p>
            </div>
          )}
        </Show>

        <div class="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          <div class="flex flex-col gap-3">
            <For each={mergedColumns()}>
              {(column, i) => {
                const cellValue = () => values()[i()];
                const inputKind = () => getInputKind(column, cellValue());
                const changed = () => isChanged(i());
                const readOnly = () =>
                  !isEditable() || column.is_identity || inputKind() === "binary";
                const fieldError = () => validationErrors()[i()];

                return (
                  <div
                    class={`flex items-start gap-3 rounded-lg px-2 py-2 transition-colors ${
                      changed() ? "bg-accent/5" : ""
                    } ${fieldError() ? "bg-error/5" : ""}`}
                  >
                    <div class="w-[160px] shrink-0 pt-1.5">
                      <span
                        class="text-xs font-medium text-text-muted truncate block"
                        title={column.name}
                      >
                        {column.name}
                        <Show when={isRequired(column)}>
                          <span class="text-error ml-1">*</span>
                        </Show>
                      </span>
                      <span class="text-[10px] text-text-muted/40 uppercase tracking-wider">
                        {column.type_name}
                        {isPrimaryKey(column) ? " · pk" : ""}
                        {column.is_identity ? " · identity" : ""}
                        {isRequired(column) ? " · required" : ""}
                        {inputKind() === "binary" ? " · read only" : ""}
                      </span>
                      <Show when={fieldError()}>
                        <span class="text-[10px] text-error mt-1 block">
                          {fieldError()}
                        </span>
                      </Show>
                    </div>

                    <div class="flex-1 flex items-start gap-1.5 min-w-0">
                      <Show
                        when={!readOnly()}
                        fallback={
                          <div class="flex-1 px-2.5 py-2 rounded-md bg-surface/40 border border-border/20 text-sm font-mono select-text min-h-[36px] flex items-center overflow-hidden whitespace-pre-wrap break-all">
                            {inputKind() === "binary" ? (
                              <span class="text-text/80">{formatBinaryValue(cellValue())}</span>
                            ) : cellValue() != null ? (
                              <span class="truncate text-text/80">{String(cellValue())}</span>
                            ) : (
                              <span class="text-text-muted/40 italic">NULL</span>
                            )}
                          </div>
                        }
                      >
                        <Show
                          when={cellValue() !== null || inputKind() === "checkbox"}
                          fallback={
                            <div class="flex-1 flex items-center gap-1.5">
                              <div class="flex-1 px-2.5 py-2 rounded-md bg-surface/30 border border-dashed border-border/30 text-sm text-text-muted/40 italic font-mono min-h-[36px] flex items-center">
                                NULL
                              </div>
                              <Tooltip content="Set value" placement="top">
                                <button
                                  onClick={() =>
                                    updateValue(
                                      i(),
                                      inputKind() === "checkbox" ? false : "",
                                    )
                                  }
                                  class="w-7 h-7 rounded-md border border-border/30 bg-surface/40 text-text-muted/60 hover:text-text hover:bg-surface/60 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                                >
                                  <i class="fa-solid fa-pencil text-[9px]" />
                                </button>
                              </Tooltip>
                            </div>
                          }
                        >
                          <Show
                            when={inputKind() === "textarea"}
                            fallback={
                              <Show
                                when={inputKind() === "checkbox"}
                                fallback={
                                  <input
                                    type={
                                      inputKind() === "date"
                                        ? "date"
                                        : inputKind() === "datetime-local"
                                          ? "datetime-local"
                                          : "text"
                                    }
                                    value={
                                      typeof cellValue() === "string"
                                        ? String(cellValue())
                                        : ""
                                    }
                                    onInput={(e) =>
                                      updateValue(i(), e.currentTarget.value)
                                    }
                                    class={`flex-1 px-2.5 py-2 rounded-md bg-surface border text-sm text-text font-mono outline-none focus:border-accent min-h-[36px] transition-colors min-w-0 ${
                                      fieldError()
                                        ? "border-error/50"
                                        : changed()
                                          ? "border-accent/40"
                                          : "border-border/40"
                                    }`}
                                  />
                                }
                              >
                                <label
                                  class={`flex-1 px-2.5 py-2 rounded-md bg-surface border text-sm text-text font-mono min-h-[36px] flex items-center gap-3 transition-colors ${
                                    fieldError()
                                      ? "border-error/50"
                                      : changed()
                                        ? "border-accent/40"
                                        : "border-border/40"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={cellValue() === true}
                                    ref={(element) => {
                                      element.indeterminate = cellValue() === null;
                                    }}
                                    onChange={(e) =>
                                      updateValue(i(), e.currentTarget.checked)
                                    }
                                    class="h-4 w-4 accent-accent cursor-pointer"
                                  />
                                  <span class="text-text/80">
                                    {cellValue() === null ? "NULL" : cellValue() ? "True" : "False"}
                                  </span>
                                </label>
                              </Show>
                            }
                          >
                            <textarea
                              value={
                                typeof cellValue() === "string"
                                  ? String(cellValue())
                                  : ""
                              }
                              onInput={(e) => updateValue(i(), e.currentTarget.value)}
                              rows={4}
                              class={`flex-1 px-2.5 py-2 rounded-md bg-surface border text-sm text-text font-mono outline-none focus:border-accent min-h-[96px] transition-colors min-w-0 resize-y ${
                                fieldError()
                                  ? "border-error/50"
                                  : changed()
                                    ? "border-accent/40"
                                    : "border-border/40"
                              }`}
                            />
                          </Show>
                        </Show>
                      </Show>

                      <Show when={canSetNull(column)}>
                        <Tooltip content="Set NULL" placement="top">
                          <button
                            onClick={() => updateValue(i(), null)}
                            class="w-7 h-7 rounded-md border border-border/30 bg-surface/40 text-text-muted/60 hover:text-error/80 hover:bg-error/5 hover:border-error/20 flex items-center justify-center transition-colors cursor-pointer shrink-0 mt-1"
                          >
                            <i class="fa-solid fa-ban text-[9px]" />
                          </button>
                        </Tooltip>
                      </Show>

                      <Show when={changed()}>
                        <div class="w-1.5 h-1.5 rounded-full bg-accent shrink-0 mt-4" />
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <Show when={error()}>
          <div class="mx-6 mb-2 text-error text-sm bg-error/5 border border-error/15 rounded-lg px-3 py-2 max-h-[80px] overflow-y-auto select-text">
            {error()}
          </div>
        </Show>

        <div class="flex justify-end gap-3 px-6 py-4 border-t border-border rounded-b-2xl">
          <button
            type="button"
            onClick={props.onClose}
            class="btn btn-secondary px-6 py-1.5"
            disabled={executing()}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled()}
            class={`btn px-6 py-1.5 gap-2 transition-all ${
              success()
                ? "bg-success border-success text-white"
                : isDanger()
                  ? "bg-error border-error text-white hover:!bg-error/90 hover:!border-error/90"
                  : "btn-primary"
            }`}
          >
            <Show when={success()}>
              <i class="fa-solid fa-check text-[11px]" />
            </Show>
            <Show when={executing()}>
              <div class="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            </Show>
            {confirmLabel()}
          </button>
        </div>
      </div>
    </div>
  );
}
