import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ColumnInfo, DatabaseObject, ExecutedQuery } from "../lib/types";
import type { SavedQuery } from "../hooks/useSavedQueries";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import { IconChevronRight, IconColumn, IconDatabase, IconFunction, IconProcedure, IconTable, IconView } from "./Icons";
import Tooltip from "./Tooltip";

interface Props {
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
const ROOT_SECTIONS = ["root:databases", "root:saved_queries", "root:history"] as const;
const MIN_SECTION_HEIGHT = 96;
const MAX_SECTION_HEIGHT = 360;
const DEFAULT_SECTION_HEIGHTS: ExplorerSectionHeights = {
  saved: 150,
  history: 180,
};

function clampSectionHeight(value: number): number {
  return Math.max(MIN_SECTION_HEIGHT, Math.min(MAX_SECTION_HEIGHT, Math.round(value)));
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

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span className={`w-4 h-4 flex items-center justify-center flex-shrink-0 text-text-muted transition-transform ml-auto ${expanded ? "rotate-90" : ""}`}>
      <IconChevronRight className="w-2.5 h-2.5" />
    </span>
  );
}

interface ObjectGroup {
  key: string;
  label: string;
  type: string;
  iconName: string;
  objectType: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION";
  items: DatabaseObject[];
}

const GROUP_DEFS: Omit<ObjectGroup, "items">[] = [
  { key: "tables", label: "Tables", type: "TABLE", iconName: "table", objectType: "TABLE" },
  { key: "views", label: "Views", type: "VIEW", iconName: "view", objectType: "VIEW" },
  { key: "procedures", label: "Stored Procedures", type: "PROCEDURE", iconName: "procedure", objectType: "PROCEDURE" },
  { key: "functions", label: "Functions", type: "FUNCTION", iconName: "function", objectType: "FUNCTION" },
];

function groupDatabaseObjects(objects: DatabaseObject[]): ObjectGroup[] {
  const groups: ObjectGroup[] = GROUP_DEFS.map(d => ({ ...d, items: [] }));
  for (const obj of objects) {
    const group = groups.find(g => g.type === obj.object_type);
    if (group) group.items.push(obj);
  }
  return groups.filter(g => g.items.length > 0);
}

