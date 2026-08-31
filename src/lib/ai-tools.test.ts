import { describe, expect, it } from "vitest";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import {
  AI_TOOLS,
  executeTool,
  getEnabledToolDeclarations,
  getToolLabel,
  loadEnabledTools,
  saveEnabledTools,
} from "./ai-tools";

describe("AI tools", () => {
  it("enables every tool by default and persists explicit selections", () => {
    expect(loadEnabledTools()).toEqual(
      new Set(AI_TOOLS.map((tool) => tool.id)),
    );

    saveEnabledTools(new Set(["list_databases"]));

    expect(loadEnabledTools()).toEqual(new Set(["list_databases"]));
  });

  it("creates declarations only for enabled tools", () => {
    const declarations = getEnabledToolDeclarations(
      new Set(["get_current_editor_query"]),
    );

    expect(declarations).toHaveLength(1);
    expect(declarations[0].name).toBe("get_current_editor_query");
    expect(getToolLabel("get_current_editor_query")).toBe(
      "Current Editor Query",
    );
    expect(getToolLabel("unknown")).toBe("unknown");
  });

  it("returns editor and result context without native calls", async () => {
    const context = {
      currentCode: "SELECT 1",
      resultMessage: "1 row affected",
      currentDatabase: "app",
    };

    await expect(
      executeTool("get_current_editor_query", {}, context),
    ).resolves.toBe("SELECT 1");
    await expect(
      executeTool("get_query_result_message", {}, context),
    ).resolves.toBe("1 row affected");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("formats database and web-search results", async () => {
    setInvokeHandler((command) => {
      if (command === "get_databases") return ["master", "app"];
      if (command === "brave_search") {
        return [
          {
            title: "SQL Server",
            url: "https://example.com/sql",
            description: "Documentation",
          },
        ];
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(executeTool("list_databases", {}, { currentCode: "" }))
      .resolves.toBe("master\napp");
    await expect(
      executeTool("web_search", { query: "sql server" }, { currentCode: "" }),
    ).resolves.toContain("1. SQL Server");
  });

  it("validates web search and reports unknown tools", async () => {
    await expect(
      executeTool("web_search", { query: " " }, { currentCode: "" }),
    ).resolves.toContain("requires a 'query'");
    await expect(
      executeTool("missing", {}, { currentCode: "" }),
    ).resolves.toBe("Unknown tool: missing");
  });
});
