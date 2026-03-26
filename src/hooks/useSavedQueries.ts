import { useState, useCallback, useEffect } from "react";
import { getSavedQueriesDir, joinPath } from "../lib/path";

export interface SavedQuery {
  id: string;
  title: string;
  fileName: string;
  filePath: string;
  savedAt: number;
}

const SAVED_QUERIES_STORAGE_KEY = "sqlqs_saved_queries_v1";

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function loadSavedQueries(): SavedQuery[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = localStorage.getItem(SAVED_QUERIES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (q): q is SavedQuery =>
        typeof q.id === "string" &&
        typeof q.title === "string" &&
        typeof q.fileName === "string" &&
        typeof q.filePath === "string" &&
        typeof q.savedAt === "number"
    );
  } catch {
    return [];
  }
}

export function useSavedQueries() {
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => loadSavedQueries());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (savedQueries.length === 0) {
        localStorage.removeItem(SAVED_QUERIES_STORAGE_KEY);
        return;
      }

      localStorage.setItem(SAVED_QUERIES_STORAGE_KEY, JSON.stringify(savedQueries));
    } catch { }
  }, [savedQueries]);

  const saveQuery = useCallback(async (title: string, sql: string): Promise<SavedQuery | null> => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      const documentsPath = await invoke<string>("get_documents_folder");
      const savedQueriesDir = getSavedQueriesDir(documentsPath);

      const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, "_").trim() || "Query";
      const fileName = `${sanitizedTitle}.sql`;
      const filePath = joinPath(savedQueriesDir, fileName);

      await invoke<string>("write_sql_file", { path: filePath, content: sql });

      const savedQuery: SavedQuery = {
        id: generateId(),
        title,
        fileName,
        filePath,
        savedAt: Date.now(),
      };

      setSavedQueries((prev) => {
        const filtered = prev.filter((q) => q.filePath !== filePath);
        return [savedQuery, ...filtered];
      });

      return savedQuery;
    } catch (err) {
      console.error("Failed to save query:", err);
      return null;
    }
  }, []);

  const deleteQuery = useCallback(async (id: string): Promise<boolean> => {
    try {
      const query = savedQueries.find((q) => q.id === id);
      if (!query) {
        return false;
      }

      setSavedQueries((prev) => prev.filter((q) => q.id !== id));
      return true;
    } catch (err) {
      console.error("Failed to delete saved query:", err);
      return false;
    }
  }, [savedQueries]);

  const loadQueryContent = useCallback(async (filePath: string): Promise<string | null> => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ content: string }>("read_sql_file", { path: filePath });
      return result.content;
    } catch (err) {
      console.error("Failed to load query content:", err);
      return null;
    }
  }, []);

  return {
    savedQueries,
    saveQuery,
    deleteQuery,
    loadQueryContent,
  };
}
