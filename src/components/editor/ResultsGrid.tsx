import { invoke } from "@tauri-apps/api/core";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { getModifierKeyLabel } from "../../lib/platform";
import { loadExecutionPreferences } from "../../lib/settings";
import { formatSqlDateValue } from "../../lib/sql-date";
import type { QueryResult, ResultSet } from "../../lib/types";
import ColumnSelector from "./ColumnSelector";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import EmptyState from "../ui/EmptyState";
import RowActionsDialog, {
  type RowActionMode,
} from "../dialogs/RowActionsDialog";

interface Props {
  result?: QueryResult;
  error?: string;
  isExecuting: boolean;
  sourceSql?: string;
  onGenerateSql?: (sql: string) => void;
  onReExecute?: () => void;
  onSendErrorToChat?: (error: string) => void;
}

interface RowActionDialogState {
  mode: RowActionMode;
  rowIndex: number;
  resultSetIndex: number;
}

interface RowContextMenuState {
  x: number;
  y: number;
  rowIndex: number;
  resultSetIndex: number;
}

function ErrorSection(props: {
  error: string;
  onSendToChat?: (error: string) => void;
}) {
  const [copied, setCopied] = createSignal(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy error:", err);
    }
  };

  return (
    <div class="p-4 h-full overflow-auto bg-surface flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <span class="text-s font-semibold text-error/80 flex items-center gap-2">
          <i class="fa-solid fa-circle-exclamation" />
          Query Error
        </span>
        <div class="flex items-center gap-2">
          <Show when={props.onSendToChat}>
            <button
              type="button"
              onClick={() => props.onSendToChat?.(props.error)}
              class="btn btn-secondary h-7 px-3 gap-2"
            >
              <i class="fa-solid fa-comment-dots" />
              <span>Send to Chat</span>
            </button>
          </Show>
          <button
            type="button"
            onClick={handleCopy}
            class={`btn btn-secondary h-7 px-3 gap-2 transition-colors ${
              copied() ? "text-success border-success/30 bg-success/5" : ""
            }`}
          >
            <i class={`fa-solid ${copied() ? "fa-check" : "fa-copy"}`} />
            <span>{copied() ? "Copied" : "Copy Error"}</span>
          </button>
        </div>
      </div>
      <div class="text-error text-m font-mono whitespace-pre-wrap leading-relaxed select-text p-4 bg-error/5 border border-error/10 rounded-lg">
        {props.error}
      </div>
    </div>
  );
}

