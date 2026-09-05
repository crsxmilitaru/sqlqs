import { createSignal, createEffect } from "solid-js";
import type { ExecutedQuery } from "../lib/types";
import { loadPreferences } from "../lib/settings";
import { generateTabTitle } from "../lib/sql";

const HISTORY_STORAGE_PREFIX = "sqlqs_executed_queries_v2_";
const LEGACY_STORAGE_KEY = "sqlqs_executed_queries_v1";

export function getHistoryStorageKey(connectionKey?: string): string {
  const trimmed = connectionKey?.trim();
  if (!trimmed) {
    return LEGACY_STORAGE_KEY;
  }
  return `${HISTORY_STORAGE_PREFIX}${encodeURIComponent(trimmed.toLowerCase())}`;
}

function loadExecutedQueries(storageKey: string): ExecutedQuery[] {
  const { maxHistoryItems } = loadPreferences();

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (typeof item === "string") {
          return {
            sql: item,
            title:
              generateTabTitle(item) ||
              item.substring(0, 40) + (item.length > 40 ? "..." : ""),
          };
        }

        return item as ExecutedQuery;
      })
      .filter(
        (query): query is ExecutedQuery =>
          !!query.sql && query.sql.trim().length > 0,
      )
      .slice(0, maxHistoryItems);
  } catch {
    return [];
  }
}

export function useHistory(connectionKey?: () => string) {
  const currentKey = () => connectionKey?.() || "";
  const storageKey = () => getHistoryStorageKey(currentKey());

  const [executedQueries, setExecutedQueries] = createSignal<ExecutedQuery[]>(
    loadExecutedQueries(storageKey()),
  );

  createEffect(() => {
    const key = storageKey();
    setExecutedQueries(loadExecutedQueries(key));
  });

  createEffect(() => {
    const queries = executedQueries();
    const key = storageKey();
    try {
      if (queries.length === 0) {
        localStorage.removeItem(key);
        return;
      }

      const { maxHistoryItems } = loadPreferences();
      localStorage.setItem(
        key,
        JSON.stringify(queries.slice(0, maxHistoryItems)),
      );
    } catch {
      return;
    }
  });

  const addHistory = (
    sql: string,
    title?: string,
    database?: string,
    sourceId?: string,
    savedQueryFilePath?: string,
  ) => {
    setExecutedQueries((prev) => {
      const normalizedSql = sql.trim();
      if (!normalizedSql) {
        return prev;
      }

      const existing = prev.find((q) => q.sql === normalizedSql);
      const displayTitle =
        title && title !== "Query" && !title.startsWith("Query ")
          ? title
          : existing?.title ||
            generateTabTitle(normalizedSql) ||
            normalizedSql.substring(0, 40) +
              (normalizedSql.length > 40 ? "..." : "");

      const entry: ExecutedQuery = {
        sql: normalizedSql,
        title: displayTitle,
        database: database || existing?.database || "master",
        executedAt: Date.now(),
        sourceId: sourceId ?? existing?.sourceId,
        savedQueryFilePath: savedQueryFilePath ?? existing?.savedQueryFilePath,
      };
      const { maxHistoryItems } = loadPreferences();
      const next = [
        entry,
        ...prev.filter((q) => q.sql !== normalizedSql),
      ].slice(0, maxHistoryItems);
      return next;
    });
  };

  const deleteHistory = (sql: string) => {
    setExecutedQueries((prev) => prev.filter((q) => q.sql !== sql));
  };

  const clearHistory = () => {
    setExecutedQueries([]);
  };

  return {
    executedQueries,
    addHistory,
    deleteHistory,
    clearHistory,
  };
}
