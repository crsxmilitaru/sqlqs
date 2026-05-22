import { invoke } from "@tauri-apps/api/core";

const TOOLS_STORAGE_KEY = "sqlqs_ai_tools_enabled";

export interface AiTool {
  id: string;
  name: string;
  label: string;
  category: string;
  description: string;
  icon: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionContext {
  currentCode: string;
  resultMessage?: string;
  currentDatabase?: string;
}

interface AiSchemaContext {
  database: string | null;
  schema_summary: string;
}

export const WEB_SEARCH_TOOL_ID = "web_search";

export const AI_TOOLS: AiTool[] = [
  {
    id: WEB_SEARCH_TOOL_ID,
    name: WEB_SEARCH_TOOL_ID,
    label: "Web Search",
    category: "External Search",
    description:
      "Search the web with Brave Search for up-to-date information, docs, and recent changes. Requires a Brave Search API key configured in Settings.",
    icon: "fa-solid fa-globe",
    parameters: {
      type: "OBJECT",
      properties: {
        query: {
          type: "STRING",
          description: "The search query to send to Brave Search",
        },
      },
      required: ["query"],
    },
  },
  {
    id: "list_databases",
    name: "list_databases",
    label: "List Databases",
    category: "Database Explorer",
    description:
      "List all databases available on the connected SQL Server instance",
    icon: "fa-solid fa-server",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    id: "get_database_schema",
    name: "get_database_schema",
    label: "Database Schema Summary",
    category: "Database Explorer",
    description:
      "Get a high-level summary of all tables, views, and functions in the active database to help the AI understand the database structure.",
    icon: "fa-solid fa-database",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    id: "get_table_metadata",
    name: "get_table_metadata",
    label: "Table Metadata",
    category: "Database Objects",
    description:
      "Get the complete metadata for a table or view (columns, data types, primary keys, indexes, and foreign keys)",
    icon: "fa-solid fa-table",
    parameters: {
      type: "OBJECT",
      properties: {
        schema_name: { type: "STRING", description: "Schema name, e.g. dbo" },
        table_name: { type: "STRING", description: "Table or view name" },
      },
      required: ["schema_name", "table_name"],
    },
  },
  {
    id: "get_object_definition",
    name: "get_object_definition",
    label: "Object Definition",
    category: "Database Objects",
    description:
      "Get the T-SQL source code of a view, stored procedure, or function",
    icon: "fa-solid fa-file-code",
    parameters: {
      type: "OBJECT",
      properties: {
        schema_name: { type: "STRING", description: "Schema name, e.g. dbo" },
        object_name: {
          type: "STRING",
          description: "Name of the view, stored procedure, or function",
        },
      },
      required: ["schema_name", "object_name"],
    },
  },
  {
    id: "get_current_editor_query",
    name: "get_current_editor_query",
    label: "Current Editor Query",
    category: "Active Query & Editor",
    description:
      "Get the SQL code currently written in the user's query editor tab",
    icon: "fa-solid fa-code",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    id: "get_query_result_message",
    name: "get_query_result_message",
    label: "Latest Execution Message",
    category: "Active Query & Editor",
    description:
      "Get the latest query execution error, status message, or rows-affected summary from the query runner.",
    icon: "fa-solid fa-terminal",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

export function loadEnabledTools(): Set<string> {
  try {
    const stored = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (stored) return new Set<string>(JSON.parse(stored));
  } catch {}
  return new Set(AI_TOOLS.map((t) => t.id));
}

export function saveEnabledTools(enabled: Set<string>) {
  localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify([...enabled]));
}

export function getEnabledToolDeclarations(enabled: Set<string>) {
  return AI_TOOLS.filter((t) => enabled.has(t.id)).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

export function getToolLabel(name: string): string {
  return AI_TOOLS.find((t) => t.name === name)?.label || name;
}

export async function executeTool(
  toolName: string,
  args: Record<string, string>,
  context: ToolExecutionContext,
): Promise<string> {
  const db = context.currentDatabase || "";

  switch (toolName) {
    case WEB_SEARCH_TOOL_ID: {
      const query = (args.query || "").trim();
      if (!query) return "Error: web_search requires a 'query' parameter.";
      try {
        const results = await invoke<BraveSearchResult[]>("brave_search", {
          query,
          count: 5,
        });
        if (results.length === 0) {
          return `No web results found for "${query}".`;
        }
        const lines: string[] = [`Search results for "${query}":`, ""];
        results.forEach((r, i) => {
          lines.push(`${i + 1}. ${r.title || r.url}`);
          lines.push(`   ${r.url}`);
          if (r.description) lines.push(`   ${r.description}`);
          lines.push("");
        });
        return lines.join("\n").trimEnd();
      } catch (err: any) {
        const message = err?.message || String(err);
        if (/not configured/i.test(message)) {
          return "Error: Brave Search API key is not configured. Set it in Settings → AI.";
        }
        return `Error: web search failed — ${message}`;
      }
    }

    case "get_database_schema": {
      const schemaContext = await invoke<AiSchemaContext>(
        "get_ai_schema_context",
      );
      return (
        schemaContext.schema_summary ||
        "No schema available (not connected or no objects found)."
      );
    }

    case "get_table_metadata": {
      const schema = args.schema_name || "dbo";
      const table = args.table_name;
      try {
        const [columns, indexes, fks] = await Promise.all([
          invoke<{ name: string; type_name: string }[]>("get_columns", {
            database: db,
            schema,
            table,
          }),
          invoke<string>("get_indexes", { database: db, schema, table }),
          invoke<string>("get_foreign_keys", { database: db, schema, table }),
        ]);

        const colStr =
          columns.length === 0
            ? "No columns found."
            : "Columns:\n" +
              columns.map((c) => `- ${c.name} (${c.type_name})`).join("\n");

        return `${colStr}\n\nIndexes:\n${indexes || "None"}\n\nForeign Keys:\n${fks || "None"}`;
      } catch (e: any) {
        return `Failed to retrieve table metadata: ${e?.message || String(e)}`;
      }
    }

    case "get_object_definition":
      return invoke<string>("get_object_definition", {
        database: db,
        schema: args.schema_name || "dbo",
        name: args.object_name,
      });

    case "get_current_editor_query":
      return context.currentCode || "(Editor is empty)";

    case "get_query_result_message":
      return context.resultMessage || "(No query result available yet)";

    case "list_databases": {
      const dbs = await invoke<string[]>("get_databases");
      return dbs.join("\n");
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
