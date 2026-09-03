import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIChatPanel from "./AIChatPanel";
import { AiService } from "../../lib/ai";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockReturnValue(false),
  requestPermission: vi.fn().mockResolvedValue(false),
  sendNotification: vi.fn(),
}));

vi.mock("../../lib/ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ai")>();
  return {
    ...original,
    AiService: {
      getApiKey: vi.fn().mockResolvedValue(null),
      listAvailableModels: vi.fn().mockResolvedValue([]),
      getCachedModels: vi.fn().mockReturnValue([]),
      getModel: vi.fn().mockReturnValue(null),
      getThinkingLevel: vi.fn().mockReturnValue("medium"),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
      chatStream: vi.fn(),
      buildSystemPrompt: vi.fn().mockReturnValue(""),
    },
  };
});

function renderPanel() {
  render(() => (
    <AIChatPanel
      currentCode=""
      currentDatabase=""
      currentResultMessage=""
      onApplyCode={vi.fn()}
      width={400}
      onWidthChange={vi.fn()}
    />
  ));
}

describe("AIChatPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(AiService.getApiKey).mockResolvedValue(null);
    vi.mocked(AiService.listAvailableModels).mockResolvedValue([]);
    vi.mocked(AiService.getCachedModels).mockReturnValue([]);
    vi.mocked(AiService.getModel).mockReturnValue(null);
  });

  it("disables the prompt input, send button, and model picker without an API key", async () => {
    renderPanel();

    const textarea = await screen.findByPlaceholderText(
      /Add an API key in Settings/,
    );
    expect(textarea).toHaveProperty("disabled", true);

    const sendButton = screen.getByRole("button", {
      name: "Send message",
    }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    const modelButton = screen.getByRole("button", {
      name: "Select AI model",
    }) as HTMLButtonElement;
    expect(modelButton.disabled).toBe(true);
  });

  it("enables the prompt input and model picker once a key is configured", async () => {
    vi.mocked(AiService.getApiKey).mockResolvedValue("stored-key");
    vi.mocked(AiService.getCachedModels).mockReturnValue([
      { id: "gemini-3.5-flash-lite", label: "Lite 3.5" },
    ]);
    vi.mocked(AiService.listAvailableModels).mockResolvedValue([
      { id: "gemini-3.5-flash-lite", label: "Lite 3.5" },
    ]);
    renderPanel();

    const textarea = await screen.findByPlaceholderText(
      /Ask about your SQL/,
    );
    expect(textarea).toHaveProperty("disabled", false);

    const modelButton = screen.getByRole("button", {
      name: "Select AI model",
    }) as HTMLButtonElement;
    await waitFor(() => expect(modelButton.disabled).toBe(false));
  });

  it("opens AI settings from the header action", async () => {
    const onOpenAiSettings = vi.fn();
    render(() => (
      <AIChatPanel
        currentCode=""
        currentDatabase=""
        currentResultMessage=""
        onApplyCode={vi.fn()}
        width={400}
        onWidthChange={vi.fn()}
        onOpenAiSettings={onOpenAiSettings}
      />
    ));

    const settingsButton = await screen.findByRole("button", {
      name: "AI Settings",
    });
    expect(settingsButton).toHaveProperty("disabled", false);

    fireEvent.click(settingsButton);
    expect(onOpenAiSettings).toHaveBeenCalledOnce();
  });
});
