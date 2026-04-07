import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function VirtualGrid({
  resultSet,
  onContextMenu,
  selectedRowIndex,
}: {
  resultSet: ResultSet;
  onContextMenu: (e: React.MouseEvent, ri: number) => void;
  selectedRowIndex: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const [sortConfig, setSortConfig] = useState<{ colIndex: number; direction: "asc" | "desc" } | null>(null);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [hiddenColumnIndices, setHiddenColumnIndices] = useState<Set<number>>(new Set());
  const [isColumnSelectorOpen, setIsColumnSelectorOpen] = useState(false);
  const [exportMenuPos, setExportMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const columnSelectorButtonRef = useRef<HTMLButtonElement>(null);

  const visibleColIndices = useMemo(() => {
    return resultSet.columns
      .map((col, i) => (hiddenColumnIndices.has(i) ? -1 : i))
      .filter((i) => i !== -1);
  }, [resultSet.columns, hiddenColumnIndices]);

  useEffect(() => {
    setSortConfig(null);
    setFilters({});
    setShowFilters(false);
    setScrollTop(0);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [resultSet]);

  const processedRows = useMemo(() => {
    let result = resultSet.rows.map((row, i) => ({ row, originalIndex: i }));

    const activeFilters = Object.entries(filters).filter(([_, val]) => val.trim() !== "");
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

    if (sortConfig) {
      const { colIndex, direction } = sortConfig;
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
  }, [resultSet, filters, sortConfig]);

  const copyToClipboard = useCallback(async () => {
    const header = resultSet.columns.map((col) => col.name).join("\t");
    const rows = processedRows.map(({ row }) =>
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
  }, [resultSet.columns, processedRows]);

  const exportToCsv = useCallback(() => {
    const header = resultSet.columns.map((col) => `"${col.name.replace(/"/g, '""')}"`).join(",");
    const rows = processedRows.map(({ row }) =>
      row.map((cell) => (cell != null ? `"${String(cell).replace(/"/g, '""')}"` : "")).join(","),
    );
    const text = [header, ...rows].join("\n");
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query_results.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [resultSet.columns, processedRows]);

  const exportToJson = useCallback(() => {
    const data = processedRows.map(({ row }) => {
      const obj: Record<string, any> = {};
      resultSet.columns.forEach((col, i) => {
        obj[col.name] = row[i];
      });
      return obj;
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "query_results.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [resultSet.columns, processedRows]);

  const handleExportClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setExportMenuPos({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const rowHeight = 28;
  const buffer = 10;
  const charWidth = 9;
  const cellPadding = 24;
  const minColWidth = 40;

  const autoWidths = useMemo(() => {
    const sampleSize = Math.min(resultSet.rows.length, 100);
    return resultSet.columns.map((col, ci) => {
      let maxLen = col.name.length + (col.type_name ? col.type_name.length + 4 : 0);
      for (let ri = 0; ri < sampleSize; ri++) {
        const cell = resultSet.rows[ri][ci];
        const len = cell != null ? String(cell).length : 4;
        if (len > maxLen) maxLen = len;
      }
      return Math.min(maxLen * charWidth + cellPadding, 600);
    });
  }, [resultSet]);

  const [colOverrides, setColOverrides] = useState<Record<number, number>>({});
  const colWidths = useMemo(
    () => autoWidths.map((w, i) => colOverrides[i] ?? w),
    [autoWidths, colOverrides],
  );

  const dragRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const newWidth = Math.max(minColWidth, dragRef.current.startWidth + delta);
      setColOverrides((prev) => ({ ...prev, [dragRef.current!.colIndex]: newWidth }));
    };
    const onMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startResize = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    dragRef.current = { colIndex, startX: e.clientX, startWidth: colWidths[colIndex] };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [colWidths]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setContainerHeight(entries[0].contentRect.height);
    });
    observer.observe(containerRef.current);
    setContainerHeight(containerRef.current.clientHeight);
    return () => observer.disconnect();
  }, []);

  const handleSort = useCallback((colIndex: number) => {
    setSortConfig((prev) => {
      if (prev?.colIndex === colIndex) {
        if (prev.direction === "asc") return { colIndex, direction: "desc" };
        return null;
      }
      return { colIndex, direction: "asc" };
    });
  }, []);

  const toggleColumnVisibility = useCallback((index: number) => {
    setHiddenColumnIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleAllColumns = useCallback(
    (showAll: boolean) => {
      if (showAll) {
        setHiddenColumnIndices(new Set(resultSet.columns.map((_, i) => i)));
      } else {
        setHiddenColumnIndices(new Set());
      }
    },
    [resultSet.columns],
  );

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
  const endIndex = Math.min(
    processedRows.length,
    Math.ceil((scrollTop + containerHeight) / rowHeight) + buffer,
  );

  const visibleRows = processedRows.slice(startIndex, endIndex);

  return (
    <div className="flex flex-col h-full min-h-[180px] gap-2">
      {resultSet.columns.length > 0 && (
        <div className="flex items-center justify-end px-1 gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={copyToClipboard}
              className={`flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-border/30 bg-surface/40 text-text-muted hover:text-text hover:bg-surface/60 transition-all cursor-pointer ${copied ? "text-success border-success/30 bg-success/5" : ""
                }`}
              title="Copy table to clipboard"
            >
              <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"} text-[10px]`} />
              <span className="text-[11px] font-medium">{copied ? "Copied!" : "Copy"}</span>
            </button>
            <button
              onClick={handleExportClick}
              className={`flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-border/30 bg-surface/40 text-text-muted hover:text-text hover:bg-surface/60 transition-all cursor-pointer ${exportMenuPos ? "bg-surface-active text-text" : ""
                }`}
              title="Export results"
            >
              <i className="fa-solid fa-download text-[10px]" />
              <span className="text-[11px] font-medium hidden xs:block">Export</span>
              <i
                className={`fa-solid fa-chevron-down text-[8px] opacity-40 transition-transform ${exportMenuPos ? "rotate-180" : ""
                  }`}
              />
            </button>
            {exportMenuPos && (
              <ContextMenu
                x={exportMenuPos.x}
                y={exportMenuPos.y}
                items={[
                  {
                    id: "export-csv",
                    label: "Export to CSV",
                    icon: <i className="fa-solid fa-file-csv" />,
                    onClick: exportToCsv,
                  },
                  {
                    id: "export-json",
                    label: "Export to JSON",
                    icon: <i className="fa-solid fa-file-code" />,
                    onClick: exportToJson,
                  },
                ]}
                onClose={() => setExportMenuPos(null)}
              />
            )}

            <div className="toolbar-sep" />

            <div className="relative">
              <button
                ref={columnSelectorButtonRef}
                onClick={() => setIsColumnSelectorOpen(!isColumnSelectorOpen)}
                className={`flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-border/30 bg-surface/40 text-text-muted hover:text-text hover:bg-surface/60 transition-all cursor-pointer ${isColumnSelectorOpen ? "bg-surface-active text-text" : ""
                  }`}
                title="Column visibility"
              >
                <i className="fa-solid fa-table-columns text-[10px]" />
                <span className="text-[11px] font-medium">Columns</span>
                {hiddenColumnIndices.size > 0 && (
                  <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent text-white text-[9px] font-bold">
                    {hiddenColumnIndices.size}
                  </span>
                )}
                <i
                  className={`fa-solid fa-chevron-down text-[8px] opacity-40 transition-transform ${isColumnSelectorOpen ? "rotate-180" : ""
                    }`}
                />
              </button>
              {isColumnSelectorOpen && (
                <ColumnSelector
                  columns={resultSet.columns}
                  hiddenColumnIndices={hiddenColumnIndices}
                  onToggle={toggleColumnVisibility}
                  onToggleAll={toggleAllColumns}
                  anchorRef={columnSelectorButtonRef}
                  onClose={() => setIsColumnSelectorOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className="results-table-container overflow-auto rounded-lg border border-border/20 flex-1"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="results-table" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 28 }} />
            {visibleColIndices.map((ci) => (
              <col key={ci} style={{ width: colWidths[ci] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="text-center px-0 bg-surface-table border-b border-r border-border/40 align-top py-1.5">
                <div className="flex flex-col items-center justify-center h-full min-h-[24px]">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`p-1 rounded hover:bg-surface-hover transition-colors ${Object.values(filters).some((v) => v.trim())
                      ? "text-accent"
                      : "text-text-muted/60"
                      }`}
                    title="Toggle filters"
                  >
                    <i className="fa-solid fa-filter text-[10px]" />
                  </button>
                  {showFilters && (
                    <div className="mt-2 text-[10px] text-text-muted/40 font-normal">#</div>
                  )}
                </div>
              </th>
              {visibleColIndices.map((i) => {
                const col = resultSet.columns[i];
                return (
                  <th
                    key={i}
                    className="bg-surface-table border-b border-r border-border/40 px-3 py-1.5 align-top"
                  >
                    <div
                      className="flex items-center justify-between gap-3 cursor-pointer select-none hover:text-text transition-colors"
                      onClick={() => handleSort(i)}
                    >
                      <span className="truncate">{col.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-text-muted/30 font-normal uppercase tracking-wider shrink-0">
                          {col.type_name}
                        </span>
                        {sortConfig?.colIndex === i ? (
                          <i
                            className={`fa-solid ${sortConfig.direction === "asc" ? "fa-sort-up mt-1" : "fa-sort-down mb-1"
                              } text-accent text-[10px] w-2 flex justify-center`}
                          />
                        ) : (
                          <i className="fa-solid fa-sort text-text-muted/20 hover:text-text-muted/50 text-[10px] w-2 flex justify-center" />
                        )}
                      </div>
                    </div>
                    {showFilters && (
                      <div className="mt-1.5 mb-0.5">
                        <input
                          type="text"
                          className="w-full bg-surface border border-border/40 rounded px-1.5 py-0.5 text-xs text-text outline-none focus:border-accent font-normal"
                          placeholder="Filter..."
                          value={filters[i] || ""}
                          onChange={(e) => setFilters((prev) => ({ ...prev, [i]: e.target.value }))}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <div
                      className="col-resizer"
                      onMouseDown={(e) => startResize(e, i)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: startIndex * rowHeight }}>
              <td colSpan={visibleColIndices.length + 1} style={{ padding: 0, border: 0, background: 'transparent' }} />
            </tr>
            {visibleRows.map(({ row, originalIndex }, i) => {
              const visualIndex = startIndex + i;
              return (
                <tr
                  key={originalIndex}
                  className={originalIndex === selectedRowIndex ? "selected" : ""}
                  style={{ height: rowHeight }}
                  onContextMenu={(e) => onContextMenu(e, originalIndex)}
                >
                  <td className="text-center px-0 text-text-muted/60 border-r border-border/10">
                    {visualIndex + 1}
                  </td>
                  {visibleColIndices.map((ci) => {
                    const cell = row[ci];
                    return (
                      <td
                        key={ci}
                        title={cell != null ? String(cell) : "NULL"}
                        className="border-r border-border/5"
                      >
                        {cell != null ? (
                          String(cell)
                        ) : (
                          <span className="text-text-muted/40 italic">NULL</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr style={{ height: Math.max(0, (processedRows.length - endIndex) * rowHeight) }}>
              <td colSpan={visibleColIndices.length + 1} style={{ padding: 0, border: 0, background: 'transparent' }} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ResultsGrid({
  result,
  error,
  isExecuting,
  sourceSql,
  onGenerateSql,
}: Props) {
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState | null>(null);
  const tableName = useMemo(() => extractTableName(sourceSql), [sourceSql]);
  const executeShortcutLabel = `${getModifierKeyLabel()}+Enter`;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, ri: number, rsi: number) => {
      e.preventDefault();
      setRowContextMenu({ x: e.clientX, y: e.clientY, rowIndex: ri, resultSetIndex: rsi });
    },
    [],
  );

  if (isExecuting) {
    return (
      <div className="h-full bg-surface">
        <EmptyState
          icon={<div className="mb-5 h-8 w-8 rounded-full border-[3px] border-accent/20 border-t-accent animate-spin" />}
          title={<span className="animate-pulse">Executing query...</span>}
        />
      </div>
    );
  }

  if (error) {
    const [copied, setCopied] = useState(false);
    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(error);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy error:", err);
      }
    };

    return (
      <div className="p-4 h-full overflow-auto bg-surface flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-s font-semibold text-error/80 flex items-center gap-2">
            <i className="fa-solid fa-circle-exclamation" />
            Query Error
          </span>
          <button
            onClick={handleCopy}
            className={`btn btn-secondary h-7 px-3 gap-2 transition-all ${copied ? "text-success border-success/30 bg-success/5" : ""
              }`}
          >
            <i className={`fa-solid ${copied ? "fa-check" : "fa-copy"}`} />
            <span>{copied ? "Copied!" : "Copy Error"}</span>
          </button>
        </div>
        <div className="text-error text-m font-mono whitespace-pre-wrap leading-relaxed select-text p-4 bg-error/5 border border-error/10 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="h-full bg-surface">
        <EmptyState
          icon={null}
          description={
            <>
              Press <kbd className="px-1.5 py-0.5 rounded-md bg-surface-header border border-border/50 text-xs font-mono font-medium text-text mx-1">F5</kbd>
              or <kbd className="px-1.5 py-0.5 rounded-md bg-surface-header border border-border/50 text-xs font-mono font-medium text-text mx-1">{executeShortcutLabel}</kbd> to execute
            </>
          }
        />
      </div>
    );
  }

  const hasResults = result.result_sets.length > 0;

  const currentResultSet =
    rowContextMenu && result.result_sets[rowContextMenu.resultSetIndex]
      ? result.result_sets[rowContextMenu.resultSetIndex]
      : null;
  const selectedRow =
    currentResultSet && rowContextMenu ? currentResultSet.rows[rowContextMenu.rowIndex] : null;
  const canGenerateRowSql = !!tableName && !!selectedRow && !!onGenerateSql;

  const contextMenuItems: ContextMenuItem[] = [
    {
      id: "copy-row",
      label: "Copy",
      icon: <i className="fa-solid fa-copy" />,
      onClick: () => {
        if (!selectedRow) return;
        const text = selectedRow.map((v) => (v === null ? "NULL" : String(v))).join("\t");
        navigator.clipboard.writeText(text);
      },
    },
    { id: "sep-copy", separator: true },
    {
      id: "edit-row",
      label: "Edit Row",
      icon: <i className="fa-solid fa-pen-to-square" />,
      disabled: !canGenerateRowSql,
      onClick: () => {
        if (!canGenerateRowSql || !selectedRow || !tableName || !onGenerateSql || !currentResultSet)
          return;
        onGenerateSql(buildUpdateSql(tableName, currentResultSet.columns, selectedRow));
      },
    },
    {
      id: "duplicate-row",
      label: "Duplicate Row",
      icon: <i className="fa-solid fa-clone" />,
      disabled: !canGenerateRowSql,
      onClick: () => {
        if (!canGenerateRowSql || !selectedRow || !tableName || !onGenerateSql || !currentResultSet)
          return;
        onGenerateSql(buildInsertSql(tableName, currentResultSet.columns, selectedRow));
      },
    },
    {
      id: "delete-row",
      label: "Delete Row",
      icon: <i className="fa-solid fa-trash-can" />,
      disabled: !canGenerateRowSql,
      onClick: () => {
        if (!canGenerateRowSql || !selectedRow || !tableName || !onGenerateSql || !currentResultSet)
          return;
        onGenerateSql(buildDeleteSql(tableName, currentResultSet.columns, selectedRow));
      },
    },
  ];

  if (!tableName) {
    contextMenuItems.push({ id: "sep1", separator: true });
    contextMenuItems.push({
      id: "hint-text",
      label: "Run a single-table SELECT for row actions",
      disabled: true,
    });
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-3">
      {hasResults ? (
        result.result_sets.map((rs, i) => (
          <VirtualGrid
            key={i}
            resultSet={rs}
            selectedRowIndex={rowContextMenu?.resultSetIndex === i ? rowContextMenu.rowIndex : null}
            onContextMenu={(e, ri) => handleContextMenu(e, ri, i)}
          />
        ))
      ) : (
        <div className="p-4 text-text-muted text-m font-sans">
          <p className="text-success font-semibold flex items-center gap-2 mb-2">
            <i className="fa-solid fa-check-circle" />
            Query executed successfully.
          </p>
          <div className="space-y-1.5 opacity-80">
            {result.rows_affected > 0 && (
              <p>{result.rows_affected} row(s) affected.</p>
            )}
            <p className="text-s">Execution time: {result.elapsed_ms}ms</p>
            {result.messages.map((msg, i) => (
              <p key={i} className="text-s bg-surface-hover p-2 rounded-md border border-border/10">
                {msg}
              </p>
            ))}
          </div>
        </div>
      )}
      {rowContextMenu && (
        <ContextMenu
          x={rowContextMenu.x}
          y={rowContextMenu.y}
          items={contextMenuItems}
          onClose={() => setRowContextMenu(null)}
        />
      )}
    </div>
  );
}
