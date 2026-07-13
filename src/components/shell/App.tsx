import { createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { useConnection } from "../../hooks/useConnection";
import { useHistory } from "../../hooks/useHistory";
import { useSavedQueries } from "../../hooks/useSavedQueries";
import { useTabs } from "../../hooks/useTabs";
import { getSavedQueriesDir, joinPath } from "../../lib/path";
import { getPlatformClass } from "../../lib/platform";
import { generateTabTitle } from "../../lib/sql";
import { loadTheme } from "../../lib/theme";
import type {
  ConnectionConfig,
  QueryResult,
  QueryTab,
  ServerObjectIndexStatus,
} from "../../lib/types";
import ConnectionDialog from "../dialogs/ConnectionDialog";
import DependenciesDialog from "../dialogs/DependenciesDialog";
import DropConfirmDialog from "../dialogs/DropConfirmDialog";
import ObjectExplorer, { type ObjectExplorerHandle } from "../explorer/ObjectExplorer";
import ObjectJumpPalette, {
  type ObjectJumpSelection,
} from "../explorer/ObjectJumpPalette";
import type { ExplorerObjectType } from "../explorer/ObjectMenu";
import BackupRestoreDialog from "../dialogs/BackupRestoreDialog";
import PropertiesDialog, {
  type PropertiesObjectType,
} from "../dialogs/PropertiesDialog";
import QueryEditorPanel from "../editor/QueryEditorPanel";
import RenameDialog from "../dialogs/RenameDialog";
import { invalidateSchemaCatalog } from "../editor/SqlEditor";
import SettingsView from "../settings/SettingsView";
import {
  loadAutoCheckUpdates,
  loadExecutionPreferences,
  saveExecConfirmDestructive,
  loadPreferences,
} from "../../lib/settings";
import {
  findUnguardedDestructiveStatements,
  type UnguardedStatement,
} from "../../lib/sql-safety";
import ConfirmDialog from "../ui/ConfirmDialog";
import TitleBar from "./TitleBar";
import UpdateDialog from "../dialogs/UpdateDialog";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";

type RiskySchemaChangeKind = "ALTER" | "DROP";

interface RiskySchemaChange {
  kind: RiskySchemaChangeKind;
  objectType: string;
}

const SCHEMA_REFRESH_OBJECT_TYPES =
  "TABLE|VIEW|PROCEDURE|PROC|FUNCTION|TRIGGER|TYPE|SCHEMA|INDEX|SEQUENCE|SYNONYM";
const RISKY_DDL_OBJECT_TYPES = [
  "APPLICATION ROLE",
  "ASSEMBLY",
  "ASYMMETRIC KEY",
  "CERTIFICATE",
  "CONTRACT",
  "DATABASE SCOPED CONFIGURATION",
  "DATABASE SCOPED CREDENTIAL",
  "DATABASE",
  "DEFAULT",
  "ENDPOINT",
  "EVENT NOTIFICATION",
  "EXTERNAL DATA SOURCE",
  "EXTERNAL FILE FORMAT",
  "EXTERNAL LIBRARY",
  "EXTERNAL TABLE",
  "FULLTEXT CATALOG",
  "FULLTEXT INDEX",
  "FULLTEXT STOPLIST",
  "FUNCTION",
  "INDEX",
  "LOGIN",
  "MASK",
  "MASTER KEY",
  "MESSAGE TYPE",
  "PARTITION FUNCTION",
  "PARTITION SCHEME",
  "PROCEDURE",
  "PROC",
  "QUEUE",
  "REMOTE SERVICE BINDING",
  "ROLE",
  "ROUTE",
  "RULE",
  "SCHEMA",
  "SEARCH PROPERTY LIST",
  "SECURITY POLICY",
  "SEQUENCE",
  "SERVICE",
  "SYMMETRIC KEY",
  "SYNONYM",
  "TABLE",
  "TRIGGER",
  "TYPE",
  "USER",
  "VIEW",
  "XML SCHEMA COLLECTION",
]
  .map((type) => type.replace(/\s+/g, "\\s+"))
  .join("|");
const SCHEMA_REFRESH_REGEX = new RegExp(
  `\\b(?:CREATE\\s+(?:OR\\s+ALTER\\s+)?(?:UNIQUE\\s+)?(?:(?:NON)?CLUSTERED\\s+)?|ALTER\\s+|DROP\\s+|TRUNCATE\\s+)(?:${SCHEMA_REFRESH_OBJECT_TYPES})\\b`,
  "i",
);
const DATABASE_DDL_REGEX = /\b(?:CREATE|ALTER|DROP)\s+DATABASE\b/i;
const RISKY_DDL_REGEX = new RegExp(
  `\\b(DROP|ALTER)\\s+(?:IF\\s+EXISTS\\s+)?(${RISKY_DDL_OBJECT_TYPES})\\b`,
  "gi",
);

const EMPTY_OBJECT_INDEX_STATUS: ServerObjectIndexStatus = {
  initialized: false,
  indexing: false,
  database_count: 0,
  processed_database_count: 0,
  failed_databases: [],
  object_count: 0,
};

const LAST_SQL_EXPORT_FOLDER_STORAGE_KEY = "sqlqs_last_sql_export_folder";
const TEXT_LIKE_INPUT_TYPES = new Set([
  "",
  "email",
  "password",
  "search",
  "tel",
  "text",
  "url",
]);

function getSqlFileName(title: string): string {
  const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, "_").trim() || "Query";
  return /\.sql$/i.test(sanitizedTitle)
    ? sanitizedTitle
    : `${sanitizedTitle}.sql`;
}

