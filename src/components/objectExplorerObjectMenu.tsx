import { invoke } from "@tauri-apps/api/core";
import type { ContextMenuItem } from "./ContextMenu";

export type ExplorerObjectType = "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION" | "TRIGGER" | "TYPE";

interface BuildObjectExplorerMenuItemsParams {
  database: string;
  schema: string;
  table: string;
  objectType: ExplorerObjectType;
  onSelectSql: (sql: string, execute?: boolean) => void;
}

async function scriptAction(
  database: string,
  schema: string,
  name: string,
  objectType: string,
  action: string,
): Promise<string> {
  const result = await invoke<{ sql: string }>("generate_object_script", {
    database,
    schema,
    name,
    objectType,
    action,
  });
  return result.sql;
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
        icon: <i class="fa-solid fa-play" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "exec");
          onSelectSql(sql, true);
        },
      },
      {
        id: "script-alter",
        label: "Script ALTER",
        icon: <i class="fa-solid fa-pen" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "script_alter");
          onSelectSql(sql);
        },
      },
      {
        id: "get-last-modified",
        label: "Get Last Modified",
        icon: <i class="fa-solid fa-clock-rotate-left" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "get_last_modified");
          onSelectSql(sql, true);
        },
      },
      { id: "sep-proc-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i class="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  if (objectType === "FUNCTION") {
    return [
      {
        id: "script-select",
        label: "Script SELECT",
        icon: <i class="fa-solid fa-file-code" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "script_select");
          onSelectSql(sql, true);
        },
      },
      {
        id: "script-alter",
        label: "Script ALTER",
        icon: <i class="fa-solid fa-pen" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "script_alter");
          onSelectSql(sql);
        },
      },
      {
        id: "get-last-modified",
        label: "Get Last Modified",
        icon: <i class="fa-solid fa-clock-rotate-left" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "get_last_modified");
          onSelectSql(sql, true);
        },
      },
      { id: "sep-fn-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i class="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  if (objectType === "TRIGGER") {
    return [
      {
        id: "view-definition",
        label: "View Definition",
        icon: <i class="fa-solid fa-file-code" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "view_definition");
          onSelectSql(sql);
        },
      },
      {
        id: "script-alter",
        label: "Script ALTER",
        icon: <i class="fa-solid fa-pen" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "script_alter");
          onSelectSql(sql);
        },
      },
      {
        id: "trigger-details",
        label: "Trigger Details",
        icon: <i class="fa-solid fa-circle-info" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "trigger_details");
          onSelectSql(sql, true);
        },
      },
      {
        id: "enable-trigger",
        label: "Script ENABLE",
        icon: <i class="fa-solid fa-toggle-on" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "enable_trigger");
          onSelectSql(sql);
        },
      },
      {
        id: "disable-trigger",
        label: "Script DISABLE",
        icon: <i class="fa-solid fa-toggle-off" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "disable_trigger");
          onSelectSql(sql);
        },
      },
      {
        id: "get-last-modified",
        label: "Get Last Modified",
        icon: <i class="fa-solid fa-clock-rotate-left" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "get_last_modified");
          onSelectSql(sql, true);
        },
      },
      { id: "sep-trigger-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i class="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  if (objectType === "TYPE") {
    return [
      {
        id: "view-definition",
        label: "View Definition",
        icon: <i class="fa-solid fa-file-code" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "view_definition");
          onSelectSql(sql, true);
        },
      },
      {
        id: "script-drop",
        label: "Script DROP",
        icon: <i class="fa-solid fa-trash" />,
        onClick: async () => {
          const sql = await scriptAction(database, schema, table, objectType, "script_drop");
          onSelectSql(sql);
        },
      },
      { id: "sep-type-1", separator: true },
      {
        id: "copy-name",
        label: "Copy Name",
        icon: <i class="fa-solid fa-copy" />,
        onClick: () => navigator.clipboard.writeText(fullName),
      },
    ];
  }

  return [
    {
      id: "select",
      label: "Select",
      icon: <i class="fa-solid fa-check-double" />,
      children: [
        {
          id: "select-top-100",
          label: "Select Top 100",
          icon: <i class="fa-solid fa-arrow-up-wide-short" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "select_top_100");
            onSelectSql(sql, true);
          },
        },
        {
          id: "select-bottom-100",
          label: "Select Bottom 100",
          icon: <i class="fa-solid fa-arrow-down-wide-short" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "select_bottom_100");
            onSelectSql(sql, true);
          },
        },
        {
          id: "select-all",
          label: "Select All Rows",
          icon: <i class="fa-solid fa-table" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "select_all");
            onSelectSql(sql, true);
          },
        },
        {
          id: "select-count",
          label: "Count Rows",
          icon: <i class="fa-solid fa-calculator" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "count");
            onSelectSql(sql, true);
          },
        },
      ],
    },
    {
      id: "script",
      label: "Script",
      icon: <i class="fa-solid fa-code" />,
      children: [
        {
          id: "script-create",
          label: "Create Table",
          icon: <i class="fa-solid fa-plus" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "script_create");
            onSelectSql(sql);
          },
        },
        {
          id: "script-alter",
          label: "Alter Table",
          icon: <i class="fa-solid fa-pen" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, objectType === "VIEW" ? "script_alter" : "script_alter_table");
            onSelectSql(sql);
          },
        },
        {
          id: "script-drop",
          label: "Drop Object",
          icon: <i class="fa-solid fa-trash" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "script_drop");
            onSelectSql(sql);
          },
        },
        {
          id: "script-select",
          label: "Select Rows",
          icon: <i class="fa-solid fa-magnifying-glass" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "script_select_columns");
            onSelectSql(sql, true);
          },
        },
        {
          id: "script-insert",
          label: "Insert Values",
          icon: <i class="fa-solid fa-circle-plus" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "script_insert");
            onSelectSql(sql);
          },
        },
        {
          id: "script-update",
          label: "Update Rows",
          icon: <i class="fa-solid fa-pen-to-square" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "script_update");
            onSelectSql(sql);
          },
        },
        {
          id: "script-delete",
          label: "Delete Rows",
          icon: <i class="fa-solid fa-xmark" />,
          onClick: async () => {
            const sql = await scriptAction(database, schema, table, objectType, "script_delete");
            onSelectSql(sql);
          },
        },
      ],
    },
    {
      id: "get-last-modified",
      label: "Get Last Modified",
      icon: <i class="fa-solid fa-clock-rotate-left" />,
      onClick: async () => {
        const sql = await scriptAction(database, schema, table, objectType, "get_last_modified");
        onSelectSql(sql, true);
      },
    },
    { id: "sep2", separator: true },
    {
      id: "copy-name",
      label: "Copy Name",
      icon: <i class="fa-solid fa-copy" />,
      onClick: () => navigator.clipboard.writeText(fullName),
    },
  ];
}
