import { invoke } from "@tauri-apps/api/core";
import { Portal } from "solid-js/web";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
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
      return <IconTable class="h-4 w-4 text-success" />;
    case "VIEW":
      return <IconView class="h-4 w-4 text-success" />;
    case "PROCEDURE":
      return <IconProcedure class="h-4 w-4 text-purple-400" />;
    case "FUNCTION":
      return <IconFunction class="h-4 w-4 text-orange-400" />;
    case "TRIGGER":
      return <IconTrigger class="h-4 w-4 text-red-400" />;
    case "TYPE":
      return <IconType class="h-4 w-4 text-blue-400" />;
    default:
      return <i class="fa-solid fa-cube text-xs text-text-muted" />;
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

export default function ObjectJumpPalette(props: Props) {
  const [query, setQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<JumpObject[]>([]);
  const [searchInitialized, setSearchInitialized] = createSignal(props.indexStatus.initialized);
  const [searchIndexing, setSearchIndexing] = createSignal(props.indexStatus.indexing);
  const [totalMatches, setTotalMatches] = createSignal(0);
  const [databaseCount, setDatabaseCount] = createSignal(0);
  const [processedDatabaseCount, setProcessedDatabaseCount] = createSignal(0);
  const [failedDatabases, setFailedDatabases] = createSignal<string[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [expandedSourceId, setExpandedSourceId] = createSignal<string | null>(null);
  const [resolvingSourceId, setResolvingSourceId] = createSignal<string | null>(null);
  const [runningActionId, setRunningActionId] = createSignal<string | null>(null);
  const [visible, setVisible] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let itemRefs: Array<HTMLButtonElement | null> = [];
  let searchRequestRef = 0;
  const deferredQuery = createMemo(() => query().trim());
  const portalTarget = createMemo(() =>
    typeof document !== "undefined"
      ? ((document.querySelector(".app-shell") as HTMLElement | null) ?? document.body)
      : null
  );

  const runSearch = async (searchQuery: string) => {
    const requestId = ++searchRequestRef;
    setSearchLoading(true);

    try {
      const response = await invoke<ServerObjectSearchResponse>("search_server_objects", {
        query: searchQuery,
        preferredDatabase: props.currentDatabase,
        limit: MAX_RESULTS,
      });

      if (requestId !== searchRequestRef) {
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
      if (requestId !== searchRequestRef) {
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
      if (requestId === searchRequestRef) {
        setSearchLoading(false);
      }
    }
  };

  createEffect(() => {
    const open = props.open;
    if (!open) {
      setVisible(false);
      searchRequestRef += 1;
      setSearchLoading(false);
      setQuery("");
      setSearchError(null);
      setSearchResults([]);
      setSearchInitialized(props.indexStatus.initialized);
      setSearchIndexing(props.indexStatus.indexing);
      setTotalMatches(0);
      setDatabaseCount(props.indexStatus.database_count);
      setProcessedDatabaseCount(props.indexStatus.processed_database_count);
      setFailedDatabases(props.indexStatus.failed_databases);
      setHighlightedIndex(0);
      setExpandedSourceId(null);
      setResolvingSourceId(null);
      setRunningActionId(null);
      return;
    }

    requestAnimationFrame(() => {
      setVisible(true);
      inputRef?.focus();
      inputRef?.select();
    });
  });

  createEffect(() => {
    const indexStatus = props.indexStatus;
    const open = props.open;
    if (open) return;

    setSearchInitialized(indexStatus.initialized);
    setSearchIndexing(indexStatus.indexing);
    setDatabaseCount(indexStatus.database_count);
    setProcessedDatabaseCount(indexStatus.processed_database_count);
    setFailedDatabases(indexStatus.failed_databases);
  });

  createEffect(() => {
    const connected = props.connected;
    if (!connected) {
      searchRequestRef += 1;
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
  });

  createEffect(() => {
    const open = props.open;
    const connected = props.connected;
    const dq = deferredQuery();
    if (!open || !connected) return;

    void runSearch(dq);
  });

  createEffect(() => {
    const open = props.open;
    const connected = props.connected;
    const indexing = searchIndexing();
    const dq = deferredQuery();
    if (!open || !connected || !indexing) return;

    const interval = window.setInterval(() => {
      void runSearch(dq);
    }, 500);

    onCleanup(() => {
      window.clearInterval(interval);
    });
  });

  createEffect(() => {
    const open = props.open;
    const _dq = deferredQuery();
    const len = searchResults().length;
    if (!open) return;
    setHighlightedIndex(len > 0 ? 0 : -1);
  });

  createEffect(() => {
    const expanded = expandedSourceId();
    if (!expanded) return;

    const expandedObjectStillVisible = searchResults().some(
      (object) => getJumpObjectSourceId(object) === expanded,
    );

    if (!expandedObjectStillVisible) {
      setExpandedSourceId(null);
    }
  });

  createEffect(() => {
    const idx = highlightedIndex();
    if (idx < 0) return;
    itemRefs[idx]?.scrollIntoView({ block: "nearest" });
  });

  const handleOpenObject = async (object: JumpObject | undefined) => {
    if (!object) return;

    const sourceId = getJumpObjectSourceId(object);
    setResolvingSourceId(sourceId);

    try {
      const selection = await buildJumpSelection(object.database, object);
      props.onSelect(selection);
      props.onClose();
    } finally {
      setResolvingSourceId((prev) => (prev === sourceId ? null : prev));
    }
  };

  const handleToggleExpanded = (object: JumpObject | undefined) => {
    if (!object) return;

    const sourceId = getJumpObjectSourceId(object);
    setExpandedSourceId((prev) => (prev === sourceId ? null : sourceId));
  };

  const getObjectActionItems = (object: JumpObject): ContextMenuItem[] =>
    buildObjectExplorerMenuItems({
      database: object.database,
      schema: object.schema_name,
      table: object.name,
      objectType: object.object_type as ExplorerObjectType,
      onSelectSql: (sql, execute) => {
        props.onSelect({
          sql,
          execute,
          database: object.database,
        });
      },
    });

  const handleActionClick = async (item: ContextMenuItem) => {
    if (item.disabled || item.separator) return;

    setRunningActionId(item.id);

    try {
      await Promise.resolve(item.onClick?.());
      props.onClose();
    } catch (error) {
      console.error("Failed to run jump palette action:", error);
      setRunningActionId(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (searchResults().length === 0) return -1;
          return prev < searchResults().length - 1 ? prev + 1 : 0;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (searchResults().length === 0) return -1;
          return prev > 0 ? prev - 1 : searchResults().length - 1;
        });
        break;
      case "ArrowRight":
        event.preventDefault();
        if (highlightedIndex() >= 0) {
          setExpandedSourceId(getJumpObjectSourceId(searchResults()[highlightedIndex()]));
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (
          highlightedIndex() >= 0 &&
          expandedSourceId() === getJumpObjectSourceId(searchResults()[highlightedIndex()])
        ) {
          setExpandedSourceId(null);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (highlightedIndex() >= 0) {
          handleToggleExpanded(searchResults()[highlightedIndex()]);
        }
        break;
      case "Escape":
        event.preventDefault();
        props.onClose();
        break;
    }
  };

  const effectiveInitialized = () => searchInitialized() || props.indexStatus.initialized;
  const effectiveIndexing = () => searchInitialized() ? searchIndexing() : props.indexStatus.indexing;
  const effectiveDatabaseCount = () => searchInitialized() ? databaseCount() : props.indexStatus.database_count;
  const effectiveProcessedDatabaseCount = () => searchInitialized()
    ? processedDatabaseCount()
    : props.indexStatus.processed_database_count;
  const effectiveFailedDatabases = () => searchInitialized()
    ? failedDatabases()
    : props.indexStatus.failed_databases;
  const failedDatabaseCount = () => effectiveFailedDatabases().length;
  const canShowResults = () => searchResults().length > 0;
  const hasNoScope = () =>
    !searchLoading() && !searchError() && effectiveInitialized() && !effectiveIndexing() && effectiveDatabaseCount() === 0;
  const loadingMessage = () =>
    effectiveDatabaseCount() === 0
      ? "Indexing objects across the whole server..."
      : "Searching objects across the whole server...";
  const footerStatus = () => effectiveIndexing()
    ? effectiveDatabaseCount() > 0
      ? `Indexing ${effectiveProcessedDatabaseCount()}/${effectiveDatabaseCount()} DBs${failedDatabaseCount() > 0 ? ` | ${failedDatabaseCount()} failed` : ""}`
      : "Indexing server objects..."
    : effectiveDatabaseCount() > 0
      ? `${effectiveDatabaseCount()} DBs indexed${failedDatabaseCount() > 0 ? ` | ${failedDatabaseCount()} failed` : ""}`
      : effectiveInitialized()
        ? "No databases indexed"
        : "Starting object index...";

  return (
    <Show when={props.open && portalTarget()}>
      <Portal mount={portalTarget()!}>
        <div
          class="dialog-overlay items-start !pt-12"
          data-visible={visible()}
          onMouseDown={props.onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Jump to database object"
        >
          <div class="mx-auto flex h-full w-full max-w-2xl flex-col px-4">
            <div
              class="dialog-surface flex flex-col shadow-2xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div class="border-b border-border/50 px-2 py-2">
                <div class="relative flex items-center">
                  <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-4 text-text-muted" />
                  <input
                    ref={inputRef}
                    value={query()}
                    onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Jump to a table, procedure, function, trigger, or type..."
                    spellcheck={false}
                    class="h-12 w-full bg-transparent pl-11 pr-4 text-base text-text placeholder-text-muted outline-none"
                  />
                </div>
              </div>

              <div class="max-h-[58vh] overflow-y-auto p-2">
                <Show when={!(!canShowResults() && searchLoading())} fallback={
                  <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                    <i class="fa-solid fa-spinner animate-spin text-xl" />
                    <p class="text-m">{loadingMessage()}</p>
                  </div>
                }>
                  <Show when={!searchError()} fallback={
                    <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                      <i class="fa-solid fa-triangle-exclamation text-xl text-warning" />
                      <p class="text-m">{searchError()}</p>
                    </div>
                  }>
                    <Show when={!hasNoScope()} fallback={
                      <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                        <i class="fa-solid fa-database text-2xl opacity-50" />
                        <p class="text-m">No databases are available for object search.</p>
                      </div>
                    }>
                      <Show when={canShowResults()} fallback={
                        <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                          <i class="fa-solid fa-compass text-2xl opacity-50" />
                          <p class="text-m">
                            {query().trim()
                              ? "No objects matched that search."
                              : "Type to search objects across all databases."}
                          </p>
                        </div>
                      }>
                        <div class="space-y-1">
                          <For each={searchResults()}>
                            {(object, index) => {
                              const isActive = () => index() === highlightedIndex();
                              const sourceId = getJumpObjectSourceId(object);
                              const isResolving = () => resolvingSourceId() === sourceId;
                              const isExpanded = () => expandedSourceId() === sourceId;
                              const typeLabel = getObjectTypeLabel(object.object_type);
                              const actionItems = getObjectActionItems(object);

                              return (
                                <div
                                  class={`rounded-xl border transition-all duration-200 ${
                                    isExpanded()
                                      ? "border-border/70 bg-surface-active/80 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.9)]"
                                      : isActive()
                                        ? "border-border/60 bg-surface-active/60"
                                        : "border-transparent bg-transparent hover:border-border/40 hover:bg-surface-hover/60"
                                  }`}
                                >
                                  <div class="flex items-stretch gap-2 p-1.5">
                                    <button
                                      ref={(el) => { itemRefs[index()] = el; }}
                                      type="button"
                                      onClick={() => {
                                        setHighlightedIndex(index());
                                        handleToggleExpanded(object);
                                      }}
                                      onMouseEnter={() => setHighlightedIndex(index())}
                                      aria-selected={isActive()}
                                      aria-expanded={isExpanded()}
                                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                                    >
                                      <div
                                        class={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
                                          isExpanded() ? "bg-surface-panel shadow-inner" : "bg-surface-header"
                                        }`}
                                      >
                                        {renderObjectIcon(object.object_type)}
                                      </div>

                                      <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-2">
                                          <span class="truncate text-m font-semibold text-text">
                                            {object.name}
                                          </span>
                                        </div>
                                        <div class="mt-0.5 flex items-center gap-2 text-s text-text-muted">
                                          <span class="truncate">{`${object.database}.${object.schema_name}.${object.name}`}</span>
                                        </div>
                                      </div>

                                      <div class="flex flex-shrink-0 items-center justify-end gap-2">
                                        <span class="rounded-full border border-border/50 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-text-muted">
                                          {typeLabel}
                                        </span>
                                        <span class="rounded-full border border-border/50 bg-surface-header px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                                          {object.database}
                                        </span>
                                        <span
                                          class={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/50 bg-surface-header text-text-muted transition-all duration-200 ${
                                            isExpanded() ? "rotate-180 text-text" : ""
                                          }`}
                                        >
                                          <i class="fa-solid fa-chevron-down text-[10px]" />
                                        </span>
                                      </div>
                                    </button>
                                  </div>

                                  <div
                                    class={`grid overflow-hidden px-1.5 transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                      isExpanded() ? "mt-0 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
                                    }`}
                                  >
                                    <div class="overflow-hidden">
                                      <div
                                        class={`mb-1.5 rounded-xl border border-border/60 bg-surface-panel/95 p-2 transition-all duration-300 ${
                                          isExpanded() ? "translate-y-0" : "-translate-y-2"
                                        }`}
                                      >
                                        <div class="mb-2 flex items-center justify-between gap-3 px-2">
                                          <div>
                                            <p class="text-[10px] uppercase tracking-[0.2em] text-text-muted">
                                              Explorer Actions
                                            </p>
                                            <p class="text-s text-text-muted">
                                              Same object actions as the explorer context menu.
                                            </p>
                                          </div>
                                          <span class="rounded-full border border-border/50 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-text-muted">
                                            {actionItems.filter((item) => !item.separator).length} groups
                                          </span>
                                        </div>

                                        <div class="space-y-2">
                                          <For each={actionItems}>
                                            {(item) => {
                                              if (item.separator) {
                                                return (
                                                  <div class="mx-2 h-px bg-border/50" />
                                                );
                                              }

                                              if (item.children?.length) {
                                                return (
                                                  <div
                                                    class="animate-in fade-in-0 slide-in-from-top-2 rounded-xl border border-border/50 bg-surface-header/60 p-2 duration-300"
                                                  >
                                                    <div class="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                                      <Show when={item.icon}>
                                                        <span class="flex h-4 w-4 items-center justify-center text-white/80 [&_i]:!text-white/80 [&_svg]:!text-white/80">
                                                          {item.icon}
                                                        </span>
                                                      </Show>
                                                      <span>{item.label}</span>
                                                    </div>

                                                    <div class="grid gap-1 sm:grid-cols-2">
                                                      <For each={item.children}>
                                                        {(child) => {
                                                          const isRunning = () => runningActionId() === child.id;

                                                          return (
                                                            <button
                                                              type="button"
                                                              disabled={child.disabled || isRunning()}
                                                              onClick={() => void handleActionClick(child)}
                                                              class={`animate-in fade-in-0 slide-in-from-top-2 flex items-center gap-3 rounded-lg border border-border/50 bg-surface-panel/80 px-3 py-2 text-left text-s transition-all duration-200 ${
                                                                child.disabled
                                                                  ? "cursor-not-allowed text-text-muted/50"
                                                                  : "cursor-pointer text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                                                              }`}
                                                            >
                                                              <span class="flex h-4 w-4 flex-shrink-0 items-center justify-center text-white/85 [&_i]:!text-white/85 [&_svg]:!text-white/85">
                                                                <Show when={isRunning()} fallback={child.icon}>
                                                                  <i class="fa-solid fa-spinner animate-spin text-[11px]" />
                                                                </Show>
                                                              </span>
                                                              <span class="flex-1">{child.label}</span>
                                                            </button>
                                                          );
                                                        }}
                                                      </For>
                                                    </div>
                                                  </div>
                                                );
                                              }

                                              const isRunning = () => runningActionId() === item.id;

                                              return (
                                                <button
                                                  type="button"
                                                  disabled={item.disabled || isRunning()}
                                                  onClick={() => void handleActionClick(item)}
                                                  class={`animate-in fade-in-0 slide-in-from-top-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-s transition-all duration-200 ${
                                                    item.disabled
                                                      ? "cursor-not-allowed border-border/40 bg-surface-header/40 text-text-muted/50"
                                                      : item.danger
                                                        ? "cursor-pointer border-error/30 bg-error/5 text-error hover:bg-error/10"
                                                        : "cursor-pointer border-border/50 bg-surface-header/60 text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                                                  }`}
                                                >
                                                  <span class="flex h-4 w-4 flex-shrink-0 items-center justify-center text-white/85 [&_i]:!text-white/85 [&_svg]:!text-white/85">
                                                    <Show when={isRunning()} fallback={item.icon}>
                                                      <i class="fa-solid fa-spinner animate-spin text-[11px]" />
                                                    </Show>
                                                  </span>
                                                  <span class="flex-1">{item.label}</span>
                                                </button>
                                              );
                                            }}
                                          </For>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </Show>
                    </Show>
                  </Show>
                </Show>
              </div>

              <div class="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-3 text-s text-text-muted">
                <span>{`${Math.min(searchResults().length, totalMatches())} of ${totalMatches()} matches`}</span>
                <span class="flex items-center gap-1.5">
                  <Show when={effectiveIndexing()}>
                    <i class="fa-solid fa-spinner animate-spin text-xs" />
                  </Show>
                  <span>{footerStatus()}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
