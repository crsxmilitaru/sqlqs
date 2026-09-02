import { invoke } from "@tauri-apps/api/core";
import type { ThinkingConfig as GeminiThinkingConfig } from "@google/genai";
import {
  executeTool,
  getEnabledToolDeclarations,
  loadEnabledTools,
  WEB_SEARCH_TOOL_ID,
  type ToolExecutionContext,
} from "./ai-tools";
import type { GeminiStatus } from "./types";

let genaiModule: Promise<typeof import("@google/genai")> | undefined;

function loadGenAI() {
  genaiModule ??= import("@google/genai");
  return genaiModule;
}

const GEMINI_MODEL_STORAGE_KEY = "sqlqs_gemini_model";
const GEMINI_MODELS_CACHE_KEY = "sqlqs_gemini_models";
const GEMINI_THINKING_LEVEL_STORAGE_KEY = "sqlqs_gemini_thinking_level";
const GEMINI_THINKING_ENABLED_STORAGE_KEY = "sqlqs_gemini_thinking_enabled";
const MAX_TOOL_TURNS = 8;

export interface GeminiModelOption {
  id: string;
  label: string;
}

export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

type GeminiCategory = "pro" | "flash" | "flash-lite";

const CATEGORY_LABELS: Record<GeminiCategory, string> = {
  pro: "Pro",
  flash: "Flash",
  "flash-lite": "Lite",
};

const CATEGORY_ORDER: GeminiCategory[] = ["pro", "flash", "flash-lite"];

interface ModelCandidate {
  id: string;
  versionRank: number;
  label: string;
}

function describeModelId(id: string): {
  category: GeminiCategory;
  versionRank: number;
  label: string;
} | null {
  let category: GeminiCategory | null = null;
  if (/(^|-)flash-lite($|-)/.test(id)) category = "flash-lite";
  else if (/(^|-)flash($|-)/.test(id)) category = "flash";
  else if (/(^|-)pro($|-)/.test(id)) category = "pro";
  if (!category) return null;

  const versionMatch = id.match(/^gemini-(\d+)(?:\.(\d+))?/);
  let version: string | null = null;
  let versionRank = 0;
  if (versionMatch) {
    const major = parseInt(versionMatch[1], 10);
    const minor = versionMatch[2] ? parseInt(versionMatch[2], 10) : 0;
    version = versionMatch[2] ? `${major}.${minor}` : `${major}`;
    versionRank = major * 1000 + minor;
  }

  return {
    category,
    versionRank,
    label: version
      ? `${CATEGORY_LABELS[category]} ${version}`
      : CATEGORY_LABELS[category],
  };
}

export function labelForModelId(id: string): string {
  return describeModelId(id)?.label ?? id;
}

function readCachedModels(): GeminiModelOption[] {
  try {
    const raw = localStorage.getItem(GEMINI_MODELS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is GeminiModelOption =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        item.id.length > 0 &&
        typeof item.label === "string" &&
        item.label.length > 0,
    );
  } catch {
    return [];
  }
}

function pickLatestByCategory(rawModels: any[]): GeminiModelOption[] {
  const buckets: Record<GeminiCategory, ModelCandidate[]> = {
    pro: [],
    flash: [],
    "flash-lite": [],
  };

  for (const model of rawModels) {
    const fullName: string = model?.name ?? "";
    const id = fullName.replace(/^models\//, "");
    if (!id.startsWith("gemini-")) continue;

    const methods: string[] = model?.supportedGenerationMethods ?? [];
    if (methods.length > 0 && !methods.includes("generateContent")) continue;

    if (
      /embedding|aqa|imagen|tts|image-generation|(^|-)image($|-)|live|native-audio/i.test(
        id,
      )
    ) {
      continue;
    }

    const described = describeModelId(id);
    if (!described) continue;
    buckets[described.category].push({
      id,
      versionRank: described.versionRank,
      label: described.label,
    });
  }

  const result: GeminiModelOption[] = [];
  for (const category of CATEGORY_ORDER) {
    const matches = buckets[category];
    if (matches.length === 0) continue;
    matches.sort((a, b) => {
      if (b.versionRank !== a.versionRank) return b.versionRank - a.versionRank;
      return a.id.length - b.id.length;
    });
    const chosen = matches[0];
    result.push({ id: chosen.id, label: chosen.label });
  }
  return result;
}

function pickPreferredModel(models: GeminiModelOption[]): GeminiModelOption | undefined {
  return models.find((m) => /flash-lite/.test(m.id)) ?? models[0];
}

const FLASH_LITE_FALLBACK_MODEL = "gemini-3.5-flash-lite";
const MAX_TAB_TITLE_SQL_CHARS = 2000;

function sanitizeGeneratedTabTitle(text: string): string {
  const cleaned = text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/g, "");
  if (!cleaned) return "";
  if (cleaned.length > 80) return cleaned.slice(0, 77) + "...";
  return cleaned;
}

