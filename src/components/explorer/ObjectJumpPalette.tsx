import { invoke } from "@tauri-apps/api/core";
import { Portal } from "solid-js/web";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type {
  ServerDatabaseObject,
  ServerObjectIndexStatus,
  ServerObjectSearchResponse,
} from "../../lib/types";
import {
  loadObjectJumpDatabaseFilter,
  loadObjectJumpTypeFilter,
  saveObjectJumpDatabaseFilter,
  saveObjectJumpTypeFilter,
} from "../../lib/settings";
import type { ContextMenuItem } from "../ui/ContextMenu";
import {
  Icon,
  IconFunction,
  IconProcedure,
  IconTable,
  IconTrigger,
  IconType,
  IconView,
  Spinner,
} from "../ui/Icons";
import DialogShell from "../ui/DialogShell";
import Dropdown from "../ui/Dropdown";
import Tooltip from "../ui/Tooltip";
import { Loader } from "../ui/Loader";
import type { ExplorerObjectType } from "./ObjectMenu";
import { buildObjectExplorerMenuItems } from "./ObjectMenu";

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
  databases?: string[];
  indexStatus: ServerObjectIndexStatus;
  onClose: () => void;
  onSelect: (selection: ObjectJumpSelection) => void;
  onShowProperties?: (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => void;
  onShowRename?: (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => void;
  onShowDrop?: (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => void;
  onShowDependencies?: (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => void;
}

type JumpObject = ServerDatabaseObject;

const MAX_RESULTS = 60;
const RECENT_STORAGE_KEY = "sqlqs.objectJumpPalette.recent";
const MAX_RECENTS = 10;

const TYPE_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "TABLE", label: "Tables" },
  { value: "VIEW", label: "Views" },
  { value: "PROCEDURE", label: "Procedures" },
  { value: "FUNCTION", label: "Functions" },
  { value: "TRIGGER", label: "Triggers" },
  { value: "TYPE", label: "Types" },
];

function loadRecents(): JumpObject[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecents(items: JumpObject[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota or serialization errors
  }
}

function getJumpObjectSourceId(object: JumpObject): string {
  return `object:${object.database}:${object.schema_name}:${object.name}:${object.object_type}`;
}

const JUMP_LISTBOX_ID = "object-jump-listbox";

function getJumpObjectOptionId(object: JumpObject): string {
  return `object-jump-option:${encodeURIComponent(object.database)}:${encodeURIComponent(object.schema_name)}:${encodeURIComponent(object.name)}:${encodeURIComponent(object.object_type)}`;
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
      return <IconProcedure class="h-4 w-4 object-icon-procedure" />;
    case "FUNCTION":
      return <IconFunction class="h-4 w-4 object-icon-function" />;
    case "TRIGGER":
      return <IconTrigger class="h-4 w-4 object-icon-trigger" />;
    case "TYPE":
      return <IconType class="h-4 w-4 object-icon-type" />;
    default:
      return <Icon name="cube" class="text-xs text-text-muted" />;
  }
}

export default function ObjectJumpPalette(props: Props) {
  const [query, setQuery] = createSignal("");
  const [searchResults, setSearchResults] = createSignal<JumpObject[]>([]);
  const [searchInitialized, setSearchInitialized] = createSignal(
    props.indexStatus.initialized,
  );
  const [searchIndexing, setSearchIndexing] = createSignal(
    props.indexStatus.indexing,
  );
  const [totalMatches, setTotalMatches] = createSignal(0);
  const [databaseCount, setDatabaseCount] = createSignal(0);
  const [processedDatabaseCount, setProcessedDatabaseCount] = createSignal(0);
  const [failedDatabases, setFailedDatabases] = createSignal<string[]>([]);
  const [searchLoading, setSearchLoading] = createSignal(false);
  const [showLoader, setShowLoader] = createSignal(false);
  const [searchError, setSearchError] = createSignal<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [expandedSourceId, setExpandedSourceId] = createSignal<string | null>(
    null,
  );
  const [, setResolvingSourceId] = createSignal<string | null>(null);
  const [runningActionId, setRunningActionId] = createSignal<string | null>(
    null,
  );
  const [visible, setVisible] = createSignal(false);
  const [recents, setRecents] = createSignal<JumpObject[]>(loadRecents());
  const [typeFilter, setTypeFilter] = createSignal<string | null>(
    loadObjectJumpTypeFilter() || null,
  );
  const [databaseFilter, setDatabaseFilter] = createSignal<string>(
    loadObjectJumpDatabaseFilter(),
  );

  const databaseOptions = createMemo<{ value: string; label: string }[]>(() => {
    const list = props.databases ?? [];
    return [{ value: "", label: "All databases" }, ...list.map((db) => ({
      value: db,
      label: db,
    }))];
  });

  const typeOptions = createMemo<{ value: string; label: string }[]>(() => [
    { value: "", label: "All types" },
    ...TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label })),
  ]);

  createEffect(() => {
    const current = databaseFilter();
    const list = props.databases;
    if (!current || !list || list.length === 0) return;
    const isValid = list.some(
      (db) => db.toLowerCase() === current.toLowerCase(),
    );
    if (!isValid) {
      setDatabaseFilter("");
      saveObjectJumpDatabaseFilter("");
    }
  });

  let inputRef: HTMLInputElement | undefined;
  let itemRefs: Array<HTMLButtonElement | null> = [];
  let searchRequestRef = 0;

  const deferredQuery = createMemo(() => query().trim());
  const portalTarget = createMemo(() =>
    typeof document !== "undefined"
      ? ((document.querySelector(".app-shell") as HTMLElement | null) ??
        document.body)
      : null,
  );

  const pushRecent = (object: JumpObject) => {
    setRecents((prev) => {
      const sourceId = getJumpObjectSourceId(object);
      if (prev.some((item) => getJumpObjectSourceId(item) === sourceId)) {
        return prev;
      }
      const next = [object, ...prev].slice(0, MAX_RECENTS);
      saveRecents(next);
      return next;
    });
  };

  createEffect(() => {
    if (!searchLoading()) {
      setShowLoader(false);
      return;
    }
    const handle = window.setTimeout(() => setShowLoader(true), 180);
    onCleanup(() => window.clearTimeout(handle));
  });

  const runSearch = async (
    searchQuery: string,
    objectType: string | null,
    databaseFilterValue: string,
  ) => {
    const requestId = ++searchRequestRef;
    setSearchLoading(true);

    try {
      const response = await invoke<ServerObjectSearchResponse>(
        "search_server_objects",
        {
          query: searchQuery,
          preferredDatabase: props.currentDatabase,
          objectType: objectType ?? undefined,
          databaseFilter: databaseFilterValue || undefined,
          limit: MAX_RESULTS,
        },
      );

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
    const filter = typeFilter();
    const dbFilter = databaseFilter();
    if (!open || !connected || !isSearching()) return;

    void runSearch(dq, filter, dbFilter);
  });

  createEffect(() => {
    const open = props.open;
    const connected = props.connected;
    const indexing = searchIndexing();
    const dq = deferredQuery();
    const filter = typeFilter();
    const dbFilter = databaseFilter();
    if (!open || !connected || !indexing || !isSearching()) return;

    const interval = window.setInterval(() => {
      void runSearch(dq, filter, dbFilter);
    }, 500);

    onCleanup(() => {
      window.clearInterval(interval);
    });
  });

  createEffect(() => {
    const open = props.open;
    const _dq = deferredQuery();
    const len = displayItems().length;
    if (!open) return;
    setHighlightedIndex(len > 0 ? 0 : -1);
  });

  createEffect(() => {
    const expanded = expandedSourceId();
    if (!expanded) return;

    const expandedObjectStillVisible = displayItems().some(
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

  const handleToggleExpanded = (object: JumpObject | undefined) => {
    if (!object) return;

    const sourceId = getJumpObjectSourceId(object);
    setExpandedSourceId((prev) => {
      const next = prev === sourceId ? null : sourceId;
      if (next === sourceId) pushRecent(object);
      return next;
    });
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
      onShowProperties: () => {
        props.onShowProperties?.(
          object.database,
          object.schema_name,
          object.name,
          object.object_type as ExplorerObjectType,
        );
        props.onClose();
      },
      onShowRename: () => {
        props.onShowRename?.(
          object.database,
          object.schema_name,
          object.name,
          object.object_type as ExplorerObjectType,
        );
        props.onClose();
      },
      onShowDrop: () => {
        props.onShowDrop?.(
          object.database,
          object.schema_name,
          object.name,
          object.object_type as ExplorerObjectType,
        );
        props.onClose();
      },
      onShowDependencies: () => {
        props.onShowDependencies?.(
          object.database,
          object.schema_name,
          object.name,
          object.object_type as ExplorerObjectType,
        );
        props.onClose();
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
          if (displayItems().length === 0) return -1;
          return prev < displayItems().length - 1 ? prev + 1 : 0;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((prev) => {
          if (displayItems().length === 0) return -1;
          return prev > 0 ? prev - 1 : displayItems().length - 1;
        });
        break;
      case "ArrowRight":
        event.preventDefault();
        if (highlightedIndex() >= 0) {
          setExpandedSourceId(
            getJumpObjectSourceId(displayItems()[highlightedIndex()]),
          );
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (
          highlightedIndex() >= 0 &&
          expandedSourceId() ===
            getJumpObjectSourceId(displayItems()[highlightedIndex()])
        ) {
          setExpandedSourceId(null);
        }
        break;
      case "Enter":
        event.preventDefault();
        if (highlightedIndex() >= 0) {
          handleToggleExpanded(displayItems()[highlightedIndex()]);
        }
        break;
      case "Escape":
        event.preventDefault();
        props.onClose();
        break;
    }
  };

  const effectiveInitialized = () =>
    searchInitialized() || props.indexStatus.initialized;
  const effectiveIndexing = () =>
    searchInitialized() ? searchIndexing() : props.indexStatus.indexing;
  const effectiveDatabaseCount = () =>
    searchInitialized() ? databaseCount() : props.indexStatus.database_count;
  const effectiveProcessedDatabaseCount = () =>
    searchInitialized()
      ? processedDatabaseCount()
      : props.indexStatus.processed_database_count;
  const effectiveFailedDatabases = () =>
    searchInitialized()
      ? failedDatabases()
      : props.indexStatus.failed_databases;
  const failedDatabaseCount = () => effectiveFailedDatabases().length;
  const isSearching = () => query().trim().length > 0;
  const displayItems = createMemo<JumpObject[]>(() => {
    if (isSearching()) return searchResults();
    const typeF = typeFilter();
    const dbF = databaseFilter();
    if (!typeF && !dbF) return recents();
    return recents().filter((item) => {
      if (typeF && item.object_type !== typeF) return false;
      if (dbF && item.database.toLowerCase() !== dbF.toLowerCase())
        return false;
      return true;
    });
  });
  const hasActiveFilter = () =>
    typeFilter() !== null || databaseFilter() !== "";
  const clearFilters = () => {
    setTypeFilter(null);
    saveObjectJumpTypeFilter("");
    setDatabaseFilter("");
    saveObjectJumpDatabaseFilter("");
  };
  const canShowResults = () => displayItems().length > 0;
  const hasNoScope = () =>
    !searchLoading() &&
    !searchError() &&
    effectiveInitialized() &&
    !effectiveIndexing() &&
    effectiveDatabaseCount() === 0;
  const loadingMessage = () =>
    effectiveDatabaseCount() === 0
      ? "Indexing objects across the whole server…"
      : "Searching objects across the whole server…";
  const emptyStateMessage = () => {
    const hasType = typeFilter() !== null;
    const hasDb = databaseFilter() !== "";
    const hasFilter = hasType || hasDb;
    if (isSearching()) {
      return hasFilter
        ? "No objects matched that search for the selected filters."
        : "No objects matched that search.";
    }
    return hasFilter
      ? "No recent objects match the selected filters."
      : "No recent objects yet — type to search across all databases.";
  };
  const footerStatus = () =>
    effectiveIndexing()
      ? effectiveDatabaseCount() > 0
        ? `Indexing ${effectiveProcessedDatabaseCount()}/${effectiveDatabaseCount()} DBs${failedDatabaseCount() > 0 ? ` | ${failedDatabaseCount()} failed` : ""}`
        : "Indexing server objects…"
      : effectiveDatabaseCount() > 0
        ? `${effectiveDatabaseCount()} DBs indexed${failedDatabaseCount() > 0 ? ` | ${failedDatabaseCount()} failed` : ""}`
        : effectiveInitialized()
          ? "No databases indexed"
          : "Starting object index…";

  return (
    <Show when={props.open && portalTarget()}>
      <Portal mount={portalTarget()!}>
        <DialogShell
          visible={visible()}
          onClose={props.onClose}
          overlayClass="items-start !pt-12"
          class="flex flex-col shadow-2xl"
          ariaLabel="Jump to database object"
        >
          <div class="mx-auto flex h-full w-[672px] max-w-full flex-col px-4">
              <div class="px-2 py-2">
                <div class="relative flex items-center">
                  <Icon
                    name="magnifying-glass"
                    class="pointer-events-none absolute left-4 text-text-muted"
                  />
                  <input
                    ref={inputRef}
                    name="object-jump-query"
                    value={query()}
                    onInput={(event) =>
                      setQuery((event.target as HTMLInputElement).value)
                    }
                    onKeyDown={handleKeyDown}
                    role="combobox"
                    aria-expanded={canShowResults()}
                    aria-controls={
                      canShowResults() ? JUMP_LISTBOX_ID : undefined
                    }
                    aria-autocomplete="list"
                    aria-activedescendant={
                      highlightedIndex() >= 0 &&
                      displayItems()[highlightedIndex()]
                        ? getJumpObjectOptionId(
                            displayItems()[highlightedIndex()],
                          )
                        : undefined
                    }
                    placeholder="Jump to a table, procedure, function, trigger, or type…"
                    spellcheck={false}
                    class="h-12 w-full bg-transparent pl-11 pr-4 text-base text-text placeholder-text-muted outline-none"
                  />
                </div>
                <div class="flex flex-wrap items-center gap-1.5 px-2 pt-2">
                  <Tooltip content="Database" placement="bottom">
                    <Dropdown
                      value={databaseFilter()}
                      options={databaseOptions()}
                      onChange={(value) => {
                        setDatabaseFilter(value);
                        saveObjectJumpDatabaseFilter(value);
                      }}
                      placeholder="All databases"
                      class="w-56"
                      filterable
                      compact
                      title=""
                    />
                  </Tooltip>
                  <Tooltip content="Type" placement="bottom">
                    <Dropdown
                      value={typeFilter() ?? ""}
                      options={typeOptions()}
                      onChange={(value) => {
                        setTypeFilter(value || null);
                        saveObjectJumpTypeFilter(value);
                      }}
                      placeholder="All types"
                      class="w-36"
                      compact
                      title=""
                    />
                  </Tooltip>
                  <Show when={hasActiveFilter()}>
                    <Tooltip content="Reset filters" placement="bottom">
                      <button
                        type="button"
                        onClick={clearFilters}
                        aria-label="Reset filters"
                        class="flex h-[30px] w-[30px] flex-shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/50 text-text-muted transition-colors hover:border-border hover:bg-surface-hover hover:text-text"
                      >
                        <Icon name="arrows-rotate" class="text-s" />
                      </button>
                    </Tooltip>
                  </Show>
                </div>
              </div>

              <div class="relative h-0.5 overflow-hidden">
                <Show when={showLoader()}>
                  <div class="absolute inset-0 bg-border/30" />
                  <div class="jump-palette-loader absolute inset-y-0 w-1/3" />
                </Show>
              </div>

              <div class="max-h-[58vh] overflow-y-auto p-2">
                <Show
                  when={!(!canShowResults() && showLoader())}
                  fallback={
                    <Loader variant="vertical" size={20} text={loadingMessage()} class="py-12" />
                  }
                >
                  <Show
                    when={!searchError()}
                    fallback={
                      <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                        <Icon
                          name="triangle-exclamation"
                          class="text-xl text-warning"
                        />
                        <p class="text-m">{searchError()}</p>
                      </div>
                    }
                  >
                    <Show
                      when={!hasNoScope()}
                      fallback={
                        <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                          <Icon name="database" class="text-2xl opacity-50" />
                          <p class="text-m">
                            No databases are available for object search.
                          </p>
                        </div>
                      }
                    >
                      <Show
                        when={canShowResults()}
                        fallback={
                          <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                            <Icon name="compass" class="text-2xl opacity-50" />
                            <p class="text-m">{emptyStateMessage()}</p>
                            <Show when={hasActiveFilter()}>
                              <button
                                type="button"
                                onClick={clearFilters}
                                class="rounded-md border border-border/50 px-3 py-1 text-s text-text-muted transition-colors hover:border-border hover:text-text"
                              >
                                Clear filters
                              </button>
                            </Show>
                          </div>
                        }
                      >
                        <div
                          id={JUMP_LISTBOX_ID}
                          role="listbox"
                          aria-label="Database objects"
                          class="space-y-1"
                        >
                          <Show when={!isSearching() && !hasActiveFilter()}>
                            <div
                              role="presentation"
                              class="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-text-muted"
                            >
                              Recent
                            </div>
                          </Show>
                          <For each={displayItems()}>
                            {(object, index) => {
                              const isActive = () =>
                                index() === highlightedIndex();
                              const sourceId = getJumpObjectSourceId(object);
                              const optionId = getJumpObjectOptionId(object);
                              const isExpanded = () =>
                                expandedSourceId() === sourceId;
                              const typeLabel = getObjectTypeLabel(
                                object.object_type,
                              );
                              const actionItems = getObjectActionItems(object);

                              return (
                                <div
                                  id={optionId}
                                  role="option"
                                  aria-selected={isActive()}
                                  class={`rounded-xl border transition-colors duration-200 ${
                                    isExpanded()
                                      ? "border-border/70 bg-surface-active/80 shadow-[0_18px_50px_-30px_var(--color-shadow-deep)]"
                                      : isActive()
                                        ? "border-border/60 bg-surface-active/60"
                                        : "border-transparent bg-transparent hover:border-border/40 hover:bg-surface-hover/60"
                                  }`}
                                >
                                  <div class="flex items-stretch gap-2 p-1.5">
                                    <button
                                      ref={(el) => {
                                        itemRefs[index()] = el;
                                      }}
                                      type="button"
                                      onClick={() => {
                                        setHighlightedIndex(index());
                                        handleToggleExpanded(object);
                                      }}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setHighlightedIndex(index());
                                        handleToggleExpanded(object);
                                      }}
                                      onMouseEnter={() =>
                                        setHighlightedIndex(index())
                                      }
                                      aria-expanded={isExpanded()}
                                      class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                                    >
                                      <div
                                        class={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md transition-colors ${
                                          isExpanded()
                                            ? "bg-surface-panel shadow-inner"
                                            : "bg-surface-header"
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
                                          class={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/50 bg-surface-header text-text-muted transition-[color,transform] duration-200 ${
                                            isExpanded()
                                              ? "rotate-180 text-text"
                                              : ""
                                          }`}
                                        >
                                          <Icon
                                            name="chevron-down"
                                            class="text-[10px]"
                                          />
                                        </span>
                                      </div>
                                    </button>
                                  </div>

                                  <div
                                    class={`grid overflow-hidden px-1.5 transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                      isExpanded()
                                        ? "mt-0 grid-rows-[1fr] opacity-100"
                                        : "mt-0 grid-rows-[0fr] opacity-0"
                                    }`}
                                  >
                                    <div class="overflow-hidden">
                                      <div
                                        class={`mb-1.5 rounded-xl border border-border/60 bg-surface-panel/95 p-2 transition-transform duration-300 ${
                                          isExpanded()
                                            ? "translate-y-0"
                                            : "-translate-y-2"
                                        }`}
                                      >
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
                                                  <div class="animate-in fade-in-0 slide-in-from-top-2 rounded-xl border border-border/50 bg-surface-header/60 p-2 duration-300">
                                                    <div class="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                                      <Show when={item.icon}>
                                                        <span class="flex h-4 w-4 items-center justify-center text-accent-text/80 [&_i]:!text-accent-text/80 [&_svg]:!text-accent-text/80">
                                                          {item.icon}
                                                        </span>
                                                      </Show>
                                                      <span>{item.label}</span>
                                                    </div>

                                                    <div class="grid gap-1 sm:grid-cols-2">
                                                      <For each={item.children}>
                                                        {(child) => {
                                                          const isRunning =
                                                            () =>
                                                              runningActionId() ===
                                                              child.id;

                                                          return (
                                                            <button
                                                              type="button"
                                                              disabled={
                                                                child.disabled ||
                                                                isRunning()
                                                              }
                                                              onClick={() =>
                                                                void handleActionClick(
                                                                  child,
                                                                )
                                                              }
                                                              class={`animate-in fade-in-0 slide-in-from-top-2 flex items-center gap-3 rounded-lg border border-border/50 bg-surface-panel/80 px-3 py-2 text-left text-s transition-colors duration-200 ${
                                                                child.disabled
                                                                  ? "cursor-default text-text-muted/50"
                                                                  : "cursor-pointer text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                                                              }`}
                                                            >
                                                              <span class="flex h-4 w-4 flex-shrink-0 items-center justify-center text-accent-text/85 [&_i]:!text-accent-text/85 [&_svg]:!text-accent-text/85">
                                                                <Show
                                                                  when={isRunning()}
                                                                  fallback={
                                                                    child.icon
                                                                  }
                                                                >
                                                                  <Spinner size={11} />
                                                                </Show>
                                                              </span>
                                                              <span class="flex-1">
                                                                {child.label}
                                                              </span>
                                                            </button>
                                                          );
                                                        }}
                                                      </For>
                                                    </div>
                                                  </div>
                                                );
                                              }

                                              const isRunning = () =>
                                                runningActionId() === item.id;

                                              return (
                                                <button
                                                  type="button"
                                                  disabled={
                                                    item.disabled || isRunning()
                                                  }
                                                  onClick={() =>
                                                    void handleActionClick(item)
                                                  }
                                                  class={`animate-in fade-in-0 slide-in-from-top-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-s transition-colors duration-200 ${
                                                    item.disabled
                                                      ? "cursor-default border-border/40 bg-surface-header/40 text-text-muted/50"
                                                      : item.danger
                                                        ? "cursor-pointer border-error/30 bg-error/5 text-error hover:bg-error/10"
                                                        : "cursor-pointer border-border/50 bg-surface-header/60 text-text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                                                  }`}
                                                >
                                                  <span class="flex h-4 w-4 flex-shrink-0 items-center justify-center text-accent-text/85 [&_i]:!text-accent-text/85 [&_svg]:!text-accent-text/85">
                                                    <Show
                                                      when={isRunning()}
                                                      fallback={item.icon}
                                                    >
                                                      <Spinner size={11} />
                                                    </Show>
                                                  </span>
                                                  <span class="flex-1">
                                                    {item.label}
                                                  </span>
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
                <span>
                  {isSearching()
                    ? `${displayItems().length} of ${totalMatches()} matches`
                    : `${displayItems().length} recent`}
                </span>
                <span class="flex items-center gap-1.5">
                  <Show when={effectiveIndexing()}>
                    <Spinner size={12} />
                  </Show>
                  <span>{footerStatus()}</span>
                </span>
              </div>
              <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border/50 px-4 py-2 text-[11px] text-text-muted">
                <span>
                  <kbd class="font-sans">↑↓</kbd> navigate
                </span>
                <span>
                  <kbd class="font-sans">↵</kbd>/<kbd class="font-sans">→</kbd> actions
                </span>
                <span>
                  <kbd class="font-sans">↹</kbd> focus filters
                </span>
                <span>
                  <kbd class="font-sans">esc</kbd> close
                </span>
              </div>
          </div>
        </DialogShell>
      </Portal>
    </Show>
  );
}