function ObjectIcon({ type }: { type: string }) {
  switch (type) {
    case "database":
      return <div className={ICON_WRAP}><IconDatabase className="text-accent w-3.5 h-3.5" /></div>;
    case "table":
      return <div className={ICON_WRAP}><IconTable className="text-success w-3.5 h-3.5" /></div>;
    case "view":
      return <div className={ICON_WRAP}><IconView className="text-green-400 w-3.5 h-3.5" /></div>;
    case "procedure":
      return <div className={ICON_WRAP}><IconProcedure className="text-purple-400 w-3.5 h-3.5" /></div>;
    case "function":
      return <div className={ICON_WRAP}><IconFunction className="text-orange-400 w-3.5 h-3.5" /></div>;
    case "column":
      return <div className={ICON_WRAP}><IconColumn className="text-text-muted w-3.5 h-3.5" /></div>;
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

export default function ObjectExplorer({
  onSelect,
  onDatabaseChange,
  currentDatabase, 
  executedQueries = [], 
  onDeleteHistory,
  onClearHistory,
  savedQueries = [],
  onDeleteSavedQuery,
  onLoadSavedQuery,
  onOpenSavedQueriesFolder,
}: Props) {
  const [databases, setDatabases] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => initExpandedSections());
  const [tableCache, setTableCache] = useState<Record<string, DatabaseObject[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [folderFilters, setFolderFilters] = useState<Record<string, string>>({});
  const [sectionHeights, setSectionHeights] = useState<ExplorerSectionHeights>(() => loadSectionHeights());
  const [activeResizer, setActiveResizer] = useState<ResizableSection | null>(null);

  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    database: string;
    schema: string;
    table: string;
    sql?: string;
    objectType: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "DATABASE" | "HISTORY" | "DATABASE_FOLDER" | "SAVED_QUERY" | "FOLDER";
    savedQueryFilePath?: string;
  } | null>(null);

  const updateFilter = useCallback((folderId: string, value: string) => {
    setFolderFilters((f) => ({ ...f, [folderId]: value }));
  }, []);

  useEffect(() => {
    loadDatabases();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(EXPLORER_SECTION_HEIGHTS_KEY, JSON.stringify(sectionHeights));
    } catch { }
  }, [sectionHeights]);

  const startSectionResize = useCallback(
    (section: ResizableSection, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const startY = e.clientY;
      const startHeight = sectionHeights[section];
      setActiveResizer(section);

      const onMove = (ev: MouseEvent) => {
        const deltaY = ev.clientY - startY;
        const nextHeight = clampSectionHeight(startHeight - deltaY);
        setSectionHeights((prev) => {
          if (prev[section] === nextHeight) {
            return prev;
          }
          return { ...prev, [section]: nextHeight };
        });
      };

      const onUp = () => {
        setActiveResizer(null);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sectionHeights],
  );

  async function loadDatabases() {
    try {

      const dbs: string[] = await invoke("get_databases");
      setDatabases(dbs);
    } catch (err) {
      console.error("Failed to load databases:", err);
    }
  }

  async function loadTables(database: string, force?: boolean) {
    if (!force && tableCache[database]) return;
    setLoading((prev) => new Set(prev).add(database));
    try {

      const tables: DatabaseObject[] = await invoke("get_tables", { database });
      setTableCache((prev) => ({ ...prev, [database]: tables }));
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

  const toggle = useCallback(
    (nodeId: string) => {
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
    },
    [],
  );

  function handleDbClick(db: string) {
    toggle(db);
    if (!expanded.has(db)) {
      loadTables(db);
    }
  }

  function handleTableDoubleClick(db: string, schema: string, table: string) {
    onSelect(`SELECT TOP 100 * FROM [${db}].[${schema}].[${table}]`);
  }

  function handleContextMenu(
    e: React.MouseEvent,
    db: string = "",
    schema: string = "",
    table: string = "",
    objectType: "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "DATABASE" | "HISTORY" | "DATABASE_FOLDER" | "SAVED_QUERY" | "FOLDER",
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
    if (!contextMenu) return [];

    const { database, schema, table, objectType } = contextMenu;

    if (objectType === "DATABASE_FOLDER") {
      return [
        {
          id: "refresh-all",
          label: "Refresh List",
          icon: <i className="fa-solid fa-rotate" />,
          onClick: () => loadDatabases(),
        },
      ];
    }

    if (objectType === "FOLDER") {
      return [
        {
          id: "refresh-folder",
          label: "Refresh",
          icon: <i className="fa-solid fa-rotate" />,
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
      const queryId = contextMenu.sql || "";
      const filePath = contextMenu.savedQueryFilePath || "";
      const title = table;
      return [
        {
          id: "open-saved",
          label: "Open",
          icon: <i className="fa-solid fa-folder-open" />,
          onClick: () => onLoadSavedQuery?.(filePath, title),
        },
        {
          id: "copy-path",
          label: "Copy Path",
          icon: <i className="fa-solid fa-copy" />,
          onClick: () => navigator.clipboard.writeText(filePath),
        },
        { id: "sep-saved-1", separator: true },
        {
          id: "delete-saved",
          label: "Delete",
          icon: <i className="fa-solid fa-trash-can" />,
          onClick: () => onDeleteSavedQuery?.(queryId),
        },
      ];
    }

    if (objectType === "HISTORY") {
      const sqlValue = contextMenu.sql || "";
      const dbName = database;
      return [
        {
          id: "use-query",
          label: "Open Query",
          icon: <i className="fa-solid fa-folder-open" />,
          onClick: () => onSelect(sqlValue, false, table, dbName, `history:${sqlValue}`),
        },
        {
          id: "copy-query",
          label: "Copy SQL",
          icon: <i className="fa-solid fa-copy" />,
          onClick: () => navigator.clipboard.writeText(sqlValue),
        },
        { id: "sep-hist-1", separator: true },
        {
          id: "delete-history",
          label: "Delete",
          icon: <i className="fa-solid fa-trash-can" />,
          onClick: () => onDeleteHistory(sqlValue),
        },
      ];
    }

    if (objectType === "DATABASE") {
      return [
        {
          id: "use",
          label: "Use Database",
          icon: <i className="fa-solid fa-play" />,
          onClick: () => onDatabaseChange(database),
        },
        {
          id: "new-query",
          label: "New Query",
          icon: <i className="fa-solid fa-file-circle-plus" />,
          onClick: () => {
            onDatabaseChange(database);
            onSelect("");
          },
        },
        { id: "sep-db-1", separator: true },
        {
          id: "refresh",
          label: "Refresh",
          icon: <i className="fa-solid fa-rotate" />,
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

    const fullName = `[${database}].[${schema}].[${table}]`;

    if (objectType === "PROCEDURE") {
      return [
        {
          id: "exec",
          label: "Execute",
          icon: <i className="fa-solid fa-play" />,
          onClick: () => onSelect(`EXEC ${fullName}`, false),
        },
        {
          id: "script-alter",
          label: "Script ALTER",
          icon: <i className="fa-solid fa-pen" />,
          onClick: () => onSelect(`-- Script procedure definition\nEXEC sp_helptext '${schema}.${table}'`, true),
        },
        { id: "sep-proc-1", separator: true },
        {
          id: "copy-name",
          label: "Copy Name",
          icon: <i className="fa-solid fa-copy" />,
          onClick: () => navigator.clipboard.writeText(fullName),
        },
      ];
    }

    if (objectType === "FUNCTION") {
      return [
        {
          id: "script-select",
          label: "Script SELECT",
          icon: <i className="fa-solid fa-file-code" />,
          onClick: () => onSelect(`SELECT ${fullName}()`, false),
        },
        {
          id: "script-alter",
          label: "Script ALTER",
          icon: <i className="fa-solid fa-pen" />,
          onClick: () => onSelect(`-- Script function definition\nEXEC sp_helptext '${schema}.${table}'`, true),
        },
        { id: "sep-fn-1", separator: true },
        {
          id: "copy-name",
          label: "Copy Name",
          icon: <i className="fa-solid fa-copy" />,
          onClick: () => navigator.clipboard.writeText(fullName),
        },
      ];
    }

    return [
      {
        id: "select",
        label: "Select",
        icon: <i className="fa-solid fa-check-double" />,
        children: [
          {
            id: "select-top-100",
            label: "Select Top 100",
            icon: <i className="fa-solid fa-arrow-up-wide-short" />,
            onClick: () => onSelect(`SELECT TOP 100 * FROM ${fullName}`, true),
          },
          {
            id: "select-bottom-100",
            label: "Select Bottom 100",
            icon: <i className="fa-solid fa-arrow-down-wide-short" />,
            onClick: () => onSelect(`SELECT * FROM (\n  SELECT TOP 100 * FROM ${fullName} ORDER BY 1 DESC\n) t ORDER BY 1 ASC`, true),
          },
          {
            id: "select-all",
            label: "Select All Rows",
            icon: <i className="fa-solid fa-table" />,
            onClick: () => onSelect(`SELECT * FROM ${fullName}`, true),
          },
          {
            id: "select-count",
            label: "Count Rows",
            icon: <i className="fa-solid fa-calculator" />,
            onClick: () => onSelect(`SELECT COUNT(*) AS [TotalRows] FROM ${fullName}`, true),
          },
        ],
      },
      {
        id: "script",
        label: "Script",
        icon: <i className="fa-solid fa-code" />,
        children: [
          {
            id: "script-create",
            label: "Create Table",
            icon: <i className="fa-solid fa-plus" />,
            onClick: async () => {
              if (objectType === "VIEW") {
                try {
            
                  const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
                  const colList = cols.map((c) => `\t[${c.name}]`).join(",\n");
                  onSelect(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE VIEW [${schema}].[${table}]\nAS\nSELECT\n${colList}\nFROM [${schema}].[<source_table>]\nGO`);
                } catch {
                  onSelect(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE VIEW [${schema}].[${table}]\nAS\nSELECT\n\t*\nFROM [${schema}].[<source_table>]\nGO`);
                }
              } else {
                try {
            
                  const script: string = await invoke("generate_create_script", { database, schema, table });
                  onSelect(script);
                } catch {
                  onSelect(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE TABLE [${schema}].[${table}](\n\t[Id] [int] IDENTITY(1,1) NOT NULL\n) ON [PRIMARY]\nGO`);
                }
              }
            },
          },
          {
            id: "script-alter",
            label: "Alter Table",
            icon: <i className="fa-solid fa-pen" />,
            onClick: async () => {
              if (objectType === "VIEW") {
                try {
            
                  const def: string = await invoke("get_object_definition", { database, schema, name: table });
                  const altered = def.replace(/\bCREATE\s+(VIEW)\b/i, "ALTER $1");
                  onSelect(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${altered}\nGO`);
                } catch {
                  onSelect(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER VIEW [${schema}].[${table}]\nAS\nSELECT\n\t*\nFROM [${schema}].[<source_table>]\nGO`);
                }
              } else {
                onSelect(`ALTER TABLE ${fullName}\nADD [NewColumn] NVARCHAR(255) NULL\nGO`);
              }
            },
          },
          {
            id: "script-drop",
            label: "Drop Object",
            icon: <i className="fa-solid fa-trash" />,
            onClick: () => {
              const kind = objectType === "VIEW" ? "VIEW" : "TABLE";
              onSelect(
                `IF OBJECT_ID('${fullName}', '${objectType === "VIEW" ? "V" : "U"}') IS NOT NULL\n` +
                `\tDROP ${kind} ${fullName}\nGO`
              );
            },
          },
          {
            id: "script-select",
            label: "Select Rows",
            icon: <i className="fa-solid fa-magnifying-glass" />,
            onClick: async () => {
              try {
          
                const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
                const colList = cols.map((c) => `\t[${c.name}]`).join(",\n");
                onSelect(`SELECT\n${colList}\nFROM ${fullName}`);
              } catch {
                onSelect(`SELECT\n\t*\nFROM ${fullName}`);
              }
            },
          },
          {
            id: "script-insert",
            label: "Insert Values",
            icon: <i className="fa-solid fa-circle-plus" />,
            onClick: async () => {
              try {
          
                const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
                const filtered = cols.filter((c) => !c.is_identity);
                const colNames = filtered.map((c) => `\t[${c.name}]`).join(",\n");
                const values = filtered.map((c) => `\t<${c.name}, ${c.type_name},>`).join(",\n");
                onSelect(`INSERT INTO ${fullName}\n(\n${colNames}\n)\nVALUES\n(\n${values}\n)`);
              } catch {
                onSelect(`INSERT INTO ${fullName}\n(\n\t[column1],\n\t[column2]\n)\nVALUES\n(\n\t<column1, type,>,\n\t<column2, type,>\n)`);
              }
            },
          },
          {
            id: "script-update",
            label: "Update Rows",
            icon: <i className="fa-solid fa-pen-to-square" />,
            onClick: async () => {
              try {
          
                const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
                const filtered = cols.filter((c) => !c.is_identity);
                const setClauses = filtered.map((c) => `\t[${c.name}] = <${c.name}, ${c.type_name},>`).join(",\n");
                onSelect(`UPDATE ${fullName}\nSET\n${setClauses}\nWHERE\n\t<search_condition,,>`);
              } catch {
                onSelect(`UPDATE ${fullName}\nSET\n\t[column1] = <column1, type,>\nWHERE\n\t<search_condition,,>`);
              }
            },
          },
          {
            id: "script-delete",
            label: "Delete Rows",
            icon: <i className="fa-solid fa-xmark" />,
            onClick: async () => {
              try {
          
                const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
                const first = cols[0];
                const hint = first ? `[${first.name}] = <${first.name}, ${first.type_name},>` : `<search_condition,,>`;
                onSelect(`DELETE FROM ${fullName}\nWHERE\n\t${hint}`);
              } catch {
                onSelect(`DELETE FROM ${fullName}\nWHERE\n\t<search_condition,,>`);
              }
            },
          },
        ],
      },
      { id: "sep2", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i className="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex-1 overflow-hidden pt-3 pb-1 px-2.5 text-xs flex flex-col gap-1 explorer-content">
        <div className={`flex flex-col ${expanded.has("root:databases") ? "flex-1 min-h-0" : "flex-none"}`}>
          <div
            className="flex items-center justify-between px-4 py-2.5 mx-0.5 mb-1 flex-shrink-0 cursor-pointer bg-surface-header hover:bg-surface-hover rounded-md text-text transition-colors group"
            onClick={() => toggle("root:databases")}
            onContextMenu={(e) => handleContextMenu(e, "", "", "", "DATABASE_FOLDER")}
          >
            <span className="font-bold text-[11px] uppercase tracking-wider select-none">Databases</span>
            <div className="flex items-center gap-2">
              <Chevron expanded={expanded.has("root:databases")} />
            </div>
          </div>

          <div className={`accordion-content ${expanded.has("root:databases") ? "expanded flex-1 min-h-0" : ""}`}>
            <div className="accordion-inner h-full">
              {databases.length > 0 && (
                <div className="mx-0.5 mb-2 h-7 flex-shrink-0" style={{ paddingLeft: "12px" }}>
                  <input
                    type="text"
                    placeholder="Filter databases..."
                    value={folderFilters["root:databases"] || ""}
                    onChange={(e) => updateFilter("root:databases", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="explorer-filter w-full h-full"
                  />
                </div>
              )}

              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
                {databases
                  .filter((db) => db.toLowerCase().includes((folderFilters["root:databases"] || "").toLowerCase()))
                  .map((db) => (
                    <div key={db} style={{ display: "flex", flexDirection: "column" }}>
                      <div
                        className={`tree-node cursor-pointer ${contextMenu?.visible && contextMenu.database === db && contextMenu.objectType === "DATABASE" ? "bg-white/10" : ""}`}
                        style={{ "--depth": 0 } as React.CSSProperties}
                        onClick={() => handleDbClick(db)}
                        onDoubleClick={() => onDatabaseChange(db)}
                        onContextMenu={(e) => handleContextMenu(e, db, "", "", "DATABASE")}
                      >
                        <ObjectIcon type="database" />
                        <span className={`truncate flex-1 min-w-0 ${db === currentDatabase ? "font-bold" : ""}`}>
                          {db}
                        </span>
                        {loading.has(db) && <span className="text-text-muted ml-1 animate-pulse">...</span>}
                        <Chevron expanded={expanded.has(db)} />
                      </div>

                      <div className={`accordion-content ${expanded.has(db) ? "expanded" : ""}`}>
                        <div className="accordion-inner slide-down-item">
                          {tableCache[db] ? (
                            <div>
                              {groupDatabaseObjects(tableCache[db]).map(group => {
                                const folderId = `${db}:${group.key}`;
                                const isOpen = expanded.has(folderId);
                                const filter = (folderFilters[folderId] || "").toLowerCase();
                                const filtered = filter
                                  ? group.items.filter(o => o.schema_name.toLowerCase().includes(filter) || o.name.toLowerCase().includes(filter))
                                  : group.items;
                                const canDblClick = group.objectType === "TABLE" || group.objectType === "VIEW";

                                return (
                                  <div key={group.key}>
                                    <div
                                      className={`tree-node cursor-pointer group relative ${contextMenu?.visible && contextMenu.database === db && contextMenu.table === group.key && contextMenu.objectType === "FOLDER" ? "bg-white/10" : ""}`}
                                      style={{ "--depth": 1 } as React.CSSProperties}
                                      onClick={() => toggle(folderId)}
                                      onContextMenu={(e) => handleContextMenu(e, db, "", group.key, "FOLDER")}
                                    >
                                      <i className={`fa-solid ${isOpen ? "fa-folder-open" : "fa-folder"} flex-shrink-0 text-[#eab308] w-4 text-center text-[12px]`} />
                                      <span className="truncate flex-1 min-w-0">{group.label} ({group.items.length})</span>
                                      <Chevron expanded={isOpen} />
                                    </div>
                                    {isOpen && (
                                      <div className="accordion-content expanded">
                                        <div className="accordion-inner">
                                          <div className="mx-0.5 mb-1 h-7 flex-shrink-0" style={{ paddingLeft: "36px" }}>
                                            <input
                                              type="text"
                                              placeholder={`Filter ${group.label.toLowerCase()}...`}
                                              value={folderFilters[folderId] || ""}
                                              onChange={(e) => updateFilter(folderId, e.target.value)}
                                              onClick={(e) => e.stopPropagation()}
                                              className="explorer-filter w-full h-full"
                                            />
                                          </div>
                                          {filtered.map((o) => {
                                            const isCtx = contextMenu?.visible && contextMenu.database === db && contextMenu.schema === o.schema_name && contextMenu.table === o.name;
                                            return (
                                              <div
                                                key={`${db}.${o.schema_name}.${o.name}`}
                                                className={`tree-node cursor-pointer ${isCtx ? "bg-white/10" : ""}`}
                                                style={{ "--depth": 2 } as React.CSSProperties}
                                                onDoubleClick={canDblClick ? () => handleTableDoubleClick(db, o.schema_name, o.name) : undefined}
                                                onContextMenu={(e) => handleContextMenu(e, db, o.schema_name, o.name, group.objectType)}
                                              >
                                                <ObjectIcon type={group.iconName} />
                                                <span className="truncate flex-1 min-w-0">{o.schema_name}.{o.name}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            expanded.has(db) && (
                              <div className="tree-node" style={{ "--depth": 1 } as React.CSSProperties}>
                                <span className="truncate flex-1 min-w-0 text-text-muted italic animate-pulse">Loading objects...</span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>

        {expanded.has("root:saved_queries") && (
          <div
            className={`resizer resizer-v mx-2 ${activeResizer === "saved" ? "active" : ""}`}
            onMouseDown={(e) => startSectionResize("saved", e)}
          />
        )}

        <div
          className="flex flex-col mt-1 flex-none min-h-0"
          style={expanded.has("root:saved_queries") ? { height: sectionHeights.saved } : undefined}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5 mx-0.5 mb-1 flex-shrink-0 cursor-pointer bg-surface-header hover:bg-surface-hover rounded-md text-text transition-colors group"
            onClick={() => toggle("root:saved_queries")}
          >
            <span className="font-bold text-[11px] uppercase tracking-wider select-none">Saved Queries</span>
            <div className="flex items-center gap-2">
              {onOpenSavedQueriesFolder && (
                <Tooltip content="Open folder" placement="top">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSavedQueriesFolder();
                    }}
                    className="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text transition-colors cursor-pointer"
                  >
                    <i className="fa-regular fa-folder-open text-[10px]" />
                  </button>
                </Tooltip>
              )}
              <Chevron expanded={expanded.has("root:saved_queries")} />
            </div>
          </div>

          <div className={`accordion-content ${expanded.has("root:saved_queries") ? "expanded flex-1" : ""}`}>
            <div className="accordion-inner h-full flex flex-col">
              {savedQueries.length > 0 && (
                <div className="mx-0.5 mb-1 h-7 flex-shrink-0" style={{ paddingLeft: "24px" }}>
                  <input
                    type="text"
                    placeholder="Filter saved queries..."
                    value={folderFilters["root:saved_queries"] || ""}
                    onChange={(e) => updateFilter("root:saved_queries", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="explorer-filter w-full h-full"
                  />
                </div>
              )}
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
                {savedQueries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-text-muted py-8 select-none">
                    <i className="fa-solid fa-file-code text-3xl mb-3" />
                    <p className="text-[12px]">No saved queries</p>
                  </div>
                ) : (
                  savedQueries
                    .filter((item) =>
                      item.title.toLowerCase().includes((folderFilters["root:saved_queries"] || "").toLowerCase())
                    )
                    .map((item) => (
                      <Tooltip key={item.id} content={item.filePath} placement="right">
                        <div
                          className="tree-node cursor-pointer group"
                          style={{ "--depth": 0 } as React.CSSProperties}
                          onClick={() => onLoadSavedQuery?.(item.filePath, item.title)}
                          onContextMenu={(e) => handleContextMenu(e, "", "", item.title, "SAVED_QUERY", item.id, item.filePath)}
                        >
                          <i className="fa-solid fa-file-code flex-shrink-0 text-accent w-4 text-center text-[12px]" />
                          <span className="truncate flex-1 min-w-0">{item.title}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSavedQuery?.(item.id);
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-error flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          >
                            <i className="fa-solid fa-trash-can text-[10px]" />
                          </button>
                        </div>
                      </Tooltip>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>

        {expanded.has("root:history") && (
          <div
            className={`resizer resizer-v mx-2 ${activeResizer === "history" ? "active" : ""}`}
            onMouseDown={(e) => startSectionResize("history", e)}
          />
        )}

        <div
          className="flex flex-col mt-1 flex-none min-h-0"
          style={expanded.has("root:history") ? { height: sectionHeights.history } : undefined}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5 mx-0.5 mb-1 flex-shrink-0 cursor-pointer bg-surface-header hover:bg-surface-hover rounded-md text-text transition-colors group"
            onClick={() => toggle("root:history")}
          >
            <span className="font-bold text-[11px] uppercase tracking-wider select-none">History</span>
            <div className="flex items-center gap-2">
              {onClearHistory && executedQueries.length > 0 && (
                <Tooltip content="Clear all" placement="top">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearHistory();
                    }}
                    className="w-4 h-4 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-error transition-colors cursor-pointer"
                  >
                    <i className="fa-solid fa-trash-can text-[10px]" />
                  </button>
                </Tooltip>
              )}
              <Chevron expanded={expanded.has("root:history")} />
            </div>
          </div>

          <div className={`accordion-content ${expanded.has("root:history") ? "expanded flex-1" : ""}`}>
            <div className="accordion-inner h-full flex flex-col">
              {executedQueries.length > 0 && (
                <div className="mx-0.5 mb-1 h-7 flex-shrink-0" style={{ paddingLeft: "24px" }}>
                  <input
                    type="text"
                    placeholder="Filter history..."
                    value={folderFilters["root:history"] || ""}
                    onChange={(e) => updateFilter("root:history", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="explorer-filter w-full h-full"
                  />
                </div>
              )}
              <div className="flex-1 overflow-y-auto overflow-x-hidden pb-2">
                {executedQueries.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-text-muted py-8 select-none">
                    <i className="fa-solid fa-clock-rotate-left text-3xl mb-3" />
                    <p className="text-[12px]">No history yet</p>
                  </div>
                ) : (
                  executedQueries
                    .filter((item) =>
                      item.sql.toLowerCase().includes((folderFilters["root:history"] || "").toLowerCase()) ||
                      item.title.toLowerCase().includes((folderFilters["root:history"] || "").toLowerCase())
                    )
                    .map((item, i) => (
                      <Tooltip key={`${item.sql}-${i}`} content={item.sql} placement="right">
                        <div
                          className="tree-node cursor-pointer group flex items-center gap-2"
                          style={{ "--depth": 0 } as React.CSSProperties}
                          onClick={() => onSelect(item.sql, false, item.title, item.database, `history:${item.sql}`)}
                          onContextMenu={(e) => handleContextMenu(e, item.database, "", item.title, "HISTORY", item.sql)}
                        >
                          <div className="w-4 flex justify-center flex-shrink-0">
                            <i className="fa-solid fa-clock-rotate-left text-text-muted/60 text-[11px]" />
                          </div>
                          <span className="truncate flex-1 min-w-0">{item.title}</span>
                          <span className="text-[10px] text-text-muted/40 ml-2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pr-2">
                            {formatTimeAgo(item.executedAt)}
                          </span>
                        </div>
                      </Tooltip>
                    ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {contextMenu?.visible && (
        <ContextMenu
          items={getContextMenuItems()}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
