import { createSignal, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  baseFileName,
  getSavedQueriesDir,
  isSamePath,
  joinPath,
  sanitizeSavedQueryFileName,
} from "../lib/path";
import { toast } from "../components/ui/Toaster";

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
        typeof q.savedAt === "number",
    );
  } catch {
    return [];
  }
}

export function useSavedQueries() {
  const [savedQueries, setSavedQueries] =
    createSignal<SavedQuery[]>(loadSavedQueries());

  createEffect(() => {
    const queries = savedQueries();
    try {
      if (queries.length === 0) {
        localStorage.removeItem(SAVED_QUERIES_STORAGE_KEY);
        return;
      }

      localStorage.setItem(SAVED_QUERIES_STORAGE_KEY, JSON.stringify(queries));
    } catch {
      return;
    }
  });

  const saveQuery = async (
    title: string,
    sql: string,
    targetFilePath?: string,
  ): Promise<SavedQuery | null> => {
    try {
      let filePath: string;
      let fileName: string;

      if (targetFilePath) {
        filePath = targetFilePath;
        fileName = baseFileName(filePath);
      } else {
        const documentsPath = await invoke<string>("get_documents_folder");
        const savedQueriesDir = getSavedQueriesDir(documentsPath);
        fileName = sanitizeSavedQueryFileName(title);
        filePath = joinPath(savedQueriesDir, fileName);
      }

      await invoke<string>("write_sql_file", { path: filePath, content: sql });

      const existing = savedQueries().find((q) => isSamePath(q.filePath, filePath));
      const savedQuery: SavedQuery = {
        id: existing?.id ?? generateId(),
        title: existing?.title ?? title,
        fileName,
        filePath,
        savedAt: Date.now(),
      };

      setSavedQueries((prev) => {
        const filtered = prev.filter((q) => !isSamePath(q.filePath, filePath));
        return [savedQuery, ...filtered];
      });

      return savedQuery;
    } catch (err) {
      toast.error(`Failed to save query: ${String(err)}`);
      return null;
    }
  };

  const deleteQuery = async (id: string): Promise<boolean> => {
    try {
      const query = savedQueries().find((q) => q.id === id);
      if (!query) {
        return false;
      }

      try {
        await invoke("delete_sql_file", { path: query.filePath });
      } catch (err) {
        toast.error(`Failed to delete saved query file: ${String(err)}`);
        return false;
      }

      setSavedQueries((prev) => prev.filter((q) => q.id !== id));
      return true;
    } catch (err) {
      toast.error(`Failed to delete saved query: ${String(err)}`);
      return false;
    }
  };

  const renameQuery = async (
    id: string,
    newTitle: string,
  ): Promise<SavedQuery | null> => {
    const title = newTitle.trim();
    if (!title) {
      return null;
    }

    const query = savedQueries().find((q) => q.id === id);
    if (!query) {
      return null;
    }

    const fileName = sanitizeSavedQueryFileName(title);
    const documentsPath = await invoke<string>("get_documents_folder");
    const filePath = joinPath(getSavedQueriesDir(documentsPath), fileName);
    const fileNameLower = fileName.toLowerCase();
    const collision = savedQueries().some(
      (q) =>
        q.id !== id &&
        (q.filePath === filePath || q.fileName.toLowerCase() === fileNameLower),
    );
    if (collision) {
      throw new Error("A query with that name already exists.");
    }

    if (query.fileName !== fileName) {
      await invoke<string>("rename_sql_file", {
        from: query.filePath,
        to: filePath,
      });
    }

    const updated: SavedQuery = {
      ...query,
      title,
      fileName,
      filePath,
    };

    setSavedQueries((prev) => prev.map((q) => (q.id === id ? updated : q)));
    return updated;
  };

  const loadQueryContent = async (filePath: string): Promise<string | null> => {
    try {
      const result = await invoke<{ content: string }>("read_sql_file", {
        path: filePath,
      });
      return result.content;
    } catch {
      return null;
    }
  };

  return {
    savedQueries,
    saveQuery,
    deleteQuery,
    renameQuery,
    loadQueryContent,
  };
}
