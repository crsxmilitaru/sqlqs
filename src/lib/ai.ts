import { GoogleGenAI } from "@google/genai";
import type { GeminiStatus } from "./types";

const GEMINI_API_KEY_STORAGE_KEY = "sqlqs_gemini_api_key";
const GEMINI_MODEL_STORAGE_KEY = "sqlqs_gemini_model";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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

  getModelLabel(): string {
    const model = this.getModel();
    return model
      .replace(/^gemini-/, "Gemini ")
      .split("-")
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(" ");
  },

  buildSystemPrompt(database?: string, schema?: string): string {
    return `You are an expert T-SQL assistant for Microsoft SQL Server.

Database: ${database || "unknown"}
Schema:
${schema || "No schema available."}

RULES:
- Help users write, understand, and modify T-SQL queries
- Provide clear explanations and suggestions
- When asked to modify code, provide the complete modified version
- Use proper T-SQL syntax (square brackets for identifiers, TOP not LIMIT, etc)
- Format SQL code for readability
- Be concise and helpful
- When providing SQL code, wrap it in \`\`\`sql code blocks`;
  },

  async chat(
    messages: ChatMessage[],
    currentCode: string,
    currentDatabase?: string,
    schemaSummary?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured. Please set it in Settings.");
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      const genAI = new GoogleGenAI({ apiKey });
      const systemPrompt = this.buildSystemPrompt(currentDatabase, schemaSummary);
      const modelId = this.getModel();

      const formattedMessages = messages.map((msg) => ({
        role: msg.role as "user" | "model",
        parts: [{ text: msg.content }],
      }));

      const result = await genAI.models.generateContent({
        model: modelId,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Current SQL Code in Editor:\n\`\`\`sql\n${currentCode}\n\`\`\`\n\nSystem Instructions:\n${systemPrompt}`,
              },
            ],
          },
          ...formattedMessages,
        ],
        config: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      });

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      return result.text || "";
    } catch (error: any) {
      if (error.name === "AbortError") throw error;
      console.error("Gemini chat failed:", error);
      throw new Error(error.message || "Failed to generate response.");
    }
  },
};
