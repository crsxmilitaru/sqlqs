import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TitleBar from "./TitleBar";
import { setInvokeHandler } from "../../test/tauri";
import { CONNECTION_SETTINGS as SETTINGS } from "../../test/fixtures";
import { saveAiEnabled } from "../../lib/settings";

function renderTitleBar(overrides: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const props: Parameters<typeof TitleBar>[0] = {
    connected: false,
    serverName: "",
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onSwitchConnection: vi.fn(),
    onOpenSqlFile: vi.fn(),
    onShowSettings: vi.fn(),
    aiChatOpen: false,
    onToggleAiChat: vi.fn(),
    hasTabs: false,
    ...overrides,
  };
  const result = render(() => <TitleBar {...props} />);
  return { props, ...result };
}

describe("TitleBar", () => {
  beforeEach(() => {
    saveAiEnabled(true);
  });

  it("opens the connection dialog", () => {
    const onConnect = vi.fn();
    renderTitleBar({ onConnect });

    fireEvent.click(screen.getByRole("button", { name: "Connect Server" }));

    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("shows the AI chat button when AI is enabled", () => {
    const { container } = renderTitleBar();

    expect(container.querySelector(".fa-message")).not.toBeNull();
  });

  it("hides the AI chat button when AI is disabled", () => {
    saveAiEnabled(false);
    const { container } = renderTitleBar();

    expect(container.querySelector(".fa-message")).toBeNull();
  });

  it("runs enabled navigation actions", () => {
    const onGoBack = vi.fn();
    const onGoForward = vi.fn();
    renderTitleBar({
      connected: true,
      serverName: "localhost",
      onGoBack,
      onGoForward,
      canGoBack: true,
      canGoForward: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Go Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Go Forward" }));

    expect(onGoBack).toHaveBeenCalledOnce();
    expect(onGoForward).toHaveBeenCalledOnce();
  });

  it("opens the server switcher from the server pill and switches connection", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const onSwitchConnection = vi.fn();
    renderTitleBar({
      connected: true,
      serverName: "localhost",
      onSwitchConnection,
    });

    fireEvent.click(screen.getByRole("button", { name: /localhost/i }));

    const menu = await screen.findByRole("menu", { name: "Server connections" });
    expect(menu).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Staging/ }));
    expect(onSwitchConnection).toHaveBeenCalledOnce();
    expect(onSwitchConnection.mock.calls[0][0].name).toBe("Staging");
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Server connections" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("triggers disconnect from the server switcher", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const onDisconnect = vi.fn();
    renderTitleBar({
      connected: true,
      serverName: "localhost",
      onDisconnect,
    });

    fireEvent.click(screen.getByRole("button", { name: /localhost/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disconnect" }));

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("opens settings on the connections tab from the server switcher", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const onShowSettings = vi.fn();
    renderTitleBar({
      connected: true,
      serverName: "localhost",
      onShowSettings,
    });

    fireEvent.click(screen.getByRole("button", { name: /localhost/i }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Connection Settings…" }),
    );

    expect(onShowSettings).toHaveBeenCalledWith("connections");
  });

  it("closes the server switcher on Escape", async () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") return SETTINGS;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderTitleBar({ connected: true, serverName: "localhost" });

    fireEvent.click(screen.getByRole("button", { name: /localhost/i }));
    await screen.findByRole("menu", { name: "Server connections" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: "Server connections" }),
      ).not.toBeInTheDocument(),
    );
  });
});
