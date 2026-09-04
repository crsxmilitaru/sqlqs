import { invoke } from "@tauri-apps/api/core";
import { createSignal, createEffect, onMount, onCleanup, batch } from "solid-js";
import { loadPreferences, saveAutoConnectStartup } from "../lib/settings";
import type { ConnectionConfig, AppSettings } from "../lib/types";
import { toast } from "../components/ui/Toaster";
import { invalidateSchemaCatalog, setSchemaCatalogScope } from "../lib/schema-catalog";

const STORAGE_KEY_LAST_DATABASE = "sqlqs_last_database";

interface AutoConnectResult {
  connected: boolean;
  server: string | null;
  database: string | null;
  databases: string[];
}

export function useConnection() {
  const [connected, setConnected] = createSignal(false);
  const [isInitializing, setIsInitializing] = createSignal(true);
  const [serverName, setServerName] = createSignal("");
  const [currentDatabase, setCurrentDatabase] = createSignal<
    string | undefined
  >();
  const [databases, setDatabases] = createSignal<string[]>([]);

  let restored = false;
  let connectionSessionCounter = 0;

  const loadDatabases = async () => {
    try {
      const dbs: string[] = await invoke("get_databases");
      batch(() => {
        setDatabases(dbs);
      });
    } catch (err) {
      toast.error(`Failed to load databases: ${String(err)}`);
    }
  };

  const connect = (config: ConnectionConfig) => {
    connectionSessionCounter += 1;
    const authScope = config.use_windows_auth
      ? "windows"
      : config.username?.trim() || "sql";
    const portScope = config.port ? `:${config.port}` : "";
    const scope = `${config.server}${portScope}#${authScope}#${connectionSessionCounter}_${Date.now()}`;
    invalidateSchemaCatalog();
    setSchemaCatalogScope(scope);
    setIsInitializing(false);
    setConnected(true);
    setServerName(config.server);
    const db = config.database || undefined;
    setCurrentDatabase(db);
    if (db) {
      localStorage.setItem(STORAGE_KEY_LAST_DATABASE, db);
    }
    loadDatabases();
  };

  const disconnect = async () => {
    try {
      await invoke("disconnect_from_server");
    } catch (err) {
      toast.error(`Disconnect failed: ${String(err)}`);
    }
    setSchemaCatalogScope("");
    invalidateSchemaCatalog();
    setIsInitializing(false);
    setConnected(false);
    setServerName("");
    setCurrentDatabase(undefined);
    setDatabases([]);
    restored = false;
    localStorage.removeItem(STORAGE_KEY_LAST_DATABASE);
  };

  const changeDatabase = async (db: string): Promise<boolean> => {
    try {
      await invoke("change_database", { database: db });
      setCurrentDatabase(db);
      localStorage.setItem(STORAGE_KEY_LAST_DATABASE, db);
      return true;
    } catch (err) {
      toast.error(`Failed to change database: ${String(err)}`);
      return false;
    }
  };

  createEffect(() => {
    if (
      restored ||
      !connected() ||
      currentDatabase() ||
      databases().length === 0
    )
      return;
    const saved = localStorage.getItem(STORAGE_KEY_LAST_DATABASE);
    if (saved && databases().includes(saved)) {
      restored = true;
      setCurrentDatabase(saved);
      void changeDatabase(saved).then((ok) => {
        if (!ok) {
          setCurrentDatabase(undefined);
          toast.error(`Failed to restore database "${saved}".`);
        }
      });
    }
  });

  onMount(() => {
    let cancelled = false;

    void (async () => {
      try {
        const settings = await invoke<AppSettings>("load_connections");
        if (cancelled) return;
        if (settings.auto_connect_startup !== loadPreferences().autoConnectStartup) {
          saveAutoConnectStartup(settings.auto_connect_startup);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(`Failed to load connection settings: ${String(err)}`);
        }
      }

      if (!loadPreferences().autoConnectStartup) {
        if (!cancelled) setIsInitializing(false);
        return;
      }
      try {
        const result = await invoke<AutoConnectResult>("try_auto_connect");
        if (cancelled) return;
        if (result.connected) {
          connectionSessionCounter += 1;
          const scope = `${result.server || "localhost"}#auto#${connectionSessionCounter}_${Date.now()}`;
          invalidateSchemaCatalog();
          setSchemaCatalogScope(scope);
          setConnected(true);
          setServerName(result.server || "");
          let db = result.database || undefined;
          if (!db) {
            const saved = localStorage.getItem(STORAGE_KEY_LAST_DATABASE);
            if (saved && result.databases.includes(saved)) {
              db = saved;
              restored = true;
              void changeDatabase(saved).then((ok) => {
                if (!ok) {
                  setCurrentDatabase(undefined);
                  toast.error(`Failed to restore database "${saved}".`);
                }
              });
            }
          }
          setCurrentDatabase(db);
          batch(() => {
            setDatabases(result.databases);
          });
          if (result.databases.length === 0) {
            void loadDatabases();
          }
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(`Auto-connect failed: ${String(err)}`);
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    })();

    onCleanup(() => {
      cancelled = true;
    });
  });

  return {
    connected,
    isInitializing,
    serverName,
    currentDatabase,
    databases,
    connect,
    disconnect,
    changeDatabase,
    refreshDatabases: loadDatabases,
  };
}
