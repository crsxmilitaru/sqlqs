import { createSignal, createEffect } from "solid-js";
import type { ExecutedQuery } from "../lib/types";
import { loadPreferences } from "../lib/settings";
import { generateTabTitle } from "../lib/sql";

const EXECUTED_QUERIES_STORAGE_KEY = "sqlqs_executed_queries_v1";

function loadExecutedQueries(): ExecutedQuery[] {
  const { maxHistoryItems } = loadPreferences();

  try {
    const raw = localStorage.getItem(EXECUTED_QUERIES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(item => {
        if (typeof item === 'string') {
          return { sql: item, title: generateTabTitle(item) || item.substring(0, 40) + (item.length > 40 ? "..." : "") };
        }

        return item as ExecutedQuery;
      })
      .filter((query): query is ExecutedQuery => !!query.sql && query.sql.trim().length > 0)
      .slice(0, maxHistoryItems);
  } catch {
    return [];
  }
}

export function useHistory() {
  const [executedQueries, setExecutedQueries] = createSignal<ExecutedQuery[]>(loadExecutedQueries());

  createEffect(() => {
    const queries = executedQueries();
    try {
      if (queries.length === 0) {
        localStorage.removeItem(EXECUTED_QUERIES_STORAGE_KEY);
        return;
      }

      const { maxHistoryItems } = loadPreferences();
      localStorage.setItem(
        EXECUTED_QUERIES_STORAGE_KEY,
        JSON.stringify(queries.slice(0, maxHistoryItems)),
      );
    } catch {}
  });

  const addHistory = (sql: string, title?: string, database?: string) => {
    setExecutedQueries((prev) => {
      const normalizedSql = sql.trim();
      if (!normalizedSql) {
        return prev;
      }

      const displayTitle = (title && title !== "Query" && !title.startsWith("Query "))
        ? title
        : (generateTabTitle(normalizedSql) || normalizedSql.substring(0, 40) + (normalizedSql.length > 40 ? "..." : ""));

      const entry: ExecutedQuery = {
        sql: normalizedSql,
        title: displayTitle,
        database: database || "master",
        executedAt: Date.now()
      };
      const { maxHistoryItems } = loadPreferences();
      const next = [entry, ...prev.filter((q) => q.sql !== normalizedSql)].slice(0, maxHistoryItems);
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
