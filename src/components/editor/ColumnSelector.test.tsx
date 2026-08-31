import { fireEvent, render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "../../lib/types";
import ColumnSelector from "./ColumnSelector";

const columns: ColumnInfo[] = [
  {
    name: "Id",
    type_name: "int",
    is_identity: true,
    is_nullable: false,
  },
  {
    name: "DisplayName",
    type_name: "nvarchar",
    is_identity: false,
    is_nullable: false,
  },
  {
    name: "CreatedAt",
    type_name: "datetime2",
    is_identity: false,
    is_nullable: false,
  },
];

describe("ColumnSelector", () => {
  it("filters columns and clears the search with Escape", async () => {
    const user = userEvent.setup();
    render(() => (
      <ColumnSelector
        columns={columns}
        hiddenColumnIndices={new Set()}
        onToggle={vi.fn()}
        onSetHidden={vi.fn()}
        anchorRef={undefined}
        onClose={vi.fn()}
      />
    ));
    const search = screen.getByPlaceholderText("Search columns…");

    await user.type(search, "display");

    expect(screen.getByText("DisplayName")).toBeInTheDocument();
    expect(screen.queryByText("CreatedAt")).not.toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(search).toHaveValue("");
    expect(screen.getByText("CreatedAt")).toBeInTheDocument();
  });

  it("toggles individual columns", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(() => (
      <ColumnSelector
        columns={columns}
        hiddenColumnIndices={new Set([1])}
        onToggle={onToggle}
        onSetHidden={vi.fn()}
        anchorRef={undefined}
        onClose={vi.fn()}
      />
    ));

    await user.click(screen.getByText("DisplayName").closest("button")!);

    expect(onToggle).toHaveBeenCalledWith(1);
    expect(screen.getByText("1 hidden")).toBeInTheDocument();
  });

  it("applies Select All only to matching columns", async () => {
    const user = userEvent.setup();
    const onSetHidden = vi.fn();
    render(() => (
      <ColumnSelector
        columns={columns}
        hiddenColumnIndices={new Set()}
        onToggle={vi.fn()}
        onSetHidden={onSetHidden}
        anchorRef={undefined}
        onClose={vi.fn()}
      />
    ));

    await user.type(screen.getByPlaceholderText("Search columns…"), "at");
    await user.click(screen.getByRole("button", { name: /Select All/ }));

    expect(onSetHidden).toHaveBeenCalledWith([2], true);
  });

  it("closes when clicking outside but not inside the popup", () => {
    const onClose = vi.fn();
    render(() => (
      <ColumnSelector
        columns={columns}
        hiddenColumnIndices={new Set()}
        onToggle={vi.fn()}
        onSetHidden={vi.fn()}
        anchorRef={undefined}
        onClose={onClose}
      />
    ));

    fireEvent.mouseDown(screen.getByText("Column Visibility"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
