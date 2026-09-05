import { renderHook } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import { useSavedQueries } from "./useSavedQueries";

const storageKey = "sqlqs_saved_queries_v1";
describe("useSavedQueries", () => {
  it("loads only valid saved-query records", () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "1",
          title: "Users",
          fileName: "Users.sql",
          filePath: "C:\\Queries\\Users.sql",
          savedAt: 1,
        },
        { id: "2", title: "Invalid" },
      ]),
    );

    const { result } = renderHook(useSavedQueries);

    expect(result.savedQueries()).toHaveLength(1);
    expect(result.savedQueries()[0].title).toBe("Users");
  });

  it("writes a query and replaces an existing entry for the same path", async () => {
    setInvokeHandler((command) => {
      if (command === "get_documents_folder") {
        return "C:\\Users\\TestUser\\Documents";
      }
      if (command === "write_sql_file") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderHook(useSavedQueries);

    const first = await result.saveQuery("Users", "SELECT 1");
    const second = await result.saveQuery("Users", "SELECT 2");

    expect(first?.fileName).toBe("Users.sql");
    expect(second?.filePath).toBe(
      "C:\\Users\\TestUser\\Documents\\SQL Query Studio\\Queries\\Users.sql",
    );
    expect(result.savedQueries()).toHaveLength(1);
    expect(invokeMock).toHaveBeenCalledWith("write_sql_file", {
      path: second?.filePath,
      content: "SELECT 2",
    });
    expect(second?.id).toBe(first?.id);
  });

  it("saves over targetFilePath and preserves the existing query identity", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "existing-1",
          title: "Custom Query",
          fileName: "Custom.sql",
          filePath: "C:\\Queries\\Custom.sql",
          savedAt: 100,
        },
      ]),
    );
    setInvokeHandler((command) => {
      if (command === "write_sql_file") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderHook(useSavedQueries);

    const updated = await result.saveQuery(
      "Renamed in Tab",
      "SELECT 42",
      "C:\\Queries\\Custom.sql",
    );

    expect(updated?.id).toBe("existing-1");
    expect(updated?.filePath).toBe("C:\\Queries\\Custom.sql");
    expect(result.savedQueries()).toHaveLength(1);
    expect(result.savedQueries()[0].id).toBe("existing-1");
    expect(invokeMock).toHaveBeenCalledWith("write_sql_file", {
      path: "C:\\Queries\\Custom.sql",
      content: "SELECT 42",
    });
  });

  it("deletes the file before removing its saved-query entry", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "1",
          title: "Users",
          fileName: "Users.sql",
          filePath: "C:\\Queries\\Users.sql",
          savedAt: 1,
        },
      ]),
    );
    setInvokeHandler((command) => {
      if (command === "delete_sql_file") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderHook(useSavedQueries);

    await expect(result.deleteQuery("1")).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("delete_sql_file", {
      path: "C:\\Queries\\Users.sql",
    });
    expect(result.savedQueries()).toEqual([]);
  });

  it("rejects rename collisions before moving a file", async () => {
    localStorage.setItem(
      storageKey,
      JSON.stringify([
        {
          id: "1",
          title: "Users",
          fileName: "Users.sql",
          filePath: "C:\\Queries\\Users.sql",
          savedAt: 1,
        },
        {
          id: "2",
          title: "Orders",
          fileName: "Orders.sql",
          filePath: "C:\\Queries\\Orders.sql",
          savedAt: 2,
        },
      ]),
    );
    setInvokeHandler((command) => {
      if (command === "get_documents_folder") return "C:\\QueriesRoot";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { result } = renderHook(useSavedQueries);

    await expect(result.renameQuery("1", "orders")).rejects.toThrow(
      "A query with that name already exists.",
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      "rename_sql_file",
      expect.anything(),
    );
  });

  it("loads file contents and converts native failures to null", async () => {
    const { result } = renderHook(useSavedQueries);
    setInvokeHandler((command) => {
      if (command === "read_sql_file") return { content: "SELECT 1" };
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(result.loadQueryContent("query.sql")).resolves.toBe(
      "SELECT 1",
    );

    setInvokeHandler((command) => {
      if (command === "read_sql_file") throw new Error("Missing file");
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    await expect(result.loadQueryContent("missing.sql")).resolves.toBeNull();
  });
});
