import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { setInvokeHandler } from "../../test/tauri";
import SettingsView from "./SettingsView";

vi.mock("../../lib/ai", () => ({
  AiService: {
    getApiKey: vi.fn().mockResolvedValue(""),
    getStatus: vi.fn().mockResolvedValue({ hasKey: false }),
    setApiKey: vi.fn().mockResolvedValue(undefined),
  },
  BraveSearchService: {
    getApiKey: vi.fn().mockResolvedValue(""),
    setApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("SettingsView", () => {
  it("navigates between general and editor preferences", () => {
    setInvokeHandler((command) => {
      if (command === "load_connections") {
        return { connections: [], auto_connect_startup: false };
      }
      if (command === "list_custom_themes") return [];
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    render(() => (
      <SettingsView
        onClose={vi.fn()}
        version="0.5.0-preview"
        onCheckForUpdates={vi.fn()}
        checkingForUpdates={false}
        updateMessage={null}
        updateMessageTone="info"
      />
    ));

    expect(screen.getByText("Keep your open tabs between app restarts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editor" }));
    expect(screen.getByText("Suggestion style")).toBeInTheDocument();
  });
});
