import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export default function QueryEditorPanel({
  tabs,
  activeTabId,
  onTabAdd,
  onOpenSqlFile,
  onTabUpdate,
  onExecute,
  onConnect,
  connected,
  isInitializing = false,
  currentDatabase,
  databases = [],
  onDatabaseChange,
  theme,
  aiChatOpen,
  onAiChatOpenChange,
  onSave,
  onSaveToFile,
}: Props) {
  const hasDatabaseSelected = Boolean(currentDatabase);
  const [editorHeight, setEditorHeight] = useState(300);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [aiChatWidth, setAiChatWidth] = useState(() => {
    const saved = localStorage.getItem("sqlqs_ai_chat_width");
    return saved ? parseInt(saved, 10) : 320;
  });
  useEffect(() => {
    localStorage.setItem("sqlqs_ai_chat_width", aiChatWidth.toString());
  }, [aiChatWidth]);

  const databaseOptions = useMemo(
    () => databases.map((db) => ({ value: db, label: db })),
    [databases],
  );

  const [queryCopied, setQueryCopied] = useState(false);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);
  const editorRef = useRef<SqlEditorHandle | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    if (activeTab && !activeTab.result && !activeTab.error && !activeTab.isExecuting) {
      setResultsCollapsed(true);
    } else if (activeTab && (activeTab.result || activeTab.error)) {
      setResultsCollapsed(false);
    }
  }, [activeTab?.result, activeTab?.error, activeTab?.isExecuting]);

  const handleExecute = useCallback((selectedSql?: string) => {
    if (!activeTabId || !hasDatabaseSelected) return;
    setResultsCollapsed(false);
    onExecute(activeTabId, selectedSql);
  }, [activeTabId, hasDatabaseSelected, onExecute]);

  const handleFormatSql = useCallback(() => {
    if (!activeTab) return;
    try {
      const formatted = format(activeTab.sql, {
        language: "tsql",
        keywordCase: "upper",
      });
      onTabUpdate(activeTab.id, { sql: formatted });
    } catch (err) {
      console.error("Failed to format SQL:", err);
    }
  }, [activeTab, onTabUpdate]);

  const handleCopyQuery = useCallback(async () => {
    if (!activeTab?.sql) return;
    try {
      await navigator.clipboard.writeText(activeTab.sql);
      setQueryCopied(true);
      setTimeout(() => setQueryCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy query:", err);
    }
  }, [activeTab?.sql]);

  const handleGeneratedRowSql = useCallback(
    (generatedSql: string, mode: ApplyMode = "append") => {
      if (!activeTab) return;
      switch (mode) {
        case "replace":
          onTabUpdate(activeTab.id, { sql: generatedSql });
          break;
        case "new-tab":
          onTabAdd(generatedSql);
          break;
        case "append":
        default: {
          const currentSql = activeTab.sql.trimEnd();
          const nextSql = currentSql ? `${currentSql}\n\n${generatedSql}` : generatedSql;
          onTabUpdate(activeTab.id, { sql: nextSql });
          break;
        }
      }
      setResultsCollapsed(true);
      editorRef.current?.focus();
      requestAnimationFrame(() => editorRef.current?.scrollToBottom());
    },
    [activeTab, onTabUpdate, onTabAdd],
  );

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEditorContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const getEditorContextMenuItems = (): ContextMenuItem[] => {
    const selectedText = editorRef.current?.getSelectedText();
    return [
      {
        id: "execute",
        label: selectedText ? "Execute Selection" : "Execute",
        icon: <i className="fa-solid fa-play" />,
        shortcut: "F5",
        onClick: () => handleExecute(selectedText),
        disabled: !connected || !hasDatabaseSelected || !activeTab?.sql.trim() || activeTab?.isExecuting,
      },
      { id: "sep-1", separator: true },
      {
        id: "format",
        label: "Format",
        icon: <IconFormat />,
        onClick: handleFormatSql,
        disabled: !hasDatabaseSelected || !activeTab?.sql.trim(),
      },
    ];
  };

  const handleEditorResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = editorHeight;
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
    },
    [editorHeight],
  );

  return (
    <div className="flex flex-col h-full">
      {activeTab && connected ? (
        <div className="flex flex-col flex-1 min-h-0">
          <div
            className={`flex flex-row overflow-hidden ${resultsCollapsed ? 'flex-1' : 'flex-shrink-0'}`}
            style={resultsCollapsed ? undefined : { height: editorHeight }}
          >
            <div className="flex flex-col flex-1 min-w-0 min-h-0">
              <div className="flex items-center gap-2 p-3.5 flex-shrink-0">
                {databases.length > 0 && onDatabaseChange && (
                  <Dropdown
                    value={currentDatabase || ""}
                    options={databaseOptions}
                    onChange={onDatabaseChange}
                    placeholder="Select database"
                    className="w-64"
                    filterable
                  />
                )}
                <Tooltip content="Execute (F5)" placement="bottom">
                  <button
                    onClick={() => void handleExecute(editorRef.current?.getSelectedText())}
                    disabled={!connected || !hasDatabaseSelected || !activeTab.sql.trim() || activeTab.isExecuting}
                    className="btn btn-primary btn-execute"
                  >
                    <IconPlay className="w-3.5 h-3.5" />
                    <span>Execute</span>
                  </button>
                </Tooltip>

                <div className="toolbar-sep" />

                <Tooltip content="Copy SQL" placement="bottom">
                  <button
                    onClick={handleCopyQuery}
                    disabled={!activeTab.sql.trim()}
                    className="btn btn-secondary"
                  >
                    <IconCopy className={`w-3.5 h-3.5 ${queryCopied ? "text-success" : ""}`} />
                  </button>
                </Tooltip>

                <Tooltip content="Format SQL" placement="bottom">
                  <button
                    onClick={handleFormatSql}
                    disabled={!hasDatabaseSelected || !activeTab.sql.trim()}
                    className="btn btn-secondary"
                  >
                    <IconFormat className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>

                {onSave && (
                  <Tooltip content="Save SQL" placement="bottom">
                    <button
                      onClick={() => onSave(activeTab.id)}
                      disabled={!activeTab.sql.trim()}
                      className="btn btn-secondary"
                    >
                      <IconSave className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}

                {onSaveToFile && (
                  <Tooltip content="Save SQL to file" placement="bottom">
                    <button
                      onClick={() => onSaveToFile(activeTab.id)}
                      disabled={!activeTab.sql.trim()}
                      className="btn btn-secondary"
                    >
                      <IconFloppy className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                )}

                <div className="flex-1" />
              </div>

              <div className="relative flex-1 min-w-0 min-h-0">
                <SqlEditor
                  ref={editorRef}
                  value={activeTab.sql}
                  onChange={(val) => onTabUpdate(activeTab.id, { sql: val })}
                  onExecute={handleExecute}
                  readOnly={!hasDatabaseSelected}
                  theme={theme}
                  currentDatabase={currentDatabase}
                  onContextMenu={handleEditorContextMenu}
                />
                {!hasDatabaseSelected && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-surface-panel)_76%,transparent)]">
                    <div className="mx-6 flex max-w-[280px] flex-col items-center gap-3 rounded-xl border border-border bg-surface-panel px-6 py-5 text-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-active text-accent">
                        <i className="fa-solid fa-database text-s" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-m font-semibold text-text">Choose a database</p>
                        <p className="text-s leading-relaxed text-text-muted">
                          Select a database from the dropdown above to start editing and run queries.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {aiChatOpen && (
              <AIChatPanel
                currentCode={activeTab.sql}
                currentDatabase={currentDatabase}
                onApplyCode={handleGeneratedRowSql}
                width={aiChatWidth}
                onWidthChange={setAiChatWidth}
              />
            )}
          </div>

          {!resultsCollapsed && <div className="resizer resizer-v" onMouseDown={handleEditorResize} />}

          <div className={`flex flex-col overflow-hidden ${resultsCollapsed ? 'flex-none' : 'flex-1'}`}>
            <div className="flex items-center justify-between p-2.5 border-t border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-s text-text-muted font-medium leading-none">Results</span>
                {(activeTab.error || (activeTab.result && activeTab.result.result_sets.length > 0)) && (
                  <span className="text-s text-text-muted opacity-60 ml-0.5 leading-none">
                    {activeTab.error
                      ? "(Error)"
                      : `(${activeTab.result!.result_sets[0].rows.length} row${activeTab.result!.result_sets[0].rows.length !== 1 ? "s" : ""})`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setResultsCollapsed(!resultsCollapsed)}
                  className="btn btn-secondary"
                >
                  <i className={`fa-solid fa-chevron-${resultsCollapsed ? "up" : "down"}`} />
                  <span>{resultsCollapsed ? "Expand" : "Collapse"}</span>
                </button>
              </div>
            </div>
            {!resultsCollapsed && (
              <div className="flex-1 min-h-0">
                <ResultsGrid
                  result={activeTab.result}
                  error={activeTab.error}
                  isExecuting={activeTab.isExecuting}
                  sourceSql={activeTab.sql}
                  onGenerateSql={handleGeneratedRowSql}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
          {connected ? (
            <>
              <i className="fa-solid fa-terminal text-3xl opacity-20" />
              <p className="text-m">No open queries</p>
              <div className="empty-state-actions mt-1">
                {onOpenSqlFile && (
                  <button onClick={onOpenSqlFile} className="btn btn-primary empty-state-btn">
                    <i className="fa-regular fa-folder" />
                    <span className="empty-state-btn-label">Open file</span>
                  </button>
                )}
                <button onClick={() => onTabAdd()} className="btn btn-secondary empty-state-btn">
                  <i className="fa-solid fa-plus" />
                  <span className="empty-state-btn-label">New file</span>
                </button>
              </div>
            </>
          ) : isInitializing ? (
            <>
              <i className="fa-solid fa-spinner animate-spin text-3xl opacity-30" />
              <p className="text-m">Connecting to your server...</p>
              <p className="text-s opacity-60">Restoring your last session</p>
            </>
          ) : (
            <>
              <i className="fa-solid fa-plug-circle-xmark text-3xl opacity-20" />
              <p className="text-m">Not connected to a server</p>
              <p className="text-s opacity-60">Connect to a SQL Server to start running queries</p>
              {onConnect && (
                <button onClick={onConnect} className="btn btn-primary empty-state-btn mt-1">
                  <i className="fa-solid fa-plug" />
                  <span className="empty-state-btn-label">Connect Server</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
      {editorContextMenu?.visible && (
        <ContextMenu
          items={getEditorContextMenuItems()}
          x={editorContextMenu.x}
          y={editorContextMenu.y}
          onClose={() => setEditorContextMenu(null)}
        />
      )}
    </div>
  );
}
