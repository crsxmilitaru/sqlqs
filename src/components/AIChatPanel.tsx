import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { AiService, type ChatMessage } from "../lib/ai";
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

function CollapsibleCode({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5">
      <pre className={`bg-black/30 rounded p-2 text-[10px] text-left ${open ? "overflow-x-auto" : "max-h-[3.2em] overflow-hidden"}`}>
        {children}
      </pre>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-center gap-1.5 text-[10px] text-text-muted hover:text-text mt-0.5 w-full cursor-pointer"
      >
        <i className={`fa-solid ${open ? "fa-chevron-up" : "fa-chevron-down"} text-[7px]`} />
        <span>{open ? "Show less" : "Show more"}</span>
      </button>
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
      let schemaSummary: string | undefined;
      try {
        const [, schema] = await invoke<[string | null, string]>("generate_sql_completion");
        schemaSummary = schema;
      } catch {
        // Schema not available
      }

      const response = await AiService.chat(
        newMessages,
        currentCode,
        currentDatabase,
        schemaSummary,
        controller.signal,
      );

      if (controller.signal.aborted) return;

      const assistantMessage: ChatMessage = { role: "assistant", content: response };
      const updated = [...newMessages, assistantMessage];
      setMessages(updated);
      saveMessages(updated);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      console.error("Chat error:", err);
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
    <div className="flex-shrink-0 h-full flex p-3" style={{ width: width + 8 }}>
      <div
        className="w-1 cursor-col-resize flex-shrink-0 hover:bg-accent/30 transition-colors rounded-full"
        onMouseDown={handleResizeStart}
      />
      <div className="flex flex-col flex-1 min-w-0 bg-surface-panel border border-border rounded-lg overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-surface-header/50">
          <span className="text-[12px] font-semibold text-text-muted uppercase tracking-wide">Assistant</span>
          {messages.length > 0 && (
            <Tooltip content="Clear Chat">
              <button
                onClick={handleClear}
                disabled={isLoading}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors disabled:opacity-30 cursor-pointer"
              >
                <i className="fa-solid fa-trash text-[11px]" />
              </button>
            </Tooltip>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-text-muted text-[12px] py-6 px-2">
              <i className="fa-solid fa-lightbulb text-base mb-2 opacity-40" />
              <p>Ask questions or request SQL modifications</p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx}>
              <div
                className={`w-full rounded-md px-2.5 py-1.5 ${msg.role === "user"
                  ? "bg-accent/20 text-text"
                  : "bg-surface-hover text-text"
                  }`}
              >
                {msg.role === "assistant" ? (
                  <div className="text-[12px] leading-relaxed chat-markdown [&>*:first-child]:mt-0">
                    <Markdown
                      components={{
                        pre: ({ children }) => <CollapsibleCode>{children}</CollapsibleCode>,
                        code: ({ children, className }) => {
                          const isBlock = className?.includes("language-");
                          return isBlock ? (
                            <code className="text-text">{children}</code>
                          ) : (
                            <code className="bg-black/20 rounded px-1 py-0.5 text-amber-400/80 text-[12px]">{children}</code>
                          );
                        },
                        p: ({ children }) => <p className="my-1 text-text/70">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5 text-text/70">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5 text-text/70">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        h1: ({ children }) => <h1 className="font-bold text-sm mt-2 mb-1 text-text">{children}</h1>,
                        h2: ({ children }) => <h2 className="font-bold text-[12px] mt-2 mb-1 text-text">{children}</h2>,
                        h3: ({ children }) => <h3 className="font-semibold text-[12px] mt-1.5 mb-0.5 text-text">{children}</h3>,
                        strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
                        hr: () => <hr className="border-border my-2" />,
                        a: ({ children, href }) => (
                          <a href={href} className="text-accent/70 hover:text-accent hover:underline" target="_blank" rel="noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {msg.content}
                    </Markdown>
                    {extractSqlCode(msg.content) && (
                      <div className="relative mt-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); setApplyMenuFor(applyMenuFor === idx ? null : idx); }}
                            className="btn btn-primary text-[11px] !h-auto !py-2 !flex !items-center !gap-1.5"
                          >
                            <i className="fa-solid fa-code !text-[10px] !w-auto !h-auto !flex-none" />
                            <span className="pb-[2px]">Apply to editor</span>
                            <i className="fa-solid fa-chevron-down !text-[8px] !w-auto !h-auto !flex-none ml-1 opacity-60" />
                          </button>
                        </div>
                        {applyMenuFor === idx && (
                          <div className="absolute left-0 bottom-full mb-1 bg-surface-panel border border-border rounded-md shadow-lg z-50 min-w-[160px] py-1">
                            <button
                              onClick={() => handleApplyCode(msg.content, "append")}
                              className="w-full px-3 py-1.5 text-[11px] text-text-muted hover:text-text hover:bg-surface-hover flex items-center gap-2 cursor-pointer"
                            >
                              <i className="fa-solid fa-plus text-[9px] w-3 text-center" />
                              Append to editor
                            </button>
                            <button
                              onClick={() => handleApplyCode(msg.content, "replace")}
                              className="w-full px-3 py-1.5 text-[11px] text-text-muted hover:text-text hover:bg-surface-hover flex items-center gap-2 cursor-pointer"
                            >
                              <i className="fa-solid fa-arrow-right-arrow-left text-[9px] w-3 text-center" />
                              Replace content
                            </button>
                            <button
                              onClick={() => handleApplyCode(msg.content, "new-tab")}
                              className="w-full px-3 py-1.5 text-[11px] text-text-muted hover:text-text hover:bg-surface-hover flex items-center gap-2 cursor-pointer"
                            >
                              <i className="fa-solid fa-file-circle-plus text-[9px] w-3 text-center" />
                              Open in new tab
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] whitespace-pre-wrap break-words leading-relaxed">{msg.content}</div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-surface-hover rounded-md px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                  <i className="fa-solid fa-spinner fa-spin text-[11px]" />
                  <span>Thinking...</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="bg-error/10 border border-error/20 text-error rounded-md px-2.5 py-1.5 text-[12px] flex items-center gap-1.5">
                <i className="fa-solid fa-circle-exclamation text-[11px]" />
                <span>{error}</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-3 bg-surface-header/30">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your SQL..."
              disabled={isLoading}
              rows={1}
              className="flex-1 min-w-0 bg-surface-panel border border-border rounded-lg px-3 py-[9px] text-[12px] leading-[18px] focus:border-accent/40 focus:ring-1 focus:ring-accent/20 outline-none transition-all resize-none disabled:opacity-50 shadow-sm overflow-hidden"
              style={{ height: "38px", maxHeight: "150px" }}
            />
            <button
              onClick={handleSendMessage}
              disabled={!input.trim() || isLoading}
              className="mb-[6px] w-[26px] h-[26px] flex-shrink-0 flex items-center justify-center rounded-md bg-accent text-accent-text hover:bg-accent-hover shadow-lg shadow-accent/20 transition-all active:scale-95 disabled:bg-surface-hover disabled:text-text-muted disabled:shadow-none disabled:cursor-default cursor-pointer"
            >
              <i className="fa-solid fa-paper-plane text-[10px]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