function VirtualGrid(props: {
  resultSet: ResultSet;
  onContextMenu: (e: MouseEvent, ri: number) => void;
  onRowDoubleClick?: (ri: number) => void;
  selectedRowIndex: number | null;
}) {
  let containerRef: HTMLDivElement | undefined;
  let columnSelectorButtonRef: HTMLButtonElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);
  const dateFormat = createMemo(
    () => loadExecutionPreferences().resultsDateFormat,
  );

  const [sortConfig, setSortConfig] = createSignal<{
    colIndex: number;
    direction: "asc" | "desc";
  } | null>(null);
  const [filters, setFilters] = createSignal<Record<number, string>>({});
  const [showFilters, setShowFilters] = createSignal(false);
  const [hiddenColumnIndices, setHiddenColumnIndices] = createSignal<
    Set<number>
  >(new Set());
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = createSignal(false);
  const [exportMenuPos, setExportMenuPos] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  const [copied, setCopied] = createSignal(false);

  const visibleColIndices = createMemo(() => {
    return props.resultSet.columns
      .map((_col, i) => (hiddenColumnIndices().has(i) ? -1 : i))
      .filter((i) => i !== -1);
  });

  createEffect(() => {
    const _rs = props.resultSet;
    setSortConfig(null);
    setFilters({});
    setShowFilters(false);
    setScrollTop(0);
    if (containerRef) {
      containerRef.scrollTop = 0;
    }
  });

  const processedRows = createMemo(() => {
    let result = props.resultSet.rows.map((row, i) => ({
      row,
      originalIndex: i,
    }));

    const activeFilters = Object.entries(filters()).filter(
      ([_, val]) => val.trim() !== "",
    );
    if (activeFilters.length > 0) {
      result = result.filter(({ row }) => {
        return activeFilters.every(([colIdxStr, filterText]) => {
          const colIdx = parseInt(colIdxStr, 10);
          const cellVal = row[colIdx];
          if (cellVal == null) return false;
          return String(cellVal)
            .toLowerCase()
            .includes(filterText.toLowerCase());
        });
      });
    }

    const sc = sortConfig();
    if (sc) {
      const { colIndex, direction } = sc;
      result.sort((a, b) => {
        const valA = a.row[colIndex];
        const valB = b.row[colIndex];

        if (valA === valB) return 0;
        if (valA === null) return direction === "asc" ? -1 : 1;
        if (valB === null) return direction === "asc" ? 1 : -1;

        if (typeof valA === "number" && typeof valB === "number") {
          return direction === "asc" ? valA - valB : valB - valA;
        }

        const strA = String(valA).toLowerCase();
        const strB = String(valB).toLowerCase();
        if (strA < strB) return direction === "asc" ? -1 : 1;
        if (strA > strB) return direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  });

  const exportToCsv = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: "query_results.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    await invoke("export_results_csv", {
      path: filePath,
      columns: props.resultSet.columns.map((c) => ({
        name: c.name,
        type_name: c.type_name,
      })),
      rows: processedRows().map(({ row }) => row),
    });
  };

  const exportToJson = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: "query_results.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!filePath) return;
    await invoke("export_results_json", {
      path: filePath,
      columns: props.resultSet.columns.map((c) => ({
        name: c.name,
        type_name: c.type_name,
      })),
      rows: processedRows().map(({ row }) => row),
    });
  };

  const exportToXlsx = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: "query_results.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!filePath) return;
    await invoke("export_results_xlsx", {
      path: filePath,
      columns: props.resultSet.columns.map((c) => ({
        name: c.name,
        type_name: c.type_name,
      })),
      rows: processedRows().map(({ row }) => row),
    });
  };

  const escapeMarkdownCell = (val: unknown): string => {
    if (val == null) return "";
    return String(val)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  };

  const copyAsMarkdown = async () => {
    const cols = props.resultSet.columns;
    const header = `| ${cols.map((c) => escapeMarkdownCell(c.name)).join(" | ")} |`;
    const sep = `| ${cols.map(() => "---").join(" | ")} |`;
    const body = processedRows()
      .map(({ row }) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`)
      .join("\n");
    const text = [header, sep, body].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy markdown:", err);
    }
  };

  const handleExportClick = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setExportMenuPos({ x: rect.left, y: rect.bottom + 4 });
  };

  const rowHeight = 28;
  const buffer = 10;
  const charWidth = 9;
  const cellPadding = 24;
  const minColWidth = 40;

  const autoWidths = createMemo(() => {
    const sampleSize = Math.min(props.resultSet.rows.length, 100);
    return props.resultSet.columns.map((col, ci) => {
      let maxLen =
        col.name.length + (col.type_name ? col.type_name.length + 4 : 0);
      for (let ri = 0; ri < sampleSize; ri++) {
        const cell = props.resultSet.rows[ri][ci];
        const len = cell != null ? String(cell).length : 4;
        if (len > maxLen) maxLen = len;
      }
      return Math.min(maxLen * charWidth + cellPadding, 600);
    });
  });

  const [colOverrides, setColOverrides] = createSignal<Record<number, number>>(
    {},
  );
  const colWidths = createMemo(() =>
    autoWidths().map((w, i) => colOverrides()[i] ?? w),
  );
  const rowNumberColWidth = createMemo(() => {
    const maxRowNumber = Math.max(processedRows().length, 1);
    return Math.max(36, String(maxRowNumber).length * charWidth + 18);
  });

  let dragRef: { colIndex: number; startX: number; startWidth: number } | null =
    null;

  onMount(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef) return;
      const delta = e.clientX - dragRef.startX;
      const newWidth = Math.max(minColWidth, dragRef.startWidth + delta);
      setColOverrides((prev) => ({ ...prev, [dragRef!.colIndex]: newWidth }));
    };
    const onMouseUp = () => {
      if (!dragRef) return;
      dragRef = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    onCleanup(() => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    });
  });

  const startResize = (e: MouseEvent, colIndex: number) => {
    e.preventDefault();
    dragRef = {
      colIndex,
      startX: e.clientX,
      startWidth: colWidths()[colIndex],
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  onMount(() => {
    if (!containerRef) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setContainerHeight(entries[0].contentRect.height);
    });
    observer.observe(containerRef);
    setContainerHeight(containerRef.clientHeight);
    onCleanup(() => observer.disconnect());
  });

  const handleSort = (colIndex: number) => {
    setSortConfig((prev) => {
      if (prev?.colIndex === colIndex) {
        if (prev.direction === "asc") return { colIndex, direction: "desc" };
        return null;
      }
      return { colIndex, direction: "asc" };
    });
  };

  const toggleColumnVisibility = (index: number) => {
    setHiddenColumnIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const toggleAllColumns = (showAll: boolean) => {
    if (showAll) {
      setHiddenColumnIndices(new Set(props.resultSet.columns.map((_, i) => i)));
    } else {
      setHiddenColumnIndices(new Set<number>());
    }
  };

  const startIndex = () =>
    Math.max(0, Math.floor(scrollTop() / rowHeight) - buffer);
  const endIndex = () =>
    Math.min(
      processedRows().length,
      Math.ceil((scrollTop() + containerHeight()) / rowHeight) + buffer,
    );

  const visibleRows = () => processedRows().slice(startIndex(), endIndex());

  return (
    <div class="flex flex-col h-full min-h-[180px] gap-2">
      <Show when={props.resultSet.columns.length > 0}>
        <div class="flex items-center justify-end px-1 gap-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={copyAsMarkdown}
              class={`btn btn-table ${copied() ? "is-success" : ""}`}
              title="Copy table as Markdown"
            >
              <i
                class={`fa-solid ${copied() ? "fa-check" : "fa-copy"} text-2xs`}
              />
              <span>{copied() ? "Copied" : "Copy"}</span>
            </button>
            <button
              type="button"
              aria-label="Export results"
              onClick={handleExportClick}
              class={`btn btn-table ${exportMenuPos() ? "is-active" : ""}`}
              title="Export results"
            >
              <i class="fa-solid fa-download text-2xs" />
              <span class="hidden xs:block">Export</span>
              <i
                class={`fa-solid fa-chevron-down text-icon-xs opacity-40 transition-transform ${
                  exportMenuPos() ? "rotate-180" : ""
                }`}
              />
            </button>
            <Show when={exportMenuPos()}>
              {(pos) => (
                <ContextMenu
                  x={pos().x}
                  y={pos().y}
                  items={[
                    {
                      id: "export-csv",
                      label: "Export to CSV",
                      icon: <i class="fa-solid fa-file-csv" />,
                      onClick: exportToCsv,
                    },
                    {
                      id: "export-json",
                      label: "Export to JSON",
                      icon: <i class="fa-solid fa-file-code" />,
                      onClick: exportToJson,
                    },
                    {
                      id: "export-xlsx",
                      label: "Export to Excel",
                      icon: <i class="fa-solid fa-file-excel" />,
                      onClick: exportToXlsx,
                    },
                  ]}
                  onClose={() => setExportMenuPos(null)}
                />
              )}
            </Show>

            <div class="toolbar-sep" />

            <div class="relative">
              <button
                ref={columnSelectorButtonRef}
                type="button"
                onClick={() => setIsColumnSelectorOpen(!isColumnSelectorOpen())}
                class={`btn btn-table ${isColumnSelectorOpen() ? "is-active" : ""}`}
                title="Column visibility"
              >
                <i class="fa-solid fa-table-columns text-2xs" />
                <span>Columns</span>
                <Show when={hiddenColumnIndices().size > 0}>
                  <span class="btn-table-badge">
                    {hiddenColumnIndices().size}
                  </span>
                </Show>
                <i
                  class={`fa-solid fa-chevron-down text-icon-xs opacity-40 transition-transform ${
                    isColumnSelectorOpen() ? "rotate-180" : ""
                  }`}
                />
              </button>
              <Show when={isColumnSelectorOpen()}>
                <ColumnSelector
                  columns={props.resultSet.columns}
                  hiddenColumnIndices={hiddenColumnIndices()}
                  onToggle={toggleColumnVisibility}
                  onToggleAll={toggleAllColumns}
                  anchorRef={columnSelectorButtonRef!}
                  onClose={() => setIsColumnSelectorOpen(false)}
                />
              </Show>
            </div>
          </div>
        </div>
      </Show>
      <div
        ref={containerRef}
        class="results-table-container overflow-auto rounded-lg border border-border/20 flex-1"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table
          class="results-table"
          style={{
            "table-layout": "fixed",
            "--results-row-number-width": `${rowNumberColWidth()}px`,
          }}
        >
          <colgroup>
            <col style={{ width: `${rowNumberColWidth()}px` }} />
            <For each={visibleColIndices()}>
              {(ci) => <col style={{ width: `${colWidths()[ci]}px` }} />}
            </For>
            <col />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center px-0 bg-surface-table border-b border-r border-border/40 align-top py-1.5">
                <div class="flex flex-col items-center justify-center h-full min-h-[24px]">
                  <button
                    type="button"
                    aria-label={
                      showFilters() ? "Hide column filters" : "Show column filters"
                    }
                    onClick={() => setShowFilters(!showFilters())}
                    class={`p-1 rounded hover:bg-surface-hover transition-colors ${
                      Object.values(filters()).some((v) => v.trim())
                        ? "text-accent"
                        : "text-text-muted/60"
                    }`}
                    title="Toggle filters"
                  >
                    <i class="fa-solid fa-filter text-[10px]" />
                  </button>
                  <Show when={showFilters()}>
                    <div class="mt-2 text-[10px] text-text-muted/40 font-normal">
                      #
                    </div>
                  </Show>
                </div>
              </th>
              <For each={visibleColIndices()}>
                {(i) => {
                  const col = props.resultSet.columns[i];
                  return (
                    <th class="bg-surface-table border-b border-r border-border/40 px-3 py-1.5 align-top">
                      <button
                        type="button"
                        aria-label={`Sort by ${col.name}`}
                        class="flex w-full items-center justify-between gap-3 cursor-pointer select-none border-0 bg-transparent p-0 text-left text-inherit hover:text-text transition-colors"
                        onClick={() => handleSort(i)}
                      >
                        <span class="truncate">{col.name}</span>
                        <div class="flex items-center gap-2">
                          <span class="text-[10px] text-text-muted/30 font-normal uppercase tracking-wider shrink-0">
                            {col.type_name}
                          </span>
                          <Show
                            when={sortConfig()?.colIndex === i}
                            fallback={
                              <i class="fa-solid fa-sort text-text-muted/20 hover:text-text-muted/50 text-[10px] w-2 flex justify-center" />
                            }
                          >
                            <i
                              class={`fa-solid ${
                                sortConfig()!.direction === "asc"
                                  ? "fa-sort-up mt-1"
                                  : "fa-sort-down mb-1"
                              } text-accent text-[10px] w-2 flex justify-center`}
                            />
                          </Show>
                        </div>
                      </button>
                      <Show when={showFilters()}>
                        <div class="mt-1.5 mb-0.5">
                          <input
                            type="text"
                            name={`filter-${i}`}
                            autocomplete="off"
                            aria-label={`Filter ${col.name}`}
                            class="results-filter-input"
                            placeholder="Filter…"
                            value={filters()[i] || ""}
                            onInput={(e) =>
                              setFilters((prev) => ({
                                ...prev,
                                [i]: (e.target as HTMLInputElement).value,
                              }))
                            }
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                      </Show>
                      <div
                        class="col-resizer"
                        onMouseDown={(e) => startResize(e, i)}
                      />
                    </th>
                  );
                }}
              </For>
              <th class="bg-surface-table border-b border-border/40" />
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: `${startIndex() * rowHeight}px` }}>
              <td
                colSpan={visibleColIndices().length + 2}
                style={{ padding: "0", border: "0", background: "transparent" }}
              />
            </tr>
            <For each={visibleRows()}>
              {({ row, originalIndex }, i) => {
                const visualIndex = () => startIndex() + i();
                return (
                  <tr
                    class={
                      originalIndex === props.selectedRowIndex ? "selected" : ""
                    }
                    style={{ height: `${rowHeight}px` }}
                    onContextMenu={(e) => props.onContextMenu(e, originalIndex)}
                    onDblClick={() => props.onRowDoubleClick?.(originalIndex)}
                  >
                    <td class="text-center px-0 text-text-muted/60 border-r border-r-border/10">
                      {visualIndex() + 1}
                    </td>
                    <For each={visibleColIndices()}>
                      {(ci) => {
                        const cell = row[ci];
                        const col = props.resultSet.columns[ci];
                        const formattedValue = formatSqlDateValue(
                          cell,
                          col.type_name,
                          dateFormat(),
                        );

                        return (
                          <td
                            title={formattedValue}
                            class="border-r border-r-border/5"
                          >
                            {cell != null ? (
                              formattedValue
                            ) : (
                              <span class="text-text-muted/40 italic">
                                NULL
                              </span>
                            )}
                          </td>
                        );
                      }}
                    </For>
                    <td />
                  </tr>
                );
              }}
            </For>
            <tr
              style={{
                height: `${Math.max(0, (processedRows().length - endIndex()) * rowHeight)}px`,
              }}
            >
              <td
                colSpan={visibleColIndices().length + 2}
                style={{ padding: "0", border: "0", background: "transparent" }}
              />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ResultsGrid(props: Props) {
  const [rowContextMenu, setRowContextMenu] =
    createSignal<RowContextMenuState | null>(null);
  const [tableName, setTableName] = createSignal<string | null>(null);
  const [actionDialog, setActionDialog] =
    createSignal<RowActionDialogState | null>(null);
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;

  createEffect(() => {
    const sql = props.sourceSql;
    if (!sql) {
      setTableName(null);
      return;
    }
    invoke<string | null>("extract_table_name", { sql })
      .then(setTableName)
      .catch(() => setTableName(null));
  });

  const handleContextMenu = (e: MouseEvent, ri: number, rsi: number) => {
    e.preventDefault();
    setRowContextMenu({
      x: e.clientX,
      y: e.clientY,
      rowIndex: ri,
      resultSetIndex: rsi,
    });
  };

  return (
    <Show
      when={!props.isExecuting}
      fallback={
        <div class="h-full bg-surface">
          <EmptyState
            icon={
              <div class="mb-5 h-8 w-8 rounded-full border-[3px] border-accent/20 border-t-accent animate-spin" />
            }
            title={<span class="animate-pulse">Executing query…</span>}
          />
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <ErrorSection
            error={props.error!}
            onSendToChat={props.onSendErrorToChat}
          />
        }
      >
        <Show
          when={props.result}
          fallback={
            <div class="h-full bg-surface">
              <EmptyState
                icon={null}
                description={
                  <>
                    Press{" "}
                    <kbd class="px-1.5 py-0.5 rounded-md bg-surface-header border border-border/50 text-xs font-mono font-medium text-text mx-1">
                      F5
                    </kbd>
                    or{" "}
                    <kbd class="px-1.5 py-0.5 rounded-md bg-surface-header border border-border/50 text-xs font-mono font-medium text-text mx-1">
                      {executeShortcutLabel}
                    </kbd>{" "}
                    to execute
                  </>
                }
              />
            </div>
          }
        >
          {(result) => {
            const hasResults = () => result().result_sets.length > 0;

            const currentResultSet = () => {
              const menu = rowContextMenu();
              return menu && result().result_sets[menu.resultSetIndex]
                ? result().result_sets[menu.resultSetIndex]
                : null;
            };
            const selectedRow = () => {
              const rs = currentResultSet();
              const menu = rowContextMenu();
              return rs && menu ? rs.rows[menu.rowIndex] : null;
            };
            const openActionDialog = (mode: RowActionMode) => {
              const menu = rowContextMenu();
              if (!menu) return;
              setActionDialog({
                mode,
                rowIndex: menu.rowIndex,
                resultSetIndex: menu.resultSetIndex,
              });
            };

            const openActionDialogForRow = (
              mode: RowActionMode,
              rowIndex: number,
              resultSetIndex: number,
            ) => {
              setRowContextMenu(null);
              setActionDialog({ mode, rowIndex, resultSetIndex });
            };

            const canDoRowActions = () => !!tableName() && !!props.sourceSql;

            const contextMenuItems = (): ContextMenuItem[] => {
              const items: ContextMenuItem[] = [
                {
                  id: "copy-row",
                  label: "Copy",
                  icon: <i class="fa-solid fa-copy" />,
                  onClick: () => {
                    const row = selectedRow();
                    if (!row) return;
                    const text = row
                      .map((v) => (v === null ? "NULL" : String(v)))
                      .join("\t");
                    navigator.clipboard.writeText(text);
                  },
                },
                { id: "sep-copy", separator: true },
                {
                  id: "edit-row",
                  label: "Edit Row",
                  icon: <i class="fa-solid fa-pen-to-square" />,
                  disabled: !canDoRowActions(),
                  onClick: () => openActionDialog("edit"),
                },
                {
                  id: "duplicate-row",
                  label: "Duplicate Row",
                  icon: <i class="fa-solid fa-clone" />,
                  disabled: !canDoRowActions(),
                  onClick: () => openActionDialog("duplicate"),
                },
                {
                  id: "delete-row",
                  label: "Delete Row",
                  icon: <i class="fa-solid fa-trash-can" />,
                  disabled: !canDoRowActions(),
                  onClick: () => openActionDialog("delete"),
                },
              ];

              if (!tableName()) {
                items.push({ id: "sep1", separator: true });
                items.push({
                  id: "hint-text",
                  label: "Run a single-table SELECT for row actions",
                  disabled: true,
                });
              }

              return items;
            };

            return (
              <div class="flex flex-col h-full overflow-auto p-3 gap-3">
                <Show
                  when={hasResults()}
                  fallback={
                    <div class="p-4 text-text-muted text-m font-sans">
                      <p class="text-success font-semibold flex items-center gap-2 mb-2">
                        <i class="fa-solid fa-check-circle" />
                        Query executed successfully.
                      </p>
                      <div class="space-y-1.5 opacity-80">
                        <Show when={result().rows_affected > 0}>
                          <p>{result().rows_affected} row(s) affected.</p>
                        </Show>
                        <p class="text-s">
                          Execution time: {result().elapsed_ms}ms
                        </p>
                        <For each={result().messages}>
                          {(msg) => (
                            <p class="text-s bg-surface-hover p-2 rounded-md border border-border/10">
                              {msg}
                            </p>
                          )}
                        </For>
                      </div>
                    </div>
                  }
                >
                  <For each={result().result_sets}>
                    {(rs, i) => (
                      <>
                        <Show when={rs.truncated}>
                          <div class="flex items-center gap-2 px-3 py-2 text-s text-warning bg-warning/10 border border-warning/30 rounded-md">
                            <i class="fa-solid fa-circle-exclamation" />
                            {result().result_sets.length > 1
                              ? `Result set ${i() + 1} truncated to ${rs.rows.length} row${rs.rows.length === 1 ? "" : "s"}`
                              : `Results truncated to ${rs.rows.length} row${rs.rows.length === 1 ? "" : "s"}`}{" "}
                            (Execution row limit in Settings → Execution).
                          </div>
                        </Show>
                        <VirtualGrid
                          resultSet={rs}
                          selectedRowIndex={
                            rowContextMenu()?.resultSetIndex === i()
                              ? rowContextMenu()!.rowIndex
                              : null
                          }
                          onContextMenu={(e, ri) =>
                            handleContextMenu(e, ri, i())
                          }
                          onRowDoubleClick={(ri) => {
                            if (!loadExecutionPreferences().doubleClickEditRow)
                              return;
                            if (!canDoRowActions()) return;
                            openActionDialogForRow("edit", ri, i());
                          }}
                        />
                      </>
                    )}
                  </For>
                </Show>
                <Show when={rowContextMenu()}>
                  {(menu) => (
                    <ContextMenu
                      x={menu().x}
                      y={menu().y}
                      items={contextMenuItems()}
                      onClose={() => setRowContextMenu(null)}
                    />
                  )}
                </Show>
                <Show when={actionDialog()}>
                  {(dialog) => {
                    const rs = () =>
                      result().result_sets[dialog().resultSetIndex];
                    const row = () => rs()?.rows[dialog().rowIndex];
                    return (
                      <Show when={rs() && row()}>
                        <RowActionsDialog
                          mode={dialog().mode}
                          columns={rs()!.columns}
                          row={row()!}
                          sourceSql={props.sourceSql!}
                          onClose={() => setActionDialog(null)}
                          onSuccess={() => {
                            setActionDialog(null);
                            props.onReExecute?.();
                          }}
                        />
                      </Show>
                    );
                  }}
                </Show>
              </div>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
