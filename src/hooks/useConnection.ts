import { invoke } from "@tauri-apps/api/core";
import { createSignal, createEffect, onMount, batch } from "solid-js";
import type { ConnectionConfig } from "../lib/types";

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
  const [currentDatabase, setCurrentDatabase] = createSignal<string | undefined>();
  const [databases, setDatabases] = createSignal<string[]>([]);

  let restored = false;

  const loadDatabases = async () => {
    try {
      const dbs: string[] = await invoke("get_databases");
      batch(() => {
        setDatabases(dbs);
      });
    } catch (err) {
      console.error("Failed to load databases:", err);
    }
  };

  const connect = (config: ConnectionConfig) => {
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
    } catch { }
    setIsInitializing(false);
    setConnected(false);
    setServerName("");
    setCurrentDatabase(undefined);
    setDatabases([]);
    restored = false;
  };

  const changeDatabase = async (db: string) => {
    try {
      await invoke("change_database", { database: db });
      setCurrentDatabase(db);
      localStorage.setItem(STORAGE_KEY_LAST_DATABASE, db);
    } catch { }
  };

  // Restore last database from localStorage
  createEffect(() => {
    if (restored || !connected() || currentDatabase() || databases().length === 0) return;
    const saved = localStorage.getItem(STORAGE_KEY_LAST_DATABASE);
    if (saved && databases().includes(saved)) {
      restored = true;
      setCurrentDatabase(saved);
      invoke("change_database", { database: saved }).catch(() => { });
    }
  });

  // Auto-connect on mount
  onMount(async () => {
    let cancelled = false;
    try {
      const result = await invoke<AutoConnectResult>("try_auto_connect");
      if (cancelled) return;
      if (result.connected) {
        setConnected(true);
        setServerName(result.server || "");
        let db = result.database || undefined;
        if (!db) {
          const saved = localStorage.getItem(STORAGE_KEY_LAST_DATABASE);
          if (saved && result.databases.includes(saved)) {
            db = saved;
            restored = true;
            invoke("change_database", { database: saved }).catch(() => { });
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
    } catch {
    } finally {
      if (!cancelled) {
        setIsInitializing(false);
      }
    }
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
