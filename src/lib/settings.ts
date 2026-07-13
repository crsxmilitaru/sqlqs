import { createSignal } from "solid-js";
import type { QueryTabHistoryEntry } from "./types";

const STORAGE_KEY_PERSIST_TABS = "sqlqs_persist_tabs";
const STORAGE_KEY_CONFIRM_CLOSE_UNSAVED = "sqlqs_confirm_close_unsaved";
const STORAGE_KEY_AUTO_CONNECT_STARTUP = "sqlqs_auto_connect_startup";
const STORAGE_KEY_MAX_HISTORY = "sqlqs_max_history_items";
const STORAGE_KEY_SAVED_TABS = "sqlqs_saved_tabs_v1";
const STORAGE_KEY_AI_NOTIFICATIONS = "sqlqs_ai_notifications";
const STORAGE_KEY_AUTO_CHECK_UPDATES = "sqlqs_auto_check_updates";
const STORAGE_KEY_UPDATE_CHANNEL = "sqlqs_update_channel";
const STORAGE_KEY_EXEC_MAX_ROWS = "sqlqs_exec_max_rows";
const STORAGE_KEY_EXEC_TIMEOUT_SECONDS = "sqlqs_exec_timeout_seconds";
const STORAGE_KEY_EXEC_CONFIRM_DESTRUCTIVE = "sqlqs_exec_confirm_destructive";
const STORAGE_KEY_APP_DATE_FORMAT = "sqlqs_app_date_format";
const STORAGE_KEY_RESULTS_DATE_FORMAT = "sqlqs_results_date_format";
const STORAGE_KEY_FORMAT_INDENT_SIZE = "sqlqs_format_indent_size";
const STORAGE_KEY_FORMAT_KEYWORD_CASE = "sqlqs_format_keyword_case";
const STORAGE_KEY_FORMAT_MAX_LINE_LENGTH = "sqlqs_format_max_line_length";
const STORAGE_KEY_EDITOR_FONT_FAMILY = "sqlqs_editor_font_family";
const STORAGE_KEY_EDITOR_FONT_SIZE = "sqlqs_editor_font_size";
const STORAGE_KEY_EDITOR_LINE_NUMBERS = "sqlqs_editor_line_numbers";
const STORAGE_KEY_EDITOR_MINIMAP = "sqlqs_editor_minimap";
const STORAGE_KEY_EDITOR_AUTOCOMPLETE = "sqlqs_editor_autocomplete";
const STORAGE_KEY_EDITOR_FORMAT_ON_PASTE = "sqlqs_editor_format_on_paste";
const STORAGE_KEY_REVEAL_DB_IN_EXPLORER = "sqlqs_reveal_current_db_in_explorer";
const STORAGE_KEY_OPEN_LAST_CHAT_STARTUP = "sqlqs_open_last_chat_startup";

export const DEFAULT_MAX_HISTORY = 50;
export const MIN_MAX_HISTORY = 10;
export const MAX_MAX_HISTORY = 500;

export const DEFAULT_EDITOR_FONT_FAMILY = "";
export const DEFAULT_EDITOR_FONT_SIZE = 14;
export const MIN_EDITOR_FONT_SIZE = 10;
export const MAX_EDITOR_FONT_SIZE = 24;

export const EDITOR_FONT_FAMILY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default (Cascadia Code)" },
  { value: '"Cascadia Code", monospace', label: "Cascadia Code" },
  { value: '"Fira Code", monospace', label: "Fira Code" },
  { value: '"JetBrains Mono", monospace', label: "JetBrains Mono" },
  { value: '"Consolas", monospace', label: "Consolas" },
  { value: '"Source Code Pro", monospace', label: "Source Code Pro" },
  { value: '"Courier New", monospace', label: "Courier New" },
  { value: "monospace", label: "System Monospace" },
];

export interface EditorPreferences {
  fontFamily: string;
  fontSize: number;
  lineNumbers: boolean;
  minimap: boolean;
  autocomplete: boolean;
  formatOnPaste: boolean;
}

