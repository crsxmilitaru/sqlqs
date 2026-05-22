import { createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage } from "../lib/ai";

const ACTIVE_CONVERSATION_STORAGE_KEY = "sqlqs_active_conversation_id";

export interface ConversationMeta {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface ConversationData {
  meta: ConversationMeta;
  messages: ChatMessage[];
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function deriveTitle(messages: ChatMessage[]): string {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const cleaned = msg.content
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`[^`]*`/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) {
      return cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
    }
  }
  return "New conversation";
}

function nowMillis(): number {
  return Date.now();
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useConversationHistory() {
  const [conversations, setConversations] = createSignal<ConversationMeta[]>([]);
  const [activeId, setActiveIdSignal] = createSignal<string | null>(
    loadActiveId(),
  );
  const [loading, setLoading] = createSignal(false);

  const setActiveId = (id: string | null) => {
    setActiveIdSignal(id);
    try {
      if (id) {
        localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, id);
      } else {
        localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      }
    } catch {}
  };

  const restoreActiveFromMessages = async (msgs: ChatMessage[]) => {
    if (msgs.length === 0) return;
    await refresh();
    const list = conversations();
    const id = activeId();
    if (id && !list.some((conv) => conv.id === id)) {
      setActiveId(null);
    }
  };

  const refresh = async () => {
    try {
      const list = await invoke<ConversationMeta[]>("list_conversations");
      setConversations(list);
    } catch {
      setConversations([]);
    }
  };

  onMount(refresh);

  const createNew = async (messages: ChatMessage[]): Promise<string> => {
    const id = generateId();
    const now = nowMillis();
    const meta: ConversationMeta = {
      id,
      title: deriveTitle(messages),
      created_at: now,
      updated_at: now,
    };
    await invoke("save_conversation", {
      data: { meta, messages },
    });
    setActiveId(id);
    await refresh();
    return id;
  };

  const save = async (id: string, messages: ChatMessage[]) => {
    const existing = conversations().find((c) => c.id === id);
    const now = nowMillis();
    const meta: ConversationMeta = {
      id,
      title: existing?.title ?? deriveTitle(messages),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    await invoke("save_conversation", {
      data: { meta, messages },
    });
    await refresh();
  };

  const load = async (id: string): Promise<ChatMessage[]> => {
    setLoading(true);
    try {
      const data = await invoke<ConversationData>("load_conversation", { id });
      setActiveId(id);
      return data.messages ?? [];
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    await invoke("delete_conversation", { id });
    if (activeId() === id) setActiveId(null);
    await refresh();
  };

  const updateTitle = async (id: string, title: string) => {
    const data = await invoke<ConversationData>("load_conversation", { id });
    data.meta.title = title;
    await invoke("save_conversation", { data });
    await refresh();
  };

  return {
    conversations,
    activeId,
    setActiveId,
    loading,
    refresh,
    restoreActiveFromMessages,
    createNew,
    save,
    load,
    remove,
    updateTitle,
  };
}
