import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig } from "../lib/types";
import { AiService } from "../lib/ai";

interface AutoConnectResult {
  connected: boolean;
  server: string | null;
  database: string | null;
  databases: string[];
}

export function useConnection() {
  const [connected, setConnected] = useState(false);
  const [serverName, setServerName] = useState("");
  const [currentDatabase, setCurrentDatabase] = useState<string | undefined>();
  const [databases, setDatabases] = useState<string[]>([]);

  const loadDatabases = useCallback(async () => {
    try {
      const dbs: string[] = await invoke("get_databases");
      setDatabases(dbs);
    } catch (err) {
      console.error("Failed to load databases:", err);
    }
  }, []);

  const connect = useCallback((config: ConnectionConfig) => {
    setConnected(true);
    setServerName(config.server);
    setCurrentDatabase(config.database || undefined);
    loadDatabases();
  }, [loadDatabases]);

  const disconnect = useCallback(async () => {
    try {
      await invoke("disconnect_from_server");
    } catch {}
    setConnected(false);
    setServerName("");
    setCurrentDatabase(undefined);
    setDatabases([]);
    AiService.invalidateSchemaCache();
  }, []);

  const changeDatabase = useCallback(async (db: string) => {
    try {
      await invoke("change_database", { database: db });
      setCurrentDatabase(db);
      AiService.invalidateSchemaCache();
    } catch {}
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tryAutoConnect() {
      try {
        const result = await invoke<AutoConnectResult>("try_auto_connect");
        if (cancelled) return;
        if (result.connected) {
          setConnected(true);
          setServerName(result.server || "");
          setCurrentDatabase(result.database || undefined);
          setDatabases(result.databases);
        }
      } catch {}
    }
    tryAutoConnect();
    return () => { cancelled = true; };
  }, []);

  return {
    connected,
    serverName,
    currentDatabase,
    databases,
    connect,
    disconnect,
    changeDatabase,
  };
}
