import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryTab } from "../lib/types";
import { AiService } from "../lib/ai";
import { getModifierKeyLabel, isMacOS } from "../lib/platform";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import ConfirmDialog from "./ConfirmDialog";
import Tooltip from "./Tooltip";

function isWindowDragExcludedTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest(
      "button, input, select, textarea, a, [role='button'], [contenteditable='true'], .no-drag, [data-no-window-drag]",
    ),
  );
}

let currentWindowPromise: Promise<ReturnType<typeof import("@tauri-apps/api/window")["getCurrentWindow"]>> | null = null;

async function getCurrentAppWindow() {
  if (!currentWindowPromise) {
    currentWindowPromise = import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow());
  }

  return currentWindowPromise;
}

interface Props {
  connected: boolean;
  serverName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenSqlFile: () => void;
  onShowSettings: () => void;
  settingsDisabled?: boolean;
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  sidebarWidth?: number;
  dialogOpen?: boolean;
  tabs: QueryTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabAdd: (sql?: string, title?: string) => string;
  onTabClose: (id: string) => void;
  onTabCloseOthers: (id: string) => void;
  onTabCloseAll: () => void;
  onTabUpdate: (id: string, updates: Partial<QueryTab>) => void;
  onTabSave?: (id: string) => void;
  aiChatOpen: boolean;
  onToggleAiChat: () => void;
}

