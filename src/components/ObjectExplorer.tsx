import { invoke } from "@tauri-apps/api/core";
import { batch, createEffect, createSignal, For } from "solid-js";
import type { JSX } from "solid-js";
import type { SavedQuery } from "../hooks/useSavedQueries";
import type { DatabaseObject, ExecutedQuery } from "../lib/types";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { IconChevronRight, IconColumn, IconDatabase, IconFunction, IconProcedure, IconTable, IconTrigger, IconType, IconView } from "./Icons";
import { buildObjectExplorerMenuItems } from "./objectExplorerObjectMenu";
import Tooltip from "./Tooltip";

interface Props {
  databases: string[];
  onRefreshDatabases?: () => void;
  onSelect: (sql: string, execute?: boolean, title?: string, database?: string, sourceId?: string) => void;
  onDatabaseChange: (db: string) => void;
  currentDatabase?: string;
  executedQueries?: ExecutedQuery[];
  onDeleteHistory: (sql: string) => void;
  onClearHistory?: () => void;
  savedQueries?: SavedQuery[];
  onDeleteSavedQuery?: (id: string) => void;
  onLoadSavedQuery?: (filePath: string, title: string) => void;
  onOpenSavedQueriesFolder?: () => void;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type ResizableSection = "saved" | "history";

interface ExplorerSectionHeights {
  saved: number;
  history: number;
}

const EXPLORER_SECTION_HEIGHTS_KEY = "sqlqs_explorer_section_heights_v1";
const EXPLORER_COLLAPSED_KEY = "sqlqs_explorer_collapsed_v1";
const ROOT_SECTIONS = ["root:databases", "root:queries", "root:history"] as const;
const MIN_SECTION_HEIGHT = 160;
const DEFAULT_SECTION_HEIGHTS: ExplorerSectionHeights = {
  saved: 160,
  history: 180,
};

function clampSectionHeight(value: number): number {
  return Math.max(MIN_SECTION_HEIGHT, Math.round(value));
}

function loadCollapsedSections(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPLORER_COLLAPSED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr);
    }
  } catch { }
  return new Set();
}

function initExpandedSections(): Set<string> {
  const collapsed = loadCollapsedSections();
  const expanded = new Set<string>();
  for (const s of ROOT_SECTIONS) {
    if (!collapsed.has(s)) expanded.add(s);
  }
  return expanded;
}

const ICON_WRAP = "w-4 flex justify-center flex-shrink-0";
const SECTION_HEADER = "flex items-center justify-between px-3 py-2 mx-0.5 mb-1 flex-shrink-0 cursor-pointer bg-surface-header hover:bg-surface-hover rounded-md text-text transition-colors group";
const LIST_ROW = "rounded-md px-4 py-1.5 cursor-pointer group whitespace-nowrap select-text transition-colors";

