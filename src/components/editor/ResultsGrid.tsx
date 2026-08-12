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
import type { JSX } from "solid-js";
import { getModifierKeyLabel } from "../../lib/platform";
import { baseFileName } from "../../lib/path";
import { loadExecutionPreferences } from "../../lib/settings";
import { formatSqlDateValue } from "../../lib/sql-date";
import { startTaskbarOperation } from "../../lib/taskbar";
import type { QueryResult, ResultSet } from "../../lib/types";
import ColumnSelector from "./ColumnSelector";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import EmptyState from "../ui/EmptyState";
import { Loader } from "../ui/Loader";
import Tooltip from "../ui/Tooltip";
import RowActionsDialog, {
  type RowActionMode,
} from "../dialogs/RowActionsDialog";
import { toast } from "../ui/Toaster";

interface Props {
  result?: QueryResult;
  error?: string;
  errorTone?: "error" | "cancelled";
  isExecuting: boolean;
  sourceSql?: string;
  tableViewStates: Record<number, ResultsTableViewState | undefined>;
  onTableViewStateChange: (
    resultSetIndex: number,
    state: ResultsTableViewState,
  ) => void;
  onGenerateSql?: (sql: string) => void;
  onReExecute?: () => void;
  onSendErrorToChat?: (error: string) => void;
  onSendResultToChat?: (markdown: string) => void;
}

export type ResultsSortConfig = {
  colIndex: number;
  direction: "asc" | "desc";
} | null;

export interface ResultsTableViewState {
  sortConfig: ResultsSortConfig;
  filters: Record<number, string>;
  showFilters: boolean;
}

type ProcessedResultRow = {
  row: ResultSet["rows"][number];
  originalIndex: number;
};

const AUTO_EXPAND_RESULT_SET_THRESHOLD = 3;
const MAX_CHAT_RESULT_ROWS = 50;

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
  colIndex: number | null;
}

function ErrorSection(props: {
  error: string;
  tone?: "error" | "cancelled";
  onSendToChat?: (error: string) => void;
}) {
  const [copied, setCopied] = createSignal(false);
  const isCancelled = () => props.tone === "cancelled";
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
        <span
          class={`text-s font-semibold flex items-center gap-2 ${
            isCancelled() ? "text-warning/80" : "text-error/80"
          }`}
        >
          <i
            class={`fa-solid ${
              isCancelled() ? "fa-circle-info" : "fa-circle-exclamation"
            }`}
          />
          {isCancelled() ? "Query Cancelled" : "Query Error"}
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
            <span>{copied() ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <div
        class={`text-m font-mono whitespace-pre-wrap leading-relaxed select-text p-4 rounded-lg border ${
          isCancelled()
            ? "text-warning bg-warning/5 border-warning/10"
            : "text-error bg-error/5 border-error/10"
        }`}
      >
        {props.error}
      </div>
    </div>
  );
}

