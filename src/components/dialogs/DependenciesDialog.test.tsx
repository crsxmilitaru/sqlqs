import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import DependenciesDialog from "./DependenciesDialog";
import { invokeMock, setInvokeHandler } from "../../test/tauri";
import type { QueryResult } from "../../lib/types";

const SCRIPTS: Record<string, string> = {
  referencing_entities: "-- used by",
  referenced_entities: "-- references",
};

function queryResult(rows: unknown[][]) {
  return {
    elapsed_ms: 5,
    result_sets: [
      {
        columns: [
          { name: "Database" },
          { name: "Schema" },
          { name: "Name" },
          { name: "Class" },
        ],
        rows,
      },
    ],
  } as unknown as QueryResult;
}

function setupHandler(
  usedBy: unknown[][] | Error,
  references: unknown[][] | Error,
) {
  setInvokeHandler((command, args) => {
    if (command === "generate_object_script") {
      const action = (args as { action: string }).action;
      return { sql: SCRIPTS[action] ?? "-- unknown" };
    }
    if (command === "execute_query") {
      const sql = (args as { sql: string }).sql;
      if (sql === "-- used by") {
        if (usedBy instanceof Error) throw usedBy;
        return queryResult(usedBy);
      }
      if (sql === "-- references") {
        if (references instanceof Error) throw references;
        return queryResult(references);
      }
    }
    throw new Error(`Unexpected Tauri command: ${command}`);
  });
}

function renderDialog() {
  const onClose = vi.fn();
  render(() => (
    <DependenciesDialog
      database="app"
      schema="dbo"
      name="Orders"
      objectType="TABLE"
      onClose={onClose}
    />
  ));
  return { onClose };
}

describe("DependenciesDialog", () => {
  it("loads both dependency directions and renders rows", async () => {
    setupHandler(
      [["other", "dbo", "Invoices", "TABLE_OR_VIEW"]],
      [[null, "dbo", "Customers", "OBJECT_OR_COLUMN"]],
    );
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText("[other].[dbo].[Invoices]"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("table or view")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Used By/ }).textContent,
    ).toContain("1");

    fireEvent.click(screen.getByRole("button", { name: /References/ }));

    await waitFor(() => {
      expect(screen.getByText("[dbo].[Customers]")).toBeInTheDocument();
    });
    expect(screen.queryByText("[dbo].[Invoices]")).not.toBeInTheDocument();
  });

  it("shows empty state when nothing references the object", async () => {
    setupHandler([], []);
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText("Nothing references this object."),
      ).toBeInTheDocument();
    });
  });

  it("shows query failures per tab", async () => {
    setupHandler(
      new Error("Query failed: permission denied"),
      new Error("Batch 1 failed: timeout"),
    );
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("permission denied")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /References/ }));

    await waitFor(() => {
      expect(screen.getByText("timeout")).toBeInTheDocument();
    });
  });

  it("handles result sets without rows", async () => {
    setInvokeHandler((command) => {
      if (command === "generate_object_script") return { sql: "-- used by" };
      if (command === "execute_query") {
        return { elapsed_ms: 1, result_sets: [] } as unknown as QueryResult;
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText("Nothing references this object."),
      ).toBeInTheDocument();
    });
    expect(invokeMock).toHaveBeenCalledWith("generate_object_script", {
      database: "app",
      schema: "dbo",
      name: "Orders",
      objectType: "TABLE",
      action: "referencing_entities",
    });
  });
});