async function resolveFlashLiteModelId(): Promise<string> {
  let models = AiService.getCachedModels();
  if (!models.some((model) => /flash-lite/.test(model.id))) {
    models = await AiService.listAvailableModels();
  }
  return models.find((model) => /flash-lite/.test(model.id))?.id
    ?? FLASH_LITE_FALLBACK_MODEL;
}

function usesThinkingLevel(modelId: string): boolean {
  return /^gemini-(?!2\.5-)\d/.test(modelId);
}

function canUseMinimalThinking(modelId: string): boolean {
  return usesThinkingLevel(modelId) && /(^|-)flash(?:-lite)?($|-)/.test(modelId);
}

function normalizeThinkingLevel(
  modelId: string,
  level: GeminiThinkingLevel,
): GeminiThinkingLevel {
  if (
    level === "minimal" &&
    usesThinkingLevel(modelId) &&
    !canUseMinimalThinking(modelId)
  ) {
    return "low";
  }
  return level;
}

function toThinkingLevelEnum(
  level: GeminiThinkingLevel,
  ThinkingLevel: (typeof import("@google/genai"))["ThinkingLevel"],
) {
  switch (level) {
    case "minimal":
      return ThinkingLevel.MINIMAL;
    case "low":
      return ThinkingLevel.LOW;
    case "high":
      return ThinkingLevel.HIGH;
    case "medium":
    default:
      return ThinkingLevel.MEDIUM;
  }
}

async function buildThinkingConfig(
  modelId: string,
  thinkingLevel: GeminiThinkingLevel,
): Promise<GeminiThinkingConfig> {
  const config: GeminiThinkingConfig = { includeThoughts: true };

  if (!usesThinkingLevel(modelId)) {
    return config;
  }

  const { ThinkingLevel } = await loadGenAI();
  return {
    ...config,
    thinkingLevel: toThinkingLevelEnum(
      normalizeThinkingLevel(modelId, thinkingLevel),
      ThinkingLevel,
    ),
  };
}

export type ChatReference = "editor" | "selected" | "result";

interface ChatAttachmentBase {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "text";
}

export interface ChatImageAttachment extends ChatAttachmentBase {
  kind: "image";
  dataUrl?: string;
}

export interface ChatTextAttachment extends ChatAttachmentBase {
  kind: "text";
  text?: string;
}

export type ChatAttachment = ChatImageAttachment | ChatTextAttachment;

export interface ChatGroundingCitation {
  uri: string;
  title: string;
}

export interface ChatGroundingMetadata {
  searchEntryHtml?: string;
  citations?: ChatGroundingCitation[];
  webSearchQueries?: string[];
}

export type AssistantMessageKind = "text" | "thought" | "tool_call" | "error";

export type ToolCallStatus = "pending" | "done" | "error";

export interface ChatToolCall {
  id?: number;
  name: string;
  args?: Record<string, unknown>;
  status: ToolCallStatus;
  result?: string;
}

export interface ChatErrorMeta {
  code?: number;
  status?: string;
  raw?: string;
}