function VirtualGrid(props: {
  resultSet: ResultSet;
  viewState?: ResultsTableViewState;
  onViewStateChange: (state: ResultsTableViewState) => void;
  onContextMenu: (e: MouseEvent, ri: number, ci: number | null) => void;
  onEditRow?: (ri: number) => void;
  canEditRows?: boolean;
  selectedRowIndex: number | null;
  renderHeaderActions?: (controls: JSX.Element) => JSX.Element;
  onSendToChat?: (markdown: string) => void;
}) {
  let containerRef: HTMLDivElement | undefined;
  let headerRef: HTMLTableSectionElement | undefined;
  let columnSelectorButtonRef: HTMLButtonElement | undefined;
  const rawRowCache = new Map<number, ProcessedResultRow>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);
  const [headerHeight, setHeaderHeight] = createSignal(0);
  const dateFormat = createMemo(
    () => loadExecutionPreferences().resultsDateFormat,
  );

  const [hiddenColumnIndices, setHiddenColumnIndices] = createSignal<
    Set<number>
  >(new Set());
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = createSignal(false);
  const [exportMenuPos, setExportMenuPos] = createSignal<{
    x: number;
    y: number;
  } | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [headerContextMenu, setHeaderContextMenu] = createSignal<{
    x: number;
    y: number;
    colIndex: number;
  } | null>(null);
  const [filterContextMenu, setFilterContextMenu] = createSignal<{
    x: number;
    y: number;
    colIndex: number;
    input: HTMLInputElement;
    selectionStart: number;
    selectionEnd: number;
    selectionText: string;
  } | null>(null);

  const visibleColIndices = createMemo(() => {
    return props.resultSet.columns
      .map((_col, i) => (hiddenColumnIndices().has(i) ? -1 : i))
      .filter((i) => i !== -1);
  });

  const viewState = (): ResultsTableViewState =>
    props.viewState ?? {
      sortConfig: null,
      filters: {},
      showFilters: true,
    };

  const sortConfig = () => viewState().sortConfig;
  const filters = () => viewState().filters;
  const showFilters = () => viewState().showFilters;

  const updateViewState = (
    updater: (prev: ResultsTableViewState) => ResultsTableViewState,
  ) => {
    props.onViewStateChange(updater(viewState()));
  };

  const setSortConfig = (
    value:
      | ResultsSortConfig
      | ((prev: ResultsSortConfig) => ResultsSortConfig),
  ) => {
    updateViewState((prev) => ({
      ...prev,
      sortConfig: typeof value === "function" ? value(prev.sortConfig) : value,
    }));
  };

  const setFilters = (
    value:
      | Record<number, string>
      | ((prev: Record<number, string>) => Record<number, string>),
  ) => {
    updateViewState((prev) => ({
      ...prev,
      filters: typeof value === "function" ? value(prev.filters) : value,
    }));
  };

  const setShowFilters = (value: boolean | ((prev: boolean) => boolean)) => {
    updateViewState((prev) => ({
      ...prev,
      showFilters:
        typeof value === "function" ? value(prev.showFilters) : value,
    }));
  };

  createEffect(() => {
    const _rs = props.resultSet;
    rawRowCache.clear();
    setScrollTop(0);
    if (containerRef) {
      containerRef.scrollTop = 0;
    }
  });

  const activeFilters = createMemo(() =>
    Object.entries(filters())
      .map(([colIdxStr, value]) => ({
        colIndex: parseInt(colIdxStr, 10),
        filterText: value.trim().toLowerCase(),
      }))
      .filter(
        ({ colIndex, filterText }) =>
          colIndex >= 0 &&
          colIndex < props.resultSet.columns.length &&
          filterText !== "",
      ),
  );

  const hasValidSort = () => {
    const sc = sortConfig();
    return !!(
      sc &&
      sc.colIndex >= 0 &&
      sc.colIndex < props.resultSet.columns.length
    );
  };

  const processedRows = createMemo<ProcessedResultRow[] | null>(() => {
    const filtersToApply = activeFilters();
    const shouldSort = hasValidSort();
    if (filtersToApply.length === 0 && !shouldSort) {
      return null;
    }

    let result: ProcessedResultRow[];
    if (filtersToApply.length > 0) {
      result = [];
      props.resultSet.rows.forEach((row, originalIndex) => {
        const matches = filtersToApply.every(({ colIndex, filterText }) => {
          const cellVal = row[colIndex];
          if (cellVal == null) return false;
          return String(cellVal).toLowerCase().includes(filterText);
        });
        if (matches) result.push({ row, originalIndex });
      });
    } else {
      result = props.resultSet.rows.map((row, originalIndex) => ({
        row,
        originalIndex,
      }));
    }

    const sc = sortConfig();
    if (shouldSort && sc) {
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

  const processedRowCount = () =>
    processedRows()?.length ?? props.resultSet.rows.length;

  const getRawProcessedRow = (index: number): ProcessedResultRow => {
    const row = props.resultSet.rows[index];
    const cached = rawRowCache.get(index);
    if (cached && cached.row === row) return cached;
    const next = { row, originalIndex: index };
    rawRowCache.set(index, next);
    return next;
  };

  const getProcessedRowsForRange = (
    start: number,
    end: number,
  ): ProcessedResultRow[] => {
    const processed = processedRows();
    if (processed) return processed.slice(start, end);

    const rows: ProcessedResultRow[] = [];
    for (let i = start; i < end; i++) {
      rows.push(getRawProcessedRow(i));
    }
    return rows;
  };

  const getAllProcessedRows = () =>
    processedRows() ??
    props.resultSet.rows.map((row, originalIndex) => ({ row, originalIndex }));

  const exportToCsv = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: "query_results.csv",
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!filePath) return;
    const taskbarOperation = startTaskbarOperation();
    try {
      await invoke("export_results_csv", {
        path: filePath,
        columns: props.resultSet.columns.map((c) => ({
          name: c.name,
          type_name: c.type_name,
        })),
        rows: getAllProcessedRows().map(({ row }) => row),
      });
      taskbarOperation.complete();
      toast.success(`Exported to ${baseFileName(filePath)}`);
    } catch (err) {
      taskbarOperation.fail();
      toast.error(`CSV export failed: ${String(err)}`);
    }
  };

  const exportToJson = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: "query_results.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!filePath) return;
    const taskbarOperation = startTaskbarOperation();
    try {
      await invoke("export_results_json", {
        path: filePath,
        columns: props.resultSet.columns.map((c) => ({
          name: c.name,
          type_name: c.type_name,
        })),
        rows: getAllProcessedRows().map(({ row }) => row),
      });
      taskbarOperation.complete();
      toast.success(`Exported to ${baseFileName(filePath)}`);
    } catch (err) {
      taskbarOperation.fail();
      toast.error(`JSON export failed: ${String(err)}`);
    }
  };

  const exportToXlsx = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const filePath = await save({
      defaultPath: "query_results.xlsx",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
    });
    if (!filePath) return;
    const taskbarOperation = startTaskbarOperation();
    try {
      await invoke("export_results_xlsx", {
        path: filePath,
        columns: props.resultSet.columns.map((c) => ({
          name: c.name,
          type_name: c.type_name,
        })),
        rows: getAllProcessedRows().map(({ row }) => row),
      });
      taskbarOperation.complete();
      toast.success(`Exported to ${baseFileName(filePath)}`);
    } catch (err) {
      taskbarOperation.fail();
      toast.error(`Excel export failed: ${String(err)}`);
    }
  };

  const escapeMarkdownCell = (val: unknown): string => {
    if (val == null) return "";
    return String(val)
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ");
  };

  const buildResultMarkdown = (maxRows?: number): string => {
    const cols = props.resultSet.columns;
    const header = `| ${cols.map((c) => escapeMarkdownCell(c.name)).join(" | ")} |`;
    const sep = `| ${cols.map(() => "---").join(" | ")} |`;
    const allRows = getAllProcessedRows();
    const rows = maxRows ? allRows.slice(0, maxRows) : allRows;
    const body = rows
      .map(({ row }) => `| ${row.map(escapeMarkdownCell).join(" | ")} |`)
      .join("\n");
    const lines = [header, sep, body];
    if (maxRows && allRows.length > maxRows) {
      lines.push(`\n*(${allRows.length - maxRows} more rows truncated)*`);
    }
    return lines.filter(Boolean).join("\n");
  };

  const copyAsMarkdown = async () => {
    const text = buildResultMarkdown();
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
  const buffer = 6;
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
    const maxRowNumber = Math.max(processedRowCount(), 1);
    return Math.max(36, String(maxRowNumber).length * charWidth + 18);
  });
  const tableWidth = createMemo(() => {
    const dataColsWidth = visibleColIndices().reduce(
      (sum, i) => sum + colWidths()[i],
      0,
    );
    return rowNumberColWidth() + dataColsWidth + minColWidth;
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

  const handleResizerDoubleClick = (e: MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    setColOverrides((prev) => {
      const next = { ...prev };
      delete next[colIndex];
      return next;
    });
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

  onMount(() => {
    if (!headerRef) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setHeaderHeight(entries[0].contentRect.height);
    });
    observer.observe(headerRef);
    setHeaderHeight(headerRef.clientHeight);
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

  const setColumnVisibility = (indices: number[], hidden: boolean) => {
    setHiddenColumnIndices((prev) => {
      const next = new Set(prev);
      if (hidden) {
        indices.forEach((i) => next.add(i));
      } else {
        indices.forEach((i) => next.delete(i));
      }
      return next;
    });
  };

  const bodyScrollTop = () => Math.max(0, scrollTop() - headerHeight());
  const viewportBodyHeight = () =>
    Math.max(0, containerHeight() - headerHeight());
  const startIndex = () =>
    Math.max(0, Math.floor(bodyScrollTop() / rowHeight) - buffer);
  const endIndex = () =>
    Math.min(
      processedRowCount(),
      Math.ceil((bodyScrollTop() + viewportBodyHeight()) / rowHeight) + buffer,
    );

  const visibleRows = () => getProcessedRowsForRange(startIndex(), endIndex());
  const bodyHeight = () => processedRowCount() * rowHeight;
  const bodyOffset = () => startIndex() * rowHeight;

  let pendingScrollTop = 0;
  let scrollFrame: number | null = null;
  const handleScroll = (e: Event) => {
    pendingScrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
    if (scrollFrame !== null) return;

    scrollFrame = requestAnimationFrame(() => {
      setScrollTop(pendingScrollTop);
      scrollFrame = null;
    });
  };

  onCleanup(() => {
    if (scrollFrame !== null) {
      cancelAnimationFrame(scrollFrame);
    }
  });

  const replaceFilterSelection = (
    menu: NonNullable<ReturnType<typeof filterContextMenu>>,
    text: string,
  ) => {
    const value = filters()[menu.colIndex] || "";
    const nextValue =
      value.slice(0, menu.selectionStart) + text + value.slice(menu.selectionEnd);
    const nextCursor = menu.selectionStart + text.length;

    setFilters((prev) => ({
      ...prev,
      [menu.colIndex]: nextValue,
    }));

    requestAnimationFrame(() => {
      menu.input.focus();
      menu.input.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const filterContextMenuItems = (): ContextMenuItem[] => {
    const menu = filterContextMenu();
    if (!menu) return [];
    const value = filters()[menu.colIndex] || "";
    const hasSelection = menu.selectionStart !== menu.selectionEnd;

    return [
      {
        id: "cut-filter",
        label: "Cut",
        icon: <i class="fa-solid fa-scissors" />,
        shortcut: `${getModifierKeyLabel()}+X`,
        disabled: !hasSelection,
        onClick: () => {
          void invoke("write_clipboard", { text: menu.selectionText });
          replaceFilterSelection(menu, "");
        },
      },
      {
        id: "copy-filter",
        label: "Copy",
        icon: <i class="fa-solid fa-copy" />,
        shortcut: `${getModifierKeyLabel()}+C`,
        disabled: !hasSelection,
        onClick: () => {
          void invoke("write_clipboard", { text: menu.selectionText });
          menu.input.focus();
        },
      },
      {
        id: "paste-filter",
        label: "Paste",
        icon: <i class="fa-solid fa-paste" />,
        shortcut: `${getModifierKeyLabel()}+V`,
        onClick: async () => {
          try {
            const text = await invoke<string>("read_clipboard");
            replaceFilterSelection(menu, text);
          } catch {
            menu.input.focus();
          }
        },
      },
      { id: "sep-filter", separator: true },
      {
        id: "select-all-filter",
        label: "Select All",
        icon: <i class="fa-solid fa-check-double" />,
        shortcut: `${getModifierKeyLabel()}+A`,
        disabled: value.length === 0,
        onClick: () => {
          menu.input.focus();
          menu.input.select();
        },
      },
    ];
  };

  const handleFilterContextMenu = (e: MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();

    const input = e.currentTarget as HTMLInputElement;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? 0;

    setHeaderContextMenu(null);
    setFilterContextMenu({
      x: e.clientX,
      y: e.clientY,
      colIndex,
      input,
      selectionStart,
      selectionEnd,
      selectionText: input.value.slice(selectionStart, selectionEnd),
    });
  };

  const headerContextMenuItems = (): ContextMenuItem[] => {
    const menu = headerContextMenu();
    if (!menu) return [];
    const idx = menu.colIndex;
    const col = props.resultSet.columns[idx];
    const isCurrentSort = sortConfig()?.colIndex === idx;
    const currentSortDir = sortConfig()?.direction;

    return [
      {
        id: "copy-col-name",
        label: "Copy Column Name",
        icon: <i class="fa-solid fa-copy" />,
        onClick: () => {
          navigator.clipboard.writeText(col.name);
        },
      },
      { id: "sep-header-1", separator: true },
      {
        id: "sort-asc",
        label: "Sort Ascending",
        icon: <i class="fa-solid fa-sort-up" />,
        disabled: isCurrentSort && currentSortDir === "asc",
        onClick: () => {
          setSortConfig({ colIndex: idx, direction: "asc" });
        },
      },
      {
        id: "sort-desc",
        label: "Sort Descending",
        icon: <i class="fa-solid fa-sort-down" />,
        disabled: isCurrentSort && currentSortDir === "desc",
        onClick: () => {
          setSortConfig({ colIndex: idx, direction: "desc" });
        },
      },
      {
        id: "clear-sort",
        label: "Clear Sorting",
        icon: <i class="fa-solid fa-sort" />,
        disabled: !isCurrentSort,
        onClick: () => {
          setSortConfig(null);
        },
      },
      { id: "sep-header-2", separator: true },
      {
        id: "hide-col",
        label: "Hide Column",
        icon: <i class="fa-solid fa-eye-slash" />,
        onClick: () => {
          toggleColumnVisibility(idx);
        },
      },
      {
        id: "autofit-col",
        label: "Auto-fit Column",
        icon: <i class="fa-solid fa-arrows-left-right" />,
        disabled: colOverrides()[idx] === undefined,
        onClick: () => {
          setColOverrides((prev) => {
            const next = { ...prev };
            delete next[idx];
            return next;
          });
        },
      },
      {
        id: "autofit-all",
        label: "Reset All Column Widths",
        icon: <i class="fa-solid fa-table-cells" />,
        disabled: Object.keys(colOverrides()).length === 0,
        onClick: () => {
          setColOverrides({});
        },
      },
    ];
  };

  const controls: JSX.Element = (
    <Show when={props.resultSet.columns.length > 0}>
        <div class="result-set-actions flex items-center justify-end gap-2">
          <div class="flex items-center gap-2">
            <Tooltip content="Copy table as Markdown">
              <button
                type="button"
                onClick={copyAsMarkdown}
                class={`btn btn-table ${copied() ? "is-success" : ""}`}
              >
                <i
                  class={`fa-solid ${copied() ? "fa-check" : "fa-copy"} text-2xs`}
                />
                <span>{copied() ? "Copied" : "Copy"}</span>
              </button>
            </Tooltip>
            <Show when={props.onSendToChat}>
              <Tooltip content="Send table to Chat">
                <button
                  type="button"
                  onClick={() =>
                    props.onSendToChat?.(
                      buildResultMarkdown(MAX_CHAT_RESULT_ROWS),
                    )
                  }
                  class="btn btn-table"
                >
                  <i class="fa-solid fa-comment-dots text-2xs" />
                  <span>Send to Chat</span>
                </button>
              </Tooltip>
            </Show>
            <Tooltip content="Export results">
              <button
                type="button"
                aria-label="Export results"
                onClick={handleExportClick}
                class={`btn btn-table ${exportMenuPos() ? "is-active" : ""}`}
              >
                <i class="fa-solid fa-download text-2xs" />
                <span class="hidden xs:block">Export</span>
                <i
                  class={`fa-solid fa-chevron-down text-icon-xs opacity-40 transition-transform ${
                    exportMenuPos() ? "rotate-180" : ""
                  }`}
                />
              </button>
            </Tooltip>
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
              <Tooltip content="Choose visible columns">
                <button
                  ref={columnSelectorButtonRef}
                  type="button"
                  onClick={() => setIsColumnSelectorOpen(!isColumnSelectorOpen())}
                  class={`btn btn-table ${isColumnSelectorOpen() ? "is-active" : ""}`}
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
              </Tooltip>
              <Show when={isColumnSelectorOpen()}>
                <ColumnSelector
                  columns={props.resultSet.columns}
                  hiddenColumnIndices={hiddenColumnIndices()}
                  onToggle={toggleColumnVisibility}
                  onSetHidden={setColumnVisibility}
                  anchorRef={columnSelectorButtonRef!}
                  onClose={() => setIsColumnSelectorOpen(false)}
                />
              </Show>
            </div>
          </div>
        </div>
    </Show>
  );

  return (
    <div class="flex flex-col h-full min-h-0 gap-2">
      {props.renderHeaderActions
        ? props.renderHeaderActions(controls)
        : controls}
      <div
        ref={containerRef}
        class="results-table-container overflow-auto rounded-lg border border-border/20 flex-1 min-h-0"
        onScroll={handleScroll}
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
          <thead ref={headerRef}>
            <tr>
              <th class="text-center px-0 bg-surface-table border-b border-r border-border/40 align-top py-1.5">
                <div class="flex flex-col items-center justify-center h-full min-h-[24px]">
                  <Tooltip content="Toggle filters" placement="bottom">
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
                    >
                      <i class="fa-solid fa-filter text-[10px]" />
                    </button>
                  </Tooltip>
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
                    <th
                      class="bg-surface-table border-b border-r border-border/40 px-3 py-1.5 align-top"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setHeaderContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          colIndex: i,
                        });
                      }}
                    >
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
                            onContextMenu={(e) => handleFilterContextMenu(e, i)}
                          />
                        </div>
                      </Show>
                      <div
                        class="col-resizer"
                        onMouseDown={(e) => startResize(e, i)}
                        onDblClick={(e) => handleResizerDoubleClick(e, i)}
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
                    onContextMenu={(e) => {
                      const td = (e.target as HTMLElement).closest("td");
                      const colAttr = td?.getAttribute("data-col-index");
                      const colIndex =
                        colAttr != null && colAttr !== ""
                          ? Number(colAttr)
                          : null;
                      props.onContextMenu(
                        e,
                        originalIndex,
                        Number.isFinite(colIndex) ? colIndex : null,
                      );
                    }}
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
                            data-col-index={ci}
                            title={formattedValue}
                            class={`results-value-cell border-r border-r-border/5 ${
                              props.canEditRows ? "is-editable" : ""
                            }`}
                          >
                            <span class="results-value-text">
                              {cell != null ? (
                                formattedValue
                              ) : (
                                <span class="text-text-muted/40 italic">
                                  NULL
                                </span>
                              )}
                            </span>
                            <Show when={props.canEditRows}>
                              <button
                                type="button"
                                class="results-cell-edit-btn"
                                aria-label={`Edit ${col.name}`}
                                title={`Edit ${col.name}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  props.onEditRow?.(originalIndex);
                                }}
                              >
                                <i class="fa-solid fa-pen" />
                              </button>
                            </Show>
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
                height: `${Math.max(0, (processedRowCount() - endIndex()) * rowHeight)}px`,
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
      <Show when={headerContextMenu()}>
        {(menu) => (
          <ContextMenu
            x={menu().x}
            y={menu().y}
            items={headerContextMenuItems()}
            onClose={() => setHeaderContextMenu(null)}
          />
        )}
      </Show>
      <Show when={filterContextMenu()}>
        {(menu) => (
          <ContextMenu
            x={menu().x}
            y={menu().y}
            items={filterContextMenuItems()}
            onClose={() => setFilterContextMenu(null)}
          />
        )}
      </Show>
    </div>
  );
}

export default function ResultsGrid(props: Props) {
  const [rowContextMenu, setRowContextMenu] =
    createSignal<RowContextMenuState | null>(null);
  const [tableName, setTableName] = createSignal<string | null>(null);
  const [resultSetTables, setResultSetTables] = createSignal<
    Record<number, string | null>
  >({});
  const [actionDialog, setActionDialog] =
    createSignal<RowActionDialogState | null>(null);
  const [expandedResultSetIndices, setExpandedResultSetIndices] = createSignal<
    Set<number>
  >(new Set());
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;

  let previousResult: QueryResult | undefined;
  createEffect(() => {
    const result = props.result;
    if (result !== previousResult) {
      previousResult = result;
      const count = result?.result_sets.length ?? 0;
      setExpandedResultSetIndices(
        new Set(
          Array.from(
            { length: Math.min(count, AUTO_EXPAND_RESULT_SET_THRESHOLD) },
            (_value, index) => index,
          ),
        ),
      );
    }
  });

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

  createEffect(() => {
    const sql = props.sourceSql;
    const sets = props.result?.result_sets;
    if (!sql || !sets || sets.length === 0) {
      setResultSetTables({});
      return;
    }

    const fromColumns: Record<number, string | null> = {};
    let missing = 0;
    sets.forEach((rs, index) => {
      const base = rs.columns.find((c) => c.base_table_name);
      if (base?.base_table_name) {
        fromColumns[index] = base.base_schema_name
          ? `${base.base_schema_name}.${base.base_table_name}`
          : base.base_table_name;
      } else {
        fromColumns[index] = null;
        missing += 1;
      }
    });
    setResultSetTables(fromColumns);

    if (missing === 0) return;

    invoke<string[]>("extract_result_set_table_names", { sql })
      .then((names) => {
        setResultSetTables((prev) => {
          const map: Record<number, string | null> = { ...prev };
          names.forEach((name, index) => {
            if (!map[index] && name) map[index] = name;
          });
          return map;
        });
      })
      .catch(() => {});
  });

  const toggleResultSet = (index: number) => {
    setRowContextMenu(null);
    setExpandedResultSetIndices((previous) => {
      const next = new Set(previous);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleContextMenu = (
    e: MouseEvent,
    ri: number,
    rsi: number,
    ci: number | null,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setRowContextMenu({
      x: e.clientX,
      y: e.clientY,
      rowIndex: ri,
      resultSetIndex: rsi,
      colIndex: ci,
    });
  };

  return (
    <Show
      when={!props.isExecuting}
      fallback={
        <div class="h-full bg-surface">
          <Loader variant="vertical" text="Executing query…" />
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <ErrorSection
            error={props.error!}
            tone={props.errorTone}
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

            const resolveTableName = (rs: ResultSet | null): string | null => {
              if (!rs) return tableName();
              const rsIndex = result().result_sets.indexOf(rs);
              const mapped = resultSetTables()[rsIndex];
              if (mapped) return mapped;
              if (result().result_sets.length > 1) return null;
              return tableName();
            };
            const currentTableName = () => resolveTableName(currentResultSet());
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

            const canDoRowActions = () => {
              if (!props.sourceSql) return false;
              if (currentTableName()) return true;
              return !!currentResultSet()?.columns.some((c) => c.base_table_name);
            };

            const renderTruncatedNotice = (rs: ResultSet, rsi: number) => (
              <Show when={rs.truncated}>
                <div class="flex items-center gap-2 px-3 py-2 text-s text-warning bg-warning/10 border border-warning/30 rounded-md animate-pulse">
                  <i class="fa-solid fa-circle-exclamation" />
                  {result().result_sets.length > 1
                    ? `Result set ${rsi + 1} truncated to ${rs.rows.length} row${rs.rows.length === 1 ? "" : "s"}`
                    : `Results truncated to ${rs.rows.length} row${rs.rows.length === 1 ? "" : "s"}`}{" "}
                  (Execution row limit in Settings → Execution).
                </div>
              </Show>
            );

            const hasMultipleResultSets = () => result().result_sets.length > 1;
            const resultsContentClass = () =>
              `flex flex-col gap-4 ${
                hasMultipleResultSets() ? "" : "flex-1 min-h-0"
              }`;
            const isResultSetExpanded = (index: number) =>
              !hasMultipleResultSets() || expandedResultSetIndices().has(index);

            const renderResultSetToggle = (rs: ResultSet, rsi: number) => (
              <button
                type="button"
                class="results-set-toggle"
                aria-expanded={isResultSetExpanded(rsi)}
                onClick={() => toggleResultSet(rsi)}
              >
                <span class="results-set-title">
                  <i
                    class={`fa-solid fa-chevron-right transition-transform ${
                      isResultSetExpanded(rsi) ? "rotate-90" : ""
                    }`}
                  />
                  <span>Result set {rsi + 1}</span>
                </span>
                <span class="results-set-meta">
                  <span>
                    {rs.rows.length} row{rs.rows.length === 1 ? "" : "s"}
                  </span>
                  <span>
                    {rs.columns.length} column
                    {rs.columns.length === 1 ? "" : "s"}
                  </span>
                  <Show when={rs.truncated}>
                    <span class="results-set-warning">truncated</span>
                  </Show>
                </span>
              </button>
            );

            const renderResultSet = (rs: ResultSet, rsi: number) => (
              <section
                class={`results-set ${
                  hasMultipleResultSets() ? "is-multiple" : "is-single"
                }`}
              >
                <Show
                  when={
                    hasMultipleResultSets() && !isResultSetExpanded(rsi)
                  }
                >
                  {renderResultSetToggle(rs, rsi)}
                </Show>
                <Show when={isResultSetExpanded(rsi)}>
                  <div
                    class={`results-set-grid ${
                      hasMultipleResultSets() ? "is-multiple" : "is-single"
                    }`}
                  >
                    {renderTruncatedNotice(rs, rsi)}
                    <div class="flex-1 min-h-0">
                      <VirtualGrid
                        resultSet={rs}
                        viewState={props.tableViewStates[rsi]}
                        onViewStateChange={(state) =>
                          props.onTableViewStateChange(rsi, state)
                        }
                        selectedRowIndex={
                          rowContextMenu()?.resultSetIndex === rsi
                            ? rowContextMenu()!.rowIndex
                            : null
                        }
                        onContextMenu={(e, ri, ci) =>
                          handleContextMenu(e, ri, rsi, ci)
                        }
                        onSendToChat={props.onSendResultToChat}
                        canEditRows={canDoRowActions()}
                        onEditRow={(ri) =>
                          openActionDialogForRow("edit", ri, rsi)
                        }
                        renderHeaderActions={
                          hasMultipleResultSets()
                            ? (controls) => (
                                <div class="results-set-expanded-header">
                                  {renderResultSetToggle(rs, rsi)}
                                  {controls}
                                </div>
                              )
                            : undefined
                        }
                      />
                    </div>
                  </div>
                </Show>
              </section>
            );

            const renderResultSets = () => (
              <div
                class={`flex flex-col gap-4 ${
                  hasMultipleResultSets() ? "" : "flex-1 min-h-0"
                }`}
              >
                <For each={result().result_sets}>
                  {(rs, i) => renderResultSet(rs, i())}
                </For>
              </div>
            );

            const renderOrderedOutputs = () => (
              <For each={result().outputs}>
                {(output) => (
                  <Show
                    when={output.type === 0}
                    fallback={
                      <Show when={output.message}>
                        <div class="text-s font-mono whitespace-pre-wrap leading-relaxed text-text-muted bg-surface-hover/30 p-2.5 rounded-md border border-border/10">
                          {output.message}
                        </div>
                      </Show>
                    }
                  >
                    {(() => {
                      const rsi = output.resultSetIndex ?? 0;
                      const rs = result().result_sets[rsi];
                      return rs ? renderResultSet(rs, rsi) : null;
                    })()}
                  </Show>
                )}
              </For>
            );

            const contextMenuItems = (): ContextMenuItem[] => {
              const selectionText = window.getSelection()?.toString().trim();
              const items: ContextMenuItem[] = [];

              if (selectionText) {
                items.push({
                  id: "copy-selection",
                  label: "Copy Selection",
                  icon: <i class="fa-solid fa-i-cursor" />,
                  onClick: () => {
                    navigator.clipboard.writeText(selectionText);
                  },
                });
                items.push({ id: "sep-selection", separator: true });
              }

              const menu = rowContextMenu();
              const row = selectedRow();
              const cellValue =
                row && menu?.colIndex != null ? row[menu.colIndex] : undefined;
              const canCopyValue =
                menu?.colIndex != null &&
                cellValue !== null &&
                cellValue !== undefined;

              items.push(
                {
                  id: "copy-submenu",
                  label: "Copy",
                  icon: <i class="fa-solid fa-copy" />,
                  children: [
                    ...(canCopyValue
                      ? [
                          {
                            id: "copy-value",
                            label: "Copy Value",
                            icon: <i class="fa-solid fa-font" />,
                            onClick: () => {
                              navigator.clipboard.writeText(String(cellValue));
                            },
                          },
                        ]
                      : []),
                    {
                      id: "copy-row",
                      label: "Copy Row Values",
                      icon: <i class="fa-solid fa-table-cells" />,
                      onClick: () => {
                        const selected = selectedRow();
                        if (!selected) return;
                        const text = selected
                          .map((v) => (v === null ? "NULL" : String(v)))
                          .join("\t");
                        navigator.clipboard.writeText(text);
                      },
                    },
                    {
                      id: "copy-row-json",
                      label: "Copy Row as JSON",
                      icon: <i class="fa-solid fa-file-code" />,
                      onClick: () => {
                        const selected = selectedRow();
                        const rs = currentResultSet();
                        if (!selected || !rs) return;
                        const obj: Record<string, any> = {};
                        rs.columns.forEach((col, idx) => {
                          obj[col.name] = selected[idx];
                        });
                        navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
                      },
                    },
                    {
                      id: "copy-row-insert",
                      label: "Copy Row as INSERT",
                      icon: <i class="fa-solid fa-file-import" />,
                      disabled: !currentTableName(),
                      onClick: () => {
                        const selected = selectedRow();
                        const rs = currentResultSet();
                        const table = currentTableName();
                        if (!selected || !rs || !table) return;
                        const colsList = rs.columns.map(c => `[${c.name}]`).join(", ");
                        const valsList = selected.map(val => {
                          if (val === null) return "NULL";
                          if (typeof val === "number") return val;
                          if (typeof val === "boolean") return val ? 1 : 0;
                          return `'${String(val).replace(/'/g, "''")}'`;
                        }).join(", ");
                        navigator.clipboard.writeText(`INSERT INTO ${table} (${colsList}) VALUES (${valsList});`);
                      },
                    },
                  ],
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
              );

              if (!canDoRowActions()) {
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
              <div class="flex flex-col h-full min-h-0 overflow-auto p-4 gap-4 select-text">
                <Show
                  when={result().outputs && result().outputs.length > 0}
                  fallback={
                    <Show
                      when={hasResults()}
                      fallback={
                        <div class="flex flex-col gap-2 font-mono whitespace-pre-wrap leading-relaxed text-text-muted">
                          <p class="text-success font-semibold flex items-center gap-2 mb-2 font-sans">
                            <i class="fa-solid fa-check-circle" />
                            Query executed successfully.
                          </p>

                          <Show when={result().rows_affected > 0}>
                            <p class="text-text-muted font-sans">({result().rows_affected} row(s) affected)</p>
                          </Show>

                          <For each={result().messages}>
                            {(msg) => (
                              <div class="text-s bg-surface-hover/30 p-2.5 rounded-md border border-border/10">
                                {msg}
                              </div>
                            )}
                          </For>
                        </div>
                      }
                    >
                      <div class={resultsContentClass()}>
                        {renderResultSets()}

                        <Show when={result().messages.length > 0 || result().rows_affected > 0}>
                          <div class="border-t border-border/20 pt-4 flex flex-col gap-2 font-mono whitespace-pre-wrap leading-relaxed text-text-muted">
                            <Show when={result().rows_affected > 0}>
                              <p class="text-text-muted font-sans">({result().rows_affected} row(s) affected)</p>
                            </Show>
                            <For each={result().messages}>
                              {(msg) => (
                                <div class="text-s bg-surface-hover/30 p-2.5 rounded-md border border-border/10">
                                  {msg}
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  }
                >
                  <div class={resultsContentClass()}>
                    <Show when={!hasResults()}>
                      <p class="text-success font-semibold flex items-center gap-2 mb-2 font-sans">
                        <i class="fa-solid fa-check-circle" />
                        Query executed successfully.
                      </p>
                    </Show>
                    {renderOrderedOutputs()}
                    <Show when={result().rows_affected > 0}>
                      <div class="border-t border-border/20 pt-2 text-text-muted font-sans text-s">
                        ({result().rows_affected} row(s) affected)
                      </div>
                    </Show>
                  </div>
                </Show>

                <div class="shrink-0" aria-hidden="true" />

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
                          fallbackTableName={resolveTableName(rs() ?? null)}
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
