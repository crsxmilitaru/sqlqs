import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("returns the suppression choice when confirmed", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(() => (
      <ConfirmDialog
        title="Delete query"
        message="This cannot be undone."
        suppressFutureLabel="Do not ask again"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    ));

    await user.click(
      screen.getByRole("checkbox", { name: "Do not ask again" }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onConfirm).toHaveBeenCalledWith({ suppressFuture: true });
  });

  it("uses custom action labels", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(() => (
      <ConfirmDialog
        title="Close tab"
        message="Unsaved changes will be lost."
        confirmLabel="Close"
        cancelLabel="Keep editing"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    ));

    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(onCancel).toHaveBeenCalledWith({ suppressFuture: false });
  });

  it("cancels on Escape and overlay clicks", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(() => (
      <ConfirmDialog
        title="Close tab"
        message="Unsaved changes will be lost."
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    ));

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("dialog", { name: "Close tab" }));

    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