function getTextEditableTarget(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) {
    return TEXT_LIKE_INPUT_TYPES.has(target.type.toLowerCase()) ? target : null;
  }
  return null;
}

function isLikelySchemaChangingSql(sql: string): boolean {
  return SCHEMA_REFRESH_REGEX.test(stripSqlStringsAndComments(sql));
}

function changesDatabaseCatalog(sql: string): boolean {
  return DATABASE_DDL_REGEX.test(stripSqlStringsAndComments(sql));
}

function stripSqlStringsAndComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/\[(?:\]\]|[^\]])*\]/g, " ")
    .replace(/N?'(?:''|[^'])*'/gi, " ");
}

function findRiskySchemaChanges(sql: string): RiskySchemaChange[] {
  const withoutStringsAndComments = stripSqlStringsAndComments(sql);
  const changes: RiskySchemaChange[] = [];

  for (const match of withoutStringsAndComments.matchAll(RISKY_DDL_REGEX)) {
    const kind = match[1].toUpperCase() as RiskySchemaChangeKind;
    const objectType = match[2].replace(/\s+/g, " ").toUpperCase();
    changes.push({ kind, objectType });
  }

  return changes;
}

export default function App() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    updateTab,
    reorderTabs,
    duplicateTab,
    togglePin,
    promoteTab,
  } = useTabs();

  const {
    connected,
    isInitializing,
    serverName,
    currentDatabase,
    databases,
    connect,
    disconnect,
    changeDatabase,
    refreshDatabases,
  } = useConnection();

  const { executedQueries, addHistory, deleteHistory, clearHistory } =
    useHistory();
  const { savedQueries, saveQuery, deleteQuery, loadQueryContent } =
    useSavedQueries();
  const {
    appVersion,
    updateStatus,
    updateAvailable,
    updateAvailableChannel,
    updateDialogVisible,
    setUpdateDialogVisible,
    checkForUpdates,
    installUpdate,
    cancelUpdate,
  } = useAppUpdater();

  const [isConnectionDialogOpen, setIsConnectionDialogOpen] =
    createSignal(false);
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [pendingRisky, setPendingRisky] = createSignal<{
    tabId: string;
    sql: string;
    unguarded: UnguardedStatement[];
    schemaChanges: RiskySchemaChange[];
  } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [explorerWidth, setExplorerWidth] = createSignal(325);
  const [theme, setTheme] = createSignal(loadTheme());
  const [isObjectJumpOpen, setIsObjectJumpOpen] = createSignal(false);
  const [backupRestoreDatabase, setBackupRestoreDatabase] = createSignal<
    string | null
  >(null);
  const [objectJumpIndexStatus, setObjectJumpIndexStatus] =
    createSignal<ServerObjectIndexStatus>(EMPTY_OBJECT_INDEX_STATUS);
  const [aiChatOpen, setAiChatOpen] = createSignal(
    loadPreferences().openLastChatStartup &&
      localStorage.getItem("sqlqs_ai_chat_open") === "true",
  );
  const [propertiesTarget, setPropertiesTarget] = createSignal<{
    database: string;
    schema: string;
    name: string;
    objectType: PropertiesObjectType;
  } | null>(null);
  const [renameTarget, setRenameTarget] = createSignal<{
    database: string;
    schema: string;
    name: string;
    objectType: ExplorerObjectType;
  } | null>(null);
  const [dropTarget, setDropTarget] = createSignal<{
    database: string;
    schema: string;
    name: string;
    objectType: ExplorerObjectType;
  } | null>(null);
  const [dependenciesTarget, setDependenciesTarget] = createSignal<{
    database: string;
    schema: string;
    name: string;
    objectType: ExplorerObjectType;
  } | null>(null);

  const [globalContextMenu, setGlobalContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  let explorerRef: ObjectExplorerHandle | null = null;

  const handleShowProperties = (
    database: string,
    schema: string,
    name: string,
    objectType: PropertiesObjectType,
  ) => {
    setPropertiesTarget({ database, schema, name, objectType });
  };

  const handleShowRename = (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => {
    setRenameTarget({ database, schema, name, objectType });
  };

  const handleShowDrop = (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => {
    setDropTarget({ database, schema, name, objectType });
  };

  const handleShowDependencies = (
    database: string,
    schema: string,
    name: string,
    objectType: ExplorerObjectType,
  ) => {
    setDependenciesTarget({ database, schema, name, objectType });
  };

  createEffect(() => {
    localStorage.setItem("sqlqs_ai_chat_open", String(aiChatOpen()));
  });

  function handleToggleAiChat() {
    setAiChatOpen((prev) => !prev);
  }

  onMount(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void getCurrentWindow().show();
      });
    });
  });

  createEffect(() => {
    const handleStorage = () => setTheme(loadTheme());
    window.addEventListener("storage", handleStorage);
    onCleanup(() => window.removeEventListener("storage", handleStorage));
  });

  onMount(() => {
    const platformClass = getPlatformClass();
    document.documentElement.dataset.platform = platformClass;

    onCleanup(() => {
      delete document.documentElement.dataset.platform;
    });
  });

  onMount(() => {
    if (!loadAutoCheckUpdates()) return;
    const timer = setTimeout(() => {
      void checkForUpdates(false);
    }, 5000);

    onCleanup(() => {
      clearTimeout(timer);
    });
  });

  onMount(() => {
    const handleDocumentContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;

      e.preventDefault();

      const input = getTextEditableTarget(e.target);

      let selectionText = "";
      let hasSelection = false;
      let selectionStart = 0;
      let selectionEnd = 0;

      if (input) {
        selectionStart = input.selectionStart ?? 0;
        selectionEnd = input.selectionEnd ?? 0;
        hasSelection = selectionStart !== selectionEnd;
        selectionText = input.value.substring(selectionStart, selectionEnd);
      } else {
        const selection = window.getSelection();
        selectionText = selection ? selection.toString() : "";
        hasSelection = selectionText.length > 0;
      }

      const menuItems: ContextMenuItem[] = [];

      if (input) {
        const isReadOnly = input.readOnly || input.disabled;

        menuItems.push({
          id: "cut",
          label: "Cut",
          icon: <i class="fa-solid fa-scissors" />,
          disabled: isReadOnly || !hasSelection,
          onClick: () => {
            void invoke("write_clipboard", { text: selectionText });
            const val = input.value;
            input.value = val.substring(0, selectionStart) + val.substring(selectionEnd);
            input.setSelectionRange(selectionStart, selectionStart);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
          }
        });

        menuItems.push({
          id: "copy",
          label: "Copy",
          icon: <i class="fa-solid fa-copy" />,
          disabled: !hasSelection,
          onClick: () => {
            void invoke("write_clipboard", { text: selectionText });
            input.focus();
          }
        });

        menuItems.push({
          id: "paste",
          label: "Paste",
          icon: <i class="fa-solid fa-paste" />,
          disabled: isReadOnly,
          onClick: async () => {
            try {
              const text = await invoke<string>("read_clipboard");
              const val = input.value;
              input.value = val.substring(0, selectionStart) + text + val.substring(selectionEnd);
              const nextCursor = selectionStart + text.length;
              input.setSelectionRange(nextCursor, nextCursor);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.focus();
            } catch {
              // Ignore clipboard read errors
            }
          }
        });

        menuItems.push({ separator: true, id: "sep" });

        menuItems.push({
          id: "select-all",
          label: "Select All",
          icon: <i class="fa-solid fa-check-double" />,
          disabled: input.value.length === 0,
          onClick: () => {
            input.select();
            input.focus();
          }
        });
      } else if (hasSelection) {
        menuItems.push({
          id: "copy",
          label: "Copy",
          icon: <i class="fa-solid fa-copy" />,
          onClick: () => {
            void invoke("write_clipboard", { text: selectionText });
          }
        });
      }

      if (menuItems.length > 0) {
        setGlobalContextMenu({
          visible: true,
          x: e.clientX,
          y: e.clientY,
          items: menuItems
        });
      } else {
        setGlobalContextMenu(null);
      }
    };

    document.addEventListener("contextmenu", handleDocumentContextMenu);
    onCleanup(() => {
      document.removeEventListener("contextmenu", handleDocumentContextMenu);
    });
  });

  function handleConnect(config: ConnectionConfig) {
    connect(config);
    setIsConnectionDialogOpen(false);
  }

  async function handleExecute(tabId: string, selectedSql?: string) {
    const tab = tabs().find((t) => t.id === tabId);
    if (!tab) return;

    const sqlToExecute = (selectedSql || tab.sql).trim();
    if (!sqlToExecute) return;

    const execPrefs = loadExecutionPreferences();
    if (execPrefs.confirmDestructive) {
      const unguarded = findUnguardedDestructiveStatements(sqlToExecute);
      const schemaChanges = findRiskySchemaChanges(sqlToExecute);
      if (unguarded.length > 0 || schemaChanges.length > 0) {
        setPendingRisky({
          tabId,
          sql: sqlToExecute,
          unguarded,
          schemaChanges,
        });
        return;
      }
    }

    await runExecute(tabId, sqlToExecute);
  }

  async function runExecute(tabId: string, sqlToExecute: string) {
    const tab = tabs().find((t) => t.id === tabId);
    if (!tab) return;
    const execPrefs = loadExecutionPreferences();

    updateTab(tabId, { isExecuting: true, error: undefined });

    try {
      const result: QueryResult = await invoke("execute_query", {
        sql: sqlToExecute,
        maxRows: execPrefs.maxRows > 0 ? execPrefs.maxRows : null,
        timeoutSeconds:
          execPrefs.timeoutSeconds > 0 ? execPrefs.timeoutSeconds : null,
      });
      const updates: Partial<QueryTab> = { result, isExecuting: false };
      if (!tab.userTitle) {
        const generatedTitle = generateTabTitle(sqlToExecute);
        if (generatedTitle) {
          updates.title = generatedTitle;
        }
      }
      updateTab(tabId, updates);
      addHistory(sqlToExecute, updates.title || tab.title, currentDatabase());
      const changedDatabaseCatalog = changesDatabaseCatalog(sqlToExecute);
      const changedSchema = isLikelySchemaChangingSql(sqlToExecute);
      if (changedDatabaseCatalog) {
        invalidateSchemaCatalog();
        void refreshDatabases();
      }
      if (changedSchema) {
        const db = currentDatabase();
        invalidateSchemaCatalog(db);
        if (db) {
          void explorerRef?.refreshDatabaseObjects(db);
        }
      }
    } catch (err: any) {
      updateTab(tabId, { error: String(err), isExecuting: false });
    }
  }

  function describeDestructive(findings: UnguardedStatement[]): string {
    const counts = findings.reduce(
      (acc, f) => {
        acc[f.kind] = (acc[f.kind] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const parts = Object.entries(counts).map(([kind, n]) => `${n} ${kind}`);
    return parts.join(", ");
  }

  function describeRiskySchemaChanges(changes: RiskySchemaChange[]): string {
    const counts = changes.reduce(
      (acc, change) => {
        const key = `${change.kind} ${change.objectType}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    return Object.entries(counts)
      .map(([kind, n]) => `${n} ${kind}`)
      .join(", ");
  }

  function riskyQueryMessage(pending: {
    unguarded: UnguardedStatement[];
    schemaChanges: RiskySchemaChange[];
  }): string {
    const messages: string[] = [];
    if (pending.schemaChanges.length > 0) {
      messages.push(
        `This query contains ${describeRiskySchemaChanges(
          pending.schemaChanges,
        )} statement(s). Schema changes can break dependent objects or remove data structures.`,
      );
    }
    if (pending.unguarded.length > 0) {
      const prefix =
        messages.length > 0 ? "It also contains" : "This query contains";
      messages.push(
        `${prefix} ${describeDestructive(
          pending.unguarded,
        )} statement(s) without a WHERE clause, which may affect every row.`,
      );
    }
    return `${messages.join(" ")} Proceed?`;
  }

  function handleOpenQueryTab({
    sql,
    execute,
    title,
    database,
    sourceId,
    preserveTitle,
    temporary,
  }: {
    sql: string;
    execute?: boolean;
    title?: string;
    database?: string;
    sourceId?: string;
    preserveTitle?: boolean;
    temporary?: boolean;
  }) {
    if (database && database !== currentDatabase()) {
      changeDatabase(database);
    }

    const tabId = addTab(sql, title, sourceId, preserveTitle, { temporary });
    if (execute) {
      setTimeout(() => handleExecute(tabId, sql), 0);
    }
  }

  function handleOpenSqlFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sql,text/plain";

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        const content = await file.text();
        const title = file.name.replace(/\.sql$/i, "").trim();
        addTab(content, title || undefined);
      } catch (error) {
        console.error("Failed to open SQL file:", error);
      }
    };

    input.click();
  }

  async function handleOpenSqlFilePath(path: string) {
    try {
      const file = await invoke<{
        path: string;
        file_name: string;
        content: string;
      }>("read_sql_file", { path });

      addTab(file.content, file.file_name, `file:${file.path}`, true);
    } catch (error) {
      console.error("Failed to open SQL file from path:", error);
    }
  }

  function handleExplorerResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = explorerWidth();

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(
        325,
        Math.min(500, startWidth + ev.clientX - startX),
      );
      setExplorerWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  async function handleTabSave(tabId: string) {
    const tab = tabs().find((t) => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    await saveQuery(tab.title, tab.sql);
    promoteTab(tabId);
    updateTab(tabId, { savedSql: tab.sql });
  }

  async function handleTabSaveToFile(tabId: string) {
    const tab = tabs().find((t) => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    try {
      const lastFolder = localStorage.getItem(
        LAST_SQL_EXPORT_FOLDER_STORAGE_KEY,
      );
      const documentsPath = await invoke<string>("get_documents_folder");
      const folderPath = await invoke<string | null>("pick_folder_dialog", {
        title: "Choose a folder for your SQL file",
        startingDirectory: lastFolder || documentsPath,
      });

      if (!folderPath) {
        return;
      }

      const filePath = joinPath(folderPath, getSqlFileName(tab.title));
      await invoke<string>("write_sql_file", {
        path: filePath,
        content: tab.sql,
      });

      localStorage.setItem(LAST_SQL_EXPORT_FOLDER_STORAGE_KEY, folderPath);
      promoteTab(tabId);
      updateTab(tabId, { savedSql: tab.sql });
    } catch (error) {
      console.error("Failed to save SQL file to chosen folder:", error);
    }
  }

  async function handleLoadSavedQuery(filePath: string, title: string) {
    const content = await loadQueryContent(filePath);
    if (content) {
      addTab(content, title, `saved:${filePath}`, true, { temporary: true });
    }
  }

  async function handleDeleteSavedQuery(id: string) {
    await deleteQuery(id);
  }

  async function handleOpenSavedQueriesFolder() {
    try {
      const documentsPath = await invoke<string>("get_documents_folder");
      const folderPath = getSavedQueriesDir(documentsPath);
      await invoke("open_folder", { path: folderPath });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }

  const hasBlockingDialog = () =>
    isConnectionDialogOpen() ||
    isSettingsOpen() ||
    updateDialogVisible() ||
    backupRestoreDatabase() !== null ||
    !!propertiesTarget() ||
    !!renameTarget() ||
    !!dropTarget() ||
    !!dependenciesTarget() ||
    !!pendingRisky();
  const canOpenObjectJump = () => connected();

  function handleToggleObjectJump() {
    if (!canOpenObjectJump() || hasBlockingDialog()) {
      return;
    }

    setIsObjectJumpOpen((prev) => !prev);
  }

  createEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | undefined;
    let unlistenDragDrop: (() => void) | undefined;

    void (async () => {
      try {
        const startupPath = await invoke<string | null>(
          "get_startup_sql_file_path",
        );
        if (isMounted && startupPath) {
          await handleOpenSqlFilePath(startupPath);
        }

        unlisten = await listen<string>("sql-file-opened", async (event) => {
          await handleOpenSqlFilePath(event.payload);
        });

        unlistenDragDrop = await listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
          if (!isMounted) return;
          const paths = event.payload.paths;
          if (Array.isArray(paths)) {
            for (const path of paths) {
              await handleOpenSqlFilePath(path);
            }
          }
        });
      } catch (error) {
        console.error("Failed to register SQL file handlers:", error);
      }
    })();

    onCleanup(() => {
      isMounted = false;
      unlisten?.();
      unlistenDragDrop?.();
    });
  });

  createEffect(() => {
    const jumpOpen = isObjectJumpOpen();
    if (jumpOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "o"
      ) {
        event.preventDefault();
        handleOpenSqlFile();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key === ","
      ) {
        event.preventDefault();
        setIsSettingsOpen((prev) => !prev);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    if (!canOpenObjectJump() || hasBlockingDialog()) {
      setIsObjectJumpOpen(false);
    }
  });

  createEffect(() => {
    const conn = connected();
    const init = isInitializing();
    const status = objectJumpIndexStatus();

    if (!conn || init || status.initialized) {
      return;
    }

    let cancelled = false;
    let idleHandle: number | undefined;

    const startIndexingInBackground = async () => {
      try {
        const newStatus = await invoke<ServerObjectIndexStatus>(
          "start_server_object_indexing",
        );

        if (!cancelled) {
          setObjectJumpIndexStatus(newStatus);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to start background object indexing:", error);
        }
      }
    };

    const timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(
          () => {
            void startIndexingInBackground();
          },
          { timeout: 2000 },
        );
        return;
      }

      void startIndexingInBackground();
    }, 900);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
    });
  });

  createEffect(() => {
    const canOpen = canOpenObjectJump();
    const blocking = hasBlockingDialog();

    const onKeyDown = (event: KeyboardEvent) => {
      if (!canOpen || blocking) {
        return;
      }

      const key = event.key.toLowerCase();
      const isObjectJumpHotkey =
        ((event.ctrlKey || event.metaKey) &&
          event.shiftKey &&
          !event.altKey &&
          key === "f") ||
        ((event.ctrlKey || event.metaKey) &&
          !event.shiftKey &&
          !event.altKey &&
          key === "p");

      if (isObjectJumpHotkey) {
        event.preventDefault();
        setIsObjectJumpOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    const conn = connected();
    const jumpOpen = isObjectJumpOpen();
    const status = objectJumpIndexStatus();

    if (!conn) {
      setObjectJumpIndexStatus(EMPTY_OBJECT_INDEX_STATUS);
      return;
    }

    if (!jumpOpen && !status.indexing) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const syncIndexStatus = async (startIndexing: boolean) => {
      try {
        const newStatus = await invoke<ServerObjectIndexStatus>(
          startIndexing
            ? "start_server_object_indexing"
            : "get_server_object_index_status",
        );

        if (cancelled) {
          return;
        }

        setObjectJumpIndexStatus(newStatus);

        if (newStatus.indexing) {
          timer = window.setTimeout(() => {
            void syncIndexStatus(false);
          }, 700);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to sync object jump index status:", error);
        }
      }
    };

    void syncIndexStatus(jumpOpen && !status.initialized);

    onCleanup(() => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    });
  });

  const isAnyDialogOpen = () => hasBlockingDialog() || isObjectJumpOpen();

  return (
    <div class="app-shell app-material-shell flex h-screen w-screen relative flex-col overflow-hidden font-sans text-text selection:bg-accent/30 selection:text-accent-text">
      <TitleBar
        connected={connected()}
        isInitializing={isInitializing()}
        serverName={serverName()}
        onConnect={() => setIsConnectionDialogOpen(true)}
        onDisconnect={disconnect}
        onOpenSqlFile={handleOpenSqlFile}
        onShowBackupRestore={() =>
          setBackupRestoreDatabase(currentDatabase() || databases()[0] || "")
        }
        onShowSettings={() => setIsSettingsOpen(true)}
        onHideSettings={() => setIsSettingsOpen(false)}
        settingsDisabled={isSettingsOpen()}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen())}
        sidebarVisible={isSidebarOpen()}
        sidebarWidth={explorerWidth()}
        dialogOpen={isAnyDialogOpen()}
        aiChatOpen={aiChatOpen()}
        onToggleAiChat={handleToggleAiChat}
        onToggleObjectJump={handleToggleObjectJump}
        objectJumpOpen={isObjectJumpOpen()}
        objectJumpIndexStatus={objectJumpIndexStatus()}
        hideAppContent={isSettingsOpen()}
        updateAvailable={!!updateAvailable()}
        onViewUpdateDetails={() => setUpdateDialogVisible(true)}
        hasTabs={tabs().length > 0}
      />

      <div class="app-workspace flex flex-1 overflow-hidden relative">
        {isSettingsOpen() ? (
          <SettingsView
            onClose={() => setIsSettingsOpen(false)}
            version={appVersion()}
            onCheckForUpdates={() => checkForUpdates(true)}
            checkingForUpdates={updateStatus().checking}
            updateMessage={updateStatus().message}
            updateMessageTone={updateStatus().tone}
            updateReady={!!updateAvailable()}
            onViewUpdateDetails={() => setUpdateDialogVisible(true)}
            onThemeChange={setTheme}
            renderLayout={(sidebar, content) => (
              <>
                <div
                  style={{ width: `${explorerWidth()}px` }}
                  class="app-sidebar-surface flex-shrink-0 overflow-hidden relative flex flex-col z-10 animate-in fade-in"
                >
                  {sidebar}
                </div>
                <div
                  class="resizer resizer-h"
                  onMouseDown={handleExplorerResize}
                />
                <main class="app-panel flex-1 flex flex-col relative">
                  <div class="flex-1 w-full h-full p-8 md:p-12 overflow-y-auto scrollbar-gutter-stable animate-in fade-in duration-[var(--duration-slow)]">
                    {content}
                  </div>
                </main>
              </>
            )}
          />
        ) : (
          <>
            {connected() && isSidebarOpen() && (
              <>
                <div
                  style={{ width: `${explorerWidth()}px` }}
                  class="app-sidebar-surface flex-shrink-0 overflow-hidden relative z-10"
                >
                  <ObjectExplorer
                    onRef={(handle) => (explorerRef = handle)}
                    databases={databases()}
                    onRefreshDatabases={refreshDatabases}
                    onSelect={(sql, execute, title, database, sourceId) => {
                      handleOpenQueryTab({
                        sql,
                        execute,
                        title,
                        database,
                        sourceId,
                      });
                    }}
                    onDatabaseChange={changeDatabase}
                    currentDatabase={currentDatabase()}
                    executedQueries={executedQueries()}
                    onDeleteHistory={deleteHistory}
                    onClearHistory={clearHistory}
                    savedQueries={savedQueries()}
                    onDeleteSavedQuery={handleDeleteSavedQuery}
                    onLoadSavedQuery={handleLoadSavedQuery}
                    onOpenSavedQueriesFolder={handleOpenSavedQueriesFolder}
                    onShowProperties={handleShowProperties}
                    onShowRename={handleShowRename}
                    onShowDrop={handleShowDrop}
                    onShowDependencies={handleShowDependencies}
                    onShowBackupRestore={(database) =>
                      setBackupRestoreDatabase(database)
                    }
                  />
                </div>
                <div
                  class="resizer resizer-h"
                  onMouseDown={handleExplorerResize}
                />
              </>
            )}

            <main class="flex-1 flex flex-col overflow-hidden relative transition-colors duration-[var(--duration-slow)]">
              <QueryEditorPanel
                tabs={tabs()}
                activeTabId={activeTabId()}
                onTabChange={setActiveTabId}
                onTabAdd={addTab}
                onTabClose={closeTab}
                onTabCloseOthers={closeOtherTabs}
                onTabCloseAll={closeAllTabs}
                onTabUpdate={updateTab}
                onTabReorder={reorderTabs}
                onTabDuplicate={duplicateTab}
                onTabTogglePin={togglePin}
                onTabPromote={promoteTab}
                onOpenSqlFile={handleOpenSqlFile}
                onExecute={handleExecute}
                onConnect={() => setIsConnectionDialogOpen(true)}
                connected={connected()}
                isInitializing={isInitializing()}
                currentDatabase={currentDatabase()}
                databases={databases()}
                onDatabaseChange={changeDatabase}
                theme={theme()}
                aiChatOpen={aiChatOpen()}
                onAiChatOpenChange={setAiChatOpen}
                onSave={handleTabSave}
                onSaveToFile={handleTabSaveToFile}
                executedQueries={executedQueries()}
                dialogOpen={isAnyDialogOpen()}
              />
            </main>
          </>
        )}
      </div>

      {isConnectionDialogOpen() && (
        <ConnectionDialog
          onClose={() => setIsConnectionDialogOpen(false)}
          onConnect={handleConnect}
        />
      )}

      {updateDialogVisible() && updateAvailable() && (
        <UpdateDialog
          channel={updateAvailableChannel() ?? "stable"}
          version={updateAvailable()!.version}
          body={updateAvailable()!.body}
          onInstall={() => installUpdate(updateAvailable()!)}
          onCancel={() => cancelUpdate(updateAvailable()!)}
        />
      )}

      <Show when={backupRestoreDatabase() !== null}>
        <BackupRestoreDialog
          databases={databases()}
          currentDatabase={currentDatabase()}
          initialDatabase={backupRestoreDatabase() || undefined}
          onClose={() => setBackupRestoreDatabase(null)}
          onRefreshDatabases={refreshDatabases}
        />
      </Show>

      <ObjectJumpPalette
        open={isObjectJumpOpen()}
        connected={connected()}
        currentDatabase={currentDatabase()}
        indexStatus={objectJumpIndexStatus()}
        onClose={() => setIsObjectJumpOpen(false)}
        onSelect={(selection: ObjectJumpSelection) =>
          handleOpenQueryTab(selection)
        }
        onShowProperties={handleShowProperties}
        onShowRename={handleShowRename}
        onShowDrop={handleShowDrop}
        onShowDependencies={handleShowDependencies}
      />

      <Show when={propertiesTarget()}>
        {(target) => (
          <PropertiesDialog
            database={target().database}
            schema={target().schema}
            name={target().name}
            objectType={target().objectType}
            onClose={() => setPropertiesTarget(null)}
          />
        )}
      </Show>

      <Show when={renameTarget()}>
        {(target) => (
          <RenameDialog
            database={target().database}
            schema={target().schema}
            name={target().name}
            objectType={target().objectType}
            onClose={() => setRenameTarget(null)}
            onSuccess={() => {
              invalidateSchemaCatalog();
              const db = target().database;
              if (db) {
                void explorerRef?.refreshDatabaseObjects(db);
              }
            }}
          />
        )}
      </Show>

      <Show when={dropTarget()}>
        {(target) => (
          <DropConfirmDialog
            database={target().database}
            schema={target().schema}
            name={target().name}
            objectType={target().objectType}
            onClose={() => setDropTarget(null)}
            onSuccess={() => {
              invalidateSchemaCatalog();
              const db = target().database;
              if (db) {
                void explorerRef?.refreshDatabaseObjects(db);
              }
            }}
          />
        )}
      </Show>

      <Show when={dependenciesTarget()}>
        {(target) => (
          <DependenciesDialog
            database={target().database}
            schema={target().schema}
            name={target().name}
            objectType={target().objectType}
            onClose={() => setDependenciesTarget(null)}
          />
        )}
      </Show>

      <Show when={pendingRisky()}>
        {(pending) => (
          <ConfirmDialog
            title="Run risky query?"
            message={riskyQueryMessage(pending())}
            confirmLabel="Run anyway"
            suppressFutureLabel="Don't warn me about risky queries again"
            variant="danger"
            onConfirm={(result) => {
              const p = pending();
              if (result?.suppressFuture) {
                saveExecConfirmDestructive(false);
              }
              setPendingRisky(null);
              void runExecute(p.tabId, p.sql);
            }}
            onCancel={() => {
              setPendingRisky(null);
            }}
          />
        )}
      </Show>

      <Show when={globalContextMenu()?.visible}>
        <ContextMenu
          items={globalContextMenu()!.items}
          x={globalContextMenu()!.x}
          y={globalContextMenu()!.y}
          onClose={() => setGlobalContextMenu(null)}
        />
      </Show>
    </div>
  );
}
