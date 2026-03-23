import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ConnectionConfig } from "../lib/types";
import { AiService } from "../lib/ai";

export function useConnection() {
  const [connected, setConnected] = useState(false);
  const [serverName, setServerName] = useState("");
  const [currentDatabase, setCurrentDatabase] = useState<string | undefined>();
  const [databases, setDatabases] = useState<string[]>([]);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

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
    async function tryAutoConnect() {
      try {
        const settings: AppSettings = await invoke("load_connections");

        if (
          settings.keep_logged_in &&
          settings.last_connection &&
          settings.connections.length > 0
        ) {
          const lastConn = settings.connections.find(
            (c) => c.name === settings.last_connection,
          );
          if (lastConn) {
            const password: string | null = await invoke("load_saved_password", {
              connectionName: lastConn.name,
            });

            const config: ConnectionConfig = {
              ...lastConn.config,
              password: password || undefined,
            };

            await invoke("connect_to_server", {
              config,
              saveConnection: lastConn.name,
              rememberPassword: !!password,
              keepLoggedIn: true,
            });

            connect(config);
          }
        }
      } catch {
      } finally {
        setIsAuthLoading(false);
      }
    }
    tryAutoConnect();
  }, [connect]);

  return {
    connected,
    serverName,
    currentDatabase,
    databases,
    isAuthLoading,
    connect,
    disconnect,
    changeDatabase,
  };
}
