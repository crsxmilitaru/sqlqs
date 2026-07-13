import { createSignal, createEffect } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AiService } from "../../lib/ai";
import { isMacOS } from "../../lib/platform";
import type { ServerObjectIndexStatus } from "../../lib/types";
import Tooltip from "../ui/Tooltip";
import { Loader } from "../ui/Loader";

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
  serverName: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenSqlFile: () => void;
  onShowBackupRestore?: () => void;
  onToggleObjectJump?: () => void;
  objectJumpOpen?: boolean;
  objectJumpIndexStatus?: ServerObjectIndexStatus;
  onShowSettings: () => void;
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
}

export default function TitleBar(props: Props) {
  const isMac = isMacOS();
  const [hasAiKey, setHasAiKey] = createSignal(false);

  createEffect(() => {
    const _ = props.hideAppContent;
    AiService.getStatus().then((s) => setHasAiKey(s.hasKey));
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

  async function handleMinimize() {
    await getCurrentWindow().minimize();
  }

  async function handleMaximize() {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
  }

  async function handleClose() {
    await getCurrentWindow().close();
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
        data-tauri-drag-region
        class="app-titlebar flex items-center h-11 select-none flex-shrink-0 relative"
        onMouseDown={handleTitleBarMouseDown}
      >
        <div
          class="flex items-center h-full px-3 gap-1.5 flex-shrink-0"
          style={{
            width:
              props.sidebarVisible && props.connected
                ? `${(props.sidebarWidth ?? 325) + 1}px`
                : "auto",
          }}
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
                    (props.sidebarVisible ?? true)
                      ? "Hide Sidebar"
                      : "Show Sidebar"
                  }
                  placement="bottom"
                >
                  <button
                    onClick={props.onToggleSidebar}
                    disabled={(props.dialogOpen ?? false) || !props.connected}
                    class={`control-icon-btn titlebar-icon-btn ${
                      (props.sidebarVisible ?? true) ? "" : "is-active"
                    }`}
                  >
                    <i class="fa-solid fa-table-columns text-m" />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Settings" placement="bottom">
                <button
                  onClick={props.onShowSettings}
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
                <Tooltip content="Click to disconnect" placement="bottom">
                  <button
                    onClick={props.onDisconnect}
                    disabled={props.dialogOpen ?? false}
                    class="titlebar-text-btn"
                  >
                    <i class="fa-solid fa-server text-s" />
                    <span class="text-s font-medium tracking-wide truncate max-w-[120px]">
                      {props.serverName}
                    </span>
                  </button>
                </Tooltip>
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
            </>
          )}
        </div>

        {!props.hideAppContent && props.connected && (
          <div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center no-drag">
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

        <div class="flex-1" />

        <div class="flex h-full flex-shrink-0">
          {!props.hideAppContent && isMac && props.connected && (
            <Tooltip content="Click to disconnect" placement="bottom">
              <button
                onClick={props.onDisconnect}
                disabled={props.dialogOpen ?? false}
                class="titlebar-text-btn"
              >
                <i class="fa-solid fa-server text-s" />
                <span class="text-s font-medium tracking-wide truncate max-w-[120px]">
                  {props.serverName}
                </span>
              </button>
            </Tooltip>
          )}
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
          {!props.hideAppContent && (
            <div class="flex items-center self-center">
              <Tooltip
                content={
                  !hasAiKey()
                    ? "AI Chat • Add a Gemini API key in Settings"
                    : !props.connected
                      ? "AI Chat • Connect to a server"
                      : "AI Chat"
                }
                placement="bottom"
              >
                <button
                  onClick={props.onToggleAiChat}
                  disabled={!hasAiKey() || !props.connected || !props.hasTabs}
                  class={`control-icon-btn titlebar-icon-btn ${
                    props.aiChatOpen ? "is-active" : ""
                  }`}
                >
                  <i class="fa-solid fa-message text-m" />
                </button>
              </Tooltip>
            </div>
          )}
          {!isMac && !props.hideAppContent && <div class="ui-divider mx-2.5 self-center" />}
          {!isMac && (
            <div class="flex h-full relative z-[9999]">
              <Tooltip content="Minimize" placement="bottom">
                <button onClick={handleMinimize} class="windows-caption-btn">
                  <i class="fa-solid fa-window-minimize text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Maximize" placement="bottom">
                <button onClick={handleMaximize} class="windows-caption-btn">
                  <i class="fa-regular fa-square text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Close" placement="bottom">
                <button
                  onClick={handleClose}
                  class="windows-caption-btn windows-caption-btn-close"
                >
                  <i class="fa-solid fa-xmark text-m" />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
