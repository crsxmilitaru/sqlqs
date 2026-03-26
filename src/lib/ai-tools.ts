import { invoke } from "@tauri-apps/api/core";

const TOOLS_STORAGE_KEY = "sqlqs_ai_tools_enabled";

export interface AiTool {
  id: string;
  name: string;
  label: string;
  description: string;
  icon: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionContext {
  currentCode: string;
  currentDatabase?: string;
}

export const AI_TOOLS: AiTool[] = [
  {
    id: "get_database_schema",
    name: "get_database_schema",
    label: "Database Schema",
    description: "List all tables, views, procedures, and functions with their columns in the current database",
    icon: "fa-solid fa-database",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    id: "get_table_columns",
    name: "get_table_columns",
    label: "Table Columns",
    description: "Get detailed column information (name, data type) for a specific table or view",
    icon: "fa-solid fa-table-columns",
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
    id: "get_table_indexes",
    name: "get_table_indexes",
    label: "Table Indexes",
    description: "Get index definitions for a specific table, including primary keys and unique constraints",
    icon: "fa-solid fa-list-ol",
    parameters: {
      type: "OBJECT",
      properties: {
        schema_name: { type: "STRING", description: "Schema name, e.g. dbo" },
        table_name: { type: "STRING", description: "Table name" },
      },
      required: ["schema_name", "table_name"],
    },
  },
  {
    id: "get_foreign_keys",
    name: "get_foreign_keys",
    label: "Foreign Keys",
    description: "Get foreign key relationships for a specific table, showing which columns reference other tables",
    icon: "fa-solid fa-link",
    parameters: {
      type: "OBJECT",
      properties: {
        schema_name: { type: "STRING", description: "Schema name, e.g. dbo" },
        table_name: { type: "STRING", description: "Table name" },
      },
      required: ["schema_name", "table_name"],
    },
  },
  {
    id: "get_object_definition",
    name: "get_object_definition",
    label: "Object Definition",
    description: "Get the T-SQL source code of a view, stored procedure, or function",
    icon: "fa-solid fa-file-code",
    parameters: {
      type: "OBJECT",
      properties: {
        schema_name: { type: "STRING", description: "Schema name, e.g. dbo" },
        object_name: { type: "STRING", description: "Name of the view, stored procedure, or function" },
      },
      required: ["schema_name", "object_name"],
    },
  },
  {
    id: "get_current_editor_query",
    name: "get_current_editor_query",
    label: "Current Editor Query",
    description: "Get the SQL code currently written in the user's query editor tab",
    icon: "fa-solid fa-code",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    id: "list_databases",
    name: "list_databases",
    label: "List Databases",
    description: "List all databases available on the connected SQL Server instance",
    icon: "fa-solid fa-server",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
];

export function loadEnabledTools(): Set<string> {
  try {
    const stored = localStorage.getItem(TOOLS_STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch { /* use defaults */ }
  return new Set(AI_TOOLS.map((t) => t.id));
}

export function saveEnabledTools(enabled: Set<string>) {
  localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify([...enabled]));
}

export function getEnabledToolDeclarations(enabled: Set<string>) {
  return AI_TOOLS
    .filter((t) => enabled.has(t.id))
    .map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
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
    case "get_database_schema": {
      const [, schema] = await invoke<[string | null, string]>("generate_sql_completion");
      return schema || "No schema available (not connected or no objects found).";
    }

    case "get_table_columns": {
      const columns = await invoke<{ name: string; type_name: string }[]>("get_columns", {
        database: db,
        schema: args.schema_name || "dbo",
        table: args.table_name,
      });
      if (columns.length === 0) return "No columns found for this table.";
      return columns.map((c) => `${c.name} ${c.type_name}`).join("\n");
    }

    case "get_table_indexes":
      return invoke<string>("get_indexes", {
        database: db,
        schema: args.schema_name || "dbo",
        table: args.table_name,
      });

    case "get_foreign_keys":
      return invoke<string>("get_foreign_keys", {
        database: db,
        schema: args.schema_name || "dbo",
        table: args.table_name,
      });

    case "get_object_definition":
      return invoke<string>("get_object_definition", {
        database: db,
        schema: args.schema_name || "dbo",
        name: args.object_name,
      });

    case "get_current_editor_query":
      return context.currentCode || "(Editor is empty)";

    case "list_databases": {
      const dbs = await invoke<string[]>("get_databases");
      return dbs.join("\n");
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}
