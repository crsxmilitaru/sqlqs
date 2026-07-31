import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { marked } from "marked";
import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  AiService,
  getGeminiErrorExplanation,
  parseGeminiError,
  GEMINI_KEY_CHANGED_EVENT,
  type ChatAttachment,
  type ChatGroundingMetadata,
  type ChatImageAttachment,
  type ChatMessage,
  type ChatMessageContextItem,
  type ChatReference,
  type ChatTextAttachment,
  type GeminiModelOption,
  type GeminiThinkingLevel,
} from "../../lib/ai";
import { getToolLabel, type ToolExecutionContext } from "../../lib/ai-tools";
import {
  loadAiNotifications,
  loadExecutionPreferences,
} from "../../lib/settings";
import { formatTimestamp } from "../../lib/sql-date";
import { useConversationHistory } from "../../hooks/useConversationHistory";
import ToolsPopup from "./ToolsPopup";
import ModelPickerPopup, { getModelIcon } from "./ModelPickerPopup";
import Tooltip from "../ui/Tooltip";
import ConfirmDialog from "../ui/ConfirmDialog";
import DialogShell from "../ui/DialogShell";
import { Icon } from "../ui/Icons";

marked.setOptions({ breaks: true, gfm: true });

const SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "s",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  ALLOWED_ATTR: ["href", "title"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#)/i,
};

function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content) as string;
  return DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG);
}

function lastNonEmptyLine(content: string): string {
  const trimmed = content.replace(/\s+$/, "");
  if (!trimmed) return "";
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return "";
}

let msgIdCounter = 0;
function newMsgId(): string {
  msgIdCounter += 1;
  return `m_${Date.now().toString(36)}_${msgIdCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function ensureIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => (m.id ? m : { ...m, id: newMsgId() }));
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes === 1 ? "1 minute" : `${minutes} minutes`} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours === 1 ? "1 hour" : `${hours} hours`} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days === 1 ? "1 day" : `${days} days`} ago`;
  const months = Math.floor(days / 30);
  return `${months === 1 ? "1 month" : `${months} months`} ago`;
}

const CHAT_STORAGE_KEY = "sqlqs_chat_history";
const MAX_CHAT_ATTACHMENTS = 4;
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CHAT_TEXT_ATTACHMENT_BYTES = 256 * 1024;
const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "sql",
  "md",
  "json",
  "csv",
  "tsv",
  "xml",
  "yml",
  "yaml",
  "log",
  "ini",
  "toml",
  "env",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "py",
  "rs",
  "java",
  "go",
  "sh",
  "ps1",
]);

function loadMessages(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    return stored ? ensureIds(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: ChatMessage[]) {
  const serializable = msgs.map((message) => {
    if (!message.attachments?.length) return message;
    return {
      ...message,
      attachments: message.attachments.map((attachment) =>
        attachment.kind === "image"
          ? {
              id: attachment.id,
              kind: "image" as const,
              name: attachment.name,
              mimeType: attachment.mimeType,
            }
          : {
              id: attachment.id,
              kind: "text" as const,
              name: attachment.name,
              mimeType: attachment.mimeType,
            },
      ),
    };
  });
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(serializable));
}

export type ApplyMode = "append" | "replace" | "new-tab";

export interface PinnedContextItem {
  id: string;
  label: string;
  icon: string;
  content: string;
}

export interface PendingChatMessage {
  id: number;
  content?: string;
  pinnedContext?: PinnedContextItem;
}

interface FailedChatRequest {
  messages: ChatMessage[];
  context: ToolExecutionContext;
}

const GROUNDING_SANITIZE_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: ["a", "span", "div", "style", "svg", "path", "g"],
  ALLOWED_ATTR: [
    "href",
    "target",
    "rel",
    "class",
    "style",
    "viewBox",
    "fill",
    "d",
    "xmlns",
  ],
  ALLOWED_URI_REGEXP: /^https?:/i,
  ADD_ATTR: ["target"],
};

