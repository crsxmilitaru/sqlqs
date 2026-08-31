import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ContextMenu from "./ContextMenu";

describe("ContextMenu", () => {
  it("runs enabled actions and closes", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <ContextMenu
        x={20}
        y={30}
        onClose={onClose}
        items={[{ id: "open", label: "Open", onClick }]}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps disabled actions inert and closes on Escape", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <ContextMenu
        x={20}
        y={30}
        onClose={onClose}
        items={[{ id: "delete", label: "Delete", disabled: true, onClick }]}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClick).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens nested actions", () => {
    render(() => (
      <ContextMenu
        x={20}
        y={30}
        onClose={vi.fn()}
        items={[
          {
            id: "group",
            label: "Group",
            children: [{ id: "blue", label: "Blue" }],
          },
        ]}
      />
    ));

    fireEvent.click(screen.getByRole("button", { name: "Group" }));

    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });
});
