import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiService,
  getGeminiErrorExplanation,
  labelForModelId,
  parseGeminiError,
} from "./ai";

describe("AI helpers", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(null);
  });

  it("creates concise Gemini model labels", () => {
    expect(labelForModelId("gemini-3.1-pro-preview")).toBe("Pro 3.1");
    expect(labelForModelId("gemini-3-flash-lite")).toBe("Lite 3");
    expect(labelForModelId("custom-model")).toBe("custom-model");
  });

  it("extracts structured Gemini API errors", () => {
    const parsed = parseGeminiError(
      new Error(
        '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded"}}',
      ),
    );

    expect(parsed).toMatchObject({
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "Quota exceeded",
    });
  });

  it("recognizes aborted requests", () => {
    expect(parseGeminiError({ name: "AbortError" })).toEqual({
      raw: "Request aborted.",
      message: "Request aborted.",
    });
  });

  it("prefers status explanations and falls back to HTTP codes", () => {
    expect(getGeminiErrorExplanation(500, "RESOURCE_EXHAUSTED")).toContain(
      "rate limit",
    );
    expect(getGeminiErrorExplanation(401)).toContain("Authentication failed");
    expect(getGeminiErrorExplanation(418)).toBeUndefined();
  });

  it("migrates a legacy API key to the native keychain", async () => {
    localStorage.setItem("sqlqs_gemini_api_key", "legacy-key");

    await expect(AiService.getApiKey()).resolves.toBe("legacy-key");
    expect(invoke).toHaveBeenCalledWith("store_api_key", {
      key: "legacy-key",
    });
    expect(localStorage.getItem("sqlqs_gemini_api_key")).toBeNull();
  });

  it("persists model and thinking preferences", () => {
    AiService.setModel("gemini-3-flash");
    AiService.setThinkingLevel("high");

    expect(AiService.getModel()).toBe("gemini-3-flash");
    expect(AiService.getThinkingLevel()).toBe("high");
  });

  it("skips AI title naming when no API key is available", async () => {
    await expect(AiService.generateSqlTitle("SELECT 1")).resolves.toBe("");

    expect(invoke).toHaveBeenCalledWith("load_api_key");
  });
});