export type SqlKeywordCase = "upper" | "lower" | "preserve";
export type UpdateChannel = "stable" | "preview";
export type DateFormat =
  | "local"
  | "YYYY-MM-DD HH:mm:ss"
  | "DD/MM/YYYY HH:mm:ss"
  | "MM/DD/YYYY HH:mm:ss"
  | "DD.MM.YYYY HH:mm:ss"
  | "iso"
  | "utc";

export interface SqlFormatPreferences {
  indentSize: number;
  keywordCase: SqlKeywordCase;
  maxLineLength: number;
}

export interface ExecutionPreferences {
  maxRows: number;
  timeoutSeconds: number;
  confirmDestructive: boolean;
  appDateFormat: DateFormat;
  resultsDateFormat: DateFormat;
}

export const DEFAULT_EXEC_MAX_ROWS = 0;
export const DEFAULT_EXEC_TIMEOUT_SECONDS = 0;
export const MAX_EXEC_TIMEOUT_SECONDS = 3600;
export const DEFAULT_DATE_FORMAT: DateFormat = "local";
export const DEFAULT_RESULTS_DATE_FORMAT: DateFormat = "iso";

export const DATE_FORMAT_OPTIONS: { value: DateFormat; label: string }[] = [
  { value: "local", label: "Local Machine Format" },
  { value: "YYYY-MM-DD HH:mm:ss", label: "YYYY-MM-DD HH:mm:ss" },
  { value: "MM/DD/YYYY HH:mm:ss", label: "MM/DD/YYYY HH:mm:ss" },
  { value: "DD/MM/YYYY HH:mm:ss", label: "DD/MM/YYYY HH:mm:ss" },
  { value: "DD.MM.YYYY HH:mm:ss", label: "DD.MM.YYYY HH:mm:ss" },
  { value: "iso", label: "ISO 8601" },
  { value: "utc", label: "UTC Time" },
];

export const DEFAULT_FORMAT_INDENT_SIZE = 2;
export const FORMAT_INDENT_OPTIONS = [
  { value: "2", label: "2 spaces" },
  { value: "4", label: "4 spaces" },
  { value: "8", label: "8 spaces" },
];
export const DEFAULT_FORMAT_KEYWORD_CASE: SqlKeywordCase = "upper";
export const FORMAT_KEYWORD_CASE_OPTIONS: {
  value: SqlKeywordCase;
  label: string;
}[] = [
    { value: "upper", label: "UPPER CASE" },
    { value: "lower", label: "lower case" },
    { value: "preserve", label: "Preserve" },
  ];
export const DEFAULT_FORMAT_MAX_LINE_LENGTH = 0;
export const DEFAULT_UPDATE_CHANNEL: UpdateChannel = "stable";

export const UPDATE_CHANNEL_OPTIONS: {
  value: UpdateChannel;
  label: string;
  description: string;
}[] = [
  {
    value: "stable",
    label: "Stable",
    description: "Official release builds",
  },
  {
    value: "preview",
    label: "Preview",
    description: "Experimental preview builds",
  },
];

export interface AppPreferences {
  persistTabs: boolean;
  confirmCloseUnsaved: boolean;
  autoConnectStartup: boolean;
  maxHistoryItems: number;
  aiNotifications: boolean;
  autoCheckUpdates: boolean;
  updateChannel: UpdateChannel;
  revealCurrentDatabaseInExplorer: boolean;
  openLastChatStartup: boolean;
  editor: EditorPreferences;
  execution: ExecutionPreferences;
  format: SqlFormatPreferences;
}

function readPersistTabsFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY_PERSIST_TABS);
  return raw === null ? true : raw === "true";
}

function readConfirmCloseUnsavedFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY_CONFIRM_CLOSE_UNSAVED);
  return raw === null ? true : raw === "true";
}

function readAutoConnectStartupFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY_AUTO_CONNECT_STARTUP);
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

function readOpenLastChatStartupFromStorage(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY_OPEN_LAST_CHAT_STARTUP);
  return raw === null ? false : raw === "true";
}

function readBoolWithDefault(key: string, defaultValue: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return defaultValue;
  return raw === "true";
}

function readEditorFontSizeFromStorage(): number {
  const raw = localStorage.getItem(STORAGE_KEY_EDITOR_FONT_SIZE);
  if (!raw) return DEFAULT_EDITOR_FONT_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.max(
    MIN_EDITOR_FONT_SIZE,
    Math.min(MAX_EDITOR_FONT_SIZE, parsed),
  );
}

function readEditorPreferencesFromStorage(): EditorPreferences {
  return {
    fontFamily:
      localStorage.getItem(STORAGE_KEY_EDITOR_FONT_FAMILY) ??
      DEFAULT_EDITOR_FONT_FAMILY,
    fontSize: readEditorFontSizeFromStorage(),
    lineNumbers: readBoolWithDefault(STORAGE_KEY_EDITOR_LINE_NUMBERS, true),
    minimap: readBoolWithDefault(STORAGE_KEY_EDITOR_MINIMAP, true),
    autocomplete: readBoolWithDefault(STORAGE_KEY_EDITOR_AUTOCOMPLETE, true),
    formatOnPaste: readBoolWithDefault(
      STORAGE_KEY_EDITOR_FORMAT_ON_PASTE,
      false,
    ),
  };
}

function readNonNegativeIntWithDefault(key: string, def: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return def;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return def;
  return parsed;
}

function readKeywordCaseFromStorage(): SqlKeywordCase {
  const raw = localStorage.getItem(STORAGE_KEY_FORMAT_KEYWORD_CASE);
  if (raw === "upper" || raw === "lower" || raw === "preserve") return raw;
  return DEFAULT_FORMAT_KEYWORD_CASE;
}

function readAppDateFormatFromStorage(): DateFormat {
  let raw = localStorage.getItem(STORAGE_KEY_APP_DATE_FORMAT);
  if (!raw) {
    raw = localStorage.getItem("sqlqs_exec_date_format");
    if (raw) {
      localStorage.setItem(STORAGE_KEY_APP_DATE_FORMAT, raw);
      localStorage.removeItem("sqlqs_exec_date_format");
    }
  }
  if (raw && DATE_FORMAT_OPTIONS.some((o) => o.value === raw)) {
    return raw as DateFormat;
  }
  return DEFAULT_DATE_FORMAT;
}

function readResultsDateFormatFromStorage(): DateFormat {
  const raw = localStorage.getItem(STORAGE_KEY_RESULTS_DATE_FORMAT);
  if (raw && DATE_FORMAT_OPTIONS.some((o) => o.value === raw)) {
    return raw as DateFormat;
  }
  return DEFAULT_RESULTS_DATE_FORMAT;
}

function readUpdateChannelFromStorage(): UpdateChannel {
  const raw = localStorage.getItem(STORAGE_KEY_UPDATE_CHANNEL);
  if (raw === "stable" || raw === "preview") return raw;
  return DEFAULT_UPDATE_CHANNEL;
}

function readExecutionPreferencesFromStorage(): ExecutionPreferences {
  return {
    maxRows: readNonNegativeIntWithDefault(
      STORAGE_KEY_EXEC_MAX_ROWS,
      DEFAULT_EXEC_MAX_ROWS,
    ),
    timeoutSeconds: Math.min(
      readNonNegativeIntWithDefault(
        STORAGE_KEY_EXEC_TIMEOUT_SECONDS,
        DEFAULT_EXEC_TIMEOUT_SECONDS,
      ),
      MAX_EXEC_TIMEOUT_SECONDS,
    ),
    confirmDestructive: readBoolWithDefault(
      STORAGE_KEY_EXEC_CONFIRM_DESTRUCTIVE,
      true,
    ),
    appDateFormat: readAppDateFormatFromStorage(),
    resultsDateFormat: readResultsDateFormatFromStorage(),
  };
}

