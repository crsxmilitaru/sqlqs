import { GoogleGenAI } from "@google/genai";
import type { GeminiStatus, SqlCompletionRequest, SqlCompletionResult } from "./types";

const GEMINI_API_KEY_STORAGE_KEY = "sqlqs_gemini_api_key";
const GEMINI_MODEL_STORAGE_KEY = "sqlqs_gemini_model";
const GEMINI_ENABLED_STORAGE_KEY = "sqlqs_gemini_enabled";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

let schemaCache: { database: string | null; summary: string; timestamp: number } | null = null;
const SCHEMA_CACHE_TTL_MS = 60_000;

export const AiService = {
  setApiKey(key: string) {
    localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, key);
  },

  getApiKey(): string | null {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY);
  },

  setModel(model: string) {
    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, model);
  },

  getModel(): string {
    return localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL;
  },

  setEnabled(enabled: boolean) {
    localStorage.setItem(GEMINI_ENABLED_STORAGE_KEY, String(enabled));
  },

  isEnabled(): boolean {
    const raw = localStorage.getItem(GEMINI_ENABLED_STORAGE_KEY);
    return raw === null ? true : raw === "true";
  },

  getStatus(): GeminiStatus {
    return {
      hasKey: !!this.getApiKey(),
    };
  },

  getCachedSchema(): { database: string | null; summary: string } | null {
    if (schemaCache && Date.now() - schemaCache.timestamp < SCHEMA_CACHE_TTL_MS) {
      return { database: schemaCache.database, summary: schemaCache.summary };
    }
    return null;
  },

  setCachedSchema(database: string | null, summary: string) {
    schemaCache = { database, summary, timestamp: Date.now() };
  },

  invalidateSchemaCache() {
    schemaCache = null;
  },

  getModelLabel(): string {
    const model = this.getModel();
    return model
      .replace(/^gemini-/, "Gemini ")
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");
  },

  buildPrompt(request: SqlCompletionRequest, database?: string, schema?: string): string {
    return `You are an expert T-SQL autocomplete engine for Microsoft SQL Server.

Database: ${database || "unknown"}
Schema:
${schema || "No schema available."}

RULES:
- Return ONLY the raw T-SQL text to insert at the cursor. Nothing else.
- Do NOT repeat any text that already exists before or after the cursor.
- Do NOT wrap in markdown, code blocks, backticks, or quotes.
- Keep completions concise — complete the current statement, don't write new ones.
- Use proper T-SQL syntax (square brackets for identifiers, TOP not LIMIT, etc).
- If context is too ambiguous, return an empty string.

Text before cursor:
${request.before_cursor}|

Text after cursor:
${request.after_cursor}`.trim();
  },

  async generateCompletion(
    request: SqlCompletionRequest,
    currentDatabase?: string,
    schemaSummary?: string,
    signal?: AbortSignal,
  ): Promise<SqlCompletionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured. Please set it in Settings.");
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const start = Date.now();
    try {
      const genAI = new GoogleGenAI({ apiKey });
      const prompt = this.buildPrompt(request, currentDatabase, schemaSummary);
      const modelId = this.getModel();

      const result = await genAI.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          temperature: 0,
          maxOutputTokens: 256,
        },
      });

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      let text = result.text || "";
      text = text
        .replace(/^```(?:sql|tsql|t-sql)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .replace(/^`+|`+$/g, "")
        .trim();

      return {
        insert_text: text,
        model_label: this.getModelLabel(),
        device_used: "Cloud",
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      if (error.name === "AbortError") throw error;
      console.error("Gemini completion failed:", error);
      throw new Error(error.message || "Failed to generate completion.");
    }
  },
};
