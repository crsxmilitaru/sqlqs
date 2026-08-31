import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToolsPopup from "./ToolsPopup";
import { setInvokeHandler } from "../../test/tauri";
import {
  AI_TOOLS,
  loadEnabledTools,
  saveEnabledTools,
  WEB_SEARCH_TOOL_ID,
} from "../../lib/ai-tools";
import { BRAVE_KEY_CHANGED_EVENT } from "../../lib/ai";

function renderPopup() {
  const onClose = vi.fn();
  const [anchorRef, setAnchorRef] = createSignal<HTMLButtonElement>();
  render(() => (
    <div>
      <button ref={setAnchorRef}>anchor</button>
      <ToolsPopup anchorRef={anchorRef()} onClose={onClose} />
    </div>
  ));
  return { onClose };
}

function clickTool(label: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
}

describe("ToolsPopup", () => {
  beforeEach(() => {
    saveEnabledTools(new Set(AI_TOOLS.map((tool) => tool.id)));
    setInvokeHandler((command) => {
      if (command === "load_brave_search_key") return "stored-key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("enables all selectable tools by default", async () => {
    renderPopup();

    await waitFor(() => {
      expect(
        screen.queryByText("(API key required)"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("List Databases").className).toMatch(
      /\btext-text\b(?!\/)/,
    );
    expect(screen.getByText("Database Explorer")).toBeInTheDocument();
    expect(screen.getByText("External Search")).toBeInTheDocument();
    expect(
      screen.queryByText("(API key required)"),
    ).not.toBeInTheDocument();
  });

  it("disables web search when no Brave key is stored", async () => {
    setInvokeHandler((command) => {
      if (command === "load_brave_search_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderPopup();

    await waitFor(() => {
      expect(screen.getByText("(API key required)")).toBeInTheDocument();
    });
    const webSearch = screen.getByRole("button", { name: /Web Search/ });
    expect(webSearch).toBeDisabled();
    expect(webSearch).toHaveAttribute(
      "title",
      "Set a Brave Search API key in Settings → AI to enable web search",
    );
  });

  it("toggles individual tools and persists the choice", async () => {
    renderPopup();
    await waitFor(() => {
      expect(screen.getByText("Disable all")).toBeInTheDocument();
    });

    clickTool("List Databases");

    await waitFor(() => {
      expect(loadEnabledTools().has("list_databases")).toBe(false);
    });
    expect(
      screen.getByText("List Databases").className,
    ).not.toMatch(/\btext-text\b(?!\/)/);
  });

  it("refuses to toggle disabled tools", async () => {
    setInvokeHandler((command) => {
      if (command === "load_brave_search_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderPopup();
    await waitFor(() => {
      expect(screen.getByText("(API key required)")).toBeInTheDocument();
    });
    const before = loadEnabledTools();

    fireEvent.click(screen.getByRole("button", { name: /Web Search/ }));

    expect(loadEnabledTools()).toEqual(before);
  });

  it("disables every selectable tool from the header action", async () => {
    renderPopup();
    await waitFor(() => {
      expect(screen.getByText("Disable all")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable all" }));

    await waitFor(() => {
      expect(loadEnabledTools().size).toBe(0);
    });
    expect(screen.getByText("Enable all")).toBeInTheDocument();
  });

  it("re-enables every selectable tool from the header action", async () => {
    saveEnabledTools(new Set());
    renderPopup();
    await waitFor(() => {
      expect(
        screen.queryByText("(API key required)"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Enable all")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enable all" }));

    await waitFor(() => {
      expect(loadEnabledTools().size).toBe(AI_TOOLS.length);
    });
  });

  it("refreshes web search availability when the Brave key changes", async () => {
    setInvokeHandler((command) => {
      if (command === "load_brave_search_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    renderPopup();
    await waitFor(() => {
      expect(screen.getByText("(API key required)")).toBeInTheDocument();
    });

    setInvokeHandler((command) => {
      if (command === "load_brave_search_key") return "new-key";
    });
    window.dispatchEvent(new CustomEvent(BRAVE_KEY_CHANGED_EVENT));

    await waitFor(() => {
      expect(
        screen.queryByText("(API key required)"),
      ).not.toBeInTheDocument();
    });
    const webSearch = screen.getByRole("button", { name: /Web Search/ });
    expect(webSearch).not.toBeDisabled();

    fireEvent.click(webSearch);
    await waitFor(() => {
      expect(loadEnabledTools().has(WEB_SEARCH_TOOL_ID)).toBe(false);
    });
  });

  it("closes on outside clicks", async () => {
    const { onClose } = renderPopup();
    await waitFor(() => {
      expect(screen.getByText("AI Tools")).toBeInTheDocument();
    });

    fireEvent.mouseDown(document.body);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
