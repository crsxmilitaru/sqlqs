import { invoke } from "@tauri-apps/api/core";
import { batch, createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { loadRevealCurrentDatabaseInExplorer } from "../../lib/settings";
import type { JSX } from "solid-js";
import type { SavedQuery } from "../../hooks/useSavedQueries";
import type { DatabaseObject, ExecutedQuery } from "../../lib/types";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import {
  IconChevronRight,
  IconColumn,
  IconDatabase,
  IconFunction,
  IconProcedure,
  IconTable,
  IconTrigger,
  IconType,
  IconView,
} from "../ui/Icons";
import {
  buildObjectExplorerMenuItems,
  type ExplorerObjectType,
} from "./ObjectMenu";
import Tooltip from "../ui/Tooltip";
import ConfirmDialog from "../ui/ConfirmDialog";

interface Props {
  databases: string[];
  onRefreshDatabases?: () => void;
  onSelect: (
    sql: string,
    execute?: boolean,
    title?: string,
    database?: string,
    sourceId?: string,
  ) => void;
  onDatabaseChange: (db: string) => void;
  currentDatabase?: string;
  executedQueries?: ExecutedQuery[];
  onDeleteHistory: (sql: string) => void;
  onClearHistory?: () => void;
  savedQueries?: SavedQuery[];
  onDeleteSavedQuery?: (id: string) => void;
  onLoadSavedQuery?: (filePath: string, title: string) => void;
  onOpenSavedQueriesFolder?: () => void;
  onShowProperties?: (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType | "DATABASE",
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
  onShowBackupRestore?: (database: string) => void;
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
const ROOT_SECTIONS = [
  "root:databases",
  "root:queries",
  "root:history",
] as const;
type RootSectionId = (typeof ROOT_SECTIONS)[number];
const ROOT_SECTION_OBJECT_TYPE = {
  "root:databases": "DATABASE_FOLDER",
  "root:queries": "QUERIES_FOLDER",
  "root:history": "HISTORY_FOLDER",
} as const satisfies Record<RootSectionId, string>;
type RootSectionObjectType =
  (typeof ROOT_SECTION_OBJECT_TYPE)[RootSectionId];
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
  } catch {}
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
const SECTION_HEADER =
  "flex items-center justify-between px-3 py-2 mx-0.5 mb-1 flex-shrink-0 cursor-pointer bg-surface-header hover:bg-surface-hover rounded-md text-text transition-colors group";
const LIST_ROW =
  "rounded-md px-4 py-1.5 cursor-pointer group whitespace-nowrap select-text transition-colors";

function Chevron(props: { expanded: boolean }) {
  return (
    <span
      class={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-text-muted transition-transform ml-auto ${props.expanded ? "rotate-90" : ""}`}
    >
      <IconChevronRight class="w-2.5 h-2.5" />
    </span>
  );
}

function FilterInput(props: {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  focusOnMount?: boolean;
}) {
  let inputRef: HTMLInputElement | undefined;
  onMount(() => {
    if (props.focusOnMount) inputRef?.focus();
  });
  return (
    <input
      ref={inputRef}
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
    <div
      class={SECTION_HEADER}
      onClick={props.onToggle}
      onContextMenu={props.onContextMenu}
    >
      <span class="font-bold text-s uppercase tracking-wider select-none">
        {props.title}
      </span>
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
  {
    key: "tables",
    label: "Tables",
    type: "TABLE",
    iconName: "table",
    objectType: "TABLE",
  },
  {
    key: "views",
    label: "Views",
    type: "VIEW",
    iconName: "view",
    objectType: "VIEW",
  },
  {
    key: "procedures",
    label: "Stored Procedures",
    type: "PROCEDURE",
    iconName: "procedure",
    objectType: "PROCEDURE",
  },
  {
    key: "functions",
    label: "Functions",
    type: "FUNCTION",
    iconName: "function",
    objectType: "FUNCTION",
  },
  {
    key: "triggers",
    label: "Triggers",
    type: "TRIGGER",
    iconName: "trigger",
    objectType: "TRIGGER",
  },
  {
    key: "types",
    label: "Types",
    type: "TYPE",
    iconName: "type",
    objectType: "TYPE",
  },
];

function groupDatabaseObjects(objects: DatabaseObject[]): ObjectGroup[] {
  const groups: ObjectGroup[] = GROUP_DEFS.map((d) => ({ ...d, items: [] }));
  for (const obj of objects) {
    const group = groups.find((g) => g.type === obj.object_type);
    if (group) group.items.push(obj);
  }
  return groups.filter((g) => g.items.length > 0);
}

function ObjectIcon(props: { type: string }) {
  switch (props.type) {
    case "database":
      return (
        <div class={ICON_WRAP}>
          <IconDatabase class="text-accent w-3.5 h-3.5" />
        </div>
      );
    case "table":
      return (
        <div class={ICON_WRAP}>
          <IconTable class="text-success w-3.5 h-3.5" />
        </div>
      );
    case "view":
      return (
        <div class={ICON_WRAP}>
          <IconView class="text-success w-3.5 h-3.5" />
        </div>
      );
    case "procedure":
      return (
        <div class={ICON_WRAP}>
          <IconProcedure class="text-purple-400 w-3.5 h-3.5" />
        </div>
      );
    case "function":
      return (
        <div class={ICON_WRAP}>
          <IconFunction class="text-orange-400 w-3.5 h-3.5" />
        </div>
      );
    case "trigger":
      return (
        <div class={ICON_WRAP}>
          <IconTrigger class="text-red-400 w-3.5 h-3.5" />
        </div>
      );
    case "type":
      return (
        <div class={ICON_WRAP}>
          <IconType class="text-blue-400 w-3.5 h-3.5" />
        </div>
      );
    case "column":
      return (
        <div class={ICON_WRAP}>
          <IconColumn class="text-text-muted w-3.5 h-3.5" />
        </div>
      );
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
      typeof parsed?.saved === "number"
        ? parsed.saved
        : DEFAULT_SECTION_HEIGHTS.saved,
    );
    const history = clampSectionHeight(
      typeof parsed?.history === "number"
        ? parsed.history
        : DEFAULT_SECTION_HEIGHTS.history,
    );

    return { saved, history };
  } catch {
    return DEFAULT_SECTION_HEIGHTS;
  }
}

export default function ObjectExplorer(props: Props) {
  const [expanded, setExpanded] = createSignal<Set<string>>(
    initExpandedSections(),
  );
  const [tableCache, setTableCache] = createSignal<
    Record<string, DatabaseObject[]>
  >({});
  const [loading, setLoading] = createSignal<Set<string>>(new Set());
  const [folderFilters, setFolderFilters] = createSignal<
    Record<string, string>
  >({});
  const [sectionHeights, setSectionHeights] =
    createSignal<ExplorerSectionHeights>(loadSectionHeights());
  const [activeResizer, setActiveResizer] =
    createSignal<ResizableSection | null>(null);
  let containerRef: HTMLDivElement | undefined;
  const dbRowRefs = new Map<string, HTMLDivElement>();

  const [confirm, setConfirm] = createSignal<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const [contextMenu, setContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    database: string;
    schema: string;
    table: string;
    sql?: string;
    objectType:
    | "TABLE"
    | "VIEW"
    | "PROCEDURE"
    | "FUNCTION"
    | "TRIGGER"
    | "TYPE"
    | "DATABASE"
    | "HISTORY"
    | RootSectionObjectType
    | "SAVED_QUERY"
    | "FOLDER";
    savedQueryFilePath?: string;
  } | null>(null);

  function updateFilter(folderId: string, value: string) {
    setFolderFilters((f) => ({ ...f, [folderId]: value }));
  }

  function persistSectionHeights() {
    try {
      localStorage.setItem(
        EXPLORER_SECTION_HEIGHTS_KEY,
        JSON.stringify(sectionHeights()),
      );
    } catch (err) {
      void err;
    }
  }

  function persistCollapsedSections(expandedSet: Set<string>) {
    try {
      const collapsed = ROOT_SECTIONS.filter((s) => !expandedSet.has(s));
      localStorage.setItem(
        EXPLORER_COLLAPSED_KEY,
        JSON.stringify(collapsed),
      );
    } catch (err) {
      void err;
    }
  }

  function confirmClearHistory() {
    if (!props.onClearHistory) return;
    setConfirm({
      title: "Clear history",
      message: "Remove all queries from history? This cannot be undone.",
      confirmLabel: "Clear all",
      onConfirm: () => props.onClearHistory!(),
    });
  }

  const databaseFilterLower = createMemo(() =>
    (folderFilters()["root:databases"] || "").toLowerCase(),
  );
  const filteredDatabases = createMemo(() => {
    const f = databaseFilterLower();
    if (!f) return props.databases;
    return props.databases.filter((db) => db.toLowerCase().includes(f));
  });

  const savedQueriesIndexed = createMemo(() =>
    (props.savedQueries ?? []).map((item) => ({
      item,
      titleLower: item.title.toLowerCase(),
    })),
  );
  const savedQueryFilterLower = createMemo(() =>
    (folderFilters()["root:queries"] || "").toLowerCase(),
  );
  const filteredSavedQueries = createMemo(() => {
    const f = savedQueryFilterLower();
    const indexed = savedQueriesIndexed();
    if (!f) return indexed.map((e) => e.item);
    return indexed.filter((e) => e.titleLower.includes(f)).map((e) => e.item);
  });

  const executedQueriesIndexed = createMemo(() =>
    (props.executedQueries ?? []).map((item) => ({
      item,
      sqlLower: item.sql.toLowerCase(),
      titleLower: item.title.toLowerCase(),
    })),
  );
  const historyFilterLower = createMemo(() =>
    (folderFilters()["root:history"] || "").toLowerCase(),
  );
  const filteredHistory = createMemo(() => {
    const f = historyFilterLower();
    const indexed = executedQueriesIndexed();
    if (!f) return indexed.map((e) => e.item);
    return indexed
      .filter((e) => e.sqlLower.includes(f) || e.titleLower.includes(f))
      .map((e) => e.item);
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
        ? containerRef.clientHeight -
        MIN_SECTION_HEIGHT -
        (expanded().has("root:history") ? heights.history : 36) -
        48
        : Infinity;

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        // Resizer is above Queries — drag down = less room = shrink
        const next = Math.max(
          MIN_SECTION_HEIGHT,
          Math.min(maxSaved, startSaved - delta),
        );
        setSectionHeights((prev) =>
          prev.saved === next ? prev : { ...prev, saved: next },
        );
      };
      const onUp = () => {
        setActiveResizer(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        persistSectionHeights();
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
        let nextSaved = startSaved + delta;
        nextSaved = Math.max(
          MIN_SECTION_HEIGHT,
          Math.min(combined - MIN_SECTION_HEIGHT, nextSaved),
        );
        const nextHistory = combined - nextSaved;
        setSectionHeights((prev) =>
          prev.saved === nextSaved && prev.history === nextHistory
            ? prev
            : { saved: nextSaved, history: nextHistory },
        );
      };
      const onUp = () => {
        setActiveResizer(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        persistSectionHeights();
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

  createEffect(
    on(
      () => [props.currentDatabase, props.databases] as const,
      ([db, dbs]) => {
        if (!db) return;
        if (!loadRevealCurrentDatabaseInExplorer()) return;
        if (!(dbs ?? []).includes(db)) return;

        const prevExpanded = expanded();
        const needsTransition =
          !prevExpanded.has("root:databases") || !prevExpanded.has(db);

        batch(() => {
          const next = new Set(prevExpanded);
          next.add("root:databases");
          next.add(db);
          setExpanded(next);
          persistCollapsedSections(next);
          setFolderFilters((f) =>
            f["root:databases"] ? { ...f, "root:databases": "" } : f,
          );
        });

        void loadTables(db);

        const scroll = () =>
          dbRowRefs.get(db)?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });

        if (needsTransition) {
          setTimeout(scroll, 320);
        } else {
          requestAnimationFrame(scroll);
        }
      },
    ),
  );

  function toggle(nodeId: string) {
    const next = new Set(expanded());
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    setExpanded(next);
    if ((ROOT_SECTIONS as readonly string[]).includes(nodeId)) {
      persistCollapsedSections(next);
    }
  }

  function handleDbClick(db: string) {
    const wasExpanded = expanded().has(db);
    toggle(db);
    if (!wasExpanded) {
      loadTables(db);
    }
  }

  function handleTableDoubleClick(db: string, schema: string, table: string) {
    props.onSelect(
      `SELECT TOP 100 * FROM [${db}].[${schema}].[${table}]`,
      undefined,
      undefined,
      db,
    );
  }

  function handleContextMenu(
    e: MouseEvent,
    db: string = "",
    schema: string = "",
    table: string = "",
    objectType:
      | "TABLE"
      | "VIEW"
      | "PROCEDURE"
      | "FUNCTION"
      | "TRIGGER"
      | "TYPE"
      | "DATABASE"
      | "HISTORY"
      | RootSectionObjectType
      | "SAVED_QUERY"
      | "FOLDER",
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

  function getRootSectionMenu(
    type: RootSectionObjectType,
  ): ContextMenuItem[] {
    switch (type) {
      case "DATABASE_FOLDER":
        return [
          {
            id: "refresh-databases",
            label: "Refresh List",
            icon: <i class="fa-solid fa-rotate" />,
            onClick: () => props.onRefreshDatabases?.(),
          },
        ];
      case "QUERIES_FOLDER":
        return [
          {
            id: "open-queries-folder",
            label: "Open Folder",
            icon: <i class="fa-regular fa-folder-open" />,
            disabled: !props.onOpenSavedQueriesFolder,
            onClick: () => props.onOpenSavedQueriesFolder?.(),
          },
        ];
      case "HISTORY_FOLDER":
        return [
          {
            id: "clear-history",
            label: "Clear All",
            icon: <i class="fa-solid fa-trash-can" />,
            disabled:
              !props.onClearHistory ||
              (props.executedQueries ?? []).length === 0,
            onClick: () => confirmClearHistory(),
          },
        ];
      default: {
        const _exhaustive: never = type;
        return _exhaustive;
      }
    }
  }

  function openSectionHeaderContextMenu(
    sectionId: RootSectionId,
    e: MouseEvent,
  ) {
    handleContextMenu(e, "", "", "", ROOT_SECTION_OBJECT_TYPE[sectionId]);
  }

  function getContextMenuItems(): ContextMenuItem[] {
    const ctx = contextMenu();
    if (!ctx) return [];

    const { database, schema, table, objectType } = ctx;

    // Wrap onSelect so every context-menu action switches to the correct database
    const select = (sql: string, execute?: boolean) =>
      props.onSelect(sql, execute, undefined, database);

    if (
      objectType === "DATABASE_FOLDER" ||
      objectType === "QUERIES_FOLDER" ||
      objectType === "HISTORY_FOLDER"
    ) {
      return getRootSectionMenu(objectType);
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
          onClick: () =>
            setConfirm({
              title: "Delete saved query",
              message: `Delete "${title}"? This cannot be undone.`,
              confirmLabel: "Delete",
              onConfirm: () => props.onDeleteSavedQuery?.(queryId),
            }),
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
          onClick: () =>
            props.onSelect(
              sqlValue,
              false,
              table,
              dbName,
              `history:${sqlValue}`,
            ),
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
          onClick: () =>
            setConfirm({
              title: "Delete history item",
              message: `Remove "${table}" from history?`,
              confirmLabel: "Delete",
              onConfirm: () => props.onDeleteHistory(sqlValue),
            }),
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
        {
          id: "backup-restore",
          label: "Backup & Restore",
          icon: <i class="fa-solid fa-box-archive" />,
          onClick: () => props.onShowBackupRestore?.(database),
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
        { id: "sep-db-2", separator: true },
        {
          id: "properties",
          label: "Properties",
          icon: <i class="fa-solid fa-circle-info" />,
          onClick: () =>
            props.onShowProperties?.(database, "", database, "DATABASE"),
        },
      ];
    }

    return buildObjectExplorerMenuItems({
      database,
      schema,
      table,
      objectType,
      onSelectSql: select,
      onShowProperties: () =>
        props.onShowProperties?.(
          database,
          schema,
          table,
          objectType as ExplorerObjectType,
        ),
      onShowRename: () =>
        props.onShowRename?.(
          database,
          schema,
          table,
          objectType as ExplorerObjectType,
        ),
      onShowDrop: () =>
        props.onShowDrop?.(
          database,
          schema,
          table,
          objectType as ExplorerObjectType,
        ),
      onShowDependencies: () =>
        props.onShowDependencies?.(
          database,
          schema,
          table,
          objectType as ExplorerObjectType,
        ),
    });
  }

  return (
    <div class="flex flex-col h-full bg-transparent">
      <div
        ref={containerRef}
        class="flex-1 overflow-hidden p-2 text-s flex flex-col gap-1 explorer-content"
      >
        <div
          class={`flex flex-col overflow-hidden ${activeResizer() ? "" : "transition-all duration-300 ease-in-out"}`}
          style={{
            "flex-grow": expanded().has("root:databases") ? 1 : 0,
            "flex-basis": expanded().has("root:databases") ? "0%" : "36px",
            "min-height": expanded().has("root:databases")
              ? `${MIN_SECTION_HEIGHT}px`
              : "36px",
          }}
        >
          <SectionHeader
            title="Databases"
            expanded={expanded().has("root:databases")}
            onToggle={() => toggle("root:databases")}
            onContextMenu={(e) =>
              openSectionHeaderContextMenu("root:databases", e)
            }
            actions={
              props.onRefreshDatabases && (
                <Tooltip content="Refresh" placement="top">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onRefreshDatabases!();
                    }}
                    class="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text transition-colors cursor-pointer"
                  >
                    <i class="fa-solid fa-rotate text-s" />
                  </button>
                </Tooltip>
              )
            }
          />

          <div
            class="flex-1 flex flex-col min-h-0 px-2 transition-opacity duration-300"
            style={{
              opacity: expanded().has("root:databases") ? 1 : 0,
              "pointer-events": expanded().has("root:databases")
                ? "auto"
                : "none",
            }}
          >
            {props.databases.length > 0 && (
              <div class="mb-2 h-7 flex-shrink-0">
                <FilterInput
                  placeholder="Filter databases..."
                  value={folderFilters()["root:databases"] || ""}
                  onChange={(v) => updateFilter("root:databases", v)}
                />
              </div>
            )}

            <div class="flex-1 overflow-y-auto overflow-x-hidden pb-2 scrollbar-gutter-stable">
              <For each={filteredDatabases()}>
                {(db) => {
                  onCleanup(() => dbRowRefs.delete(db));
                  return (
                  <div style={{ display: "flex", "flex-direction": "column" }}>
                    <div
                      ref={(el) => dbRowRefs.set(db, el)}
                      class={`tree-node cursor-pointer ${contextMenu()?.visible && contextMenu()!.database === db && contextMenu()!.objectType === "DATABASE" ? "bg-surface-active" : ""}`}
                      style={{ "--depth": "0" }}
                      onClick={() => handleDbClick(db)}
                      onDblClick={() => props.onDatabaseChange(db)}
                      onContextMenu={(e) =>
                        handleContextMenu(e, db, "", "", "DATABASE")
                      }
                    >
                      <ObjectIcon type="database" />
                      <span
                        class={`truncate flex-1 min-w-0 ${db === props.currentDatabase ? "font-bold" : ""}`}
                      >
                        {db}
                      </span>
                      {loading().has(db) && (
                        <span class="text-text-muted ml-1 animate-pulse">
                          ...
                        </span>
                      )}
                      <Chevron expanded={expanded().has(db)} />
                    </div>

                    <div
                      class={`accordion-content ${expanded().has(db) ? "expanded" : ""}`}
                    >
                      <div class="accordion-inner">
                        <Show
                          when={tableCache()[db]}
                          fallback={
                            <Show when={expanded().has(db)}>
                              <div class="tree-node" style={{ "--depth": "1" }}>
                                <span class="truncate flex-1 min-w-0 text-text-muted italic animate-pulse">
                                  Loading objects...
                                </span>
                              </div>
                            </Show>
                          }
                        >
                          <div>
                            <For each={groupDatabaseObjects(tableCache()[db] ?? [])}>
                              {(group) => {
                                const folderId = `${db}:${group.key}`;
                                const isOpen = () => expanded().has(folderId);
                                const filter = () =>
                                  (
                                    folderFilters()[folderId] || ""
                                  ).toLowerCase();
                                const filtered = () => {
                                  const f = filter();
                                  return f
                                    ? group.items.filter(
                                      (o) =>
                                        o.schema_name
                                          .toLowerCase()
                                          .includes(f) ||
                                        o.name.toLowerCase().includes(f),
                                    )
                                    : group.items;
                                };
                                const canDblClick =
                                  group.objectType === "TABLE" ||
                                  group.objectType === "VIEW";

                                return (
                                  <div>
                                    <div
                                      class={`tree-node cursor-pointer group relative ${contextMenu()?.visible && contextMenu()!.database === db && contextMenu()!.table === group.key && contextMenu()!.objectType === "FOLDER" ? "bg-surface-active" : ""}`}
                                      style={{ "--depth": "1" }}
                                      onClick={() => toggle(folderId)}
                                      onContextMenu={(e) =>
                                        handleContextMenu(
                                          e,
                                          db,
                                          "",
                                          group.key,
                                          "FOLDER",
                                        )
                                      }
                                    >
                                      <i
                                        class={`fa-solid ${isOpen() ? "fa-folder-open" : "fa-folder"} flex-shrink-0 text-warning w-4 text-center text-s`}
                                      />
                                      <span class="truncate flex-1 min-w-0">
                                        {group.label} ({group.items.length})
                                      </span>
                                      <Chevron expanded={isOpen()} />
                                    </div>
                                    <Show when={isOpen()}>
                                      <div class="accordion-content expanded">
                                        <div class="accordion-inner">
                                          <div class="explorer-filter-nested mb-1 h-7 flex-shrink-0">
                                            <FilterInput
                                              placeholder={`Filter ${group.label.toLowerCase()}...`}
                                              value={
                                                folderFilters()[folderId] || ""
                                              }
                                              onChange={(v) =>
                                                updateFilter(folderId, v)
                                              }
                                              focusOnMount
                                            />
                                          </div>
                                          <For each={filtered()}>
                                            {(o) => (
                                              <div
                                                class={`tree-node cursor-pointer ${contextMenu()?.visible && contextMenu()!.database === db && contextMenu()!.schema === o.schema_name && contextMenu()!.table === o.name ? "bg-surface-active" : ""}`}
                                                style={{ "--depth": "2" }}
                                                onDblClick={
                                                  canDblClick
                                                    ? () =>
                                                      handleTableDoubleClick(
                                                        db,
                                                        o.schema_name,
                                                        o.name,
                                                      )
                                                    : undefined
                                                }
                                                onContextMenu={(e) =>
                                                  handleContextMenu(
                                                    e,
                                                    db,
                                                    o.schema_name,
                                                    o.name,
                                                    group.objectType,
                                                  )
                                                }
                                              >
                                                <ObjectIcon
                                                  type={group.iconName}
                                                />
                                                <span class="truncate flex-1 min-w-0">
                                                  {o.schema_name}.{o.name}
                                                </span>
                                              </div>
                                            )}
                                          </For>
                                        </div>
                                      </div>
                                    </Show>
                                  </div>
                                );
                              }}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                  );
                }}
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
            "flex-grow":
              expanded().has("root:queries") &&
                !expanded().has("root:databases")
                ? 1
                : 0,
            "flex-basis": !expanded().has("root:queries")
              ? "36px"
              : expanded().has("root:databases")
                ? `${sectionHeights().saved}px`
                : "0%",
            "flex-shrink": 0,
            "min-height": expanded().has("root:queries")
              ? `${MIN_SECTION_HEIGHT}px`
              : "36px",
          }}
        >
          <SectionHeader
            title="Queries"
            expanded={expanded().has("root:queries")}
            onToggle={() => toggle("root:queries")}
            onContextMenu={(e) =>
              openSectionHeaderContextMenu("root:queries", e)
            }
            actions={
              props.onOpenSavedQueriesFolder && (
                <Tooltip content="Open folder" placement="top">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onOpenSavedQueriesFolder!();
                    }}
                    class="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text transition-colors cursor-pointer"
                  >
                    <i class="fa-regular fa-folder-open text-[12px]" />
                  </button>
                </Tooltip>
              )
            }
          />

          <div
            class="flex-1 flex flex-col min-h-0 px-2 transition-opacity duration-300"
            style={{
              opacity: expanded().has("root:queries") ? 1 : 0,
              "pointer-events": expanded().has("root:queries")
                ? "auto"
                : "none",
            }}
          >
            <div class="h-full flex flex-col">
              {(props.savedQueries ?? []).length > 0 && (
                <div class="mb-1 h-7 flex-shrink-0">
                  <FilterInput
                    placeholder="Filter queries..."
                    value={folderFilters()["root:queries"] || ""}
                    onChange={(v) => updateFilter("root:queries", v)}
                  />
                </div>
              )}
              <div
                class={`flex-1 overflow-x-hidden pb-2 ${(props.savedQueries ?? []).length > 0 ? "overflow-y-auto scrollbar-gutter-stable" : "overflow-y-hidden"}`}
              >
                {(props.savedQueries ?? []).length === 0 ? (
                  <div class="flex flex-col items-center justify-center text-text-muted py-8 select-none">
                    <i class="fa-solid fa-file-code text-3xl mb-3" />
                    <p class="text-[12px]">No queries</p>
                  </div>
                ) : (
                  <For each={filteredSavedQueries()}>
                    {(item) => (
                      <Tooltip content={item.title} placement="right">
                        <div
                          class={`${LIST_ROW} ${contextMenu()?.visible && contextMenu()!.sql === item.id ? "bg-white/10" : "hover:bg-surface-hover"}`}
                          onClick={() =>
                            props.onLoadSavedQuery?.(item.filePath, item.title)
                          }
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              "",
                              "",
                              item.title,
                              "SAVED_QUERY",
                              item.id,
                              item.filePath,
                            )
                          }
                        >
                          <div class="flex items-center justify-between text-s">
                            <span class="truncate flex-1 min-w-0">
                              {item.title}
                            </span>
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
            "flex-grow":
              expanded().has("root:history") &&
                !expanded().has("root:databases")
                ? 1
                : 0,
            "flex-basis": !expanded().has("root:history")
              ? "36px"
              : expanded().has("root:databases")
                ? `${sectionHeights().history}px`
                : "0%",
            "flex-shrink": 0,
            "min-height": expanded().has("root:history")
              ? `${MIN_SECTION_HEIGHT}px`
              : "36px",
          }}
        >
          <SectionHeader
            title="History"
            expanded={expanded().has("root:history")}
            onToggle={() => toggle("root:history")}
            onContextMenu={(e) =>
              openSectionHeaderContextMenu("root:history", e)
            }
            actions={
              props.onClearHistory &&
              (props.executedQueries ?? []).length > 0 && (
                <Tooltip content="Clear all" placement="top">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      confirmClearHistory();
                    }}
                    class="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-error transition-colors cursor-pointer"
                  >
                    <i class="fa-solid fa-trash-can text-s" />
                  </button>
                </Tooltip>
              )
            }
          />

          <div
            class="flex-1 flex flex-col min-h-0 px-2 transition-opacity duration-300"
            style={{
              opacity: expanded().has("root:history") ? 1 : 0,
              "pointer-events": expanded().has("root:history")
                ? "auto"
                : "none",
            }}
          >
            <div class="h-full flex flex-col">
              {(props.executedQueries ?? []).length > 0 && (
                <div class="mb-1 h-7 flex-shrink-0">
                  <FilterInput
                    placeholder="Filter history..."
                    value={folderFilters()["root:history"] || ""}
                    onChange={(v) => updateFilter("root:history", v)}
                  />
                </div>
              )}
              <div
                class={`flex-1 overflow-x-hidden pb-2 ${(props.executedQueries ?? []).length > 0 ? "overflow-y-auto scrollbar-gutter-stable" : "overflow-y-hidden"}`}
              >
                {(props.executedQueries ?? []).length === 0 ? (
                  <div class="flex flex-col items-center justify-center text-text-muted py-8 select-none">
                    <i class="fa-solid fa-clock-rotate-left text-m mb-3" />
                    <p class="text-s">No history yet</p>
                  </div>
                ) : (
                  <For each={filteredHistory()}>
                    {(item) => (
                      <Tooltip content={item.sql} placement="right">
                        <div
                          class={`${LIST_ROW} ${contextMenu()?.visible && contextMenu()!.sql === item.sql && contextMenu()!.objectType === "HISTORY" ? "bg-white/10" : "hover:bg-surface-hover"}`}
                          onClick={() =>
                            props.onSelect(
                              item.sql,
                              false,
                              item.title,
                              item.database,
                              `history:${item.sql}`,
                            )
                          }
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              item.database,
                              "",
                              item.title,
                              "HISTORY",
                              item.sql,
                            )
                          }
                        >
                          <div class="flex items-center justify-between text-s">
                            <span class="truncate flex-1 min-w-0">
                              {item.title}
                            </span>
                          </div>
                          <div class="flex items-center justify-between mt-1 text-icon opacity-50">
                            <span class="truncate max-w-[150px]">
                              {item.database}
                            </span>
                            <span class="flex-shrink-0 ml-2">
                              {formatTimeAgo(item.executedAt)}
                            </span>
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

      <Show when={contextMenu()?.visible}>
        <ContextMenu
          items={getContextMenuItems()}
          x={contextMenu()!.x}
          y={contextMenu()!.y}
          onClose={() => setContextMenu(null)}
        />
      </Show>

      <Show when={confirm()}>
        <ConfirmDialog
          title={confirm()!.title}
          message={confirm()!.message}
          confirmLabel={confirm()!.confirmLabel}
          variant="danger"
          onConfirm={() => {
            confirm()!.onConfirm();
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      </Show>
    </div>
  );
}
