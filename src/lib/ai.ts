import { invoke } from "@tauri-apps/api/core";
import { GoogleGenAI } from "@google/genai";
import {
  executeTool,
  getEnabledToolDeclarations,
  loadEnabledTools,
  type ToolExecutionContext,
} from "./ai-tools";
import type { GeminiStatus } from "./types";

const GEMINI_MODEL_STORAGE_KEY = "sqlqs_gemini_model";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";
const MAX_TOOL_TURNS = 8;

export type ChatReference = "editor" | "selected" | "result";

interface ChatAttachmentBase {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "text";
}

export interface ChatImageAttachment extends ChatAttachmentBase {
  kind: "image";
  // Absent after a reload — only metadata is persisted in localStorage.
  dataUrl?: string;
}

export interface ChatTextAttachment extends ChatAttachmentBase {
  kind: "text";
  // Absent after a reload — only metadata is persisted in localStorage.
  text?: string;
}

export type ChatAttachment = ChatImageAttachment | ChatTextAttachment;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
  references?: ChatReference[];
  attachments?: ChatAttachment[];
}

export interface ChatResult {
  text: string;
  toolsUsed: string[];
}

function serializeMessage(message: ChatMessage): string {
  if (message.role !== "user" || !message.references?.length) {
    return message.content;
  }

  const references = message.references.map((reference) => `(${reference})`).join(" ");
  return message.content
    ? `Context references: ${references}\n${message.content}`
    : `Context references: ${references}`;
}

function buildMessageParts(message: ChatMessage): any[] {
  const parts: any[] = [];
  const text = serializeMessage(message).trim();

  if (text) {
    parts.push({ text });
  }

  for (const attachment of message.attachments ?? []) {
    if (attachment.kind === "image") {
      if (!attachment.dataUrl) continue;
      const commaIndex = attachment.dataUrl.indexOf(",");
      if (commaIndex < 0) continue;
      const base64Data = attachment.dataUrl.slice(commaIndex + 1);
      if (!base64Data) continue;

      parts.push({
        inlineData: {
          data: base64Data,
          mimeType: attachment.mimeType,
        },
      });
      continue;
    }

    if (!attachment.text) continue;
    parts.push({
      text: `Attached reference file: ${attachment.name}\n\`\`\`text\n${attachment.text}\n\`\`\``,
    });
  }

  return parts.length > 0 ? parts : [{ text: "" }];
}

export const AiService = {
  async setApiKey(key: string) {
    await invoke("store_api_key", { key });
  },

  async getApiKey(): Promise<string | null> {
    // Migrate from localStorage if present (pre-keyring versions)
    const legacy = localStorage.getItem("sqlqs_gemini_api_key");
    if (legacy) {
      await invoke("store_api_key", { key: legacy });
      localStorage.removeItem("sqlqs_gemini_api_key");
      return legacy;
    }
    return invoke<string | null>("load_api_key");
  },

  setModel(model: string) {
    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, model);
  },

  getModel(): string {
    return localStorage.getItem(GEMINI_MODEL_STORAGE_KEY) || DEFAULT_GEMINI_MODEL;
  },

  async getStatus(): Promise<GeminiStatus> {
    return {
      hasKey: !!(await this.getApiKey()),
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
    // Sanitize database name to prevent prompt injection via crafted DB names
    const dbName = database ? database.replace(/[\r\n]/g, "").slice(0, 128) : "unknown";
    return `You are an expert T-SQL assistant for Microsoft SQL Server.
Current database: ${dbName}

You have tools available to inspect the database schema, columns, indexes, foreign keys, object definitions, the user's current query, the user's selected editor code, the latest query result error, and the list of databases. Use them when you need information to answer the user's question accurately.

RULES:
- Help users write, understand, and modify T-SQL queries
- Use your tools to look up schema information instead of guessing
- If a user message includes a (selected) reference, treat the selected editor SQL as the primary focus for that turn
- If a user message includes a (result) reference, treat the latest query result error as the primary focus for that turn
- Users may attach screenshots or text files in chat; inspect them when relevant
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
    const apiKey = await this.getApiKey();
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
      parts: buildMessageParts(msg),
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