export interface ChatMessageContextItem {
  label: string;
  content: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  kind?: AssistantMessageKind;
  toolCall?: ChatToolCall;
  toolsUsed?: string[];
  references?: ChatReference[];
  attachments?: ChatAttachment[];
  contextItems?: ChatMessageContextItem[];
  groundingMetadata?: ChatGroundingMetadata;
  errorMeta?: ChatErrorMeta;
}

export const GEMINI_KEY_CHANGED_EVENT = "sqlqs:gemini-key-changed";
export const BRAVE_KEY_CHANGED_EVENT = "sqlqs:brave-key-changed";

export const BraveSearchService = {
  async setApiKey(key: string) {
    await invoke("store_brave_search_key", { key });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(BRAVE_KEY_CHANGED_EVENT));
    }
  },

  async getApiKey(): Promise<string | null> {
    return invoke<string | null>("load_brave_search_key");
  },

  async hasKey(): Promise<boolean> {
    return !!(await this.getApiKey());
  },
};

export interface ChatStreamCallbacks {
  onThoughtDelta(text: string): void;
  onThoughtEnd(): void;
  onTextDelta(text: string): void;
  onTextEnd(): void;
  onToolCall(call: { id: number; name: string; args: Record<string, unknown> }): void;
  onToolResult(id: number, output: string, status: "done" | "error"): void;
  onGroundingMetadata?(metadata: ChatGroundingMetadata): void;
}

function serializeMessage(message: ChatMessage): string {
  if (message.role !== "user") {
    return message.content;
  }

  const contextBlock = (message.contextItems ?? [])
    .map(
      (item) =>
        `${item.label}:\n\`\`\`\n${item.content}\n\`\`\``,
    )
    .join("\n\n");

  if (message.references?.length) {
    const references = message.references
      .map((reference) => `(${reference})`)
      .join(" ");
    const refLine = message.content
      ? `Context references: ${references}\n${message.content}`
      : `Context references: ${references}`;
    return contextBlock
      ? `${contextBlock}\n\n${refLine}`
      : refLine;
  }

  return contextBlock
    ? message.content.trim()
      ? `${contextBlock}\n\n${message.content}`
      : contextBlock
    : message.content;
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

function yieldToPaint(): Promise<void> {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.requestAnimationFrame(finish);
      window.setTimeout(finish, 50);
    });
  }
  return Promise.resolve();
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export interface ParsedGeminiError {
  code?: number;
  status?: string;
  message?: string;
  raw: string;
}

export function parseGeminiError(err: unknown): ParsedGeminiError {
  if (err && typeof err === "object" && (err as any).name === "AbortError") {
    return { raw: "Request aborted.", message: "Request aborted." };
  }
  const raw = (err instanceof Error
    ? err.message
    : String(err ?? "Unknown error")
  ).trim();

  const looksLikeJsonField =
    /"(error|code|status|message|details)"\s*:/;

  let code: number | undefined;
  let status: string | undefined;
  let leafMessage: string | undefined;
  let text = raw;

  for (let depth = 0; depth < 5; depth++) {
    if (code === undefined) {
      const codeMatch = text.match(/"code"\s*:\s*(\d{3})/);
      if (codeMatch) code = parseInt(codeMatch[1], 10);
    }
    if (status === undefined) {
      const statusMatch = text.match(/"status"\s*:\s*"([A-Z_]{3,})"/);
      if (statusMatch) status = statusMatch[1];
    }

    const messages: string[] = [];
    const messageRegex = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = messageRegex.exec(text)) !== null) {
      messages.push(unescapeJsonString(m[1]).trim());
    }
    if (messages.length === 0) break;

    const clean = messages.find((msg) => msg && !looksLikeJsonField.test(msg));
    if (clean) {
      leafMessage = clean;
      break;
    }

    text = messages[messages.length - 1];
  }

  return { code, status, message: leafMessage, raw };
}

