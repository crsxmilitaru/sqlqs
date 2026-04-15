import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { QueryTab } from "../lib/types";
import AIChatPanel, { type ApplyMode } from "./AIChatPanel";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import Dropdown from "./Dropdown";
import { IconCopy, IconFloppy, IconFormat, IconPlay, IconSave } from "./Icons";
import ResultsGrid from "./ResultsGrid";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";
import Tooltip from "./Tooltip";

import { format } from "sql-formatter";

interface Props {
  tabs: QueryTab[];
  activeTabId: string;
  onTabAdd: (sql?: string, title?: string) => string;
  onOpenSqlFile?: () => void;
  onTabUpdate: (id: string, updates: Partial<QueryTab>) => void;
  onExecute: (id: string, customSql?: string) => void;
  onConnect?: () => void;
  connected: boolean;
  isInitializing?: boolean;
  currentDatabase?: string;
  databases?: string[];
  onDatabaseChange?: (db: string) => void;
  theme: { id: string };
  aiChatOpen: boolean;
  onAiChatOpenChange: (open: boolean) => void;
  onSave?: (id: string) => void;
  onSaveToFile?: (id: string) => void;
}

export default function QueryEditorPanel(props: Props) {
  const hasDatabaseSelected = () => Boolean(props.currentDatabase);
  const [editorHeight, setEditorHeight] = createSignal(300);
  const [resultsCollapsed, setResultsCollapsed] = createSignal(false);
  const [aiChatWidth, setAiChatWidth] = createSignal(
    (() => {
      const saved = localStorage.getItem("sqlqs_ai_chat_width");
      return saved ? parseInt(saved, 10) : 320;
    })()
  );

  createEffect(() => {
    localStorage.setItem("sqlqs_ai_chat_width", aiChatWidth().toString());
  });

  const databaseOptions = createMemo(() =>
    (props.databases ?? []).map((db) => ({ value: db, label: db })),
  );

  const [queryCopied, setQueryCopied] = createSignal(false);
  const [editorContextMenu, setEditorContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);
  let editorRef: SqlEditorHandle | null = null;

  const activeTab = createMemo(() => Array.isArray(props.tabs) ? props.tabs.find((t) => t.id === props.activeTabId) : undefined);

  createEffect(() => {
    const tab = activeTab();
    if (tab && !tab.result && !tab.error && !tab.isExecuting) {
      setResultsCollapsed(true);
    } else if (tab && (tab.result || tab.error)) {
      setResultsCollapsed(false);
    }
  });

  function handleExecute(selectedSql?: string) {
    if (!props.activeTabId || !hasDatabaseSelected()) return;
    setResultsCollapsed(false);
    props.onExecute(props.activeTabId, selectedSql);
  }

  function handleFormatSql() {
    const tab = activeTab();
    if (!tab) return;
    try {
      const formatted = format(tab.sql, {
        language: "tsql",
        keywordCase: "upper",
      });
      props.onTabUpdate(tab.id, { sql: formatted });
    } catch (err) {
      console.error("Failed to format SQL:", err);
    }
  }

  async function handleCopyQuery() {
    const tab = activeTab();
    if (!tab?.sql) return;
    try {
      await navigator.clipboard.writeText(tab.sql);
      setQueryCopied(true);
      setTimeout(() => setQueryCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy query:", err);
    }
  }

  function handleGeneratedRowSql(generatedSql: string, mode: ApplyMode = "append") {
    const tab = activeTab();
    if (!tab) return;
    switch (mode) {
      case "replace":
        props.onTabUpdate(tab.id, { sql: generatedSql });
        break;
      case "new-tab":
        props.onTabAdd(generatedSql);
        break;
      case "append":
      default: {
        const currentSql = tab.sql.trimEnd();
        const nextSql = currentSql ? `${currentSql}\n\n${generatedSql}` : generatedSql;
        props.onTabUpdate(tab.id, { sql: nextSql });
        break;
      }
    }
    setResultsCollapsed(true);
    editorRef?.focus();
    requestAnimationFrame(() => editorRef?.scrollToBottom());
  }

  function handleEditorContextMenu(e: MouseEvent) {
    e.preventDefault();
    setEditorContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }

  const getEditorContextMenuItems = (): ContextMenuItem[] => {
    const selectedText = editorRef?.getSelectedText();
    const tab = activeTab();
    return [
      {
        id: "execute",
        label: selectedText ? "Execute Selection" : "Execute",
        icon: <i class="fa-solid fa-play" />,
        shortcut: "F5",
        onClick: () => handleExecute(selectedText),
        disabled: !props.connected || !hasDatabaseSelected() || !tab?.sql.trim() || tab?.isExecuting,
      },
      { id: "sep-1", separator: true },
      {
        id: "format",
        label: "Format",
        icon: <IconFormat />,
        onClick: handleFormatSql,
        disabled: !hasDatabaseSelected() || !tab?.sql.trim(),
      },
    ];
  };

  function handleEditorResize(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorHeight();
    const onMove = (ev: MouseEvent) => {
      const newHeight = Math.max(100, Math.min(800, startHeight + ev.clientY - startY));
      setEditorHeight(newHeight);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div class="flex flex-col h-full">
      {activeTab() && props.connected ? (
        <div class="flex flex-col flex-1 min-h-0">
          <div
            class={`flex flex-row overflow-hidden ${resultsCollapsed() ? 'flex-1' : 'flex-shrink-0'}`}
            style={resultsCollapsed() ? undefined : { height: `${editorHeight()}px` }}
          >
            <div class="flex flex-col flex-1 min-w-0 min-h-0">
              <div class="flex items-center gap-2 p-3.5 flex-shrink-0">
                {(props.databases ?? []).length > 0 && props.onDatabaseChange && (
                  <Dropdown
                    value={props.currentDatabase || ""}
                    options={databaseOptions()}
                    onChange={props.onDatabaseChange!}
                    placeholder="Select database"
                    class="w-64"
                    filterable
                  />
                )}
                <Tooltip content="Execute (F5)" placement="bottom">
                  <button
                    onClick={() => void handleExecute(editorRef?.getSelectedText())}
                    disabled={!props.connected || !hasDatabaseSelected() || !activeTab()!.sql.trim() || activeTab()!.isExecuting}
                    class="btn btn-primary btn-execute"
                  >
                    <IconPlay class="w-3.5 h-3.5" />
                    <span>Execute</span>
                  </button>
                </Tooltip>

                <div class="toolbar-sep" />

                <Tooltip content="Copy SQL" placement="bottom">
                  <button
                    onClick={handleCopyQuery}
                    disabled={!activeTab()!.sql.trim()}
                    class="btn btn-secondary"
                  >
                    <IconCopy class={`w-3.5 h-3.5 ${queryCopied() ? "text-success" : ""}`} />
                  </button>
                </Tooltip>

                <Tooltip content="Format SQL" placement="bottom">
                  <button
                    onClick={handleFormatSql}
                    disabled={!hasDatabaseSelected() || !activeTab()!.sql.trim()}
                    class="btn btn-secondary"
                  >
                    <IconFormat class="w-3.5 h-3.5" />
                  </button>
                </Tooltip>

                {props.onSave && (
                  <Tooltip content="Save SQL" placement="bottom">
                    <button
                      onClick={() => props.onSave!(activeTab()!.id)}
                      disabled={!activeTab()!.sql.trim()}
                      class="btn btn-secondary"
                    >
                      <IconSave class="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}

                {props.onSaveToFile && (
                  <Tooltip content="Save SQL to file" placement="bottom">
                    <button
                      onClick={() => props.onSaveToFile!(activeTab()!.id)}
                      disabled={!activeTab()!.sql.trim()}
                      class="btn btn-secondary"
                    >
                      <IconFloppy class="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}

                <div class="flex-1" />
              </div>

              <div class="relative flex-1 min-w-0 min-h-0">
                <SqlEditor
                  onRef={(h: SqlEditorHandle) => editorRef = h}
                  value={activeTab()!.sql}
                  onChange={(val: string) => props.onTabUpdate(activeTab()!.id, { sql: val })}
                  onExecute={handleExecute}
                  readOnly={!hasDatabaseSelected()}
                  theme={props.theme}
                  currentDatabase={props.currentDatabase}
                  onContextMenu={handleEditorContextMenu}
                />
                {!hasDatabaseSelected() && (
                  <div class="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-surface-panel)_76%,transparent)]">
                    <div class="mx-6 flex max-w-[280px] flex-col items-center gap-3 rounded-xl border border-border bg-surface-panel px-6 py-5 text-center">
                      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-active text-accent">
                        <i class="fa-solid fa-database text-s" />
                      </div>
                      <div class="space-y-1">
                        <p class="text-m font-semibold text-text">Choose a database</p>
                        <p class="text-s leading-relaxed text-text-muted">
                          Select a database from the dropdown above to start editing and run queries.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {props.aiChatOpen && (
              <AIChatPanel
                currentCode={activeTab()!.sql}
                currentDatabase={props.currentDatabase}
                onApplyCode={handleGeneratedRowSql}
                width={aiChatWidth()}
                onWidthChange={setAiChatWidth}
              />
            )}
          </div>

          {!resultsCollapsed() && <div class="resizer resizer-v" onMouseDown={handleEditorResize} />}

          <div class={`flex flex-col overflow-hidden ${resultsCollapsed() ? 'flex-none' : 'flex-1'}`}>
            <div class="flex items-center justify-between p-2.5 border-t border-border flex-shrink-0">
              <div class="flex items-center gap-2">
                <span class="text-s text-text-muted font-medium leading-none">Results</span>
                {(activeTab()!.error || (activeTab()!.result && activeTab()!.result!.result_sets.length > 0)) && (
                  <span class="text-s text-text-muted opacity-60 ml-0.5 leading-none">
                    {activeTab()!.error
                      ? "(Error)"
                      : `(${activeTab()!.result!.result_sets[0].rows.length} row${activeTab()!.result!.result_sets[0].rows.length !== 1 ? "s" : ""})`}
                  </span>
                )}
              </div>
              <div class="flex items-center gap-2">
                <button
                  onClick={() => setResultsCollapsed(!resultsCollapsed())}
                  class="btn btn-secondary"
                >
                  <i class={`fa-solid fa-chevron-${resultsCollapsed() ? "up" : "down"}`} />
                  <span>{resultsCollapsed() ? "Expand" : "Collapse"}</span>
                </button>
              </div>
            </div>
            {!resultsCollapsed() && (
              <div class="flex-1 min-h-0">
                <ResultsGrid
                  result={activeTab()!.result}
                  error={activeTab()!.error}
                  isExecuting={activeTab()!.isExecuting}
                  sourceSql={activeTab()!.sql}
                  onGenerateSql={handleGeneratedRowSql}
                  onReExecute={() => handleExecute()}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div class="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
          {props.connected ? (
            <>
              <i class="fa-solid fa-terminal text-3xl opacity-20" />
              <p class="text-m">No open queries</p>
              <div class="empty-state-actions mt-1">
                {props.onOpenSqlFile && (
                  <button onClick={props.onOpenSqlFile} class="btn btn-primary empty-state-btn">
                    <i class="fa-regular fa-folder" />
                    <span class="empty-state-btn-label">Open file</span>
                  </button>
                )}
                <button onClick={() => props.onTabAdd()} class="btn btn-secondary empty-state-btn">
                  <i class="fa-solid fa-plus" />
                  <span class="empty-state-btn-label">New file</span>
                </button>
              </div>
            </>
          ) : (props.isInitializing ?? false) ? (
            <>
              <i class="fa-solid fa-spinner animate-spin text-3xl opacity-30" />
              <p class="text-m">Connecting to your server...</p>
              <p class="text-s opacity-60">Restoring your last session</p>
            </>
          ) : (
            <>
              <i class="fa-solid fa-plug-circle-xmark text-3xl opacity-20" />
              <p class="text-m">Not connected to a server</p>
              <p class="text-s opacity-60">Connect to a SQL Server to start running queries</p>
              {props.onConnect && (
                <button onClick={props.onConnect} class="btn btn-primary empty-state-btn mt-1">
                  <i class="fa-solid fa-plug" />
                  <span class="empty-state-btn-label">Connect Server</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
      {editorContextMenu()?.visible && (
        <ContextMenu
          items={getEditorContextMenuItems()}
          x={editorContextMenu()!.x}
          y={editorContextMenu()!.y}
          onClose={() => setEditorContextMenu(null)}
        />
      )}
    </div>
  );
}