function readFormatPreferencesFromStorage(): SqlFormatPreferences {
  const indent = readNonNegativeIntWithDefault(
    STORAGE_KEY_FORMAT_INDENT_SIZE,
    DEFAULT_FORMAT_INDENT_SIZE,
  );
  return {
    indentSize: indent > 0 ? indent : DEFAULT_FORMAT_INDENT_SIZE,
    keywordCase: readKeywordCaseFromStorage(),
    maxLineLength: readNonNegativeIntWithDefault(
      STORAGE_KEY_FORMAT_MAX_LINE_LENGTH,
      DEFAULT_FORMAT_MAX_LINE_LENGTH,
    ),
  };
}

function readPreferencesFromStorage(): AppPreferences {
  const openLastChatStartup = readOpenLastChatStartupFromStorage();
  return {
    persistTabs: readPersistTabsFromStorage(),
    confirmCloseUnsaved: readConfirmCloseUnsavedFromStorage(),
    autoConnectStartup: readAutoConnectStartupFromStorage(),
    maxHistoryItems: readMaxHistoryItemsFromStorage(),
    aiNotifications: readAiNotificationsFromStorage(),
    autoCheckUpdates: readBoolWithDefault(STORAGE_KEY_AUTO_CHECK_UPDATES, true),
    updateChannel: readUpdateChannelFromStorage(),
    revealCurrentDatabaseInExplorer: readBoolWithDefault(
      STORAGE_KEY_REVEAL_DB_IN_EXPLORER,
      true,
    ),
    openLastChatStartup,
    editor: readEditorPreferencesFromStorage(),
    execution: readExecutionPreferencesFromStorage(),
    format: readFormatPreferencesFromStorage(),
  };
}

const [preferences, setPreferences] = createSignal<AppPreferences>(
  readPreferencesFromStorage(),
);

export function loadPreferences(): AppPreferences {
  return preferences();
}

export function loadEditorPreferences(): EditorPreferences {
  return preferences().editor;
}

export function loadExecutionPreferences(): ExecutionPreferences {
  return preferences().execution;
}

export function loadFormatPreferences(): SqlFormatPreferences {
  return preferences().format;
}

export function saveExecMaxRows(value: number) {
  const clamped = Math.max(0, Math.floor(value));
  localStorage.setItem(STORAGE_KEY_EXEC_MAX_ROWS, String(clamped));
  setPreferences((prev) => ({
    ...prev,
    execution: { ...prev.execution, maxRows: clamped },
  }));
}

export function saveExecTimeoutSeconds(value: number) {
  const clamped = Math.max(
    0,
    Math.min(MAX_EXEC_TIMEOUT_SECONDS, Math.floor(value)),
  );
  localStorage.setItem(STORAGE_KEY_EXEC_TIMEOUT_SECONDS, String(clamped));
  setPreferences((prev) => ({
    ...prev,
    execution: { ...prev.execution, timeoutSeconds: clamped },
  }));
}

export function saveExecConfirmDestructive(value: boolean) {
  localStorage.setItem(STORAGE_KEY_EXEC_CONFIRM_DESTRUCTIVE, String(value));
  setPreferences((prev) => ({
    ...prev,
    execution: { ...prev.execution, confirmDestructive: value },
  }));
}

export function saveResultsDateFormat(value: DateFormat) {
  localStorage.setItem(STORAGE_KEY_RESULTS_DATE_FORMAT, value);
  setPreferences((prev) => ({
    ...prev,
    execution: { ...prev.execution, resultsDateFormat: value },
  }));
}

export function saveAppDateFormat(value: DateFormat) {
  localStorage.setItem(STORAGE_KEY_APP_DATE_FORMAT, value);
  setPreferences((prev) => ({
    ...prev,
    execution: { ...prev.execution, appDateFormat: value },
  }));
}

