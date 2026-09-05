import { renderHook, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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

  it("stores and preserves sourceId and savedQueryFilePath", () => {
    const { result } = renderHook(useHistory);
    result.addHistory(
      "SELECT 1",
      "Saved Query",
      "master",
      "saved:C:\\Queries\\Saved.sql",
      "C:\\Queries\\Saved.sql",
    );

    expect(result.executedQueries()[0]).toMatchObject({
      sql: "SELECT 1",
      title: "Saved Query",
      sourceId: "saved:C:\\Queries\\Saved.sql",
      savedQueryFilePath: "C:\\Queries\\Saved.sql",
    });
  });

  it("isolates history per connection and switches reactively", async () => {
    const [currentConn, setCurrentConn] = createSignal("server-a#win");
    const { result } = renderHook(() => useHistory(currentConn));

    result.addHistory("SELECT 100", "Query A", "dev_spital");
    expect(result.executedQueries()).toHaveLength(1);
    expect(result.executedQueries()[0].sql).toBe("SELECT 100");

    setCurrentConn("server-b#win");
    await waitFor(() => expect(result.executedQueries()).toEqual([]));

    result.addHistory("SELECT 200", "Query B", "master");
    expect(result.executedQueries()).toHaveLength(1);
    expect(result.executedQueries()[0].sql).toBe("SELECT 200");

    setCurrentConn("server-a#win");
    await waitFor(() => expect(result.executedQueries()).toHaveLength(1));
    expect(result.executedQueries()[0].sql).toBe("SELECT 100");
  });
});
