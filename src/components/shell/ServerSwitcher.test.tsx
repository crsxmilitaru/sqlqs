import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ServerSwitcher from "./ServerSwitcher";
import Toaster from "../ui/Toaster";
import { setInvokeHandler } from "../../test/tauri";
import {
  CONNECTION_SETTINGS as SETTINGS,
  EMPTY_CONNECTION_SETTINGS,
} from "../../test/fixtures";

function renderSwitcher(
  overrides: Partial<Parameters<typeof ServerSwitcher>[0]> = {},
) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const props: Parameters<typeof ServerSwitcher>[0] = {
    anchor,
    serverName: "staging-db",
    onSelect: vi.fn(),
    onDisconnect: vi.fn(),
    onManageConnections: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const utils = render(() => (
    <>
      <ServerSwitcher {...props} />
      <Toaster />
    </>
  ));
  return { ...utils, props, anchor };
}

describe("ServerSwitcher", () => {
  it("lists saved connections and marks the active one", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderSwitcher();

    expect(await screen.findByText("Local Dev")).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();
    expect(screen.getByText("sa@localhost")).toBeInTheDocument();
    expect(screen.getByText("Windows Auth@staging-db · reports")).toBeInTheDocument();

    const active = screen.getByRole("menuitem", { name: /Staging/ });
    expect(active).toHaveAttribute("aria-current", "true");
    expect(active).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: /Local Dev/ }),
    ).not.toBeDisabled();
  });

  it("does not mark a connection active when its server differs", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderSwitcher({ serverName: "some-other-host" });

    await screen.findByText("Staging");
    expect(
      screen.getByRole("menuitem", { name: /Staging/ }),
    ).not.toHaveAttribute("aria-current");
  });

  it("shows an empty state when there are no saved connections", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return EMPTY_CONNECTION_SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderSwitcher();

    expect(
      await screen.findByText("No saved connections yet."),
    ).toBeInTheDocument();
  });

  it("runs footer actions", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { props } = renderSwitcher();

    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));
    expect(props.onDisconnect).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Connection Settings…" }),
    );
    expect(props.onManageConnections).toHaveBeenCalledOnce();
  });

  it("selects a connection on click", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const onSelect = vi.fn();
    renderSwitcher({ onSelect });

    fireEvent.click(await screen.findByRole("menuitem", { name: /Local Dev/ }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].name).toBe("Local Dev");
  });

  it("closes on outside click but not when clicking the anchor", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const { props, anchor } = renderSwitcher();
    await screen.findByText("Staging");

    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalledOnce();

    fireEvent.mouseDown(anchor);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes and surfaces an error when loading connections fails", async () => {
    setInvokeHandler(() => {
      throw new Error("settings unavailable");
    });
    const { props } = renderSwitcher();

    await waitFor(() => expect(props.onClose).toHaveBeenCalledOnce());
    expect(
      await screen.findByText(/Failed to load saved connections/),
    ).toBeInTheDocument();
  });
});
