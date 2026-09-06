import { invoke } from "@tauri-apps/api/core";
import {
  batch,
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { loadRevealCurrentDatabaseInExplorer } from "../../lib/settings";
import type { JSX } from "solid-js";
import type { SavedQuery } from "../../hooks/useSavedQueries";
import type { DatabaseObject, ExecutedQuery } from "../../lib/types";
import { preloadSchemaCatalog } from "../../lib/schema-catalog";
import { isSamePath } from "../../lib/path";
import { loadStoredStringSet } from "../../lib/storage";
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
import { toast } from "../ui/Toaster";

export interface ObjectExplorerHandle {
  refreshDatabaseObjects: (database: string) => Promise<void>;
  refreshDatabasesAndObjects: () => Promise<void>;
}

interface Props {
  onRef?: (handle: ObjectExplorerHandle | null) => void;
  activeSavedQueryFilePath?: string;
  databases: string[];
  onRefreshDatabases?: () => void | Promise<void>;
  onSelect: (
    sql: string,
    execute?: boolean,
    title?: string,
    database?: string,
    sourceId?: string,
    temporary?: boolean,
    savedQueryFilePath?: string,
  ) => void;
  onDatabaseChange: (db: string) => void;
  currentDatabase?: string;
  executedQueries?: ExecutedQuery[];
  onDeleteHistory: (sql: string) => void;
  onClearHistory?: () => void;
  savedQueries?: SavedQuery[];
  onDeleteSavedQuery?: (id: string) => void;
  onRenameSavedQuery?: (id: string, title: string) => Promise<boolean> | boolean;
  onLoadSavedQuery?: (
    filePath: string,
    title: string,
    temporary?: boolean,
  ) => void;
  onGenerateAiTitleSavedQuery?: (
    id: string,
    filePath: string,
  ) => Promise<void> | void;
  onOpenGroup?: (
    items: {
      sql?: string;
      title?: string;
      database?: string;
      sourceId?: string;
      savedQueryFilePath?: string;
      schema?: string;
      name?: string;
    }[],
    groupName?: string,
  ) => void | Promise<void>;
  onSaveSavedQueryToFile?: (filePath: string, title: string) => void;
  onOpenSavedQueriesFolder?: () => void;
  onShowProperties?: (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType | "DATABASE",
  ) => void;
  onShowCompareData?: (
    database: string,
    schema: string,
    name: string,
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
type RootSectionObjectType = (typeof ROOT_SECTION_OBJECT_TYPE)[RootSectionId];
const SECTION_HEADER_HEIGHT = 35;
const SECTION_GAP = 6;
const SECTION_RESIZER_SIZE = 8;
const MIN_SECTION_HEIGHT = 128;
const DEFAULT_SECTION_HEIGHTS: ExplorerSectionHeights = {
  saved: 160,
  history: 180,
};

function clampSectionHeight(value: number): number {
  return Math.max(MIN_SECTION_HEIGHT, Math.round(value));
}

function fillSectionId(expandedSet: Set<string>): RootSectionId | null {
  for (const id of ROOT_SECTIONS) {
    if (expandedSet.has(id)) return id;
  }
  return null;
}

function resizerCount(expandedSet: Set<string>): number {
  let n = 0;
  if (expandedSet.has("root:databases") && expandedSet.has("root:queries")) {
    n += 1;
  }
  if (
    expandedSet.has("root:history") &&
    (expandedSet.has("root:databases") || expandedSet.has("root:queries"))
  ) {
    n += 1;
  }
  return n;
}

function adjacentGaps(expandedSet: Set<string>): number {
  return Math.max(0, 2 - resizerCount(expandedSet)) * SECTION_GAP;
}

function sectionChromeHeight(expandedSet: Set<string>): number {
  let height = adjacentGaps(expandedSet);
  for (const id of ROOT_SECTIONS) {
    if (!expandedSet.has(id)) height += SECTION_HEADER_HEIGHT;
  }
  height += resizerCount(expandedSet) * SECTION_RESIZER_SIZE;
  return height;
}
function sizedKeys(
  expandedSet: Set<string>,
  fill: RootSectionId | null,
): ResizableSection[] {
  const keys: ResizableSection[] = [];
  if (expandedSet.has("root:queries") && fill !== "root:queries") {
    keys.push("saved");
  }
  if (expandedSet.has("root:history") && fill !== "root:history") {
    keys.push("history");
  }
  return keys;
}

function fillSectionHeight(
  heights: ExplorerSectionHeights,
  expandedSet: Set<string>,
  contentHeight: number,
): number {
  const fill = fillSectionId(expandedSet);
  if (!fill || contentHeight <= 0) return 0;
  const fitted = fitSectionHeights(heights, expandedSet, contentHeight);
  let leftover = Math.floor(contentHeight) - sectionChromeHeight(expandedSet);
  if (expandedSet.has("root:queries") && fill !== "root:queries") {
    leftover -= fitted.saved;
  }
  if (expandedSet.has("root:history") && fill !== "root:history") {
    leftover -= fitted.history;
  }
  return Math.max(0, leftover);
}

function fitSectionHeights(
  heights: ExplorerSectionHeights,
  expandedSet: Set<string>,
  contentHeight: number,
): ExplorerSectionHeights {
  const fill = fillSectionId(expandedSet);
  const keys = sizedKeys(expandedSet, fill);
  if (keys.length === 0 || contentHeight <= 0) return heights;

  let budget = contentHeight - sectionChromeHeight(expandedSet);
  if (fill) budget -= MIN_SECTION_HEIGHT;

  const requested = keys.reduce((sum, key) => sum + heights[key], 0);
  if (requested <= budget) {
    return {
      saved: keys.includes("saved")
        ? Math.max(MIN_SECTION_HEIGHT, heights.saved)
        : heights.saved,
      history: keys.includes("history")
        ? Math.max(MIN_SECTION_HEIGHT, heights.history)
        : heights.history,
    };
  }

  const scale = Math.max(budget, 0) / Math.max(requested, 1);
  const next: ExplorerSectionHeights = { ...heights };
  for (const key of keys) {
    next[key] = Math.max(48, Math.round(heights[key] * scale));
  }
  return next;
}

function maxSizedHeight(
  section: ResizableSection,
  heights: ExplorerSectionHeights,
  expandedSet: Set<string>,
  contentHeight: number,
): number {
  if (contentHeight <= 0) return 800;
  const fill = fillSectionId(expandedSet);
  let budget = contentHeight - sectionChromeHeight(expandedSet);
  if (fill) budget -= MIN_SECTION_HEIGHT;
  const other: ResizableSection = section === "saved" ? "history" : "saved";
  const otherId = other === "saved" ? "root:queries" : "root:history";
  if (expandedSet.has(otherId) && fill !== otherId) {
    budget -= heights[other];
  }
  return Math.max(MIN_SECTION_HEIGHT, budget);
}

function initExpandedSections(): Set<string> {
  const collapsed = loadStoredStringSet(EXPLORER_COLLAPSED_KEY, new Set<string>());
  const expanded = new Set<string>();
  for (const s of ROOT_SECTIONS) {
    if (!collapsed.has(s)) expanded.add(s);
  }
  return expanded;
}

const ICON_WRAP = "object-icon-wrap";
const LIST_ROW = "explorer-list-row group";

function Chevron(props: { expanded: boolean }) {
  return (
    <span
      class={`explorer-chevron ${props.expanded ? "is-open" : ""}`}
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
    <div class={`explorer-filter-wrap ${props.value ? "has-value" : ""}`}>
      <i
        class="fa-solid fa-magnifying-glass explorer-filter-icon"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="text"
        name="explorer-filter"
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        value={props.value}
        onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
        onClick={(e) => e.stopPropagation()}
        class="explorer-filter w-full h-full"
      />
      <button
        type="button"
        class="explorer-filter-clear"
        aria-label="Clear filter"
        tabIndex={props.value ? 0 : -1}
        onClick={(e) => {
          e.stopPropagation();
          props.onChange("");
          inputRef?.focus();
        }}
      >
        <i class="fa-solid fa-xmark" aria-hidden="true" />
      </button>
    </div>
  );
}

function SectionAction(props: {
  tooltip: string;
  class?: string;
  onClick: (e: MouseEvent) => void;
  children: JSX.Element;
}) {
  const [hot, setHot] = createSignal(false);
  return (
    <Tooltip content={props.tooltip} placement="top">
      <button
        type="button"
        class={`explorer-section-action ${props.class ?? ""} ${hot() ? "is-hot" : ""}`}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={(e) => {
          setHot(false);
          (e.currentTarget as HTMLButtonElement).blur();
        }}
        onPointerCancel={() => setHot(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          props.onClick(e);
          if (e.detail !== 0) {
            (e.currentTarget as HTMLButtonElement).blur();
          }
        }}
      >
        {props.children}
      </button>
    </Tooltip>
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
      class="explorer-section-header group"
      aria-expanded={props.expanded}
      tabIndex={0}
      onClick={props.onToggle}
      onContextMenu={props.onContextMenu}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onToggle();
        }
      }}
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

function ExplorerEmpty(props: { message: string }) {
  return <div class="explorer-empty">{props.message}</div>;
}

const ACCORDION_MS = 220;
const ACCORDION_ANIMATE_LIMIT = 80;

function AccordionPane(props: {
  open: boolean;
  itemCount?: () => number;
  children: JSX.Element;
}) {
  const [mounted, setMounted] = createSignal(props.open);
  const [shown, setShown] = createSignal(props.open);
  const [animating, setAnimating] = createSignal(false);
  let closeTimer: number | undefined;
  let openFrame = 0;
  let primed = false;

  function clearTimers() {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    if (openFrame) {
      cancelAnimationFrame(openFrame);
      openFrame = 0;
    }
  }

  createEffect((prevOpen?: boolean) => {
    const open = props.open;
    if (!primed) {
      primed = true;
      return open;
    }
    if (prevOpen === open) return open;

    clearTimers();
    const animate =
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
      untrack(() => props.itemCount?.() ?? 0) <= ACCORDION_ANIMATE_LIMIT;

    if (open) {
      setMounted(true);
      if (!animate) {
        setShown(true);
        setAnimating(false);
        return open;
      }
      setShown(false);
      setAnimating(true);
      openFrame = requestAnimationFrame(() => {
        openFrame = requestAnimationFrame(() => {
          setShown(true);
          openFrame = 0;
          closeTimer = window.setTimeout(() => {
            setAnimating(false);
            closeTimer = undefined;
          }, ACCORDION_MS);
        });
      });
      return open;
    }

    if (!animate) {
      setShown(false);
      setMounted(false);
      setAnimating(false);
      return open;
    }

    setAnimating(true);
    setShown(false);
    closeTimer = window.setTimeout(() => {
      setMounted(false);
      setAnimating(false);
      closeTimer = undefined;
    }, ACCORDION_MS);
    return open;
  });

  onCleanup(clearTimers);

  return (
    <div
      class={`accordion-content${shown() ? " expanded" : ""}${animating() ? " is-animating" : ""}`}
    >
      <div class="accordion-inner">
        <Show when={mounted()}>{props.children}</Show>
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

function objectKey(object: DatabaseObject): string {
  return `${object.object_type}\0${object.schema_name}\0${object.name}`;
}

function objectsEqual(a: DatabaseObject[], b: DatabaseObject[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].name !== b[i].name ||
      a[i].schema_name !== b[i].schema_name ||
      a[i].object_type !== b[i].object_type
    ) {
      return false;
    }
  }
  return true;
}

const INTERNED_OBJECTS = new Map<string, DatabaseObject[]>();
const GROUPED_OBJECTS = new WeakMap<DatabaseObject[], ObjectGroup[]>();
const EMPTY_OBJECT_GROUPS: ObjectGroup[] = [];

function internObjects(
  database: string,
  incoming: DatabaseObject[],
): DatabaseObject[] {
  const prev = INTERNED_OBJECTS.get(database);
  if (prev && objectsEqual(prev, incoming)) return prev;
  if (!prev) {
    INTERNED_OBJECTS.set(database, incoming);
    return incoming;
  }
  const prevByKey = new Map(prev.map((object) => [objectKey(object), object]));
  const next = incoming.map(
    (object) => prevByKey.get(objectKey(object)) ?? object,
  );
  INTERNED_OBJECTS.set(database, next);
  return next;
}

function groupsForDatabase(
  objects: DatabaseObject[] | undefined,
): ObjectGroup[] {
  if (!objects) return EMPTY_OBJECT_GROUPS;
  const cached = GROUPED_OBJECTS.get(objects);
  if (cached) return cached;
  const groups = groupDatabaseObjects(objects);
  GROUPED_OBJECTS.set(objects, groups);
  return groups;
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
          <IconProcedure class="object-icon-procedure w-3.5 h-3.5" />
        </div>
      );
    case "function":
      return (
        <div class={ICON_WRAP}>
          <IconFunction class="object-icon-function w-3.5 h-3.5" />
        </div>
      );
    case "trigger":
      return (
        <div class={ICON_WRAP}>
          <IconTrigger class="object-icon-trigger w-3.5 h-3.5" />
        </div>
      );
    case "type":
      return (
        <div class={ICON_WRAP}>
          <IconType class="object-icon-type w-3.5 h-3.5" />
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

function ObjectRow(props: {
  schema: string;
  name: string;
  iconName: string;
  canDblClick: boolean;
  isMenuActive: boolean;
  isSelected?: boolean;
  onClick?: (e: MouseEvent) => void;
  onDblClick?: () => void;
  onContextMenu: (e: MouseEvent) => void;
}) {
  return (
    <div
      class={`tree-node ${props.isMenuActive ? "is-active" : ""} ${props.isSelected ? "is-selected" : ""}`}
      style={{ "--depth": "2" }}
      onClick={props.onClick}
      onDblClick={props.canDblClick ? props.onDblClick : undefined}
      onContextMenu={props.onContextMenu}
    >
      <ObjectIcon type={props.iconName} />
      <span class="truncate flex-1 min-w-0">
        {props.schema}.{props.name}
      </span>
    </div>
  );
}

function ObjectGroupFolder(props: {
  database: string;
  group: ObjectGroup;
  isExpanded: (id: string) => boolean;
  isMenuActive: (key: string) => boolean;
  filterValue: () => string;
  onToggle: () => void;
  onFilter: (value: string) => void;
  onFolderContextMenu: (e: MouseEvent) => void;
  onObjectContextMenu: (e: MouseEvent, object: DatabaseObject) => void;
  onObjectClick?: (
    e: MouseEvent,
    object: DatabaseObject,
    objectType: ObjectGroup["objectType"],
  ) => void;
  isObjectSelected?: (object: DatabaseObject) => boolean;
  onTableDblClick: (schema: string, name: string) => void;
}) {
  const folderId = `${props.database}:${props.group.key}`;
  const indexedItems = createMemo(() =>
    props.group.items.map((item) => ({
      item,
      hay: `${item.schema_name}.${item.name}`.toLowerCase(),
    })),
  );
  const filtered = createMemo(() => {
    const f = props.filterValue().toLowerCase();
    if (!f) return props.group.items;
    return indexedItems()
      .filter((entry) => entry.hay.includes(f))
      .map((entry) => entry.item);
  });
  const canDblClick =
    props.group.objectType === "TABLE" || props.group.objectType === "VIEW";
  const isOpen = () => props.isExpanded(folderId);

  return (
    <div>
      <div
        class={`tree-node ${props.isMenuActive(`folder:${props.database}:${props.group.key}`) ? "is-active" : ""}`}
        style={{ "--depth": "1" }}
        onClick={props.onToggle}
        onContextMenu={props.onFolderContextMenu}
      >
        <i
          class={`fa-solid ${isOpen() ? "fa-folder-open" : "fa-folder"} flex-shrink-0 text-warning w-4 text-center text-s`}
        />
        <span class="truncate flex-1 min-w-0">{props.group.label}</span>
        <span class="explorer-badge">{props.group.items.length}</span>
        <Chevron expanded={isOpen()} />
      </div>
      <AccordionPane open={isOpen()} itemCount={() => filtered().length}>
        <div class="explorer-filter-nested mb-1 h-7 flex-shrink-0">
          <FilterInput
            placeholder={`Filter ${props.group.label.toLowerCase()}…`}
            value={props.filterValue()}
            onChange={props.onFilter}
          />
        </div>
        <For each={filtered()}>
          {(object) => (
            <ObjectRow
              schema={object.schema_name}
              name={object.name}
              iconName={props.group.iconName}
              canDblClick={canDblClick}
              isMenuActive={props.isMenuActive(
                `obj:${props.database}:${object.schema_name}:${object.name}`,
              )}
              isSelected={props.isObjectSelected?.(object)}
              onClick={(e) =>
                props.onObjectClick?.(e, object, props.group.objectType)
              }
              onDblClick={() =>
                props.onTableDblClick(object.schema_name, object.name)
              }
              onContextMenu={(e) => props.onObjectContextMenu(e, object)}
            />
          )}
        </For>
      </AccordionPane>
    </div>
  );
}

function DatabaseNode(props: {
  db: string;
  isExpanded: (id: string) => boolean;
  isCurrent: () => boolean;
  isLoading: () => boolean;
  isMenuActive: (key: string) => boolean;
  objects: () => DatabaseObject[] | undefined;
  error: () => string | undefined;
  onToggle: () => void;
  onDatabaseChange: () => void;
  onContextMenu: (e: MouseEvent) => void;
  onRetry: () => void;
  onRowRef: (el: HTMLDivElement) => void;
  onRowCleanup: () => void;
  filterValue: (folderId: string) => string;
  onFilter: (folderId: string, value: string) => void;
  onFolderContextMenu: (e: MouseEvent, groupKey: string) => void;
  onObjectContextMenu: (
    e: MouseEvent,
    object: DatabaseObject,
    objectType: ObjectGroup["objectType"],
  ) => void;
  onObjectClick?: (
    e: MouseEvent,
    object: DatabaseObject,
    objectType: ObjectGroup["objectType"],
  ) => void;
  isObjectSelected?: (database: string, object: DatabaseObject) => boolean;
  onTableDblClick: (schema: string, name: string) => void;
  onFolderToggle: (folderId: string) => void;
}) {
  onCleanup(() => props.onRowCleanup());
  const groups = createMemo(() => groupsForDatabase(props.objects()));
  const itemCount = createMemo(() => {
    const list = groups();
    let n = list.length;
    for (const group of list) {
      if (props.isExpanded(`${props.db}:${group.key}`)) {
        n += group.items.length;
      }
    }
    return n;
  });
  const isOpen = () => props.isExpanded(props.db);

  return (
    <div class="flex flex-col" ref={props.onRowRef}>
      <div
        class={`tree-node ${props.isCurrent() ? "is-current" : ""} ${props.isMenuActive(`db:${props.db}`) ? "is-active" : ""}`}
        style={{ "--depth": "0" }}
        onClick={props.onToggle}
        onDblClick={props.onDatabaseChange}
        onContextMenu={props.onContextMenu}
      >
        <ObjectIcon type="database" />
        <span class="truncate flex-1 min-w-0">{props.db}</span>
        <i
          class={`fa-solid fa-circle-notch explorer-node-spinner ${props.isLoading() ? "fa-spin" : ""}`}
          style={{
            visibility: props.isLoading() ? "visible" : "hidden",
          }}
          aria-hidden="true"
        />
        <Chevron expanded={isOpen()} />
      </div>
      <AccordionPane open={isOpen()} itemCount={itemCount}>
        <Show
          when={props.objects() != null}
          fallback={
            <Show
              when={props.error()}
              fallback={
                <div class="tree-node" style={{ "--depth": "1" }}>
                  <i
                    class="fa-solid fa-circle-notch fa-spin explorer-node-spinner"
                    aria-hidden="true"
                  />
                  <span class="truncate flex-1 min-w-0 text-text-muted">
                    Loading objects…
                  </span>
                </div>
              }
            >
              {(errMsg) => (
                <div class="tree-node" style={{ "--depth": "1" }}>
                  <span
                    class="truncate flex-1 min-w-0 text-error italic"
                    title={errMsg()}
                  >
                    Failed to load objects
                  </span>
                  <button
                    type="button"
                    class="text-text-muted hover:text-text transition-colors flex-shrink-0"
                    title="Retry loading objects"
                    aria-label="Retry loading objects"
                    onClick={() => props.onRetry()}
                  >
                    <i class="fa-solid fa-rotate-right" />
                  </button>
                </div>
              )}
            </Show>
          }
        >
          <For each={groups()}>
            {(group) => (
              <ObjectGroupFolder
                database={props.db}
                group={group}
                isExpanded={props.isExpanded}
                isMenuActive={props.isMenuActive}
                filterValue={() =>
                  props.filterValue(`${props.db}:${group.key}`)
                }
                onToggle={() =>
                  props.onFolderToggle(`${props.db}:${group.key}`)
                }
                onFilter={(value) =>
                  props.onFilter(`${props.db}:${group.key}`, value)
                }
                onFolderContextMenu={(e) =>
                  props.onFolderContextMenu(e, group.key)
                }
                onObjectContextMenu={(e, object) =>
                  props.onObjectContextMenu(e, object, group.objectType)
                }
                onObjectClick={props.onObjectClick}
                isObjectSelected={(object) =>
                  props.isObjectSelected?.(props.db, object) ?? false
                }
                onTableDblClick={props.onTableDblClick}
              />
            )}
          </For>
        </Show>
      </AccordionPane>
    </div>
  );
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
  onMount(() => {
    props.onRef?.({
      refreshDatabaseObjects,
      refreshDatabasesAndObjects,
    });
  });
  onCleanup(() => {
    props.onRef?.(null);
  });

  const [expanded, setExpanded] = createSignal<Set<string>>(
    initExpandedSections(),
  );
  const isExpanded = createSelector(
    expanded,
    (id: string, set: Set<string>) => set.has(id),
  );
  const isCurrentDb = createSelector(() => props.currentDatabase);
  const [tableCache, setTableCache] = createStore<
    Record<string, DatabaseObject[]>
  >({});
  const [loading, setLoading] = createSignal<Set<string>>(new Set());
  const isLoadingDb = createSelector(
    loading,
    (id: string, set: Set<string>) => set.has(id),
  );
  const [loadErrors, setLoadErrors] = createStore<Record<string, string>>(
    {},
  );
  const [folderFilters, setFolderFilters] = createStore<Record<string, string>>(
    {},
  );
  const [sectionHeights, setSectionHeights] =
    createSignal<ExplorerSectionHeights>(loadSectionHeights());
  const [activeResizer, setActiveResizer] =
    createSignal<ResizableSection | null>(null);
  const [containerHeight, setContainerHeight] = createSignal(0);
  let containerRef: HTMLDivElement | undefined;
  let databasesScrollRef: HTMLDivElement | undefined;
  const dbNodeRefs = new Map<string, HTMLDivElement>();
  let revealScrollToken = 0;
  let queriesScrollRef: HTMLDivElement | undefined;
  const savedQueryNodeRefs = new Map<string, HTMLDivElement>();
  let savedQueryScrollToken = 0;

  const [confirm, setConfirm] = createSignal<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [renamingQueryId, setRenamingQueryId] = createSignal<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = createSignal("");
  let renameInputRef: HTMLInputElement | undefined;
  let renameCommitInFlight = false;

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

  const menuKey = createMemo(() => {
    const ctx = contextMenu();
    if (!ctx?.visible) return "";
    switch (ctx.objectType) {
      case "DATABASE":
        return `db:${ctx.database}`;
      case "FOLDER":
        return `folder:${ctx.database}:${ctx.table}`;
      case "HISTORY":
        return `history:${ctx.sql}`;
      case "SAVED_QUERY":
        return `saved:${ctx.sql}`;
      default:
        return `obj:${ctx.database}:${ctx.schema}:${ctx.table}`;
    }
  });
  const isMenuActive = createSelector(menuKey);

  type ExplorerSelectionEntry = {
    key: string;
    sql?: string;
    title?: string;
    database?: string;
    sourceId?: string;
    savedQueryFilePath?: string;
    schema?: string;
    name?: string;
  };

  const [explorerSelection, setExplorerSelection] = createStore<
    Record<string, ExplorerSelectionEntry>
  >({});
  const [selectionAnchorKey, setSelectionAnchorKey] = createSignal<string | null>(
    null,
  );

  const explorerSelectionCount = () => Object.keys(explorerSelection).length;

  function isExplorerSelected(key: string) {
    return key in explorerSelection;
  }

  function clearExplorerSelection() {
    setExplorerSelection(reconcile({}));
    setSelectionAnchorKey(null);
  }

  function toggleExplorerSelection(entry: ExplorerSelectionEntry) {
    setExplorerSelection(
      produce((draft) => {
        if (draft[entry.key]) {
          delete draft[entry.key];
        } else {
          draft[entry.key] = entry;
        }
      }),
    );
    setSelectionAnchorKey(entry.key);
  }

  function setExplorerRangeSelection(
    entries: ExplorerSelectionEntry[],
    anchorKey: string | null,
    targetKey: string,
  ) {
    const anchorIndex = anchorKey
      ? entries.findIndex((entry) => entry.key === anchorKey)
      : -1;
    const targetIndex = entries.findIndex((entry) => entry.key === targetKey);
    if (anchorIndex === -1 || targetIndex === -1) {
      toggleExplorerSelection(
        entries.find((entry) => entry.key === targetKey) ?? {
          key: targetKey,
        },
      );
      return;
    }
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const next: Record<string, ExplorerSelectionEntry> = {};
    for (let index = start; index <= end; index += 1) {
      next[entries[index].key] = entries[index];
    }
    setExplorerSelection(reconcile(next));
    setSelectionAnchorKey(targetKey);
  }

  function handleExplorerSelectableClick(
    e: MouseEvent,
    entry: ExplorerSelectionEntry,
    entries: ExplorerSelectionEntry[],
    defaultAction: () => void,
  ) {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    if (isCtrl) {
      e.preventDefault();
      toggleExplorerSelection(entry);
      return;
    }
    if (isShift) {
      e.preventDefault();
      setExplorerRangeSelection(entries, selectionAnchorKey(), entry.key);
      return;
    }
    setExplorerSelection(reconcile({ [entry.key]: entry }));
    setSelectionAnchorKey(entry.key);
    defaultAction();
  }

  function buildOpenGroupMenuItem(): ContextMenuItem | null {
    const count = explorerSelectionCount();
    if (count < 2 || !props.onOpenGroup) return null;
    return {
      id: "open-as-group",
      label: `Open ${count} as Group`,
      icon: <i class="fa-solid fa-object-group" />,
      onClick: () => {
        void props.onOpenGroup?.(
          Object.values(explorerSelection),
          `Group (${count})`,
        );
        clearExplorerSelection();
      },
    };
  }

  function isObjectSelected(database: string, object: DatabaseObject) {
    return isExplorerSelected(
      `obj:${database}:${object.schema_name}:${object.name}`,
    );
  }

  function handleObjectClick(
    e: MouseEvent,
    database: string,
    object: DatabaseObject,
    objectType: ObjectGroup["objectType"],
  ) {
    if (objectType !== "TABLE" && objectType !== "VIEW") return;
    const entries = groupsForDatabase(tableCache[database]).flatMap((group) => {
      if (group.objectType !== "TABLE" && group.objectType !== "VIEW") {
        return [];
      }
      return group.items.map((item) => ({
        key: `obj:${database}:${item.schema_name}:${item.name}`,
        title: `${item.schema_name}.${item.name}`,
        database,
        schema: item.schema_name,
        name: item.name,
        sourceId: `object:${database}:${item.schema_name}:${item.name}:${group.objectType}`,
      }));
    });
    const entry: ExplorerSelectionEntry = {
      key: `obj:${database}:${object.schema_name}:${object.name}`,
      title: `${object.schema_name}.${object.name}`,
      database,
      schema: object.schema_name,
      name: object.name,
      sourceId: `object:${database}:${object.schema_name}:${object.name}:${objectType}`,
    };
    handleExplorerSelectableClick(e, entry, entries, () => {});
  }

  function updateFilter(folderId: string, value: string) {
    setFolderFilters(folderId, value);
  }

  function persistSectionHeights(next?: ExplorerSectionHeights) {
    try {
      localStorage.setItem(
        EXPLORER_SECTION_HEIGHTS_KEY,
        JSON.stringify(next ?? sectionHeights()),
      );
    } catch (err) {
      void err;
    }
  }

  function persistCollapsedSections(expandedSet: Set<string>) {
    try {
      const collapsed = ROOT_SECTIONS.filter((s) => !expandedSet.has(s));
      localStorage.setItem(EXPLORER_COLLAPSED_KEY, JSON.stringify(collapsed));
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

  function startRenameSavedQuery(id: string, title: string) {
    setRenamingQueryId(id);
    setRenameValue(title);
  }

  function cancelRenameSavedQuery() {
    setRenamingQueryId(null);
    setRenameValue("");
  }

  async function commitRenameSavedQuery() {
    const id = renamingQueryId();
    if (!id || renameCommitInFlight) {
      return;
    }

    const nextTitle = renameValue().trim();
    const current = (props.savedQueries ?? []).find((q) => q.id === id);
    if (!nextTitle || !current || nextTitle === current.title) {
      cancelRenameSavedQuery();
      return;
    }

    renameCommitInFlight = true;
    try {
      const renamed = await props.onRenameSavedQuery?.(id, nextTitle);
      if (renamed === false) {
        queueMicrotask(() => {
          renameInputRef?.focus();
          renameInputRef?.select();
        });
        return;
      }
      cancelRenameSavedQuery();
    } finally {
      renameCommitInFlight = false;
    }
  }

  createEffect(() => {
    if (!renamingQueryId()) {
      return;
    }
    queueMicrotask(() => {
      renameInputRef?.focus();
      renameInputRef?.select();
    });
  });

  const databaseFilterLower = createMemo(() =>
    (folderFilters["root:databases"] || "").toLowerCase(),
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
    (folderFilters["root:queries"] || "").toLowerCase(),
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
    (folderFilters["root:history"] || "").toLowerCase(),
  );
  const filteredHistory = createMemo(() => {
    const f = historyFilterLower();
    const indexed = executedQueriesIndexed();
    if (!f) return indexed.map((e) => e.item);
    return indexed
      .filter((e) => e.sqlLower.includes(f) || e.titleLower.includes(f))
      .map((e) => e.item);
  });

  onMount(() => {
    const el = containerRef;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height ?? 0;
      setContainerHeight(height);
    });
    ro.observe(el);
    onCleanup(() => {
      ro.disconnect();
    });
  });

  const rootExpandedSet = createMemo(
    () => {
      const next = new Set<string>();
      for (const id of ROOT_SECTIONS) {
        if (isExpanded(id)) next.add(id);
      }
      return next;
    },
    undefined,
    {
      equals: (a, b) => {
        for (const id of ROOT_SECTIONS) {
          if (a.has(id) !== b.has(id)) return false;
        }
        return true;
      },
    },
  );

  const displayHeights = createMemo(() =>
    fitSectionHeights(sectionHeights(), rootExpandedSet(), containerHeight()),
  );

  function sectionStyle(id: RootSectionId): JSX.CSSProperties {
    const expandedSet = rootExpandedSet();
    if (!expandedSet.has(id)) {
      return {
        flex: "0 0 auto",
        height: `${SECTION_HEADER_HEIGHT}px`,
        "min-height": `${SECTION_HEADER_HEIGHT}px`,
        "max-height": `${SECTION_HEADER_HEIGHT}px`,
      };
    }
    if (fillSectionId(expandedSet) === id) {
      const px = fillSectionHeight(
        sectionHeights(),
        expandedSet,
        containerHeight(),
      );
      if (px > 0) {
        return {
          flex: "0 0 auto",
          height: `${px}px`,
          "min-height": `${px}px`,
          "max-height": `${px}px`,
          overflow: "hidden",
        };
      }
      return {
        flex: "1 1 0%",
        height: "0px",
        "min-height": "0px",
        overflow: "hidden",
      };
    }
    const heights = displayHeights();
    const px = id === "root:queries" ? heights.saved : heights.history;
    return {
      flex: `0 0 ${px}px`,
      height: `${px}px`,
      "min-height": 0,
      "max-height": `${px}px`,
    };
  }

  function measuredContentHeight(): number {
    if (containerHeight() > 0) return containerHeight();
    const el = containerRef;
    if (!el) return 0;
    const cs = getComputedStyle(el);
    return Math.max(
      0,
      el.clientHeight -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom),
    );
  }

  function startSectionResize(section: ResizableSection, e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const startY = e.clientY;
    const startHeight = displayHeights()[section];
    const maxHeight = maxSizedHeight(
      section,
      displayHeights(),
      rootExpandedSet(),
      measuredContentHeight(),
    );
    setActiveResizer(section);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(
        MIN_SECTION_HEIGHT,
        Math.min(maxHeight, Math.round(startHeight - (ev.clientY - startY))),
      );
      setSectionHeights((prev) =>
        prev[section] === next ? prev : { ...prev, [section]: next },
      );
    };
    const onUp = () => {
      setActiveResizer(null);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      persistSectionHeights();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  function handleSectionResizerDoubleClick(
    section: ResizableSection,
    e: MouseEvent,
  ) {
    e.preventDefault();
    const next = {
      ...sectionHeights(),
      [section]: DEFAULT_SECTION_HEIGHTS[section],
    };
    setSectionHeights(next);
    persistSectionHeights(next);
  }

  async function loadTables(database: string, force?: boolean) {
    if (!force && tableCache[database]) return;
    setLoading((prev) => new Set(prev).add(database));
    try {
      const tables: DatabaseObject[] = await invoke("get_tables", { database });
      batch(() => {
        const interned = internObjects(database, tables);
        if (tableCache[database] !== interned) {
          setTableCache(database, interned);
        }
        preloadSchemaCatalog(database);
        setLoadErrors(
          produce((errors) => {
            delete errors[database];
          }),
        );
      });
    } catch (err) {
      const message = `Failed to load objects from "${database}".`;
      setLoadErrors(database, String(err));
      toast.error(message);
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(database);
        return next;
      });
    }
  }

  async function refreshDatabaseObjects(database: string) {
    await loadTables(database, true);
  }

  async function refreshDatabasesAndObjects() {
    const previousDatabases = props.databases;
    setLoadErrors(reconcile({}));

    try {
      await props.onRefreshDatabases?.();
    } finally {
      const databasesToRefresh =
        props.databases.length > 0 ? props.databases : previousDatabases;
      await Promise.all(
        databasesToRefresh.map((database) => loadTables(database, true)),
      );
    }
  }

  function scrollElementIntoView(
    scroller: HTMLDivElement | undefined,
    node: HTMLDivElement | undefined,
    topOffset = 8,
  ) {
    if (!node || !scroller) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    if (scrollerRect.height === 0 || nodeRect.height === 0) return;

    if (
      nodeRect.top >= scrollerRect.top &&
      nodeRect.bottom <= scrollerRect.bottom
    ) {
      return;
    }

    const nodeTop = nodeRect.top - scrollerRect.top + scroller.scrollTop;
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    let targetScroll = scroller.scrollTop;

    if (nodeRect.top < scrollerRect.top) {
      targetScroll = Math.max(0, nodeTop - topOffset);
    } else if (nodeRect.bottom > scrollerRect.bottom) {
      targetScroll = Math.min(
        maxScroll,
        nodeTop + nodeRect.height - scrollerRect.height + topOffset,
      );
    }

    if (Math.abs(targetScroll - scroller.scrollTop) < 2) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth";
    scroller.scrollTo({ top: targetScroll, behavior });
  }

  function scheduleScroll(run: () => void, waitMs: number) {
    if (waitMs <= 0) {
      requestAnimationFrame(() => requestAnimationFrame(run));
      return;
    }
    window.setTimeout(run, waitMs);
  }

  function queueRevealScroll(db: string, waitMs: number, token: number) {
    scheduleScroll(() => {
      if (token !== revealScrollToken) return;
      if (untrack(() => props.currentDatabase) !== db) return;
      scrollElementIntoView(databasesScrollRef, dbNodeRefs.get(db));
    }, waitMs);
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

        revealScrollToken += 1;
        const token = revealScrollToken;
        const waitMs = needsTransition ? ACCORDION_MS + 50 : 0;
        queueRevealScroll(db, waitMs, token);
        void loadTables(db).then(() => {
          queueRevealScroll(db, 0, token);
        });
      },
    ),
  );

  const activeSavedQuery = createMemo(() => {
    const activePath = props.activeSavedQueryFilePath;
    if (!activePath) return undefined;
    return (props.savedQueries ?? []).find((q) =>
      isSamePath(q.filePath, activePath),
    );
  });

  function queueSavedQueryScroll(id: string, waitMs: number, token: number) {
    scheduleScroll(() => {
      if (token !== savedQueryScrollToken) return;
      if (activeSavedQuery()?.id !== id) return;
      scrollElementIntoView(queriesScrollRef, savedQueryNodeRefs.get(id));
    }, waitMs);
  }

  createEffect(
    on(
      () => [props.activeSavedQueryFilePath, activeSavedQuery()] as const,
      ([activePath, query]) => {
        if (!activePath || !query) return;

        const prevExpanded = expanded();
        const needsTransition = !prevExpanded.has("root:queries");

        batch(() => {
          if (needsTransition) {
            const next = new Set(prevExpanded);
            next.add("root:queries");
            setExpanded(next);
            persistCollapsedSections(next);
          }
          if (folderFilters["root:queries"]) {
            const isVisible = filteredSavedQueries().some(
              (q) => q.id === query.id,
            );
            if (!isVisible) {
              setFolderFilters((f) => ({ ...f, "root:queries": "" }));
            }
          }
        });

        savedQueryScrollToken += 1;
        const token = savedQueryScrollToken;
        const waitMs = needsTransition ? ACCORDION_MS + 50 : 0;
        queueSavedQueryScroll(query.id, waitMs, token);
      },
    ),
  );

  onCleanup(() => {
    revealScrollToken += 1;
    savedQueryScrollToken += 1;
  });

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

  function collapseAllDatabases() {
    const next = new Set<string>();
    for (const id of ROOT_SECTIONS) {
      if (expanded().has(id)) next.add(id);
    }
    setExpanded(next);
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

  function getRootSectionMenu(type: RootSectionObjectType): ContextMenuItem[] {
    switch (type) {
      case "DATABASE_FOLDER":
        return [
          {
            id: "refresh-databases",
            label: "Refresh All",
            icon: <i class="fa-solid fa-rotate" />,
            onClick: () => void refreshDatabasesAndObjects(),
          },
          {
            id: "collapse-databases",
            label: "Collapse All",
            icon: <i class="fa-solid fa-down-left-and-up-right-to-center" />,
            onClick: () => collapseAllDatabases(),
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

    const openGroupItem = buildOpenGroupMenuItem();
    const prependGroup = (items: ContextMenuItem[]) =>
      openGroupItem ? [openGroupItem, { id: "sep-open-group", separator: true }, ...items] : items;

    const { database, schema, table, objectType } = ctx;

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
          onClick: () => void refreshDatabaseObjects(database),
        },
      ];
    }

    if (objectType === "SAVED_QUERY") {
      const queryId = ctx.sql || "";
      const filePath = ctx.savedQueryFilePath || "";
      const title = table;
      return prependGroup([
        {
          id: "open-saved",
          label: "Open",
          icon: <i class="fa-solid fa-folder-open" />,
          onClick: () => props.onLoadSavedQuery?.(filePath, title, false),
        },
        ...(props.onGenerateAiTitleSavedQuery
          ? [
              {
                id: "generate-ai-title-saved",
                label: "Generate title with AI",
                icon: <i class="fa-solid fa-wand-magic-sparkles" />,
                disabled: !props.onRenameSavedQuery,
                onClick: () =>
                  void props.onGenerateAiTitleSavedQuery?.(queryId, filePath),
              },
            ]
          : []),
        {
          id: "save-sql-file",
          label: "Save SQL to file",
          icon: <i class="fa-solid fa-floppy-disk" />,
          disabled: !props.onSaveSavedQueryToFile,
          onClick: () => props.onSaveSavedQueryToFile?.(filePath, title),
        },
        {
          id: "rename-saved",
          label: "Rename",
          icon: <i class="fa-solid fa-i-cursor" />,
          disabled: !props.onRenameSavedQuery,
          onClick: () => startRenameSavedQuery(queryId, title),
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
      ]);
    }

    if (objectType === "HISTORY") {
      const sqlValue = ctx.sql || "";
      const dbName = database;
      return prependGroup([
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
              undefined,
              false,
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
      ]);
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
          onClick: () => void refreshDatabaseObjects(database),
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

    return prependGroup(
      buildObjectExplorerMenuItems({
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
      onShowCompareData: () =>
        props.onShowCompareData?.(database, schema, table),
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
    }),
    );
  }

  return (
    <div class="flex flex-col h-full bg-transparent">
      <div class="app-panel-header">
        <span class="app-section-title">Explorer</span>
      </div>
      <div
        ref={containerRef}
        class={`flex-1 overflow-hidden p-2 text-s flex flex-col explorer-content ${activeResizer() ? "is-resizing" : ""}`}
      >
        <div
          class={`explorer-section ${isExpanded("root:databases") ? "" : "is-collapsed"}`}
          style={sectionStyle("root:databases")}
        >
          <SectionHeader
            title="Databases"
            expanded={isExpanded("root:databases")}
            onToggle={() => toggle("root:databases")}
            onContextMenu={(e) =>
              openSectionHeaderContextMenu("root:databases", e)
            }
            actions={
              <>
                {props.onRefreshDatabases && (
                  <SectionAction
                    tooltip="Refresh"
                    onClick={() => void refreshDatabasesAndObjects()}
                  >
                    <i class="fa-solid fa-rotate text-s" />
                  </SectionAction>
                )}
                <SectionAction
                  tooltip="Collapse all"
                  onClick={() => collapseAllDatabases()}
                >
                  <i class="fa-solid fa-down-left-and-up-right-to-center text-s" />
                </SectionAction>
              </>
            }
          />

          <div class="explorer-section-body">
            <Show
              when={props.databases.length > 0}
              fallback={<ExplorerEmpty message="No databases" />}
            >
              <div class="mb-1 h-7 flex-shrink-0 explorer-pane-filter">
                <FilterInput
                  placeholder="Filter databases…"
                  value={folderFilters["root:databases"] || ""}
                  onChange={(v) => updateFilter("root:databases", v)}
                />
              </div>
              <div class="flex-1 explorer-scroll" ref={databasesScrollRef}>
                <Show
                  when={filteredDatabases().length > 0}
                  fallback={
                    <ExplorerEmpty message="No matching databases" />
                  }
                >
                  <For each={filteredDatabases()}>
                    {(db) => (
                      <DatabaseNode
                        db={db}
                        isExpanded={isExpanded}
                        isCurrent={() => isCurrentDb(db)}
                        isLoading={() => isLoadingDb(db)}
                        isMenuActive={isMenuActive}
                        objects={() => tableCache[db]}
                        error={() => loadErrors[db]}
                        onToggle={() => handleDbClick(db)}
                        onDatabaseChange={() => props.onDatabaseChange(db)}
                        onContextMenu={(e) =>
                          handleContextMenu(e, db, "", "", "DATABASE")
                        }
                        onRetry={() => void loadTables(db, true)}
                        onRowRef={(el) => dbNodeRefs.set(db, el)}
                        onRowCleanup={() => dbNodeRefs.delete(db)}
                        filterValue={(folderId) => folderFilters[folderId] || ""}
                        onFilter={updateFilter}
                        onFolderContextMenu={(e, groupKey) =>
                          handleContextMenu(e, db, "", groupKey, "FOLDER")
                        }
                        onObjectContextMenu={(e, object, objectType) =>
                          handleContextMenu(
                            e,
                            db,
                            object.schema_name,
                            object.name,
                            objectType,
                          )
                        }
                        onTableDblClick={(schema, name) =>
                          handleTableDoubleClick(db, schema, name)
                        }
                        onObjectClick={(e, object, objectType) =>
                          handleObjectClick(e, db, object, objectType)
                        }
                        isObjectSelected={(database, object) =>
                          isObjectSelected(database, object)
                        }
                        onFolderToggle={toggle}
                      />
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>
        </div>

        {isExpanded("root:queries") && isExpanded("root:databases") && (
          <div
            class={`resizer resizer-v ${activeResizer() === "saved" ? "active" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize queries"
            onPointerDown={(e) => startSectionResize("saved", e)}
            onDblClick={(e) => handleSectionResizerDoubleClick("saved", e)}
          />
        )}

        <div
          class={`explorer-section ${isExpanded("root:queries") ? "" : "is-collapsed"}`}
          style={sectionStyle("root:queries")}
        >
          <SectionHeader
            title="Queries"
            expanded={isExpanded("root:queries")}
            onToggle={() => toggle("root:queries")}
            onContextMenu={(e) =>
              openSectionHeaderContextMenu("root:queries", e)
            }
            actions={
              props.onOpenSavedQueriesFolder && (
                <SectionAction
                  tooltip="Open folder"
                  onClick={() => props.onOpenSavedQueriesFolder!()}
                >
                  <i class="fa-regular fa-folder-open text-[12px]" />
                </SectionAction>
              )
            }
          />

          <div class="explorer-section-body">
            <div class="h-full flex flex-col min-h-0">
              {(props.savedQueries ?? []).length > 0 && (
                <div class="mb-1 h-7 flex-shrink-0 explorer-pane-filter">
                  <FilterInput
                    placeholder="Filter queries…"
                    value={folderFilters["root:queries"] || ""}
                    onChange={(v) => updateFilter("root:queries", v)}
                  />
                </div>
              )}
              <div ref={queriesScrollRef} class="flex-1 explorer-scroll">
                {(props.savedQueries ?? []).length === 0 ? (
                  <ExplorerEmpty message="No saved queries" />
                ) : filteredSavedQueries().length === 0 ? (
                  <ExplorerEmpty message="No matching queries" />
                ) : (
                  <For each={filteredSavedQueries()}>
                    {(item) => {
                      const isRenaming = () => renamingQueryId() === item.id;
                      const rowKey = `saved:${item.id}`;
                      const isSelected = () =>
                        isMenuActive(rowKey) ||
                        isRenaming() ||
                        activeSavedQuery()?.id === item.id;
                      const row = (
                        <div
                          ref={(el) => {
                            savedQueryNodeRefs.set(item.id, el);
                            onCleanup(() => savedQueryNodeRefs.delete(item.id));
                          }}
                          data-saved-query-id={item.id}
                          data-saved-query-path={item.filePath}
                          class={`${LIST_ROW} ${
                            isSelected() ? "is-selected" : ""
                          }`}
                          onClick={(e) => {
                            if (isRenaming()) return;
                            if (e.detail > 1) return;
                            clearExplorerSelection();
                            props.onLoadSavedQuery?.(
                              item.filePath,
                              item.title,
                            );
                          }}
                          onDblClick={(e) => {
                            if (isRenaming()) return;
                            e.preventDefault();
                            clearExplorerSelection();
                            props.onLoadSavedQuery?.(
                              item.filePath,
                              item.title,
                              false,
                            );
                          }}
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
                            <Show
                              when={isRenaming()}
                              fallback={
                                <span class="truncate flex-1 min-w-0">
                                  {item.title}
                                </span>
                              }
                            >
                              <input
                                ref={renameInputRef}
                                type="text"
                                name="saved-query-title"
                                autocomplete="off"
                                aria-label="Rename saved query"
                                value={renameValue()}
                                onInput={(e) =>
                                  setRenameValue(e.currentTarget.value)
                                }
                                onBlur={() => void commitRenameSavedQuery()}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void commitRenameSavedQuery();
                                  } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelRenameSavedQuery();
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                class="bg-transparent border-none outline-none text-s w-full min-w-0"
                              />
                            </Show>
                          </div>
                        </div>
                      );

                      return isRenaming() ? (
                        row
                      ) : (
                        <Tooltip
                          content={item.title}
                          placement="right"
                          class="w-full"
                        >
                          {row}
                        </Tooltip>
                      );
                    }}
                  </For>
                )}
              </div>
            </div>
          </div>
        </div>

        {isExpanded("root:history") &&
          (isExpanded("root:queries") ||
            isExpanded("root:databases")) && (
          <div
            class={`resizer resizer-v ${activeResizer() === "history" ? "active" : ""}`}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize history"
            onPointerDown={(e) => startSectionResize("history", e)}
            onDblClick={(e) => handleSectionResizerDoubleClick("history", e)}
          />
        )}

        <div
          class={`explorer-section ${isExpanded("root:history") ? "" : "is-collapsed"}`}
          style={sectionStyle("root:history")}
        >
          <SectionHeader
            title="History"
            expanded={isExpanded("root:history")}
            onToggle={() => toggle("root:history")}
            onContextMenu={(e) =>
              openSectionHeaderContextMenu("root:history", e)
            }
            actions={
              props.onClearHistory &&
              (props.executedQueries ?? []).length > 0 && (
                <SectionAction
                  tooltip="Clear all"
                  class="explorer-section-action-danger"
                  onClick={() => confirmClearHistory()}
                >
                  <i class="fa-solid fa-trash-can text-s" />
                </SectionAction>
              )
            }
          />

          <div class="explorer-section-body">
            <div class="h-full flex flex-col min-h-0">
              {(props.executedQueries ?? []).length > 0 && (
                <div class="mb-1 h-7 flex-shrink-0 explorer-pane-filter">
                  <FilterInput
                    placeholder="Filter history…"
                    value={folderFilters["root:history"] || ""}
                    onChange={(v) => updateFilter("root:history", v)}
                  />
                </div>
              )}
              <div class="flex-1 explorer-scroll">
                {(props.executedQueries ?? []).length === 0 ? (
                  <ExplorerEmpty message="Queries you run will appear here" />
                ) : filteredHistory().length === 0 ? (
                  <ExplorerEmpty message="No matching history" />
                ) : (
                  <For each={filteredHistory()}>
                    {(item) => {
                      const rowKey = `history:${item.sql}`;
                      return (
                      <Tooltip content={item.sql} placement="right" class="w-full">
                        <div
                          class={`${LIST_ROW} ${
                            isMenuActive(rowKey)
                              ? "is-selected"
                              : ""
                          }`}
                          onClick={() => {
                            clearExplorerSelection();
                            props.onSelect(
                              item.sql,
                              false,
                              item.title,
                              item.database,
                              undefined,
                              true,
                            );
                          }}
                          onDblClick={(e) => {
                            e.preventDefault();
                          }}
                          onContextMenu={(e) =>
                            handleContextMenu(
                              e,
                              item.database,
                              "",
                              item.title,
                              "HISTORY",
                              item.sql,
                              item.savedQueryFilePath,
                            )
                          }
                        >
                          <div class="flex items-center justify-between text-s">
                            <span class="truncate flex-1 min-w-0">
                              {item.title}
                            </span>
                          </div>
                          <div class="flex items-center justify-between gap-2 mt-0.5 text-xs text-text-muted">
                            <span class="truncate min-w-0">
                              {item.database}
                            </span>
                            <span class="flex-shrink-0 tabular-nums">
                              {formatTimeAgo(item.executedAt)}
                            </span>
                          </div>
                        </div>
                      </Tooltip>
                      );
                    }}
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
