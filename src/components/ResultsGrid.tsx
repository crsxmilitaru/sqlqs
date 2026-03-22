import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { QueryResult, ResultSet } from "../lib/types";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { getModifierKeyLabel } from "../lib/platform";

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

function normalizedColumnName(name: string): string {
  return name.toLowerCase().replace(/[[\]"]/g, "").replace(/\s+/g, "");
}

function guessKeyColumnIndexes(columns: ResultSet["columns"]): number[] {
  const normalized = columns.map((c, i) => ({ i, n: normalizedColumnName(c.name) }));
  const exactId = normalized.filter((entry) => entry.n === "id").map((entry) => entry.i);
  if (exactId.length > 0) return exactId;

  const idLike = normalized.filter((entry) => entry.n.endsWith("id")).map((entry) => entry.i);
  return idLike;
}

function buildWhereClause(
  columns: ResultSet["columns"],
  row: ResultSet["rows"][number],
  keyIndexes: number[],
): string {
  const indexes = keyIndexes.length > 0 ? keyIndexes : columns.map((_, i) => i);
  const predicates = indexes.map((i) => {
    const col = quoteIdentifier(columns[i].name);
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
  const keyIndexes = guessKeyColumnIndexes(columns);
  const whereClause = buildWhereClause(columns, row, keyIndexes);
  const setIndexes = columns.map((_, i) => i).filter((i) => !keyIndexes.includes(i));
  const effectiveSetIndexes = setIndexes.length > 0 ? setIndexes : columns.map((_, i) => i);
  const setClause = effectiveSetIndexes
    .map((i) => `  ${quoteIdentifier(columns[i].name)} = ${sqlLiteral(row[i])}`)
    .join(",\n");
  const warning = keyIndexes.length === 0 ? "-- Warning: no obvious key column found.\n" : "";

  return `${warning}UPDATE ${tableName}\nSET\n${setClause}\nWHERE\n  ${whereClause};`;
}

function buildDeleteSql(
  tableName: string,
  columns: ResultSet["columns"],
  row: ResultSet["rows"][number],
): string {
  const keyIndexes = guessKeyColumnIndexes(columns);
  const whereClause = buildWhereClause(columns, row, keyIndexes);
  const warning = keyIndexes.length === 0 ? "-- Warning: no obvious key column found.\n" : "";

  return `${warning}DELETE FROM ${tableName}\nWHERE\n  ${whereClause};`;
}

function VirtualGrid({
  resultSet,
  onContextMenu,
}: {
  resultSet: ResultSet;
  onContextMenu: (e: React.MouseEvent, ri: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  const rowHeight = 28;
  const buffer = 10;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) setContainerHeight(entries[0].contentRect.height);
    });
    observer.observe(containerRef.current);
    setContainerHeight(containerRef.current.clientHeight);
    return () => observer.disconnect();
  }, []);

  const totalHeight = resultSet.rows.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
  const endIndex = Math.min(
    resultSet.rows.length,
    Math.ceil((scrollTop + containerHeight) / rowHeight) + buffer,
  );

  const visibleRows = resultSet.rows.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className="overflow-auto relative rounded-lg border border-border/20"
      style={{ minHeight: 180 }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalHeight, width: "100%" }}>
        <table className="results-table w-full relative border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="text-center w-12 sticky top-0 bg-surface-table z-20 border-b border-r border-border/40">
                #
              </th>
              {resultSet.columns.map((col, i) => (
                <th
                  key={i}
                  title={col.type_name}
                  className="sticky top-0 bg-surface-table z-10 border-b border-r border-border/40"
                >
                  {col.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: startIndex * rowHeight }}>
              <td colSpan={resultSet.columns.length + 1} style={{ padding: 0 }} />
            </tr>
            {visibleRows.map((row, i) => {
              const actualIndex = startIndex + i;
              return (
                <tr
                  key={actualIndex}
                  style={{ height: rowHeight }}
                  onContextMenu={(e) => onContextMenu(e, actualIndex)}
                >
                  <td className="text-center text-text-muted/60 bg-surface-table/30 border-r border-border/10">
                    {actualIndex + 1}
                  </td>
                  {row.map((cell, ci) => (
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
                  ))}
                </tr>
              );
            })}
            <tr style={{ height: Math.max(0, (resultSet.rows.length - endIndex) * rowHeight) }}>
              <td colSpan={resultSet.columns.length + 1} style={{ padding: 0 }} />
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
      <div className="flex items-center justify-center h-full text-text-muted text-sm bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 rounded-full border-2 border-accent/20 border-t-accent animate-spin" />
          <span className="animate-pulse">Executing query...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 h-full overflow-auto bg-surface">
        <div className="text-error text-[13px] font-mono whitespace-pre-wrap leading-relaxed">
          {error}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm bg-surface">
        Press F5 or {executeShortcutLabel} to execute
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
      id: "delete-row",
      label: "Delete Row",
      icon: <i className="fa-solid fa-trash-can" />,
      danger: true,
      disabled: !canGenerateRowSql,
      onClick: () => {
        if (!canGenerateRowSql || !selectedRow || !tableName || !onGenerateSql || !currentResultSet)
          return;
        onGenerateSql(buildDeleteSql(tableName, currentResultSet.columns, selectedRow));
      },
    },
    { id: "sep1", separator: true },
    {
      id: "hint-text",
      label: tableName
        ? `Target table: ${tableName}`
        : "Run a single-table SELECT for row actions",
      disabled: true,
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-auto p-3 gap-3">
      {hasResults ? (
        result.result_sets.map((rs, i) => (
          <VirtualGrid
            key={i}
            resultSet={rs}
            onContextMenu={(e, ri) => handleContextMenu(e, ri, i)}
          />
        ))
      ) : (
        <div className="p-4 text-text-muted text-[13px] font-sans">
          <p className="text-success font-semibold flex items-center gap-2 mb-2">
            <i className="fa-solid fa-check-circle" />
            Query executed successfully.
          </p>
          <div className="space-y-1.5 opacity-80">
            <p>{result.rows_affected} row(s) affected.</p>
            <p className="text-xs">Execution time: {result.elapsed_ms}ms</p>
            {result.messages.map((msg, i) => (
                <p key={i} className="text-xs bg-surface-hover p-2 rounded-md border border-border/10">
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
