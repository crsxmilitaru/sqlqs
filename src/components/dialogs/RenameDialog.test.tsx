import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeMock, setInvokeHandler } from "../../test/tauri";
import RenameDialog from "./RenameDialog";

describe("RenameDialog", () => {
  beforeEach(() => {
    setInvokeHandler((command) => {
      if (command === "execute_query") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("validates object names before executing", () => {
    render(() => (
      <RenameDialog
        database="app"
        schema="dbo"
        name="Users"
        objectType="TABLE"
        onClose={vi.fn()}
      />
    ));
    const input = screen.getByRole("textbox", { name: "New name" });
    const rename = screen.getByRole("button", { name: "Rename" });

    expect(rename).toBeDisabled();

    fireEvent.input(input, { target: { value: "Bad[Name" } });

    expect(rename).toBeDisabled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("executes a safely quoted rename and reports success", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(() => (
      <RenameDialog
        database="Sales DB"
        schema="dbo"
        name="Users"
        objectType="TABLE"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    ));
    fireEvent.input(screen.getByRole("textbox", { name: "New name" }), {
      target: { value: "Customers" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(invokeMock).toHaveBeenCalledWith("execute_query", {
      sql: "EXEC [Sales DB].sys.sp_rename N'[dbo].[Users]', N'Customers'",
      timeoutSeconds: null,
    });
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith("Customers"),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("cleans native error prefixes before displaying failures", async () => {
    setInvokeHandler((command) => {
      if (command === "execute_query") {
        throw new Error("Query failed: Name exists");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    render(() => (
      <RenameDialog
        database="app"
        schema="dbo"
        name="Users"
        objectType="TABLE"
        onClose={vi.fn()}
      />
    ));
    fireEvent.input(screen.getByRole("textbox", { name: "New name" }), {
      target: { value: "Customers" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(await screen.findByText("Name exists")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
  });
});
