import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { AiService, type ChatMessage } from "../lib/ai";
import { getToolLabel, type ToolExecutionContext } from "../lib/ai-tools";
import ToolsPopup from "./ToolsPopup";
import Tooltip from "./Tooltip";

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

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    const text = preRef.current?.textContent || "";
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-1.5 group/code relative">
      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="w-6 h-6 flex items-center justify-center rounded bg-overlay-sm hover:bg-overlay-lg text-text-muted hover:text-text transition-colors cursor-pointer"
        >
          <i className={`fa-solid ${copied ? "fa-check text-success" : "fa-copy"} text-s`} />
        </button>
      </div>
      <pre
        ref={preRef}
        className={`bg-black/30 rounded p-2 text-s text-left select-text ${open ? "overflow-x-auto" : "max-h-[3.2em] overflow-hidden"}`}
      >
        {children}
      </pre>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center gap-1.5 text-s text-text-muted hover:text-text mt-0.5 w-full cursor-pointer"
      >
        <i className={`fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"} text-icon-xxs`} />
        <span>{open ? "Show less" : "Show more"}</span>
      </button>
    </div>
  );
}

function ToolsUsedBadge({ toolsUsed }: { toolsUsed: string[] }) {
  if (toolsUsed.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-1.5 focus:outline-none">
      {toolsUsed.map((name) => (
        <span
          key={name}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent text-accent-text text-s font-semibold"
        >
          <i className="fa-solid fa-wrench text-icon opacity-80" />
          {getToolLabel(name)}
        </span>
      ))}
    </div>
  );
}

interface Props {
  currentCode: string;
  currentDatabase?: string;
  onApplyCode: (code: string, mode: ApplyMode) => void;
  width: number;
  onWidthChange: (width: number) => void;
}

