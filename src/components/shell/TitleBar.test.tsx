import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import TitleBar from "./TitleBar";

function renderTitleBar(overrides: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const props: Parameters<typeof TitleBar>[0] = {
    connected: false,
    serverName: "",
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onOpenSqlFile: vi.fn(),
    onShowSettings: vi.fn(),
    aiChatOpen: false,
    onToggleAiChat: vi.fn(),
    hasTabs: false,
    hasAiKey: false,
    ...overrides,
  };
  render(() => <TitleBar {...props} />);
  return props;
}

describe("TitleBar", () => {
  it("opens the connection dialog", () => {
    const onConnect = vi.fn();
    renderTitleBar({ onConnect });

    fireEvent.click(screen.getByRole("button", { name: "Connect Server" }));

    expect(onConnect).toHaveBeenCalledOnce();
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
});
