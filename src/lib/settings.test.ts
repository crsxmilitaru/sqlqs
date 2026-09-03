import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadSettings() {
  vi.resetModules();
  return import("./settings");
}

describe("settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads the application defaults", async () => {
    const settings = await loadSettings();
    const preferences = settings.loadPreferences();

    expect(preferences.persistTabs).toBe(true);
    expect(preferences.confirmCloseUnsaved).toBe(true);
    expect(preferences.autoConnectStartup).toBe(true);
    expect(preferences.maxHistoryItems).toBe(settings.DEFAULT_MAX_HISTORY);
    expect(preferences.editor.fontSize).toBe(
      settings.DEFAULT_EDITOR_FONT_SIZE,
    );
    expect(preferences.editor.suggestionStyle).toBe(
      settings.DEFAULT_EDITOR_SUGGESTION_STYLE,
    );
    expect(preferences.aiEnabled).toBe(settings.DEFAULT_AI_ENABLED);
    expect(settings.DEFAULT_AI_ENABLED).toBe(true);
    expect(preferences.aiAutocomplete).toBe(settings.DEFAULT_AI_AUTOCOMPLETE);
    expect(settings.DEFAULT_AI_AUTOCOMPLETE).toBe(true);
    expect(preferences.execution.maxRows).toBe(
      settings.DEFAULT_EXEC_MAX_ROWS,
    );
    expect(preferences.format.indentSize).toBe(
      settings.DEFAULT_FORMAT_INDENT_SIZE,
    );
  });

  it("validates and clamps stored preferences", async () => {
    localStorage.setItem("sqlqs_max_history_items", "9999");
    localStorage.setItem("sqlqs_editor_font_size", "4");
    localStorage.setItem("sqlqs_exec_timeout_seconds", "9999");
    localStorage.setItem("sqlqs_format_keyword_case", "invalid");
    localStorage.setItem("sqlqs_results_date_format", "invalid");

    const settings = await loadSettings();
    const preferences = settings.loadPreferences();

    expect(preferences.maxHistoryItems).toBe(settings.MAX_MAX_HISTORY);
    expect(preferences.editor.fontSize).toBe(settings.MIN_EDITOR_FONT_SIZE);
    expect(preferences.execution.timeoutSeconds).toBe(
      settings.MAX_EXEC_TIMEOUT_SECONDS,
    );
    expect(preferences.format.keywordCase).toBe(
      settings.DEFAULT_FORMAT_KEYWORD_CASE,
    );
    expect(preferences.execution.resultsDateFormat).toBe(
      settings.DEFAULT_RESULTS_DATE_FORMAT,
    );
  });

  it("saves clamped execution, editor, and history values", async () => {
    const settings = await loadSettings();

    settings.saveExecMaxRows(-5);
    settings.saveExecTimeoutSeconds(9000);
    settings.saveEditorFontSize(100);
    settings.saveMaxHistoryItems(1);

    expect(settings.loadExecutionPreferences().maxRows).toBe(0);
    expect(settings.loadExecutionPreferences().timeoutSeconds).toBe(
      settings.MAX_EXEC_TIMEOUT_SECONDS,
    );
    expect(settings.loadEditorPreferences().fontSize).toBe(
      settings.MAX_EDITOR_FONT_SIZE,
    );
    expect(settings.loadPreferences().maxHistoryItems).toBe(
      settings.MIN_MAX_HISTORY,
    );
    expect(localStorage.getItem("sqlqs_exec_max_rows")).toBe("0");
  });

  it("persists the AI autocomplete preference", async () => {
    const settings = await loadSettings();

    settings.saveAiAutocomplete(true);
    expect(settings.loadPreferences().aiAutocomplete).toBe(true);
    expect(localStorage.getItem("sqlqs_ai_autocomplete")).toBe("true");

    settings.saveAiAutocomplete(false);
    expect(settings.loadPreferences().aiAutocomplete).toBe(false);
    expect(localStorage.getItem("sqlqs_ai_autocomplete")).toBe("false");
  });

  it("persists the AI enabled preference", async () => {
    const settings = await loadSettings();

    settings.saveAiEnabled(false);
    expect(settings.loadPreferences().aiEnabled).toBe(false);
    expect(localStorage.getItem("sqlqs_ai_enabled")).toBe("false");

    settings.saveAiEnabled(true);
    expect(settings.loadPreferences().aiEnabled).toBe(true);
    expect(localStorage.getItem("sqlqs_ai_enabled")).toBe("true");
  });

  it("migrates the legacy application date-format key", async () => {
    localStorage.setItem("sqlqs_exec_date_format", "DD/MM/YYYY HH:mm:ss");

    const settings = await loadSettings();

    expect(settings.loadExecutionPreferences().appDateFormat).toBe(
      "DD/MM/YYYY HH:mm:ss",
    );
    expect(localStorage.getItem("sqlqs_app_date_format")).toBe(
      "DD/MM/YYYY HH:mm:ss",
    );
    expect(localStorage.getItem("sqlqs_exec_date_format")).toBeNull();
  });

  it("normalizes persisted tabs and history", async () => {
    localStorage.setItem(
      "sqlqs_saved_tabs_v1",
      JSON.stringify([
        {
          title: "Users",
          sql: "SELECT 1\r\nGO",
          pinned: true,
          history: [
            {
              id: " ",
              sql: "SELECT 2\r\nGO",
              createdAt: "invalid",
              type: "invalid",
              label: ` ${"x".repeat(90)} `,
            },
            { invalid: true },
          ],
        },
        { title: 42, sql: "SELECT 3" },
      ]),
    );

    const settings = await loadSettings();
    const tabs = settings.loadSavedTabs();

    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      title: "Users",
      sql: "SELECT 1\r\nGO",
      pinned: true,
    });
    expect(tabs[0].history).toHaveLength(1);
    expect(tabs[0].history?.[0].sql).toBe("SELECT 2\nGO");
    expect(tabs[0].history?.[0].type).toBe("typing");
    expect(tabs[0].history?.[0].label).toHaveLength(80);
    expect(tabs[0].history?.[0].id).toMatch(/^history-/);
  });

  it("removes persisted tabs when persistence is disabled", async () => {
    localStorage.setItem("sqlqs_saved_tabs_v1", "[]");
    const settings = await loadSettings();

    settings.savePersistTabs(false);

    expect(settings.loadPreferences().persistTabs).toBe(false);
    expect(localStorage.getItem("sqlqs_saved_tabs_v1")).toBeNull();
  });

  it("normalizes editor suggestions and persists AI file naming", async () => {
    localStorage.setItem("sqlqs_editor_suggestion_style", "invalid");
    const settings = await loadSettings();

    expect(settings.loadEditorPreferences().suggestionStyle).toBe("ghost");
    expect(settings.loadPreferences().aiFileNaming).toBe(true);

    settings.saveEditorSuggestionStyle("popup");
    settings.saveAiFileNaming(false);

    expect(settings.loadEditorPreferences().suggestionStyle).toBe("popup");
    expect(settings.loadPreferences().aiFileNaming).toBe(false);
    expect(localStorage.getItem("sqlqs_ai_file_naming")).toBe("false");
  });

  it("loads valid tab groups and replaces unknown colors", async () => {
    localStorage.setItem(
      "sqlqs_saved_tab_groups_v1",
      JSON.stringify([
        { id: "group-1", name: "Core", color: "purple", collapsed: true },
        { id: "group-2", name: "Archive", color: "unknown" },
        { id: 3, name: "Invalid", color: "blue" },
      ]),
    );
    const settings = await loadSettings();

    expect(settings.loadTabGroups()).toEqual([
      { id: "group-1", name: "Core", color: "purple", collapsed: true },
      { id: "group-2", name: "Archive", color: "blue" },
    ]);
    expect(
      settings.saveTabGroups([
        { id: "group-3", name: "Saved", color: "green" },
      ]),
    ).toBe(true);
    expect(localStorage.getItem("sqlqs_saved_tab_groups_v1")).toContain(
      "group-3",
    );
  });
});