function GroundingFooter(props: { metadata: ChatGroundingMetadata }) {
  const sanitizedSuggestions = createMemo(() => {
    const html = props.metadata.searchEntryHtml;
    if (!html) return "";
    return DOMPurify.sanitize(html, GROUNDING_SANITIZE_CONFIG);
  });
  return (
    <div class="mt-2 flex flex-col gap-1.5 border-t border-border/40 pt-2">
      <Show when={sanitizedSuggestions()}>
        <div
          class="chat-grounding-suggestions overflow-x-auto"
          innerHTML={sanitizedSuggestions()}
        />
      </Show>
      <Show when={props.metadata.citations && props.metadata.citations.length}>
        <div class="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <Icon name="link" class="text-icon-xs opacity-70" />
          <span class="font-semibold">Sources:</span>
          <For each={props.metadata.citations}>
            {(citation, idx) => (
              <a
                href={citation.uri}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex max-w-[220px] items-center gap-1 truncate rounded-sm px-1.5 py-0.5 text-accent hover:bg-surface-hover hover:underline"
                title={citation.title}
              >
                <span class="opacity-60">{idx() + 1}.</span>
                <span class="truncate">{citation.title}</span>
              </a>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function CollapsibleRow(props: {
  icon: string;
  iconClass?: string;
  label: string;
  preview?: string;
  expanded: boolean;
  onToggle: () => void;
  trailing?: JSX.Element;
  children?: JSX.Element;
}) {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      props.onToggle();
    }
  };
  return (
    <div class="rounded-md border border-border/60 bg-surface-panel/40 text-text-muted">
      <div
        role="button"
        tabindex="0"
        aria-expanded={props.expanded}
        onClick={() => props.onToggle()}
        onKeyDown={handleKey}
        class="flex items-center gap-1.5 px-2.5 py-1.5 text-s hover:bg-surface-hover/60 transition-colors cursor-pointer rounded-md outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
      >
        <i
          class={`fa-solid ${props.icon} text-icon flex-shrink-0 ${
            props.iconClass ?? "opacity-70"
          }`}
        />
        <span class="font-semibold text-text-muted flex-shrink-0">
          {props.label}
        </span>
        <div class="min-w-0 flex-1 truncate">
          <Show when={!props.expanded && props.preview}>
            <span class="text-text-muted/70 italic font-normal">
              {" — "}
              {props.preview}
            </span>
          </Show>
        </div>
        {props.trailing}
        <i
          class={`fa-solid ${
            props.expanded ? "fa-chevron-up" : "fa-chevron-down"
          } text-icon-xs opacity-60 flex-shrink-0`}
        />
      </div>
      <Show when={props.expanded}>
        <div class="px-3 pb-2.5 pt-1 text-s leading-relaxed text-text-muted">
          {props.children}
        </div>
      </Show>
    </div>
  );
}

function ToolsUsedBadge(props: { toolsUsed: string[] }) {
  return (
    <Show when={props.toolsUsed.length > 0}>
      <div class="flex items-center gap-1.5 flex-wrap mb-1.5 focus:outline-none">
        <For each={props.toolsUsed}>
          {(name) => (
            <span class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent text-accent-text text-s font-semibold">
              <Icon name="wrench" class="text-icon opacity-80" />
              {getToolLabel(name)}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

interface Props {
  currentCode: string;
  currentDatabase?: string;
  currentResultMessage?: string;
  onApplyCode: (code: string, mode: ApplyMode) => void;
  width: number;
  onWidthChange: (width: number) => void;
  pendingMessage?: PendingChatMessage | null;
  onPendingMessageHandled?: (id: number) => void;
}

const REFERENCE_META: Record<ChatReference, { icon: string; label: string }> = {
  editor: { icon: "fa-code", label: "Editor" },
  selected: { icon: "fa-i-cursor", label: "Selected SQL" },
  result: { icon: "fa-message", label: "Result Message" },
};

function MessageReferenceTags(props: { references: ChatReference[] }) {
  return (
    <div class="mb-1.5 flex items-center gap-1.5 flex-wrap">
      <For each={props.references}>
        {(reference) => {
          const meta = REFERENCE_META[reference] ?? {
            icon: "fa-tag",
            label: reference,
          };
          return (
            <span class="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-panel/60 px-2 py-1 text-s font-semibold text-text">
              <Icon name={meta.icon} class="text-icon opacity-70" />
              {meta.label}
            </span>
          );
        }}
      </For>
    </div>
  );
}

interface ChatContextOrAttachmentCardProps {
  type: "context" | "sent-context" | "attachment";
  item: PinnedContextItem | ChatMessageContextItem | ChatAttachment;
  removable?: boolean;
  onRemove?: () => void;
}

function ChatContextOrAttachmentCard(props: ChatContextOrAttachmentCardProps) {
  const isImage = () => {
    if (props.type === "attachment") {
      const att = props.item as ChatAttachment;
      return att.kind === "image";
    }
    return false;
  };

  const dataUrl = () => {
    if (props.type === "attachment") {
      const att = props.item as ChatAttachment;
      if (att.kind === "image") {
        return (att as ChatImageAttachment).dataUrl;
      }
    }
    return undefined;
  };

  const label = () => {
    if (props.type === "attachment") {
      return (props.item as ChatAttachment).name;
    } else {
      return (props.item as PinnedContextItem | ChatMessageContextItem).label;
    }
  };

  const subtitle = () => {
    if (props.type === "attachment") {
      const att = props.item as ChatAttachment;
      if (att.kind === "image") {
        return att.mimeType || "Image";
      } else {
        const text = (att as ChatTextAttachment).text;
        if (text) {
          return text.replace(/\r?\n/g, " ").trim();
        }
        return "Content not retained after reload";
      }
    } else {
      const content = (props.item as PinnedContextItem | ChatMessageContextItem).content;
      return content.replace(/\r?\n/g, " ").trim();
    }
  };

  const icon = () => {
    if (props.type === "attachment") {
      const att = props.item as ChatAttachment;
      return att.kind === "image" ? "image" : "file-lines";
    } else if (props.type === "context") {
      return (props.item as PinnedContextItem).icon;
    } else {
      const labelKey = (props.item as ChatMessageContextItem).label.toLowerCase();
      if (labelKey.includes("error")) return "circle-exclamation";
      if (labelKey.includes("result")) return "table";
      if (labelKey.includes("selected")) return "i-cursor";
      return "paperclip";
    }
  };

  return (
    <div class="group relative flex h-11 w-[200px] flex-shrink-0 select-none items-center gap-2 rounded-lg border border-border/70 bg-surface-panel/60 p-2 text-s transition-all hover:border-border-hover/80 hover:bg-surface-panel-hover/80">
      <Show
        when={isImage()}
        fallback={
          <div class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-surface-hover/80 text-text-muted">
            <Icon name={icon()} class="text-s" />
          </div>
        }
      >
        <Show
          when={dataUrl()}
          fallback={
            <div
              class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-surface-hover text-text-muted"
              title={`${label()} — content not retained after reload`}
            >
              <Icon name="image" class="text-s" />
            </div>
          }
        >
          <img
            src={dataUrl()}
            alt={label()}
            class="h-7 w-7 flex-shrink-0 rounded object-cover"
          />
        </Show>
      </Show>

      <div class="min-w-0 flex-1 flex flex-col justify-center pr-1.5">
        <div class="truncate text-xs font-semibold text-text leading-tight">
          {label()}
        </div>
        <div class="truncate text-3xs text-text-muted/70 leading-normal">
          {subtitle()}
        </div>
      </div>

      <Show when={props.removable}>
        <Tooltip content="Remove" placement="top">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              props.onRemove?.();
            }}
            class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
          >
            <Icon name="xmark" class="text-icon-xs" />
          </button>
        </Tooltip>
      </Show>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Failed to read ${file.name}`));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

async function notifyAiResponse(text: string) {
  if (!loadAiNotifications()) return;
  if (typeof document !== "undefined" && document.hasFocus()) return;

  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (!granted) return;

    const trimmed = text.trim().replace(/```[\s\S]*?```/g, "[code]");
    const body = trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
    sendNotification({
      title: "SQL Query Studio",
      body: body || "AI assistant has replied",
    });
  } catch {
    // Notifications are best-effort; ignore platform/permission errors.
  }
}

function isTextLikeFile(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/typescript",
      "application/x-sh",
    ].includes(file.type) ||
    TEXT_FILE_EXTENSIONS.has(getFileExtension(file.name))
  );
}

export default function AIChatPanel(props: Props) {
  const [messages, setMessages] = createSignal<ChatMessage[]>(loadMessages());
  const [input, setInput] = createSignal("");
  const [draftAttachments, setDraftAttachments] = createSignal<
    ChatAttachment[]
  >([]);
  const [pinnedContext, setPinnedContext] = createSignal<PinnedContextItem[]>(
    [],
  );
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [failedRequest, setFailedRequest] =
    createSignal<FailedChatRequest | null>(null);
  const [applyMenuFor, setApplyMenuFor] = createSignal<string | null>(null);
  const [showTools, setShowTools] = createSignal(false);
  const [showModelPicker, setShowModelPicker] = createSignal(false);
  const [lastHandledPendingId, setLastHandledPendingId] = createSignal<
    number | null
  >(null);
  const [thoughtOverride, setThoughtOverride] = createSignal<
    Record<string, "expanded" | "collapsed">
  >({});
  const [streamingThoughtId, setStreamingThoughtId] = createSignal<
    string | null
  >(null);
  const [showHistory, setShowHistory] = createSignal(false);
  const [historyVisible, setHistoryVisible] = createSignal(false);
  const [historySearch, setHistorySearch] = createSignal("");
  const [historyFocusIndex, setHistoryFocusIndex] = createSignal(-1);
  const [availableModels, setAvailableModels] = createSignal<
    GeminiModelOption[]
  >([]);
  const [selectedModel, setSelectedModel] = createSignal(
    AiService.getModel() ?? "",
  );
  const [thinkingLevel, setThinkingLevel] = createSignal<GeminiThinkingLevel>(
    AiService.getThinkingLevel(),
  );
  const [pendingDelete, setPendingDelete] = createSignal<{
    id: string;
    title: string;
  } | null>(null);
  const [errorCopied, setErrorCopied] = createSignal(false);
  const [errorExpanded, setErrorExpanded] = createSignal<
    Record<string, boolean>
  >({});
  const history = useConversationHistory();

  const filteredConversations = createMemo(() => {
    const q = historySearch().trim().toLowerCase();
    const all = history.conversations();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        formatTimestamp(c.updated_at, loadExecutionPreferences().appDateFormat)
          .toLowerCase()
          .includes(q),
    );
  });

  createEffect(() => {
    const list = filteredConversations();
    const idx = historyFocusIndex();
    if (idx >= list.length) setHistoryFocusIndex(list.length - 1);
  });
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let abortRef: AbortController | null = null;
  let toolsButtonRef: HTMLButtonElement | undefined;
  let modelPickerButtonRef: HTMLButtonElement | undefined;
  let historyInputRef: HTMLInputElement | undefined;
  let requestSeq = 0;
  let activeRequestId = 0;
  const abortModes = new WeakMap<
    AbortController,
    "restore-baseline" | "preserve-current"
  >();

  const abortActiveRequest = (
    mode: "restore-baseline" | "preserve-current" = "preserve-current",
    invalidate = false,
  ) => {
    const controller = abortRef;
    if (invalidate) {
      activeRequestId = ++requestSeq;
      setStreamingThoughtId(null);
      setIsLoading(false);
    }
    if (controller && !controller.signal.aborted) {
      abortModes.set(controller, mode);
      controller.abort();
    }
    if (invalidate && abortRef === controller) {
      abortRef = null;
    }
  };

  const openTools = () => {
    setShowModelPicker(false);
    setShowTools((v) => !v);
  };
  const openModelPicker = () => {
    setShowTools(false);
    setShowModelPicker((v) => !v);
  };

  const selectedModelLabel = createMemo(() => {
    const match = availableModels().find((m) => m.id === selectedModel());
    return match?.label ?? selectedModel();
  });

  const portalTarget = createMemo(() =>
    typeof document !== "undefined"
      ? ((document.querySelector(".app-shell") as HTMLElement | null) ??
        document.body)
      : null,
  );

  const openHistory = () => {
    setHistorySearch("");
    setHistoryFocusIndex(-1);
    setShowHistory(true);
    void history.refresh();
    requestAnimationFrame(() => {
      setHistoryVisible(true);
      historyInputRef?.focus();
    });
  };

  const closeHistory = () => {
    setHistoryVisible(false);
    setHistoryFocusIndex(-1);
    setTimeout(() => {
      setShowHistory(false);
      setHistorySearch("");
    }, 200);
  };

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView();
  };

  const refreshAvailableModels = async () => {
    const models = await AiService.listAvailableModels();
    if (models.length === 0) return;
    setAvailableModels(models);
    const stored = AiService.getModel();
    const match = stored ? models.find((m) => m.id === stored) : undefined;
    if (match) {
      setSelectedModel(match.id);
    } else {
      const liteDefault =
        models.find((m) => /flash-lite/.test(m.id)) ?? models[0];
      setSelectedModel(liteDefault.id);
      AiService.setModel(liteDefault.id);
    }
  };

  onMount(() => {
    messagesEndRef?.scrollIntoView();
    void history.restoreActiveFromMessages(messages());
    void refreshAvailableModels();

    const onKeyChanged = () => {
      void refreshAvailableModels();
    };
    window.addEventListener(GEMINI_KEY_CHANGED_EVENT, onKeyChanged);
    onCleanup(() =>
      window.removeEventListener(GEMINI_KEY_CHANGED_EVENT, onKeyChanged),
    );

    requestAnimationFrame(() => {
      inputRef?.focus();
    });
  });

  const handleModelChange = (value: string) => {
    setSelectedModel(value);
    AiService.setModel(value);
  };

  const handleThinkingLevelChange = (level: GeminiThinkingLevel) => {
    setThinkingLevel(level);
    AiService.setThinkingLevel(level);
  };

  createEffect(() => {
    const _msgs = messages();
    scrollToBottom();
  });

  createEffect(() => {
    const _val = input();
    const textarea = inputRef;
    if (!textarea) return;
    textarea.style.height = "auto";
    const newHeight = Math.max(38, Math.min(textarea.scrollHeight, 150));
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflow = newHeight >= 150 ? "auto" : "hidden";
  });

  onCleanup(() => {
    abortActiveRequest("preserve-current", true);
  });

  createEffect(() => {
    const menuFor = applyMenuFor();
    if (menuFor === null) return;
    const close = () => setApplyMenuFor(null);
    document.addEventListener("click", close);
    onCleanup(() => document.removeEventListener("click", close));
  });

  type ChatContentPart =
    | { type: "text"; content: string }
    | { type: "sql"; code: string };

  const splitChatContent = (text: string): ChatContentPart[] => {
    const parts: ChatContentPart[] = [];
    const regex = /```sql\r?\n([\s\S]*?)\r?\n```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: text.slice(lastIndex, match.index),
        });
      }
      parts.push({ type: "sql", code: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push({ type: "text", content: text.slice(lastIndex) });
    }
    if (parts.length === 0) parts.push({ type: "text", content: text });
    return parts;
  };

  const clearComposer = () => {
    setInput("");
    setDraftAttachments([]);
    setPinnedContext([]);
    if (fileInputRef) {
      fileInputRef.value = "";
    }
  };

  const removeDraftAttachment = (id: string) => {
    setDraftAttachments((attachments) =>
      attachments.filter((attachment) => attachment.id !== id),
    );
  };

  const isThoughtExpanded = (id: string): boolean => {
    const override = thoughtOverride()[id];
    if (override === "expanded") return true;
    if (override === "collapsed") return false;
    return streamingThoughtId() === id;
  };

  const toggleThought = (id: string) => {
    const next = isThoughtExpanded(id) ? "collapsed" : "expanded";
    setThoughtOverride((prev) => ({ ...prev, [id]: next }));
  };

  const addAttachments = async (files: File[]) => {
    const availableSlots = MAX_CHAT_ATTACHMENTS - draftAttachments().length;
    if (availableSlots <= 0) {
      setError(
        `You can attach up to ${MAX_CHAT_ATTACHMENTS} files per message.`,
      );
      return;
    }

    const nextFiles = files.slice(0, availableSlots);
    const skipped: string[] = [];
    const nextAttachments: ChatAttachment[] = [];

    for (const file of nextFiles) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      try {
        if (file.type.startsWith("image/")) {
          if (file.size > MAX_CHAT_IMAGE_BYTES) {
            skipped.push(`${file.name} is larger than 8 MB.`);
            continue;
          }

          const dataUrl = await readFileAsDataUrl(file);
          nextAttachments.push({
            id,
            kind: "image",
            name: file.name,
            mimeType: file.type,
            dataUrl,
          });
          continue;
        }

        if (isTextLikeFile(file)) {
          if (file.size > MAX_CHAT_TEXT_ATTACHMENT_BYTES) {
            skipped.push(`${file.name} is larger than 256 KB.`);
            continue;
          }

          const text = await file.text();
          nextAttachments.push({
            id,
            kind: "text",
            name: file.name,
            mimeType: file.type || "text/plain",
            text,
          });
          continue;
        }

        skipped.push(`${file.name} is not a supported image or text file.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        skipped.push(`Failed to read ${file.name}: ${message}`);
      }
    }

    setDraftAttachments((attachments) => [...attachments, ...nextAttachments]);

    if (files.length > availableSlots) {
      skipped.push(
        `Only ${MAX_CHAT_ATTACHMENTS} files can be attached at once.`,
      );
    }

    if (skipped.length > 0) {
      setError(skipped.join(" "));
    }
  };

  const requestAssistantResponse = async (
    chatMessages: ChatMessage[],
    context: ToolExecutionContext,
  ) => {
    abortActiveRequest("preserve-current", true);

    const requestId = ++requestSeq;
    activeRequestId = requestId;
    setError(null);
    setFailedRequest(null);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef = controller;
    abortModes.set(controller, "restore-baseline");

    const baseline = chatMessages;
    const isCurrentRequest = () =>
      activeRequestId === requestId && abortRef === controller;

    const appendDelta = (kind: "thought" | "text", delta: string) => {
      if (!isCurrentRequest()) return;
      setMessages((msgs) => {
        if (!isCurrentRequest()) return msgs;
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant" && last.kind === kind) {
          const updated = { ...last, content: last.content + delta };
          return [...msgs.slice(0, -1), updated];
        }
        const newId = newMsgId();
        if (kind === "thought") {
          setStreamingThoughtId(newId);
          setThoughtOverride((prev) =>
            prev[newId] ? prev : { ...prev, [newId]: "expanded" },
          );
        }
        return [
          ...msgs,
          {
            id: newId,
            role: "assistant",
            kind,
            content: delta,
          } as ChatMessage,
        ];
      });
    };

    try {
      await AiService.chatStream(
        chatMessages,
        context,
        {
          onThoughtDelta: (text) => appendDelta("thought", text),
          onThoughtEnd: () => {
            if (!isCurrentRequest()) return;
            const finishedThoughtId = streamingThoughtId();
            setStreamingThoughtId(null);
            if (finishedThoughtId) {
              setThoughtOverride((prev) => ({
                ...prev,
                [finishedThoughtId]: "collapsed",
              }));
            }
          },
          onTextDelta: (text) => appendDelta("text", text),
          onTextEnd: () => {},
          onToolCall: ({ id, name, args }) => {
            if (!isCurrentRequest()) return;
            setMessages((msgs) => [
              ...msgs,
              {
                id: newMsgId(),
                role: "assistant",
                kind: "tool_call",
                content: "",
                toolCall: { id, name, args, status: "pending" },
              } as ChatMessage,
            ]);
          },
          onToolResult: (id, output, status) => {
            if (!isCurrentRequest()) return;
            setMessages((msgs) =>
              msgs.map((msg) => {
                if (
                  msg.role === "assistant" &&
                  msg.kind === "tool_call" &&
                  msg.toolCall?.id === id
                ) {
                  return {
                    ...msg,
                    toolCall: {
                      ...msg.toolCall,
                      status,
                      result: output,
                    },
                  };
                }
                return msg;
              }),
            );
          },
          onGroundingMetadata: (metadata) => {
            if (!isCurrentRequest()) return;
            setMessages((msgs) => {
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.role === "assistant" && (m.kind ?? "text") === "text") {
                  const updated = { ...m, groundingMetadata: metadata };
                  return [...msgs.slice(0, i), updated, ...msgs.slice(i + 1)];
                }
              }
              return msgs;
            });
          },
        },
        controller.signal,
      );

      if (!isCurrentRequest()) return;

      if (controller.signal.aborted) {
        if (abortModes.get(controller) === "restore-baseline") {
          setMessages(baseline);
          saveMessages(baseline);
        }
        return;
      }

      const finalMessages = messages();
      saveMessages(finalMessages);
      void persistConversation(finalMessages);

      for (let i = finalMessages.length - 1; i >= 0; i--) {
        const msg = finalMessages[i];
        if (msg.role === "assistant" && (msg.kind ?? "text") === "text") {
          void notifyAiResponse(msg.content);
          break;
        }
      }
    } catch (err: any) {
      if (!isCurrentRequest()) return;
      if (err?.name === "AbortError") {
        if (abortModes.get(controller) === "restore-baseline") {
          setMessages(baseline);
          saveMessages(baseline);
        }
        return;
      }
      const parsed = parseGeminiError(err);
      const errorMessage: ChatMessage = {
        id: newMsgId(),
        role: "assistant",
        kind: "error",
        content: parsed.message ?? parsed.raw,
        errorMeta: {
          code: parsed.code,
          status: parsed.status,
          raw: parsed.raw,
        },
      };
      const withError = [...baseline, errorMessage];
      setMessages(withError);
      saveMessages(withError);
      void persistConversation(withError);
      setFailedRequest({ messages: baseline, context });
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
        setStreamingThoughtId(null);
        abortRef = null;
        requestAnimationFrame(() => {
          inputRef?.focus();
        });
      }
    }
  };

  const sendMessage = async (options: {
    content: string;
    references?: ChatReference[];
    resultMessage?: string;
    attachments?: ChatAttachment[];
    contextItems?: ChatMessageContextItem[];
    clearInput?: boolean;
  }) => {
    const hasAttachments = (options.attachments?.length ?? 0) > 0;
    const hasContextItems = (options.contextItems?.length ?? 0) > 0;
    if (
      (!options.content.trim() && !hasAttachments && !hasContextItems) ||
      isLoading()
    )
      return;

    const userMessage: ChatMessage = {
      id: newMsgId(),
      role: "user",
      content: options.content,
      references: options.references,
      attachments: options.attachments,
      contextItems: options.contextItems,
    };
    const newMessages = [...messages(), userMessage];
    const context: ToolExecutionContext = {
      currentCode: props.currentCode,
      resultMessage: options.resultMessage ?? props.currentResultMessage,
      currentDatabase: props.currentDatabase,
    };

    setMessages(newMessages);
    saveMessages(newMessages);
    if (options.clearInput) {
      clearComposer();
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }

    await requestAssistantResponse(newMessages, context);
  };

  const handleRetry = async () => {
    if (isLoading()) return;
    const msgs = messages();
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== "assistant" || last.kind !== "error") return;

    const trimmed = msgs.slice(0, -1);
    setMessages(trimmed);
    saveMessages(trimmed);

    const request = failedRequest();
    const context: ToolExecutionContext = request?.context ?? {
      currentCode: props.currentCode,
      currentDatabase: props.currentDatabase,
      resultMessage: props.currentResultMessage,
    };

    await requestAssistantResponse(trimmed, context);
  };

  const handleSendMessage = async () => {
    const contextItems = pinnedContext();
    const contextItemPayload = contextItems.map((item) => ({
      label: item.label,
      content: item.content,
    }));
    await sendMessage({
      content: input(),
      attachments: draftAttachments(),
      contextItems: contextItemPayload.length > 0 ? contextItemPayload : undefined,
      clearInput: true,
    });
    setPinnedContext([]);
  };

  createEffect(() => {
    const pendingMessage = props.pendingMessage;
    if (!pendingMessage) return;
    if (lastHandledPendingId() === pendingMessage.id) return;

    setLastHandledPendingId(pendingMessage.id);
    props.onPendingMessageHandled?.(pendingMessage.id);

    if (pendingMessage.pinnedContext) {
      const payload = pendingMessage.pinnedContext;
      setPinnedContext((items) =>
        items.some((item) => item.id === payload.id)
          ? items
          : [...items, payload],
      );
    }
    const incomingText = pendingMessage.content?.trim();
    if (incomingText) {
      setInput((current) =>
        current.trim() ? `${current}\n\n${incomingText}` : incomingText,
      );
    }
    requestAnimationFrame(() => {
      inputRef?.focus();
    });
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file instanceof File);

    if (files.length === 0) return;

    e.preventDefault();
    void addAttachments(files);
  };

  const handleFileChange = (e: Event) => {
    const inputElement = e.currentTarget as HTMLInputElement;
    const files = Array.from(inputElement.files ?? []);
    if (files.length === 0) return;
    void addAttachments(files);
  };

  const handleApplyCode = (code: string, mode: ApplyMode) => {
    props.onApplyCode(code, mode);
    setApplyMenuFor(null);
  };

  const persistConversation = async (msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    const id = history.activeId();
    if (id) {
      await history.save(id, msgs);
    } else {
      await history.createNew(msgs);
    }
  };

  const handleNewConversation = async () => {
    abortActiveRequest("preserve-current", true);
    const currentMsgs = messages();
    if (currentMsgs.length > 0) {
      await persistConversation(currentMsgs);
    }
    setMessages([]);
    saveMessages([]);
    setError(null);
    setFailedRequest(null);
    history.setActiveId(null);
    requestAnimationFrame(() => {
      inputRef?.focus();
    });
  };

  const handleLoadConversation = async (id: string) => {
    abortActiveRequest("preserve-current", true);
    closeHistory();
    const loaded = await history.load(id);
    const msgs = ensureIds(loaded);
    setMessages(msgs);
    saveMessages(msgs);
    clearComposer();
    setError(null);
    setFailedRequest(null);
    requestAnimationFrame(() => {
      inputRef?.focus();
    });
  };

  const requestDeleteConversation = (id: string, title: string) => {
    setPendingDelete({ id, title });
  };

  const performDeleteConversation = async (id: string) => {
    const wasActive = history.activeId() === id;
    abortActiveRequest("preserve-current", true);
    await history.remove(id);
    if (wasActive) {
      setMessages([]);
      saveMessages([]);
      setError(null);
      setFailedRequest(null);
      clearComposer();
    }
  };

  const handleResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = props.width;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(
        360,
        Math.min(600, startWidth - (ev.clientX - startX)),
      );
      props.onWidthChange(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const showThinkingSpinner = () => {
    if (!isLoading()) return false;
    const msgs = messages();
    const last = msgs[msgs.length - 1];
    if (!last || last.role === "user") return true;
    if (last.kind === "tool_call" && last.toolCall?.status === "done") {
      return true;
    }
    return false;
  };

  return (
    <div
      class="flex-shrink-0 h-full flex min-h-0"
      style={{ width: `${props.width}px` }}
    >
      <div class="resizer resizer-h" onMouseDown={handleResizeStart} />
      <div class="app-panel flex flex-col flex-1 min-w-0">
        <div class="relative flex-1 min-h-0 flex flex-col">
          <div class="app-panel-header">
            <span class="app-section-title">Chat</span>
            <div class="flex items-center gap-1">
              <Tooltip content="New conversation">
                <button
                  onClick={handleNewConversation}
                  disabled={messages().length === 0}
                  class="control-icon-btn"
                >
                  <Icon name="plus" class="text-s" />
                </button>
              </Tooltip>
              <Tooltip content="Chat history">
                <button onClick={openHistory} class="control-icon-btn">
                  <Icon name="clock-rotate-left" class="text-s" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-3 pb-8 space-y-3">
            <Show when={messages().length === 0}>
              <div class="text-center text-text-muted text-s py-6 px-2">
                <Icon name="lightbulb" class="text-base mb-2 opacity-40" />
                <p>Ask questions or request SQL modifications</p>
              </div>
            </Show>

            <For each={messages()}>
              {(msg) => {
                const msgId = () => msg.id!;
                const isLast = () =>
                  messages()[messages().length - 1]?.id === msg.id;
                const kind = () =>
                  msg.role === "assistant" ? (msg.kind ?? "text") : "user";

                return (
                  <div class="min-w-0">
                    <Show when={kind() === "user"}>
                      <div class="w-full min-w-0 overflow-hidden rounded-md px-2.5 py-1.5 select-text bg-accent/20 text-text border border-border/60">
                        <Show when={msg.references?.length}>
                          <MessageReferenceTags references={msg.references!} />
                        </Show>
                        <Show when={msg.contextItems?.length || msg.attachments?.length}>
                          <div class="mb-2 flex flex-wrap gap-2">
                            <For each={msg.contextItems}>
                              {(item) => (
                                <ChatContextOrAttachmentCard
                                  type="sent-context"
                                  item={item}
                                />
                              )}
                            </For>
                            <For each={msg.attachments}>
                              {(attachment) => (
                                <ChatContextOrAttachmentCard
                                  type="attachment"
                                  item={attachment}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                        <div class="text-s whitespace-pre-wrap [overflow-wrap:anywhere] leading-relaxed">
                          {msg.content}
                        </div>
                      </div>
                    </Show>

                    <Show when={kind() === "error"}>
                      {(() => {
                        const source = msg.errorMeta?.raw ?? msg.content;
                        const parsed = parseGeminiError(source);
                        const code = msg.errorMeta?.code ?? parsed.code;
                        const status = msg.errorMeta?.status ?? parsed.status;
                        const leaf = parsed.message;
                        const rawSource = msg.errorMeta?.raw ?? msg.content;
                        const explanationText = getGeminiErrorExplanation(
                          code,
                          status,
                        );
                        const headerBits: string[] = [];
                        if (code) headerBits.push(`HTTP ${code}`);
                        if (status) headerBits.push(status);
                        const expanded = () => !!errorExpanded()[msgId()];
                        const toggleExpanded = () =>
                          setErrorExpanded((prev) => ({
                            ...prev,
                            [msgId()]: !prev[msgId()],
                          }));
                        const showRaw = !!rawSource && rawSource !== leaf;
                        const copySource = () => {
                          const parts: string[] = [];
                          const header = headerBits.join(" · ");
                          if (header) parts.push(header);
                          if (explanationText) parts.push(explanationText);
                          if (leaf) parts.push(leaf);
                          if (showRaw) parts.push(`Raw:\n${rawSource}`);
                          return parts.join("\n\n");
                        };
                        return (
                          <div class="w-full min-w-0 overflow-hidden rounded-md border border-error/20 bg-error/10 text-error text-s select-text">
                            <div class="flex items-start gap-2 px-2.5 py-1.5">
                              <Icon
                                name="circle-exclamation"
                                class="text-s mt-0.5 flex-shrink-0"
                              />
                              <div class="min-w-0 flex-1 flex flex-col gap-1">
                                <Show when={headerBits.length > 0}>
                                  <div class="flex flex-wrap items-center gap-1.5">
                                    <For each={headerBits}>
                                      {(bit) => (
                                        <span class="rounded-sm border border-error/30 bg-error/15 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide">
                                          {bit}
                                        </span>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                                <Show when={explanationText}>
                                  <div class="whitespace-pre-wrap [overflow-wrap:anywhere]">
                                    {explanationText}
                                  </div>
                                </Show>
                                <Show when={leaf && leaf !== explanationText}>
                                  <div class="whitespace-pre-wrap [overflow-wrap:anywhere] text-error/85">
                                    {leaf}
                                  </div>
                                </Show>
                                <Show when={showRaw}>
                                  <div class="mt-0.5">
                                    <button
                                      type="button"
                                      onClick={toggleExpanded}
                                      class="inline-flex items-center gap-1 text-xs font-medium text-error/80 hover:text-error transition-colors cursor-pointer"
                                    >
                                      <i
                                        class={`fa-solid ${
                                          expanded()
                                            ? "fa-chevron-down"
                                            : "fa-chevron-right"
                                        } text-icon-xs`}
                                      />
                                      <span>
                                        {expanded()
                                          ? "Hide raw error"
                                          : "Show raw error"}
                                      </span>
                                    </button>
                                    <Show when={expanded()}>
                                      <pre class="mt-1 max-h-[240px] overflow-auto rounded-sm border border-error/20 bg-error/5 px-2 py-1.5 text-xs font-mono whitespace-pre-wrap [overflow-wrap:anywhere] text-error/90">
                                        {rawSource}
                                      </pre>
                                    </Show>
                                  </div>
                                </Show>
                              </div>
                            </div>
                            <Show when={isLast() && !isLoading()}>
                              <div class="flex justify-end gap-1 border-t border-error/20 bg-error/5 p-1">
                                <button
                                  onClick={async () => {
                                    try {
                                      await navigator.clipboard.writeText(
                                        copySource(),
                                      );
                                      setErrorCopied(true);
                                      setTimeout(
                                        () => setErrorCopied(false),
                                        1500,
                                      );
                                    } catch {}
                                  }}
                                  class="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-s font-medium text-error transition-colors hover:bg-error/15 cursor-pointer"
                                >
                                  <i
                                    class={`fa-solid ${errorCopied() ? "fa-check" : "fa-copy"} text-icon`}
                                  />
                                  <span>
                                    {errorCopied() ? "Copied" : "Copy error"}
                                  </span>
                                </button>
                                <button
                                  onClick={handleRetry}
                                  disabled={isLoading()}
                                  class="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-s font-medium text-error transition-colors hover:bg-error/15 disabled:opacity-50 disabled:cursor-default cursor-pointer"
                                >
                                  <Icon
                                    name="rotate-right"
                                    class="text-icon"
                                  />
                                  <span>Try again</span>
                                </button>
                              </div>
                            </Show>
                          </div>
                        );
                      })()}
                    </Show>

                    <Show when={kind() === "thought"}>
                      {(() => {
                        const expanded = () => isThoughtExpanded(msgId());
                        const streaming = () =>
                          streamingThoughtId() === msgId();
                        const preview = () => {
                          const line = lastNonEmptyLine(msg.content);
                          return line.length > 140
                            ? line.slice(0, 137) + "…"
                            : line;
                        };
                        return (
                          <CollapsibleRow
                            icon="fa-brain"
                            iconClass={
                              streaming()
                                ? "opacity-90 thought-pulse"
                                : "opacity-70"
                            }
                            label={streaming() ? "Thinking" : "Thought"}
                            preview={preview()}
                            expanded={expanded()}
                            onToggle={() => toggleThought(msgId())}
                          >
                            <div
                              class="chat-markdown-content italic"
                              innerHTML={renderMarkdown(msg.content)}
                            />
                          </CollapsibleRow>
                        );
                      })()}
                    </Show>

                    <Show when={kind() === "tool_call" && msg.toolCall}>
                      {(() => {
                        const tc = msg.toolCall!;
                        const expanded = () =>
                          thoughtOverride()[msgId()] === "expanded";
                        const toggle = () => {
                          const next = expanded() ? "collapsed" : "expanded";
                          setThoughtOverride((prev) => ({
                            ...prev,
                            [msgId()]: next,
                          }));
                        };
                        const statusIcon = () => {
                          if (tc.status === "pending")
                            return "fa-spinner fa-spin text-text-muted";
                          if (tc.status === "error")
                            return "fa-circle-exclamation text-error";
                          return "fa-check text-accent";
                        };
                        const preview = () => {
                          const text = (tc.result ?? "").trim();
                          if (!text) return "";
                          const first =
                            text.split("\n").find((l) => l.trim().length > 0) ??
                            "";
                          return first.length > 140
                            ? first.slice(0, 137) + "…"
                            : first;
                        };
                        const formatArgs = () => {
                          if (!tc.args || Object.keys(tc.args).length === 0)
                            return "";
                          try {
                            return JSON.stringify(tc.args, null, 2);
                          } catch {
                            return String(tc.args);
                          }
                        };
                        return (
                          <CollapsibleRow
                            icon="fa-wrench"
                            label={getToolLabel(tc.name)}
                            preview={preview()}
                            expanded={expanded()}
                            onToggle={toggle}
                            trailing={
                              <i
                                class={`fa-solid ${statusIcon()} text-icon-xs flex-shrink-0`}
                              />
                            }
                          >
                            <div class="space-y-2">
                              <Show when={formatArgs()}>
                                <pre class="text-xs font-mono whitespace-pre-wrap [overflow-wrap:anywhere] m-0">
                                  {formatArgs()}
                                </pre>
                              </Show>
                              <Show when={tc.result}>
                                <pre class="text-xs font-mono whitespace-pre-wrap [overflow-wrap:anywhere] m-0 max-h-[200px] overflow-auto">
                                  {tc.result}
                                </pre>
                              </Show>
                            </div>
                          </CollapsibleRow>
                        );
                      })()}
                    </Show>

                    <Show when={kind() === "text"}>
                      <div class="w-full min-w-0 overflow-hidden rounded-md px-2.5 py-1.5 select-text bg-surface-hover text-text border border-border/60">
                        <div class="text-s leading-relaxed chat-markdown [&>*:first-child]:mt-0">
                          <Show when={msg.toolsUsed}>
                            <ToolsUsedBadge toolsUsed={msg.toolsUsed!} />
                          </Show>
                          <div class="chat-markdown-content">
                            <For each={splitChatContent(msg.content)}>
                              {(part, index) => {
                                const blockKey = () => `${msgId()}::${index()}`;
                                return (
                                  <Show
                                    when={part.type === "sql"}
                                    fallback={
                                      <div
                                        class="chat-md-chunk"
                                        innerHTML={renderMarkdown(
                                          (part as { content: string }).content,
                                        )}
                                      />
                                    }
                                  >
                                    {(() => {
                                      const code = (part as { code: string })
                                        .code;
                                      return (
                                        <div class="chat-sql-block">
                                          <pre class="chat-sql-pre">
                                            <code class="language-sql">
                                              {code}
                                            </code>
                                          </pre>
                                          <div class="chat-sql-actions">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setApplyMenuFor(
                                                  applyMenuFor() === blockKey()
                                                    ? null
                                                    : blockKey(),
                                                );
                                              }}
                                              class="chat-sql-apply"
                                            >
                                              <Icon
                                                name="code"
                                                class="text-icon"
                                              />
                                              <span>Apply to editor</span>
                                              <Icon
                                                name="chevron-down"
                                                class="text-icon-xs opacity-60"
                                              />
                                            </button>
                                            <Show
                                              when={
                                                applyMenuFor() === blockKey()
                                              }
                                            >
                                              <div class="popup-menu absolute left-1 bottom-full mb-1 rounded-lg animate-popover-in">
                                                <button
                                                  onClick={() =>
                                                    handleApplyCode(
                                                      code,
                                                      "append",
                                                    )
                                                  }
                                                  class="popup-menu-item rounded-md mx-1 w-[calc(100%-8px)]"
                                                >
                                                  <Icon
                                                    name="plus"
                                                    class="text-icon w-3 text-center"
                                                  />
                                                  Append to editor
                                                </button>
                                                <button
                                                  onClick={() =>
                                                    handleApplyCode(
                                                      code,
                                                      "replace",
                                                    )
                                                  }
                                                  class="popup-menu-item rounded-md mx-1 w-[calc(100%-8px)]"
                                                >
                                                  <Icon
                                                    name="arrow-right-arrow-left"
                                                    class="text-icon w-3 text-center"
                                                  />
                                                  Replace content
                                                </button>
                                                <button
                                                  onClick={() =>
                                                    handleApplyCode(
                                                      code,
                                                      "new-tab",
                                                    )
                                                  }
                                                  class="popup-menu-item rounded-md mx-1 w-[calc(100%-8px)]"
                                                >
                                                  <Icon
                                                    name="file-circle-plus"
                                                    class="text-icon w-3 text-center"
                                                  />
                                                  Open in new tab
                                                </button>
                                              </div>
                                            </Show>
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </Show>
                                );
                              }}
                            </For>
                          </div>
                          <Show when={msg.groundingMetadata}>
                            <GroundingFooter
                              metadata={msg.groundingMetadata!}
                            />
                          </Show>
                        </div>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>

            <Show when={showThinkingSpinner()}>
              <div class="flex justify-start">
                <div class="bg-surface-hover rounded-md px-2.5 py-1.5">
                  <div class="flex items-center gap-1.5 text-s text-text-muted">
                    <Icon name="spinner" class="fa-spin text-s" />
                    <span>Thinking…</span>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={error()}>
              {(err) => (
                <div class="w-full min-w-0 rounded-md border border-error/20 bg-error/10 text-error px-2.5 py-1.5 text-s select-text">
                  <div class="flex items-start gap-1.5">
                    <Icon
                      name="circle-exclamation"
                      class="text-s mt-0.5 flex-shrink-0"
                    />
                    <div class="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {err()}
                    </div>
                  </div>
                </div>
              )}
            </Show>

            <div ref={messagesEndRef} />
          </div>

          <Show when={showTools() || showModelPicker()}>
            <div
              class="chat-panel-backdrop absolute inset-0 z-30 animate-popover-in cursor-pointer"
              onClick={() => {
                setShowTools(false);
                setShowModelPicker(false);
              }}
            />
          </Show>
        </div>

        <div class="chat-composer-frame relative m-3 mt-0 p-2">
          <Show when={showTools()}>
            <ToolsPopup
              anchorRef={toolsButtonRef!}
              onClose={() => setShowTools(false)}
            />
          </Show>
          <Show when={showModelPicker()}>
            <ModelPickerPopup
              anchorRef={modelPickerButtonRef!}
              models={availableModels()}
              selected={selectedModel()}
              thinkingLevel={thinkingLevel()}
              onSelect={handleModelChange}
              onThinkingLevelChange={handleThinkingLevelChange}
              onClose={() => setShowModelPicker(false)}
            />
          </Show>
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <Show when={pinnedContext().length > 0 || draftAttachments().length > 0}>
                <div class="mb-2 flex flex-wrap gap-2 max-h-[160px] overflow-y-auto pr-1">
                  <For each={pinnedContext()}>
                    {(item) => (
                      <ChatContextOrAttachmentCard
                        type="context"
                        item={item}
                        removable
                        onRemove={() =>
                          setPinnedContext((items) =>
                            items.filter((i) => i.id !== item.id),
                          )
                        }
                      />
                    )}
                  </For>
                  <For each={draftAttachments()}>
                    {(attachment) => (
                      <ChatContextOrAttachmentCard
                        type="attachment"
                        item={attachment}
                        removable
                        onRemove={() => removeDraftAttachment(attachment.id)}
                      />
                    )}
                  </For>
                </div>
              </Show>
              <textarea
                ref={inputRef}
                value={input()}
                onInput={(e) =>
                  setInput((e.target as HTMLTextAreaElement).value)
                }
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask about your SQL, or paste a reference file…"
                disabled={isLoading()}
                rows={1}
                class="w-full bg-surface-header/30 border border-border/30 rounded-lg px-3 py-[9px] text-s leading-[18px] focus:border-accent/40 focus:ring-1 focus:ring-accent/20 outline-none transition-colors resize-none disabled:opacity-50 overflow-hidden"
                style={{ height: "38px", "max-height": "150px" }}
              />
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    class="hidden"
                    onChange={handleFileChange}
                  />
                  <Tooltip content="Upload reference file">
                    <button
                      onClick={() => fileInputRef?.click()}
                      disabled={
                        isLoading() ||
                        draftAttachments().length >= MAX_CHAT_ATTACHMENTS
                      }
                      class="btn btn-secondary btn-compact"
                    >
                      <Icon name="paperclip" class="text-icon" />
                      <span>Reference</span>
                    </button>
                  </Tooltip>
                  <Tooltip content="Configure tools">
                    <button
                      ref={toolsButtonRef}
                      onClick={openTools}
                      class={`btn btn-secondary btn-compact ${
                        showTools() ? "btn-toggled" : ""
                      }`}
                      disabled={isLoading()}
                    >
                      <Icon name="wrench" class="text-icon" />
                      <span>Tools</span>
                    </button>
                  </Tooltip>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <Show when={availableModels().length > 0}>
                    <Tooltip content="Select AI model">
                      <button
                        ref={modelPickerButtonRef}
                        onClick={openModelPicker}
                        class={`btn btn-secondary btn-compact ${
                          showModelPicker() ? "btn-toggled" : ""
                        }`}
                        disabled={isLoading()}
                      >
                        <i
                          class={`fa-solid ${getModelIcon(selectedModel())} text-icon`}
                        />
                        <span class="truncate max-w-[120px]">
                          {selectedModelLabel()}
                        </span>
                      </button>
                    </Tooltip>
                  </Show>
                </div>
              </div>
            </div>
            <Show
              when={isLoading()}
              fallback={
                <Tooltip content="Send" placement="left">
                  <button
                    onClick={handleSendMessage}
                    disabled={
                      !input().trim() &&
                      draftAttachments().length === 0 &&
                      pinnedContext().length === 0
                    }
                    aria-label="Send message"
                    class="chat-send-btn"
                  >
                    <Icon name="paper-plane" class="text-s" />
                  </button>
                </Tooltip>
              }
            >
              <Tooltip content="Stop generating" placement="left">
                <button
                  onClick={() => abortActiveRequest("restore-baseline")}
                  aria-label="Stop generating"
                  class="chat-send-btn chat-stop-btn"
                >
                  <Icon name="stop" class="text-s" />
                </button>
              </Tooltip>
            </Show>
          </div>
        </div>
      </div>

      <Show when={showHistory() && portalTarget()}>
        <Portal mount={portalTarget()!}>
          <DialogShell
            visible={historyVisible()}
            onClose={closeHistory}
            overlayClass="items-start !pt-12"
            class="mx-4 flex w-full max-w-[36rem] flex-col shadow-2xl"
            ariaLabel="Chat history"
          >
            <div class="flex h-full w-full flex-col">
                <div class="px-2 py-2">
                  <div class="relative flex items-center">
                    <Icon
                      name="clock-rotate-left"
                      class="pointer-events-none absolute left-4 text-text-muted"
                    />
                    <input
                      ref={historyInputRef}
                      value={historySearch()}
                      onInput={(e) => {
                        setHistorySearch((e.target as HTMLInputElement).value);
                        setHistoryFocusIndex(-1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          closeHistory();
                          return;
                        }
                        const list = filteredConversations();
                        if (list.length === 0) return;
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setHistoryFocusIndex((i) =>
                            Math.min(i + 1, list.length - 1),
                          );
                          return;
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setHistoryFocusIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const idx = historyFocusIndex();
                          if (idx >= 0 && idx < list.length)
                            void handleLoadConversation(list[idx].id);
                          return;
                        }
                        if (e.key === "Delete") {
                          const idx = historyFocusIndex();
                          if (idx >= 0 && idx < list.length) {
                            const conv = list[idx];
                            requestDeleteConversation(conv.id, conv.title);
                          }
                          return;
                        }
                      }}
                      placeholder="Search conversations…"
                      spellcheck={false}
                      class="h-12 w-full bg-transparent pl-11 pr-4 text-base text-text placeholder-text-muted outline-none"
                    />
                  </div>
                </div>

                <div class="max-h-[58vh] overflow-y-auto p-2 space-y-1">
                  <Show when={filteredConversations().length === 0}>
                    <div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center text-text-muted">
                      <Icon name="comments" class="text-2xl opacity-40" />
                      <p class="text-m">
                        {historySearch().trim()
                          ? "No matching conversations"
                          : "No conversations yet"}
                      </p>
                    </div>
                  </Show>
                  <For each={filteredConversations()}>
                    {(conv, index) => {
                      const formatDate = (ts: number) =>
                        formatTimestamp(
                          ts,
                          loadExecutionPreferences().appDateFormat,
                        );
                      const isActive = () => history.activeId() === conv.id;
                      const isFocused = () => historyFocusIndex() === index();
                      return (
                        <div
                          class={`rounded-xl border transition-colors duration-200 ${
                            isFocused() || isActive()
                              ? "border-border/60 bg-surface-active/60"
                              : "border-transparent bg-transparent hover:border-border/40 hover:bg-surface-hover/60"
                          }`}
                        >
                          <div class="flex items-center gap-2 p-1.5 pr-4">
                            <button
                              type="button"
                              class="min-w-0 flex-1 cursor-pointer rounded-lg px-3 py-2.5 text-left transition-colors"
                              onClick={() =>
                                void handleLoadConversation(conv.id)
                              }
                            >
                              <div class="truncate text-m font-semibold text-text">
                                {conv.title}
                              </div>
                              <div class="mt-0.5 text-s text-text-muted truncate">
                                {timeAgo(conv.updated_at)} ·{" "}
                                {formatDate(conv.updated_at)}
                              </div>
                            </button>
                            <Tooltip content="Delete">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteConversation(
                                    conv.id,
                                    conv.title,
                                  );
                                }}
                                class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm border border-border/50 bg-surface-header text-text-muted transition-colors hover:border-error/40 hover:bg-error/10 hover:text-error cursor-pointer"
                              >
                                <Icon name="trash" class="text-[10px]" />
                              </button>
                            </Tooltip>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
                <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border/50 px-4 py-2 text-[11px] text-text-muted">
                  <span>
                    <kbd class="font-sans">↑↓</kbd> navigate
                  </span>
                  <span>
                    <kbd class="font-sans">↵</kbd> open
                  </span>
                  <span>
                    <kbd class="font-sans">del</kbd> delete
                  </span>
                  <span>
                    <kbd class="font-sans">esc</kbd> close
                  </span>
                </div>
            </div>
          </DialogShell>
        </Portal>
      </Show>

      <Show when={pendingDelete() && portalTarget()}>
        <Portal mount={portalTarget()!}>
          {(() => {
            const target = pendingDelete()!;
            return (
              <ConfirmDialog
                title="Delete conversation?"
                message={`"${target.title}" will be permanently removed${
                  history.activeId() === target.id
                    ? " and the current chat will be cleared"
                    : ""
                }. This cannot be undone.`}
                confirmLabel="Delete"
                variant="danger"
                onConfirm={() => {
                  setPendingDelete(null);
                  void performDeleteConversation(target.id);
                }}
                onCancel={() => setPendingDelete(null)}
              />
            );
          })()}
        </Portal>
      </Show>
    </div>
  );
}
