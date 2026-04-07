import { useCallback, useEffect, useRef, useState } from "react";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { useConnection } from "../hooks/useConnection";
import { useHistory } from "../hooks/useHistory";
import { useSavedQueries } from "../hooks/useSavedQueries";
import { useTabs } from "../hooks/useTabs";
import { getSavedQueriesDir, joinPath } from "../lib/path";
import { getPlatformClass } from "../lib/platform";
import { generateTabTitle } from "../lib/sql";
import { loadTheme } from "../lib/theme";
import type {
  ConnectionConfig,
  QueryResult,
  QueryTab,
  ServerObjectIndexStatus,
} from "../lib/types";
import ConnectionDialog from "./ConnectionDialog";
import ObjectExplorer from "./ObjectExplorer";
import ObjectJumpPalette, { type ObjectJumpSelection } from "./ObjectJumpPalette";
import QueryEditorPanel from "./QueryEditorPanel";
import SettingsView from "./SettingsView";
import TitleBar from "./TitleBar";
import UpdateDialog from "./UpdateDialog";

const EMPTY_OBJECT_INDEX_STATUS: ServerObjectIndexStatus = {
  initialized: false,
  indexing: false,
  database_count: 0,
  processed_database_count: 0,
  failed_databases: [],
  object_count: 0,
};

const LAST_SQL_EXPORT_FOLDER_STORAGE_KEY = "sqlqs_last_sql_export_folder";

