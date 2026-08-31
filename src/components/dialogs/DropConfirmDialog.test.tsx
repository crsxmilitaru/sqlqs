import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { invokeMock, setInvokeHandler } from "../../test/tauri";
import DropConfirmDialog from "./DropConfirmDialog";

describe("DropConfirmDialog", () => {
  it("generates and executes the drop script", async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    setInvokeHandler((command) => {
      if (command === "generate_object_script") {
        return { sql: "DROP TABLE [dbo].[Users]" };
      }
      if (command === "execute_query") return undefined;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    render(() => (
      <DropConfirmDialog
        database="app"
        schema="dbo"
        name="Users"
        objectType="TABLE"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Drop Table" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenNthCalledWith(1, "generate_object_script", {
        database: "app",
        schema: "dbo",
        name: "Users",
        objectType: "TABLE",
        action: "script_drop",
      });
      expect(invokeMock).toHaveBeenNthCalledWith(2, "execute_query", {
        sql: "DROP TABLE [dbo].[Users]",
        timeoutSeconds: null,
      });
      expect(onSuccess).toHaveBeenCalledOnce();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the dialog open and displays execution failures", async () => {
    invokeMock.mockRejectedValue(new Error("Query failed: Permission denied"));
    const onClose = vi.fn();
    render(() => (
      <DropConfirmDialog
        database="app"
        schema="dbo"
        name="Users"
        objectType="TABLE"
        onClose={onClose}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Drop Table" }));

    expect(await screen.findByText("Permission denied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop Table" })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
