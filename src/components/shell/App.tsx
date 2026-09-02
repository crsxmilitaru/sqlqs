import { createSignal, createEffect, createMemo, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { useConnection } from "../../hooks/useConnection";
import { useEditorNavigation } from "../../hooks/useEditorNavigation";
import { useHistory } from "../../hooks/useHistory";
import { useSavedQueries } from "../../hooks/useSavedQueries";
import { useTabs } from "../../hooks/useTabs";
import {
  discardStaleNavigationRestore,
  isGoBackKey,
  isGoForwardKey,
  isMouseBackButton,
  isMouseForwardButton,
  queueNavigationRestore,
  type EditorNavigationPoint,
} from "../../lib/editor-navigation";
import { baseFileName, getSavedQueriesDir, joinPath } from "../../lib/path";
import { getPlatformClass } from "../../lib/platform";
import { AiService } from "../../lib/ai";
import { generateTabTitle } from "../../lib/sql";
import { loadTheme, THEME_CHANGED_EVENT, type ThemeSelection } from "../../lib/theme";
import { startTaskbarOperation } from "../../lib/taskbar";
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
import type { SqlEditorHandle } from "../editor/SqlEditor";
import RenameDialog from "../dialogs/RenameDialog";
import TableCompareDialog from "../dialogs/TableCompareDialog";
import { invalidateSchemaCatalog } from "../../lib/schema-catalog";
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
import Toaster, { toast } from "../ui/Toaster";

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

function isCodeMirrorTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".cm-editor"));
}

function isTabRenameTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && Boolean(target.closest(".tab-rename-input"))
  );
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
    groups,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    updateTab,
    moveTab,
    duplicateTab,
    togglePin,
    promoteTab,
    reopenClosedTab,
    canReopenClosedTab,
    createGroup,
    addTabsToGroup,
    removeTabsFromGroup,
    renameGroup,
    setGroupColor,
    toggleGroupCollapsed,
    revealTab,
    ungroupGroup,
    closeGroup,
    requestAutoTabTitle,
  } = useTabs();

  let editorHandle: SqlEditorHandle | null = null;

  function currentNavigationPoint(): EditorNavigationPoint | null {
    const location = editorHandle?.getLocation();
    const tabId = activeTabId();
    if (!location || !tabId) return null;
    return { tabId, ...location };
  }

  const editorNavigation = useEditorNavigation({
    getPoint: currentNavigationPoint,
    restorePoint: (point: EditorNavigationPoint, onSettled) => {
      revealTab(point.tabId);
      const finish = () => {
        if (activeTabId() === point.tabId) editorHandle?.focus();
        onSettled();
      };
      if (point.tabId !== activeTabId() || !editorHandle) {
        queueNavigationRestore(point, finish);
        if (point.tabId !== activeTabId()) setActiveTabId(point.tabId);
        return;
      }
      editorHandle.setLocation(point, finish);
    },
    tabExists: (tabId) => tabs().some((tab) => tab.id === tabId),
  });

  function rememberCurrentLocation() {
    const point = currentNavigationPoint();
    if (point) editorNavigation.remember(point);
  }

  const openTabIdKey = createMemo(() => tabs().map((tab) => tab.id).join("\0"));
  createEffect(() => {
    const key = openTabIdKey();
    editorNavigation.prune(new Set(key ? key.split("\0") : []));
  });
  createEffect(() => {
    discardStaleNavigationRestore(activeTabId());
  });

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
  const { savedQueries, saveQuery, deleteQuery, renameQuery, loadQueryContent } =
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
  const [pendingDisconnect, setPendingDisconnect] = createSignal(false);
  const [isSidebarOpen, setIsSidebarOpen] = createSignal(true);
  const [explorerWidth, setExplorerWidth] = createSignal(325);
  const [theme, setTheme] = createSignal(loadTheme());
  const [isObjectJumpOpen, setIsObjectJumpOpen] = createSignal(false);
  const [exitConfirm, setExitConfirm] = createSignal<{
    reason: "executing" | "unsaved";
  } | null>(null);
  const [backupRestoreDatabase, setBackupRestoreDatabase] = createSignal<
    string | null
  >(null);
  const [objectJumpIndexStatus, setObjectJumpIndexStatus] =
    createSignal<ServerObjectIndexStatus>(EMPTY_OBJECT_INDEX_STATUS);
  const [aiChatOpen, setAiChatOpen] = createSignal(
    localStorage.getItem("sqlqs_ai_chat_open") === "true",
  );
  const [hasAiKey, setHasAiKey] = createSignal(false);
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
  const [compareTarget, setCompareTarget] = createSignal<{
    database: string;
    schema: string;
    table: string;
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

  const handleShowCompareData = (
    database: string,
    schema: string,
    table: string,
  ) => {
    setCompareTarget({ database, schema, table });
  };

  createEffect(() => {
    localStorage.setItem("sqlqs_ai_chat_open", String(aiChatOpen()));
  });

  createEffect(() => {
    if (isSettingsOpen()) return;
    void AiService.getStatus()
      .then((status) => setHasAiKey(status.hasKey))
      .catch(() => setHasAiKey(false));
  });

  function handleToggleAiChat() {
    if (!connected() || !hasAiKey() || tabs().length === 0) return;
    setAiChatOpen((prev) => !prev);
  }

  function handleToggleSidebar() {
    if (
      !connected() ||
      isInitializing() ||
      isSettingsOpen() ||
      isAnyDialogOpen()
    ) {
      return;
    }
    setIsSidebarOpen((prev) => !prev);
  }

  function handleWindowClose() {
    const executing = tabs().some((t) => t.isExecuting);
    if (executing) {
      setExitConfirm({ reason: "executing" });
      return;
    }

    const prefs = loadPreferences();
    const hasDirtyTabs =
      prefs.confirmCloseUnsaved &&
      !prefs.persistTabs &&
      tabs().some((t) => t.sql !== t.savedSql);
    if (hasDirtyTabs) {
      setExitConfirm({ reason: "unsaved" });
      return;
    }

    void invoke("close_window");
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
    const handleThemeChanged = (event: Event) => {
      const detail = (event as CustomEvent<ThemeSelection>).detail;
      if (detail?.id && detail?.mode) {
        setTheme(detail);
        return;
      }
      setTheme(loadTheme());
    };
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_CHANGED_EVENT, handleThemeChanged);
    onCleanup(() => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_CHANGED_EVENT, handleThemeChanged);
    });
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
      let hasSelection: boolean;
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
            } catch { /* empty */ }
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

  const executeGenerations = new Map<string, number>();

  async function handleExecute(tabId: string, selectedSql?: string) {
    const tab = tabs().find((t) => t.id === tabId);
    if (!tab || tab.isExecuting) return;

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
    const generation = (executeGenerations.get(tabId) ?? 0) + 1;
    executeGenerations.set(tabId, generation);
    const isCurrent = () => executeGenerations.get(tabId) === generation;

    updateTab(tabId, {
      isExecuting: true,
      error: undefined,
      errorTone: undefined,
      execStartedAt: performance.now(),
    });
    const taskbarOperation = startTaskbarOperation();

    try {
      const result: QueryResult = await invoke("execute_query", {
        queryId: tabId,
        sql: sqlToExecute,
        maxRows: execPrefs.maxRows > 0 ? execPrefs.maxRows : null,
        timeoutSeconds:
          execPrefs.timeoutSeconds > 0 ? execPrefs.timeoutSeconds : null,
      });
      if (!isCurrent()) {
        taskbarOperation.complete();
        return;
      }
      taskbarOperation.complete();
      const updates: Partial<QueryTab> = {
        result,
        isExecuting: false,
        errorTone: undefined,
        execStartedAt: undefined,
      };
      if (!tab.userTitle) {
        const generatedTitle = generateTabTitle(sqlToExecute);
        if (generatedTitle) {
          updates.title = generatedTitle;
        }
      }
      updateTab(tabId, updates);
      addHistory(sqlToExecute, updates.title || tab.title, currentDatabase());
      if (!tab.userTitle) {
        requestAutoTabTitle(tabId, sqlToExecute);
      }
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
      if (!isCurrent()) {
        taskbarOperation.complete();
        return;
      }
      const message = String(err);
      const isCancelled =
        message === "Query cancelled by user" ||
        message === "Query cancelled";
      updateTab(tabId, {
        error: message,
        errorTone: isCancelled ? "cancelled" : "error",
        isExecuting: false,
        execStartedAt: undefined,
      });
      taskbarOperation.fail();
    }
  }

  async function handleCancelQuery(tabId: string) {
    executeGenerations.set(tabId, (executeGenerations.get(tabId) ?? 0) + 1);
    try {
      await invoke("cancel_query", { queryId: tabId });
    } catch (err) {
      console.error("Failed to cancel query:", err);
    }
    updateTab(tabId, {
      isExecuting: false,
      error: "Query cancelled by user",
      errorTone: "cancelled",
      execStartedAt: undefined,
    });
  }

  function requestDisconnect() {
    if (tabs().some((t) => t.isExecuting)) {
      setPendingDisconnect(true);
      return;
    }
    void disconnect();
  }

  async function handleDatabaseChange(db: string) {
    const ok = await changeDatabase(db);
    if (!ok) {
      toast.error(`Failed to switch to database "${db}".`);
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
    switchDatabase = true,
  }: {
    sql: string;
    execute?: boolean;
    title?: string;
    database?: string;
    sourceId?: string;
    preserveTitle?: boolean;
    temporary?: boolean;
    switchDatabase?: boolean;
  }): string {
    if (switchDatabase && database && database !== currentDatabase()) {
      void handleDatabaseChange(database);
    }

    rememberCurrentLocation();
    const tabId = addTab(sql, title, sourceId, preserveTitle, { temporary });
    if (execute) {
      setTimeout(() => handleExecute(tabId, sql), 0);
    }
    return tabId;
  }

  function handleTabAdd(sql?: string, title?: string, groupId?: string) {
    rememberCurrentLocation();
    return addTab(
      sql ?? "",
      title,
      undefined,
      undefined,
      groupId ? { groupId } : undefined,
    );
  }

  async function handleOpenQueryGroup(
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
  ) {
    const tabIds: string[] = [];
    let targetDatabase: string | undefined;
    for (const item of items) {
      let sql = item.sql ?? "";
      if (item.savedQueryFilePath) {
        const content = await loadQueryContent(item.savedQueryFilePath);
        if (content) sql = content;
      } else if (
        !sql &&
        item.database &&
        item.schema &&
        item.name
      ) {
        sql = `SELECT TOP 100 * FROM [${item.database}].[${item.schema}].[${item.name}]`;
      }
      if (!sql.trim()) continue;
      if (targetDatabase === undefined && item.database) {
        targetDatabase = item.database;
      }
      const tabId = handleOpenQueryTab({
        sql,
        title: item.title,
        database: item.database,
        sourceId: item.sourceId,
        preserveTitle: Boolean(item.title),
        temporary: false,
        switchDatabase: false,
      });
      if (tabId) tabIds.push(tabId);
    }
    if (targetDatabase && targetDatabase !== currentDatabase()) {
      await handleDatabaseChange(targetDatabase);
    }
    if (tabIds.length >= 2) {
      createGroup(tabIds, groupName);
      setActiveTabId(tabIds[0]);
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
        rememberCurrentLocation();
        addTab(content, title || undefined);
        toast.success(`Opened ${file.name}`);
      } catch (error) {
        console.error("Failed to open SQL file:", error);
        toast.error(`Failed to open ${file.name}: ${String(error)}`);
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

      rememberCurrentLocation();
      addTab(file.content, file.file_name, `file:${file.path}`, true);
      void invoke("add_to_recent_docs", { path: file.path }).catch(() => undefined);
      toast.success(`Opened ${file.file_name}`);
    } catch (error) {
      console.error("Failed to open SQL file from path:", error);
      toast.error(`Failed to open file: ${String(error)}`);
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

    const saved = await saveQuery(tab.title, tab.sql);
    if (!saved) {
      toast.error(`Failed to save query "${tab.title}".`);
      return;
    }
    promoteTab(tabId);
    updateTab(tabId, { savedSql: tab.sql });
  }

  async function saveSqlContentToFile(title: string, sql: string) {
    if (!sql.trim()) {
      return false;
    }

    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const lastFolder = localStorage.getItem(
        LAST_SQL_EXPORT_FOLDER_STORAGE_KEY,
      );
      const fileName = getSqlFileName(title);
      const filePath = await save({
        title: "Save SQL file",
        defaultPath: lastFolder ? joinPath(lastFolder, fileName) : fileName,
        filters: [{ name: "SQL", extensions: ["sql"] }],
      });

      if (!filePath) {
        return false;
      }

      await invoke<string>("write_sql_file", {
        path: filePath,
        content: sql,
      });

      const lastSep = Math.max(
        filePath.lastIndexOf("/"),
        filePath.lastIndexOf("\\"),
      );
      if (lastSep > 0) {
        localStorage.setItem(
          LAST_SQL_EXPORT_FOLDER_STORAGE_KEY,
          filePath.slice(0, lastSep),
        );
      }

      toast.success(`Saved to ${baseFileName(filePath)}`);
      return true;
    } catch (error) {
      console.error("Failed to save SQL file:", error);
      toast.error(`Failed to save SQL file: ${String(error)}`);
      return false;
    }
  }

  async function handleTabSaveToFile(tabId: string) {
    const tab = tabs().find((t) => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    if (!(await saveSqlContentToFile(tab.title, tab.sql))) {
      return;
    }

    promoteTab(tabId);
    updateTab(tabId, { savedSql: tab.sql });
  }

  async function handleSaveSavedQueryToFile(filePath: string, title: string) {
    const content = await loadQueryContent(filePath);
    if (!content) {
      toast.error("Failed to load saved query.");
      return;
    }
    await saveSqlContentToFile(title, content);
  }

  async function handleLoadSavedQuery(filePath: string, title: string) {
    const content = await loadQueryContent(filePath);
    if (content) {
      rememberCurrentLocation();
      addTab(content, title, `saved:${filePath}`, true, { temporary: true });
    }
  }

  async function handleDeleteSavedQuery(id: string) {
    if (!(await deleteQuery(id))) {
      toast.error("Failed to delete saved query.");
    }
  }

  async function handleRenameSavedQuery(id: string, title: string) {
    const query = savedQueries().find((q) => q.id === id);
    if (!query) {
      return false;
    }

    try {
      const updated = await renameQuery(id, title);
      if (!updated) {
        return false;
      }

      const oldSourceId = `saved:${query.filePath}`;
      const nextSourceId = `saved:${updated.filePath}`;
      for (const tab of tabs()) {
        if (tab.sourceId !== oldSourceId) {
          continue;
        }
        updateTab(tab.id, {
          title: updated.title,
          sourceId: nextSourceId,
          userTitle: true,
        });
      }
      return true;
    } catch (err) {
      toast.error(String(err));
      return false;
    }
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
    !!compareTarget() ||
    !!pendingRisky() ||
    !!pendingDisconnect() ||
    !!exitConfirm();
  const canOpenObjectJump = () => connected();

  function handleToggleObjectJump() {
    if (!canOpenObjectJump() || hasBlockingDialog()) {
      return;
    }

    setIsObjectJumpOpen((prev) => !prev);
  }

  onMount(() => {
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    const subscribe = (listenFn: () => Promise<() => void>) => {
      void listenFn()
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlistens.push(fn);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            console.error("Failed to register SQL file handlers:", error);
          }
        });
    };

    subscribe(() =>
      listen<string>("sql-file-opened", async (event) => {
        await handleOpenSqlFilePath(event.payload);
      }),
    );
    subscribe(() =>
      listen<{ paths: string[] }>("tauri://drag-drop", async (event) => {
        const paths = event.payload.paths;
        if (!Array.isArray(paths)) return;
        for (const path of paths) {
          await handleOpenSqlFilePath(path);
        }
      }),
    );

    void (async () => {
      try {
        const startupPath = await invoke<string | null>(
          "get_startup_sql_file_path",
        );
        if (!cancelled && startupPath) {
          await handleOpenSqlFilePath(startupPath);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to open startup SQL file:", error);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
      for (const unlisten of unlistens) unlisten();
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
      const devtoolsShortcut =
        event.key === "F12" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey;
      const chromiumDevToolsShortcut =
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "i";
      if (devtoolsShortcut || chromiumDevToolsShortcut) {
        event.preventDefault();
        void invoke("open_devtools");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  createEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (
        event.key === "F5" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey
      ) {
        if (isAnyDialogOpen()) return;
        const tab = tabs().find((t) => t.id === activeTabId());
        if (
          !tab ||
          !connected() ||
          !currentDatabase() ||
          !tab.sql.trim() ||
          tab.isExecuting
        ) {
          return;
        }
        event.preventDefault();
        void handleExecute(tab.id);
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "s"
      ) {
        if (isAnyDialogOpen()) return;
        const tab = tabs().find((t) => t.id === activeTabId());
        if (!tab || !tab.sql.trim()) return;
        event.preventDefault();
        void handleTabSave(tab.id);
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isSettingsOpen() || isAnyDialogOpen()) return;

      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (!mod || event.shiftKey || key !== "b") return;

      if (event.altKey) {
        if (!connected() || !hasAiKey() || tabs().length === 0) return;
        event.preventDefault();
        handleToggleAiChat();
        return;
      }

      if (getTextEditableTarget(event.target)) return;

      if (!connected() || isInitializing()) return;
      event.preventDefault();
      handleToggleSidebar();
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
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

  createEffect(() => {
    const settingsOpen = isSettingsOpen();
    const dialogOpen = isAnyDialogOpen();
    const connectedNow = connected();

    const shouldIgnore = () => settingsOpen || dialogOpen || !connectedNow;

    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnore() || event.defaultPrevented) return;
      if (isTabRenameTarget(event.target)) return;
      if (isGoBackKey(event)) {
        if (editorNavigation.canGoBack()) {
          event.preventDefault();
          editorNavigation.goBack();
        } else if (!isCodeMirrorTarget(event.target)) {
          event.preventDefault();
        }
        return;
      }
      if (isGoForwardKey(event)) {
        if (editorNavigation.canGoForward()) {
          event.preventDefault();
          editorNavigation.goForward();
        } else if (!isCodeMirrorTarget(event.target)) {
          event.preventDefault();
        }
      }
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!isMouseBackButton(event) && !isMouseForwardButton(event)) return;
      if (shouldIgnore()) return;
      event.preventDefault();
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!isMouseBackButton(event) && !isMouseForwardButton(event)) return;
      if (shouldIgnore()) return;
      event.preventDefault();
      if (isMouseBackButton(event)) {
        if (editorNavigation.canGoBack()) editorNavigation.goBack();
      } else if (editorNavigation.canGoForward()) {
        editorNavigation.goForward();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mouseup", onMouseUp, true);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mouseup", onMouseUp, true);
    });
  });

  return (
    <div class="app-shell app-material-shell flex h-screen w-screen relative flex-col overflow-hidden font-sans text-text selection:bg-accent/30 selection:text-accent-text">
      <TitleBar
        connected={connected()}
        isInitializing={isInitializing()}
        serverName={serverName()}
        onConnect={() => setIsConnectionDialogOpen(true)}
        onDisconnect={requestDisconnect}
        onOpenSqlFile={handleOpenSqlFile}
        onShowBackupRestore={() =>
          setBackupRestoreDatabase(currentDatabase() || databases()[0] || "")
        }
        onShowSettings={() => setIsSettingsOpen(true)}
        onHideSettings={() => setIsSettingsOpen(false)}
        settingsDisabled={isSettingsOpen()}
        onToggleSidebar={handleToggleSidebar}
        sidebarVisible={connected() && !isInitializing() && isSidebarOpen()}
        sidebarWidth={explorerWidth()}
        dialogOpen={isAnyDialogOpen()}
        aiChatOpen={aiChatOpen()}
        onToggleAiChat={handleToggleAiChat}
        onToggleObjectJump={handleToggleObjectJump}
        objectJumpOpen={isObjectJumpOpen()}
        objectJumpIndexStatus={objectJumpIndexStatus()}
        hideAppContent={isSettingsOpen()}
        onRequestClose={handleWindowClose}
        updateAvailable={!!updateAvailable()}
        onViewUpdateDetails={() => setUpdateDialogVisible(true)}
        hasTabs={tabs().length > 0}
        hasAiKey={hasAiKey()}
        canGoBack={editorNavigation.canGoBack()}
        canGoForward={editorNavigation.canGoForward()}
        onGoBack={editorNavigation.goBack}
        onGoForward={editorNavigation.goForward}
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
                  class="w-[325px] mr-[var(--layout-gap)] app-sidebar-surface flex-shrink-0 overflow-hidden relative flex flex-col z-10 animate-in fade-in"
                >
                  {sidebar}
                </div>
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
            {connected() && !isInitializing() && isSidebarOpen() && (
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
                    onDatabaseChange={handleDatabaseChange}
                    currentDatabase={currentDatabase()}
                    executedQueries={executedQueries()}
                    onDeleteHistory={deleteHistory}
                    onClearHistory={clearHistory}
                    savedQueries={savedQueries()}
                    onDeleteSavedQuery={handleDeleteSavedQuery}
                    onRenameSavedQuery={handleRenameSavedQuery}
                    onLoadSavedQuery={handleLoadSavedQuery}
                    onOpenGroup={handleOpenQueryGroup}
                    onSaveSavedQueryToFile={handleSaveSavedQueryToFile}
                    onOpenSavedQueriesFolder={handleOpenSavedQueriesFolder}
                    onShowProperties={handleShowProperties}
                    onShowRename={handleShowRename}
                    onShowDrop={handleShowDrop}
                    onShowDependencies={handleShowDependencies}
                    onShowCompareData={handleShowCompareData}
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
                groups={groups()}
                activeTabId={activeTabId()}
                onTabChange={(id) => {
                  if (id !== activeTabId()) rememberCurrentLocation();
                  setActiveTabId(id);
                }}
                onTabAdd={handleTabAdd}
                onTabClose={closeTab}
                onTabCloseOthers={closeOtherTabs}
                onTabCloseAll={closeAllTabs}
                onTabUpdate={updateTab}
                onTabMove={moveTab}
                onTabDuplicate={duplicateTab}
                onTabTogglePin={togglePin}
                onTabPromote={promoteTab}
                onTabReopen={reopenClosedTab}
                canReopenClosedTab={canReopenClosedTab}
                onTabCreateGroup={createGroup}
                onTabAddToGroup={addTabsToGroup}
                onTabRemoveFromGroup={removeTabsFromGroup}
                onGroupRename={renameGroup}
                onGroupSetColor={setGroupColor}
                onGroupToggleCollapsed={toggleGroupCollapsed}
                onRevealTab={revealTab}
                onGroupUngroup={ungroupGroup}
                onGroupClose={closeGroup}
                onOpenSqlFile={handleOpenSqlFile}
                onExecute={handleExecute}
                onCancelQuery={handleCancelQuery}
                onConnect={() => setIsConnectionDialogOpen(true)}
                connected={connected()}
                isInitializing={isInitializing()}
                serverName={serverName()}
                currentDatabase={currentDatabase()}
                databases={databases()}
                onDatabaseChange={handleDatabaseChange}
                theme={theme()}
                aiChatOpen={aiChatOpen()}
                onAiChatOpenChange={setAiChatOpen}
                onSave={handleTabSave}
                onSaveToFile={handleTabSaveToFile}
                executedQueries={executedQueries()}
                dialogOpen={isAnyDialogOpen()}
                onNavigationPoint={editorNavigation.remember}
                onEditorHandle={(handle) => {
                  editorHandle = handle;
                }}
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
        databases={databases()}
        indexStatus={objectJumpIndexStatus()}
        onClose={() => setIsObjectJumpOpen(false)}
        onSelect={(selection: ObjectJumpSelection) =>
          handleOpenQueryTab(selection)
        }
        onShowProperties={handleShowProperties}
        onShowRename={handleShowRename}
        onShowDrop={handleShowDrop}
        onShowDependencies={handleShowDependencies}
        onShowCompareData={handleShowCompareData}
      />

      <Show when={compareTarget()}>
        {(target) => (
          <TableCompareDialog
            sourceDatabase={target().database}
            schema={target().schema}
            table={target().table}
            databases={databases()}
            onClose={() => setCompareTarget(null)}
            onOpenQuery={(sql, title) => {
              handleOpenQueryTab({
                sql,
                title,
                database: target().database,
                switchDatabase: false,
              });
            }}
          />
        )}
      </Show>

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

      <Show when={pendingDisconnect()}>
        <ConfirmDialog
          title="Disconnect while query running?"
          message="A query is still executing. Disconnecting now will interrupt it. Disconnect anyway?"
          confirmLabel="Disconnect"
          variant="danger"
          onConfirm={() => {
            setPendingDisconnect(false);
            void disconnect();
          }}
          onCancel={() => setPendingDisconnect(false)}
        />
      </Show>

      <Show when={exitConfirm()}>
        {(confirm) => (
          <ConfirmDialog
            title={
              confirm().reason === "executing"
                ? "Query still running"
                : "Unsaved queries"
            }
            message={
              confirm().reason === "executing"
                ? "A query is still executing. Closing now will interrupt it. Close anyway?"
                : "You have unsaved query tabs. Closing now will discard them. Close anyway?"
            }
            confirmLabel="Close anyway"
            variant={confirm().reason === "executing" ? "danger" : "primary"}
            onConfirm={() => {
              setExitConfirm(null);
              void invoke("close_window");
            }}
            onCancel={() => setExitConfirm(null)}
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

      <Toaster />
    </div>
  );
}
