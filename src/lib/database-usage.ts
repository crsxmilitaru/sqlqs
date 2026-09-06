import { bestEffortSync } from "./platform";
import type { ExecutedQuery } from "./types";

const STORAGE_KEY_DATABASE_USAGE = "sqlqs_database_usage_v1";

export interface DatabaseUsageEntry {
  count: number;
  lastUsed: number;
}

export type ServerDatabaseUsageMap = Record<
  string,
  Record<string, DatabaseUsageEntry>
>;

function getServerKey(serverName?: string): string {
  return serverName?.trim() || "_default";
}

export function loadAllDatabaseUsage(): ServerDatabaseUsageMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATABASE_USAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const keys = Object.keys(parsed);
      if (keys.length === 0) return {};
      const firstVal = parsed[keys[0]];
      if (firstVal && typeof firstVal === "object" && "count" in firstVal) {
        return { _default: parsed as Record<string, DatabaseUsageEntry> };
      }
      return parsed as ServerDatabaseUsageMap;
    }
    return {};
  } catch {
    return {};
  }
}

export function loadDatabaseUsage(
  serverName?: string,
): Record<string, DatabaseUsageEntry> {
  const allUsage = loadAllDatabaseUsage();
  const key = getServerKey(serverName);
  return allUsage[key] || allUsage._default || {};
}

export function saveAllDatabaseUsage(usage: ServerDatabaseUsageMap): void {
  if (typeof localStorage === "undefined") return;
  bestEffortSync(() => {
    localStorage.setItem(STORAGE_KEY_DATABASE_USAGE, JSON.stringify(usage));
  });
}

export function recordDatabaseUsage(
  database: string,
  serverName?: string,
): void {
  const name = database?.trim();
  if (!name) return;

  const allUsage = loadAllDatabaseUsage();
  const key = getServerKey(serverName);
  const serverUsage = allUsage[key] || {};
  const current = serverUsage[name] || { count: 0, lastUsed: 0 };

  serverUsage[name] = {
    count: (current.count || 0) + 1,
    lastUsed: Date.now(),
  };
  allUsage[key] = serverUsage;
  saveAllDatabaseUsage(allUsage);
}

export function getMostUsedDatabases(
  availableDatabases: string[],
  history?: ExecutedQuery[],
  serverName?: string,
  limit = 3,
): string[] {
  if (!availableDatabases || availableDatabases.length === 0) return [];

  const usage = loadDatabaseUsage(serverName);
  const combinedCounts: Record<string, { count: number; lastUsed: number }> = {
    ...usage,
  };

  if (Array.isArray(history) && history.length > 0) {
    for (const item of history) {
      if (!item.database) continue;
      const db = item.database.trim();
      if (!db) continue;
      if (!combinedCounts[db]) {
        combinedCounts[db] = {
          count: 1,
          lastUsed: item.executedAt || 0,
        };
      } else if (!usage[db]) {
        combinedCounts[db].count += 1;
        if (
          item.executedAt &&
          item.executedAt > (combinedCounts[db].lastUsed || 0)
        ) {
          combinedCounts[db].lastUsed = item.executedAt;
        }
      }
    }
  }

  return availableDatabases
    .filter((db) => combinedCounts[db] && combinedCounts[db].count > 0)
    .sort((a, b) => {
      const uA = combinedCounts[a]!;
      const uB = combinedCounts[b]!;
      if (uB.count !== uA.count) return uB.count - uA.count;
      return (uB.lastUsed || 0) - (uA.lastUsed || 0);
    })
    .slice(0, limit);
}
