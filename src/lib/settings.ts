import { createSignal } from "solid-js";

const STORAGE_KEY_PERSIST_TABS = "sqlqs_persist_tabs";
const STORAGE_KEY_MAX_HISTORY = "sqlqs_max_history_items";
const STORAGE_KEY_SAVED_TABS = "sqlqs_saved_tabs_v1";
const STORAGE_KEY_AI_NOTIFICATIONS = "sqlqs_ai_notifications";

export const DEFAULT_MAX_HISTORY = 50;
export const MIN_MAX_HISTORY = 10;
export const MAX_MAX_HISTORY = 500;

export interface AppPreferences {
  persistTabs: boolean;
  maxHistoryItems: number;
  aiNotifications: boolean;
}

function readPersistTabsFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY_PERSIST_TABS);
  return raw === null ? true : raw === "true";
}

function readMaxHistoryItemsFromStorage(): number {
  const raw = localStorage.getItem(STORAGE_KEY_MAX_HISTORY);
  if (!raw) return DEFAULT_MAX_HISTORY;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_MAX_HISTORY;
  return Math.max(MIN_MAX_HISTORY, Math.min(MAX_MAX_HISTORY, parsed));
}

function readAiNotificationsFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY_AI_NOTIFICATIONS);
  return raw === null ? true : raw === "true";
}

function readPreferencesFromStorage(): AppPreferences {
  return {
    persistTabs: readPersistTabsFromStorage(),
    maxHistoryItems: readMaxHistoryItemsFromStorage(),
    aiNotifications: readAiNotificationsFromStorage(),
  };
}

// Module-level signal so reads are O(1) and reactive contexts re-run when
// preferences change. The savers below update this signal in lockstep with
// localStorage so the cache never drifts.
const [preferences, setPreferences] = createSignal<AppPreferences>(
  readPreferencesFromStorage(),
);

export function loadPreferences(): AppPreferences {
  return preferences();
}

export function loadAiNotifications(): boolean {
  return preferences().aiNotifications;
}

export function saveAiNotifications(value: boolean) {
  localStorage.setItem(STORAGE_KEY_AI_NOTIFICATIONS, String(value));
  setPreferences((prev) => ({ ...prev, aiNotifications: value }));
}

export function savePersistTabs(value: boolean) {
  localStorage.setItem(STORAGE_KEY_PERSIST_TABS, String(value));
  if (!value) {
    localStorage.removeItem(STORAGE_KEY_SAVED_TABS);
  }
  setPreferences((prev) => ({ ...prev, persistTabs: value }));
}

export function saveMaxHistoryItems(value: number) {
  const clamped = Math.max(MIN_MAX_HISTORY, Math.min(MAX_MAX_HISTORY, value));
  localStorage.setItem(STORAGE_KEY_MAX_HISTORY, String(clamped));
  setPreferences((prev) => ({ ...prev, maxHistoryItems: clamped }));
}

export interface SavedTab {
  title: string;
  sql: string;
  userTitle?: boolean;
  sourceId?: string;
  pinned?: boolean;
}

export function saveTabs(tabs: SavedTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SAVED_TABS, JSON.stringify(tabs));
  } catch {}
}

export function loadSavedTabs(): SavedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SAVED_TABS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t: any) => typeof t.title === "string" && typeof t.sql === "string",
    );
  } catch {
    return [];
  }
}
