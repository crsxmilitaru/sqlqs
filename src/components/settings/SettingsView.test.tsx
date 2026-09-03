import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { setInvokeHandler } from "../../test/tauri";
import SettingsView from "./SettingsView";

vi.mock("../../lib/ai", () => ({
  AiService: {
    getApiKey: vi.fn().mockResolvedValue(""),
    getStatus: vi.fn().mockResolvedValue({ hasKey: false }),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    getAutocompleteModel: vi.fn().mockReturnValue(null),
    setAutocompleteModel: vi.fn(),
    getCachedModels: vi.fn().mockReturnValue([
      { id: "gemini-3.5-flash-lite", label: "Lite 3.5" },
    ]),
    listAvailableModels: vi.fn().mockResolvedValue([]),
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

  it("filters setting sections and category tabs when searching", async () => {
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

    const searchInput = screen.getByPlaceholderText("Search settings…");
    fireEvent.input(searchInput, { target: { value: "font" } });

    expect(screen.getByRole("button", { name: /All results/ })).toBeInTheDocument();
    expect(screen.getByText("Font size")).toBeInTheDocument();

    const editorTab = screen.getByRole("button", { name: "Editor" });
    fireEvent.click(editorTab);
    expect(screen.getByText("Font size")).toBeInTheDocument();

    const allResults = screen.getByRole("button", { name: /All results/ });
    fireEvent.click(allResults);
    expect(screen.getByText("Font size")).toBeInTheDocument();
  });

  it("toggles inline suggestions from the AI tab", () => {
    localStorage.clear();
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
        initialTab="ai"
        version="0.5.0-preview"
        onCheckForUpdates={vi.fn()}
        checkingForUpdates={false}
        updateMessage={null}
        updateMessageTone="info"
      />
    ));

    expect(screen.getByText("Inline suggestions")).toBeInTheDocument();

    const masterToggle = screen.getByRole("button", { name: "Enable AI" });
    expect(masterToggle.getAttribute("aria-pressed")).toBe("true");

    const modelPicker = screen.getByRole("combobox") as HTMLButtonElement;
    expect(modelPicker.disabled).toBe(false);
    expect(modelPicker).toHaveTextContent("Auto");

    const toggle = screen.getByRole("button", { name: "Inline suggestions" }) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(modelPicker.disabled).toBe(true);
    expect(localStorage.getItem("sqlqs_ai_autocomplete")).toBe("false");

    fireEvent.click(masterToggle);
    expect(masterToggle.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem("sqlqs_ai_enabled")).toBe("false");
    expect(
      screen.queryByRole("button", { name: "Inline suggestions" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Notify when AI responds"),
    ).not.toBeInTheDocument();

    fireEvent.click(masterToggle);
    expect(masterToggle.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: "Inline suggestions" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("opens directly on the requested tab", () => {
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
        initialTab="connections"
        version="0.5.0-preview"
        onCheckForUpdates={vi.fn()}
        checkingForUpdates={false}
        updateMessage={null}
        updateMessageTone="info"
      />
    ));

    expect(
      screen.getByText("Manage how connections appear in the start menu"),
    ).toBeInTheDocument();
  });
});

