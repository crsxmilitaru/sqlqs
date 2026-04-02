import { invoke } from "@tauri-apps/api/core";
import type { ColumnInfo } from "../lib/types";
import type { ContextMenuItem } from "./ContextMenu";

export type ExplorerObjectType = "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER" | "TYPE";

interface BuildObjectExplorerMenuItemsParams {
  database: string;
  schema: string;
  table: string;
  objectType: ExplorerObjectType;
  onSelectSql: (sql: string, execute?: boolean) => void;
}

export function buildObjectExplorerMenuItems({
  database,
  schema,
  table,
  objectType,
  onSelectSql,
}: BuildObjectExplorerMenuItemsParams): ContextMenuItem[] {
  const fullName = `[${database}].[${schema}].[${table}]`;

  if (objectType === "PROCEDURE") {
    return [
      {
        id: "exec",
        label: "Execute",
        icon: <i className="fa-solid fa-play" />,
        onClick: () => onSelectSql(`EXEC ${fullName}`, true),
      },
      {
        id: "script-alter",
        label: "Script ALTER",
        icon: <i className="fa-solid fa-pen" />,
        onClick: async () => {
          try {
            const def: string = await invoke("get_object_definition", { database, schema, name: table });
            const altered = def.replace(/\bCREATE\s+(PROC(?:EDURE)?)\b/i, "ALTER $1");
            onSelectSql(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${altered}\nGO`);
          } catch {
            onSelectSql(
              `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER PROCEDURE [${schema}].[${table}]\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\t-- TODO\nEND\nGO`,
            );
          }
        },
      },
      {
        id: "get-last-modified",
        label: "Get Last Modified",
        icon: <i className="fa-solid fa-clock-rotate-left" />,
        onClick: () =>
          onSelectSql(
            `SELECT\n\t[name] AS [Object],\n\t[type_desc] AS [Type],\n\t[create_date] AS [CreatedDate],\n\t[modify_date] AS [ModifiedDate]\nFROM [${database}].sys.objects\nWHERE object_id = OBJECT_ID('${fullName}')`,
            true,
          ),
      },
      { id: "sep-proc-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i className="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  if (objectType === "FUNCTION") {
    return [
      {
        id: "script-select",
        label: "Script SELECT",
        icon: <i className="fa-solid fa-file-code" />,
        onClick: () => onSelectSql(`SELECT ${fullName}()`, true),
      },
      {
        id: "script-alter",
        label: "Script ALTER",
        icon: <i className="fa-solid fa-pen" />,
        onClick: async () => {
          try {
            const def: string = await invoke("get_object_definition", { database, schema, name: table });
            const altered = def.replace(/\bCREATE\s+(FUNCTION)\b/i, "ALTER $1");
            onSelectSql(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${altered}\nGO`);
          } catch {
            onSelectSql(
              `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER FUNCTION [${schema}].[${table}]\n(\n)\nRETURNS <return_type>\nAS\nBEGIN\n\t-- TODO\n\tRETURN <value>\nEND\nGO`,
            );
          }
        },
      },
      {
        id: "get-last-modified",
        label: "Get Last Modified",
        icon: <i className="fa-solid fa-clock-rotate-left" />,
        onClick: () =>
          onSelectSql(
            `SELECT\n\t[name] AS [Object],\n\t[type_desc] AS [Type],\n\t[create_date] AS [CreatedDate],\n\t[modify_date] AS [ModifiedDate]\nFROM [${database}].sys.objects\nWHERE object_id = OBJECT_ID('${fullName}')`,
            true,
          ),
      },
      { id: "sep-fn-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i className="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  if (objectType === "TRIGGER") {
    return [
      {
        id: "view-definition",
        label: "View Definition",
        icon: <i className="fa-solid fa-file-code" />,
        onClick: async () => {
          try {
            const def: string = await invoke("get_object_definition", { database, schema, name: table });
            onSelectSql(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${def}\nGO`);
          } catch {
            onSelectSql(
              `-- Could not retrieve definition for [${schema}].[${table}]\n-- Object may be encrypted or not accessible.`,
            );
          }
        },
      },
      {
        id: "script-alter",
        label: "Script ALTER",
        icon: <i className="fa-solid fa-pen" />,
        onClick: async () => {
          try {
            const def: string = await invoke("get_object_definition", { database, schema, name: table });
            const altered = def.replace(/\bCREATE\s+(TRIGGER)\b/i, "ALTER $1");
            onSelectSql(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${altered}\nGO`);
          } catch {
            onSelectSql(
              `-- Could not retrieve definition for [${schema}].[${table}]\n-- Object may be encrypted or not accessible.`,
            );
          }
        },
      },
      {
        id: "trigger-details",
        label: "Trigger Details",
        icon: <i className="fa-solid fa-circle-info" />,
        onClick: () =>
          onSelectSql(
            `SELECT\n\tt.name AS [Trigger],\n\tOBJECT_NAME(t.parent_id) AS [ParentTable],\n\tSCHEMA_NAME(o.schema_id) AS [Schema],\n\tt.is_disabled AS [IsDisabled],\n\tt.is_instead_of_trigger AS [IsInsteadOf],\n\to.create_date AS [CreatedDate],\n\to.modify_date AS [ModifiedDate]\nFROM [${database}].sys.triggers t\nJOIN [${database}].sys.objects o ON t.object_id = o.object_id\nWHERE t.object_id = OBJECT_ID('${fullName}')`,
            true,
          ),
      },
      {
        id: "enable-trigger",
        label: "Script ENABLE",
        icon: <i className="fa-solid fa-toggle-on" />,
        onClick: () =>
          onSelectSql(
            `DECLARE @parent NVARCHAR(256) = OBJECT_NAME((SELECT parent_id FROM [${database}].sys.triggers WHERE object_id = OBJECT_ID('${fullName}')));\nEXEC('ENABLE TRIGGER [${schema}].[${table}] ON [${schema}].' + QUOTENAME(@parent))`,
          ),
      },
      {
        id: "disable-trigger",
        label: "Script DISABLE",
        icon: <i className="fa-solid fa-toggle-off" />,
        onClick: () =>
          onSelectSql(
            `DECLARE @parent NVARCHAR(256) = OBJECT_NAME((SELECT parent_id FROM [${database}].sys.triggers WHERE object_id = OBJECT_ID('${fullName}')));\nEXEC('DISABLE TRIGGER [${schema}].[${table}] ON [${schema}].' + QUOTENAME(@parent))`,
          ),
      },
      {
        id: "get-last-modified",
        label: "Get Last Modified",
        icon: <i className="fa-solid fa-clock-rotate-left" />,
        onClick: () =>
          onSelectSql(
            `SELECT\n\t[name] AS [Object],\n\t[type_desc] AS [Type],\n\t[create_date] AS [CreatedDate],\n\t[modify_date] AS [ModifiedDate]\nFROM [${database}].sys.objects\nWHERE object_id = OBJECT_ID('${fullName}')`,
            true,
          ),
      },
      { id: "sep-trigger-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i className="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  if (objectType === "TYPE") {
    return [
      {
        id: "view-definition",
        label: "View Definition",
        icon: <i className="fa-solid fa-file-code" />,
        onClick: () =>
          onSelectSql(
            `SELECT\n\tt.name AS [TypeName],\n\tSCHEMA_NAME(t.schema_id) AS [Schema],\n\tTYPE_NAME(t.system_type_id) AS [BaseType],\n\tt.max_length AS [MaxLength],\n\tt.precision AS [Precision],\n\tt.scale AS [Scale],\n\tt.is_nullable AS [IsNullable],\n\tt.is_table_type AS [IsTableType]\nFROM [${database}].sys.types t\nWHERE t.name = '${table}'\n\tAND SCHEMA_NAME(t.schema_id) = '${schema}'`,
            true,
          ),
      },
      {
        id: "script-drop",
        label: "Script DROP",
        icon: <i className="fa-solid fa-trash" />,
        onClick: () => onSelectSql(`DROP TYPE ${fullName}`),
      },
      { id: "sep-type-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i className="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  return [
    {
      id: "select",
      label: "Select",
      icon: <i className="fa-solid fa-check-double" />,
      children: [
        {
          id: "select-top-100",
          label: "Select Top 100",
          icon: <i className="fa-solid fa-arrow-up-wide-short" />,
          onClick: () => onSelectSql(`SELECT TOP 100 * FROM ${fullName}`, true),
        },
        {
          id: "select-bottom-100",
          label: "Select Bottom 100",
          icon: <i className="fa-solid fa-arrow-down-wide-short" />,
          onClick: () =>
            onSelectSql(
              `SELECT * FROM (\n  SELECT TOP 100 * FROM ${fullName} ORDER BY 1 DESC\n) t ORDER BY 1 ASC`,
              true,
            ),
        },
        {
          id: "select-all",
          label: "Select All Rows",
          icon: <i className="fa-solid fa-table" />,
          onClick: () => onSelectSql(`SELECT * FROM ${fullName}`, true),
        },
        {
          id: "select-count",
          label: "Count Rows",
          icon: <i className="fa-solid fa-calculator" />,
          onClick: () => onSelectSql(`SELECT COUNT(*) AS [TotalRows] FROM ${fullName}`, true),
        },
      ],
    },
    {
      id: "script",
      label: "Script",
      icon: <i className="fa-solid fa-code" />,
      children: [
        {
          id: "script-create",
          label: "Create Table",
          icon: <i className="fa-solid fa-plus" />,
          onClick: async () => {
            if (objectType === "VIEW") {
              try {
                const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
                const colList = cols.map((c) => `\t[${c.name}]`).join(",\n");
                onSelectSql(
                  `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE VIEW [${schema}].[${table}]\nAS\nSELECT\n${colList}\nFROM [${schema}].[<source_table>]\nGO`,
                );
              } catch {
                onSelectSql(
                  `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE VIEW [${schema}].[${table}]\nAS\nSELECT\n\t*\nFROM [${schema}].[<source_table>]\nGO`,
                );
              }
            } else {
              try {
                const script: string = await invoke("generate_create_script", { database, schema, table });
                onSelectSql(script);
              } catch {
                onSelectSql(
                  `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nCREATE TABLE [${schema}].[${table}](\n\t[Id] [int] IDENTITY(1,1) NOT NULL\n) ON [PRIMARY]\nGO`,
                );
              }
            }
          },
        },
        {
          id: "script-alter",
          label: "Alter Table",
          icon: <i className="fa-solid fa-pen" />,
          onClick: async () => {
            if (objectType === "VIEW") {
              try {
                const def: string = await invoke("get_object_definition", { database, schema, name: table });
                const altered = def.replace(/\bCREATE\s+(VIEW)\b/i, "ALTER $1");
                onSelectSql(`SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\n${altered}\nGO`);
              } catch {
                onSelectSql(
                  `SET ANSI_NULLS ON\nGO\nSET QUOTED_IDENTIFIER ON\nGO\nALTER VIEW [${schema}].[${table}]\nAS\nSELECT\n\t*\nFROM [${schema}].[<source_table>]\nGO`,
                );
              }
            } else {
              onSelectSql(`ALTER TABLE ${fullName}\nADD [NewColumn] NVARCHAR(255) NULL\nGO`);
            }
          },
        },
        {
          id: "script-drop",
          label: "Drop Object",
          icon: <i className="fa-solid fa-trash" />,
          onClick: () => {
            const kind = objectType === "VIEW" ? "VIEW" : "TABLE";
            onSelectSql(
              `IF OBJECT_ID('${fullName}', '${objectType === "VIEW" ? "V" : "U"}') IS NOT NULL\n` +
                `\tDROP ${kind} ${fullName}\nGO`,
            );
          },
        },
        {
          id: "script-select",
          label: "Select Rows",
          icon: <i className="fa-solid fa-magnifying-glass" />,
          onClick: async () => {
            try {
              const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
              const colList = cols.map((c) => `\t[${c.name}]`).join(",\n");
              onSelectSql(`SELECT\n${colList}\nFROM ${fullName}`, true);
            } catch {
              onSelectSql(`SELECT\n\t*\nFROM ${fullName}`, true);
            }
          },
        },
        {
          id: "script-insert",
          label: "Insert Values",
          icon: <i className="fa-solid fa-circle-plus" />,
          onClick: async () => {
            try {
              const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
              const filtered = cols.filter((c) => !c.is_identity);
              const colNames = filtered.map((c) => `\t[${c.name}]`).join(",\n");
              const values = filtered.map((c) => `\t<${c.name}, ${c.type_name},>`).join(",\n");
              onSelectSql(`INSERT INTO ${fullName}\n(\n${colNames}\n)\nVALUES\n(\n${values}\n)`);
            } catch {
              onSelectSql(
                `INSERT INTO ${fullName}\n(\n\t[column1],\n\t[column2]\n)\nVALUES\n(\n\t<column1, type,>,\n\t<column2, type,>\n)`,
              );
            }
          },
        },
        {
          id: "script-update",
          label: "Update Rows",
          icon: <i className="fa-solid fa-pen-to-square" />,
          onClick: async () => {
            try {
              const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
              const filtered = cols.filter((c) => !c.is_identity);
              const setClauses = filtered
                .map((c) => `\t[${c.name}] = <${c.name}, ${c.type_name},>`)
                .join(",\n");
              onSelectSql(`UPDATE ${fullName}\nSET\n${setClauses}\nWHERE\n\t<search_condition,,>`);
            } catch {
              onSelectSql(`UPDATE ${fullName}\nSET\n\t[column1] = <column1, type,>\nWHERE\n\t<search_condition,,>`);
            }
          },
        },
        {
          id: "script-delete",
          label: "Delete Rows",
          icon: <i className="fa-solid fa-xmark" />,
          onClick: async () => {
            try {
              const cols: ColumnInfo[] = await invoke("get_columns", { database, schema, table });
              const first = cols[0];
              const hint = first
                ? `[${first.name}] = <${first.name}, ${first.type_name},>`
                : `<search_condition,,>`;
              onSelectSql(`DELETE FROM ${fullName}\nWHERE\n\t${hint}`);
            } catch {
              onSelectSql(`DELETE FROM ${fullName}\nWHERE\n\t<search_condition,,>`);
            }
          },
        },
      ],
    },
    {
      id: "get-last-modified",
      label: "Get Last Modified",
      icon: <i className="fa-solid fa-clock-rotate-left" />,
      onClick: () =>
        onSelectSql(
          `SELECT\n\t[name] AS [Object],\n\t[type_desc] AS [Type],\n\t[create_date] AS [CreatedDate],\n\t[modify_date] AS [ModifiedDate]\nFROM [${database}].sys.objects\nWHERE object_id = OBJECT_ID('${fullName}')`,
          true,
        ),
    },
    { id: "sep2", separator: true },
    {
      id: "copy-name",
      label: "Copy Name",
      icon: <i className="fa-solid fa-copy" />,
      onClick: () => navigator.clipboard.writeText(fullName),
    },
  ];
}
