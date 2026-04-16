import { createSignal, createEffect, onMount, For } from "solid-js";
import { AiService } from "../lib/ai";
import { isMacOS } from "../lib/platform";
import type { QueryTab, ServerObjectIndexStatus } from "../lib/types";
import ConfirmDialog from "./ConfirmDialog";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
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
  onHideSettings?: () => void;
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
  onTabPromote: (id: string) => void;
  onTabSave?: (id: string) => void;
  aiChatOpen: boolean;
  onToggleAiChat: () => void;
  hideAppContent?: boolean;
}

export default function TitleBar(props: Props) {
  const isMac = isMacOS();
  const [hasAiKey, setHasAiKey] = createSignal(false);

  createEffect(() => {
    const _ = props.hideAppContent;
    AiService.getStatus().then((s) => setHasAiKey(s.hasKey));
  });

  const objectJumpIndexing = () => props.objectJumpIndexStatus?.indexing ?? false;
  const processedDatabaseCount = () => props.objectJumpIndexStatus?.processed_database_count ?? 0;
  const databaseCount = () => props.objectJumpIndexStatus?.database_count ?? 0;
  const failedDatabaseCount = () => props.objectJumpIndexStatus?.failed_databases.length ?? 0;
  const objectJumpTooltip = () => objectJumpIndexing()
    ? databaseCount() > 0
      ? `Jump to Object \u2022 Indexing ${processedDatabaseCount()}/${databaseCount()} DBs${failedDatabaseCount() > 0 ? ` \u2022 ${failedDatabaseCount()} failed` : ""}`
      : `Jump to Object \u2022 Indexing server objects...`
    : `Jump to Object`;

  const [confirmClose, setConfirmClose] = createSignal<{
    type: "single" | "others" | "all";
    tabId?: string;
  } | null>(null);

  const [renamingTabId, setRenamingTabId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [tabContextMenu, setTabContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  let renameInputRef: HTMLInputElement | undefined;
  let tabBarRef: HTMLDivElement | undefined;

  // Pointer-based drag-and-drop state
  const [dragTabId, setDragTabId] = createSignal<string | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  let dragRef: {
    tabId: string;
    fromIndex: number;
    startX: number;
    active: boolean;
  } | null = null;
  let justDraggedRef = false;

  async function handleMinimize() {
    const win = await getCurrentAppWindow();
    await win.minimize();
  }

  async function handleMaximize() {
    const win = await getCurrentAppWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }

  async function handleClose() {
    const win = await getCurrentAppWindow();
    await win.close();
  }

  function handleTitleBarMouseDown(event: MouseEvent & { currentTarget: HTMLDivElement }) {
    if (!isMac || event.button !== 0 || isWindowDragExcludedTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void getCurrentAppWindow()
      .then((win) => win.startDragging())
      .catch(() => undefined);
  }

  function handleStartRename(tab: QueryTab) {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
  }

  function handleRename(tabId: string) {
    if (renameValue().trim()) {
      props.onTabUpdate(tabId, { title: renameValue().trim(), userTitle: true });
    }
    setRenamingTabId(null);
    setRenameValue("");
  }

  function handleRenameKeyDown(e: KeyboardEvent, tabId: string) {
    if (e.key === "Enter") {
      handleRename(tabId);
    } else if (e.key === "Escape") {
      setRenamingTabId(null);
      setRenameValue("");
    }
  }

  createEffect(() => {
    if (renamingTabId() && renameInputRef) {
      renameInputRef.focus();
      renameInputRef.select();
    }
  });

  onMount(() => {
    if (isMac) {
      void getCurrentAppWindow();
    }
  });

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    setTabContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }

  function requestSingleTabClose(tabId: string) {
    const tab = props.tabs.find((t) => t.id === tabId);
    if (tab?.temporary) {
      props.onTabClose(tabId);
      return;
    }

    setConfirmClose({ type: "single", tabId });
  }

  // --- Pointer-based drag-and-drop ---

  function computeDropIndex(clientX: number, draggedTabId: string): number | null {
    if (!tabBarRef) return null;

    const tabElements = tabBarRef.querySelectorAll<HTMLElement>("[data-tab-index]");
    const currentTabs = props.tabs;
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
  }

  function handleTabPointerDown(e: PointerEvent, tabId: string, index: number) {
    // Only left button, ignore buttons/inputs
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button, input")) return;

    dragRef = {
      tabId,
      fromIndex: index,
      startX: e.clientX,
      active: false,
    };

    const onPointerMove = (ev: PointerEvent) => {
      const drag = dragRef;
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

      const drag = dragRef;
      if (drag?.active) {
        justDraggedRef = true;
        requestAnimationFrame(() => { justDraggedRef = false; });

        const currentDropIndex = dropIndex();
        if (currentDropIndex !== null && drag.fromIndex !== currentDropIndex && drag.fromIndex !== currentDropIndex - 1) {
          const adjusted = currentDropIndex > drag.fromIndex ? currentDropIndex - 1 : currentDropIndex;
          props.onTabReorder(drag.fromIndex, adjusted);
        }
        setDropIndex(null);
      }

      dragRef = null;
      setDragTabId(null);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  // --- Context menu items ---

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const tab = props.tabs.find((t) => t.id === tabId);
    const items: ContextMenuItem[] = [
      {
        id: "close",
        label: "Close",
        icon: <i class="fa-solid fa-xmark" />,
        onClick: () => requestSingleTabClose(tabId),
      },
      {
        id: "close-others",
        label: "Close Others",
        icon: <i class="fa-solid fa-rectangle-xmark" />,
        onClick: () => setConfirmClose({ type: "others", tabId }),
      },
      {
        id: "close-all",
        label: "Close All",
        icon: <i class="fa-solid fa-trash" />,
        onClick: () => setConfirmClose({ type: "all" }),
      },
      { id: "sep-actions", separator: true },
      {
        id: "duplicate",
        label: "Duplicate Tab",
        icon: <i class="fa-solid fa-clone" />,
        onClick: () => {
          const newId = props.onTabDuplicate(tabId);
          if (newId) {
            requestAnimationFrame(() => {
              if (tabBarRef) {
                tabBarRef.scrollLeft = tabBarRef.scrollWidth;
              }
            });
          }
        },
      },
      {
        id: "pin",
        label: tab?.pinned ? "Unpin Tab" : "Pin Tab",
        icon: <i class="fa-solid fa-thumbtack" style={tab?.pinned ? { opacity: 0.5 } : undefined} />,
        onClick: () => props.onTabTogglePin(tabId),
      },
    ];

    if (props.onTabSave) {
      items.push(
        { id: "sep-tab-1", separator: true },
        {
          id: "save-as",
          label: "Save As...",
          icon: <i class="fa-solid fa-floppy-disk" />,
          onClick: () => props.onTabSave!(tabId),
        },
      );
    }

    return items;
  };

  const pinnedCount = () => props.tabs.filter((t) => t.pinned).length;

  return (
    <>
      <div
        data-tauri-drag-region
        class="app-titlebar flex items-center h-11 select-none flex-shrink-0 relative"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div
          class="flex items-center h-full px-3 gap-1.5 flex-shrink-0"
          style={{ width: props.sidebarVisible && props.connected ? `${(props.sidebarWidth ?? 325) + 1}px` : 'auto' }}
        >
          {isMac && (
            <div class="mac-window-controls pr-2 relative z-[9999]">
              <Tooltip content="Close" placement="bottom">
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close window"
                  class="mac-window-control mac-window-control-close"
                >
                  <i aria-hidden class="fa-solid fa-xmark" />
                </button>
              </Tooltip>
              <Tooltip content="Minimize" placement="bottom">
                <button
                  type="button"
                  onClick={handleMinimize}
                  aria-label="Minimize window"
                  class="mac-window-control mac-window-control-minimize"
                >
                  <i aria-hidden class="fa-solid fa-minus" />
                </button>
              </Tooltip>
              <Tooltip content="Zoom" placement="bottom">
                <button
                  type="button"
                  onClick={handleMaximize}
                  aria-label="Toggle zoom"
                  class="mac-window-control mac-window-control-zoom"
                >
                  <i aria-hidden class="fa-solid fa-plus" />
                </button>
              </Tooltip>
            </div>
          )}
          {props.hideAppContent && props.onHideSettings && (
            <div class="flex items-center pl-1 no-drag relative z-[9999]">
              <button
                onClick={props.onHideSettings}
                class="flex items-center gap-1.5 px-2.5 h-8 rounded-md hover:bg-surface-hover text-text-muted hover:text-text text-s font-medium transition-all cursor-pointer"
              >
                <i class="fa-solid fa-arrow-left" />
                Back to app
              </button>
            </div>
          )}
          {!props.hideAppContent && (
            <>
              {props.onToggleSidebar && (
                <Tooltip content={(props.sidebarVisible ?? true) ? "Hide Sidebar" : "Show Sidebar"} placement="bottom">
                  <button
                    onClick={props.onToggleSidebar}
                    disabled={(props.dialogOpen ?? false) || !props.connected}
                    class={`w-8 h-8 flex items-center justify-center rounded-md transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default ${(props.sidebarVisible ?? true) ? "text-text-muted enabled:hover:text-text enabled:hover:bg-surface-hover" : "text-text bg-surface-header enabled:hover:bg-surface-active"}`}
                  >
                    <i class="fa-solid fa-table-columns text-m" />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Settings" placement="bottom">
                <button
                  onClick={props.onShowSettings}
                  disabled={(props.settingsDisabled ?? false) || (props.dialogOpen ?? false) || !props.connected}
                  class="text-text-muted enabled:hover:text-text w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  <i class="fa-solid fa-gear text-m" />
                </button>
              </Tooltip>
              <Tooltip content="Open File" placement="bottom">
                <button
                  onClick={props.onOpenSqlFile}
                  disabled={(props.dialogOpen ?? false) || !props.connected}
                  class="text-text-muted enabled:hover:text-text w-8 h-8 flex items-center justify-center rounded-md enabled:hover:bg-surface-hover transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  <i class="fa-solid fa-folder-open text-m" />
                </button>
              </Tooltip>
              {props.onToggleObjectJump && (
                <Tooltip content={objectJumpTooltip()} placement="bottom">
                  <button
                    onClick={props.onToggleObjectJump}
                    disabled={(!(props.objectJumpOpen ?? false) && (props.dialogOpen ?? false)) || !(props.objectJumpEnabled ?? false)}
                    class={`w-8 h-8 flex items-center justify-center rounded-md transition-colors disabled:opacity-50 disabled:cursor-default enabled:cursor-pointer ${(props.objectJumpOpen ?? false)
                      ? "bg-surface-header text-text hover:bg-surface-active"
                      : "text-text-muted enabled:hover:text-text enabled:hover:bg-surface-hover"
                      }`}
                  >
                    <span class="relative flex items-center justify-center">
                      <i class="fa-solid fa-magnifying-glass text-m" />
                      {objectJumpIndexing() && (
                        <span class="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-raised text-[8px] text-text">
                          <i class="fa-solid fa-spinner animate-spin" />
                        </span>
                      )}
                    </span>
                  </button>
                </Tooltip>
              )}

              <div class="w-px h-4 bg-overlay-sm mx-1 flex-shrink-0" />

              {props.connected ? (
                <Tooltip content="Click to disconnect" placement="bottom">
                  <button
                    onClick={props.onDisconnect}
                    disabled={props.dialogOpen ?? false}
                    class="flex items-center gap-2 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text transition-all group enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
                  >
                    <i class="fa-solid fa-server text-s" />
                    <span class="text-s font-medium tracking-wide truncate max-w-[120px]">{props.serverName}</span>
                  </button>
                </Tooltip>
              ) : (props.isInitializing ?? false) ? (
                <div class="flex items-center gap-2 px-2.5 h-8 rounded-md text-text-muted text-s font-medium">
                  <i class="fa-solid fa-spinner animate-spin" />
                  <span>Connecting...</span>
                </div>
              ) : (
                <button
                  onClick={props.onConnect}
                  disabled={props.dialogOpen ?? false}
                  class="flex items-center gap-1.5 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text text-s font-medium transition-all enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
                >
                  <i class="fa-solid fa-plug" />
                  Connect Server
                </button>
              )}
            </>
          )}
        </div>

        {!props.hideAppContent && props.connected && (
          <div class="flex items-center min-w-0 flex-shrink overflow-hidden no-drag">
            {props.tabs.length > 0 && (
              <>
                <div
                  ref={tabBarRef}
                  on:mousedown={(e: MouseEvent) => {
                    if (e.button === 1) e.preventDefault();
                  }}
                  onWheel={(e) => {
                    if (tabBarRef) {
                      e.preventDefault();
                      tabBarRef.scrollLeft += e.deltaY;
                    }
                  }}
                  class="flex overflow-x-auto tab-bar min-w-0"
                >
                  <For each={props.tabs}>{(tab, index) => {
                    const isActive = () => tab.id === props.activeTabId;
                    const isDragging = () => tab.id === dragTabId();
                    const isModified = () => tab.sql !== tab.savedSql;
                    const showDropBefore = () => dropIndex() === index();
                    const showDropAfter = () => dropIndex() === index() + 1 && index() === props.tabs.length - 1;
                    const showPinDivider = () => tab.pinned && index() === pinnedCount() - 1 && pinnedCount() < props.tabs.length;

                    return (
                      <div class="flex items-center flex-shrink-0">
                        {showDropBefore() && (
                          <div class="tab-drop-indicator" />
                        )}
                        <div
                          ref={(el) => { if (isActive()) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
                          data-tab-index={index()}
                          onPointerDown={(e) => handleTabPointerDown(e, tab.id, index())}
                          class={`tab flex items-center gap-2 text-s whitespace-nowrap select-none flex-shrink-0 tab-animate-in ${isActive() ? "active text-text cursor-default" : "text-text-muted cursor-pointer"} ${isDragging() ? "dragging" : ""} ${tab.pinned ? "pinned" : ""} ${tab.temporary ? "temporary" : ""}`}
                          onClick={() => {
                            if (justDraggedRef) return;
                            props.onTabChange(tab.id);
                          }}
                          onDblClick={() => {
                            if (tab.temporary) {
                              props.onTabPromote(tab.id);
                              return;
                            }
                            handleStartRename(tab);
                          }}
                          on:mousedown={(e: MouseEvent) => {
                            if (e.button === 1) {
                              e.preventDefault();
                              requestSingleTabClose(tab.id);
                            }
                          }}
                          onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
                        >
                          {tab.pinned && (
                            <i class="fa-solid fa-thumbtack text-[9px] text-text-muted pin-icon" />
                          )}
                          <div class="flex-1 min-w-0 mr-2">
                            {renamingTabId() === tab.id ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                value={renameValue()}
                                onInput={(e) => setRenameValue(e.currentTarget.value)}
                                onBlur={() => handleRename(tab.id)}
                                onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
                                class="bg-transparent border-none outline-none text-s w-full min-w-0"
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : (
                              <span class="tab-title truncate block" data-text={tab.title}>{tab.title}</span>
                            )}
                          </div>
                          <div class="flex items-center justify-center w-5 h-5 flex-shrink-0 relative">
                            {tab.isExecuting && (
                              <span class="animate-pulse text-warning text-s absolute">&#9679;</span>
                            )}
                            {isModified() && !tab.isExecuting && (
                              <span class="modified-dot absolute" title="Unsaved changes" />
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                requestSingleTabClose(tab.id);
                              }}
                              class={`tab-close-btn relative flex items-center justify-center rounded hover:bg-surface-active text-text-muted hover:text-text cursor-pointer ${isActive() ? "active" : ""}`}
                            >
                              <i class="fa-solid fa-xmark text-s" />
                            </button>
                          </div>
                        </div>
                        {showDropAfter() && (
                          <div class="tab-drop-indicator" />
                        )}
                        {showPinDivider() && (
                          <div class="pin-divider" />
                        )}
                      </div>
                    );
                  }}</For>
                </div>
                <div class="w-px h-4 bg-border flex-shrink-0 mx-1.5" />
              </>
            )}
            <Tooltip content="New Query" placement="bottom">
              <button
                onClick={() => {
                  props.onTabAdd();
                  requestAnimationFrame(() => {
                    if (tabBarRef) {
                      tabBarRef.scrollLeft = tabBarRef.scrollWidth;
                    }
                  });
                }}
                class="flex items-center gap-1.5 px-2.5 h-8 mx-1.5 text-text-muted hover:text-text hover:bg-surface-hover rounded-md transition-colors flex-shrink-0 cursor-pointer text-s"
              >
                <i class="fa-solid fa-plus text-m" />
                <span>New</span>
              </button>
            </Tooltip>
          </div>
        )}

        <div class="flex-1" />

        <div class="flex h-full flex-shrink-0">
          {!props.hideAppContent && isMac && props.connected && (
            <Tooltip content="Click to disconnect" placement="bottom">
              <button
                onClick={props.onDisconnect}
                disabled={props.dialogOpen ?? false}
                class="flex items-center gap-2 px-2.5 h-8 rounded-md enabled:hover:bg-surface-hover text-text-muted enabled:hover:text-text transition-all group enabled:cursor-pointer disabled:opacity-50 disabled:cursor-default"
              >
                <i class="fa-solid fa-server text-s" />
                <span class="text-s font-medium tracking-wide truncate max-w-[120px]">{props.serverName}</span>
              </button>
            </Tooltip>
          )}
          {!props.hideAppContent && hasAiKey() && props.connected && (
            <div class="flex items-center px-1">
              <Tooltip content="AI Chat" placement="bottom">
                <button
                  onClick={props.onToggleAiChat}
                  disabled={props.tabs.length === 0}
                  class={`flex items-center gap-1.5 px-2.5 h-8 rounded-md text-s transition-colors ${props.tabs.length === 0 ? "opacity-50 cursor-default" : "cursor-pointer"} ${props.aiChatOpen ? "text-text font-medium bg-surface-header enabled:hover:bg-surface-active" : "text-text-muted font-normal enabled:hover:text-text enabled:hover:bg-surface-hover"}`}
                >
                  <i class="fa-solid fa-message" />
                  <span>Chat</span>
                </button>
              </Tooltip>
            </div>
          )}
          {!isMac && (
            <div class="flex h-full relative z-[9999]">
              <Tooltip content="Minimize" placement="bottom">
                <button onClick={handleMinimize} class="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all">
                  <i class="fa-solid fa-window-minimize text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Maximize" placement="bottom">
                <button onClick={handleMaximize} class="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all">
                  <i class="fa-regular fa-square text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Close" placement="bottom">
                <button onClick={handleClose} class="w-14 h-full flex items-center justify-center text-text-muted hover:bg-[#c42b1c] hover:text-white transition-all">
                  <i class="fa-solid fa-xmark text-m" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {tabContextMenu()?.visible && (
        <ContextMenu
          items={getTabContextMenuItems(tabContextMenu()!.tabId)}
          x={tabContextMenu()!.x}
          y={tabContextMenu()!.y}
          onClose={() => setTabContextMenu(null)}
        />
      )}

      {confirmClose() && (
        <ConfirmDialog
          title={
            confirmClose()!.type === "single"
              ? "Close Tab"
              : confirmClose()!.type === "others"
                ? "Close Other Tabs"
                : "Close All Tabs"
          }
          message={
            confirmClose()!.type === "single"
              ? "Are you sure you want to close this tab? Any unsaved changes will be lost."
              : confirmClose()!.type === "others"
                ? "Are you sure you want to close all other tabs? Any unsaved changes will be lost."
                : "Are you sure you want to close all tabs? Any unsaved changes will be lost."
          }
          confirmLabel={confirmClose()!.type === "single" ? "Close" : "Close All"}
          variant="danger"
          onConfirm={() => {
            const cc = confirmClose()!;
            if (cc.type === "single" && cc.tabId) {
              props.onTabClose(cc.tabId);
            } else if (cc.type === "others" && cc.tabId) {
              props.onTabCloseOthers(cc.tabId);
            } else if (cc.type === "all") {
              props.onTabCloseAll();
            }
            setConfirmClose(null);
          }}
          onCancel={() => setConfirmClose(null)}
        />
      )}
    </>
  );
}
