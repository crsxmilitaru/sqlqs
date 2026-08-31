import { renderHook, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it } from "vitest";
import { useHistory } from "./useHistory";

const storageKey = "sqlqs_executed_queries_v1";

describe("useHistory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads legacy string entries and ignores invalid history", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify(["SELECT 1", { sql: "  ", title: "Invalid" }]),
    );

    const { result } = renderHook(useHistory);

    expect(result.executedQueries()).toHaveLength(1);
    expect(result.executedQueries()[0]).toMatchObject({
      sql: "SELECT 1",
      title: "SELECT 1",
    });
  });

  it("adds trimmed entries and generates titles for generic tabs", () => {
    const { result } = renderHook(useHistory);

    result.addHistory("  SELECT * FROM dbo.Users  ", "Query 1", "app");

    expect(result.executedQueries()[0]).toMatchObject({
      sql: "SELECT * FROM dbo.Users",
      title: "SELECT * FROM dbo.Users",
      database: "app",
    });
  });

  it("moves duplicate SQL to the front instead of duplicating it", () => {
    const { result } = renderHook(useHistory);

    result.addHistory("SELECT 1", "First", "master");
    result.addHistory("SELECT 2", "Second", "master");
    result.addHistory("SELECT 1", "Updated", "app");

    expect(result.executedQueries()).toHaveLength(2);
    expect(result.executedQueries()[0]).toMatchObject({
      sql: "SELECT 1",
      title: "Updated",
      database: "app",
    });
  });

  it("deletes and clears persisted history", async () => {
    const { result } = renderHook(useHistory);
    result.addHistory("SELECT 1");
    result.addHistory("SELECT 2");

    result.deleteHistory("SELECT 1");
    expect(result.executedQueries().map((query) => query.sql)).toEqual([
      "SELECT 2",
    ]);

    result.clearHistory();

    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
  });
});
