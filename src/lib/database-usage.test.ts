import { beforeEach, describe, expect, it } from "vitest";
import {
  getMostUsedDatabases,
  loadAllDatabaseUsage,
  loadDatabaseUsage,
  recordDatabaseUsage,
  saveAllDatabaseUsage,
} from "./database-usage";
import type { ExecutedQuery } from "./types";

describe("database-usage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads empty usage when storage is empty or invalid", () => {
    expect(loadAllDatabaseUsage()).toEqual({});
    expect(loadDatabaseUsage("srv1")).toEqual({});

    localStorage.setItem("sqlqs_database_usage_v1", "invalid json");
    expect(loadAllDatabaseUsage()).toEqual({});

    localStorage.setItem("sqlqs_database_usage_v1", "[]");
    expect(loadAllDatabaseUsage()).toEqual({});
  });

  it("migrates legacy flat usage format into _default server entry", () => {
    localStorage.setItem(
      "sqlqs_database_usage_v1",
      JSON.stringify({
        master: { count: 5, lastUsed: 1000 },
        app_db: { count: 2, lastUsed: 2000 },
      }),
    );

    const loaded = loadAllDatabaseUsage();
    expect(loaded).toEqual({
      _default: {
        master: { count: 5, lastUsed: 1000 },
        app_db: { count: 2, lastUsed: 2000 },
      },
    });
    expect(loadDatabaseUsage()).toEqual({
      master: { count: 5, lastUsed: 1000 },
      app_db: { count: 2, lastUsed: 2000 },
    });
  });

  it("records database usage per server", () => {
    recordDatabaseUsage("  AppDb  ", "srv1");
    recordDatabaseUsage("AppDb", "srv1");
    recordDatabaseUsage("ReportDb", "srv1");
    recordDatabaseUsage("Master", "srv2");
    recordDatabaseUsage("", "srv1");

    const srv1Usage = loadDatabaseUsage("srv1");
    expect(srv1Usage.AppDb.count).toBe(2);
    expect(srv1Usage.AppDb.lastUsed).toBeGreaterThan(0);
    expect(srv1Usage.ReportDb.count).toBe(1);

    const srv2Usage = loadDatabaseUsage("srv2");
    expect(srv2Usage.Master.count).toBe(1);

    const all = loadAllDatabaseUsage();
    expect(all.srv1).toBeDefined();
    expect(all.srv2).toBeDefined();
  });

  it("saves database usage map", () => {
    saveAllDatabaseUsage({
      prod: {
        analytics: { count: 10, lastUsed: 5000 },
      },
    });

    expect(loadDatabaseUsage("prod")).toEqual({
      analytics: { count: 10, lastUsed: 5000 },
    });
  });

  it("returns top used databases sorted by count and last used", () => {
    saveAllDatabaseUsage({
      _default: {
        db1: { count: 5, lastUsed: 1000 },
        db2: { count: 10, lastUsed: 2000 },
        db3: { count: 5, lastUsed: 3000 },
        db_unused: { count: 0, lastUsed: 0 },
      },
    });

    const available = ["db1", "db2", "db3", "db4"];
    const top = getMostUsedDatabases(available, undefined, undefined, 3);

    expect(top).toEqual(["db2", "db3", "db1"]);
  });

  it("merges query execution history when available", () => {
    saveAllDatabaseUsage({
      serverA: {
        db1: { count: 2, lastUsed: 1000 },
      },
    });

    const history: ExecutedQuery[] = [
      {
        title: "Query 1",
        sql: "SELECT 1",
        database: "db2",
        executedAt: 2000,
      },
      {
        title: "Query 2",
        sql: "SELECT 2",
        database: "db2",
        executedAt: 3000,
      },
      {
        title: "Query 3",
        sql: "SELECT 3",
        database: "  ",
        executedAt: 4000,
      },
    ];

    const available = ["db1", "db2", "db3"];
    const top = getMostUsedDatabases(available, history, "serverA", 2);

    expect(top).toEqual(["db2", "db1"]);
  });


  it("handles empty or missing database lists gracefully", () => {
    expect(getMostUsedDatabases([])).toEqual([]);
    expect(getMostUsedDatabases(["db1", "db2"], undefined, undefined, 0)).toEqual([]);
  });
});
