import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryTab, ServerObjectIndexStatus } from "../lib/types";
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

const DRAG_THRESHOLD = 5;

interface Props {
  connected: boolean;
  isInitializing?: boolean;
  serverName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenSqlFile: () => void;
  onToggleObjectJump?: () => void;
  objectJumpOpen?: boolean;
  objectJumpEnabled?: boolean;
  objectJumpIndexStatus?: ServerObjectIndexStatus;
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
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onTabDuplicate: (id: string) => string;
  onTabTogglePin: (id: string) => void;
  onTabSave?: (id: string) => void;
  aiChatOpen: boolean;
  onToggleAiChat: () => void;
}

export default function TitleBar({
  connected,
  isInitializing = false,
  serverName,
  onConnect,
  onDisconnect,
  onOpenSqlFile,
  onToggleObjectJump,
  objectJumpOpen = false,
  objectJumpEnabled = false,
  objectJumpIndexStatus,
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
  onTabReorder,
  onTabDuplicate,
  onTabTogglePin,
  onTabSave,
  aiChatOpen,
  onToggleAiChat,
}: Props) {
  const isMac = isMacOS();
  const openFileShortcut = `${getModifierKeyLabel()}+O`;
  const objectJumpShortcut = `${getModifierKeyLabel()}+Shift+F / ${getModifierKeyLabel()}+P`;
  const newQueryShortcut = `${getModifierKeyLabel()}+N`;
  const hasAiKey = AiService.getStatus().hasKey;
  const objectJumpIndexing = objectJumpIndexStatus?.indexing ?? false;
  const processedDatabaseCount = objectJumpIndexStatus?.processed_database_count ?? 0;
  const databaseCount = objectJumpIndexStatus?.database_count ?? 0;
  const failedDatabaseCount = objectJumpIndexStatus?.failed_databases.length ?? 0;
  const objectJumpTooltip = objectJumpIndexing
    ? databaseCount > 0
      ? `Jump to Object (${objectJumpShortcut}) • Indexing ${processedDatabaseCount}/${databaseCount} DBs${failedDatabaseCount > 0 ? ` • ${failedDatabaseCount} failed` : ""}`
      : `Jump to Object (${objectJumpShortcut}) • Indexing server objects...`
    : `Jump to Object (${objectJumpShortcut})`;
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

  // Pointer-based drag-and-drop state
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragRef = useRef<{
    tabId: string;
    fromIndex: number;
    startX: number;
    active: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

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

  // --- Pointer-based drag-and-drop ---

  const computeDropIndex = useCallback((clientX: number, draggedTabId: string) => {
    const tabBar = tabBarRef.current;
    if (!tabBar) return null;

    const tabElements = tabBar.querySelectorAll<HTMLElement>("[data-tab-index]");
    const currentTabs = tabsRef.current;
    const draggedTab = currentTabs.find((t) => t.id === draggedTabId);
    if (!draggedTab) return null;

    let result = currentTabs.length;
    for (const el of tabElements) {
      const idx = Number(el.dataset.tabIndex);
      const targetTab = currentTabs[idx];
      if (!targetTab) continue;

      // Enforce pinned/unpinned boundary
      if (!!draggedTab.pinned !== !!targetTab.pinned) continue;

      const rect = el.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (clientX < midpoint) {
        result = idx;
        break;
      }
    }

    return result;
  }, []);

  const handleTabPointerDown = useCallback((e: React.PointerEvent, tabId: string, index: number) => {
    // Only left button, ignore buttons/inputs
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button, input")) return;

    dragRef.current = {
      tabId,
      fromIndex: index,
      startX: e.clientX,
      active: false,
    };

    const onPointerMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (!drag.active) {
        if (Math.abs(ev.clientX - drag.startX) < DRAG_THRESHOLD) return;
        drag.active = true;
        setDragTabId(drag.tabId);
        document.body.style.cursor = "grabbing";
      }

      const newDropIndex = computeDropIndex(ev.clientX, drag.tabId);
      setDropIndex(newDropIndex);
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";

      const drag = dragRef.current;
      if (drag?.active) {
        justDraggedRef.current = true;
        requestAnimationFrame(() => { justDraggedRef.current = false; });

        // Read latest drop index from the state setter to avoid stale closures
        setDropIndex((currentDropIndex) => {
          if (currentDropIndex !== null && drag.fromIndex !== currentDropIndex && drag.fromIndex !== currentDropIndex - 1) {
            const adjusted = currentDropIndex > drag.fromIndex ? currentDropIndex - 1 : currentDropIndex;
            onTabReorder(drag.fromIndex, adjusted);
          }
          return null;
        });
      }

      dragRef.current = null;
      setDragTabId(null);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }, [computeDropIndex, onTabReorder]);

  // --- Context menu items ---

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const tab = tabs.find((t) => t.id === tabId);
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
      { id: "sep-actions", separator: true },
      {
        id: "duplicate",
        label: "Duplicate Tab",
        icon: <i className="fa-solid fa-clone" />,
        onClick: () => {
          const newId = onTabDuplicate(tabId);
          if (newId) {
            requestAnimationFrame(() => {
              if (tabBarRef.current) {
                tabBarRef.current.scrollLeft = tabBarRef.current.scrollWidth;
              }
            });
          }
        },
      },
      {
        id: "pin",
        label: tab?.pinned ? "Unpin Tab" : "Pin Tab",
        icon: <i className="fa-solid fa-thumbtack" style={tab?.pinned ? { opacity: 0.5 } : undefined} />,
        onClick: () => onTabTogglePin(tabId),
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

  const pinnedCount = tabs.filter((t) => t.pinned).length;

  return (
    <>
      <div
        data-tauri-drag-region
        className="app-titlebar flex items-center h-11 select-none flex-shrink-0 relative"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div
          className="flex items-center h-full z-10 px-3 gap-1.5 flex-shrink-0"
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
                className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default ${sidebarVisible ? "text-text-muted enabled:hover:text-text enabled:hover:bg-surface-hover" : "text-text bg-surface-header enabled:hover:bg-surface-active"}`}
              >
                <i className="fa-solid fa-table-columns text-m" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Settings" placement="bottom">
            <button
              onClick={onShowSettings}
              disabled={settingsDisabled || dialogOpen || !connected}
              className="text-text-muted enabled:hover:text-text w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <i className="fa-solid fa-gear text-m" />
            </button>
          </Tooltip>
          <Tooltip content={`Open File (${openFileShortcut})`} placement="bottom">
            <button
              onClick={onOpenSqlFile}
              disabled={dialogOpen || !connected}
              className="text-text-muted enabled:hover:text-text w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <i className="fa-solid fa-folder-open text-m" />
            </button>
          </Tooltip>
          {onToggleObjectJump && (
            <Tooltip content={objectJumpTooltip} placement="bottom">
              <button
                onClick={onToggleObjectJump}
                disabled={(!objectJumpOpen && dialogOpen) || !objectJumpEnabled}
                className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:cursor-default enabled:cursor-pointer ${
                  objectJumpOpen
                    ? "bg-surface-header text-text hover:bg-surface-active"
                    : "text-text-muted enabled:hover:text-text enabled:hover:bg-surface-hover"
                }`}
              >
                <span className="relative flex items-center justify-center">
                  <i className="fa-solid fa-magnifying-glass text-m" />
                  {objectJumpIndexing && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-raised text-[8px] text-text">
                      <i className="fa-solid fa-spinner animate-spin" />
                    </span>
                  )}
                </span>
              </button>
            </Tooltip>
          )}

          <div className="w-px h-4 bg-overlay-sm mx-1 flex-shrink-0" />

          {connected ? (
            <Tooltip content="Click to disconnect" placement="bottom">
              <button
                onClick={onDisconnect}
                disabled={dialogOpen}
                className="flex items-center gap-2 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text transition-all group enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                <i className="fa-solid fa-server text-s" />
                <span className="text-s font-medium tracking-wide truncate max-w-[120px]">{serverName}</span>
              </button>
            </Tooltip>
          ) : isInitializing ? (
            <div className="flex items-center gap-2 px-2.5 h-8 rounded-md text-text-muted text-s font-medium">
              <i className="fa-solid fa-spinner animate-spin" />
              <span>Connecting...</span>
            </div>
          ) : (
            <button
              onClick={onConnect}
              disabled={dialogOpen}
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text text-s font-medium transition-all enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
            >
              <i className="fa-solid fa-plug" />
              Connect Server
            </button>
          )}
        </div>

        {connected && (
          <div className="flex items-center min-w-0 flex-shrink overflow-hidden no-drag">
            {tabs.length > 0 && (
              <>
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
                  {tabs.map((tab, index) => {
                    const isActive = tab.id === activeTabId;
                    const isDragging = tab.id === dragTabId;
                    const isModified = tab.sql !== tab.savedSql;
                    const showDropBefore = dropIndex === index;
                    const showDropAfter = dropIndex === index + 1 && index === tabs.length - 1;
                    const showPinDivider = tab.pinned && index === pinnedCount - 1 && pinnedCount < tabs.length;

                    return (
                      <div key={tab.id} className="flex items-center flex-shrink-0">
                        {showDropBefore && (
                          <div className="tab-drop-indicator" />
                        )}
                        <div
                          ref={isActive ? (el) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); } : undefined}
                          data-tab-index={index}
                          onPointerDown={(e) => handleTabPointerDown(e, tab.id, index)}
                          className={`winui-tab flex items-center gap-2 text-s cursor-pointer whitespace-nowrap select-none flex-shrink-0 tab-animate-in ${isActive ? "active text-text font-medium" : "text-text-muted"} ${isDragging ? "dragging" : ""} ${tab.pinned ? "pinned" : ""}`}
                          onClick={() => {
                            if (justDraggedRef.current) return;
                            onTabChange(tab.id);
                          }}
                          onDoubleClick={() => handleStartRename(tab)}
                          onAuxClick={(e) => {
                            if (e.button === 1) {
                              e.preventDefault();
                              setConfirmClose({ type: "single", tabId: tab.id });
                            }
                          }}
                          onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                        >
                          {tab.pinned && (
                            <i className="fa-solid fa-thumbtack text-[9px] text-text-muted pin-icon" />
                          )}
                          <div className="flex-1 min-w-0 mr-2">
                            {renamingTabId === tab.id ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => handleRename(tab.id)}
                                onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
                                className="bg-transparent border-none outline-none text-s w-full min-w-0"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span className="truncate block" data-text={tab.title}>{tab.title}</span>
                            )}
                          </div>
                          <div className="flex items-center justify-center w-5 h-5 flex-shrink-0 relative">
                            {tab.isExecuting && (
                              <span className="animate-pulse text-warning text-s absolute">&#9679;</span>
                            )}
                            {isModified && !tab.isExecuting && (
                              <span className="modified-dot absolute" title="Unsaved changes" />
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmClose({ type: "single", tabId: tab.id });
                              }}
                              className={`tab-close-btn relative flex items-center justify-center rounded hover:bg-surface-active text-text-muted hover:text-text cursor-pointer ${isActive ? "active" : ""}`}
                            >
                              <i className="fa-solid fa-xmark text-s" />
                            </button>
                          </div>
                        </div>
                        {showDropAfter && (
                          <div className="tab-drop-indicator" />
                        )}
                        {showPinDivider && (
                          <div className="pin-divider" />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="w-px h-4 bg-border flex-shrink-0" />
              </>
            )}
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
                className="flex items-center gap-2 px-3 h-8 mx-2.5 text-text-muted hover:text-text hover:bg-surface-hover rounded-lg transition-colors flex-shrink-0 cursor-pointer text-s font-medium"
              >
                <i className="fa-solid fa-plus text-m" />
                <span>New</span>
              </button>
            </Tooltip>
          </div>
        )}

        <div className="flex-1" />

        <div className="flex h-full z-10 flex-shrink-0">
          {isMac && connected && (
            <Tooltip content="Click to disconnect" placement="bottom">
              <button
                onClick={onDisconnect}
                disabled={dialogOpen}
                className="flex items-center gap-2 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text transition-all group enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                <i className="fa-solid fa-server text-s" />
                <span className="text-s font-medium tracking-wide truncate max-w-[120px]">{serverName}</span>
              </button>
            </Tooltip>
          )}
          {hasAiKey && connected && (
            <div className="flex items-center px-1">
              <Tooltip content="AI Chat" placement="bottom">
                <button
                  onClick={onToggleAiChat}
                  disabled={tabs.length === 0}
                  className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md text-s transition-colors ${tabs.length === 0 ? "opacity-50 cursor-default" : "cursor-pointer"} ${aiChatOpen ? "text-text font-medium bg-surface-header enabled:hover:bg-surface-active" : "text-text-muted font-normal enabled:hover:text-text enabled:hover:bg-surface-hover"}`}
                >
                  <i className="fa-solid fa-wand-sparkles" />
                  <span>Chat</span>
                </button>
              </Tooltip>
            </div>
          )}
          {!isMac && (
            <div className="flex h-full">
              <Tooltip content="Minimize" placement="bottom">
                <button onClick={handleMinimize} className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all">
                  <i className="fa-solid fa-window-minimize text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Maximize" placement="bottom">
                <button onClick={handleMaximize} className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all">
                  <i className="fa-regular fa-square text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Close" placement="bottom">
                <button onClick={handleClose} className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-windows-close-hover hover:text-white transition-all">
                  <i className="fa-solid fa-xmark text-m" />
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
