const STORAGE_KEY_PERSIST_TABS = "sqlqs_persist_tabs";
const STORAGE_KEY_MAX_HISTORY = "sqlqs_max_history_items";
const STORAGE_KEY_SAVED_TABS = "sqlqs_saved_tabs_v1";

export const DEFAULT_MAX_HISTORY = 50;
export const MIN_MAX_HISTORY = 10;
export const MAX_MAX_HISTORY = 500;

export interface AppPreferences {
  persistTabs: boolean;
  maxHistoryItems: number;
}

export function loadPreferences(): AppPreferences {
  const rawPersistTabs = localStorage.getItem(STORAGE_KEY_PERSIST_TABS);
  return {
    persistTabs: rawPersistTabs === null ? true : rawPersistTabs === "true",
    maxHistoryItems: loadMaxHistoryItems(),
  };
}

export function savePersistTabs(value: boolean) {
  localStorage.setItem(STORAGE_KEY_PERSIST_TABS, String(value));
  if (!value) {
    localStorage.removeItem(STORAGE_KEY_SAVED_TABS);
  }
}

export function saveMaxHistoryItems(value: number) {
  const clamped = Math.max(MIN_MAX_HISTORY, Math.min(MAX_MAX_HISTORY, value));
  localStorage.setItem(STORAGE_KEY_MAX_HISTORY, String(clamped));
}

function loadMaxHistoryItems(): number {
  const raw = localStorage.getItem(STORAGE_KEY_MAX_HISTORY);
  if (!raw) return DEFAULT_MAX_HISTORY;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_MAX_HISTORY;
  return Math.max(MIN_MAX_HISTORY, Math.min(MAX_MAX_HISTORY, parsed));
}

export interface SavedTab {
  title: string;
  sql: string;
  userTitle?: boolean;
  sourceId?: string;
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
      (t: any) => typeof t.title === "string" && typeof t.sql === "string"
    );
  } catch {
    return [];
  }
}
