import { useCallback, useEffect, useState } from "react";
import { useAppUpdater } from "../hooks/useAppUpdater";
import { useConnection } from "../hooks/useConnection";
import { useHistory } from "../hooks/useHistory";
import { useSavedQueries } from "../hooks/useSavedQueries";
import { useTabs } from "../hooks/useTabs";
import { loadTheme } from "../lib/theme";
import type { ConnectionConfig, QueryResult, QueryTab } from "../lib/types";
import { generateTabTitle } from "../lib/sql";
import ConnectionDialog from "./ConnectionDialog";
import ObjectExplorer from "./ObjectExplorer";
import QueryEditorPanel from "./QueryEditorPanel";
import SettingsDialog from "./SettingsDialog";
import TitleBar from "./TitleBar";
import UpdateDialog from "./UpdateDialog";

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
  } = useTabs();

  const {
    connected,
    serverName,
    currentDatabase,
    databases,
    connect,
    disconnect,
    changeDatabase,
  } = useConnection();

  const { executedQueries, addHistory, deleteHistory, clearHistory } = useHistory();
  const { savedQueries, saveQuery, deleteQuery, loadQueryContent } = useSavedQueries();
  const { appVersion, updateStatus, updateAvailable, checkForUpdates, installUpdate, cancelUpdate } = useAppUpdater();

  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(325);
  const [theme, setTheme] = useState(loadTheme());

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
    const timer = setTimeout(() => {
      checkForUpdates(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleConnect = useCallback((config: ConnectionConfig) => {
    connect(config);
    setIsConnectionDialogOpen(false);
  }, [connect]);

  const handleExecute = useCallback(
    async (tabId: string, selectedSql?: string) => {
      const tab = tabs.find((t) => t.id === tabId);
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
    },
    [tabs, saveQuery],
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
      const folderPath = `${documentsPath}\\SQL Query Studio\\Saved Queries`;
      await invoke("open_folder", { path: folderPath });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        handleOpenSqlFile();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleOpenSqlFile]);

  const isAnyDialogOpen = isConnectionDialogOpen || isSettingsDialogOpen || !!updateAvailable;

  return (
    <div className="flex h-screen w-screen relative flex-col overflow-hidden acrylic-panel bg-surface-panel/90 font-sans text-text selection:bg-accent/30 selection:text-white">
      <TitleBar
        connected={connected}
        serverName={serverName}
        onConnect={() => setIsConnectionDialogOpen(true)}
        onDisconnect={disconnect}
        onOpenSqlFile={handleOpenSqlFile}
        onShowSettings={() => setIsSettingsDialogOpen(true)}
        settingsDisabled={isSettingsDialogOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        sidebarVisible={isSidebarOpen}
        dialogOpen={isAnyDialogOpen}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {connected && isSidebarOpen && (
          <>
            <div style={{ width: explorerWidth }} className="flex-shrink-0 overflow-hidden relative">
              <ObjectExplorer
                onSelect={(sql, execute, title, database, sourceId) => {
                  if (database && database !== currentDatabase) {
                    changeDatabase(database);
                  }
                  const tabId = addTab(sql, title, sourceId);
                  if (execute) {
                    setTimeout(() => handleExecute(tabId, sql), 0);
                  }
                }}
                onCollapse={() => setIsSidebarOpen(false)}
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

        <main className={`flex-1 flex flex-col overflow-hidden bg-surface-panel ${isSidebarOpen && connected ? 'rounded-tl-2xl' : 'rounded-none'} border-l border-t border-[color-mix(in_srgb,var(--color-border)_50%,transparent)] relative transition-all duration-300`}>
          <QueryEditorPanel
            tabs={tabs}
            activeTabId={activeTabId}
            onTabChange={setActiveTabId}
            onTabAdd={addTab}
            onOpenSqlFile={handleOpenSqlFile}
            onTabClose={closeTab}
            onTabCloseAll={closeAllTabs}
            onTabCloseOthers={closeOtherTabs}
            onTabUpdate={updateTab}
            onTabSave={handleTabSave}
            onExecute={handleExecute}
            onConnect={() => setIsConnectionDialogOpen(true)}
            connected={connected}
            currentDatabase={currentDatabase}
            databases={databases}
            onDatabaseChange={changeDatabase}
            theme={theme}
          />
        </main>
      </div>

      {isConnectionDialogOpen && (
        <ConnectionDialog
          onClose={() => setIsConnectionDialogOpen(false)}
          onConnect={handleConnect}
        />
      )}

      {isSettingsDialogOpen && (
        <SettingsDialog
          onClose={() => setIsSettingsDialogOpen(false)}
          version={appVersion}
          onCheckForUpdates={() => checkForUpdates(true)}
          checkingForUpdates={updateStatus.checking}
          updateMessage={updateStatus.message}
          updateMessageTone={updateStatus.tone}
          onThemeChange={setTheme}
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
    </div>
  );
}