export function saveFormatIndentSize(value: number) {
  const clamped = value > 0 ? Math.floor(value) : DEFAULT_FORMAT_INDENT_SIZE;
  localStorage.setItem(STORAGE_KEY_FORMAT_INDENT_SIZE, String(clamped));
  setPreferences((prev) => ({
    ...prev,
    format: { ...prev.format, indentSize: clamped },
  }));
}

export function saveFormatKeywordCase(value: SqlKeywordCase) {
  localStorage.setItem(STORAGE_KEY_FORMAT_KEYWORD_CASE, value);
  setPreferences((prev) => ({
    ...prev,
    format: { ...prev.format, keywordCase: value },
  }));
}

export function saveFormatMaxLineLength(value: number) {
  const clamped = Math.max(0, Math.floor(value));
  localStorage.setItem(STORAGE_KEY_FORMAT_MAX_LINE_LENGTH, String(clamped));
  setPreferences((prev) => ({
    ...prev,
    format: { ...prev.format, maxLineLength: clamped },
  }));
}

export function loadAiNotifications(): boolean {
  return preferences().aiNotifications;
}

export function saveAiNotifications(value: boolean) {
  localStorage.setItem(STORAGE_KEY_AI_NOTIFICATIONS, String(value));
  setPreferences((prev) => ({ ...prev, aiNotifications: value }));
}

export function saveOpenLastChatStartup(value: boolean) {
  localStorage.setItem(STORAGE_KEY_OPEN_LAST_CHAT_STARTUP, String(value));
  setPreferences((prev) => ({ ...prev, openLastChatStartup: value }));
}

export function loadAutoCheckUpdates(): boolean {
  return preferences().autoCheckUpdates;
}

export function saveAutoCheckUpdates(value: boolean) {
  localStorage.setItem(STORAGE_KEY_AUTO_CHECK_UPDATES, String(value));
  setPreferences((prev) => ({ ...prev, autoCheckUpdates: value }));
}

export function loadUpdateChannel(): UpdateChannel {
  return preferences().updateChannel;
}

export function saveUpdateChannel(value: UpdateChannel) {
  localStorage.setItem(STORAGE_KEY_UPDATE_CHANNEL, value);
  setPreferences((prev) => ({ ...prev, updateChannel: value }));
}

export function loadRevealCurrentDatabaseInExplorer(): boolean {
  return preferences().revealCurrentDatabaseInExplorer;
}

export function saveRevealCurrentDatabaseInExplorer(value: boolean) {
  localStorage.setItem(STORAGE_KEY_REVEAL_DB_IN_EXPLORER, String(value));
  setPreferences((prev) => ({
    ...prev,
    revealCurrentDatabaseInExplorer: value,
  }));
}

export function savePersistTabs(value: boolean) {
  localStorage.setItem(STORAGE_KEY_PERSIST_TABS, String(value));
  if (!value) {
    localStorage.removeItem(STORAGE_KEY_SAVED_TABS);
  }
  setPreferences((prev) => ({ ...prev, persistTabs: value }));
}

export function saveConfirmCloseUnsaved(value: boolean) {
  localStorage.setItem(STORAGE_KEY_CONFIRM_CLOSE_UNSAVED, String(value));
  setPreferences((prev) => ({ ...prev, confirmCloseUnsaved: value }));
}

export function saveAutoConnectStartup(value: boolean) {
  localStorage.setItem(STORAGE_KEY_AUTO_CONNECT_STARTUP, String(value));
  setPreferences((prev) => ({ ...prev, autoConnectStartup: value }));
}

export function saveMaxHistoryItems(value: number) {
  const clamped = Math.max(MIN_MAX_HISTORY, Math.min(MAX_MAX_HISTORY, value));
  localStorage.setItem(STORAGE_KEY_MAX_HISTORY, String(clamped));
  setPreferences((prev) => ({ ...prev, maxHistoryItems: clamped }));
}

