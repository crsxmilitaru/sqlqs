import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import PropertiesDialog from "./PropertiesDialog";
import { setInvokeHandler } from "../../test/tauri";
import type { QueryResult } from "../../lib/types";

function setupResult(columns: { name: string }[], row: unknown[][]) {
  setInvokeHandler((command) => {
    if (command === "generate_object_script") {
      return { sql: "-- properties" };
    }
    if (command === "execute_query") {
      return {
        elapsed_ms: 12,
        result_sets: [{ columns, rows: row }],
      } as unknown as QueryResult;
    }
    throw new Error(`Unexpected Tauri command: ${command}`);
  });
}

function renderDialog(
  objectType: "TABLE" | "DATABASE" = "TABLE",
) {
  const onClose = vi.fn();
  render(() => (
    <PropertiesDialog
      database="app"
      schema="dbo"
      name="Orders"
      objectType={objectType}
      onClose={onClose}
    />
  ));
  return { onClose };
}

describe("PropertiesDialog", () => {
  it("formats and renders property entries", async () => {
    setupResult(
      [
        { name: "CreatedDate" },
        { name: "RowCount" },
        { name: "SizeMB" },
        { name: "IsReplicated" },
        { name: "Nullable" },
      ],
      [["2026-01-15T10:30:00", 12345, 25.5, 1, null]],
    );
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText("Created Date")).toBeInTheDocument();
    });
    expect(screen.getByText("Row Count")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent?.replace(/[^\d]/g, "") === "12345",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("25.50 MB")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Loaded in 12 ms")).toBeInTheDocument();
  });

  it("shows database-scoped names and supports copy", async () => {
    setupResult([{ name: "Owner" }], [["dbo"]]);
    renderDialog("DATABASE");

    await waitFor(() => {
      expect(screen.getByText("Owner")).toBeInTheDocument();
    });
    expect(screen.getByText("[app]")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Copy/ }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("Owner: dbo"),
      );
    });
  });

  it("reports missing properties metadata", async () => {
    setInvokeHandler((command) => {
      if (command === "generate_object_script") return { sql: "-- x" };
      if (command === "execute_query") {
        return { elapsed_ms: 1, result_sets: [] } as unknown as QueryResult;
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderDialog();

    await waitFor(() => {
      expect(screen.getByText(/No properties returned/)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /Copy/ }),
    ).not.toBeInTheDocument();
  });

  it("shows query failures", async () => {
    setInvokeHandler((command) => {
      if (command === "generate_object_script") return { sql: "-- x" };
      if (command === "execute_query") {
        throw new Error("Query failed: invalid object name");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderDialog();

    await waitFor(() => {
      expect(
        screen.getByText("invalid object name"),
      ).toBeInTheDocument();
    });
  });
});