export default function AIChatPanel({
  currentCode,
  currentDatabase,
  onApplyCode,
  width,
  onWidthChange,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyMenuFor, setApplyMenuFor] = useState<number | null>(null);
  const [showTools, setShowTools] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toolsButtonRef = useRef<HTMLButtonElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const newHeight = Math.max(38, Math.min(textarea.scrollHeight, 150));
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflow = newHeight >= 150 ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (applyMenuFor === null) return;
    const close = () => setApplyMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [applyMenuFor]);

  const countSqlBlocks = (text: string): number => {
    return (text.match(/```sql\n[\s\S]*?\n```/g) || []).length;
  };

  const extractSqlCode = (text: string): string | null => {
    const sqlMatch = text.match(/```sql\n([\s\S]*?)\n```/);
    return sqlMatch ? sqlMatch[1].trim() : null;
  };

  const handleSendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    saveMessages(newMessages);
    setInput("");
    setError(null);
    setIsLoading(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const context: ToolExecutionContext = {
        currentCode,
        currentDatabase,
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
  }, [input, isLoading, messages, currentCode, currentDatabase]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApplyCode = (messageContent: string, mode: ApplyMode) => {
    const code = extractSqlCode(messageContent);
    if (code) {
      onApplyCode(code, mode);
      setApplyMenuFor(null);
    }
  };

  const handleClear = () => {
    setMessages([]);
    saveMessages([]);
    setError(null);
  };

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMove = (ev: MouseEvent) => {
        const newWidth = Math.max(250, Math.min(600, startWidth - (ev.clientX - startX)));
        onWidthChange(newWidth);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [width, onWidthChange],
  );

  return (
    <div className="flex-shrink-0 h-full flex py-3 pr-3 pl-3 gap-1" style={{ width: width }}>
      <div
        className="resizer resizer-h"
        onMouseDown={handleResizeStart}
      />
      <div className="flex flex-col flex-1 min-w-0 bg-surface-panel border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-header/50">
          <span className="text-s font-semibold text-text-muted uppercase tracking-wide">Chat</span>
          {messages.length > 0 && (
            <Tooltip content="Clear Chat">
              <button
                onClick={handleClear}
                disabled={isLoading}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors disabled:opacity-30 cursor-pointer"
              >
                <i className="fa-solid fa-trash text-s" />
              </button>
            </Tooltip>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-text-muted text-s py-6 px-2">
              <i className="fa-solid fa-lightbulb text-base mb-2 opacity-40" />
              <p>Ask questions or request SQL modifications</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx}>
              <div
                className={`w-full rounded-md px-2.5 py-1.5 select-text ${msg.role === "user"
                  ? "bg-accent/20 text-text"
                  : "bg-surface-hover text-text"
                  }`}
              >
                {msg.role === "assistant" ? (
                  <div className="text-s leading-relaxed chat-markdown [&>*:first-child]:mt-0">
                    {msg.toolsUsed && <ToolsUsedBadge toolsUsed={msg.toolsUsed} />}
                    <Markdown
                      components={{
                        pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                        code: ({ children, className }) => {
                          const isBlock = className?.includes("language-");
                          return isBlock ? (
                            <code className="text-text select-text">{children}</code>
                          ) : (
                            <code className="bg-black/20 rounded px-1 py-0.5 text-amber-400/80 text-s select-text">{children}</code>
                          );
                        },
                        p: ({ children }) => <p className="my-1 text-text/70">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5 text-text/70">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5 text-text/70">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        h1: ({ children }) => <h1 className="font-bold text-s mt-2 mb-1 text-text">{children}</h1>,
                        h2: ({ children }) => <h2 className="font-bold text-s mt-2 mb-1 text-text">{children}</h2>,
                        h3: ({ children }) => <h3 className="font-semibold text-s mt-1.5 mb-0.5 text-text">{children}</h3>,
                        strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
                        hr: () => <hr className="border-border my-2" />,
                        a: ({ children, href }) => {
                          let safeHref = href;
                          try {
                            const url = new URL(href || "", "https://placeholder");
                            if (!["http:", "https:", "mailto:"].includes(url.protocol)) {
                              safeHref = undefined;
                            }
                          } catch {
                            safeHref = undefined;
                          }
                          return safeHref ? (
                            <a href={safeHref} className="text-accent/70 hover:text-accent hover:underline" target="_blank" rel="noreferrer noopener">
                              {children}
                            </a>
                          ) : (
                            <span className="text-accent/70">{children}</span>
                          );
                        },
                      }}
                    >
                      {msg.content}
                    </Markdown>
                    {countSqlBlocks(msg.content) === 1 && (
                      <div className="relative mt-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setApplyMenuFor(applyMenuFor === idx ? null : idx); }}
                            className="btn btn-primary text-s !h-auto !py-2 !flex !items-center !gap-1.5"
                          >
                            <i className="fa-solid fa-code !text-s !w-auto !h-auto !flex-none" />
                            <span className="pb-[2px]">Apply to editor</span>
                            <i className="fa-solid fa-chevron-down !text-icon-xs !w-auto !h-auto !flex-none ml-1 opacity-60" />
                          </button>
                        </div>
                        {applyMenuFor === idx && (
                          <div className="popup-menu absolute left-0 bottom-full mb-1">
                            <button
                              onClick={() => handleApplyCode(msg.content, "append")}
                              className="popup-menu-item"
                            >
                              <i className="fa-solid fa-plus text-icon w-3 text-center" />
                              Append to editor
                            </button>
                            <button
                              onClick={() => handleApplyCode(msg.content, "replace")}
                              className="popup-menu-item"
                            >
                              <i className="fa-solid fa-arrow-right-arrow-left text-icon w-3 text-center" />
                              Replace content
                            </button>
                            <button
                              onClick={() => handleApplyCode(msg.content, "new-tab")}
                              className="popup-menu-item"
                            >
                              <i className="fa-solid fa-file-circle-plus text-icon w-3 text-center" />
                              Open in new tab
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-s whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-surface-hover rounded-md px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-s text-text-muted">
                  <i className="fa-solid fa-spinner fa-spin text-s" />
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="bg-error/10 border border-error/20 text-error rounded-md px-2.5 py-1.5 text-s flex items-center gap-1.5 select-text">
                <i className="fa-solid fa-circle-exclamation text-s" />
                <span>{error}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-3 bg-surface-header/30">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your SQL..."
                disabled={isLoading}
                rows={1}
                className="w-full bg-surface-panel border border-border rounded-lg px-3 py-[9px] text-s leading-[18px] focus:border-accent/40 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none disabled:opacity-50 overflow-hidden"
                style={{ height: "38px", maxHeight: "150px" }}
              />
              <div className="flex items-center justify-between">
                <div className="relative">
                  <Tooltip content="Configure tools">
                    <button
                      ref={toolsButtonRef}
                      onClick={() => setShowTools(!showTools)}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-s transition-colors cursor-pointer ${showTools
                          ? "text-accent bg-accent/10"
                          : "text-text-muted hover:text-text hover:bg-surface-hover"
                        }`}
                    >
                      <i className="fa-solid fa-wrench text-icon" />
                      <span>Tools</span>
                    </button>
                  </Tooltip>
                  {showTools && (
                    <ToolsPopup
                      anchorRef={toolsButtonRef}
                      onClose={() => setShowTools(false)}
                    />
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isLoading}
              className="mt-[6px] w-[26px] h-[26px] flex-shrink-0 flex items-center justify-center rounded-md bg-accent text-accent-text hover:bg-accent-hover transition-all active:scale-95 disabled:bg-surface-hover disabled:text-text-muted disabled:shadow-none disabled:cursor-default cursor-pointer"
            >
              <i className="fa-solid fa-paper-plane text-s" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
