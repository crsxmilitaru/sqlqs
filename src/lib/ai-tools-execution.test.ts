import { beforeEach, describe, expect, it } from "vitest";
import { executeTool } from "./ai-tools";
import { invokeMock, setInvokeHandler } from "../test/tauri";

describe("executeTool failure and edge branches", () => {
  beforeEach(() => {
    setInvokeHandler(() => {
      throw new Error(`Unexpected Tauri command`);
    });
  });

  it("returns schema summaries from the AI context command", async () => {
    setInvokeHandler((command) => {
      if (command === "get_ai_schema_context") {
        return { database: "app", schema_summary: "dbo.Users(Id, Email)" };
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(
      executeTool("get_database_schema", {}, { currentCode: "" }),
    ).resolves.toBe("dbo.Users(Id, Email)");
  });

  it("explains when no schema is available", async () => {
    setInvokeHandler((command) => {
      if (command === "get_ai_schema_context") {
        return { database: null, schema_summary: "" };
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(
      executeTool("get_database_schema", {}, { currentCode: "" }),
    ).resolves.toContain("No schema available");
  });

  it("formats table metadata with columns, indexes, and foreign keys", async () => {
    setInvokeHandler((command, args) => {
      if (command === "get_columns") {
        expect(args).toEqual({
          database: "app",
          schema: "dbo",
          table: "Users",
        });
        return [
          { name: "Id", type_name: "int" },
          { name: "Email", type_name: "nvarchar" },
        ];
      }
      if (command === "get_indexes") return "IX_Users_Email";
      if (command === "get_foreign_keys") return "";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    const result = await executeTool(
      "get_table_metadata",
      { schema_name: "dbo", table_name: "Users" },
      { currentCode: "", currentDatabase: "app" },
    );

    expect(result).toContain("- Id (int)");
    expect(result).toContain("IX_Users_Email");
    expect(result).toContain("Foreign Keys:\nNone");
  });

  it("handles tables without columns", async () => {
    setInvokeHandler((command) => {
      if (command === "get_columns") return [];
      if (command === "get_indexes") return "";
      if (command === "get_foreign_keys") return "";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    const result = await executeTool(
      "get_table_metadata",
      { table_name: "Missing" },
      { currentCode: "" },
    );

    expect(result).toContain("No columns found.");
  });

  it("reports metadata retrieval failures", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_columns") {
        throw new Error("not connected");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    const result = await executeTool(
      "get_table_metadata",
      { table_name: "Users" },
      { currentCode: "" },
    );

    expect(result).toContain("Failed to retrieve table metadata");
    expect(result).toContain("not connected");
  });

  it("passes through object definitions", async () => {
    setInvokeHandler((command, args) => {
      if (command === "get_object_definition") {
        expect(args).toEqual({
          database: "app",
          schema: "dbo",
          name: "GetUser",
        });
        return "CREATE PROCEDURE GetUser AS BEGIN END";
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(
      executeTool(
        "get_object_definition",
        { schema_name: "dbo", object_name: "GetUser" },
        { currentCode: "", currentDatabase: "app" },
      ),
    ).resolves.toContain("CREATE PROCEDURE");
  });

  it("formats empty web results", async () => {
    setInvokeHandler((command) => {
      if (command === "brave_search") return [];
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(
      executeTool("web_search", { query: "rare topic" }, { currentCode: "" }),
    ).resolves.toContain("No web results found");
  });

  it("suggests configuring Brave when the key is missing", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "brave_search") {
        throw new Error("Brave Search API key is not configured");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    const result = await executeTool(
      "web_search",
      { query: "test" },
      { currentCode: "" },
    );

    expect(result).toContain("Set it in Settings");
  });

  it("wraps generic web-search failures", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "brave_search") throw new Error("network down");
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    const result = await executeTool(
      "web_search",
      { query: "test" },
      { currentCode: "" },
    );

    expect(result).toContain("web search failed");
    expect(result).toContain("network down");
  });

  it("lists databases one per line", async () => {
    setInvokeHandler((command) => {
      if (command === "get_databases") return ["master", "app"];
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(
      executeTool("list_databases", {}, { currentCode: "" }),
    ).resolves.toBe("master\napp");
  });
});
