import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, onMount, Show } from "solid-js";
import { loadExecutionPreferences } from "../../lib/settings";
import {
  buildKeyColumnsSql,
  buildMultiCompareScript,
  buildMultiCountSql,
  buildMultiDiffSql,
  hasTableInDatabase,
  intersectCompareColumnsAcross,
  missingKeyColumnsAcross,
  parseKeyColumnsResult,
  parseMultiCountResult,
  pickComparableColumns,
  uniqueCompareColumns,
  valueColumn,
  type CompareCountSummary,
  type MultiCompareOptions,
} from "../../lib/table-compare";
import type { ColumnInfo, DatabaseObject, QueryResult } from "../../lib/types";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";
import { Icon, Spinner } from "../ui/Icons";
import Input from "../ui/Input";
import { Loader } from "../ui/Loader";

interface Props {
  sourceDatabase: string;
  schema: string;
  table: string;
  databases: string[];
  onClose: () => void;
  onOpenQuery: (sql: string, title?: string) => void;
}

interface DatabaseAvailability {
  database: string;
  available: boolean;
}

interface CompareResult {
  databases: string[];
  keyColumns: string[];
  compareColumns: string[];
  summary: CompareCountSummary;
  ignoredColumns: string[];
  diffResult: QueryResult | null;
}

function cleanError(err: unknown, fallback: string): string {
  return String(err ?? fallback)
    .replace(/^Error:\s*/i, "")
    .replace(/^Query failed:\s*/i, "");
}

function cellText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function isPresent(
  row: (string | number | boolean | null)[],
  columns: ColumnInfo[],
  index: number,
): boolean {
  const colIndex = columns.findIndex(
    (column) => column.name.toLowerCase() === `present__db${index}`,
  );
  if (colIndex === -1) return true;
  const value = row[colIndex];
  return value === true || value === 1 || value === "1" || value === "true";
}

function valueAt(
  row: (string | number | boolean | null)[],
  columns: ColumnInfo[],
  column: string,
  index: number,
): string | number | boolean | null | undefined {
  const name = valueColumn(column, index).toLowerCase();
  const colIndex = columns.findIndex((item) => item.name.toLowerCase() === name);
  if (colIndex === -1) return undefined;
  return row[colIndex];
}

function keyValue(
  row: (string | number | boolean | null)[],
  columns: ColumnInfo[],
  column: string,
): string | number | boolean | null | undefined {
  const colIndex = columns.findIndex(
    (item) => item.name.toLowerCase() === column.toLowerCase(),
  );
  if (colIndex === -1) return undefined;
  return row[colIndex];
}

function valuesDiffer(
  row: (string | number | boolean | null)[],
  columns: ColumnInfo[],
  column: string,
  databaseCount: number,
): boolean {
  const presentValues: string[] = [];
  for (let index = 0; index < databaseCount; index += 1) {
    if (!isPresent(row, columns, index)) continue;
    presentValues.push(cellText(valueAt(row, columns, column, index)));
  }
  if (presentValues.length <= 1) return false;
  return presentValues.some((value) => value !== presentValues[0]);
}

interface DisplayDataRow {
  values: Record<string, string | number | boolean | null | undefined>;
  changed: Set<string>;
}

interface DisplaySection {
  database: string;
  rows: DisplayDataRow[];
}

function buildDisplaySections(
  result: CompareResult,
): DisplaySection[] {
  const resultSet = result.diffResult?.result_sets[0];
  if (!resultSet) return [];

  const columns = resultSet.columns;
  const displayColumns = [...result.keyColumns, ...result.compareColumns];
  const sections: DisplaySection[] = result.databases.map((database) => ({
    database,
    rows: [],
  }));

  for (const row of resultSet.rows) {
    const changed = new Set<string>();
    for (const column of result.compareColumns) {
      if (valuesDiffer(row, columns, column, result.databases.length)) {
        changed.add(column);
      }
    }

    for (let index = 0; index < result.databases.length; index += 1) {
      if (!isPresent(row, columns, index)) continue;
      const values: DisplayDataRow["values"] = {};
      for (const column of displayColumns) {
        values[column] = result.keyColumns.includes(column)
          ? keyValue(row, columns, column)
          : valueAt(row, columns, column, index);
      }
      sections[index]?.rows.push({ values, changed });
    }
  }

  return sections.filter((section) => section.rows.length > 0);
}