function getSqlFileName(title: string): string {
  const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, "_").trim() || "Query";
  return /\.sql$/i.test(sanitizedTitle) ? sanitizedTitle : `${sanitizedTitle}.sql`;
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

  const { executedQueries, addHistory, deleteHistory, clearHistory } = useHistory();
  const { savedQueries, saveQuery, deleteQuery, loadQueryContent } = useSavedQueries();
  const { appVersion, updateStatus, updateAvailable, checkForUpdates, installUpdate, cancelUpdate } = useAppUpdater();

  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(325);
  const [theme, setTheme] = useState(loadTheme());
  const [isObjectJumpOpen, setIsObjectJumpOpen] = useState(false);
  const [objectJumpIndexStatus, setObjectJumpIndexStatus] = useState<ServerObjectIndexStatus>(
    EMPTY_OBJECT_INDEX_STATUS,
  );
  const [aiChatOpen, setAiChatOpen] = useState(() => {
    return localStorage.getItem("sqlqs_ai_chat_open") === "true";
  });

  const handleToggleAiChat = useCallback(() => {
    setAiChatOpen((prev) => {
      const next = !prev;
      localStorage.setItem("sqlqs_ai_chat_open", String(next));
      return next;
    });
  }, []);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          getCurrentWindow().show();
        });
      });
    });
  }, []);

  useEffect(() => {
    const handleStorage = () => setTheme(loadTheme());
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    const platformClass = getPlatformClass();
    document.documentElement.dataset.platform = platformClass;

    return () => {
      delete document.documentElement.dataset.platform;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void checkForUpdates(false);
    }, 5000);

    return () => {
      clearTimeout(timer);
    };
  }, [checkForUpdates]);

  const handleConnect = useCallback((config: ConnectionConfig) => {
    connect(config);
    setIsConnectionDialogOpen(false);
  }, [connect]);

  const handleExecute = useCallback(
    async (tabId: string, selectedSql?: string) => {
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;

      const sqlToExecute = (selectedSql || tab.sql).trim();
      if (!sqlToExecute) return;

      updateTab(tabId, { isExecuting: true, error: undefined });

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const result: QueryResult = await invoke("execute_query", {
          sql: sqlToExecute,
        });
        const updates: Partial<QueryTab> = { result, isExecuting: false };
        if (!tab.userTitle) {
          const generatedTitle = generateTabTitle(sqlToExecute);
          if (generatedTitle) {
            updates.title = generatedTitle;
          }
        }
        updateTab(tabId, updates);
        addHistory(sqlToExecute, updates.title || tab.title, currentDatabase);
      } catch (err: any) {
        updateTab(tabId, { error: String(err), isExecuting: false });
      }
    },
    [tabs, updateTab, addHistory, currentDatabase],
  );

  const handleOpenQueryTab = useCallback(
    ({
      sql,
      execute,
      title,
      database,
      sourceId,
      preserveTitle,
    }: {
      sql: string;
      execute?: boolean;
      title?: string;
      database?: string;
      sourceId?: string;
      preserveTitle?: boolean;
    }) => {
      if (database && database !== currentDatabase) {
        changeDatabase(database);
      }

      const tabId = addTab(sql, title, sourceId, preserveTitle);
      if (execute) {
        setTimeout(() => handleExecute(tabId, sql), 0);
      }
    },
    [addTab, changeDatabase, currentDatabase, handleExecute],
  );

  const handleOpenSqlFile = useCallback(() => {
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
  }, [addTab]);

  const handleOpenSqlFilePath = useCallback(
    async (path: string) => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const file = await invoke<{
          path: string;
          file_name: string;
          content: string;
        }>("read_sql_file", { path });

        addTab(file.content, file.file_name, `file:${file.path}`, true);
      } catch (error) {
        console.error("Failed to open SQL file from path:", error);
      }
    },
    [addTab],
  );

  const handleExplorerResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = explorerWidth;

      const onMove = (ev: MouseEvent) => {
        const newWidth = Math.max(325, Math.min(500, startWidth + ev.clientX - startX));
        setExplorerWidth(newWidth);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [explorerWidth],
  );

  const handleTabSave = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || !tab.sql.trim()) return;

      await saveQuery(tab.title, tab.sql);
      updateTab(tabId, { savedSql: tab.sql });
    },
    [tabs, saveQuery, updateTab],
  );

  const handleTabSaveToFile = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab || !tab.sql.trim()) return;

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const lastFolder = localStorage.getItem(LAST_SQL_EXPORT_FOLDER_STORAGE_KEY);
        const documentsPath = await invoke<string>("get_documents_folder");
        const folderPath = await invoke<string | null>("pick_folder_dialog", {
          title: "Choose a folder for your SQL file",
          startingDirectory: lastFolder || documentsPath,
        });

        if (!folderPath) {
          return;
        }

        const filePath = joinPath(folderPath, getSqlFileName(tab.title));
        await invoke<string>("write_sql_file", { path: filePath, content: tab.sql });

        localStorage.setItem(LAST_SQL_EXPORT_FOLDER_STORAGE_KEY, folderPath);
        updateTab(tabId, { savedSql: tab.sql });
      } catch (error) {
        console.error("Failed to save SQL file to chosen folder:", error);
      }
    },
    [tabs, updateTab],
  );

  const handleLoadSavedQuery = useCallback(
    async (filePath: string, title: string) => {
      const content = await loadQueryContent(filePath);
      if (content) {
        addTab(content, title, `saved:${filePath}`, true);
      }
    },
    [addTab, loadQueryContent],
  );

  const handleDeleteSavedQuery = useCallback(
    async (id: string) => {
      await deleteQuery(id);
    },
    [deleteQuery],
  );

  const handleOpenSavedQueriesFolder = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const documentsPath = await invoke<string>("get_documents_folder");
      const folderPath = getSavedQueriesDir(documentsPath);
      await invoke("open_folder", { path: folderPath });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, []);

  const hasBlockingDialog = isConnectionDialogOpen || isSettingsOpen || !!updateAvailable;
  const canOpenObjectJump = connected;

  const handleToggleObjectJump = useCallback(() => {
    if (!canOpenObjectJump || hasBlockingDialog) {
      return;
    }

    setIsObjectJumpOpen((prev) => !prev);
  }, [canOpenObjectJump, hasBlockingDialog]);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const [{ invoke }, { listen }] = await Promise.all([
          import("@tauri-apps/api/core"),
          import("@tauri-apps/api/event"),
        ]);

        const startupPath = await invoke<string | null>("get_startup_sql_file_path");
        if (isMounted && startupPath) {
          await handleOpenSqlFilePath(startupPath);
        }

        unlisten = await listen<string>("sql-file-opened", async (event) => {
          await handleOpenSqlFilePath(event.payload);
        });
      } catch (error) {
        console.error("Failed to register SQL file handlers:", error);
      }
    })();

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, [handleOpenSqlFilePath]);

  useEffect(() => {
    if (isObjectJumpOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        handleOpenSqlFile();
      }
      if (event.key === ",") {
        event.preventDefault();
        setIsSettingsOpen((prev) => !prev);
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenSqlFile, isObjectJumpOpen]);

  useEffect(() => {
    if (!canOpenObjectJump || hasBlockingDialog) {
      setIsObjectJumpOpen(false);
    }
  }, [canOpenObjectJump, hasBlockingDialog]);

  useEffect(() => {
    if (!connected || isInitializing || objectJumpIndexStatus.initialized) {
      return;
    }

    let cancelled = false;
    let idleHandle: number | undefined;

    const startIndexingInBackground = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const status = await invoke<ServerObjectIndexStatus>("start_server_object_indexing");

        if (!cancelled) {
          setObjectJumpIndexStatus(status);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to start background object indexing:", error);
        }
      }
    };

    const timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(() => {
          void startIndexingInBackground();
        }, { timeout: 2000 });
        return;
      }

      void startIndexingInBackground();
    }, 900);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (idleHandle !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleHandle);
      }
    };
  }, [connected, isInitializing, objectJumpIndexStatus.initialized]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canOpenObjectJump || hasBlockingDialog) {
        return;
      }

      const key = event.key.toLowerCase();
      const isObjectJumpHotkey =
        ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && key === "f") ||
        ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === "p");

      if (isObjectJumpHotkey) {
        event.preventDefault();
        setIsObjectJumpOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canOpenObjectJump, hasBlockingDialog]);

  useEffect(() => {
    if (!connected) {
      setObjectJumpIndexStatus(EMPTY_OBJECT_INDEX_STATUS);
      return;
    }

    if (!isObjectJumpOpen && !objectJumpIndexStatus.indexing) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const syncIndexStatus = async (startIndexing: boolean) => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const status = await invoke<ServerObjectIndexStatus>(
          startIndexing ? "start_server_object_indexing" : "get_server_object_index_status",
        );

        if (cancelled) {
          return;
        }

        setObjectJumpIndexStatus(status);

        if (status.indexing) {
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

    void syncIndexStatus(isObjectJumpOpen && !objectJumpIndexStatus.initialized);

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [connected, isObjectJumpOpen, objectJumpIndexStatus.indexing, objectJumpIndexStatus.initialized]);

  const isAnyDialogOpen = hasBlockingDialog || isObjectJumpOpen;

  return (
    <div className="app-shell app-material-shell flex h-screen w-screen relative flex-col overflow-hidden font-sans text-text selection:bg-accent/30 selection:text-white">
      <TitleBar
        connected={connected}
        isInitializing={isInitializing}
        serverName={serverName}
        onConnect={() => setIsConnectionDialogOpen(true)}
        onDisconnect={disconnect}
        onOpenSqlFile={handleOpenSqlFile}
        onShowSettings={() => setIsSettingsOpen(true)}
        onHideSettings={() => setIsSettingsOpen(false)}
        settingsDisabled={isSettingsOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        sidebarVisible={isSidebarOpen}
        sidebarWidth={explorerWidth}
        dialogOpen={isAnyDialogOpen}
        tabs={tabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        onTabAdd={addTab}
        onTabClose={closeTab}
        onTabCloseOthers={closeOtherTabs}
        onTabCloseAll={closeAllTabs}
        onTabUpdate={updateTab}
        onTabReorder={reorderTabs}
        onTabDuplicate={duplicateTab}
        onTabTogglePin={togglePin}
        onTabSave={handleTabSave}
        aiChatOpen={aiChatOpen}
        onToggleAiChat={handleToggleAiChat}
        onToggleObjectJump={handleToggleObjectJump}
        objectJumpOpen={isObjectJumpOpen}
        objectJumpEnabled={canOpenObjectJump}
        objectJumpIndexStatus={objectJumpIndexStatus}
        hideAppContent={isSettingsOpen}
      />

      <div className="app-workspace flex flex-1 overflow-hidden relative">
        {isSettingsOpen ? (
          <SettingsView
            onClose={() => setIsSettingsOpen(false)}
            version={appVersion}
            onCheckForUpdates={() => checkForUpdates(true)}
            checkingForUpdates={updateStatus.checking}
            updateMessage={updateStatus.message}
            updateMessageTone={updateStatus.tone}
            onThemeChange={setTheme}
            renderLayout={(sidebar, content) => (
              <>
                <div style={{ width: explorerWidth }} className="app-sidebar-surface flex-shrink-0 overflow-hidden relative flex flex-col z-10 animate-in fade-in">
                  {sidebar}
                </div>
                <div className="resizer resizer-h" onMouseDown={handleExplorerResize} />
                <main className={`flex-1 flex flex-col overflow-hidden bg-surface-panel rounded-tl-2xl border-t border-l-0 border-[color-mix(in_srgb,var(--color-border)_50%,transparent)] relative`}>
                  <div className="flex-1 w-full h-full p-8 md:p-12 overflow-y-auto animate-in fade-in duration-[var(--duration-slow)]">
                    {content}
                  </div>
                </main>
              </>
            )}
          />
        ) : (
          <>
            {connected && isSidebarOpen && (
              <>
                <div style={{ width: explorerWidth }} className="app-sidebar-surface flex-shrink-0 overflow-hidden relative z-10">
                  <ObjectExplorer
                    databases={databases}
                    onRefreshDatabases={refreshDatabases}
                    onSelect={(sql, execute, title, database, sourceId) => {
                      handleOpenQueryTab({ sql, execute, title, database, sourceId });
                    }}
                    onDatabaseChange={changeDatabase}
                    currentDatabase={currentDatabase}
                    executedQueries={executedQueries}
                    onDeleteHistory={deleteHistory}
                    onClearHistory={clearHistory}
                    savedQueries={savedQueries}
                    onDeleteSavedQuery={handleDeleteSavedQuery}
                    onLoadSavedQuery={handleLoadSavedQuery}
                    onOpenSavedQueriesFolder={handleOpenSavedQueriesFolder}
                  />
                </div>
                <div className="resizer resizer-h" onMouseDown={handleExplorerResize} />
              </>
            )}

            <main className={`flex-1 flex flex-col overflow-hidden bg-surface-panel ${isSidebarOpen && connected ? 'rounded-tl-2xl border-t border-l-0' : 'rounded-none border-l border-t'} border-[color-mix(in_srgb,var(--color-border)_50%,transparent)] relative transition-colors duration-[var(--duration-slow)]`}>
              <QueryEditorPanel
                tabs={tabs}
                activeTabId={activeTabId}
                onTabAdd={addTab}
                onOpenSqlFile={handleOpenSqlFile}
                onTabUpdate={updateTab}
                onExecute={handleExecute}
                onConnect={() => setIsConnectionDialogOpen(true)}
                connected={connected}
                isInitializing={isInitializing}
                currentDatabase={currentDatabase}
                databases={databases}
                onDatabaseChange={changeDatabase}
                theme={theme}
                aiChatOpen={aiChatOpen}
                onAiChatOpenChange={setAiChatOpen}
                onSave={handleTabSave}
                onSaveToFile={handleTabSaveToFile}
              />
            </main>
          </>
        )}
      </div>

      {isConnectionDialogOpen && (
        <ConnectionDialog
          onClose={() => setIsConnectionDialogOpen(false)}
          onConnect={handleConnect}
        />
      )}



      {updateAvailable && (
        <UpdateDialog
          version={updateAvailable.version}
          currentVersion={updateAvailable.currentVersion}
          onInstall={() => installUpdate(updateAvailable)}
          onCancel={() => cancelUpdate(updateAvailable)}
        />
      )}

      <ObjectJumpPalette
        open={isObjectJumpOpen}
        connected={connected}
        currentDatabase={currentDatabase}
        indexStatus={objectJumpIndexStatus}
        onClose={() => setIsObjectJumpOpen(false)}
        onSelect={(selection: ObjectJumpSelection) => handleOpenQueryTab(selection)}
      />
    </div>
  );
}
