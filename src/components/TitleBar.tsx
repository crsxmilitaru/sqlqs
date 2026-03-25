import { useCallback } from "react";
import { getModifierKeyLabel, isMacOS } from "../lib/platform";
import Tooltip from "./Tooltip";

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
  dialogOpen?: boolean;
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
  dialogOpen = false,
}: Props) {
  const isMac = isMacOS();
  const openFileShortcut = `${getModifierKeyLabel()}+O`;

  const handleMinimize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().minimize();
  }, []);

  const handleMaximize = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }, []);

  const handleClose = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    getCurrentWindow().close();
  }, []);

  return (
    <div data-tauri-drag-region className="flex items-center justify-between h-11 select-none flex-shrink-0 relative">
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none gap-2"
      >
        <img src="/favicon.png" alt="" className="w-4 h-4 opacity-70" />
        <span className="text-text-muted font-medium text-[11px] uppercase tracking-[0.15em] opacity-70">
          SQL Query Studio
        </span>
      </div>

      <div className="flex items-center h-full z-10 px-3 gap-1.5">
        {isMac && (
          <div className="flex items-center gap-2 pr-2">
            <Tooltip content="Close" placement="bottom">
              <button
                onClick={handleClose}
                aria-label="Close window"
                className="w-3 h-3 rounded-full border border-black/20 bg-[#ff5f57] transition-transform hover:scale-110"
              />
            </Tooltip>
            <Tooltip content="Minimize" placement="bottom">
              <button
                onClick={handleMinimize}
                aria-label="Minimize window"
                className="w-3 h-3 rounded-full border border-black/20 bg-[#febc2e] transition-transform hover:scale-110"
              />
            </Tooltip>
            <Tooltip content="Zoom" placement="bottom">
              <button
                onClick={handleMaximize}
                aria-label="Toggle zoom"
                className="w-3 h-3 rounded-full border border-black/20 bg-[#28c840] transition-transform hover:scale-110"
              />
            </Tooltip>
          </div>
        )}
        {onToggleSidebar && (
          <Tooltip content={sidebarVisible ? "Hide Sidebar" : "Show Sidebar"} placement="bottom">
            <button
              onClick={onToggleSidebar}
              disabled={dialogOpen}
              className={`w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${sidebarVisible ? "text-text-muted hover:text-text" : "text-accent"}`}
            >
              <i className="fa-solid fa-table-columns text-[13px]" />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Settings" placement="bottom">
          <button
            onClick={onShowSettings}
            disabled={settingsDisabled || dialogOpen}
            className="text-text-muted hover:text-text w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-gear text-[13px]" />
          </button>
        </Tooltip>
        <Tooltip content={`Open File (${openFileShortcut})`} placement="bottom">
          <button
            onClick={onOpenSqlFile}
            disabled={dialogOpen}
            className="text-text-muted hover:text-text w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-folder-open text-[13px]" />
          </button>
        </Tooltip>
      </div>

      <div className="flex h-full items-center z-10">
        {connected ? (
          <Tooltip content="Click to disconnect" placement="bottom">
            <button
              onClick={onDisconnect}
              disabled={dialogOpen}
              className="flex items-center gap-2 px-2.5 h-8 rounded-md hover:bg-surface-hover text-text-muted hover:text-text transition-all group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-success drop-shadow-[0_0_2px_color-mix(in_srgb,var(--color-success)_40%,transparent)]" />
              <span className="text-[11px] font-medium tracking-wide">
                {serverName}
              </span>
            </button>
          </Tooltip>
        ) : (
          <button
            onClick={onConnect}
            disabled={dialogOpen}
            className="flex items-center px-2.5 h-8 rounded-md hover:bg-surface-hover text-accent hover:text-accent-hover text-[11px] font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Connect Server
          </button>
        )}
        {!isMac && (
          <div className="flex h-full ml-4">
            <Tooltip content="Minimize" placement="bottom">
              <button
                onClick={handleMinimize}
                className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all"
              >
                <i className="fa-solid fa-window-minimize text-[10px]" />
              </button>
            </Tooltip>
            <Tooltip content="Maximize" placement="bottom">
              <button
                onClick={handleMaximize}
                className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text transition-all"
              >
                <i className="fa-regular fa-square text-[10px]" />
              </button>
            </Tooltip>
            <Tooltip content="Close" placement="bottom">
              <button
                onClick={handleClose}
                className="w-14 h-full flex items-center justify-center text-text-muted hover:bg-[#c42b1c] hover:text-white transition-all"
              >
                <i className="fa-solid fa-xmark text-[14px]" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
