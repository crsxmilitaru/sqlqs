import { render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ColumnInfo, QueryResult } from "../../lib/types";
import { setInvokeHandler } from "../../test/tauri";
import TableCompareDialog from "./TableCompareDialog";

const columns: ColumnInfo[] = [
  {
    name: "Id",
    type_name: "int",
    is_nullable: false,
    is_identity: true,
  },
  {
    name: "Name",
    type_name: "nvarchar",
    is_nullable: true,
    is_identity: false,
  },
];

function keyResult(): QueryResult {
  return {
    result_sets: [{ columns: [], rows: [["Id"]] }],
    rows_affected: 0,
    messages: [],
    elapsed_ms: 1,
    outputs: [],
  };
}

function renderDialog() {
  return render(() => (
    <TableCompareDialog
      sourceDatabase="app"
      schema="dbo"
      table="Users"
      databases={["app", "archive"]}
      onClose={vi.fn()}
      onOpenQuery={vi.fn()}
    />
  ));
}

describe("TableCompareDialog", () => {
  it("discovers comparable databases and columns", async () => {
    setInvokeHandler((command) => {
      if (command === "get_columns") return columns;
      if (command === "execute_query") return keyResult();
      if (command === "get_tables") {
        return [{ name: "Users", schema_name: "dbo", object_type: "TABLE" }];
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    renderDialog();

    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.getByText("Id (int)")).toBeInTheDocument();
    expect(screen.getAllByText("Name (nvarchar)")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Compare" })).toBeEnabled();
  });

  it("surfaces metadata discovery failures", async () => {
    setInvokeHandler((command) => {
      if (command === "get_columns") throw new Error("Metadata unavailable");
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    renderDialog();

    expect(await screen.findByText("Metadata unavailable")).toBeInTheDocument();
  });
});