export default function TableCompareDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);
  const [discovering, setDiscovering] = createSignal(true);
  const [discoverError, setDiscoverError] = createSignal("");
  const [originColumns, setOriginColumns] = createSignal<ColumnInfo[]>([]);
  const [databaseAvailability, setDatabaseAvailability] = createSignal<
    DatabaseAvailability[]
  >([]);
  const [selectedDatabases, setSelectedDatabases] = createSignal<Set<string>>(
    new Set(),
  );
  const [keyColumns, setKeyColumns] = createSignal<Set<string>>(new Set());
  const [compareColumns, setCompareColumns] = createSignal<Set<string>>(
    new Set(),
  );
  const [whereClause, setWhereClause] = createSignal("");
  const [rowLimit, setRowLimit] = createSignal(
    loadExecutionPreferences().maxRows || 1000,
  );
  const [comparing, setComparing] = createSignal(false);
  const [compareError, setCompareError] = createSignal("");
  const [result, setResult] = createSignal<CompareResult | null>(null);
  const [lastScript, setLastScript] = createSignal("");

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
    void discover();
  });

  async function discover() {
    setDiscovering(true);
    setDiscoverError("");
    try {
      const columns = await invoke<ColumnInfo[]>("get_columns", {
        database: props.sourceDatabase,
        schema: props.schema,
        table: props.table,
      });
      setOriginColumns(columns);

      let keys = await loadKeyColumns(props.sourceDatabase, true);
      if (keys.length === 0) {
        keys = await loadKeyColumns(props.sourceDatabase, false);
      }
      setKeyColumns(new Set(keys));

      const comparable = pickComparableColumns(columns, keys);
      setCompareColumns(new Set(comparable.map((column) => column.name)));

      const availability = await Promise.all(
        props.databases.map(async (database) => {
          try {
            const objects = await invoke<DatabaseObject[]>("get_tables", {
              database,
            });
            return {
              database,
              available: hasTableInDatabase(
                objects,
                props.schema,
                props.table,
              ),
            };
          } catch {
            return { database, available: false };
          }
        }),
      );
      setDatabaseAvailability(availability);
      setSelectedDatabases(
        new Set(
          availability
            .filter((entry) => entry.available)
            .map((entry) => entry.database),
        ),
      );
    } catch (err) {
      setDiscoverError(cleanError(err, "Failed to load table metadata."));
    } finally {
      setDiscovering(false);
    }
  }

  async function loadKeyColumns(
    database: string,
    preferPrimaryKey: boolean,
  ): Promise<string[]> {
    const sql = buildKeyColumnsSql(
      {
        database,
        schema: props.schema,
        table: props.table,
      },
      preferPrimaryKey,
    );
    const queryResult = await invoke<QueryResult>("execute_query", { sql });
    return parseKeyColumnsResult(queryResult);
  }

  function toggleDatabase(database: string, checked: boolean) {
    setSelectedDatabases((prev) => {
      const next = new Set(prev);
      if (checked) next.add(database);
      else next.delete(database);
      return next;
    });
  }

  function toggleKeyColumn(name: string, checked: boolean) {
    setKeyColumns((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  function toggleCompareColumn(name: string, checked: boolean) {
    setCompareColumns((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  async function runCompare() {
    const keys = [...keyColumns()];
    if (keys.length === 0) {
      setCompareError("Select at least one key column.");
      return;
    }

    const selected = [...selectedDatabases()];
    if (selected.length < 2) {
      setCompareError("Select at least two databases.");
      return;
    }

    setComparing(true);
    setCompareError("");
    setResult(null);

    const execPrefs = loadExecutionPreferences();
    const timeoutSeconds =
      execPrefs.timeoutSeconds > 0 ? execPrefs.timeoutSeconds : null;
    const limit = Math.max(1, rowLimit());

    try {
      const columnSets = await Promise.all(
        selected.map((database) =>
          invoke<ColumnInfo[]>("get_columns", {
            database,
            schema: props.schema,
            table: props.table,
          }),
        ),
      );
      const missingKeys = missingKeyColumnsAcross(columnSets, keys);
      if (missingKeys.length > 0) {
        setCompareError(
          `Key columns missing from one or more databases: ${missingKeys.join(", ")}`,
        );
        return;
      }

      const { compare, ignored } = intersectCompareColumnsAcross(
        columnSets,
        keys,
      );
      const selectedCompare = uniqueCompareColumns(
        keys,
        compare
          .map((column) => column.name)
          .filter((name) => compareColumns().has(name)),
      );

      const options: MultiCompareOptions = {
        schema: props.schema,
        table: props.table,
        databases: selected,
        keyColumns: keys,
        compareColumns: selectedCompare,
        whereClause: whereClause(),
        rowLimit: limit,
      };

      const countSql = buildMultiCountSql(options);
      const diffSql = buildMultiDiffSql(options);
      setLastScript(buildMultiCompareScript(options));

      const countResult = await invoke<QueryResult>("execute_query", {
        sql: countSql,
        timeoutSeconds,
      });
      const diffResult = await invoke<QueryResult>("execute_query", {
        sql: diffSql,
        maxRows: limit,
        timeoutSeconds,
      });

      setResult({
        databases: selected,
        keyColumns: keys,
        compareColumns: selectedCompare,
        summary: parseMultiCountResult(countResult),
        ignoredColumns: ignored,
        diffResult,
      });
    } catch (err) {
      setCompareError(cleanError(err, "Compare failed."));
    } finally {
      setComparing(false);
    }
  }

  const fullTableName = () => `[${props.schema}].[${props.table}]`;
  const showResults = () => result() !== null;

  const renderCheckboxGrid = (
    items: { id: string; label: string; disabled?: boolean }[],
    selected: Set<string>,
    onToggle: (id: string, checked: boolean) => void,
  ) => (
    <div class="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-border/30 rounded-lg p-3">
      <For each={items}>
        {(item) => (
          <label
            class={`flex items-center gap-2 text-s text-text-muted ${item.disabled ? "opacity-40" : "cursor-pointer"}`}
          >
            <input
              type="checkbox"
              checked={selected.has(item.id)}
              disabled={item.disabled}
              onChange={(event) =>
                onToggle(item.id, event.currentTarget.checked)
              }
            />
            <span class="truncate" title={item.label}>
              {item.label}
            </span>
          </label>
        )}
      </For>
    </div>
  );

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[960px] max-w-[calc(100vw-32px)] h-[720px] max-h-[calc(100vh-32px)] flex flex-col shadow-2xl"
      ariaLabel="Compare table data"
      closeOnOverlay={!comparing()}
      closeOnEscape={!comparing()}
    >
      <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-accent/10 text-accent shrink-0">
            <Icon name="code-compare" class="text-sm" />
          </div>
          <div class="flex flex-col min-w-0">
            <h2 class="text-m font-semibold text-text">Compare Data</h2>
            <p
              class="text-xs text-text-muted font-mono truncate"
              title={fullTableName()}
            >
              {fullTableName()}
            </p>
          </div>
        </div>
        <DialogCloseButton onClick={props.onClose} disabled={comparing()} />
      </div>

      <div class="flex-1 overflow-y-auto min-h-0 px-6 py-5">
        <Show when={discovering()}>
          <Loader
            variant="horizontal"
            size={16}
            text="Discovering databases…"
          />
        </Show>

        <Show when={discoverError()}>
          <div class="text-sm text-error/90 bg-error/5 border border-error/15 rounded-lg px-3 py-2 select-text">
            {discoverError()}
          </div>
        </Show>

        <Show when={!discovering() && !discoverError()}>
          <Show when={compareError()}>
            <div class="mb-4 text-sm text-error/90 bg-error/5 border border-error/15 rounded-lg px-3 py-2 select-text">
              {compareError()}
            </div>
          </Show>

          <Show when={!showResults()}>
            <div class="flex flex-col gap-5">
              <div>
                <label class="text-s font-medium text-text-muted mb-1.5 block">
                  Databases
                </label>
                {renderCheckboxGrid(
                  databaseAvailability().map((entry) => ({
                    id: entry.database,
                    label: entry.available
                      ? entry.database
                      : `${entry.database} (table missing)`,
                    disabled: !entry.available,
                  })),
                  selectedDatabases(),
                  toggleDatabase,
                )}
              </div>

              <div>
                <label class="text-s font-medium text-text-muted mb-1.5 block">
                  Key columns
                </label>
                {keyColumns().size === 0 && (
                  <p class="text-xs text-warning mb-2">
                    No primary or unique key found. Select columns to match
                    rows.
                  </p>
                )}
                {renderCheckboxGrid(
                  originColumns().map((column) => ({
                    id: column.name,
                    label: `${column.name} (${column.type_name})`,
                  })),
                  keyColumns(),
                  toggleKeyColumn,
                )}
              </div>

              <div>
                <label class="text-s font-medium text-text-muted mb-1.5 block">
                  Compare columns
                </label>
                {renderCheckboxGrid(
                  pickComparableColumns(originColumns(), [...keyColumns()]).map(
                    (column) => ({
                      id: column.name,
                      label: `${column.name} (${column.type_name})`,
                    }),
                  ),
                  compareColumns(),
                  toggleCompareColumn,
                )}
              </div>

              <div class="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">
                    WHERE clause (optional)
                  </label>
                  <Input
                    value={whereClause()}
                    placeholder="status = 1"
                    onInput={(event) =>
                      setWhereClause(event.currentTarget.value)
                    }
                  />
                </div>
                <div>
                  <label class="text-s font-medium text-text-muted mb-1.5 block">
                    Diff row limit
                  </label>
                  <Input
                    type="number"
                    min={1}
                    value={String(rowLimit())}
                    onInput={(event) => {
                      const parsed = Number.parseInt(
                        event.currentTarget.value,
                        10,
                      );
                      if (!Number.isNaN(parsed) && parsed > 0) {
                        setRowLimit(parsed);
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </Show>

          <Show when={result()}>
            {(compare) => {
              const displayColumns = () => [
                ...compare().keyColumns,
                ...compare().compareColumns,
              ];
              const sections = () => buildDisplaySections(compare());

              return (
                <div class="flex flex-col gap-4">
                  <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
                    <div class="rounded-lg border border-border/30 px-3 py-2">
                      <div class="text-xs text-text-muted">Matching</div>
                      <div class="text-lg font-semibold text-text">
                        {compare().summary.matching}
                      </div>
                    </div>
                    <div class="rounded-lg border border-border/30 px-3 py-2">
                      <div class="text-xs text-text-muted">
                        Missing in some databases
                      </div>
                      <div class="text-lg font-semibold text-warning">
                        {compare().summary.missing}
                      </div>
                    </div>
                    <div class="rounded-lg border border-border/30 px-3 py-2">
                      <div class="text-xs text-text-muted">Different values</div>
                      <div class="text-lg font-semibold text-error/90">
                        {compare().summary.changed}
                      </div>
                    </div>
                  </div>

                  <Show when={compare().ignoredColumns.length > 0}>
                    <p class="text-xs text-text-muted">
                      Ignored columns not present in every database:{" "}
                      {compare().ignoredColumns.join(", ")}
                    </p>
                  </Show>

                  <Show
                    when={sections().length > 0}
                    fallback={
                      <p class="text-sm text-text-muted">
                        No differing rows within the current limit.
                      </p>
                    }
                  >
                    <div class="overflow-auto border border-border/20 rounded-lg max-h-[420px] bg-surface-table">
                      <table class="w-full min-w-full text-left border-collapse text-s">
                        <thead class="sticky top-0 z-10">
                          <tr class="bg-surface-header text-text-muted font-semibold text-3xs border-b border-border/20">
                            <For each={displayColumns()}>
                              {(column) => (
                                <th class="text-left px-2.5 py-2 whitespace-nowrap">
                                  {column}
                                </th>
                              )}
                            </For>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={sections()}>
                            {(section) => (
                              <>
                                <tr class="bg-surface-header/80">
                                  <td
                                    class="px-2.5 py-1.5 text-[10px] font-semibold text-text-muted tracking-wider"
                                    colspan={displayColumns().length}
                                  >
                                    <span class="inline-flex items-center gap-2">
                                      <i class="fa-solid fa-database" />
                                      {section.database}
                                    </span>
                                  </td>
                                </tr>
                                <For each={section.rows}>
                                  {(row) => (
                                    <tr class="border-t border-border/10 hover:bg-surface-hover transition-colors">
                                      <For each={displayColumns()}>
                                        {(column) => {
                                          const value = () => row.values[column];
                                          const changed = () =>
                                            row.changed.has(column);
                                          return (
                                            <td
                                              class={`px-2.5 py-2 whitespace-nowrap max-w-[220px] truncate font-sans text-s ${
                                                changed()
                                                  ? "text-text bg-error/10"
                                                  : "text-text"
                                              }`}
                                              title={cellText(value())}
                                            >
                                              {cellText(value())}
                                            </td>
                                          );
                                        }}
                                      </For>
                                    </tr>
                                  )}
                                </For>
                              </>
                            )}
                          </For>
                        </tbody>
                      </table>
                    </div>
                  </Show>
                </div>
              );
            }}
          </Show>
        </Show>
      </div>

      <div class="flex items-center justify-between gap-3 px-6 py-4 border-t border-overlay-xs">
        <div class="flex items-center gap-2">
          <Show when={showResults() && lastScript()}>
            <button
              type="button"
              class="btn btn-ghost text-sm"
              onClick={() => {
                props.onOpenQuery(
                  lastScript(),
                  `Compare ${props.schema}.${props.table}`,
                );
                props.onClose();
              }}
            >
              Open as query
            </button>
            <button
              type="button"
              class="btn btn-ghost text-sm"
              onClick={() => void navigator.clipboard.writeText(lastScript())}
            >
              Copy SQL
            </button>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Show when={showResults()}>
            <button
              type="button"
              class="btn btn-ghost text-sm"
              onClick={() => setResult(null)}
              disabled={comparing()}
            >
              Back
            </button>
          </Show>
          <button
            type="button"
            class="btn btn-ghost text-sm"
            onClick={props.onClose}
            disabled={comparing()}
          >
            Close
          </button>
          <Show when={!showResults()}>
            <button
              type="button"
              class="btn btn-primary text-sm"
              onClick={() => void runCompare()}
              disabled={comparing() || discovering()}
            >
              <Show when={comparing()} fallback="Compare">
                <span class="inline-flex items-center gap-2">
                  <Spinner size={14} />
                  Comparing…
                </span>
              </Show>
            </button>
          </Show>
        </div>
      </div>
    </DialogShell>
  );
}
