import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { invoke } from "@tauri-apps/api/core";
import { parseConnectionStringPreview, summarizeConnection } from "../../lib/connections";
import type { AppSettings, SavedConnection } from "../../lib/types";
import { usePopupDismiss } from "../../hooks/usePopupDismiss";
import { toast } from "../ui/Toaster";

interface Props {
  anchor: HTMLElement;
  serverName: string;
  onSelect: (connection: SavedConnection) => void;
  onDisconnect: () => void;
  onManageConnections: () => void;
  onClose: () => void;
}

const VIEWPORT_PAD = 8;
const ANCHOR_GAP = 6;

export default function ServerSwitcher(props: Props) {
  let popupRef: HTMLDivElement | undefined;
  const [connections, setConnections] = createSignal<SavedConnection[]>([]);
  const [lastConnection, setLastConnection] = createSignal<string>();
  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [placed, setPlaced] = createSignal(false);

  onMount(() => {
    void (async () => {
      try {
        const settings = await invoke<AppSettings>("load_connections");
        setConnections(settings.connections);
        setLastConnection(settings.last_connection);
      } catch (err) {
        props.onClose();
        toast.error(`Failed to load saved connections: ${String(err)}`);
      }
    })();
  });

  function place() {
    const el = popupRef;
    if (!el) return;
    const rect = props.anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    const x = Math.min(
      Math.max(VIEWPORT_PAD, rect.left),
      vw - width - VIEWPORT_PAD,
    );
    let y = rect.bottom + ANCHOR_GAP;
    if (y + height > vh - VIEWPORT_PAD) {
      y = Math.max(VIEWPORT_PAD, rect.top - height - ANCHOR_GAP);
    }
    setPosition({ x, y });
    setPlaced(true);
  }

  onMount(() => {
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    });
  });

  usePopupDismiss({
    getPopup: () => popupRef,
    getIgnore: () => [props.anchor],
    onClose: props.onClose,
  });

  function isActive(connection: SavedConnection) {
    if (connection.name !== lastConnection()) return false;
    const cfg = connection.config;
    const server = cfg.connection_string
      ? parseConnectionStringPreview(cfg.connection_string).server
      : cfg.server;
    return server.toLowerCase() === props.serverName.toLowerCase();
  }

  return (
    <Portal>
      <div
        ref={popupRef}
        class="popup-menu fixed rounded-lg w-[240px]"
        classList={{ "animate-popover-in": placed() }}
        role="menu"
        aria-label="Server connections"
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
          visibility: placed() ? "visible" : "hidden",
        }}
      >
        <div class="px-3 pt-1 pb-1.5 text-2xs font-semibold text-text-muted uppercase tracking-wider select-none">
          Connections
        </div>

        <div class="max-h-[45vh] overflow-y-auto py-1 border-y border-border/50">
          <Show
            when={connections().length > 0}
            fallback={
              <div class="px-3 py-2.5 text-s text-text-muted select-none">
                No saved connections yet.
              </div>
            }
          >
            <For each={connections()}>
              {(connection) => {
                const active = () => isActive(connection);
                return (
                  <button
                    type="button"
                    role="menuitem"
                    aria-current={active() ? "true" : undefined}
                    disabled={active()}
                    onClick={() => props.onSelect(connection)}
                    class="popup-menu-item rounded-md mx-1 w-[calc(100%-8px)] flex-col items-start gap-0.5 py-2 disabled:opacity-100"
                    classList={{ "bg-surface-active": active() }}
                    title={`${connection.name} · ${summarizeConnection(connection)}`}
                  >
                    <span class="flex items-center gap-2 min-w-0 w-full">
                      <span class="w-3.5 flex-shrink-0 flex items-center justify-center">
                        <Show when={active()}>
                          <i class="fa-solid fa-check text-2xs text-accent" />
                        </Show>
                      </span>
                      <span class="text-s text-text truncate">
                        {connection.name}
                      </span>
                    </span>
                    <span class="pl-5.5 text-xs text-text-muted truncate w-full">
                      {summarizeConnection(connection)}
                    </span>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="pt-1.5">
          <button
            type="button"
            role="menuitem"
            onClick={props.onManageConnections}
            class="popup-menu-item rounded-md mx-1 w-[calc(100%-8px)]"
          >
            <span class="w-3.5 flex-shrink-0 flex items-center justify-center">
              <i class="fa-solid fa-gear text-2xs" />
            </span>
            <span class="text-s">Connection Settings…</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={props.onDisconnect}
            class="popup-menu-item rounded-md mx-1 w-[calc(100%-8px)] text-error hover:bg-error/10 hover:text-error"
          >
            <span class="w-3.5 flex-shrink-0 flex items-center justify-center">
              <i class="fa-solid fa-power-off text-2xs" />
            </span>
            <span class="text-s">Disconnect</span>
          </button>
        </div>
      </div>
    </Portal>
  );
}
