import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ResultSet } from "../../lib/types";
import { setInvokeHandler } from "../../test/tauri";
import RowActionsDialog from "./RowActionsDialog";

const columns: ResultSet["columns"] = [
  {
    name: "Id",
    type_name: "int",
    is_identity: false,
    is_nullable: false,
    base_table_name: "Users",
    base_schema_name: "dbo",
  },
  {
    name: "Name",
    type_name: "nvarchar",
    is_identity: false,
    is_nullable: false,
    base_table_name: "Users",
    base_schema_name: "dbo",
  },
];

describe("RowActionsDialog", () => {
  it("blocks edits when the target table has no primary key", async () => {
    setInvokeHandler((command) => {
      if (command === "get_table_column_metadata") {
        return columns.map((column) => ({
          name: column.name,
          type_name: column.type_name,
          is_identity: column.is_identity,
          is_nullable: column.is_nullable,
        }));
      }
      if (command === "get_primary_key_columns") return [];
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    render(() => (
      <RowActionsDialog
        mode="edit"
        columns={columns}
        row={[1, "Alice"]}
        sourceSql="SELECT Id, Name FROM dbo.Users"
        fallbackTableName="dbo.Users"
        onClose={vi.fn()}
      />
    ));

    expect(
      await screen.findByText(
        "This table has no primary key. Edit and delete are disabled for safety.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  });
});
