import { open } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import { createMemo, createSignal, onMount, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { AiService } from "../../lib/ai";
import {
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_FORMAT_INDENT_SIZE,
  DEFAULT_MAX_HISTORY,
  EDITOR_FONT_FAMILY_OPTIONS,
  FORMAT_INDENT_OPTIONS,
  FORMAT_KEYWORD_CASE_OPTIONS,
  loadPreferences,
  MAX_EDITOR_FONT_SIZE,
  MAX_EXEC_TIMEOUT_SECONDS,
  MAX_MAX_HISTORY,
  MIN_EDITOR_FONT_SIZE,
  MIN_MAX_HISTORY,
  saveAiNotifications,
  saveAutoCheckUpdates,
  saveAutoConnectStartup,
  saveConfirmCloseUnsaved,
  saveEditorAutocomplete,
  saveEditorFontFamily,
  saveEditorFontSize,
  saveEditorFormatOnPaste,
  saveEditorLineNumbers,
  saveEditorMinimap,
  saveExecConfirmDestructive,
  saveExecDateFormat,
  saveExecDoubleClickEditRow,
  saveExecMaxRows,
  saveExecTimeoutSeconds,
  saveFormatIndentSize,
  saveFormatKeywordCase,
  saveFormatMaxLineLength,
  saveMaxHistoryItems,
  savePersistTabs,
  type DateFormat,
  type SqlKeywordCase,
} from "../../lib/settings";
import { loadTheme, saveTheme, THEMES } from "../../lib/theme";
import type {
  AppSettings,
  GeminiStatus,
  SavedConnection,
  UpdateMessageTone,
} from "../../lib/types";
import ConnectionDialog from "../dialogs/ConnectionDialog";
import ConfirmDialog from "../ui/ConfirmDialog";
import Dropdown from "../ui/Dropdown";
import Input from "../ui/Input";

interface Props {
  onClose: () => void;
  version: string | null;
  onCheckForUpdates: () => void | Promise<unknown>;
  checkingForUpdates: boolean;
  updateMessage: string | null;
  updateMessageTone: UpdateMessageTone;
  onThemeChange?: (theme: { id: string }) => void;
  renderLayout?: (sidebar: JSX.Element, content: JSX.Element) => JSX.Element;
}

type Tab =
  | "general"
  | "editor"
  | "execution"
  | "connections"
  | "appearance"
  | "ai"
  | "updates"
  | "about";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "fa-solid fa-gear" },
  { id: "editor", label: "Editor", icon: "fa-solid fa-code" },
  { id: "execution", label: "Execution", icon: "fa-solid fa-bolt" },
  { id: "connections", label: "Connections", icon: "fa-solid fa-plug" },
  { id: "appearance", label: "Appearance", icon: "fa-solid fa-palette" },
  { id: "ai", label: "AI", icon: "fa-solid fa-wand-magic-sparkles" },
  { id: "updates", label: "Updates", icon: "fa-solid fa-arrows-rotate" },
  { id: "about", label: "About", icon: "fa-solid fa-circle-info" },
];

const REPOSITORY_URL = "https://github.com/crsxmilitaru/sqlqs";

function tabLabel(id: Tab): string {
  return TABS.find((t) => t.id === id)?.label ?? id;
}

function summarizeConnection(c: SavedConnection): string {
  const cfg = c.config;
  if (cfg.connection_string) return "Connection string";
  const auth = cfg.use_windows_auth ? "Windows Auth" : cfg.username || "sa";
  const host = cfg.server || "(no server)";
  return cfg.database ? `${auth}@${host} · ${cfg.database}` : `${auth}@${host}`;
}

