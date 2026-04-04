import { invoke } from "@tauri-apps/api/core";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "../lib/types";

const STORAGE_KEY_LAST_DATABASE = "sqlqs_last_database";

interface AutoConnectResult {
  connected: boolean;
  server: string | null;
  database: string | null;
  databases: string[];
}

export function useConnection() {
  const [connected, setConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [serverName, setServerName] = useState("");
  const [currentDatabase, setCurrentDatabase] = useState<string | undefined>();
  const [databases, setDatabases] = useState<string[]>([]);

  const restoredRef = useRef(false);

  const loadDatabases = useCallback(async () => {
    try {
      const dbs: string[] = await invoke("get_databases");
      startTransition(() => {
        setDatabases(dbs);
      });
    } catch (err) {
      console.error("Failed to load databases:", err);
    }
  }, []);

  const connect = useCallback((config: ConnectionConfig) => {
    setIsInitializing(false);
    setConnected(true);
    setServerName(config.server);
    const db = config.database || undefined;
    setCurrentDatabase(db);
    if (db) {
      localStorage.setItem(STORAGE_KEY_LAST_DATABASE, db);
    }
    loadDatabases();
  }, [loadDatabases]);

  const disconnect = useCallback(async () => {
    try {
      await invoke("disconnect_from_server");
    } catch { }
    setIsInitializing(false);
    setConnected(false);
    setServerName("");
    setCurrentDatabase(undefined);
    setDatabases([]);
    restoredRef.current = false;
  }, []);

  const changeDatabase = useCallback(async (db: string) => {
    try {
      await invoke("change_database", { database: db });
      setCurrentDatabase(db);
      localStorage.setItem(STORAGE_KEY_LAST_DATABASE, db);
    } catch { }
  }, []);

  useEffect(() => {
    if (restoredRef.current || !connected || currentDatabase || databases.length === 0) return;
    const saved = localStorage.getItem(STORAGE_KEY_LAST_DATABASE);
    if (saved && databases.includes(saved)) {
      restoredRef.current = true;
      setCurrentDatabase(saved);
      invoke("change_database", { database: saved }).catch(() => { });
    }
  }, [connected, currentDatabase, databases]);

  useEffect(() => {
    let cancelled = false;
    async function tryAutoConnect() {
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
              restoredRef.current = true;
              invoke("change_database", { database: saved }).catch(() => { });
            }
          }
          setCurrentDatabase(db);
          startTransition(() => {
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
    }
    tryAutoConnect();
    return () => { cancelled = true; };
  }, [loadDatabases]);

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
