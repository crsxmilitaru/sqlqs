import { useState, useCallback, useEffect } from "react";
import type { ExecutedQuery } from "../lib/types";
import { loadPreferences } from "../lib/settings";
import { generateTabTitle } from "../lib/sql";

const EXECUTED_QUERIES_STORAGE_KEY = "sqlqs_executed_queries_v1";

function loadExecutedQueries(): ExecutedQuery[] {
  if (typeof window === "undefined") {
    return [];
  }

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
          return { sql: item, title: item.substring(0, 40) + (item.length > 40 ? "..." : "") };
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
  const [executedQueries, setExecutedQueries] = useState<ExecutedQuery[]>(() => loadExecutedQueries());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (executedQueries.length === 0) {
        localStorage.removeItem(EXECUTED_QUERIES_STORAGE_KEY);
        return;
      }

      const { maxHistoryItems } = loadPreferences();
      localStorage.setItem(
        EXECUTED_QUERIES_STORAGE_KEY,
        JSON.stringify(executedQueries.slice(0, maxHistoryItems)),
      );
    } catch {}
  }, [executedQueries]);

  const addHistory = useCallback((sql: string, title?: string, database?: string) => {
    setExecutedQueries((prev) => {
      const normalizedSql = sql.trim();
      if (!normalizedSql) {
        return prev;
      }
      
      const displayTitle = (title && !title.startsWith("Query ")) 
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
  }, []);

  const deleteHistory = useCallback((sql: string) => {
    setExecutedQueries((prev) => prev.filter((q) => q.sql !== sql));
  }, []);

  return {
    executedQueries,
    addHistory,
    deleteHistory,
  };
}
