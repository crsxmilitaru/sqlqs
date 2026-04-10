import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { getModifierKeyLabel } from "../lib/platform";
import type { QueryResult, ResultSet } from "../lib/types";
import ColumnSelector from "./ColumnSelector";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import EmptyState from "./EmptyState";

interface Props {
  result?: QueryResult;
  error?: string;
  isExecuting: boolean;
  sourceSql?: string;
  onGenerateSql?: (sql: string) => void;
}

interface RowContextMenuState {
  x: number;
  y: number;
  rowIndex: number;
  resultSetIndex: number;
}

function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTableName(sql?: string): string | null {
  if (!sql) return null;
  const normalized = stripComments(sql);
  if (!normalized) return null;

  const fromMatch = normalized.match(/\bfrom\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (fromMatch?.[1]) return fromMatch[1].replace(/[;,]+$/, "");

  const updateMatch = normalized.match(/\bupdate\s+([a-zA-Z0-9_.\[\]"]+)/i);
  if (updateMatch?.[1]) return updateMatch[1].replace(/[;,]+$/, "");

  return null;
}

function quoteIdentifier(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";

  const text =
    typeof value === "string"
      ? value
      : (() => {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      })();

  return `N'${text.replace(/'/g, "''")}'`;
}

function buildWhereClause(
  columns: ResultSet["columns"],
  row: ResultSet["rows"][number],
): string {
  const predicates = columns.map((c, i) => {
    const col = quoteIdentifier(c.name);
    const val = row[i];
    return val === null ? `${col} IS NULL` : `${col} = ${sqlLiteral(val)}`;
  });
  return predicates.length > 0 ? predicates.join("\n  AND ") : "1 = 0";
}

function buildUpdateSql(
  tableName: string,
  columns: ResultSet["columns"],
  row: ResultSet["rows"][number],
): string {
  const setClause = columns
    .map((c, i) => `  ${quoteIdentifier(c.name)} = ${sqlLiteral(row[i])}`)
    .join(",\n");
  const whereClause = buildWhereClause(columns, row);

  return `-- Update row in ${tableName}\nUPDATE ${tableName}\nSET\n${setClause}\nWHERE\n  ${whereClause};`;
}

function buildDeleteSql(
  tableName: string,
  columns: ResultSet["columns"],
  row: ResultSet["rows"][number],
): string {
  const whereClause = buildWhereClause(columns, row);

  return `-- Delete row from ${tableName}\nDELETE FROM ${tableName}\nWHERE\n  ${whereClause};`;
}

function buildInsertSql(
  tableName: string,
  columns: ResultSet["columns"],
  row: ResultSet["rows"][number],
): string {
  const colNames = columns.map((c) => quoteIdentifier(c.name)).join(", ");
  const valList = row.map((v) => sqlLiteral(v)).join(", ");
  return `-- Insert row into ${tableName}\nINSERT INTO ${tableName} (${colNames})\nVALUES (${valList});`;
}

function ErrorSection(props: { error: string }) {
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
        <button
          onClick={handleCopy}
          class={`btn btn-secondary h-7 px-3 gap-2 transition-all ${copied() ? "text-success border-success/30 bg-success/5" : ""
            }`}
        >
          <i class={`fa-solid ${copied() ? "fa-check" : "fa-copy"}`} />
          <span>{copied() ? "Copied!" : "Copy Error"}</span>
        </button>
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
  selectedRowIndex: number | null;
}) {
  let containerRef: HTMLDivElement | undefined;
  let columnSelectorButtonRef: HTMLButtonElement | undefined;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  const [sortConfig, setSortConfig] = createSignal<{ colIndex: number; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = createSignal<Record<number, string>>({});
  const [showFilters, setShowFilters] = createSignal(false);
  const [hiddenColumnIndices, setHiddenColumnIndices] = createSignal<Set<number>>(new Set());
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = createSignal(false);
  const [exportMenuPos, setExportMenuPos] = createSignal<{ x: number; y: number } | null>(null);
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
    let result = props.resultSet.rows.map((row, i) => ({ row, originalIndex: i }));

    const activeFilters = Object.entries(filters()).filter(([_, val]) => val.trim() !== "");
    if (activeFilters.length > 0) {
      result = result.filter(({ row }) => {
        return activeFilters.every(([colIdxStr, filterText]) => {
          const colIdx = parseInt(colIdxStr, 10);
          const cellVal = row[colIdx];
          if (cellVal == null) return false;
          return String(cellVal).toLowerCase().includes(filterText.toLowerCase());
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

  const copyToClipboard = async () => {
    const header = props.resultSet.columns.map((col) => col.name).join("\t");
    const rows = processedRows().map(({ row }) =>
      row.map((cell) => (cell != null ? String(cell) : "NULL")).join("\t"),
    );
    const text = [header, ...rows].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const exportToCsv = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await save({
      defaultPath: "query_results.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    const header = props.resultSet.columns.map((col) => `"${col.name.replace(/"/g, '""')}"`).join(",");
    const rows = processedRows().map(({ row }) =>
      row.map((cell) => (cell != null ? `"${String(cell).replace(/"/g, '""')}"` : "")).join(","),
    );
    const text = [header, ...rows].join("\n");
    await writeTextFile(filePath, text);
  };

  const exportToJson = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await save({
      defaultPath: "query_results.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!filePath) return;
    const data = processedRows().map(({ row }) => {
      const obj: Record<string, any> = {};
      props.resultSet.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
    await writeTextFile(filePath, JSON.stringify(data, null, 2));
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
      let maxLen = col.name.length + (col.type_name ? col.type_name.length + 4 : 0);
      for (let ri = 0; ri < sampleSize; ri++) {
        const cell = props.resultSet.rows[ri][ci];
        const len = cell != null ? String(cell).length : 4;
        if (len > maxLen) maxLen = len;
      }
      return Math.min(maxLen * charWidth + cellPadding, 600);
    });
  });

  const [colOverrides, setColOverrides] = createSignal<Record<number, number>>({});
  const colWidths = createMemo(
    () => autoWidths().map((w, i) => colOverrides()[i] ?? w),
  );

  let dragRef: { colIndex: number; startX: number; startWidth: number } | null = null;

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
    dragRef = { colIndex, startX: e.clientX, startWidth: colWidths()[colIndex] };
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
      setHiddenColumnIndices(new Set());
    }
  };

  const startIndex = () => Math.max(0, Math.floor(scrollTop() / rowHeight) - buffer);
  const endIndex = () => Math.min(
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
              onClick={copyToClipboard}
              class={`flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-border/30 bg-surface/40 text-text-muted hover:text-text hover:bg-surface/60 transition-all cursor-pointer ${copied() ? "text-success border-success/30 bg-success/5" : ""
                }`}
              title="Copy table to clipboard"
            >
              <i class={`fa-solid ${copied() ? "fa-check" : "fa-copy"} text-[10px]`} />
              <span class="text-[11px] font-medium">{copied() ? "Copied!" : "Copy"}</span>
            </button>
            <button
              onClick={handleExportClick}
              class={`flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-border/30 bg-surface/40 text-text-muted hover:text-text hover:bg-surface/60 transition-all cursor-pointer ${exportMenuPos() ? "bg-surface-active text-text" : ""
                }`}
              title="Export results"
            >
              <i class="fa-solid fa-download text-[10px]" />
              <span class="text-[11px] font-medium hidden xs:block">Export</span>
              <i
                class={`fa-solid fa-chevron-down text-[8px] opacity-40 transition-transform ${exportMenuPos() ? "rotate-180" : ""
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
                  ]}
                  onClose={() => setExportMenuPos(null)}
                />
              )}
            </Show>

            <div class="toolbar-sep" />

            <div class="relative">
              <button
                ref={columnSelectorButtonRef}
                onClick={() => setIsColumnSelectorOpen(!isColumnSelectorOpen())}
                class={`flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-border/30 bg-surface/40 text-text-muted hover:text-text hover:bg-surface/60 transition-all cursor-pointer ${isColumnSelectorOpen() ? "bg-surface-active text-text" : ""
                  }`}
                title="Column visibility"
              >
                <i class="fa-solid fa-table-columns text-[10px]" />
                <span class="text-[11px] font-medium">Columns</span>
                <Show when={hiddenColumnIndices().size > 0}>
                  <span class="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent text-white text-[9px] font-bold">
                    {hiddenColumnIndices().size}
                  </span>
                </Show>
                <i
                  class={`fa-solid fa-chevron-down text-[8px] opacity-40 transition-transform ${isColumnSelectorOpen() ? "rotate-180" : ""
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
        <table class="results-table" style={{ "table-layout": "fixed" }}>
          <colgroup>
            <col style={{ width: "28px" }} />
            <For each={visibleColIndices()}>
              {(ci) => (
                <col style={{ width: `${colWidths()[ci]}px` }} />
              )}
            </For>
          </colgroup>
          <thead>
            <tr>
              <th class="text-center px-0 bg-surface-table border-b border-r border-border/40 align-top py-1.5">
                <div class="flex flex-col items-center justify-center h-full min-h-[24px]">
                  <button
                    onClick={() => setShowFilters(!showFilters())}
                    class={`p-1 rounded hover:bg-surface-hover transition-colors ${Object.values(filters()).some((v) => v.trim())
                      ? "text-accent"
                      : "text-text-muted/60"
                      }`}
                    title="Toggle filters"
                  >
                    <i class="fa-solid fa-filter text-[10px]" />
                  </button>
                  <Show when={showFilters()}>
                    <div class="mt-2 text-[10px] text-text-muted/40 font-normal">#</div>
                  </Show>
                </div>
              </th>
              <For each={visibleColIndices()}>
                {(i) => {
                  const col = props.resultSet.columns[i];
                  return (
                    <th
                      class="bg-surface-table border-b border-r border-border/40 px-3 py-1.5 align-top"
                    >
                      <div
                        class="flex items-center justify-between gap-3 cursor-pointer select-none hover:text-text transition-colors"
                        onClick={() => handleSort(i)}
                      >
                        <span class="truncate">{col.name}</span>
                        <div class="flex items-center gap-2">
                          <span class="text-[10px] text-text-muted/30 font-normal uppercase tracking-wider shrink-0">
                            {col.type_name}
                          </span>
                          <Show when={sortConfig()?.colIndex === i} fallback={
                            <i class="fa-solid fa-sort text-text-muted/20 hover:text-text-muted/50 text-[10px] w-2 flex justify-center" />
                          }>
                            <i
                              class={`fa-solid ${sortConfig()!.direction === "asc" ? "fa-sort-up mt-1" : "fa-sort-down mb-1"
                                } text-accent text-[10px] w-2 flex justify-center`}
                            />
                          </Show>
                        </div>
                      </div>
                      <Show when={showFilters()}>
                        <div class="mt-1.5 mb-0.5">
                          <input
                            type="text"
                            class="w-full bg-surface border border-border/40 rounded px-1.5 py-0.5 text-xs text-text outline-none focus:border-accent font-normal"
                            placeholder="Filter..."
                            value={filters()[i] || ""}
                            onInput={(e) => setFilters((prev) => ({ ...prev, [i]: (e.target as HTMLInputElement).value }))}
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
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: `${startIndex() * rowHeight}px` }}>
              <td colSpan={visibleColIndices().length + 1} style={{ padding: "0", border: "0", background: "transparent" }} />
            </tr>
            <For each={visibleRows()}>
              {({ row, originalIndex }, i) => {
                const visualIndex = () => startIndex() + i();
                return (
                  <tr
                    class={originalIndex === props.selectedRowIndex ? "selected" : ""}
                    style={{ height: `${rowHeight}px` }}
                    onContextMenu={(e) => props.onContextMenu(e, originalIndex)}
                  >
                    <td class="text-center px-0 text-text-muted/60 border-r border-border/10">
                      {visualIndex() + 1}
                    </td>
                    <For each={visibleColIndices()}>
                      {(ci) => {
                        const cell = row[ci];
                        return (
                          <td
                            title={cell != null ? String(cell) : "NULL"}
                            class="border-r border-border/5"
                          >
                            {cell != null ? (
                              String(cell)
                            ) : (
                              <span class="text-text-muted/40 italic">NULL</span>
                            )}
                          </td>
                        );
                      }}
                    </For>
                  </tr>
                );
              }}
            </For>
            <tr style={{ height: `${Math.max(0, (processedRows().length - endIndex()) * rowHeight)}px` }}>
              <td colSpan={visibleColIndices().length + 1} style={{ padding: "0", border: "0", background: "transparent" }} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ResultsGrid(props: Props) {
  const [rowContextMenu, setRowContextMenu] = createSignal<RowContextMenuState | null>(null);
  const tableName = createMemo(() => extractTableName(props.sourceSql));
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;

  const handleContextMenu = (e: MouseEvent, ri: number, rsi: number) => {
    e.preventDefault();
    setRowContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri, resultSetIndex: rsi });
  };

  return (
    <Show when={!props.isExecuting} fallback={
      <div class="h-full bg-surface">
        <EmptyState
          icon={<div class="mb-5 h-8 w-8 rounded-full border-[3px] border-accent/20 border-t-accent animate-spin" />}
          title={<span class="animate-pulse">Executing query...</span>}
        />
      </div>
    }>
      <Show when={!props.error} fallback={
        <ErrorSection error={props.error!} />
      }>
        <Show when={props.result} fallback={
          <div class="h-full bg-surface">
            <EmptyState
              icon={null}
              description={
                <>
                  Press <kbd class="px-1.5 py-0.5 rounded-md bg-surface-header border border-border/50 text-xs font-mono font-medium text-text mx-1">F5</kbd>
                  or <kbd class="px-1.5 py-0.5 rounded-md bg-surface-header border border-border/50 text-xs font-mono font-medium text-text mx-1">{executeShortcutLabel}</kbd> to execute
                </>
              }
            />
          </div>
        }>
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
            const canGenerateRowSql = () => !!tableName() && !!selectedRow() && !!props.onGenerateSql;

            const contextMenuItems = (): ContextMenuItem[] => {
              const items: ContextMenuItem[] = [
                {
                  id: "copy-row",
                  label: "Copy",
                  icon: <i class="fa-solid fa-copy" />,
                  onClick: () => {
                    const row = selectedRow();
                    if (!row) return;
                    const text = row.map((v) => (v === null ? "NULL" : String(v))).join("\t");
                    navigator.clipboard.writeText(text);
                  },
                },
                { id: "sep-copy", separator: true },
                {
                  id: "edit-row",
                  label: "Edit Row",
                  icon: <i class="fa-solid fa-pen-to-square" />,
                  disabled: !canGenerateRowSql(),
                  onClick: () => {
                    const row = selectedRow();
                    const tn = tableName();
                    const rs = currentResultSet();
                    if (!canGenerateRowSql() || !row || !tn || !props.onGenerateSql || !rs) return;
                    props.onGenerateSql(buildUpdateSql(tn, rs.columns, row));
                  },
                },
                {
                  id: "duplicate-row",
                  label: "Duplicate Row",
                  icon: <i class="fa-solid fa-clone" />,
                  disabled: !canGenerateRowSql(),
                  onClick: () => {
                    const row = selectedRow();
                    const tn = tableName();
                    const rs = currentResultSet();
                    if (!canGenerateRowSql() || !row || !tn || !props.onGenerateSql || !rs) return;
                    props.onGenerateSql(buildInsertSql(tn, rs.columns, row));
                  },
                },
                {
                  id: "delete-row",
                  label: "Delete Row",
                  icon: <i class="fa-solid fa-trash-can" />,
                  disabled: !canGenerateRowSql(),
                  onClick: () => {
                    const row = selectedRow();
                    const tn = tableName();
                    const rs = currentResultSet();
                    if (!canGenerateRowSql() || !row || !tn || !props.onGenerateSql || !rs) return;
                    props.onGenerateSql(buildDeleteSql(tn, rs.columns, row));
                  },
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
                <Show when={hasResults()} fallback={
                  <div class="p-4 text-text-muted text-m font-sans">
                    <p class="text-success font-semibold flex items-center gap-2 mb-2">
                      <i class="fa-solid fa-check-circle" />
                      Query executed successfully.
                    </p>
                    <div class="space-y-1.5 opacity-80">
                      <Show when={result().rows_affected > 0}>
                        <p>{result().rows_affected} row(s) affected.</p>
                      </Show>
                      <p class="text-s">Execution time: {result().elapsed_ms}ms</p>
                      <For each={result().messages}>
                        {(msg) => (
                          <p class="text-s bg-surface-hover p-2 rounded-md border border-border/10">
                            {msg}
                          </p>
                        )}
                      </For>
                    </div>
                  </div>
                }>
                  <For each={result().result_sets}>
                    {(rs, i) => (
                      <VirtualGrid
                        resultSet={rs}
                        selectedRowIndex={rowContextMenu()?.resultSetIndex === i() ? rowContextMenu()!.rowIndex : null}
                        onContextMenu={(e, ri) => handleContextMenu(e, ri, i())}
                      />
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
              </div>
            );
          }}
        </Show>
      </Show>
    </Show>
  );
}
