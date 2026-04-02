import { invoke } from "@tauri-apps/api/core";
import { createPortal } from "react-dom";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import type {
  DatabaseObject,
  ServerDatabaseObject,
  ServerObjectIndexStatus,
  ServerObjectSearchResponse,
} from "../lib/types";
import type { ContextMenuItem } from "./ContextMenu";
import {
  IconFunction,
  IconProcedure,
  IconTable,
  IconTrigger,
  IconType,
  IconView,
} from "./Icons";
import type { ExplorerObjectType } from "./objectExplorerObjectMenu";
import { buildObjectExplorerMenuItems } from "./objectExplorerObjectMenu";

export interface ObjectJumpSelection {
  sql: string;
  title?: string;
  sourceId?: string;
  database: string;
  execute?: boolean;
  preserveTitle?: boolean;
}

interface Props {
  open: boolean;
  connected: boolean;
  currentDatabase?: string;
  indexStatus: ServerObjectIndexStatus;
  onClose: () => void;
  onSelect: (selection: ObjectJumpSelection) => void;
}

type JumpObject = ServerDatabaseObject;

const MAX_RESULTS = 60;

function getJumpObjectSourceId(object: JumpObject): string {
  return `object:${object.database}:${object.schema_name}:${object.name}:${object.object_type}`;
}

function getObjectTypeLabel(type: string): string {
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
    default:
      return type;
  }
}

function renderObjectIcon(type: string) {
  switch (type) {
    case "TABLE":
      return <IconTable className="h-4 w-4 text-success" />;
    case "VIEW":
      return <IconView className="h-4 w-4 text-success" />;
    case "PROCEDURE":
      return <IconProcedure className="h-4 w-4 text-purple-400" />;
    case "FUNCTION":
      return <IconFunction className="h-4 w-4 text-orange-400" />;
    case "TRIGGER":
      return <IconTrigger className="h-4 w-4 text-red-400" />;
    case "TYPE":
      return <IconType className="h-4 w-4 text-blue-400" />;
    default:
      return <i className="fa-solid fa-cube text-xs text-text-muted" />;
  }
}

async function buildJumpSelection(
  database: string,
  object: DatabaseObject,
): Promise<ObjectJumpSelection> {
  const objectName = `${object.schema_name}.${object.name}`;
  const fullName = `[${database}].[${object.schema_name}].[${object.name}]`;
  const baseSelection = {
    database,
    title: objectName,
    sourceId: `object:${database}:${object.schema_name}:${object.name}:${object.object_type}`,
    preserveTitle: true,
  };

  switch (object.object_type) {
    case "TABLE":
    case "VIEW":
      return {
        ...baseSelection,
        sql: `SELECT TOP 100 * FROM ${fullName}`,
      };
    case "PROCEDURE":
    case "FUNCTION":
    case "TRIGGER":
      try {
        const definition: string = await invoke("get_object_definition", {
          database,
          schema: object.schema_name,
          name: object.name,
        });
        return {
          ...baseSelection,
          sql: `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${definition}\nGO`,
        };
      } catch {
        if (object.object_type === "PROCEDURE") {
          return {
            ...baseSelection,
            sql: `EXEC ${fullName}`,
          };
        }
        if (object.object_type === "FUNCTION") {
          return {
            ...baseSelection,
            sql: `SELECT ${fullName}()`,
          };
        }
        return {
          ...baseSelection,
          sql: `-- Could not retrieve definition for [${object.schema_name}].[${object.name}]\n-- The object may be encrypted or not accessible.`,
        };
      }
    case "TYPE":
      return {
        ...baseSelection,
        sql:
          `SELECT\n` +
          `\tt.name AS [TypeName],\n` +
          `\tSCHEMA_NAME(t.schema_id) AS [Schema],\n` +
          `\tTYPE_NAME(t.system_type_id) AS [BaseType],\n` +
          `\tt.max_length AS [MaxLength],\n` +
          `\tt.precision AS [Precision],\n` +
          `\tt.scale AS [Scale],\n` +
          `\tt.is_nullable AS [IsNullable],\n` +
          `\tt.is_table_type AS [IsTableType]\n` +
          `FROM [${database}].sys.types t\n` +
          `WHERE t.name = '${object.name}'\n` +
          `\tAND SCHEMA_NAME(t.schema_id) = '${object.schema_name}'`,
      };
    default:
      return {
        ...baseSelection,
        sql: `SELECT * FROM ${fullName}`,
      };
  }
}