export default function SettingsView(props: Props) {
  const currentTheme = loadTheme();
  const prefs = loadPreferences();
  const [activeTab, setActiveTab] = createSignal<Tab>("general");
  const [search, setSearch] = createSignal("");
  const [themeId, setThemeId] = createSignal(currentTheme.id);
  const [persistTabs, setPersistTabs] = createSignal(prefs.persistTabs);
  const [confirmCloseUnsaved, setConfirmCloseUnsaved] = createSignal(
    prefs.confirmCloseUnsaved,
  );
  const [autoConnectStartup, setAutoConnectStartup] = createSignal(
    prefs.autoConnectStartup,
  );
  const [maxHistory, setMaxHistory] = createSignal(prefs.maxHistoryItems);
  const [aiNotifications, setAiNotifications] = createSignal(
    prefs.aiNotifications,
  );
  const [autoCheckUpdates, setAutoCheckUpdates] = createSignal(
    prefs.autoCheckUpdates,
  );

  const [fontFamily, setFontFamily] = createSignal(prefs.editor.fontFamily);
  const [fontSize, setFontSize] = createSignal(prefs.editor.fontSize);
  const [editorLineNumbers, setEditorLineNumbers] = createSignal(
    prefs.editor.lineNumbers,
  );
  const [editorMinimap, setEditorMinimap] = createSignal(prefs.editor.minimap);
  const [editorAutocomplete, setEditorAutocomplete] = createSignal(
    prefs.editor.autocomplete,
  );
  const [editorFormatOnPaste, setEditorFormatOnPaste] = createSignal(
    prefs.editor.formatOnPaste,
  );

  const [execMaxRows, setExecMaxRows] = createSignal(prefs.execution.maxRows);
  const [execTimeout, setExecTimeout] = createSignal(
    prefs.execution.timeoutSeconds,
  );
  const [execConfirmDestructive, setExecConfirmDestructiveSignal] =
    createSignal(prefs.execution.confirmDestructive);
  const [execDoubleClickEditRow, setExecDoubleClickEditRow] = createSignal(
    prefs.execution.doubleClickEditRow,
  );
  const [execDateFormat, setExecDateFormatSignal] = createSignal<DateFormat>(
    prefs.execution.dateFormat || DEFAULT_DATE_FORMAT,
  );

  const [formatIndentSize, setFormatIndentSize] = createSignal(
    prefs.format.indentSize,
  );
  const [formatKeywordCase, setFormatKeywordCase] = createSignal<SqlKeywordCase>(
    prefs.format.keywordCase,
  );
  const [formatMaxLineLength, setFormatMaxLineLength] = createSignal(
    prefs.format.maxLineLength,
  );

  const [connections, setConnections] = createSignal<SavedConnection[]>([]);
  const [editingConnection, setEditingConnection] =
    createSignal<SavedConnection | null>(null);
  const [addingConnection, setAddingConnection] = createSignal(false);
  const [deletingConnection, setDeletingConnection] =
    createSignal<SavedConnection | null>(null);
  const [importMessage, setImportMessage] = createSignal<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  let importInputRef: HTMLInputElement | undefined;

  const [geminiStatus, setGeminiStatus] = createSignal<GeminiStatus>({
    hasKey: false,
  });
  const [apiKey, setApiKey] = createSignal("");
  const [modelId, setModelId] = createSignal(AiService.getModel());
  const [showApiKey, setShowApiKey] = createSignal(false);
  const [, setVisible] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  onMount(() => {
    AiService.getApiKey().then((key) => {
      if (key) setApiKey(key);
    });
    AiService.getStatus().then(setGeminiStatus);
    void refreshConnections();
  });

  async function refreshConnections() {
    try {
      const settings: AppSettings = await invoke("load_connections");
      setConnections(settings.connections);
    } catch {}
  }

  async function moveConnection(index: number, direction: -1 | 1) {
    const optimistic = connections().slice();
    const target = index + direction;
    if (target < 0 || target >= optimistic.length) return;
    const movedName = optimistic[index].name;
    const [moved] = optimistic.splice(index, 1);
    optimistic.splice(target, 0, moved);
    setConnections(optimistic);

    try {
      const settings: AppSettings = await invoke("load_connections");
      const fresh = settings.connections.slice();
      const fromIdx = fresh.findIndex((c) => c.name === movedName);
      if (fromIdx < 0) {
        void refreshConnections();
        return;
      }
      const [movedFresh] = fresh.splice(fromIdx, 1);
      const toIdx = Math.max(
        0,
        Math.min(fresh.length, fromIdx + direction),
      );
      fresh.splice(toIdx, 0, movedFresh);
      await invoke("save_connections_settings", {
        payload: { ...settings, connections: fresh },
      });
      setConnections(fresh);
    } catch (err) {
      console.error("Failed to reorder connections:", err);
      void refreshConnections();
    }
  }

  async function confirmDeleteConnection() {
    const target = deletingConnection();
    if (!target) return;
    try {
      const updated: AppSettings = await invoke("delete_saved_connection", {
        name: target.name,
      });
      setConnections(updated.connections);
    } catch (err) {
      console.error("Failed to delete connection:", err);
    } finally {
      setDeletingConnection(null);
    }
  }

  async function handleExportConnections() {
    try {
      const payload = {
        version: 1,
        exported_at: new Date().toISOString(),
        connections: connections().map((c) => ({
          name: c.name,
          config: { ...c.config, password: undefined },
        })),
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sqlqs-connections-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setImportMessage({
        text: `Exported ${connections().length} connection(s) (passwords excluded).`,
        tone: "success",
      });
    } catch (err) {
      setImportMessage({
        text: `Export failed: ${String(err)}`,
        tone: "error",
      });
    }
  }

  function triggerImport() {
    importInputRef?.click();
  }

  async function handleImportFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported: SavedConnection[] = Array.isArray(parsed?.connections)
        ? parsed.connections
        : Array.isArray(parsed)
          ? parsed
          : [];
      if (imported.length === 0) {
        setImportMessage({
          text: "No connections found in file.",
          tone: "error",
        });
        return;
      }

      const settings: AppSettings = await invoke("load_connections");
      const merged = settings.connections.slice();
      let added = 0;
      let replaced = 0;
      for (const candidate of imported) {
        if (!candidate?.name || !candidate?.config) continue;
        const stripped: SavedConnection = {
          name: String(candidate.name),
          config: { ...candidate.config, password: undefined },
          cached_port: candidate.cached_port ?? null,
        };
        const idx = merged.findIndex((c) => c.name === stripped.name);
        if (idx >= 0) {
          merged[idx] = stripped;
          replaced++;
        } else {
          merged.push(stripped);
          added++;
        }
      }

      await invoke("save_connections_settings", {
        payload: { ...settings, connections: merged },
      });
      setConnections(merged);
      setImportMessage({
        text: `Imported ${imported.length} connection(s) — ${added} added, ${replaced} updated.`,
        tone: "success",
      });
    } catch (err) {
      setImportMessage({
        text: `Import failed: ${String(err)}`,
        tone: "error",
      });
    }
  }

  const handleSaveAiSettings = async () => {
    await AiService.setApiKey(apiKey());
    AiService.setModel(modelId());
    setGeminiStatus(await AiService.getStatus());
  };

  const updateMessageClass = () =>
    props.updateMessageTone === "error"
      ? "text-error"
      : props.updateMessageTone === "success"
        ? "text-success"
        : "text-text-muted";

  async function handleOpenRepository(event: MouseEvent) {
    event.preventDefault();
    await open(REPOSITORY_URL);
  }

  function handleThemeChange(newThemeId: string) {
    setThemeId(newThemeId);
    saveTheme(newThemeId);
    props.onThemeChange?.({ id: newThemeId });
  }

  interface Section {
    id: string;
    tab: Tab;
    title: string;
    keywords: string;
    render: () => JSX.Element;
  }

  const sections: Section[] = [
    {
      id: "persist-tabs",
      tab: "general",
      title: "Restore tabs on startup",
      keywords: "restore tabs startup persist session",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Restore tabs on startup
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Keep your open tabs between app restarts
              </p>
            </div>
            <button
              onClick={() => {
                const next = !persistTabs();
                setPersistTabs(next);
                savePersistTabs(next);
              }}
              class="settings-toggle"
              data-checked={persistTabs()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "confirm-close-unsaved",
      tab: "general",
      title: "Confirm close unsaved",
      keywords: "confirm close unsaved warning prompt tabs",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Confirm close unsaved
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Prompt before closing a tab with unsaved SQL changes
              </p>
            </div>
            <button
              onClick={() => {
                const next = !confirmCloseUnsaved();
                setConfirmCloseUnsaved(next);
                saveConfirmCloseUnsaved(next);
              }}
              class="settings-toggle"
              data-checked={confirmCloseUnsaved()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "auto-connect-startup",
      tab: "general",
      title: "Auto-connect on startup",
      keywords: "auto connect startup automatically open last connection",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Auto-connect on startup
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Automatically attempt to connect to the last used connection
              </p>
            </div>
            <button
              onClick={() => {
                const next = !autoConnectStartup();
                setAutoConnectStartup(next);
                saveAutoConnectStartup(next);
              }}
              class="settings-toggle"
              data-checked={autoConnectStartup()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "history-limit",
      tab: "general",
      title: "History limit",
      keywords: "history limit queries max maximum",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-m font-medium text-text">History limit</h4>
              <p class="text-s text-text-muted mt-0.5">
                Maximum number of queries to keep in history
              </p>
            </div>
            <span class="text-m font-medium text-accent tabular-nums">
              {maxHistory()}
            </span>
          </div>
          <input
            type="range"
            min={MIN_MAX_HISTORY}
            max={MAX_MAX_HISTORY}
            step={10}
            value={maxHistory()}
            onInput={(e) => {
              const val = Number.parseInt(
                (e.target as HTMLInputElement).value,
                10,
              );
              setMaxHistory(val);
              saveMaxHistoryItems(val);
            }}
            class="settings-range"
          />
          <div class="flex justify-between text-s text-text-muted mt-2">
            <span>{MIN_MAX_HISTORY}</span>
            <span>{DEFAULT_MAX_HISTORY} (default)</span>
            <span>{MAX_MAX_HISTORY}</span>
          </div>
        </div>
      ),
    },
    {
      id: "editor-font-family",
      tab: "editor",
      title: "Font family",
      keywords: "font family typeface cascadia fira consolas mono editor",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-m font-medium text-text">Font family</h4>
              <p class="text-s text-text-muted mt-0.5">
                Typeface used by the SQL editor
              </p>
            </div>
            <div class="min-w-[220px]">
              <Dropdown
                value={fontFamily()}
                options={EDITOR_FONT_FAMILY_OPTIONS}
                onChange={(val) => {
                  setFontFamily(val);
                  saveEditorFontFamily(val);
                }}
              />
            </div>
          </div>
          <div
            class="rounded-md border border-border px-3 py-2 text-m text-text"
            style={{
              "font-family": fontFamily() || "var(--font-mono)",
              "font-size": `${fontSize()}px`,
            }}
          >
            SELECT * FROM users WHERE id = 42;
          </div>
        </div>
      ),
    },
    {
      id: "editor-font-size",
      tab: "editor",
      title: "Font size",
      keywords: "font size editor zoom",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-m font-medium text-text">Font size</h4>
              <p class="text-s text-text-muted mt-0.5">
                Editor font size in pixels
              </p>
            </div>
            <span class="text-m font-medium text-accent tabular-nums">
              {fontSize()}px
            </span>
          </div>
          <input
            type="range"
            min={MIN_EDITOR_FONT_SIZE}
            max={MAX_EDITOR_FONT_SIZE}
            step={1}
            value={fontSize()}
            onInput={(e) => {
              const val = Number.parseInt(
                (e.target as HTMLInputElement).value,
                10,
              );
              setFontSize(val);
              saveEditorFontSize(val);
            }}
            class="settings-range"
          />
          <div class="flex justify-between text-s text-text-muted mt-2">
            <span>{MIN_EDITOR_FONT_SIZE}</span>
            <span>{DEFAULT_EDITOR_FONT_SIZE} (default)</span>
            <span>{MAX_EDITOR_FONT_SIZE}</span>
          </div>
        </div>
      ),
    },
    {
      id: "editor-line-numbers",
      tab: "editor",
      title: "Line numbers",
      keywords: "line numbers gutter editor",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Line numbers</h4>
              <p class="text-s text-text-muted mt-0.5">
                Show line numbers in the editor gutter
              </p>
            </div>
            <button
              onClick={() => {
                const next = !editorLineNumbers();
                setEditorLineNumbers(next);
                saveEditorLineNumbers(next);
              }}
              class="settings-toggle"
              data-checked={editorLineNumbers()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "editor-minimap",
      tab: "editor",
      title: "Minimap",
      keywords: "minimap code overview scroll editor",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Minimap</h4>
              <p class="text-s text-text-muted mt-0.5">
                Show a code minimap on the right edge of the editor
              </p>
            </div>
            <button
              onClick={() => {
                const next = !editorMinimap();
                setEditorMinimap(next);
                saveEditorMinimap(next);
              }}
              class="settings-toggle"
              data-checked={editorMinimap()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "editor-autocomplete",
      tab: "editor",
      title: "Auto-complete",
      keywords: "autocomplete intellisense suggestions completion editor",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Auto-complete</h4>
              <p class="text-s text-text-muted mt-0.5">
                Show SQL suggestions as you type
              </p>
            </div>
            <button
              onClick={() => {
                const next = !editorAutocomplete();
                setEditorAutocomplete(next);
                saveEditorAutocomplete(next);
              }}
              class="settings-toggle"
              data-checked={editorAutocomplete()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "editor-format-paste",
      tab: "editor",
      title: "Format SQL on paste",
      keywords: "format paste auto format sql clipboard editor",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Format SQL on paste</h4>
              <p class="text-s text-text-muted mt-0.5">
                Automatically format pasted SQL using T-SQL conventions
              </p>
            </div>
            <button
              onClick={() => {
                const next = !editorFormatOnPaste();
                setEditorFormatOnPaste(next);
                saveEditorFormatOnPaste(next);
              }}
              class="settings-toggle"
              data-checked={editorFormatOnPaste()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "format-indent",
      tab: "editor",
      title: "Format indent size",
      keywords: "format indent size tab width spaces sql",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Format indent size</h4>
              <p class="text-s text-text-muted mt-0.5">
                Indentation used by the SQL formatter
              </p>
            </div>
            <div class="min-w-[160px]">
              <Dropdown
                value={String(formatIndentSize())}
                options={FORMAT_INDENT_OPTIONS}
                onChange={(val) => {
                  const n = Number.parseInt(val, 10);
                  const safe = Number.isFinite(n) && n > 0
                    ? n
                    : DEFAULT_FORMAT_INDENT_SIZE;
                  setFormatIndentSize(safe);
                  saveFormatIndentSize(safe);
                }}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "format-keyword-case",
      tab: "editor",
      title: "Format keyword case",
      keywords: "format keyword case upper lower preserve sql",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Format keyword case</h4>
              <p class="text-s text-text-muted mt-0.5">
                Convert SQL keywords when formatting
              </p>
            </div>
            <div class="min-w-[160px]">
              <Dropdown
                value={formatKeywordCase()}
                options={FORMAT_KEYWORD_CASE_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                onChange={(val) => {
                  const next = val as SqlKeywordCase;
                  setFormatKeywordCase(next);
                  saveFormatKeywordCase(next);
                }}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "format-max-line-length",
      tab: "editor",
      title: "Format max line length",
      keywords: "format max line length wrap expression width sql",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Format max line length
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Wrap expressions wider than this. 0 = no wrap.
              </p>
            </div>
            <div class="w-[120px]">
              <Input
                type="number"
                min="0"
                value={String(formatMaxLineLength())}
                onInput={(e) => {
                  const raw = (e.target as HTMLInputElement).value;
                  const n = Number.parseInt(raw, 10);
                  const safe = Number.isFinite(n) && n >= 0 ? n : 0;
                  setFormatMaxLineLength(safe);
                  saveFormatMaxLineLength(safe);
                }}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "exec-max-rows",
      tab: "execution",
      title: "Result row limit",
      keywords:
        "execution row limit max rows truncate result set query select top",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-1">
            <div>
              <h4 class="text-m font-medium text-text">Result row limit</h4>
              <p class="text-s text-text-muted mt-0.5">
                Truncate each result set to this many rows. 0 = unlimited.
              </p>
            </div>
            <div class="w-[120px]">
              <Input
                type="number"
                min="0"
                value={String(execMaxRows())}
                onInput={(e) => {
                  const raw = (e.target as HTMLInputElement).value;
                  const n = Number.parseInt(raw, 10);
                  const safe = Number.isFinite(n) && n >= 0 ? n : 0;
                  setExecMaxRows(safe);
                  saveExecMaxRows(safe);
                }}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "exec-timeout",
      tab: "execution",
      title: "Query timeout",
      keywords: "execution query timeout seconds cancel kill long running",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-1">
            <div>
              <h4 class="text-m font-medium text-text">Query timeout</h4>
              <p class="text-s text-text-muted mt-0.5">
                Cancel queries that run longer than this many seconds. 0 = no
                timeout (max {MAX_EXEC_TIMEOUT_SECONDS}).
              </p>
            </div>
            <div class="w-[120px]">
              <Input
                type="number"
                min="0"
                max={String(MAX_EXEC_TIMEOUT_SECONDS)}
                value={String(execTimeout())}
                onInput={(e) => {
                  const raw = (e.target as HTMLInputElement).value;
                  const n = Number.parseInt(raw, 10);
                  const clamped = Number.isFinite(n)
                    ? Math.max(0, Math.min(MAX_EXEC_TIMEOUT_SECONDS, n))
                    : 0;
                  setExecTimeout(clamped);
                  saveExecTimeoutSeconds(clamped);
                }}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "exec-date-format",
      tab: "execution",
      title: "Date & time format",
      keywords: "execution date time format local utc result grid",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">Date & time format</h4>
              <p class="text-s text-text-muted mt-0.5">
                How dates appear in the results grid
              </p>
            </div>
            <div class="min-w-[180px]">
              <Dropdown
                value={execDateFormat()}
                options={DATE_FORMAT_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                onChange={(val) => {
                  const next = val as DateFormat;
                  setExecDateFormatSignal(next);
                  saveExecDateFormat(next);
                }}
              />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "exec-confirm-destructive",
      tab: "execution",
      title: "Confirm destructive queries",
      keywords:
        "execution confirm destructive update delete truncate where guard safety",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Confirm destructive queries
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Ask before running UPDATE / DELETE without a WHERE clause, or
                TRUNCATE
              </p>
            </div>
            <button
              onClick={() => {
                const next = !execConfirmDestructive();
                setExecConfirmDestructiveSignal(next);
                saveExecConfirmDestructive(next);
              }}
              class="settings-toggle"
              data-checked={execConfirmDestructive()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "exec-double-click-edit-row",
      tab: "execution",
      title: "Double-click row to edit",
      keywords:
        "execution double click row edit results grid open dialog mouse",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Double-click row to edit
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Open the row editor when double-clicking a row in the results
                grid
              </p>
            </div>
            <button
              onClick={() => {
                const next = !execDoubleClickEditRow();
                setExecDoubleClickEditRow(next);
                saveExecDoubleClickEditRow(next);
              }}
              class="settings-toggle"
              data-checked={execDoubleClickEditRow()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "connections-list",
      tab: "connections",
      title: "Saved connections",
      keywords: "connection server database list saved manage reorder",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-3">
            <div>
              <h4 class="text-m font-medium text-text">Saved connections</h4>
              <p class="text-s text-text-muted mt-0.5">
                Manage how connections appear in the start menu
              </p>
            </div>
            <div class="flex gap-2">
              <button
                onClick={() => setAddingConnection(true)}
                class="btn btn-secondary px-3 py-1.5"
              >
                <i class="fa-solid fa-plus mr-1.5" />
                Add
              </button>
              <button
                onClick={handleExportConnections}
                disabled={connections().length === 0}
                class="btn btn-secondary px-3 py-1.5"
              >
                <i class="fa-solid fa-file-export mr-1.5" />
                Export
              </button>
              <button
                onClick={triggerImport}
                class="btn btn-secondary px-3 py-1.5"
              >
                <i class="fa-solid fa-file-import mr-1.5" />
                Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,application/json"
                class="hidden"
                onChange={handleImportFile}
              />
            </div>
          </div>

          <Show when={importMessage()}>
            {(msg) => (
              <p
                class={`text-s mb-3 ${
                  msg().tone === "error" ? "text-error" : "text-success"
                }`}
              >
                {msg().text}
              </p>
            )}
          </Show>

          <Show
            when={connections().length > 0}
            fallback={
              <div class="text-s text-text-muted px-1 py-4">
                No saved connections yet. Connect to a server and use "Save as"
                to store one, or import from a file.
              </div>
            }
          >
            <div class="flex flex-col gap-1.5">
              <For each={connections()}>
                {(conn, i) => (
                  <div class="flex items-center gap-3 px-3 py-2.5 rounded-md border border-border bg-surface hover:bg-surface-hover transition-colors">
                    <div class="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span class="text-m font-medium text-text truncate">
                        {conn.name}
                      </span>
                      <span class="text-s text-text-muted truncate">
                        {summarizeConnection(conn)}
                      </span>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveConnection(i(), -1)}
                        disabled={i() === 0}
                        title="Move up"
                        class="btn btn-secondary px-2 py-1.5 disabled:opacity-30"
                      >
                        <i class="fa-solid fa-arrow-up text-s" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveConnection(i(), 1)}
                        disabled={i() === connections().length - 1}
                        title="Move down"
                        class="btn btn-secondary px-2 py-1.5 disabled:opacity-30"
                      >
                        <i class="fa-solid fa-arrow-down text-s" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingConnection(conn)}
                        title="Edit"
                        class="btn btn-secondary px-2 py-1.5"
                      >
                        <i class="fa-solid fa-pen text-s" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingConnection(conn)}
                        title="Delete"
                        class="btn btn-secondary px-2 py-1.5 text-error"
                      >
                        <i class="fa-solid fa-trash text-s" />
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      ),
    },
    {
      id: "appearance-theme",
      tab: "appearance",
      title: "Theme",
      keywords: "theme color appearance dark light",
      render: () => (
        <div>
          <h4 class="text-s font-medium text-text-muted uppercase tracking-wider mb-3">
            Theme
          </h4>
          <div class="grid grid-cols-2 gap-2.5">
            <For each={THEMES}>{(theme) => (
              <button
                onClick={() => handleThemeChange(theme.id)}
                class={`flex flex-col gap-2 p-3 rounded-lg border transition-all text-left ${
                  themeId() === theme.id
                    ? "border-accent bg-accent/8 ring-1 ring-accent/25"
                    : "border-border bg-surface hover:bg-surface-hover hover:border-overlay-md"
                }`}
              >
                <div class="font-medium text-m flex items-center justify-between">
                  {theme.name}
                  {themeId() === theme.id && (
                    <i class="fa-solid fa-check text-accent text-s" />
                  )}
                </div>
                <div
                  class="flex h-10 w-full rounded-md overflow-hidden border border-border/50"
                  style={{
                    "background-color": theme.colors["--color-surface-panel"],
                  }}
                >
                  <div
                    class="w-10 h-full border-r border-border/30"
                    style={{
                      "background-color": theme.colors["--color-surface"],
                    }}
                  />
                  <div class="flex-1 p-2 flex flex-col gap-1.5 relative">
                    <div
                      class="h-1.5 w-1/2 rounded-full"
                      style={{
                        "background-color":
                          theme.colors["--color-surface-active"],
                      }}
                    />
                    <div
                      class="h-1.5 w-3/4 rounded-full"
                      style={{
                        "background-color":
                          theme.colors["--color-surface-hover"],
                      }}
                    />
                    <div
                      class="absolute bottom-2 right-2 w-3 h-3 rounded-full"
                      style={{
                        "background-color": theme.colors["--color-accent"],
                      }}
                    />
                  </div>
                </div>
              </button>
            )}</For>
          </div>
        </div>
      ),
    },
    {
      id: "ai-api",
      tab: "ai",
      title: "API Configuration",
      keywords: "ai api gemini google key model assistant",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center gap-3 mb-4">
            <div>
              <h4 class="text-s font-medium text-text">API Configuration</h4>
              <p class="text-s text-text-muted mt-0.5">Google Gemini</p>
            </div>
            <div class="ml-auto">
              {geminiStatus().hasKey ? (
                <span class="px-2.5 py-1 bg-success/10 text-success text-s font-semibold rounded-full border border-success/20">
                  CONFIGURED
                </span>
              ) : (
                <span class="px-2.5 py-1 bg-warning/10 text-warning text-s font-semibold rounded-full border border-warning/20">
                  REQUIRED
                </span>
              )}
            </div>
          </div>

          <div class="space-y-3.5">
            <div>
              <label class="text-s font-medium text-text-muted block mb-1.5">
                Gemini Model ID
              </label>
              <Input
                type="text"
                value={modelId()}
                onInput={(e) =>
                  setModelId((e.target as HTMLInputElement).value)
                }
                placeholder="e.g. gemini-flash-latest"
              />
            </div>
            <div>
              <label class="text-s font-medium text-text-muted block mb-1.5">
                Gemini API Key
              </label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <Input
                    type={showApiKey() ? "text" : "password"}
                    value={apiKey()}
                    onInput={(e) =>
                      setApiKey((e.target as HTMLInputElement).value)
                    }
                    placeholder="Paste your API key here..."
                    class="pr-9"
                  />
                  <button
                    onClick={() => setShowApiKey(!showApiKey())}
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                  >
                    <i
                      class={`fa-solid ${showApiKey() ? "fa-eye-slash" : "fa-eye"} text-s`}
                    />
                  </button>
                </div>
                <button
                  onClick={handleSaveAiSettings}
                  class="btn btn-primary px-4"
                >
                  Save
                </button>
              </div>
              <p class="text-s text-text-muted mt-2">
                Get your API key for free at{" "}
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-accent hover:underline"
                  onClick={(e) => {
                    e.preventDefault();
                    void open("https://aistudio.google.com/app/apikey");
                  }}
                >
                  Google AI Studio
                </a>
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "ai-notifications",
      tab: "ai",
      title: "Notify when AI responds",
      keywords: "ai notifications notify desktop background reply",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Notify when AI responds
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Show a desktop notification when a chat reply arrives and the
                window is in the background
              </p>
            </div>
            <button
              onClick={() => {
                const next = !aiNotifications();
                setAiNotifications(next);
                saveAiNotifications(next);
              }}
              class="settings-toggle"
              data-checked={aiNotifications()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "updates-auto-check",
      tab: "updates",
      title: "Automatically check for updates",
      keywords: "auto automatic check updates startup version",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between">
            <div>
              <h4 class="text-m font-medium text-text">
                Automatically check for updates
              </h4>
              <p class="text-s text-text-muted mt-0.5">
                Check for new versions in the background on startup
              </p>
            </div>
            <button
              onClick={() => {
                const next = !autoCheckUpdates();
                setAutoCheckUpdates(next);
                saveAutoCheckUpdates(next);
              }}
              class="settings-toggle"
              data-checked={autoCheckUpdates()}
            />
          </div>
        </div>
      ),
    },
    {
      id: "updates-manual-check",
      tab: "updates",
      title: "Check for updates",
      keywords: "check updates manual version current installed",
      render: () => (
        <div class="settings-section">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h4 class="text-m font-medium text-text">Current version</h4>
              <p class="text-s text-text-muted mt-0.5">
                You are running SQL Query Studio{" "}
                {props.version ?? "(unknown version)"}
              </p>
            </div>
            <span class="text-m font-medium text-accent tabular-nums">
              {props.version ?? "—"}
            </span>
          </div>
          <button
            onClick={() => void props.onCheckForUpdates()}
            disabled={props.checkingForUpdates}
            class="btn btn-primary w-full py-2"
          >
            {props.checkingForUpdates
              ? "Checking for updates..."
              : "Check for Updates"}
          </button>
          {props.updateMessage && (
            <p class={`text-s mt-3 text-center ${updateMessageClass()}`}>
              {props.updateMessage}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "about-app",
      tab: "about",
      title: "About SQL Query Studio",
      keywords: "about sqlqs github source repository",
      render: () => (
        <>
          <div class="settings-section mb-5">
            <div class="flex items-center gap-4">
              <img
                src="/favicon.png"
                alt="SQL Query Studio icon"
                class="h-12 w-12 rounded-lg object-contain drop-shadow-md"
              />
              <div>
                <h2 class="text-m font-semibold text-text">SQL Query Studio</h2>
                <p class="text-s text-text-muted mt-0.5">
                  A lightweight SQL editor for SQL Server.
                </p>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="space-y-3">
              <div class="flex items-center justify-between py-1">
                <span class="text-m text-text-muted">Version</span>
                <span class="text-m font-medium text-text">
                  {props.version ?? "unknown"}
                </span>
              </div>
              <div class="flex items-center justify-between py-1">
                <span class="text-m text-text-muted">Author</span>
                <span class="text-m text-text">Cristian Militaru</span>
              </div>
              <div class="flex items-center justify-between py-1">
                <span class="text-m text-text-muted">License</span>
                <span class="text-m text-text">ISC</span>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <h4 class="text-m font-medium text-text mb-3">Links</h4>
            <div class="flex flex-col gap-2">
              <a
                href={REPOSITORY_URL}
                onClick={handleOpenRepository}
                class="inline-flex items-center gap-2 text-m text-accent transition-colors hover:text-accent-hover font-medium"
              >
                <i class="fa-brands fa-github text-base opacity-80" />
                View Source on GitHub
              </a>
              <a
                href={`${REPOSITORY_URL}/issues`}
                onClick={(e) => {
                  e.preventDefault();
                  void open(`${REPOSITORY_URL}/issues`);
                }}
                class="inline-flex items-center gap-2 text-m text-accent transition-colors hover:text-accent-hover font-medium"
              >
                <i class="fa-solid fa-bug text-base opacity-80" />
                Report an Issue
              </a>
            </div>
          </div>
        </>
      ),
    },
  ];

  const searchTokens = createMemo(() =>
    search()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean),
  );

  const isSearching = () => searchTokens().length > 0;

  function sectionMatches(s: Section): boolean {
    const tokens = searchTokens();
    if (tokens.length === 0) return true;
    const haystack = `${s.title} ${s.keywords} ${tabLabel(s.tab)}`.toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  }

  const visibleSections = createMemo(() => {
    if (isSearching()) {
      return sections.filter(sectionMatches);
    }
    return sections.filter((s) => s.tab === activeTab());
  });

  const groupedSearchResults = createMemo(() => {
    const groups = new Map<Tab, Section[]>();
    for (const s of visibleSections()) {
      const arr = groups.get(s.tab) ?? [];
      arr.push(s);
      groups.set(s.tab, arr);
    }
    return Array.from(groups.entries());
  });

  const sidebarNode = (
    <>
      <div class="px-3 pt-4 pb-2">
        <div class="relative">
          <i class="fa-solid fa-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-s text-text-muted pointer-events-none" />
          <Input
            type="search"
            value={search()}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search settings..."
            class="pl-8"
          />
        </div>
      </div>
      <div class="px-3 flex flex-col gap-0.5 overflow-y-auto flex-1 pb-4">
        <For each={TABS}>{(tab) => (
          <button
            onClick={() => {
              setActiveTab(tab.id);
              setSearch("");
            }}
            class={`settings-nav-btn ${
              !isSearching() && activeTab() === tab.id ? "active" : ""
            }`}
          >
            <i class={tab.icon} />
            {tab.label}
          </button>
        )}</For>
      </div>
    </>
  );

  const contentNode = (
    <div class="max-w-3xl w-full mx-auto flex flex-col pb-10">
      <Show
        when={isSearching()}
        fallback={
          <>
            <h1 class="text-2xl font-semibold text-text mb-8">
              {tabLabel(activeTab())}
            </h1>
            <div class="space-y-5 animate-in fade-in duration-[var(--duration-slow)]">
              <For each={visibleSections()}>{(s) => s.render()}</For>
            </div>
          </>
        }
      >
        <h1 class="text-2xl font-semibold text-text mb-2">Search results</h1>
        <p class="text-s text-text-muted mb-6">
          {visibleSections().length} match
          {visibleSections().length === 1 ? "" : "es"} for "{search()}"
        </p>
        <Show
          when={visibleSections().length > 0}
          fallback={
            <p class="text-m text-text-muted">No settings match your search.</p>
          }
        >
          <div class="space-y-8 animate-in fade-in duration-[var(--duration-slow)]">
            <For each={groupedSearchResults()}>
              {([tab, items]) => (
                <div>
                  <h2 class="text-s font-medium text-text-muted uppercase tracking-wider mb-3">
                    {tabLabel(tab)}
                  </h2>
                  <div class="space-y-5">
                    <For each={items}>{(s) => s.render()}</For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );

  const dialogs = (
    <>
      <Show when={editingConnection()}>
        {(conn) => (
          <ConnectionDialog
            editConnection={conn()}
            onClose={() => setEditingConnection(null)}
            onConnect={() => {
              setEditingConnection(null);
              void refreshConnections();
            }}
            onSaved={() => {
              setEditingConnection(null);
              void refreshConnections();
            }}
          />
        )}
      </Show>
      <Show when={addingConnection()}>
        <ConnectionDialog
          onClose={() => setAddingConnection(false)}
          onConnect={() => {
            setAddingConnection(false);
            void refreshConnections();
          }}
        />
      </Show>
      <Show when={deletingConnection()}>
        {(conn) => (
          <ConfirmDialog
            title="Delete connection?"
            message={`Remove "${conn().name}" and its saved password? This cannot be undone.`}
            confirmLabel="Delete"
            variant="danger"
            onConfirm={confirmDeleteConnection}
            onCancel={() => setDeletingConnection(null)}
          />
        )}
      </Show>
    </>
  );

  if (props.renderLayout) {
    return (
      <>
        {props.renderLayout(sidebarNode, contentNode) as JSX.Element}
        {dialogs}
      </>
    );
  }

  return (
    <>
      <div class="flex flex-1 w-full h-full bg-surface overflow-hidden animate-in fade-in duration-[var(--duration-slow)]">
        <div class="w-[260px] app-sidebar-surface border-r border-border flex flex-col gap-1 flex-shrink-0 z-10">
          {sidebarNode}
        </div>
        <div class="flex-1 p-8 md:p-12 overflow-y-auto relative bg-surface-panel">
          {contentNode}
        </div>
      </div>
      {dialogs}
    </>
  );
}
