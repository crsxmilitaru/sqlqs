import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { marked } from "marked";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  AiService,
  type ChatAttachment,
  type ChatImageAttachment,
  type ChatMessage,
  type ChatReference,
  type ChatTextAttachment,
} from "../../lib/ai";
import { getToolLabel, type ToolExecutionContext } from "../../lib/ai-tools";
import { loadAiNotifications } from "../../lib/settings";
import ToolsPopup from "./ToolsPopup";
import Tooltip from "../ui/Tooltip";

marked.setOptions({ breaks: true, gfm: true });

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
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: ChatMessage[]) {
  // Strip heavy payloads (image data URLs, full text bodies) before persisting,
  // but keep enough metadata so reloaded messages still show an attachment chip.
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

export interface PendingChatMessage {
  id: number;
  content: string;
  references?: ChatReference[];
  selectedCode?: string;
  resultError?: string;
}

interface FailedChatRequest {
  messages: ChatMessage[];
  context: ToolExecutionContext;
}

function ToolsUsedBadge(props: { toolsUsed: string[] }) {
  return (
    <Show when={props.toolsUsed.length > 0}>
      <div class="flex items-center gap-1.5 flex-wrap mb-1.5 focus:outline-none">
        <For each={props.toolsUsed}>
          {(name) => (
            <span class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent text-accent-text text-s font-semibold">
              <i class="fa-solid fa-wrench text-icon opacity-80" />
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
  currentResultError?: string;
  onApplyCode: (code: string, mode: ApplyMode) => void;
  width: number;
  onWidthChange: (width: number) => void;
  pendingMessage?: PendingChatMessage | null;
  onPendingMessageHandled?: (id: number) => void;
}

function MessageReferenceTags(props: { references: ChatReference[] }) {
  return (
    <div class="mb-1 flex items-center gap-1.5 flex-wrap">
      <For each={props.references}>
        {(reference) => (
          <span class="rounded-full border border-border/70 bg-surface-panel/70 px-2 py-0.5 text-3xs font-semibold tracking-wide text-text-muted">
            ({reference})
          </span>
        )}
      </For>
    </div>
  );
}

function ChatAttachmentGrid(props: {
  attachments: ChatAttachment[];
  removable?: boolean;
  onRemove?: (id: string) => void;
}) {
  return (
    <div class="mb-2 flex flex-wrap gap-2">
      <For each={props.attachments}>
        {(attachment) => (
          <div
            class={`relative overflow-hidden rounded-lg border border-border/70 bg-surface-panel/60 ${
              attachment.kind === "image"
                ? "h-20 w-20"
                : "flex min-h-20 w-[180px] items-start gap-2 p-3"
            }`}
          >
            <Show
              when={attachment.kind === "image"}
              fallback={
                <>
                  <div class="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-md bg-surface-hover text-text-muted">
                    <i class="fa-solid fa-file-lines text-s" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-s font-medium text-text">
                      {attachment.name}
                    </div>
                    <Show
                      when={(attachment as ChatTextAttachment).text}
                      fallback={
                        <div class="mt-1 text-3xs italic text-text-muted">
                          Content not retained after reload
                        </div>
                      }
                    >
                      <div class="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-3xs text-text-muted">
                        {(attachment as ChatTextAttachment).text}
                      </div>
                    </Show>
                  </div>
                </>
              }
            >
              <Show
                when={(attachment as ChatImageAttachment).dataUrl}
                fallback={
                  <div
                    class="flex h-full w-full flex-col items-center justify-center gap-1 bg-surface-hover text-text-muted"
                    title={`${attachment.name} — content not retained after reload`}
                  >
                    <i class="fa-solid fa-image text-l" />
                    <span class="px-1 text-[9px] truncate max-w-full">
                      {attachment.name}
                    </span>
                  </div>
                }
              >
                <img
                  src={(attachment as ChatImageAttachment).dataUrl}
                  alt={attachment.name}
                  class="h-full w-full object-cover"
                />
              </Show>
            </Show>
            <Show when={props.removable}>
              <button
                onClick={() => props.onRemove?.(attachment.id)}
                class="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                title="Remove attachment"
              >
                <i class="fa-solid fa-xmark text-[10px]" />
              </button>
            </Show>
          </div>
        )}
      </For>
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
    const body = trimmed.length > 140 ? `${trimmed.slice(0, 137)}...` : trimmed;
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
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [failedRequest, setFailedRequest] =
    createSignal<FailedChatRequest | null>(null);
  const [applyMenuFor, setApplyMenuFor] = createSignal<number | null>(null);
  const [showTools, setShowTools] = createSignal(false);
  const [lastHandledPendingId, setLastHandledPendingId] = createSignal<
    number | null
  >(null);
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let abortRef: AbortController | null = null;
  let toolsButtonRef: HTMLButtonElement | undefined;

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  };

  onMount(() => {
    messagesEndRef?.scrollIntoView();
  });

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
    abortRef?.abort();
  });

  createEffect(() => {
    const menuFor = applyMenuFor();
    if (menuFor === null) return;
    const close = () => setApplyMenuFor(null);
    document.addEventListener("click", close);
    onCleanup(() => document.removeEventListener("click", close));
  });

  const countSqlBlocks = (text: string): number => {
    return (text.match(/```sql\n[\s\S]*?\n```/g) || []).length;
  };

  const extractSqlCode = (text: string): string | null => {
    const sqlMatch = text.match(/```sql\n([\s\S]*?)\n```/);
    return sqlMatch ? sqlMatch[1].trim() : null;
  };

  const clearComposer = () => {
    setInput("");
    setDraftAttachments([]);
    if (fileInputRef) {
      fileInputRef.value = "";
    }
  };

  const removeDraftAttachment = (id: string) => {
    setDraftAttachments((attachments) =>
      attachments.filter((attachment) => attachment.id !== id),
    );
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
    setError(null);
    setFailedRequest(null);
    setIsLoading(true);

    abortRef?.abort();
    const controller = new AbortController();
    abortRef = controller;

    try {
      const { text, toolsUsed } = await AiService.chat(
        chatMessages,
        context,
        controller.signal,
      );

      if (controller.signal.aborted) return;

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: text,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      };
      const updated = [...chatMessages, assistantMessage];
      setMessages(updated);
      saveMessages(updated);
      void notifyAiResponse(text);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to get response");
      setFailedRequest({ messages: chatMessages, context });
    } finally {
      setIsLoading(false);
    }
  };

  const sendMessage = async (options: {
    content: string;
    references?: ChatReference[];
    selectedCode?: string;
    resultError?: string;
    attachments?: ChatAttachment[];
    clearInput?: boolean;
  }) => {
    const hasAttachments = (options.attachments?.length ?? 0) > 0;
    if ((!options.content.trim() && !hasAttachments) || isLoading()) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: options.content,
      references: options.references,
      attachments: options.attachments,
    };
    const newMessages = [...messages(), userMessage];
    const context: ToolExecutionContext = {
      currentCode: props.currentCode,
      selectedCode: options.selectedCode,
      resultError: options.resultError ?? props.currentResultError,
      currentDatabase: props.currentDatabase,
    };

    setMessages(newMessages);
    saveMessages(newMessages);
    if (options.clearInput) {
      clearComposer();
    }

    await requestAssistantResponse(newMessages, context);
  };

  const handleRetry = async () => {
    const request = failedRequest();
    if (!request || isLoading()) return;
    await requestAssistantResponse(request.messages, request.context);
  };

  const handleSendMessage = async () => {
    await sendMessage({
      content: input(),
      references: ["editor"],
      attachments: draftAttachments(),
      clearInput: true,
    });
  };

  createEffect(() => {
    const pendingMessage = props.pendingMessage;
    if (!pendingMessage || isLoading()) return;
    if (lastHandledPendingId() === pendingMessage.id) return;

    setLastHandledPendingId(pendingMessage.id);
    props.onPendingMessageHandled?.(pendingMessage.id);
    void sendMessage({
      content: pendingMessage.content,
      references: pendingMessage.references ?? (["editor"] as ChatReference[]),
      selectedCode: pendingMessage.selectedCode,
      resultError: pendingMessage.resultError,
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

  const handleApplyCode = (messageContent: string, mode: ApplyMode) => {
    const code = extractSqlCode(messageContent);
    if (code) {
      props.onApplyCode(code, mode);
      setApplyMenuFor(null);
    }
  };

  const handleClear = () => {
    setMessages([]);
    saveMessages([]);
    clearComposer();
    setError(null);
    setFailedRequest(null);
  };

  const handleResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = props.width;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(
        250,
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

  return (
    <div
      class="flex-shrink-0 h-full flex py-3 pr-3 pl-3 gap-1"
      style={{ width: `${props.width}px` }}
    >
      <div class="resizer resizer-h" onMouseDown={handleResizeStart} />
      <div class="flex flex-col flex-1 min-w-0 bg-surface-panel border border-border rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-header/50">
          <span class="text-s font-semibold text-text-muted uppercase tracking-wide">
            Chat
          </span>
          <Show when={messages().length > 0}>
            <Tooltip content="Clear Chat">
              <button
                onClick={handleClear}
                disabled={isLoading()}
                class="w-7 h-7 flex items-center justify-center rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors disabled:opacity-30 cursor-pointer"
              >
                <i class="fa-solid fa-trash text-s" />
              </button>
            </Tooltip>
          </Show>
        </div>

        <div class="flex-1 overflow-y-auto p-3 space-y-3">
          <Show when={messages().length === 0}>
            <div class="text-center text-text-muted text-s py-6 px-2">
              <i class="fa-solid fa-lightbulb text-base mb-2 opacity-40" />
              <p>Ask questions or request SQL modifications</p>
            </div>
          </Show>

          <For each={messages()}>
            {(msg) => {
              const msgIndex = () => messages().indexOf(msg);
              return (
                <div>
                  <div
                    class={`w-full rounded-md px-2.5 py-1.5 select-text ${
                      msg.role === "user"
                        ? "bg-accent/20 text-text"
                        : "bg-surface-hover text-text"
                    }`}
                  >
                    <Show
                      when={msg.role === "assistant"}
                      fallback={
                        <div>
                          <Show when={msg.references?.length}>
                            <MessageReferenceTags
                              references={msg.references!}
                            />
                          </Show>
                          <Show when={msg.attachments?.length}>
                            <ChatAttachmentGrid
                              attachments={msg.attachments!}
                            />
                          </Show>
                          <div class="text-s whitespace-pre-wrap break-words leading-relaxed">
                            {msg.content}
                          </div>
                        </div>
                      }
                    >
                      <div class="text-s leading-relaxed chat-markdown [&>*:first-child]:mt-0">
                        <Show when={msg.toolsUsed}>
                          <ToolsUsedBadge toolsUsed={msg.toolsUsed!} />
                        </Show>
                        <div
                          class="chat-markdown-content"
                          innerHTML={marked.parse(msg.content) as string}
                        />
                        <Show when={countSqlBlocks(msg.content) === 1}>
                          <div class="relative mt-2">
                            <div class="flex items-center gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const i = msgIndex();
                                  setApplyMenuFor(
                                    applyMenuFor() === i ? null : i,
                                  );
                                }}
                                class="btn btn-primary text-s !h-auto !py-2 !flex !items-center !gap-1.5"
                              >
                                <i class="fa-solid fa-code !text-s !w-auto !h-auto !flex-none" />
                                <span class="pb-[2px]">Apply to editor</span>
                                <i class="fa-solid fa-chevron-down !text-icon-xs !w-auto !h-auto !flex-none ml-1 opacity-60" />
                              </button>
                            </div>
                            <Show when={applyMenuFor() === msgIndex()}>
                              <div class="popup-menu absolute left-0 bottom-full mb-1">
                                <button
                                  onClick={() =>
                                    handleApplyCode(msg.content, "append")
                                  }
                                  class="popup-menu-item"
                                >
                                  <i class="fa-solid fa-plus text-icon w-3 text-center" />
                                  Append to editor
                                </button>
                                <button
                                  onClick={() =>
                                    handleApplyCode(msg.content, "replace")
                                  }
                                  class="popup-menu-item"
                                >
                                  <i class="fa-solid fa-arrow-right-arrow-left text-icon w-3 text-center" />
                                  Replace content
                                </button>
                                <button
                                  onClick={() =>
                                    handleApplyCode(msg.content, "new-tab")
                                  }
                                  class="popup-menu-item"
                                >
                                  <i class="fa-solid fa-file-circle-plus text-icon w-3 text-center" />
                                  Open in new tab
                                </button>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </div>
                </div>
              );
            }}
          </For>

          <Show when={isLoading()}>
            <div class="flex justify-start">
              <div class="bg-surface-hover rounded-md px-2.5 py-1.5">
                <div class="flex items-center gap-1.5 text-s text-text-muted">
                  <i class="fa-solid fa-spinner fa-spin text-s" />
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          </Show>

          <Show when={error()}>
            {(err) => (
              <div class="flex justify-center">
                <div class="bg-error/10 border border-error/20 text-error rounded-md px-2.5 py-1.5 text-s select-text">
                  <div class="flex items-start gap-1.5">
                    <i class="fa-solid fa-circle-exclamation text-s mt-0.5" />
                    <span class="min-w-0 break-words">{err()}</span>
                  </div>
                  <Show when={failedRequest()}>
                    <div class="mt-2 flex justify-end">
                      <button
                        onClick={handleRetry}
                        disabled={isLoading()}
                        class="flex items-center gap-1.5 rounded-md border border-error/25 bg-error/10 px-2 py-1 text-s font-semibold text-error transition-colors hover:bg-error/15 disabled:opacity-50 disabled:cursor-default cursor-pointer"
                      >
                        <i class="fa-solid fa-rotate-right text-icon" />
                        <span>Try again</span>
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <div ref={messagesEndRef} />
        </div>

        <div class="border-t border-border p-3 bg-surface-header/30">
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <Show when={draftAttachments().length > 0}>
                <ChatAttachmentGrid
                  attachments={draftAttachments()}
                  removable
                  onRemove={removeDraftAttachment}
                />
              </Show>
              <textarea
                ref={inputRef}
                value={input()}
                onInput={(e) =>
                  setInput((e.target as HTMLTextAreaElement).value)
                }
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask about your SQL, or paste a reference file..."
                disabled={isLoading()}
                rows={1}
                class="w-full bg-surface-panel border border-border rounded-lg px-3 py-[9px] text-s leading-[18px] focus:border-accent/40 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none disabled:opacity-50 overflow-hidden"
                style={{ height: "38px", "max-height": "150px" }}
              />
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
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
                      class="flex items-center gap-1.5 px-2 py-1 rounded-md text-s transition-colors cursor-pointer text-text-muted hover:text-text hover:bg-surface-hover disabled:opacity-40 disabled:cursor-default"
                    >
                      <i class="fa-solid fa-paperclip text-icon" />
                      <span>Reference</span>
                    </button>
                  </Tooltip>
                  <div class="relative">
                    <Tooltip content="Configure tools">
                      <button
                        ref={toolsButtonRef}
                        onClick={() => setShowTools(!showTools())}
                        class={`flex items-center gap-1.5 px-2 py-1 rounded-md text-s transition-colors cursor-pointer ${
                          showTools()
                            ? "text-accent bg-accent/10"
                            : "text-text-muted hover:text-text hover:bg-surface-hover"
                        }`}
                      >
                        <i class="fa-solid fa-wrench text-icon" />
                        <span>Tools</span>
                      </button>
                    </Tooltip>
                    <Show when={showTools()}>
                      <ToolsPopup
                        anchorRef={toolsButtonRef!}
                        onClose={() => setShowTools(false)}
                      />
                    </Show>
                  </div>
                </div>
                <Show when={draftAttachments().length > 0}>
                  <span class="text-3xs text-text-muted">
                    {draftAttachments().length}/{MAX_CHAT_ATTACHMENTS} file
                    {draftAttachments().length === 1 ? "" : "s"}
                  </span>
                </Show>
              </div>
            </div>
            <button
              onClick={handleSendMessage}
              disabled={
                (!input().trim() && draftAttachments().length === 0) ||
                isLoading()
              }
              class="mt-[6px] w-[26px] h-[26px] flex-shrink-0 flex items-center justify-center rounded-md bg-accent text-accent-text hover:bg-accent-hover transition-all active:scale-95 disabled:bg-surface-hover disabled:text-text-muted disabled:shadow-none disabled:cursor-default cursor-pointer"
            >
              <i class="fa-solid fa-paper-plane text-s" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
