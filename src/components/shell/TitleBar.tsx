import { IconWinMinimize, IconWinMaximize, IconWinRestore, IconWinClose, IconMacClose, IconMacMinimize, IconMacMaximize, } from "../ui/Icons";
import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AiService } from "../../lib/ai";
import { loadAiEnabled } from "../../lib/settings";
import { getGoBackShortcutLabel, getGoForwardShortcutLabel } from "../../lib/editor-navigation";
import { isMacOS } from "../../lib/platform";
import type { SavedConnection, ServerObjectIndexStatus } from "../../lib/types";
import type { SettingsTab } from "../settings/SettingsView";
import Tooltip from "../ui/Tooltip";
import { Loader } from "../ui/Loader";
import { toast } from "../ui/Toaster";
import ServerSwitcher from "./ServerSwitcher";

function isWindowDragExcludedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "button, input, select, textarea, a, [role='button'], [contenteditable='true'], .no-drag, [data-no-window-drag]",
      ),
    )
  );
}

interface Props {
  connected: boolean;
  isInitializing?: boolean;
  isSwitchingConnection?: boolean;
  serverName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSwitchConnection: (connection: SavedConnection) => void;
  onOpenSqlFile: () => void;
  onShowBackupRestore?: () => void;
  onToggleObjectJump?: () => void;
  objectJumpOpen?: boolean;
  objectJumpIndexStatus?: ServerObjectIndexStatus;
  onShowSettings: (tab?: SettingsTab) => void;
  onHideSettings?: () => void;
  settingsDisabled?: boolean;
  onToggleSidebar?: () => void;
  sidebarVisible?: boolean;
  sidebarWidth?: number;
  dialogOpen?: boolean;
  aiChatOpen: boolean;
  onToggleAiChat: () => void;
  updateAvailable?: boolean;
  onViewUpdateDetails?: () => void;
  hideAppContent?: boolean;
  hasTabs: boolean;
  onRequestClose?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
}

