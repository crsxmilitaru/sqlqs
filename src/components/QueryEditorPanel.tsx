import { useCallback, useEffect, useRef, useState } from "react";
import { AiService } from "../lib/ai";
import { getModifierKeyLabel } from "../lib/platform";
import type { QueryTab } from "../lib/types";
import AIChatPanel, { type ApplyMode } from "./AIChatPanel";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import Dropdown from "./Dropdown";
import { IconCopy, IconPlay } from "./Icons";
import ResultsGrid from "./ResultsGrid";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";

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
  currentDatabase?: string;
  databases?: string[];
  onDatabaseChange?: (db: string) => void;
  theme: { id: string };
  aiChatOpen: boolean;
  onAiChatOpenChange: (open: boolean) => void;
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
  currentDatabase,
  databases = [],
  onDatabaseChange,
  theme,
  aiChatOpen,
  onAiChatOpenChange,
}: Props) {
  const modifierKeyLabel = getModifierKeyLabel();
  const [editorHeight, setEditorHeight] = useState(300);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [aiChatWidth, setAiChatWidth] = useState(() => {
    const saved = localStorage.getItem("sqlqs_ai_chat_width");
    return saved ? parseInt(saved, 10) : 320;
  });
  const hasAiKey = AiService.getStatus().hasKey;

  useEffect(() => {
    localStorage.setItem("sqlqs_ai_chat_width", aiChatWidth.toString());
  }, [aiChatWidth]);

  const [copied, setCopied] = useState(false);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);
  const editorRef = useRef<SqlEditorHandle | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const copyToClipboard = async () => {
    let text = "";
    if (activeTab?.error) {
      text = activeTab.error;
    } else {
      const result = activeTab?.result;
      if (!result || result.result_sets.length === 0) return;
      const firstSet = result.result_sets[0];
      const header = firstSet.columns.map((col) => col.name).join("\t");
      const rows = firstSet.rows.map((row) =>
        row.map((cell) => (cell != null ? String(cell) : "NULL")).join("\t"),
      );
      text = [header, ...rows].join("\n");
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  useEffect(() => {
    if (activeTab && !activeTab.result && !activeTab.error && !activeTab.isExecuting) {
      setResultsCollapsed(true);
    } else if (activeTab && (activeTab.result || activeTab.error)) {
      setResultsCollapsed(false);
    }
  }, [activeTab?.result, activeTab?.error, activeTab?.isExecuting]);

  const handleExecute = useCallback((selectedSql?: string) => {
    if (!activeTabId) return;
    setResultsCollapsed(false);
    onExecute(activeTabId, selectedSql);
  }, [activeTabId, onExecute]);

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
      editorRef.current?.focus();
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
        disabled: !connected || !activeTab?.sql.trim() || activeTab?.isExecuting,
      },
      { id: "sep-1", separator: true },
      {
        id: "format",
        label: "Format",
        icon: <i className="fa-solid fa-align-left" />,
        shortcut: `${modifierKeyLabel}+Shift+F`,
        onClick: handleFormatSql,
        disabled: !activeTab?.sql.trim(),
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
          <div className="flex items-center gap-2 p-3.5 flex-shrink-0">
            {databases.length > 0 && onDatabaseChange && (
              <Dropdown
                value={currentDatabase || ""}
                options={databases.map((db) => ({ value: db, label: db }))}
                onChange={onDatabaseChange}
                placeholder="Select database"
                className="w-64"
                filterable
              />
            )}
            <button
              onClick={() => void handleExecute(editorRef.current?.getSelectedText())}
              disabled={!connected || !activeTab.sql.trim() || activeTab.isExecuting}
              className="btn btn-primary btn-execute"
            >
              <IconPlay className="w-3.5 h-3.5" />
              <span>Execute</span>
            </button>

            <div className="flex-1" />

            {hasAiKey && (
              <button
                onClick={() => onAiChatOpenChange(!aiChatOpen)}
                className={`btn ${aiChatOpen ? "btn-primary" : "btn-secondary"}`}
              >
                <i className="fa-solid fa-wand-sparkles" />
                <span>Chat</span>
              </button>
            )}
          </div>

          <div
            className={`flex overflow-hidden ${resultsCollapsed ? 'flex-1' : 'flex-shrink-0'}`}
            style={resultsCollapsed ? undefined : { height: editorHeight }}
          >
            <div className="flex-1 min-w-0">
              <SqlEditor
                ref={editorRef}
                value={activeTab.sql}
                onChange={(val) => onTabUpdate(activeTab.id, { sql: val })}
                onExecute={handleExecute}
                theme={theme}
                currentDatabase={currentDatabase}
                onContextMenu={handleEditorContextMenu}
              />
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
                <span className="text-[12px] text-text-muted font-medium">Results</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setResultsCollapsed(!resultsCollapsed)}
                  className="btn btn-secondary"
                >
                  <i className={`fa-solid fa-chevron-${resultsCollapsed ? 'up' : 'down'}`} />
                  <span>{resultsCollapsed ? 'Expand' : 'Collapse'}</span>
                </button>
              </div>
            </div>
            {!resultsCollapsed && (
              <>
                <div className="flex-1 min-h-0">
                  <ResultsGrid
                    result={activeTab.result}
                    error={activeTab.error}
                    isExecuting={activeTab.isExecuting}
                    sourceSql={activeTab.sql}
                    onGenerateSql={handleGeneratedRowSql}
                  />
                </div>
                {(activeTab.error || (activeTab.result && activeTab.result.result_sets.length > 0)) && (
                  <div className="flex items-center justify-between px-3.5 py-1 border-t border-border flex-shrink-0">
                    <span className="text-[11px] text-text-muted">
                      {activeTab.error
                        ? "Error"
                        : `${activeTab.result!.result_sets[0].rows.length} row${activeTab.result!.result_sets[0].rows.length !== 1 ? "s" : ""}`}
                    </span>
                    <button onClick={copyToClipboard} className="btn btn-primary">
                      <IconCopy className={copied ? "text-success" : ""} />
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
          {connected ? (
            <>
              <i className="fa-solid fa-terminal text-3xl opacity-20" />
              <p className="text-sm">No open queries</p>
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
          ) : (
            <>
              <i className="fa-solid fa-plug-circle-xmark text-3xl opacity-20" />
              <p className="text-sm">Not connected to a server</p>
              <p className="text-xs opacity-60">Connect to a SQL Server to start running queries</p>
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