function Chevron(props: { expanded: boolean }) {
  return (
    <span class={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-text-muted transition-transform ml-auto ${props.expanded ? "rotate-90" : ""}`}>
      <IconChevronRight class="w-2.5 h-2.5" />
    </span>
  );
}

function FilterInput(props: { placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      type="text"
      placeholder={props.placeholder}
      value={props.value}
      onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
      onClick={(e) => e.stopPropagation()}
      class="explorer-filter w-full h-full"
    />
  );
}

function SectionHeader(props: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  actions?: JSX.Element;
  onContextMenu?: (e: MouseEvent) => void;
}) {
  return (
    <div class={SECTION_HEADER} onClick={props.onToggle} onContextMenu={props.onContextMenu}>
      <span class="font-bold text-s uppercase tracking-wider select-none">{props.title}</span>
      <div class="flex items-center gap-2">
        {props.actions}
        <Chevron expanded={props.expanded} />
      </div>
    </div>
  );
}

interface ObjectGroup {
  key: string;
  label: string;
  type: string;
  iconName: string;
  objectType: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER" | "TYPE";
  items: DatabaseObject[];
}

const GROUP_DEFS: Omit<ObjectGroup, "items">[] = [
  { key: "tables", label: "Tables", type: "TABLE", iconName: "table", objectType: "TABLE" },
  { key: "views", label: "Views", type: "VIEW", iconName: "view", objectType: "VIEW" },
  { key: "procedures", label: "Stored Procedures", type: "PROCEDURE", iconName: "procedure", objectType: "PROCEDURE" },
  { key: "functions", label: "Functions", type: "FUNCTION", iconName: "function", objectType: "FUNCTION" },
  { key: "triggers", label: "Triggers", type: "TRIGGER", iconName: "trigger", objectType: "TRIGGER" },
  { key: "types", label: "Types", type: "TYPE", iconName: "type", objectType: "TYPE" },
];

function groupDatabaseObjects(objects: DatabaseObject[]): ObjectGroup[] {
  const groups: ObjectGroup[] = GROUP_DEFS.map(d => ({ ...d, items: [] }));
  for (const obj of objects) {
    const group = groups.find(g => g.type === obj.object_type);
    if (group) group.items.push(obj);
  }
  return groups.filter(g => g.items.length > 0);
}

function ObjectIcon(props: { type: string }) {
  switch (props.type) {
    case "database":
      return <div class={ICON_WRAP}><IconDatabase class="text-accent w-3.5 h-3.5" /></div>;
    case "table":
      return <div class={ICON_WRAP}><IconTable class="text-success w-3.5 h-3.5" /></div>;
    case "view":
      return <div class={ICON_WRAP}><IconView class="text-success w-3.5 h-3.5" /></div>;
    case "procedure":
      return <div class={ICON_WRAP}><IconProcedure class="text-purple-400 w-3.5 h-3.5" /></div>;
    case "function":
      return <div class={ICON_WRAP}><IconFunction class="text-orange-400 w-3.5 h-3.5" /></div>;
    case "trigger":
      return <div class={ICON_WRAP}><IconTrigger class="text-red-400 w-3.5 h-3.5" /></div>;
    case "type":
      return <div class={ICON_WRAP}><IconType class="text-blue-400 w-3.5 h-3.5" /></div>;
    case "column":
      return <div class={ICON_WRAP}><IconColumn class="text-text-muted w-3.5 h-3.5" /></div>;
    default:
      return null;
  }
}

function loadSectionHeights(): ExplorerSectionHeights {
  try {
    const raw = localStorage.getItem(EXPLORER_SECTION_HEIGHTS_KEY);
    if (!raw) {
      return DEFAULT_SECTION_HEIGHTS;
    }

    const parsed = JSON.parse(raw);
    const saved = clampSectionHeight(
      typeof parsed?.saved === "number" ? parsed.saved : DEFAULT_SECTION_HEIGHTS.saved,
    );
    const history = clampSectionHeight(
      typeof parsed?.history === "number" ? parsed.history : DEFAULT_SECTION_HEIGHTS.history,
    );

    return { saved, history };
  } catch {
    return DEFAULT_SECTION_HEIGHTS;
  }
}

export default function ObjectExplorer(props: Props) {
  const [expanded, setExpanded] = createSignal<Set<string>>(initExpandedSections());
  const [tableCache, setTableCache] = createSignal<Record<string, DatabaseObject[]>>({});
  const [loading, setLoading] = createSignal<Set<string>>(new Set());
  const [folderFilters, setFolderFilters] = createSignal<Record<string, string>>({});
  const [sectionHeights, setSectionHeights] = createSignal<ExplorerSectionHeights>(loadSectionHeights());
  const [activeResizer, setActiveResizer] = createSignal<ResizableSection | null>(null);
  let containerRef: HTMLDivElement | undefined;

  const [contextMenu, setContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    database: string;
    schema: string;
    table: string;
    sql?: string;
    objectType: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER" | "TYPE" | "DATABASE" | "HISTORY" | "DATABASE_FOLDER" | "SAVED_QUERY" | "FOLDER";
    savedQueryFilePath?: string;
  } | null>(null);

  function updateFilter(folderId: string, value: string) {
    setFolderFilters((f) => ({ ...f, [folderId]: value }));
  }

  createEffect(() => {
    try {
      localStorage.setItem(EXPLORER_SECTION_HEIGHTS_KEY, JSON.stringify(sectionHeights()));
    } catch { }
  });

  /**
   * Resizer behaviour:
   *
   *  "saved"  resizer — sits between Databases and Queries.
   *    Drag down → Queries shrinks, Databases absorbs via flex-grow.
   *    Drag up   → Queries grows,  Databases absorbs.
   *    History is untouched.
   *
   *  "history" resizer — sits between Queries and History.
   *    Drag down → Queries grows  + History shrinks  (combined height stays constant).
   *    Drag up   → Queries shrinks + History grows   (combined height stays constant).
   *    Databases is untouched.
   */
  function startSectionResize(section: ResizableSection, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const heights = sectionHeights();
    setActiveResizer(section);

    if (section === "saved") {
      // Simple: only Queries height changes; Databases auto-fills.
      const startSaved = heights.saved;
      const maxSaved = containerRef
        ? containerRef.clientHeight - MIN_SECTION_HEIGHT - (expanded().has("root:history") ? heights.history : 36) - 48
        : Infinity;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        // Resizer is above Queries — drag down = less room = shrink
        const next = Math.max(MIN_SECTION_HEIGHT, Math.min(maxSaved, startSaved - delta));
        setSectionHeights((prev) => prev.saved === next ? prev : { ...prev, saved: next });
      };
      const onUp = () => {
        setActiveResizer(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);

    } else {
      // "history" — trade space between Queries (above) and History (below).
      const startSaved = heights.saved;
      const startHistory = heights.history;
      const combined = startSaved + startHistory;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        // Drag down → border moves down → Queries grows, History shrinks
        let nextSaved = startSaved + delta;
        // Clamp both to min while keeping combined constant
        nextSaved = Math.max(MIN_SECTION_HEIGHT, Math.min(combined - MIN_SECTION_HEIGHT, nextSaved));
        const nextHistory = combined - nextSaved;
        setSectionHeights((prev) =>
          prev.saved === nextSaved && prev.history === nextHistory ? prev : { saved: nextSaved, history: nextHistory }
        );
      };
      const onUp = () => {
        setActiveResizer(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    }
  }

  async function loadTables(database: string, force?: boolean) {
    if (!force && tableCache()[database]) return;
    setLoading((prev) => new Set(prev).add(database));
    try {
      const tables: DatabaseObject[] = await invoke("get_tables", { database });
      batch(() => {
        setTableCache((prev) => ({ ...prev, [database]: tables }));
      });
    } catch (err) {
      console.error("Failed to load tables:", err);
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(database);
        return next;
      });
    }
  }

  function toggle(nodeId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      if ((ROOT_SECTIONS as readonly string[]).includes(nodeId)) {
        try {
          const collapsed = ROOT_SECTIONS.filter((s) => !next.has(s));
          localStorage.setItem(EXPLORER_COLLAPSED_KEY, JSON.stringify(collapsed));
        } catch { }
      }
      return next;
    });
  }

  function handleDbClick(db: string) {
    const wasExpanded = expanded().has(db);
    toggle(db);
    if (!wasExpanded) {
      loadTables(db);
    }
  }

  function handleTableDoubleClick(db: string, schema: string, table: string) {
    props.onSelect(`SELECT TOP 100 * FROM [${db}].[${schema}].[${table}]`, undefined, undefined, db);
  }

  function handleContextMenu(
    e: MouseEvent,
    db: string = "",
    schema: string = "",
    table: string = "",
    objectType: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER" | "TYPE" | "DATABASE" | "HISTORY" | "DATABASE_FOLDER" | "SAVED_QUERY" | "FOLDER",
    sql?: string,
    savedQueryFilePath?: string,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      database: db,
      schema,
      table,
      objectType,
      sql,
      savedQueryFilePath,
    });
  }

  function getContextMenuItems(): ContextMenuItem[] {
    const ctx = contextMenu();
    if (!ctx) return [];

    const { database, schema, table, objectType } = ctx;

    // Wrap onSelect so every context-menu action switches to the correct database
    const select = (sql: string, execute?: boolean) =>
      props.onSelect(sql, execute, undefined, database);

    if (objectType === "DATABASE_FOLDER") {
      return [
        {
          id: "refresh-all",
          label: "Refresh List",
          icon: <i class="fa-solid fa-rotate" />,
          onClick: () => props.onRefreshDatabases?.(),
        },
      ];
    }

    if (objectType === "FOLDER") {
      return [
        {
          id: "refresh-folder",
          label: "Refresh",
          icon: <i class="fa-solid fa-rotate" />,
          onClick: () => {
            setTableCache((prev) => {
              const next = { ...prev };
              delete next[database];
              return next;
            });
            loadTables(database, true);
          },
        },
      ];
    }

    if (objectType === "SAVED_QUERY") {
      const queryId = ctx.sql || "";
      const filePath = ctx.savedQueryFilePath || "";
      const title = table;
      return [
        {
          id: "open-saved",
          label: "Open",
          icon: <i class="fa-solid fa-folder-open" />,
          onClick: () => props.onLoadSavedQuery?.(filePath, title),
        },
        {
          id: "copy-path",
          label: "Copy Path",
          icon: <i class="fa-solid fa-copy" />,
          onClick: () => navigator.clipboard.writeText(filePath),
        },
        { id: "sep-saved-1", separator: true },
        {
          id: "delete-saved",
          label: "Delete",
          icon: <i class="fa-solid fa-trash-can" />,
          onClick: () => props.onDeleteSavedQuery?.(queryId),
        },
      ];
    }

    if (objectType === "HISTORY") {
      const sqlValue = ctx.sql || "";
      const dbName = database;
      return [
        {
          id: "use-query",
          label: "Open Query",
          icon: <i class="fa-solid fa-folder-open" />,
          onClick: () => props.onSelect(sqlValue, false, table, dbName, `history:${sqlValue}`),
        },
        {
          id: "copy-query",
          label: "Copy SQL",
          icon: <i class="fa-solid fa-copy" />,
          onClick: () => navigator.clipboard.writeText(sqlValue),
        },
        { id: "sep-hist-1", separator: true },
        {
          id: "delete-history",
          label: "Delete",
          icon: <i class="fa-solid fa-trash-can" />,
          onClick: () => props.onDeleteHistory(sqlValue),
        },
      ];
    }

    if (objectType === "DATABASE") {
      return [
        {
          id: "use",
          label: "Use Database",
          icon: <i class="fa-solid fa-play" />,
          onClick: () => props.onDatabaseChange(database),
        },
        {
          id: "new-query",
          label: "New Query",
          icon: <i class="fa-solid fa-file-circle-plus" />,
          onClick: () => {
            props.onDatabaseChange(database);
            props.onSelect("");
          },
        },
        { id: "sep-db-1", separator: true },
        {
          id: "refresh",
          label: "Refresh",
          icon: <i class="fa-solid fa-rotate" />,
          onClick: () => {
            setTableCache((prev) => {
              const next = { ...prev };
              delete next[database];
              return next;
            });
            loadTables(database, true);
          },
        },
      ];
    }

    return buildObjectExplorerMenuItems({
      database,
      schema,
      table,
      objectType,
      onSelectSql: select,
    });
  }

  return (
    <div class="flex flex-col h-full bg-transparent">
      <div ref={containerRef} class="flex-1 overflow-hidden p-2 text-s flex flex-col gap-1 explorer-content">
        <div
          class={`flex flex-col overflow-hidden ${activeResizer() ? "" : "transition-all duration-300 ease-in-out"}`}
          style={{
            "flex-grow": expanded().has("root:databases") ? 1 : 0,
            "flex-basis": expanded().has("root:databases") ? "0%" : "36px",
            "min-height": expanded().has("root:databases") ? `${MIN_SECTION_HEIGHT}px` : "36px"
          }}
        >
          <SectionHeader
            title="Databases"
            expanded={expanded().has("root:databases")}
            onToggle={() => toggle("root:databases")}
            onContextMenu={(e) => handleContextMenu(e, "", "", "", "DATABASE_FOLDER")}
          />

          <div
            class="flex-1 flex flex-col min-h-0 px-2 transition-opacity duration-300"
            style={{
              opacity: expanded().has("root:databases") ? 1 : 0,
              "pointer-events": expanded().has("root:databases") ? "auto" : "none"
            }}
          >

              {props.databases.length > 0 && (
                <div class="mb-2 h-7 flex-shrink-0">
                  <FilterInput placeholder="Filter databases..." value={folderFilters()["root:databases"] || ""} onChange={(v) => updateFilter("root:databases", v)} />
                </div>
              )}

              <div class="flex-1 overflow-y-auto overflow-x-hidden pb-2 scrollbar-gutter-stable">
                <For each={props.databases.filter((db) => db.toLowerCase().includes((folderFilters()["root:databases"] || "").toLowerCase()))}>
                  {(db) => (
                    <div style={{ display: "flex", "flex-direction": "column" }}>
                      <div
                        class={`tree-node cursor-pointer ${contextMenu()?.visible && contextMenu()!.database === db && contextMenu()!.objectType === "DATABASE" ? "bg-surface-active" : ""}`}
                        style={{ "--depth": "0" }}
                        onClick={() => handleDbClick(db)}
                        onDblClick={() => props.onDatabaseChange(db)}
                        onContextMenu={(e) => handleContextMenu(e, db, "", "", "DATABASE")}
                      >
                        <ObjectIcon type="database" />
                        <span class={`truncate flex-1 min-w-0 ${db === props.currentDatabase ? "font-bold" : ""}`}>
                          {db}
                        </span>
                        {loading().has(db) && <span class="text-text-muted ml-1 animate-pulse">...</span>}
                        <Chevron expanded={expanded().has(db)} />
                      </div>

                      <div class={`accordion-content ${expanded().has(db) ? "expanded" : ""}`}>
                        <div class="accordion-inner">
                          {tableCache()[db] ? (
                            <div>
                              <For each={groupDatabaseObjects(tableCache()[db])}>
                                {(group) => {
                                  const folderId = `${db}:${group.key}`;
                                  const isOpen = () => expanded().has(folderId);
                                  const filter = () => (folderFilters()[folderId] || "").toLowerCase();
                                  const filtered = () => {
                                    const f = filter();
                                    return f
                                      ? group.items.filter(o => o.schema_name.toLowerCase().includes(f) || o.name.toLowerCase().includes(f))
                                      : group.items;
                                  };
                                  const canDblClick = group.objectType === "TABLE" || group.objectType === "VIEW";

                                  return (
                                    <div>
                                      <div
                                        class={`tree-node cursor-pointer group relative ${contextMenu()?.visible && contextMenu()!.database === db && contextMenu()!.table === group.key && contextMenu()!.objectType === "FOLDER" ? "bg-surface-active" : ""}`}
                                        style={{ "--depth": "1" }}
                                        onClick={() => toggle(folderId)}
                                        onContextMenu={(e) => handleContextMenu(e, db, "", group.key, "FOLDER")}
                                      >
                                        <i class={`fa-solid ${isOpen() ? "fa-folder-open" : "fa-folder"} flex-shrink-0 text-warning w-4 text-center text-s`} />
                                        <span class="truncate flex-1 min-w-0">{group.label} ({group.items.length})</span>
                                        <Chevron expanded={isOpen()} />
                                      </div>
                                      {isOpen() && (
                                        <div class="accordion-content expanded">
                                          <div class="accordion-inner">
                                            <div class="explorer-filter-nested mb-1 h-7 flex-shrink-0">
                                              <FilterInput placeholder={`Filter ${group.label.toLowerCase()}...`} value={folderFilters()[folderId] || ""} onChange={(v) => updateFilter(folderId, v)} />
                                            </div>
                                            <For each={filtered()}>
                                              {(o) => (
                                                <div
                                                  class={`tree-node cursor-pointer ${contextMenu()?.visible && contextMenu()!.database === db && contextMenu()!.schema === o.schema_name && contextMenu()!.table === o.name ? "bg-surface-active" : ""}`}
                                                  style={{ "--depth": "2" }}
                                                  onDblClick={canDblClick ? () => handleTableDoubleClick(db, o.schema_name, o.name) : undefined}
                                                  onContextMenu={(e) => handleContextMenu(e, db, o.schema_name, o.name, group.objectType)}
                                                >
                                                  <ObjectIcon type={group.iconName} />
                                                  <span class="truncate flex-1 min-w-0">{o.schema_name}.{o.name}</span>
                                                </div>
                                              )}
                                            </For>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          ) : (
                            expanded().has(db) && (
                              <div class="tree-node" style={{ "--depth": "1" }}>
                                <span class="truncate flex-1 min-w-0 text-text-muted italic animate-pulse">Loading objects...</span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>


        {expanded().has("root:queries") && expanded().has("root:databases") && (
          <div
            class={`resizer resizer-v mx-2 ${activeResizer() === "saved" ? "active" : ""}`}
            onMouseDown={(e) => startSectionResize("saved", e)}
          />
        )}

        <div
          class={`flex flex-col mt-1 overflow-hidden ${activeResizer() ? "" : "transition-all duration-300 ease-in-out"}`}
          style={{
            "flex-grow": expanded().has("root:queries") && !expanded().has("root:databases") ? 1 : 0,
            "flex-basis": !expanded().has("root:queries") ? "36px" : expanded().has("root:databases") ? `${sectionHeights().saved}px` : "0%",
            "flex-shrink": 0,
            "min-height": expanded().has("root:queries") ? `${MIN_SECTION_HEIGHT}px` : "36px"
          }}
        >
          <SectionHeader
            title="Queries"
            expanded={expanded().has("root:queries")}
            onToggle={() => toggle("root:queries")}
            actions={props.onOpenSavedQueriesFolder && (
              <Tooltip content="Open folder" placement="top">
                <button
                  onClick={(e) => { e.stopPropagation(); props.onOpenSavedQueriesFolder!(); }}
                  class="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text transition-colors cursor-pointer"
                >
                  <i class="fa-regular fa-folder-open text-[12px]" />
                </button>
              </Tooltip>
            )}
          />

          <div
            class="flex-1 flex flex-col min-h-0 px-2 transition-opacity duration-300"
            style={{
              opacity: expanded().has("root:queries") ? 1 : 0,
              "pointer-events": expanded().has("root:queries") ? "auto" : "none"
            }}
          >
            <div class="h-full flex flex-col">
              {(props.savedQueries ?? []).length > 0 && (
                <div class="mb-1 h-7 flex-shrink-0">
                  <FilterInput placeholder="Filter queries..." value={folderFilters()["root:queries"] || ""} onChange={(v) => updateFilter("root:queries", v)} />
                </div>
              )}
              <div class={`flex-1 overflow-x-hidden pb-2 ${(props.savedQueries ?? []).length > 0 ? "overflow-y-auto scrollbar-gutter-stable" : "overflow-y-hidden"}`}>
                {(props.savedQueries ?? []).length === 0 ? (
                  <div class="flex flex-col items-center justify-center text-text-muted py-8 select-none">
                    <i class="fa-solid fa-file-code text-3xl mb-3" />
                    <p class="text-[12px]">No queries</p>
                  </div>
                ) : (
                  <For each={(props.savedQueries ?? []).filter((item) =>
                      item.title.toLowerCase().includes((folderFilters()["root:queries"] || "").toLowerCase())
                    )}>
                    {(item) => (
                      <Tooltip content={item.filePath} placement="right">
                        <div
                          class={`${LIST_ROW} ${contextMenu()?.visible && contextMenu()!.sql === item.id ? "bg-white/10" : "hover:bg-surface-hover"}`}
                          onClick={() => props.onLoadSavedQuery?.(item.filePath, item.title)}
                          onContextMenu={(e) => handleContextMenu(e, "", "", item.title, "SAVED_QUERY", item.id, item.filePath)}
                        >
                          <div class="flex items-center justify-between text-s">
                            <span class="truncate flex-1 min-w-0" title={item.title}>{item.title}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                props.onDeleteSavedQuery?.(item.id);
                              }}
                              class="w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-error flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            >
                              <i class="fa-solid fa-trash-can text-s" />
                            </button>
                          </div>
                        </div>
                      </Tooltip>
                    )}
                  </For>
                )}
              </div>
            </div>
          </div>
        </div>

        {expanded().has("root:history") && expanded().has("root:databases") && (
          <div
            class={`resizer resizer-v mx-2 ${activeResizer() === "history" ? "active" : ""}`}
            onMouseDown={(e) => startSectionResize("history", e)}
          />
        )}

        <div
          class={`flex flex-col mt-1 overflow-hidden ${activeResizer() ? "" : "transition-all duration-300 ease-in-out"}`}
          style={{
            "flex-grow": expanded().has("root:history") && !expanded().has("root:databases") ? 1 : 0,
            "flex-basis": !expanded().has("root:history") ? "36px" : expanded().has("root:databases") ? `${sectionHeights().history}px` : "0%",
            "flex-shrink": 0,
            "min-height": expanded().has("root:history") ? `${MIN_SECTION_HEIGHT}px` : "36px"
          }}
        >
          <SectionHeader
            title="History"
            expanded={expanded().has("root:history")}
            onToggle={() => toggle("root:history")}
            actions={props.onClearHistory && (props.executedQueries ?? []).length > 0 && (
              <Tooltip content="Clear all" placement="top">
                <button
                  onClick={(e) => { e.stopPropagation(); props.onClearHistory!(); }}
                  class="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-error transition-colors cursor-pointer"
                >
                  <i class="fa-solid fa-trash-can text-s" />
                </button>
              </Tooltip>
            )}
          />

          <div
            class="flex-1 flex flex-col min-h-0 px-2 transition-opacity duration-300"
            style={{
              opacity: expanded().has("root:history") ? 1 : 0,
              "pointer-events": expanded().has("root:history") ? "auto" : "none"
            }}
          >
            <div class="h-full flex flex-col">
              {(props.executedQueries ?? []).length > 0 && (
                <div class="mb-1 h-7 flex-shrink-0">
                  <FilterInput placeholder="Filter history..." value={folderFilters()["root:history"] || ""} onChange={(v) => updateFilter("root:history", v)} />
                </div>
              )}
              <div class={`flex-1 overflow-x-hidden pb-2 ${(props.executedQueries ?? []).length > 0 ? "overflow-y-auto scrollbar-gutter-stable" : "overflow-y-hidden"}`}>
                {(props.executedQueries ?? []).length === 0 ? (
                  <div class="flex flex-col items-center justify-center text-text-muted py-8 select-none">
                    <i class="fa-solid fa-clock-rotate-left text-m mb-3" />
                    <p class="text-s">No history yet</p>
                  </div>
                ) : (
                  <For each={(props.executedQueries ?? []).filter((item) =>
                      item.sql.toLowerCase().includes((folderFilters()["root:history"] || "").toLowerCase()) ||
                      item.title.toLowerCase().includes((folderFilters()["root:history"] || "").toLowerCase())
                    )}>
                    {(item) => (
                      <Tooltip content={item.sql} placement="right">
                        <div
                          class={`${LIST_ROW} ${contextMenu()?.visible && contextMenu()!.sql === item.sql && contextMenu()!.objectType === "HISTORY" ? "bg-white/10" : "hover:bg-surface-hover"}`}
                          onClick={() => props.onSelect(item.sql, false, item.title, item.database, `history:${item.sql}`)}
                          onContextMenu={(e) => handleContextMenu(e, item.database, "", item.title, "HISTORY", item.sql)}
                        >
                          <div class="flex items-center justify-between text-s">
                            <span class="truncate flex-1 min-w-0">{item.title}</span>
                          </div>
                          <div class="flex items-center justify-between mt-1 text-icon opacity-50">
                            <span class="truncate max-w-[150px]">{item.database}</span>
                            <span class="flex-shrink-0 ml-2">{formatTimeAgo(item.executedAt)}</span>
                          </div>
                        </div>
                      </Tooltip>
                    )}
                  </For>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {contextMenu()?.visible && (
        <ContextMenu
          items={getContextMenuItems()}
          x={contextMenu()!.x}
          y={contextMenu()!.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
