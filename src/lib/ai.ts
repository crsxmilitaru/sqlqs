import { GoogleGenAI } from "@google/genai";
import {
  executeTool,
  getEnabledToolDeclarations,
  loadEnabledTools,
  type ToolExecutionContext,
} from "./ai-tools";
import type { GeminiStatus } from "./types";

const GEMINI_API_KEY_STORAGE_KEY = "sqlqs_gemini_api_key";
const GEMINI_MODEL_STORAGE_KEY = "sqlqs_gemini_model";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const MAX_TOOL_TURNS = 8;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

export interface ChatResult {
  text: string;
  toolsUsed: string[];
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

  buildSystemPrompt(database?: string): string {
    return `You are an expert T-SQL assistant for Microsoft SQL Server.
Current database: ${database || "unknown"}

You have tools available to inspect the database schema, columns, indexes, foreign keys, object definitions, the user's current query, and the list of databases. Use them when you need information to answer the user's question accurately.

RULES:
- Help users write, understand, and modify T-SQL queries
- Use your tools to look up schema information instead of guessing
- Provide clear explanations and suggestions
- When asked to modify code, provide the complete modified version
- Use proper T-SQL syntax (square brackets for identifiers, TOP not LIMIT, etc)
- Format SQL code for readability
- Be concise and helpful
- When providing SQL code, wrap it in \`\`\`sql code blocks`;
  },

  async chat(
    messages: ChatMessage[],
    context: ToolExecutionContext,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key not configured. Please set it in Settings.");
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const genAI = new GoogleGenAI({ apiKey });
    const modelId = this.getModel();
    const systemPrompt = this.buildSystemPrompt(context.currentDatabase);

    const enabledTools = loadEnabledTools();
    const toolDeclarations = getEnabledToolDeclarations(enabledTools);

    const contents: any[] = messages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }],
    }));

    const toolsUsed: string[] = [];

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const result = await genAI.models.generateContent({
        model: modelId,
        contents,
        config: {
          systemInstruction: systemPrompt,
          tools: toolDeclarations.length > 0
            ? [{ functionDeclarations: toolDeclarations }]
            : undefined,
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      });

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const calls = result.functionCalls;
      if (!calls || calls.length === 0) {
        return { text: result.text || "", toolsUsed };
      }

      for (const call of calls) {
        if (call.name && !toolsUsed.includes(call.name)) {
          toolsUsed.push(call.name);
        }
      }

      const parts = result.candidates?.[0]?.content?.parts;
      contents.push({
        role: "model",
        parts,
      });

      const functionResponses: any[] = [];

      for (const call of calls) {
        let resultText: string;
        try {
          resultText = await executeTool(
            call.name!,
            (call.args || {}) as Record<string, string>,
            context,
          );
        } catch (err: any) {
          resultText = `Error: ${err.message || String(err)}`;
        }

        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { output: resultText },
          },
        });
      }

      contents.push({
        role: "user",
        parts: functionResponses,
      });
    }

    throw new Error("Too many tool calls. Try a simpler question.");
  },
};
