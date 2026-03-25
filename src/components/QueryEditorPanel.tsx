import { useCallback, useEffect, useRef, useState } from "react";
import type { QueryTab } from "../lib/types";
import ContextMenu, { type ContextMenuItem } from "./ContextMenu";
import Dropdown from "./Dropdown";
import { IconCopy, IconPlay } from "./Icons";
import ResultsGrid from "./ResultsGrid";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";
import Tooltip from "./Tooltip";

import { format } from "sql-formatter";
import { getModifierKeyLabel } from "../lib/platform";

interface Props {
  tabs: QueryTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabAdd: () => void;
  onOpenSqlFile?: () => void;
  onTabClose: (id: string) => void;
  onTabCloseOthers: (id: string) => void;
  onTabCloseAll: () => void;
  onTabUpdate: (id: string, updates: Partial<QueryTab>) => void;
  onTabSave?: (id: string) => void;
  onExecute: (id: string, customSql?: string) => void;
  connected: boolean;
  currentDatabase?: string;
  databases?: string[];
  onDatabaseChange?: (db: string) => void;
  theme: { id: string };
}

export default function QueryEditorPanel({
  tabs,
  activeTabId,
  onTabChange,
  onTabAdd,
  onOpenSqlFile,
  onTabClose,
  onTabCloseOthers,
  onTabCloseAll,
  onTabUpdate,
  onTabSave,
  onExecute,
  connected,
  currentDatabase,
  databases = [],
  onDatabaseChange,
  theme,
}: Props) {
  const [editorHeight, setEditorHeight] = useState(300);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [copied, setCopied] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [editorContextMenu, setEditorContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<SqlEditorHandle | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const newQueryShortcut = `${getModifierKeyLabel()}+N`;

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

  const handleStartRename = useCallback((tab: QueryTab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
  }, []);

  const handleRename = useCallback((tabId: string) => {
    if (renameValue.trim()) {
      onTabUpdate(tabId, { title: renameValue.trim() });
    }
    setRenamingTabId(null);
    setRenameValue("");
  }, [renameValue, onTabUpdate]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, tabId: string) => {
    if (e.key === "Enter") {
      handleRename(tabId);
    } else if (e.key === "Escape") {
      setRenamingTabId(null);
      setRenameValue("");
    }
  }, [handleRename]);

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  useEffect(() => {
    if (activeTab && !activeTab.result && !activeTab.error && !activeTab.isExecuting) {
      setResultsCollapsed(true);
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
    (generatedSql: string) => {
      if (!activeTab) return;
      const currentSql = activeTab.sql.trimEnd();
      const nextSql = currentSql ? `${currentSql}\n\n${generatedSql}` : generatedSql;
      onTabUpdate(activeTab.id, { sql: nextSql });
      editorRef.current?.focus();
    },
    [activeTab, onTabUpdate],
  );

  const handleTabContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setTabContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }, []);

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEditorContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: "close",
        label: "Close",
        icon: <i className="fa-solid fa-xmark" />,
        onClick: () => onTabClose(tabId),
      },
      {
        id: "close-others",
        label: "Close Others",
        icon: <i className="fa-solid fa-rectangle-xmark" />,
        onClick: () => onTabCloseOthers(tabId),
      },
      {
        id: "close-all",
        label: "Close All",
        icon: <i className="fa-solid fa-trash" />,
        onClick: () => onTabCloseAll(),
      },
    ];

    if (onTabSave) {
      items.push(
        { id: "sep-tab-1", separator: true },
        {
          id: "save-as",
          label: "Save As...",
          icon: <i className="fa-solid fa-floppy-disk" />,
          onClick: () => onTabSave(tabId),
        },
      );
    }

    return items;
  };

  const getEditorContextMenuItems = (): ContextMenuItem[] => {
    const selectedText = editorRef.current?.getSelectedText();
    const items: ContextMenuItem[] = [
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
        shortcut: "Ctrl+Shift+F",
        onClick: handleFormatSql,
        disabled: !activeTab?.sql.trim(),
      },
    ];

    return items;
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
      {tabs.length > 0 && (
        <div className="flex items-center flex-shrink-0">
          <div
            ref={tabBarRef}
            onWheel={(e) => {
              if (tabBarRef.current) {
                e.preventDefault();
                tabBarRef.current.scrollLeft += e.deltaY;
              }
            }}
            className="flex overflow-x-auto winui-tab-bar min-w-0"
          >
            {tabs.map((tab) => (
              <div
                key={tab.id}
                ref={tab.id === activeTabId ? (el) => { el?.scrollIntoView({ block: "nearest", inline: "nearest" }); } : undefined}
                className={`winui-tab flex items-center gap-2 text-[12px] cursor-default whitespace-nowrap select-none flex-shrink-0 ${tab.id === activeTabId
                    ? "active text-text font-medium"
                    : "text-text-muted"
                  }`}
                onClick={() => onTabChange(tab.id)}
                onDoubleClick={() => handleStartRename(tab)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    onTabClose(tab.id);
                  }
                }}
                onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
              >
                <div className="flex-1 min-w-0 mr-3">
                  {renamingTabId === tab.id ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => handleRename(tab.id)}
                      onKeyDown={(e) => handleRenameKeyDown(e, tab.id)}
                      className="bg-transparent border-none outline-none text-[12px] w-full min-w-0"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="truncate block" data-text={tab.title}>{tab.title}</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {tab.isExecuting && (
                    <span className="animate-pulse text-warning text-[10px]">&#9679;</span>
                  )}
                  {onTabSave && (
                    <Tooltip content="Save query">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onTabSave(tab.id);
                        }}
                        className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text cursor-pointer transition-colors"
                      >
                        <i className="fa-solid fa-floppy-disk text-[10px]" />
                      </button>
                    </Tooltip>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTabClose(tab.id);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-black/20 text-text-muted hover:text-text cursor-pointer transition-colors"
                  >
                    <i className="fa-solid fa-xmark text-[10px]" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="w-px h-4 bg-white/[0.08] flex-shrink-0" />
          <Tooltip content={`New Query (${newQueryShortcut})`} placement="bottom">
            <button
              onClick={() => {
                onTabAdd();
                requestAnimationFrame(() => {
                  if (tabBarRef.current) {
                    tabBarRef.current.scrollLeft = tabBarRef.current.scrollWidth;
                  }
                });
              }}
              className="flex items-center justify-center w-8 h-8 mx-2.5 text-text-muted hover:text-text hover:bg-white/10 rounded-full transition-colors flex-shrink-0 cursor-pointer"
            >
              <i className="fa-solid fa-plus text-[14px]" />
            </button>
          </Tooltip>
        </div>
      )}

      {activeTab ? (
        <>
          <div
            className={`overflow-hidden ${resultsCollapsed ? 'flex-1' : 'flex-shrink-0'}`}
            style={resultsCollapsed ? undefined : { height: editorHeight }}
          >
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

          {!resultsCollapsed && <div className="resizer resizer-v" onMouseDown={handleEditorResize} />}

          <div className={`flex flex-col overflow-hidden ${resultsCollapsed ? 'flex-none' : 'flex-1'}`}>
            <div className="flex items-center justify-between p-2.5 border-t border-border flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-text-muted font-medium">Results</span>
              </div>
              <div className="flex items-center gap-2">
                {databases.length > 0 && onDatabaseChange && (
                  <Dropdown
                    value={currentDatabase || ""}
                    options={databases.map((db) => ({ value: db, label: db }))}
                    onChange={onDatabaseChange}
                    placeholder="Select database"
                    className="w-64"
                    filterable
                    openUpwards
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
                <div className="w-px h-4 bg-white/[0.08]" />
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
                  <div className="flex items-center justify-between p-2.5 border-t border-border flex-shrink-0">
                    <span className="text-[11px] text-text-muted">
                      {activeTab.error
                        ? "Error"
                        : `${activeTab.result!.result_sets[0].rows.length} row${activeTab.result!.result_sets[0].rows.length !== 1 ? "s" : ""}`}
                    </span>
                    <button
                      onClick={copyToClipboard}
                      className="btn btn-primary"
                    >
                      <IconCopy className={copied ? "text-success" : ""} />
                      {copied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
          <i className="fa-solid fa-terminal text-3xl opacity-20" />
          <p className="text-sm">No open queries</p>
          <div className="empty-state-actions mt-1">
            {onOpenSqlFile && (
              <button
                onClick={onOpenSqlFile}
                className="btn btn-primary empty-state-btn"
              >
                <i className="fa-regular fa-folder" />
                <span className="empty-state-btn-label">Open file</span>
              </button>
            )}
            <button
              onClick={onTabAdd}
              className="btn btn-secondary empty-state-btn"
            >
              <i className="fa-solid fa-plus" />
              <span className="empty-state-btn-label">New file</span>
            </button>
          </div>
        </div>
      )}
      {tabContextMenu?.visible && (
        <ContextMenu
          items={getTabContextMenuItems(tabContextMenu.tabId)}
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          onClose={() => setTabContextMenu(null)}
        />
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
