import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import UpdateDialog from "./UpdateDialog";

function renderDialog(overrides: Partial<Parameters<typeof UpdateDialog>[0]> = {}) {
  const onInstall = vi.fn();
  const onCancel = vi.fn();
  render(() => (
    <UpdateDialog
      channel="stable"
      version="1.2.0"
      onInstall={onInstall}
      onCancel={onCancel}
      {...overrides}
    />
  ));
  return { onInstall, onCancel };
}

describe("UpdateDialog", () => {
  it("announces a stable version with release notes", () => {
    renderDialog({ body: "  ## Fixes\n- Crash on startup  " });

    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(
      screen.getByText("Version 1.2.0 is ready to install."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Crash on startup/)).toBeInTheDocument();
  });

  it("uses preview wording for the preview channel and hides empty bodies", () => {
    renderDialog({ channel: "preview", body: "   " });

    expect(
      screen.getByText("A new preview build is ready to install."),
    ).toBeInTheDocument();
  });

  it("triggers install and cancel callbacks", () => {
    const { onInstall, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Install update" }));
    expect(onInstall).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