const ERROR_EXPLANATIONS: Record<string, string> = {
  INVALID_ARGUMENT:
    "The request body is malformed. Check that your prompt and parameters match the API reference for the selected model.",
  FAILED_PRECONDITION:
    "Gemini's free tier isn't available in your region without billing. Enable billing in Google AI Studio to access the API.",
  PERMISSION_DENIED:
    "Your API key doesn't have permission for this resource. Check your key in Settings, and make sure it's authorized for the model you picked.",
  NOT_FOUND:
    "A referenced resource (model, file, or attachment) wasn't found. Try a different model, or re-upload any attachments.",
  RESOURCE_EXHAUSTED:
    "You've hit a Gemini rate limit or quota. Wait a moment and retry, switch to a smaller model, or request a quota increase.",
  INTERNAL:
    "Gemini hit an unexpected backend error — often because the context is too long. Shorten the prompt, try another model, or retry later.",
  UNAVAILABLE:
    "Gemini is temporarily overloaded or down. Try another model or retry in a moment.",
  DEADLINE_EXCEEDED:
    "The prompt or context is too large to be processed in time. Shorten the input or split the request.",
};

const HTTP_CODE_EXPLANATIONS: Record<number, string> = {
  400: "The request was malformed. Review the prompt and parameters.",
  401: "Authentication failed. Check the API key in Settings.",
  403: "Permission denied for this resource. Verify your API key.",
  404: "The model or resource doesn't exist. Try switching models.",
  429: "Rate limit or quota exceeded. Wait and retry, or upgrade your plan.",
  500: "Gemini hit an internal error. Usually transient — retry.",
  503: "Gemini is temporarily overloaded. Try again shortly.",
  504: "The request timed out. Shorten the prompt or split the request.",
};

export function getGeminiErrorExplanation(
  code?: number,
  status?: string,
): string | undefined {
  if (status && ERROR_EXPLANATIONS[status]) return ERROR_EXPLANATIONS[status];
  if (typeof code === "number" && HTTP_CODE_EXPLANATIONS[code])
    return HTTP_CODE_EXPLANATIONS[code];
  return undefined;
}

