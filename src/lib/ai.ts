import { GoogleGenAI } from "@google/genai";
import type { GeminiStatus, SqlCompletionRequest, SqlCompletionResult } from "./types";

const GEMINI_API_KEY_STORAGE_KEY = "sqlqs_gemini_api_key";
const GEMINI_MODEL_STORAGE_KEY = "sqlqs_gemini_model";
const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

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

  getStatus(): GeminiStatus {
    return {
      hasKey: !!this.getApiKey(),
    };
  },

  buildPrompt(request: SqlCompletionRequest, database?: string, schema?: string): string {
    return `
You are a Microsoft SQL Server expert. Autocomplete the T-SQL query inside a desktop SQL editor.
Current Database: ${database || "Default"}
Available Schema Context:
${schema || "No specific schema context provided."}

Return ONLY the exact text that should be inserted at the <CURSOR> marker.
Do not explain anything.
Do not wrap in markdown or code blocks.
The completion should be short and valid T-SQL.

Before cursor:
${request.before_cursor}<CURSOR>

After cursor:
${request.after_cursor}
`.trim();
  },

  async generateCompletion(
    request: SqlCompletionRequest,
    currentDatabase?: string,
    schemaSummary?: string
  ): Promise<SqlCompletionResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured. Please set it in Settings.");
    }

    const start = Date.now();
    try {
      const genAI = new GoogleGenAI({ apiKey });
      const prompt = this.buildPrompt(request, currentDatabase, schemaSummary);
      const modelId = this.getModel();

      const result = await genAI.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      let text = result.text || "";
      text = text.replace(/^```sql/i, "").replace(/```$/i, "").trim();

      return {
        insert_text: text,
        model_label: "Gemini 2.0 Flash",
        device_used: "Cloud",
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      console.error("Gemini completion failed:", error);
      throw new Error(error.message || "Failed to generate completion.");
    }
  }
};