export function saveEditorFontFamily(value: string) {
  localStorage.setItem(STORAGE_KEY_EDITOR_FONT_FAMILY, value);
  setPreferences((prev) => ({
    ...prev,
    editor: { ...prev.editor, fontFamily: value },
  }));
}

export function saveEditorFontSize(value: number) {
  const clamped = Math.max(
    MIN_EDITOR_FONT_SIZE,
    Math.min(MAX_EDITOR_FONT_SIZE, value),
  );
  localStorage.setItem(STORAGE_KEY_EDITOR_FONT_SIZE, String(clamped));
  setPreferences((prev) => ({
    ...prev,
    editor: { ...prev.editor, fontSize: clamped },
  }));
}

export function saveEditorLineNumbers(value: boolean) {
  localStorage.setItem(STORAGE_KEY_EDITOR_LINE_NUMBERS, String(value));
  setPreferences((prev) => ({
    ...prev,
    editor: { ...prev.editor, lineNumbers: value },
  }));
}

export function saveEditorMinimap(value: boolean) {
  localStorage.setItem(STORAGE_KEY_EDITOR_MINIMAP, String(value));
  setPreferences((prev) => ({
    ...prev,
    editor: { ...prev.editor, minimap: value },
  }));
}

export function saveEditorAutocomplete(value: boolean) {
  localStorage.setItem(STORAGE_KEY_EDITOR_AUTOCOMPLETE, String(value));
  setPreferences((prev) => ({
    ...prev,
    editor: { ...prev.editor, autocomplete: value },
  }));
}

export function saveEditorFormatOnPaste(value: boolean) {
  localStorage.setItem(STORAGE_KEY_EDITOR_FORMAT_ON_PASTE, String(value));
  setPreferences((prev) => ({
    ...prev,
    editor: { ...prev.editor, formatOnPaste: value },
  }));
}

export interface SavedTab {
  title: string;
  sql: string;
  history?: QueryTabHistoryEntry[];
  userTitle?: boolean;
  sourceId?: string;
  pinned?: boolean;
}

export function saveTabs(tabs: SavedTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SAVED_TABS, JSON.stringify(tabs));
  } catch {
    try {
      const tabsWithoutHistory = tabs.map(
        ({ history: _history, ...tab }) => tab,
      );
      localStorage.setItem(
        STORAGE_KEY_SAVED_TABS,
        JSON.stringify(tabsWithoutHistory),
      );
    } catch { }
  }
}

function normalizeSavedHistoryEntry(
  entry: any,
  index: number,
): QueryTabHistoryEntry {
  const trimmedLabel =
    typeof entry.label === "string" ? entry.label.trim() : "";
  const label = trimmedLabel ? trimmedLabel.slice(0, 80) : undefined;
  const createdAt =
    typeof entry.createdAt === "number" &&
    Number.isFinite(entry.createdAt) &&
    !Number.isNaN(new Date(entry.createdAt).getTime())
      ? entry.createdAt
      : Date.now();
  const trimmedId = typeof entry.id === "string" ? entry.id.trim() : "";

  return {
    id: trimmedId || `history-${createdAt}-${index}`,
    sql: entry.sql.replace(/\r\n/g, "\n"),
    createdAt,
    type: entry.type === "action" ? "action" : "typing",
    label,
  };
}

export function loadSavedTabs(): SavedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SAVED_TABS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t: any) => typeof t.title === "string" && typeof t.sql === "string",
      )
      .map((t: any) => ({
        title: t.title,
        sql: t.sql,
        userTitle: t.userTitle,
        sourceId: t.sourceId,
        pinned: t.pinned,
        history: Array.isArray(t.history)
          ? t.history
              .filter((entry: any) => entry && typeof entry.sql === "string")
              .map(normalizeSavedHistoryEntry)
          : undefined,
      }));
  } catch {
    return [];
  }
}
