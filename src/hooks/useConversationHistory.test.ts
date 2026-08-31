import { renderHook, waitFor } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../lib/ai";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import {
  type ConversationMeta,
  useConversationHistory,
} from "./useConversationHistory";

describe("useConversationHistory", () => {
  let conversations: ConversationMeta[];
  let storedMessages: Map<string, ChatMessage[]>;

  beforeEach(() => {
    conversations = [];
    storedMessages = new Map();
    setInvokeHandler((command, args) => {
      if (command === "list_conversations") return conversations;
      if (command === "save_conversation") {
        const data = args?.data as {
          meta: ConversationMeta;
          messages: ChatMessage[];
        };
        conversations = [
          data.meta,
          ...conversations.filter((item) => item.id !== data.meta.id),
        ];
        storedMessages.set(data.meta.id, data.messages);
        return undefined;
      }
      if (command === "load_conversation") {
        const id = String(args?.id);
        const meta = conversations.find((item) => item.id === id);
        return { meta, messages: storedMessages.get(id) ?? [] };
      }
      if (command === "delete_conversation") {
        const id = String(args?.id);
        conversations = conversations.filter((item) => item.id !== id);
        storedMessages.delete(id);
        return undefined;
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("creates conversations with a title derived from the first user message", async () => {
    const { result } = renderHook(useConversationHistory);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("list_conversations"));

    const id = await result.createNew([
      { role: "assistant", content: "Welcome" },
      { role: "user", content: "Show me all users" },
    ]);

    expect(result.activeId()).toBe(id);
    expect(localStorage.getItem("sqlqs_active_conversation_id")).toBe(id);
    expect(result.conversations()[0].title).toBe("Show me all users");
  });

  it("loads messages and tracks loading state", async () => {
    conversations = [
      { id: "1", title: "Users", created_at: 1, updated_at: 1 },
    ];
    storedMessages.set("1", [{ role: "user", content: "Users" }]);
    const { result } = renderHook(useConversationHistory);
    await result.refresh();

    await expect(result.load("1")).resolves.toEqual([
      { role: "user", content: "Users" },
    ]);

    expect(result.loading()).toBe(false);
    expect(result.activeId()).toBe("1");
  });

  it("removes the active conversation and its persisted identity", async () => {
    conversations = [
      { id: "1", title: "Users", created_at: 1, updated_at: 1 },
    ];
    const { result } = renderHook(useConversationHistory);
    await result.refresh();
    result.setActiveId("1");

    await result.remove("1");

    expect(result.activeId()).toBeNull();
    expect(localStorage.getItem("sqlqs_active_conversation_id")).toBeNull();
    expect(result.conversations()).toEqual([]);
  });

  it("updates a title without replacing conversation messages", async () => {
    conversations = [
      { id: "1", title: "Users", created_at: 1, updated_at: 1 },
    ];
    storedMessages.set("1", [{ role: "user", content: "Users" }]);
    const { result } = renderHook(useConversationHistory);
    await result.refresh();

    await result.updateTitle("1", "Customers");

    expect(result.conversations()[0].title).toBe("Customers");
    expect(storedMessages.get("1")).toEqual([
      { role: "user", content: "Users" },
    ]);
  });
});