export default function ObjectJumpPalette({
  open,
  connected,
  currentDatabase,
  indexStatus,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<JumpObject[]>([]);
  const [searchInitialized, setSearchInitialized] = useState(indexStatus.initialized);
  const [searchIndexing, setSearchIndexing] = useState(indexStatus.indexing);
  const [totalMatches, setTotalMatches] = useState(0);
  const [databaseCount, setDatabaseCount] = useState(0);
  const [processedDatabaseCount, setProcessedDatabaseCount] = useState(0);
  const [failedDatabases, setFailedDatabases] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [resolvingSourceId, setResolvingSourceId] = useState<string | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRequestRef = useRef(0);
  const deferredQuery = useDeferredValue(query.trim());
  const portalTarget =
    typeof document !== "undefined"
      ? ((document.querySelector(".app-shell") as HTMLElement | null) ?? document.body)
      : null;

  const runSearch = useCallback(
    async (searchQuery: string) => {
      const requestId = ++searchRequestRef.current;
      setSearchLoading(true);

      try {
        const response = await invoke<ServerObjectSearchResponse>("search_server_objects", {
          query: searchQuery,
          preferredDatabase: currentDatabase,
          limit: MAX_RESULTS,
        });

        if (requestId !== searchRequestRef.current) {
          return;
        }

        setSearchResults(response.results);
        setSearchInitialized(response.initialized);
        setSearchIndexing(response.indexing);
        setTotalMatches(response.total_matches);
        setDatabaseCount(response.database_count);
        setProcessedDatabaseCount(response.processed_database_count);
        setFailedDatabases(response.failed_databases);
        setSearchError(null);
      } catch (error) {
        if (requestId !== searchRequestRef.current) {
          return;
        }

        setSearchResults([]);
        setSearchInitialized(false);
        setSearchIndexing(false);
        setTotalMatches(0);
        setDatabaseCount(0);
        setProcessedDatabaseCount(0);
        setFailedDatabases([]);
        setSearchError("Could not search server objects.");
        console.error("Failed to search jump palette objects:", error);
      } finally {
        if (requestId === searchRequestRef.current) {
          setSearchLoading(false);
        }
      }
    },
    [currentDatabase],
  );

  useEffect(() => {
    if (!open) {
      searchRequestRef.current += 1;
      setSearchLoading(false);
      setQuery("");
      setSearchError(null);
      setSearchResults([]);
      setSearchInitialized(indexStatus.initialized);
      setSearchIndexing(indexStatus.indexing);
      setTotalMatches(0);
      setDatabaseCount(indexStatus.database_count);
      setProcessedDatabaseCount(indexStatus.processed_database_count);
      setFailedDatabases(indexStatus.failed_databases);
      setHighlightedIndex(0);
      setExpandedSourceId(null);
      setResolvingSourceId(null);
      setRunningActionId(null);
      return;
    }

    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [currentDatabase, open]);

  useEffect(() => {
    if (open) {
      return;
    }

    setSearchInitialized(indexStatus.initialized);
    setSearchIndexing(indexStatus.indexing);
    setDatabaseCount(indexStatus.database_count);
    setProcessedDatabaseCount(indexStatus.processed_database_count);
    setFailedDatabases(indexStatus.failed_databases);
  }, [indexStatus, open]);

  useEffect(() => {
    if (!connected) {
      searchRequestRef.current += 1;
      setSearchLoading(false);
      setSearchError(null);
      setSearchResults([]);
      setSearchInitialized(false);
      setSearchIndexing(false);
      setTotalMatches(0);
      setDatabaseCount(0);
      setProcessedDatabaseCount(0);
      setFailedDatabases([]);
      setExpandedSourceId(null);
      setRunningActionId(null);
    }
  }, [connected]);

  useEffect(() => {
    if (!open || !connected) {
      return;
    }

    void runSearch(deferredQuery);
  }, [connected, deferredQuery, open, runSearch]);

  useEffect(() => {
    if (!open || !connected || !searchIndexing) {
      return;
    }

    const interval = window.setInterval(() => {
      void runSearch(deferredQuery);
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, [connected, deferredQuery, open, runSearch, searchIndexing]);

  useEffect(() => {
    if (!open) return;
    setHighlightedIndex(searchResults.length > 0 ? 0 : -1);
  }, [currentDatabase, deferredQuery, open, searchResults.length]);

  useEffect(() => {
    if (!expandedSourceId) {
      return;
    }

    const expandedObjectStillVisible = searchResults.some(
      (object) => getJumpObjectSourceId(object) === expandedSourceId,
    );

    if (!expandedObjectStillVisible) {
      setExpandedSourceId(null);
    }
  }, [expandedSourceId, searchResults]);

  useEffect(() => {
    if (highlightedIndex < 0) return;
    itemRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  const handleOpenObject = async (object: JumpObject | undefined) => {
    if (!object) {
      return;
    }

    const sourceId = getJumpObjectSourceId(object);
    setResolvingSourceId(sourceId);

    try {
      const selection = await buildJumpSelection(object.database, object);
      onSelect(selection);
      onClose();
    } finally {
      setResolvingSourceId((prev) => (prev === sourceId ? null : prev));
    }
  };

  const handleToggleExpanded = useCallback((object: JumpObject | undefined) => {
    if (!object) {
      return;
    }

    const sourceId = getJumpObjectSourceId(object);
    setExpandedSourceId((prev) => (prev === sourceId ? null : sourceId));
  }, []);

  const getObjectActionItems = useCallback(
    (object: JumpObject): ContextMenuItem[] =>
      buildObjectExplorerMenuItems({
        database: object.database,
        schema: object.schema_name,
        table: object.name,
        objectType: object.object_type as ExplorerObjectType,
        onSelectSql: (sql, execute) => {
          onSelect({
            sql,
            execute,
            database: object.database,
          });
        },
      }),
    [onSelect],
  );

  const handleActionClick = useCallback(
    async (item: ContextMenuItem) => {
      if (item.disabled || item.separator) {
        return;
      }

      setRunningActionId(item.id);

      try {
        await Promise.resolve(item.onClick?.());
        onClose();
      } catch (error) {
        console.error("Failed to run jump palette action:", error);
        setRunningActionId(null);
      }
    },
    [onClose],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (searchResults.length === 0) return -1;
          return prev < searchResults.length - 1 ? prev + 1 : 0;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (searchResults.length === 0) return -1;
          return prev > 0 ? prev - 1 : searchResults.length - 1;
        });
        break;
      case "ArrowRight":
        event.preventDefault();
        if (highlightedIndex >= 0) {
          setExpandedSourceId(getJumpObjectSourceId(searchResults[highlightedIndex]));
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (
          highlightedIndex >= 0 &&
          expandedSourceId === getJumpObjectSourceId(searchResults[highlightedIndex])
        ) {
          setExpandedSourceId(null);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (highlightedIndex >= 0) {
          handleToggleExpanded(searchResults[highlightedIndex]);
        }
        break;
      case "Escape":
        event.preventDefault();
        onClose();
        break;
    }
  };

  if (!open || !portalTarget) {
    return null;
  }

  const effectiveInitialized = searchInitialized || indexStatus.initialized;
  const effectiveIndexing = searchInitialized ? searchIndexing : indexStatus.indexing;
  const effectiveDatabaseCount = searchInitialized ? databaseCount : indexStatus.database_count;
  const effectiveProcessedDatabaseCount = searchInitialized
    ? processedDatabaseCount
    : indexStatus.processed_database_count;
  const effectiveFailedDatabases = searchInitialized
    ? failedDatabases
    : indexStatus.failed_databases;
  const failedDatabaseCount = effectiveFailedDatabases.length;
  const canShowResults = searchResults.length > 0;
  const hasNoScope =
    !searchLoading && !searchError && effectiveInitialized && !effectiveIndexing && effectiveDatabaseCount === 0;
  const loadingMessage =
    effectiveDatabaseCount === 0
      ? "Indexing objects across the whole server..."
      : "Searching objects across the whole server...";
  const footerStatus = effectiveIndexing
    ? effectiveDatabaseCount > 0
      ? `Indexing ${effectiveProcessedDatabaseCount}/${effectiveDatabaseCount} DBs${failedDatabaseCount > 0 ? ` | ${failedDatabaseCount} failed` : ""}`
      : "Indexing server objects..."
    : effectiveDatabaseCount > 0
      ? `${effectiveDatabaseCount} DBs indexed${failedDatabaseCount > 0 ? ` | ${failedDatabaseCount} failed` : ""}`
      : effectiveInitialized
        ? "No databases indexed"
        : "Starting object index...";

  return createPortal(
    <div
      className="fixed inset-x-0 top-11 bottom-0 z-[120] bg-black/40"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Jump to database object"
    >
      <div className="mx-auto flex h-full max-w-2xl flex-col px-4 pt-12">
        <div
          className="overflow-hidden rounded-2xl border border-border bg-surface-panel shadow-none"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="border-b border-border/50 px-2 py-2">
            <div className="relative flex items-center">
              <i className="fa-solid fa-magnifying-glass pointer-events-none absolute left-4 text-text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Jump to a table, procedure, function, trigger, or type..."
                spellCheck={false}
                className="h-12 w-full bg-transparent pl-11 pr-4 text-base text-text placeholder-text-muted outline-none"
              />
            </div>
          </div>

          <div className="max-h-[58vh] overflow-y-auto p-2">
            {!canShowResults && searchLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                <i className="fa-solid fa-spinner animate-spin text-xl" />
                <p className="text-m">{loadingMessage}</p>
              </div>
            ) : searchError ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                <i className="fa-solid fa-triangle-exclamation text-xl text-warning" />
                <p className="text-m">{searchError}</p>
              </div>
            ) : hasNoScope ? (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                <i className="fa-solid fa-database text-2xl opacity-50" />
                <p className="text-m">No databases are available for object search.</p>
              </div>
            ) : canShowResults ? (
              <div className="space-y-1">
                {searchResults.map((object, index) => {
                  const isActive = index === highlightedIndex;
                  const sourceId = getJumpObjectSourceId(object);
                  const isResolving = resolvingSourceId === sourceId;
                  const isExpanded = expandedSourceId === sourceId;
                  const typeLabel = getObjectTypeLabel(object.object_type);
                  const actionItems = getObjectActionItems(object);
                  let actionOrder = 0;

                  return (
                    <div
                      key={sourceId}
                      className={`rounded-xl border transition-all duration-200 ${
                        isExpanded
                          ? "border-border/70 bg-surface-active/80 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]"
                          : isActive
                            ? "border-border/60 bg-surface-active/60"
                            : "border-transparent bg-transparent hover:border-border/40 hover:bg-surface-hover/60"
                      }`}
                    >
                      <div className="flex items-stretch gap-2 p-1.5">
                        <button
                          ref={(element) => {
                            itemRefs.current[index] = element;
                          }}
                          type="button"
                          onClick={() => {
                            setHighlightedIndex(index);
                            handleToggleExpanded(object);
                          }}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          aria-selected={isActive}
                          aria-expanded={isExpanded}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                        >
                          <div
                            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
                              isExpanded ? "bg-surface-panel shadow-inner" : "bg-surface-header"
                            }`}
                          >
                            {renderObjectIcon(object.object_type)}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-m font-semibold text-text">
                                {object.name}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-s text-text-muted">
                              <span className="truncate">{`${object.database}.${object.schema_name}.${object.name}`}</span>
                            </div>
                          </div>

                          <div className="flex flex-shrink-0 items-center justify-end gap-2">
                            <span className="rounded-full border border-border/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-muted">
                              {typeLabel}
                            </span>
                            <span className="rounded-full border border-border/50 bg-surface-header px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                              {object.database}
                            </span>
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/50 bg-surface-header text-text-muted transition-all duration-200 ${
                                isExpanded ? "rotate-180 text-text" : ""
                              }`}
                            >
                              <i className="fa-solid fa-chevron-down text-[10px]" />
                            </span>
                          </div>
                        </button>
                      </div>

                      <div
                        className={`grid overflow-hidden px-1.5 transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                          isExpanded ? "mt-0 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div
                            className={`mb-1.5 rounded-xl border border-border/60 bg-surface-panel/95 p-2 transition-all duration-300 ${
                              isExpanded ? "translate-y-0" : "-translate-y-2"
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3 px-2">
                              <div>
                                <p className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                                  Explorer Actions
                                </p>
                                <p className="text-s text-text-muted">
                                  Same object actions as the explorer context menu.
                                </p>
                              </div>
                              <span className="rounded-full border border-border/50 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-text-muted">
                                {actionItems.filter((item) => !item.separator).length} groups
                              </span>
                            </div>

                            <div className="space-y-2">
                              {actionItems.map((item) => {
                                if (item.separator) {
                                  return (
                                    <div
                                      key={item.id}
                                      className="mx-2 h-px bg-border/50"
                                    />
                                  );
                                }

                                if (item.children?.length) {
                                  const sectionDelay = actionOrder * 24;
                                  actionOrder += item.children.length;

                                  return (
                                    <div
                                      key={item.id}
                                      className="animate-in fade-in-0 slide-in-from-top-2 rounded-xl border border-border/50 bg-surface-header/60 p-2 duration-300"
                                      style={{ animationDelay: `${sectionDelay}ms` }}
                                    >
                                      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                        {item.icon && (
                                          <span className="flex h-4 w-4 items-center justify-center text-white/80 [&_i]:!text-white/80 [&_svg]:!text-white/80">
                                            {item.icon}
                                          </span>
                                        )}
                                        <span>{item.label}</span>
                                      </div>

                                      <div className="grid gap-1 sm:grid-cols-2">
                                        {item.children.map((child, childIndex) => {
                                          const isRunning = runningActionId === child.id;

                                          return (
                                            <button
                                              key={child.id}
                                              type="button"
                                              disabled={child.disabled || isRunning}
                                              onClick={() => void handleActionClick(child)}
                                              className={`animate-in fade-in-0 slide-in-from-top-2 flex items-center gap-3 rounded-lg border border-border/50 bg-surface-panel/80 px-3 py-2 text-left text-s transition-all duration-200 ${
                                                child.disabled
                                                  ? "cursor-not-allowed text-text-muted/50"
                                                  : "cursor-pointer text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                                              }`}
                                              style={{
                                                animationDelay: `${sectionDelay + childIndex * 24}ms`,
                                              }}
                                            >
                                              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-white/85 [&_i]:!text-white/85 [&_svg]:!text-white/85">
                                                {isRunning ? (
                                                  <i className="fa-solid fa-spinner animate-spin text-[11px]" />
                                                ) : (
                                                  child.icon
                                                )}
                                              </span>
                                              <span className="flex-1">{child.label}</span>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                }

                                const itemDelay = actionOrder * 24;
                                actionOrder += 1;
                                const isRunning = runningActionId === item.id;

                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    disabled={item.disabled || isRunning}
                                    onClick={() => void handleActionClick(item)}
                                    className={`animate-in fade-in-0 slide-in-from-top-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-s transition-all duration-200 ${
                                      item.disabled
                                        ? "cursor-not-allowed border-border/40 bg-surface-header/40 text-text-muted/50"
                                        : item.danger
                                          ? "cursor-pointer border-error/30 bg-error/5 text-error hover:bg-error/10"
                                          : "cursor-pointer border-border/50 bg-surface-header/60 text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                                    }`}
                                    style={{ animationDelay: `${itemDelay}ms` }}
                                  >
                                    <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-white/85 [&_i]:!text-white/85 [&_svg]:!text-white/85">
                                      {isRunning ? (
                                        <i className="fa-solid fa-spinner animate-spin text-[11px]" />
                                      ) : (
                                        item.icon
                                      )}
                                    </span>
                                    <span className="flex-1">{item.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                <i className="fa-solid fa-compass text-2xl opacity-50" />
                <p className="text-m">
                  {query.trim()
                    ? "No objects matched that search."
                    : "Type to search objects across all databases."}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3 text-s text-text-muted">
            <span>{`${Math.min(searchResults.length, totalMatches)} of ${totalMatches} matches`}</span>
            <span className="flex items-center gap-1.5">
              {effectiveIndexing && <i className="fa-solid fa-spinner animate-spin text-xs" />}
              <span>{footerStatus}</span>
            </span>
          </div>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