export default function TitleBar(props: Props) {
  const isMac = isMacOS();
  const [isMaximized, setIsMaximized] = createSignal(false);
  const [serverSwitcherOpen, setServerSwitcherOpen] = createSignal(false);
  let serverSwitcherAnchor: HTMLButtonElement | undefined;
  const win = getCurrentWindow();

  onMount(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;

    win
      .isMaximized()
      .then((maximized) => {
        if (!cancelled) setIsMaximized(maximized);
      })
      .catch(() => undefined);

    const refreshMaximized = async () => {
      try {
        const maximized = await win.isMaximized();
        if (!cancelled) setIsMaximized(maximized);
      } catch { /* empty */ }
    };

    const subscribe = (
      listenFn: (cb: () => Promise<void> | void) => Promise<() => void>,
    ) =>
      listenFn(refreshMaximized)
        .then((fn) => {
          if (cancelled) {
            fn();
          } else {
            unlistens.push(fn);
          }
        })
        .catch(() => undefined);

    void subscribe((cb) => win.onResized(cb));

    if (!isMac) {
      const clampSnapOverlay = () => {
        const snap = document.getElementById("snap-btn");
        const closeBtn = document.getElementById("window-close-btn");
        if (!snap || !closeBtn) return;
        const overlap = snap.getBoundingClientRect().right - closeBtn.getBoundingClientRect().left;
        if (overlap <= 0) return;
        const right = -Math.ceil(overlap + 2);
        void import("tauri-plugin-snap-layout")
          .then((mod) => mod.changePadding({ right }))
          .catch(() => {
            window.snapLayout?.changePadding({ right });
          });
      };
      requestAnimationFrame(clampSnapOverlay);
      window.addEventListener("resize", clampSnapOverlay);
      unlistens.push(() => window.removeEventListener("resize", clampSnapOverlay));
    }

    onCleanup(() => {
      cancelled = true;
      for (const unlisten of unlistens) unlisten();
    });
  });

  const objectJumpIndexing = () =>
    props.objectJumpIndexStatus?.indexing ?? false;
  const processedDatabaseCount = () =>
    props.objectJumpIndexStatus?.processed_database_count ?? 0;
  const databaseCount = () => props.objectJumpIndexStatus?.database_count ?? 0;
  const failedDatabaseCount = () =>
    props.objectJumpIndexStatus?.failed_databases.length ?? 0;
  const objectJumpTooltip = () =>
    objectJumpIndexing()
      ? databaseCount() > 0
        ? `Jump to Object - Indexing ${processedDatabaseCount()}/${databaseCount()} DBs${failedDatabaseCount() > 0 ? ` - ${failedDatabaseCount()} failed` : ""}`
        : "Jump to Object - Indexing server objects…"
      : "Jump to Object";
  const aiChatTooltip = () =>
    props.connected ? "AI Chat" : "AI Chat • Connect to a server";

  async function handleMinimize() {
    try {
      await win.minimize();
    } catch (err) {
      toast.error(`Failed to minimize window: ${String(err)}`);
    }
  }

  async function handleMaximize() {
    try {
      const currentlyMaximized = await win.isMaximized();
      if (currentlyMaximized) {
        await win.unmaximize();
      } else {
        await win.maximize();
      }
      setIsMaximized(await win.isMaximized());
    } catch (err) {
      toast.error(`Failed to maximize window: ${String(err)}`);
    }
  }

  async function handleClose(event?: MouseEvent) {
    event?.stopPropagation();
    if (props.onRequestClose) {
      props.onRequestClose();
      return;
    }
    try {
      await invoke("close_window");
    } catch {
      try {
        await win.destroy();
      } catch (err2) {
        toast.error(`Failed to close window: ${String(err2)}`);
      }
    }
  }

  function handleTitleBarMouseDown(
    event: MouseEvent & { currentTarget: HTMLDivElement },
  ) {
    if (
      !isMac ||
      event.button !== 0 ||
      isWindowDragExcludedTarget(event.target)
    ) {
      return;
    }

    event.preventDefault();
    void getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }

  return (
    <>
      <div
        class="app-titlebar flex items-center h-11 select-none flex-shrink-0 relative"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div
          class="flex items-center h-full px-3 gap-1.5 flex-shrink-0"
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
                  <IconMacClose />
                </button>
              </Tooltip>
              <Tooltip content="Minimize" placement="bottom">
                <button
                  type="button"
                  onClick={handleMinimize}
                  aria-label="Minimize window"
                  class="mac-window-control mac-window-control-minimize"
                >
                  <IconMacMinimize />
                </button>
              </Tooltip>
              <Tooltip content="Zoom" placement="bottom">
                <button
                  type="button"
                  onClick={handleMaximize}
                  aria-label="Toggle zoom"
                  class="mac-window-control mac-window-control-zoom"
                >
                  <IconMacMaximize />
                </button>
              </Tooltip>
            </div>
          )}
          {props.hideAppContent && props.onHideSettings && (
            <div class="flex items-center pl-1 no-drag relative z-[9999]">
              <button onClick={props.onHideSettings} class="titlebar-text-btn">
                <i class="fa-solid fa-arrow-left" />
                Back to app
              </button>
            </div>
          )}
          {!props.hideAppContent && (
            <>
              {props.onToggleSidebar && (
                <Tooltip
                  content={
                    !props.connected
                      ? "Sidebar • Connect to a server"
                      : (props.sidebarVisible ?? true)
                        ? "Hide Sidebar"
                        : "Show Sidebar"
                  }
                  placement="bottom"
                >
                  <button
                    onClick={props.onToggleSidebar}
                    disabled={(props.dialogOpen ?? false) || !props.connected}
                    class={`control-icon-btn titlebar-icon-btn ${
                      props.connected && !(props.sidebarVisible ?? true)
                        ? "is-active"
                        : ""
                    }`}
                  >
                    <i class="fa-solid fa-table-columns text-m" />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Settings" placement="bottom">
                <button
                  onClick={() => props.onShowSettings()}
                  disabled={
                    (props.settingsDisabled ?? false) ||
                    (props.dialogOpen ?? false) ||
                    !props.connected
                  }
                  class="control-icon-btn titlebar-icon-btn"
                >
                  <i class="fa-solid fa-gear text-m" />
                </button>
              </Tooltip>
              <Tooltip content="Open File" placement="bottom">
                <button
                  onClick={props.onOpenSqlFile}
                  disabled={(props.dialogOpen ?? false) || !props.connected}
                  class="control-icon-btn titlebar-icon-btn"
                >
                  <i class="fa-solid fa-folder-open text-m" />
                </button>
              </Tooltip>
              {props.onShowBackupRestore && (
                <Tooltip content="Backup & Restore" placement="bottom">
                  <button
                    onClick={props.onShowBackupRestore}
                    disabled={(props.dialogOpen ?? false) || !props.connected}
                    class="control-icon-btn titlebar-icon-btn"
                  >
                    <i class="fa-solid fa-box-archive text-m" />
                  </button>
                </Tooltip>
              )}

              <div class="ui-divider mx-1" />

              {props.connected ? (
                (props.isSwitchingConnection ?? false) ? (
                  <Loader variant="inline" text="Connecting…" class="px-2.5 h-8" />
                ) : (
                  <Tooltip content="Server Connections" placement="bottom">
                    <button
                      type="button"
                      ref={serverSwitcherAnchor}
                      onClick={() =>
                        setServerSwitcherOpen((open) => !open)
                      }
                      disabled={props.dialogOpen ?? false}
                      aria-haspopup="menu"
                      aria-expanded={serverSwitcherOpen()}
                      class="titlebar-text-btn"
                    >
                      <i class="fa-solid fa-server text-s" />
                      <span class="text-s font-medium tracking-wide truncate max-w-[120px]">
                        {props.serverName}
                      </span>
                      <i
                        class={`fa-solid fa-chevron-down text-2xs opacity-60 transition-transform ${serverSwitcherOpen() ? "rotate-180" : ""}`}
                      />
                    </button>
                  </Tooltip>
                )
              ) : (props.isInitializing ?? false) ? (
                <Loader variant="inline" text="Connecting…" class="px-2.5 h-8" />
              ) : (
                <button
                  onClick={props.onConnect}
                  disabled={props.dialogOpen ?? false}
                  class="titlebar-text-btn"
                >
                  <i class="fa-solid fa-plug" />
                  Connect Server
                </button>
              )}

              <div class="ui-divider mx-1" />

              <Tooltip
                content={`Go Back (${getGoBackShortcutLabel()})`}
                placement="bottom"
              >
                <button
                  type="button"
                  aria-label="Go Back"
                  onClick={() => props.onGoBack?.()}
                  disabled={
                    (props.dialogOpen ?? false) ||
                    !props.connected ||
                    !props.canGoBack
                  }
                  class="control-icon-btn titlebar-icon-btn"
                >
                  <i class="fa-solid fa-arrow-left text-m" />
                </button>
              </Tooltip>
              <Tooltip
                content={`Go Forward (${getGoForwardShortcutLabel()})`}
                placement="bottom"
              >
                <button
                  type="button"
                  aria-label="Go Forward"
                  onClick={() => props.onGoForward?.()}
                  disabled={
                    (props.dialogOpen ?? false) ||
                    !props.connected ||
                    !props.canGoForward
                  }
                  class="control-icon-btn titlebar-icon-btn"
                >
                  <i class="fa-solid fa-arrow-right text-m" />
                </button>
              </Tooltip>
            </>
          )}
        </div>

        <div class="flex-1 h-full" data-tauri-drag-region />

        {!props.hideAppContent && props.connected && (
          <div
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center no-drag"
            data-tauri-drag-region="false"
          >
            <Tooltip content={objectJumpTooltip()} placement="bottom">
              <div
                onClick={props.onToggleObjectJump}
                class={`titlebar-search ${props.objectJumpOpen ? "is-active" : ""}`}
              >
                <div class="flex min-w-0 items-center gap-2 text-s truncate">
                  <i class="fa-solid fa-magnifying-glass text-2xs opacity-70" />
                  <span class="truncate">Search database objects…</span>
                </div>
                <kbd class="text-2xs font-mono text-text-muted/30 select-none">
                  {isMac ? "⌘P" : "Ctrl+P"}
                </kbd>
              </div>
            </Tooltip>
          </div>
        )}

        <div class="flex h-full flex-shrink-0">
          {!props.hideAppContent && props.updateAvailable && props.onViewUpdateDetails && (
            <div class="flex items-center self-center">
              <Tooltip content="A new version is ready to install" placement="bottom">
                <button
                  onClick={props.onViewUpdateDetails}
                  class="titlebar-text-btn text-accent"
                >
                  <i class="fa-solid fa-circle-arrow-up" />
                  Update
                </button>
              </Tooltip>
              <div class="ui-divider mx-2" />
            </div>
          )}
          {!props.hideAppContent && loadAiEnabled() && (
            <div class="flex items-center self-center">
              <Tooltip content={aiChatTooltip()} placement="bottom">
                <button
                  onClick={props.onToggleAiChat}
                  onPointerEnter={() => {
                    void import("../ai/AIChatPanel");
                    void AiService.listAvailableModels();
                  }}
                  disabled={!props.connected || !props.hasTabs}
                  class={`control-icon-btn titlebar-icon-btn ${
                    props.aiChatOpen ? "is-active" : ""
                    }`}
                >
                  <i class="fa-solid fa-message text-m" />
                </button>
              </Tooltip>
            </div>
          )}
          {!isMac && !props.hideAppContent && loadAiEnabled() && (
            <div class="ui-divider mx-2.5 self-center" />
          )}
          {!isMac && (
            <div
              class="flex h-full relative z-[9999] no-drag"
              data-tauri-drag-region="false"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <Tooltip content="Minimize" placement="bottom" class="h-full">
                <button
                  type="button"
                  aria-label="Minimize window"
                  onClick={handleMinimize}
                  class="windows-caption-btn"
                >
                  <IconWinMinimize />
                </button>
              </Tooltip>
              <Tooltip content={isMaximized() ? "Restore" : "Maximize"} placement="bottom" class="h-full">
                <button
                  type="button"
                  aria-label={isMaximized() ? "Restore window" : "Maximize window"}
                  id="snap-btn"
                  onClick={handleMaximize}
                  class="windows-caption-btn"
                >
                  <Show when={isMaximized()} fallback={<IconWinMaximize />}>
                    <IconWinRestore />
                  </Show>
                </button>
              </Tooltip>
              <Tooltip content="Close" placement="bottom" class="h-full">
                <button
                  type="button"
                  aria-label="Close window"
                  id="window-close-btn"
                  onClick={handleClose}
                  onMouseDown={(event) => event.stopPropagation()}
                  class="windows-caption-btn windows-caption-btn-close"
                >
                  <IconWinClose />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      <Show when={serverSwitcherOpen() ? serverSwitcherAnchor : null}>
        {(anchor) => (
          <ServerSwitcher
            anchor={anchor()}
            serverName={props.serverName}
            onSelect={(connection) => {
              setServerSwitcherOpen(false);
              props.onSwitchConnection(connection);
            }}
            onDisconnect={() => {
              setServerSwitcherOpen(false);
              props.onDisconnect();
            }}
            onManageConnections={() => {
              setServerSwitcherOpen(false);
              props.onShowSettings("connections");
            }}
            onClose={() => setServerSwitcherOpen(false)}
          />
        )}
      </Show>
    </>
  );
}