export const AiService = {
  async setApiKey(key: string) {
    await invoke("store_api_key", { key });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(GEMINI_KEY_CHANGED_EVENT));
    }
  },

  async getApiKey(): Promise<string | null> {
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

  getModel(): string | null {
    return localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
  },

  getCachedModels(): GeminiModelOption[] {
    return readCachedModels();
  },

  setThinkingLevel(level: GeminiThinkingLevel) {
    localStorage.setItem(GEMINI_THINKING_LEVEL_STORAGE_KEY, level);
  },

  getThinkingLevel(): GeminiThinkingLevel {
    const stored = localStorage.getItem(GEMINI_THINKING_LEVEL_STORAGE_KEY);
    if (
      stored === "minimal" ||
      stored === "low" ||
      stored === "medium" ||
      stored === "high"
    ) {
      return stored;
    }

    return localStorage.getItem(GEMINI_THINKING_ENABLED_STORAGE_KEY) === "false"
      ? "minimal"
      : "medium";
  },

  async getStatus(): Promise<GeminiStatus> {
    return {
      hasKey: !!(await this.getApiKey()),
    };
  },

  async listAvailableModels(): Promise<GeminiModelOption[]> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return [];
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`,
      );
      if (!response.ok) return [];
      const data = await response.json();
      const models: any[] = Array.isArray(data?.models) ? data.models : [];
      const options = pickLatestByCategory(models);
      if (options.length > 0) {
        localStorage.setItem(GEMINI_MODELS_CACHE_KEY, JSON.stringify(options));
      }
      return options;
    } catch {
      return [];
    }
  },

  async resolveModel(): Promise<string> {
    const stored = this.getModel();
    const models = await this.listAvailableModels();
    const selected =
      (stored ? models.find((m) => m.id === stored) : undefined) ??
      pickPreferredModel(models);

    if (selected) {
      if (selected.id !== stored) this.setModel(selected.id);
      return selected.id;
    }

    if (stored) return stored;
    throw new Error("No Gemini text models are available for this API key.");
  },

  async generateTabTitle(sql: string): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return "";

    const snippet = sql.trim().slice(0, MAX_TAB_TITLE_SQL_CHARS);
    if (!snippet) return "";

    try {
      const { GoogleGenAI, ThinkingLevel } = await loadGenAI();
      const genAI = new GoogleGenAI({ apiKey });
      const modelId = await resolveFlashLiteModelId();
      const thinkingConfig = usesThinkingLevel(modelId)
        ? {
          includeThoughts: false,
          thinkingLevel: canUseMinimalThinking(modelId)
            ? ThinkingLevel.MINIMAL
            : ThinkingLevel.LOW,
        }
        : undefined;

      const response = await genAI.models.generateContent({
        model: modelId,
        contents: `Name this SQL for an editor tab. Reply with only a short title of 3 to 8 words. No quotes, no punctuation, no explanation.\n\n\`\`\`sql\n${snippet}\n\`\`\``,
        config: {
          temperature: 0.2,
          maxOutputTokens: 48,
          thinkingConfig,
        },
      });

      return sanitizeGeneratedTabTitle(response.text ?? "");
    } catch {
      return "";
    }
  },

  buildSystemPrompt(database?: string): string {
    const dbName = database
      ? database.replace(/[\r\n]/g, "").slice(0, 128)
      : "unknown";
    return `You are an expert T-SQL assistant for SQL Query Studio application.
Current database: ${dbName}

You have tools available to inspect the database schema, columns, indexes, foreign keys, object definitions, the user's current query, the latest query result message (error or non-data result), and the list of databases. Use them when you need information to answer the user's question accurately.

RULES:
- Help users write, understand, and modify T-SQL queries
- Use your tools to look up schema information instead of guessing
- If a user message includes a (selected) reference, treat the selected SQL in the message as the primary focus for that turn
- If a user message includes a (result) reference, treat the latest query result message as the primary focus for that turn
- Users may attach screenshots or text files in chat; inspect them when relevant
- Provide clear explanations and suggestions
- When asked to modify code, provide the complete modified version
- Use proper T-SQL syntax (square brackets for identifiers, TOP not LIMIT, etc)
- Format SQL code for readability
- Be concise and helpful
- When providing SQL code, wrap it in \`\`\`sql code blocks`;
  },

  async chatStream(
    messages: ChatMessage[],
    context: ToolExecutionContext,
    callbacks: ChatStreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new Error(
        "Gemini API key not configured. Please set it in Settings.",
      );
    }

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    const { GoogleGenAI } = await loadGenAI();
    const genAI = new GoogleGenAI({ apiKey });
    const modelId = await this.resolveModel();
    const thinkingLevel = this.getThinkingLevel();
    const systemPrompt = this.buildSystemPrompt(context.currentDatabase);

    const enabledTools = loadEnabledTools();
    let toolDeclarations = getEnabledToolDeclarations(enabledTools);

    if (toolDeclarations.some((t) => t.name === WEB_SEARCH_TOOL_ID)) {
      const braveKey = await BraveSearchService.getApiKey();
      if (!braveKey) {
        toolDeclarations = toolDeclarations.filter(
          (t) => t.name !== WEB_SEARCH_TOOL_ID,
        );
      }
    }

    const toolsConfig: any[] = [];
    if (toolDeclarations.length > 0) {
      toolsConfig.push({ functionDeclarations: toolDeclarations });
    }

    const contents: any[] = messages
      .filter((msg) => {
        if (msg.role !== "assistant") return true;
        return (msg.kind ?? "text") === "text";
      })
      .map((msg) => ({
        role: msg.role === "assistant" ? "model" : "user",
        parts: buildMessageParts(msg),
      }));

    let toolCallIdCounter = 0;

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const stream = await genAI.models.generateContentStream({
        model: modelId,
        contents,
        config: {
          systemInstruction: systemPrompt,
          tools: toolsConfig.length > 0 ? toolsConfig : undefined,
          temperature: 0.7,
          maxOutputTokens: 4096,
          thinkingConfig: await buildThinkingConfig(modelId, thinkingLevel),
        },
      });

      const turnParts: any[] = [];
      const pendingFunctionCalls: {
        id: number;
        name: string;
        args: Record<string, unknown>;
      }[] = [];
      let inThought = false;
      let inText = false;
      const grounding: ChatGroundingMetadata = {};

      for await (const chunk of stream) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        let emittedVisibleDelta = false;
        const meta = (chunk.candidates?.[0] as any)?.groundingMetadata;
        if (meta) {
          const rendered = meta.searchEntryPoint?.renderedContent;
          if (typeof rendered === "string" && rendered.length > 0) {
            grounding.searchEntryHtml = rendered;
          }
          const chunks = Array.isArray(meta.groundingChunks)
            ? meta.groundingChunks
            : [];
          if (chunks.length > 0) {
            const citations: ChatGroundingCitation[] = grounding.citations
              ? [...grounding.citations]
              : [];
            const seen = new Set(citations.map((c) => c.uri));
            for (const c of chunks) {
              const uri: string | undefined = c?.web?.uri ?? c?.retrievedContext?.uri;
              const title: string | undefined =
                c?.web?.title ?? c?.retrievedContext?.title;
              if (uri && !seen.has(uri)) {
                citations.push({ uri, title: title || uri });
                seen.add(uri);
              }
            }
            if (citations.length > 0) grounding.citations = citations;
          }
          const queries = Array.isArray(meta.webSearchQueries)
            ? meta.webSearchQueries.filter((q: unknown): q is string => typeof q === "string")
            : [];
          if (queries.length > 0) grounding.webSearchQueries = queries;
        }

        const parts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          turnParts.push(part);

          if (part.functionCall) {
            if (inThought) {
              callbacks.onThoughtEnd();
              inThought = false;
            }
            if (inText) {
              callbacks.onTextEnd();
              inText = false;
            }
            const id = ++toolCallIdCounter;
            const name = part.functionCall.name ?? "";
            const args = (part.functionCall.args ?? {}) as Record<
              string,
              unknown
            >;
            pendingFunctionCalls.push({ id, name, args });
            callbacks.onToolCall({ id, name, args });
            emittedVisibleDelta = true;
            continue;
          }

          if (typeof part.text === "string" && part.text.length > 0) {
            if (part.thought) {
              if (inText) {
                callbacks.onTextEnd();
                inText = false;
              }
              if (!inThought) inThought = true;
              callbacks.onThoughtDelta(part.text);
              emittedVisibleDelta = true;
            } else {
              if (inThought) {
                callbacks.onThoughtEnd();
                inThought = false;
              }
              if (!inText) inText = true;
              callbacks.onTextDelta(part.text);
              emittedVisibleDelta = true;
            }
          }
        }

        if (emittedVisibleDelta) {
          await yieldToPaint();
        }
      }

      if (inThought) callbacks.onThoughtEnd();
      const hasGrounding =
        grounding.searchEntryHtml ||
        (grounding.citations && grounding.citations.length > 0) ||
        (grounding.webSearchQueries && grounding.webSearchQueries.length > 0);
      if (hasGrounding) {
        callbacks.onGroundingMetadata?.(grounding);
      }
      if (pendingFunctionCalls.length === 0) {
        if (inText) callbacks.onTextEnd();
        return;
      }

      if (inText) callbacks.onTextEnd();

      contents.push({ role: "model", parts: turnParts });

      const functionResponses: any[] = [];
      for (const call of pendingFunctionCalls) {
        let resultText: string;
        let status: "done" | "error" = "done";
        try {
          resultText = await executeTool(
            call.name,
            (call.args || {}) as Record<string, string>,
            context,
          );
        } catch (err: any) {
          resultText = `Error: ${err.message || String(err)}`;
          status = "error";
        }
        callbacks.onToolResult(call.id, resultText, status);
        functionResponses.push({
          functionResponse: {
            name: call.name,
            response: { output: resultText },
          },
        });
      }

      contents.push({ role: "user", parts: functionResponses });
    }

    throw new Error("Too many tool calls. Try a simpler question.");
  },
};
