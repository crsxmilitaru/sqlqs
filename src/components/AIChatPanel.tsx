import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { marked } from "marked";
import { AiService, type ChatMessage } from "../lib/ai";
import { getToolLabel, type ToolExecutionContext } from "../lib/ai-tools";
import ToolsPopup from "./ToolsPopup";
import Tooltip from "./Tooltip";

marked.setOptions({ breaks: true, gfm: true });

const CHAT_STORAGE_KEY = "sqlqs_chat_history";

function loadMessages(): ChatMessage[] {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: ChatMessage[]) {
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(msgs));
}

export type ApplyMode = "append" | "replace" | "new-tab";

function ToolsUsedBadge(props: { toolsUsed: string[] }) {
  return (
    <Show when={props.toolsUsed.length > 0}>
      <div class="flex items-center gap-1.5 flex-wrap mb-1.5 focus:outline-none">
        <For each={props.toolsUsed}>
          {(name) => (
            <span
              class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent text-accent-text text-s font-semibold"
            >
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
  onApplyCode: (code: string, mode: ApplyMode) => void;
  width: number;
  onWidthChange: (width: number) => void;
}

export default function AIChatPanel(props: Props) {
  const [messages, setMessages] = createSignal<ChatMessage[]>(loadMessages());
  const [input, setInput] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [applyMenuFor, setApplyMenuFor] = createSignal<number | null>(null);
  const [showTools, setShowTools] = createSignal(false);
  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
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

  const handleSendMessage = async () => {
    if (!input().trim() || isLoading()) return;

    const userMessage: ChatMessage = { role: "user", content: input().trim() };
    const newMessages = [...messages(), userMessage];
    setMessages(newMessages);
    saveMessages(newMessages);
    setInput("");
    setError(null);
    setIsLoading(true);

    abortRef?.abort();
    const controller = new AbortController();
    abortRef = controller;

    try {
      const context: ToolExecutionContext = {
        currentCode: props.currentCode,
        currentDatabase: props.currentDatabase,
      };

      const { text, toolsUsed } = await AiService.chat(
        newMessages,
        context,
        controller.signal,
      );

      if (controller.signal.aborted) return;

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: text,
        toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
      };
      const updated = [...newMessages, assistantMessage];
      setMessages(updated);
      saveMessages(updated);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to get response");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
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
    setError(null);
  };

  const handleResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = props.width;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(250, Math.min(600, startWidth - (ev.clientX - startX)));
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
    <div class="flex-shrink-0 h-full flex py-3 pr-3 pl-3 gap-1" style={{ width: `${props.width}px` }}>
      <div
        class="resizer resizer-h"
        onMouseDown={handleResizeStart}
      />
      <div class="flex flex-col flex-1 min-w-0 bg-surface-panel border border-border rounded-xl overflow-hidden">
        <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-header/50">
          <span class="text-s font-semibold text-text-muted uppercase tracking-wide">Chat</span>
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
            {(msg, idx) => (
              <div>
                <div
                  class={`w-full rounded-md px-2.5 py-1.5 select-text ${msg.role === "user"
                    ? "bg-accent/20 text-text"
                    : "bg-surface-hover text-text"
                    }`}
                >
                  <Show when={msg.role === "assistant"} fallback={
                    <div class="text-s whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
                  }>
                    <div class="text-s leading-relaxed chat-markdown [&>*:first-child]:mt-0">
                      <Show when={msg.toolsUsed}>
                        <ToolsUsedBadge toolsUsed={msg.toolsUsed!} />
                      </Show>
                      <div class="chat-markdown-content" innerHTML={marked.parse(msg.content) as string} />
                      <Show when={countSqlBlocks(msg.content) === 1}>
                        <div class="relative mt-2">
                          <div class="flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); setApplyMenuFor(applyMenuFor() === idx() ? null : idx()); }}
                              class="btn btn-primary text-s !h-auto !py-2 !flex !items-center !gap-1.5"
                            >
                              <i class="fa-solid fa-code !text-s !w-auto !h-auto !flex-none" />
                              <span class="pb-[2px]">Apply to editor</span>
                              <i class="fa-solid fa-chevron-down !text-icon-xs !w-auto !h-auto !flex-none ml-1 opacity-60" />
                            </button>
                          </div>
                          <Show when={applyMenuFor() === idx()}>
                            <div class="popup-menu absolute left-0 bottom-full mb-1">
                              <button
                                onClick={() => handleApplyCode(msg.content, "append")}
                                class="popup-menu-item"
                              >
                                <i class="fa-solid fa-plus text-icon w-3 text-center" />
                                Append to editor
                              </button>
                              <button
                                onClick={() => handleApplyCode(msg.content, "replace")}
                                class="popup-menu-item"
                              >
                                <i class="fa-solid fa-arrow-right-arrow-left text-icon w-3 text-center" />
                                Replace content
                              </button>
                              <button
                                onClick={() => handleApplyCode(msg.content, "new-tab")}
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
            )}
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
                <div class="bg-error/10 border border-error/20 text-error rounded-md px-2.5 py-1.5 text-s flex items-center gap-1.5 select-text">
                  <i class="fa-solid fa-circle-exclamation text-s" />
                  <span>{err()}</span>
                </div>
              </div>
            )}
          </Show>

          <div ref={messagesEndRef} />
        </div>

        <div class="border-t border-border p-3 bg-surface-header/30">
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0 flex flex-col gap-1.5">
              <textarea
                ref={inputRef}
                value={input()}
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your SQL..."
                disabled={isLoading()}
                rows={1}
                class="w-full bg-surface-panel border border-border rounded-lg px-3 py-[9px] text-s leading-[18px] focus:border-accent/40 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none disabled:opacity-50 overflow-hidden"
                style={{ height: "38px", "max-height": "150px" }}
              />
              <div class="flex items-center justify-between">
                <div class="relative">
                  <Tooltip content="Configure tools">
                    <button
                      ref={toolsButtonRef}
                      onClick={() => setShowTools(!showTools())}
                      class={`flex items-center gap-1.5 px-2 py-1 rounded-md text-s transition-colors cursor-pointer ${showTools()
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
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!input().trim() || isLoading()}
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