export default function TitleBar({
  connected,
  serverName,
  onConnect,
  onDisconnect,
  onOpenSqlFile,
  onShowSettings,
  settingsDisabled = false,
  onToggleSidebar,
  sidebarVisible = true,
  sidebarWidth = 325,
  dialogOpen = false,
  tabs,
  activeTabId,
  onTabChange,
  onTabAdd,
  onTabClose,
  onTabCloseOthers,
  onTabCloseAll,
  onTabUpdate,
  onTabSave,
  aiChatOpen,
  onToggleAiChat,
}: Props) {
  const isMac = isMacOS();
  const openFileShortcut = `${getModifierKeyLabel()}+O`;
  const newQueryShortcut = `${getModifierKeyLabel()}+N`;
  const hasAiKey = AiService.getStatus().hasKey;
  const [confirmClose, setConfirmClose] = useState<{
    type: "single" | "others" | "all";
    tabId?: string;
  } | null>(null);

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [tabContextMenu, setTabContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  const handleMinimize = useCallback(async () => {
    const win = await getCurrentAppWindow();
    await win.minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    const win = await getCurrentAppWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }, []);

  const handleClose = useCallback(async () => {
    const win = await getCurrentAppWindow();
    await win.close();
  }, []);

  const handleTitleBarMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isMac || event.button !== 0 || isWindowDragExcludedTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void getCurrentAppWindow()
      .then((win) => win.startDragging())
      .catch(() => undefined);
  }, [isMac]);

  const handleStartRename = useCallback((tab: QueryTab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
  }, []);

  const handleRename = useCallback((tabId: string) => {
    if (renameValue.trim()) {
      onTabUpdate(tabId, { title: renameValue.trim(), userTitle: true });
    }
    setRenamingTabId(null);
    setRenameValue("");
  }, [renameValue, onTabUpdate]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, tabId: string) => {
    if (e.key === "Enter") {
      handleRename(tabId);
    } else if (e.key === "Escape") {
      setRenamingTabId(null);
      setRenameValue("");
    }
  }, [handleRename]);

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  useEffect(() => {
    if (isMac) {
      void getCurrentAppWindow();
    }
  }, [isMac]);

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setTabContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }, []);

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: "close",
        label: "Close",
        icon: <i className="fa-solid fa-xmark" />,
        onClick: () => setConfirmClose({ type: "single", tabId }),
      },
      {
        id: "close-others",
        label: "Close Others",
        icon: <i className="fa-solid fa-rectangle-xmark" />,
        onClick: () => setConfirmClose({ type: "others", tabId }),
      },
      {
        id: "close-all",
        label: "Close All",
        icon: <i className="fa-solid fa-trash" />,
        onClick: () => setConfirmClose({ type: "all" }),
      },
    ];

    if (onTabSave) {
      items.push(
        { id: "sep-tab-1", separator: true },
        {
          id: "save-as",
          label: "Save As...",
          icon: <i className="fa-solid fa-floppy-disk" />,
          onClick: () => onTabSave(tabId),
        },
      );
    }

    return items;
  };

  return (
    <>
      <div
        data-tauri-drag-region
        className="app-titlebar flex items-center h-11 select-none flex-shrink-0 relative"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div 
          className="flex items-center h-full z-10 px-3 gap-1.5"
          style={{ width: sidebarVisible && connected ? sidebarWidth + 1 : 'auto' }}
        >
          {isMac && (
            <div className="mac-window-controls pr-2">
              <Tooltip content="Close" placement="bottom">
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close window"
                  className="mac-window-control mac-window-control-close"
                >
                  <i aria-hidden className="fa-solid fa-xmark" />
                </button>
              </Tooltip>
              <Tooltip content="Minimize" placement="bottom">
                <button
                  type="button"
                  onClick={handleMinimize}
                  aria-label="Minimize window"
                  className="mac-window-control mac-window-control-minimize"
                >
                  <i aria-hidden className="fa-solid fa-minus" />
                </button>
              </Tooltip>
              <Tooltip content="Zoom" placement="bottom">
                <button
                  type="button"
                  onClick={handleMaximize}
                  aria-label="Toggle zoom"
                  className="mac-window-control mac-window-control-zoom"
                >
                  <i aria-hidden className="fa-solid fa-plus" />
                </button>
              </Tooltip>
            </div>
          )}
          {onToggleSidebar && (
            <Tooltip content={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} placement="bottom">
              <button
                onClick={onToggleSidebar}
                disabled={dialogOpen || !connected}
                className={`w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default ${sidebarVisible ? "text-text-muted enabled:hover:text-text" : "text-accent"}`}
              >
                <i className="fa-solid fa-table-columns text-[13px]" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Settings" placement="bottom">
            <button
              onClick={onShowSettings}
              disabled={settingsDisabled || dialogOpen || !connected}
              className="text-text-muted enabled:hover:text-text w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <i className="fa-solid fa-gear text-[13px]" />
            </button>
          </Tooltip>
          <Tooltip content={`Open File (${openFileShortcut})`} placement="bottom">
            <button
              onClick={onOpenSqlFile}
              disabled={dialogOpen || !connected}
              className="text-text-muted enabled:hover:text-text w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <i className="fa-solid fa-folder-open text-[13px]" />
            </button>
          </Tooltip>

          <div className="w-px h-4 bg-white/10 mx-1 flex-shrink-0" />

          {connected ? (
            <Tooltip content="Click to disconnect" placement="bottom">
              <button
                onClick={onDisconnect}
                disabled={dialogOpen}
                className="flex items-center gap-2 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text transition-all group enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                <i className="fa-solid fa-server text-[11px]" />
                <span className="text-[11px] font-medium tracking-wide truncate max-w-[120px]">{serverName}</span>
              </button>
            </Tooltip>
          ) : (
            <button
              onClick={onConnect}
              disabled={dialogOpen}
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text text-[11px] font-medium transition-all enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <i className="fa-solid fa-plug" />
              Connect Server
            </button>
          )}
        </div>

        {tabs.length > 0 && (
          <div className="flex items-center min-w-0 flex-shrink overflow-hidden no-drag">
            <div
              ref={tabBarRef}
              onWheel={(e) => {
                if (tabBarRef.current) {
                  e.preventDefault();
                  tabBarRef.current.scrollLeft += e.deltaY;
                }
              }}
              className="flex overflow-x-auto winui-tab-bar min-w-0"
            >
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  ref={tab.id === activeTabId ? (el) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); } : undefined}
                  className={`winui-tab flex items-center gap-2 text-[12px] cursor-default whitespace-nowrap select-none flex-shrink-0 ${tab.id === activeTabId ? "active text-text font-medium" : "text-text-muted"}`}
                  onClick={() => onTabChange(tab.id)}
                  onDoubleClick={() => handleStartRename(tab)}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      setConfirmClose({ type: "single", tabId: tab.id });
                    }
                  }}
                  onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                >
                  <div className="flex-1 min-w-0 mr-2">
                    {renamingTabId === tab.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => handleRename(tab.id)}
                        onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
                        className="bg-transparent border-none outline-none text-[12px] w-full min-w-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="truncate block" data-text={tab.title}>{tab.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {tab.isExecuting && (
                      <span className="animate-pulse text-warning text-[10px]">&#9679;</span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmClose({ type: "single", tabId: tab.id });
                      }}
                      className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text cursor-pointer transition-colors"
                    >
                      <i className="fa-solid fa-xmark text-[10px]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="w-px h-4 bg-white/[0.08] flex-shrink-0" />
            <Tooltip content={`New Query (${newQueryShortcut})`} placement="bottom">
              <button
                onClick={() => {
                  onTabAdd();
                  requestAnimationFrame(() => {
                    if (tabBarRef.current) {
                      tabBarRef.current.scrollLeft = tabBarRef.current.scrollWidth;
                    }
                  });
                }}
                className="flex items-center gap-2 px-3 h-8 mx-2.5 text-text-muted hover:text-text hover:bg-white/10 rounded-lg transition-colors flex-shrink-0 cursor-pointer text-[12px] font-medium"
              >
                <i className="fa-solid fa-plus text-[14px]" />
                <span>New</span>
              </button>
            </Tooltip>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex h-full items-center z-10">
          {!isMac && (
            <div className="flex h-full ml-4">
              <Tooltip content="Minimize" placement="bottom">
                <button onClick={handleMinimize} className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all">
                  <i className="fa-solid fa-window-minimize text-[10px]" />
                </button>
              </Tooltip>
              <Tooltip content="Maximize" placement="bottom">
                <button onClick={handleMaximize} className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all">
                  <i className="fa-regular fa-square text-[10px]" />
                </button>
              </Tooltip>
              <Tooltip content="Close" placement="bottom">
                <button onClick={handleClose} className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-[#c42b1c] hover:text-white transition-all">
                  <i className="fa-solid fa-xmark text-[14px]" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {tabContextMenu?.visible && (
        <ContextMenu
          items={getTabContextMenuItems(tabContextMenu.tabId)}
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          onClose={() => setTabContextMenu(null)}
        />
      )}

      {confirmClose && (
        <ConfirmDialog
          title={
            confirmClose.type === "single"
              ? "Close Tab"
              : confirmClose.type === "others"
                ? "Close Other Tabs"
                : "Close All Tabs"
          }
          message={
            confirmClose.type === "single"
              ? "Are you sure you want to close this tab? Any unsaved changes will be lost."
              : confirmClose.type === "others"
                ? "Are you sure you want to close all other tabs? Any unsaved changes will be lost."
                : "Are you sure you want to close all tabs? Any unsaved changes will be lost."
          }
          confirmLabel={confirmClose.type === "single" ? "Close" : "Close All"}
          variant="danger"
          onConfirm={() => {
            if (confirmClose.type === "single" && confirmClose.tabId) {
              onTabClose(confirmClose.tabId);
            } else if (confirmClose.type === "others" && confirmClose.tabId) {
              onTabCloseOthers(confirmClose.tabId);
            } else if (confirmClose.type === "all") {
              onTabCloseAll();
            }
            setConfirmClose(null);
          }}
          onCancel={() => setConfirmClose(null)}
        />
      )}
    </>
  );
}
