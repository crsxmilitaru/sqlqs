import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiService,
  BraveSearchService,
  BRAVE_KEY_CHANGED_EVENT,
  GEMINI_KEY_CHANGED_EVENT,
} from "./ai";
import { saveAiEnabled } from "./settings";
import { invokeMock, setInvokeHandler } from "../test/tauri";

describe("AI service storage and key management", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores the Gemini key and broadcasts the change", async () => {
    setInvokeHandler((command) => {
      if (command === "store_api_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const listener = vi.fn();
    window.addEventListener(GEMINI_KEY_CHANGED_EVENT, listener);

    await AiService.setApiKey("new-key");

    expect(invokeMock).toHaveBeenCalledWith("store_api_key", {
      key: "new-key",
    });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(GEMINI_KEY_CHANGED_EVENT, listener);
  });

  it("reports key presence via getStatus", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "stored";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(AiService.getStatus()).resolves.toEqual({ hasKey: true });
  });

  it("stores and clears the autocomplete model", () => {
    expect(AiService.getAutocompleteModel()).toBeNull();

    AiService.setAutocompleteModel("gemini-3.5-flash");
    expect(AiService.getAutocompleteModel()).toBe("gemini-3.5-flash");
    expect(localStorage.getItem("sqlqs_gemini_autocomplete_model")).toBe(
      "gemini-3.5-flash",
    );

    AiService.setAutocompleteModel(null);
    expect(AiService.getAutocompleteModel()).toBeNull();
    expect(localStorage.getItem("sqlqs_gemini_autocomplete_model")).toBeNull();
  });

  it("defaults thinking level to medium without stored preferences", () => {
    expect(AiService.getThinkingLevel()).toBe("medium");
  });

  it("maps disabled thinking to the minimal level", () => {
    localStorage.setItem("sqlqs_gemini_thinking_enabled", "false");

    expect(AiService.getThinkingLevel()).toBe("minimal");
  });

  it("ignores invalid stored thinking levels", () => {
    localStorage.setItem("sqlqs_gemini_thinking_level", "bogus");

    expect(AiService.getThinkingLevel()).toBe("medium");
  });

  it("returns an empty model list without an API key", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(AiService.listAvailableModels()).resolves.toEqual([]);
  });

  it("resolves the stored model when still offered", async () => {
    AiService.setModel("custom-model");
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ models: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(AiService.resolveModel()).resolves.toBe("custom-model");
  });

  it("fails model resolution without models or a stored model", async () => {
    localStorage.removeItem("sqlqs_gemini_model");
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => ({ models: [] }) }),
    );

    await expect(AiService.resolveModel()).rejects.toThrow(
      "No Gemini text models are available",
    );
  });

  it("returns an empty list when the models endpoint fails", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(AiService.listAvailableModels()).resolves.toEqual([]);
  });

  it("builds a system prompt naming the current database", () => {
    const prompt = AiService.buildSystemPrompt("master");
    expect(prompt).toContain("Current database: master");
    expect(prompt).toContain("T-SQL");
  });

  it("masks unknown databases in the system prompt", () => {
    expect(AiService.buildSystemPrompt(undefined)).toContain(
      "Current database: unknown",
    );
  });

  it("skips title generation for empty SQL", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(AiService.generateSqlTitle("   ")).resolves.toBe("");
  });

  it("returns an empty title when generation fails", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(
      AiService.generateSqlTitle("SELECT * FROM Orders"),
    ).resolves.toBe("");
  });
});

describe("BraveSearchService", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores, loads, and broadcasts the Brave key", async () => {
    setInvokeHandler((command) => {
      if (command === "store_brave_search_key") return null;
      if (command === "load_brave_search_key") return "brave-key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const listener = vi.fn();
    window.addEventListener(BRAVE_KEY_CHANGED_EVENT, listener);

    await BraveSearchService.setApiKey("brave-key");
    await expect(BraveSearchService.getApiKey()).resolves.toBe("brave-key");
    await expect(BraveSearchService.hasKey()).resolves.toBe(true);

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(BRAVE_KEY_CHANGED_EVENT, listener);
  });

  it("reports no key when none is stored", async () => {
    setInvokeHandler((command) => {
      if (command === "load_brave_search_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(BraveSearchService.hasKey()).resolves.toBe(false);
  });
});

describe("chatStream guards", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("rejects streaming when AI is disabled", async () => {
    saveAiEnabled(false);
    try {
      await expect(
        AiService.chatStream(
          [{ id: "1", role: "user", content: "hi" }] as never,
          { currentCode: "" },
          {
            onThoughtDelta: () => {},
            onThoughtEnd: () => {},
            onTextDelta: () => {},
            onTextEnd: () => {},
            onToolCall: () => {},
            onToolResult: () => {},
          },
        ),
      ).rejects.toThrow("AI is disabled");
    } finally {
      saveAiEnabled(true);
    }
  });

  it("skips inline completion when AI is disabled", async () => {
    saveAiEnabled(false);
    setInvokeHandler(() => {
      throw new Error("Unexpected Tauri command");
    });
    try {
      await expect(
        AiService.generateInlineCompletion({
          prefix: "SELECT * FROM ",
          suffix: "",
        }),
      ).resolves.toBeNull();
    } finally {
      saveAiEnabled(true);
    }
  });

  it("rejects streaming without an API key", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return null;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    await expect(
      AiService.chatStream(
        [{ id: "1", role: "user", content: "hi" }] as never,
        { currentCode: "" },
        {
          onThoughtDelta: () => {},
          onThoughtEnd: () => {},
          onTextDelta: () => {},
          onTextEnd: () => {},
          onToolCall: () => {},
          onToolResult: () => {},
        },
      ),
    ).rejects.toThrow("Gemini API key not configured");
  });

  it("rejects immediately when the signal is already aborted", async () => {
    setInvokeHandler((command) => {
      if (command === "load_api_key") return "key";
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      AiService.chatStream(
        [{ id: "1", role: "user", content: "hi" }] as never,
        { currentCode: "" },
        {
          onThoughtDelta: () => {},
          onThoughtEnd: () => {},
          onTextDelta: () => {},
          onTextEnd: () => {},
          onToolCall: () => {},
          onToolResult: () => {},
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
