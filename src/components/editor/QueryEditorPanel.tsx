import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type {
  ExecutedQuery,
  QueryTab,
  QueryTabUpdateOptions,
} from "../../lib/types";
import AIChatPanel, {
  type ApplyMode,
  type PendingChatMessage,
} from "../ai/AIChatPanel";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import Dropdown from "../ui/Dropdown";
import {
  IconCopy,
  IconFloppy,
  IconFormat,
  IconHistory,
  IconPlay,
  IconSave,
  IconSearch,
  IconWrapText,
} from "../ui/Icons";
import EditorHistoryDialog from "./EditorHistoryDialog";
import ResultsGrid, { type ResultsTableViewState } from "./ResultsGrid";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";
import Tooltip from "../ui/Tooltip";
import { formatSqlWithPrefs } from "../../lib/sql-format";
import ConfirmDialog from "../ui/ConfirmDialog";
import { loadPreferences } from "../../lib/settings";
import type { ThemeSelection } from "../../lib/theme";
import StatisticsDialog from "../dialogs/StatisticsDialog";

const DRAG_THRESHOLD = 5;

function isTabDirty(tab: QueryTab): boolean {
  return tab.sql !== tab.savedSql;
}

function hasRestorableHistory(tab: QueryTab): boolean {
  return (tab.history ?? []).some((entry) => entry.sql !== tab.sql);
}

function restorableHistoryCount(tab: QueryTab): number {
  return (tab.history ?? []).filter((entry) => entry.sql !== tab.sql).length;
}

function actionHistoryOptions(historyLabel: string): QueryTabUpdateOptions {
  return {
    historyMode: "preserve-current",
    historyType: "action",
    historyLabel,
  };
}

function captureActionHistoryOptions(
  historyLabel: string,
): QueryTabUpdateOptions {
  return {
    historyMode: "capture-current",
    historyType: "action",
    historyLabel,
  };
}

function shouldIgnoreTabShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest("input, textarea, select")) return true;

  const editable = target.closest("[contenteditable='true']");
  return !!editable && !target.closest(".cm-editor");
}

interface Props {
  tabs: QueryTab[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabAdd: (sql?: string, title?: string) => string;
  onTabClose: (id: string) => void;
  onTabCloseOthers: (id: string) => void;
  onTabCloseAll: () => void;
  onTabUpdate: (
    id: string,
    updates: Partial<QueryTab>,
    options?: QueryTabUpdateOptions,
  ) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onTabDuplicate: (id: string) => string;
  onTabTogglePin: (id: string) => void;
  onTabPromote: (id: string) => void;
  onOpenSqlFile?: () => void;
  onExecute: (id: string, customSql?: string) => void;
  onConnect?: () => void;
  connected: boolean;
  isInitializing?: boolean;
  currentDatabase?: string;
  databases?: string[];
  onDatabaseChange?: (db: string) => void;
  theme: ThemeSelection;
  aiChatOpen: boolean;
  onAiChatOpenChange: (open: boolean) => void;
  onSave?: (id: string) => void;
  onSaveToFile?: (id: string) => void;
  executedQueries?: ExecutedQuery[];
  dialogOpen?: boolean;
}

export default function QueryEditorPanel(props: Props) {
  const hasDatabaseSelected = () => Boolean(props.currentDatabase);

  const [confirmClose, setConfirmClose] = createSignal<{
    type: "single" | "others" | "all";
    tabId?: string;
  } | null>(null);

  const [renamingTabId, setRenamingTabId] = createSignal<string | null>(null);
  const [renameValue, setRenameValue] = createSignal("");
  const [tabContextMenu, setTabContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  let renameInputRef: HTMLInputElement | undefined;
  let tabBarRef: HTMLDivElement | undefined;
  let cleanupTabBarWheelListener: (() => void) | undefined;
  let cleanupDragListeners: (() => void) | undefined;
  let cleanupEditorResizeListeners: (() => void) | undefined;
  let pendingEditorFocusFrame: number | undefined;

  const [dragTabId, setDragTabId] = createSignal<string | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  let dragRef: {
    tabId: string;
    fromIndex: number;
    startX: number;
    active: boolean;
  } | null = null;
  let justDraggedRef = false;

  function handleStartRename(tab: QueryTab) {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
  }

  function handleRename(tabId: string) {
    if (renameValue().trim()) {
      props.onTabUpdate(tabId, {
        title: renameValue().trim(),
        userTitle: true,
      });
    }
    setRenamingTabId(null);
    setRenameValue("");
  }

  function handleRenameKeyDown(e: KeyboardEvent, tabId: string) {
    if (e.key === "Enter") {
      handleRename(tabId);
    } else if (e.key === "Escape") {
      setRenamingTabId(null);
      setRenameValue("");
    }
  }

  createEffect(() => {
    if (renamingTabId() && renameInputRef) {
      renameInputRef.focus();
      renameInputRef.select();
    }
  });

  onCleanup(() => {
    if (pendingEditorFocusFrame !== undefined) {
      cancelAnimationFrame(pendingEditorFocusFrame);
    }
    cleanupTabBarWheelListener?.();
    cleanupDragListeners?.();
    cleanupEditorResizeListeners?.();
  });

  function setTabBarRef(el: HTMLDivElement) {
    cleanupTabBarWheelListener?.();
    tabBarRef = el;

    const handleTabBarWheel = (event: WheelEvent) => {
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      tabBarRef?.scrollBy({ left: delta });
    };

    el.addEventListener("wheel", handleTabBarWheel, { passive: true });
    cleanupTabBarWheelListener = () => {
      el.removeEventListener("wheel", handleTabBarWheel);
      if (tabBarRef === el) {
        tabBarRef = undefined;
      }
    };
  }

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }

  function requestSingleTabClose(tabId: string) {
    const tab = props.tabs.find((t) => t.id === tabId);
    if (tab?.temporary) {
      props.onTabClose(tabId);
      return;
    }

    const shouldConfirm = loadPreferences().confirmCloseUnsaved;
    if (!shouldConfirm || !tab || !isTabDirty(tab)) {
      props.onTabClose(tabId);
      return;
    }

    setConfirmClose({ type: "single", tabId });
  }

  function requestCloseOthers(tabId: string) {
    const shouldConfirm = loadPreferences().confirmCloseUnsaved;
    const hasDirty = props.tabs.some(
      (t) => t.id !== tabId && !t.pinned && isTabDirty(t),
    );
    if (!shouldConfirm || !hasDirty) {
      props.onTabCloseOthers(tabId);
      return;
    }
    setConfirmClose({ type: "others", tabId });
  }

  function requestCloseAll() {
    const shouldConfirm = loadPreferences().confirmCloseUnsaved;
    const hasDirty = props.tabs.some((t) => !t.pinned && isTabDirty(t));
    if (!shouldConfirm || !hasDirty) {
      props.onTabCloseAll();
      return;
    }
    setConfirmClose({ type: "all" });
  }

  function computeDropIndex(
    clientX: number,
    draggedTabId: string,
  ): number | null {
    if (!tabBarRef) return null;

    const tabElements =
      tabBarRef.querySelectorAll<HTMLElement>("[data-tab-index]");
    const currentTabs = props.tabs;
    const draggedTab = currentTabs.find((t) => t.id === draggedTabId);
    if (!draggedTab) return null;

    let result = currentTabs.length;
    for (const el of tabElements) {
      const idx = Number(el.dataset.tabIndex);
      const targetTab = currentTabs[idx];
      if (!targetTab) continue;

      if (!!draggedTab.pinned !== !!targetTab.pinned) continue;

      const rect = el.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (clientX < midpoint) {
        result = idx;
        break;
      }
    }

    return result;
  }

  function handleTabPointerDown(e: PointerEvent, tabId: string, index: number) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button, input")) return;

    dragRef = {
      tabId,
      fromIndex: index,
      startX: e.clientX,
      active: false,
    };

    const onPointerMove = (ev: PointerEvent) => {
      const drag = dragRef;
      if (!drag) return;

      if (!drag.active) {
        if (Math.abs(ev.clientX - drag.startX) < DRAG_THRESHOLD) return;
        drag.active = true;
        setDragTabId(drag.tabId);
        document.body.style.cursor = "grabbing";
      }

      const newDropIndex = computeDropIndex(ev.clientX, drag.tabId);
      setDropIndex(newDropIndex);
    };

    const onPointerUp = () => {
      cleanupDragListeners?.();
      document.body.style.cursor = "";

      const drag = dragRef;
      if (drag?.active) {
        justDraggedRef = true;
        requestAnimationFrame(() => {
          justDraggedRef = false;
        });

        const currentDropIndex = dropIndex();
        if (
          currentDropIndex !== null &&
          drag.fromIndex !== currentDropIndex &&
          drag.fromIndex !== currentDropIndex - 1
        ) {
          const adjusted =
            currentDropIndex > drag.fromIndex
              ? currentDropIndex - 1
              : currentDropIndex;
          props.onTabReorder(drag.fromIndex, adjusted);
        }
        setDropIndex(null);
      }

      dragRef = null;
      setDragTabId(null);
    };

    cleanupDragListeners?.();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    cleanupDragListeners = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      cleanupDragListeners = undefined;
    };
  }

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const tab = props.tabs.find((t) => t.id === tabId);
    const items: ContextMenuItem[] = [
      {
        id: "close",
        label: "Close",
        icon: <i class="fa-solid fa-xmark" />,
        onClick: () => requestSingleTabClose(tabId),
      },
      {
        id: "close-others",
        label: "Close Others",
        icon: <i class="fa-solid fa-rectangle-xmark" />,
        onClick: () => requestCloseOthers(tabId),
      },
      {
        id: "close-all",
        label: "Close All",
        icon: <i class="fa-solid fa-trash" />,
        onClick: () => requestCloseAll(),
      },
      { id: "sep-actions", separator: true },
      {
        id: "duplicate",
        label: "Duplicate Tab",
        icon: <i class="fa-solid fa-clone" />,
        onClick: () => {
          const newId = props.onTabDuplicate(tabId);
          if (newId) {
            requestAnimationFrame(() => {
              if (tabBarRef) {
                tabBarRef.scrollLeft = tabBarRef.scrollWidth;
              }
            });
          }
        },
      },
      {
        id: "pin",
        label: tab?.pinned ? "Unpin Tab" : "Pin Tab",
        icon: (
          <i
            class="fa-solid fa-thumbtack"
            style={tab?.pinned ? { opacity: 0.5 } : undefined}
          />
        ),
        onClick: () => props.onTabTogglePin(tabId),
      },
    ];

    if (props.onSave) {
      items.push(
        { id: "sep-tab-1", separator: true },
        {
          id: "save-as",
          label: "Save As…",
          icon: <i class="fa-solid fa-floppy-disk" />,
          onClick: () => props.onSave!(tabId),
        },
      );
    }

    return items;
  };

  const pinnedCount = () => props.tabs.filter((t) => t.pinned).length;

  const [editorHeight, setEditorHeight] = createSignal(300);
  const [resultsCollapsed, setResultsCollapsed] = createSignal(false);
  const [showStats, setShowStats] = createSignal(false);

  createEffect(on(() => props.activeTabId, () => setShowStats(false)));
  const [aiChatWidth, setAiChatWidth] = createSignal(
    (() => {
      const saved = localStorage.getItem("sqlqs_ai_chat_width");
      const parsed = saved ? parseInt(saved, 10) : 350;
      return Math.max(350, Number.isFinite(parsed) ? parsed : 350);
    })(),
  );

  createEffect(() => {
    localStorage.setItem("sqlqs_ai_chat_width", aiChatWidth().toString());
  });

  const databaseOptions = createMemo(() =>
    (props.databases ?? []).map((db) => ({ value: db, label: db })),
  );

  const [queryCopied, setQueryCopied] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [wrapLines, setWrapLines] = createSignal(false);
  const [pendingChatMessage, setPendingChatMessage] =
    createSignal<PendingChatMessage | null>(null);
  const [editorContextMenu, setEditorContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [resultTableViewStates, setResultTableViewStates] = createSignal<
    Record<string, Record<number, ResultsTableViewState>>
  >({});
  let editorRef: SqlEditorHandle | null = null;

  const activeTab = createMemo(() =>
    Array.isArray(props.tabs)
      ? props.tabs.find((t) => t.id === props.activeTabId)
      : undefined,
  );

  function focusEditorSoon() {
    if (pendingEditorFocusFrame !== undefined) {
      cancelAnimationFrame(pendingEditorFocusFrame);
    }

    pendingEditorFocusFrame = requestAnimationFrame(() => {
      pendingEditorFocusFrame = undefined;
      const shouldSkipFocus =
        props.dialogOpen ||
        !hasDatabaseSelected() ||
        !activeTab() ||
        renamingTabId();
      if (shouldSkipFocus) return;
      editorRef?.focus();
    });
  }

  createEffect(
    on(
      () =>
        [props.activeTabId, props.currentDatabase, props.dialogOpen] as const,
      ([activeTabId, currentDatabase, dialogOpen]) => {
        if (!activeTabId || !currentDatabase || dialogOpen) return;
        focusEditorSoon();
      },
      { defer: true },
    ),
  );

  const isFirstTabActive = createMemo(() => {
    if (!props.tabs || props.tabs.length === 0) return false;
    return props.tabs[0].id === props.activeTabId;
  });

  createEffect(() => {
    const tab = activeTab();
    if (tab && !tab.result && !tab.error && !tab.isExecuting) {
      setResultsCollapsed(true);
    } else if (tab && (tab.result || tab.error)) {
      setResultsCollapsed(false);
    }
  });

  const isCompactResult = createMemo(() => {
    const tab = activeTab();
    if (!tab) return false;
    if (tab.isExecuting) return false;
    if (tab.error) return true;
    if (!tab.result || tab.result.result_sets.length === 0) return true;
    return false;
  });

  const currentResultMessage = createMemo(() => {
    const tab = activeTab();
    if (!tab) return undefined;
    if (tab.error) return tab.error;
    const result = tab.result;
    if (!result) return undefined;
    const hasRows = result.result_sets.some((rs) => rs.rows.length > 0);
    if (hasRows) return undefined;
    const lines: string[] = ["Query executed successfully."];
    if (result.rows_affected > 0) {
      lines.push(`${result.rows_affected} row(s) affected.`);
    }
    lines.push(`Execution time: ${result.elapsed_ms}ms`);
    for (const msg of result.messages) lines.push(msg);
    return lines.join("\n");
  });

  function handleExecute(selectedSql?: string) {
    if (!props.activeTabId || !hasDatabaseSelected()) return;
    setResultsCollapsed(false);
    setResultTableViewStates((prev) => {
      const next = { ...prev };
      delete next[props.activeTabId!];
      return next;
    });
    props.onExecute(props.activeTabId, selectedSql);
  }

  function handleFormatSql() {
    const tab = activeTab();
    if (!tab) return;
    try {
      const formatted = formatSqlWithPrefs(tab.sql);
      props.onTabUpdate(
        tab.id,
        { sql: formatted },
        actionHistoryOptions("Format SQL"),
      );
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

  function handleGeneratedRowSql(
    generatedSql: string,
    mode: ApplyMode = "append",
  ) {
    const tab = activeTab();
    if (!tab) return;
    switch (mode) {
      case "replace":
        props.onTabUpdate(
          tab.id,
          { sql: generatedSql },
          actionHistoryOptions("AI Replace"),
        );
        break;
      case "new-tab":
        props.onTabAdd(generatedSql);
        break;
      case "append":
      default: {
        const currentSql = tab.sql.trimEnd();
        const nextSql = currentSql
          ? `${currentSql}\n\n${generatedSql}`
          : generatedSql;
        props.onTabUpdate(
          tab.id,
          { sql: nextSql },
          actionHistoryOptions("AI Append"),
        );
        break;
      }
    }
    setResultsCollapsed(true);
    editorRef?.focus();
    requestAnimationFrame(() => editorRef?.scrollToBottom());
  }

  function handleEditorContextMenu(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setEditorContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }

  const getResultTableViewStates = (tabId: string) =>
    resultTableViewStates()[tabId] ?? {};

  function handleResultTableViewStateChange(
    tabId: string,
    resultSetIndex: number,
    state: ResultsTableViewState,
  ) {
    setResultTableViewStates((prev) => ({
      ...prev,
      [tabId]: {
        ...(prev[tabId] ?? {}),
        [resultSetIndex]: state,
      },
    }));
  }

  function handleSendSelectionToChat() {
    const selectedText = editorRef?.getSelectedText() ?? "";
    if (!selectedText.trim()) return;

    props.onAiChatOpenChange(true);
    setPendingChatMessage({
      id: Date.now(),
      pinnedContext: {
        id: `selected-sql-${Date.now()}`,
        label: "Selected SQL",
        icon: "i-cursor",
        content: selectedText,
      },
    });
  }

  async function handleCopySelection() {
    const selectedText = editorRef?.getSelectedText() ?? "";
    if (!selectedText) return;
    try {
      await invoke("write_clipboard", { text: selectedText });
    } catch (err) {
      console.error("Failed to copy selection:", err);
    } finally {
      editorRef?.focus();
    }
  }

  async function handleCutSelection() {
    const selectedText = editorRef?.getSelectedText() ?? "";
    if (!selectedText) return;
    try {
      await invoke("write_clipboard", { text: selectedText });
      const tab = activeTab();
      if (tab) {
        props.onTabUpdate(tab.id, {}, captureActionHistoryOptions("Cut"));
      }
      editorRef?.replaceSelection("");
    } catch (err) {
      console.error("Failed to cut selection:", err);
    } finally {
      editorRef?.focus();
    }
  }

  async function handlePaste(format = false) {
    try {
      const text = await invoke<string>("read_clipboard");
      if (!text) return;
      if (!editorRef) return;
      const nextText = format ? formatSqlWithPrefs(text) : text;
      const tab = activeTab();
      if (tab) {
        props.onTabUpdate(
          tab.id,
          {},
          captureActionHistoryOptions(format ? "Paste Formatted" : "Paste"),
        );
      }
      editorRef.replaceSelection(nextText);
    } catch (err) {
      console.error("Failed to paste into editor:", err);
    } finally {
      editorRef?.focus();
    }
  }

  function handleSendResultErrorToChat(error: string) {
    if (!error.trim()) return;

    props.onAiChatOpenChange(true);
    setPendingChatMessage({
      id: Date.now(),
      pinnedContext: {
        id: `error-${Date.now()}`,
        label: "Error Message",
        icon: "circle-exclamation",
        content: error,
      },
    });
  }

  function handleSendResultToChat(markdown: string) {
    if (!markdown.trim()) return;

    props.onAiChatOpenChange(true);
    setPendingChatMessage({
      id: Date.now(),
      pinnedContext: {
        id: `result-table-${Date.now()}`,
        label: "Result table",
        icon: "table",
        content: markdown,
      },
    });
  }

  const getEditorContextMenuItems = (): ContextMenuItem[] => {
    const selectedText = editorRef?.getSelectedText() ?? "";
    const hasSelectedText = Boolean(selectedText.trim());
    const tab = activeTab();
    const canRestoreHistory =
      !!tab && hasDatabaseSelected() && hasRestorableHistory(tab);
    return [
      {
        id: "execute",
        label: hasSelectedText ? "Execute Selection" : "Execute",
        icon: <i class="fa-solid fa-play" />,
        shortcut: "F5",
        onClick: () => handleExecute(selectedText),
        disabled:
          !props.connected ||
          !hasDatabaseSelected() ||
          !tab?.sql.trim() ||
          tab?.isExecuting,
      },
      { id: "sep-1", separator: true },
      {
        id: "cut-selection",
        label: "Cut",
        icon: <i class="fa-solid fa-scissors" />,
        shortcut: "Ctrl+X",
        onClick: () => void handleCutSelection(),
        disabled: !hasSelectedText,
      },
      {
        id: "copy-selection",
        label: "Copy",
        icon: <i class="fa-solid fa-copy" />,
        shortcut: "Ctrl+C",
        onClick: () => void handleCopySelection(),
        disabled: !hasSelectedText,
      },
      {
        id: "paste",
        label: "Paste",
        icon: <i class="fa-solid fa-paste" />,
        shortcut: "Ctrl+V",
        onClick: () => void handlePaste(),
        disabled: !tab,
      },
      {
        id: "paste-formatted",
        label: "Paste Formatted",
        icon: <IconFormat />,
        onClick: () => void handlePaste(true),
        disabled: !tab,
      },
      {
        id: "select-all",
        label: "Select All",
        icon: <i class="fa-solid fa-check-double" />,
        shortcut: "Ctrl+A",
        onClick: () => editorRef?.selectAll(),
        disabled: !tab?.sql,
      },
      { id: "sep-copy", separator: true },
      {
        id: "send-selection-to-chat",
        label: "Send to Chat",
        icon: <i class="fa-solid fa-comment-dots" />,
        onClick: handleSendSelectionToChat,
        disabled: !hasSelectedText,
      },
      { id: "sep-2", separator: true },
      {
        id: "format",
        label: "Format",
        icon: <IconFormat />,
        onClick: handleFormatSql,
        disabled: !hasDatabaseSelected() || !tab?.sql.trim(),
      },
      {
        id: "text-history",
        label: "Text History",
        icon: <IconHistory />,
        onClick: () => setHistoryOpen(true),
        disabled: !canRestoreHistory,
      },
    ];
  };

  function handleEditorResizerDoubleClick(e: MouseEvent) {
    e.preventDefault();
    setEditorHeight(300);
  }

  function handleEditorResize(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorHeight();
    const onMove = (ev: MouseEvent) => {
      const newHeight = Math.max(
        100,
        Math.min(800, startHeight + ev.clientY - startY),
      );
      setEditorHeight(newHeight);
    };
    const onUp = () => {
      cleanupEditorResizeListeners?.();
    };
    cleanupEditorResizeListeners?.();
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    cleanupEditorResizeListeners = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      cleanupEditorResizeListeners = undefined;
    };
  }

  createEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || shouldIgnoreTabShortcutTarget(e.target)) return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (isCtrlOrMeta && !e.altKey) {
        if (!e.shiftKey) {
          if (e.key.toLowerCase() === "t") {
            e.preventDefault();
            props.onTabAdd();
            requestAnimationFrame(() => {
              if (tabBarRef) {
                tabBarRef.scrollLeft = tabBarRef.scrollWidth;
              }
            });
            return;
          }
          if (e.key.toLowerCase() === "w") {
            e.preventDefault();
            if (props.activeTabId) {
              requestSingleTabClose(props.activeTabId);
            }
            return;
          }
          if (e.key >= "1" && e.key <= "9") {
            const index = parseInt(e.key, 10) - 1;
            if (index < props.tabs.length) {
              e.preventDefault();
              props.onTabChange(props.tabs[index].id);
            }
            return;
          }
        }

        if (e.key === "PageDown") {
          e.preventDefault();
          const currentTabs = props.tabs;
          const activeId = props.activeTabId;
          const index = currentTabs.findIndex((t) => t.id === activeId);
          if (index !== -1 && currentTabs.length > 1) {
            const nextIndex = (index + 1) % currentTabs.length;
            props.onTabChange(currentTabs[nextIndex].id);
          }
          return;
        }
        if (e.key === "PageUp") {
          e.preventDefault();
          const currentTabs = props.tabs;
          const activeId = props.activeTabId;
          const index = currentTabs.findIndex((t) => t.id === activeId);
          if (index !== -1 && currentTabs.length > 1) {
            const prevIndex = (index - 1 + currentTabs.length) % currentTabs.length;
            props.onTabChange(currentTabs[prevIndex].id);
          }
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      {(() => {
        const tab = activeTab();
        return tab && props.connected ? (
          <div class="flex flex-row flex-1 min-h-0 overflow-hidden">
          <div class="flex flex-col flex-1 min-w-0 min-h-0">
            <div
              class={`editor-island flex flex-col min-w-0 overflow-hidden ${
                resultsCollapsed() || isCompactResult()
                  ? "flex-1"
                  : "flex-shrink-0"
              }`}
              style={
                resultsCollapsed() || isCompactResult()
                  ? undefined
                  : { height: `${editorHeight()}px` }
              }
            >
              <div class="flex items-stretch justify-between flex-shrink-0 min-w-0 bg-transparent h-9">
                <div class="flex items-stretch min-w-0 flex-shrink overflow-hidden h-full">
                  {props.tabs.length > 0 && (
                    <>
                      <div
                        ref={setTabBarRef}
                        on:mousedown={(e: MouseEvent) => {
                          if (e.button === 1) e.preventDefault();
                        }}
                        role="tablist"
                        class="flex overflow-x-auto overflow-y-hidden tab-bar min-w-0 h-full"
                      >
                        <For each={props.tabs}>
                          {(tab, index) => {
                            const isActive = () => tab.id === props.activeTabId;
                            const isDragging = () => tab.id === dragTabId();
                            const isModified = () => tab.sql !== tab.savedSql;
                            const showDropBefore = () =>
                              dropIndex() === index();
                            const showDropAfter = () =>
                              dropIndex() === index() + 1 &&
                              index() === props.tabs.length - 1;
                            const showPinDivider = () =>
                              tab.pinned &&
                              index() === pinnedCount() - 1 &&
                              pinnedCount() < props.tabs.length;

                            return (
                              <div class="flex items-center flex-shrink-0">
                                {showDropBefore() && (
                                  <div class="tab-drop-indicator" />
                                )}
                                <div
                                  ref={(el) => {
                                    if (isActive())
                                      el.scrollIntoView({
                                        block: "nearest",
                                        inline: "nearest",
                                      });
                                  }}
                                  data-tab-index={index()}
                                  onPointerDown={(e) =>
                                    handleTabPointerDown(e, tab.id, index())
                                  }
                                  role="tab"
                                  tabIndex={0}
                                  aria-selected={isActive()}
                                  onKeyDown={(e) => {
                                    if (
                                      (e.target as Element).closest(
                                        "input, button",
                                      )
                                    )
                                      return;
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      props.onTabChange(tab.id);
                                    }
                                  }}
                                  class={`tab flex items-center gap-2 text-s whitespace-nowrap select-none flex-shrink-0 tab-animate-in ${isActive() ? "active text-text cursor-default" : "text-text-muted cursor-pointer"} ${isDragging() ? "dragging" : ""} ${tab.pinned ? "pinned" : ""} ${tab.temporary ? "temporary" : ""}`}
                                  onClick={() => {
                                    if (justDraggedRef) return;
                                    props.onTabChange(tab.id);
                                  }}
                                  onDblClick={() => {
                                    if (tab.temporary) {
                                      props.onTabPromote(tab.id);
                                      return;
                                    }
                                    handleStartRename(tab);
                                  }}
                                  on:mousedown={(e: MouseEvent) => {
                                    if (e.button === 1) {
                                      e.preventDefault();
                                      requestSingleTabClose(tab.id);
                                    }
                                  }}
                                  onContextMenu={(e) =>
                                    handleTabContextMenu(e, tab.id)
                                  }
                                >
                                  {tab.pinned && (
                                    <i class="fa-solid fa-thumbtack text-[9px] text-text-muted pin-icon" />
                                  )}
                                  <div class="flex-1 min-w-0 mr-2">
                                    {renamingTabId() === tab.id ? (
                                      <input
                                        ref={renameInputRef}
                                        type="text"
                                        name="tab-title"
                                        autocomplete="off"
                                        aria-label="Rename tab"
                                        value={renameValue()}
                                        onInput={(e) =>
                                          setRenameValue(e.currentTarget.value)
                                        }
                                        onBlur={() => handleRename(tab.id)}
                                        onKeyDown={(e) =>
                                          handleRenameKeyDown(e, tab.id)
                                        }
                                        class="bg-transparent border-none outline-none text-s w-full min-w-0"
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                    ) : (
                                      <span
                                        class="tab-title truncate block"
                                        data-text={tab.title}
                                      >
                                        {tab.title}
                                      </span>
                                    )}
                                  </div>
                                  <div class="flex items-center justify-center w-5 h-5 flex-shrink-0 relative">
                                    {tab.isExecuting && (
                                      <span class="animate-pulse text-warning text-s absolute">
                                        &#9679;
                                      </span>
                                    )}
                                    {isModified() && !tab.isExecuting && (
                                      <span
                                        class="modified-dot absolute"
                                        title="Unsaved changes"
                                      />
                                    )}
                                    <button
                                      type="button"
                                      aria-label={`Close ${tab.title}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        requestSingleTabClose(tab.id);
                                      }}
                                      class={`tab-close-btn relative flex items-center justify-center rounded hover:bg-surface-active text-text-muted hover:text-text cursor-pointer ${isActive() ? "active" : ""}`}
                                    >
                                      <i class="fa-solid fa-xmark text-s" />
                                    </button>
                                  </div>
                                </div>
                                {showDropAfter() && (
                                  <div class="tab-drop-indicator" />
                                )}
                                {showPinDivider() && (
                                  <div class="pin-divider" />
                                )}
                              </div>
                            );
                          }}
                        </For>
                      </div>
                      <div class="ui-divider mx-1.5 self-center" />
                    </>
                  )}
                  <Tooltip content="New Query" placement="bottom">
                    <button
                      type="button"
                      aria-label="New Query"
                      onClick={() => {
                        props.onTabAdd();
                        requestAnimationFrame(() => {
                          if (tabBarRef) {
                            tabBarRef.scrollLeft = tabBarRef.scrollWidth;
                          }
                        });
                      }}
                      class="control-icon-btn control-icon-btn-sm ml-0 mr-1.5 self-center"
                    >
                      <i class="fa-solid fa-plus text-s" />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div
                class={`app-panel flex flex-col flex-1 min-w-0 min-h-0 ${
                  isFirstTabActive() ? "rounded-tl-none" : ""
                }`}
              >
                <div class="editor-toolbar-frame flex items-center gap-6 p-2 flex-shrink-0 min-w-0 mx-3 mt-3 mb-2">
                  <div class="flex items-center gap-2 flex-shrink-0">
                    {(props.databases ?? []).length > 0 &&
                      props.onDatabaseChange && (
                        <Dropdown
                          value={props.currentDatabase || ""}
                          options={databaseOptions()}
                          onChange={props.onDatabaseChange!}
                          placeholder="Select database"
                          class="w-48"
                          filterable
                          compact
                        />
                      )}
                    <Tooltip content="Execute (F5)" placement="bottom">
                      <button
                        type="button"
                        onClick={() =>
                          void handleExecute(editorRef?.getSelectedText())
                        }
                        disabled={
                          !props.connected ||
                          !hasDatabaseSelected() ||
                          !tab.sql.trim() ||
                          tab.isExecuting
                        }
                        class="btn btn-primary btn-compact btn-execute"
                      >
                        <IconPlay />
                        <span>Execute</span>
                      </button>
                    </Tooltip>
                  </div>

                  <div class="grow shrink-0 flex items-center gap-1 justify-center">
                    <Tooltip content="Copy SQL" placement="bottom">
                      <button
                        type="button"
                        aria-label={queryCopied() ? "SQL copied" : "Copy SQL"}
                        onClick={handleCopyQuery}
                        disabled={!hasDatabaseSelected() || !tab.sql.trim()}
                        class="btn btn-icon"
                      >
                        <IconCopy
                          class={`w-3 h-3 ${queryCopied() ? "text-success" : ""}`}
                        />
                      </button>
                    </Tooltip>

                    <div class="toolbar-sep" />

                    <Tooltip content="Format SQL" placement="bottom">
                      <button
                        type="button"
                        aria-label="Format SQL"
                        onClick={handleFormatSql}
                        disabled={!hasDatabaseSelected() || !tab.sql.trim()}
                        class="btn btn-icon"
                      >
                        <IconFormat class="w-3 h-3" />
                      </button>
                    </Tooltip>

                    <Tooltip
                      content={
                        wrapLines() ? "Disable Word Wrap" : "Enable Word Wrap"
                      }
                      placement="bottom"
                    >
                      <button
                        type="button"
                        aria-label={
                          wrapLines() ? "Disable Word Wrap" : "Enable Word Wrap"
                        }
                        onClick={() => setWrapLines(!wrapLines())}
                        disabled={!hasDatabaseSelected() || !tab.sql.trim()}
                        class={`btn btn-icon ${wrapLines() ? "btn-toggled" : ""}`}
                      >
                        <IconWrapText class="w-3 h-3" />
                      </button>
                    </Tooltip>

                    {(props.onSave || props.onSaveToFile) && (
                      <>
                        <div class="toolbar-sep" />
                        {props.onSave && (
                          <Tooltip content="Save SQL" placement="bottom">
                            <button
                              type="button"
                              aria-label="Save SQL"
                              onClick={() => props.onSave!(tab.id)}
                              disabled={!hasDatabaseSelected() || !tab.sql.trim()}
                              class="btn btn-icon"
                            >
                              <IconSave class="w-3 h-3" />
                            </button>
                          </Tooltip>
                        )}

                        {props.onSaveToFile && (
                          <Tooltip
                            content="Save SQL to file"
                            placement="bottom"
                          >
                            <button
                              type="button"
                              aria-label="Save SQL to file"
                              onClick={() => props.onSaveToFile!(tab.id)}
                              disabled={!hasDatabaseSelected() || !tab.sql.trim()}
                              class="btn btn-icon"
                            >
                              <IconFloppy class="w-3 h-3" />
                            </button>
                          </Tooltip>
                        )}
                      </>
                    )}

                    <Tooltip content="Find" placement="bottom">
                      <button
                        type="button"
                        aria-label="Find"
                        onClick={() => editorRef?.openSearch()}
                        disabled={!hasDatabaseSelected() || !tab.sql.trim()}
                        class={`btn btn-icon ${searchOpen() ? "btn-toggled" : ""}`}
                      >
                        <IconSearch class="w-3 h-3" />
                      </button>
                    </Tooltip>
                  </div>

                  <div class="w-[280px] shrink flex items-center justify-end">
                    <Tooltip
                      content={
                        !hasDatabaseSelected()
                          ? "Choose a database to restore text history"
                          : (tab.history?.length ?? 0) > 0
                            ? hasRestorableHistory(tab)
                            ? "Text History"
                            : "No previous text to restore"
                            : "No text history yet"
                      }
                      placement="bottom"
                    >
                      <button
                        type="button"
                        aria-label="Text History"
                        onClick={() => setHistoryOpen(true)}
                        disabled={
                          !hasDatabaseSelected() || !hasRestorableHistory(tab)
                        }
                        class="btn btn-secondary btn-compact"
                      >
                        <IconHistory class="w-3 h-3" />
                        <span>History</span>
                        <span class="btn-table-badge">
                          {restorableHistoryCount(tab)}
                        </span>
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <div class="relative flex-1 min-w-0 min-h-0">
                  <SqlEditor
                    value={tab.sql}
                    onChange={(val: string, options?: QueryTabUpdateOptions) =>
                      props.onTabUpdate(tab.id, { sql: val }, options)
                    }
                    onExecute={handleExecute}
                    readOnly={!hasDatabaseSelected()}
                    theme={props.theme}
                    currentDatabase={props.currentDatabase}
                    onContextMenu={handleEditorContextMenu}
                    onRef={(handle) => (editorRef = handle)}
                    onSearchPanelChange={setSearchOpen}
                    wrapLines={wrapLines()}
                  />
                  {!hasDatabaseSelected() && (
                    <div class="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,var(--color-surface-panel)_76%,transparent)]">
                      <div class="mx-6 flex max-w-[280px] flex-col items-center gap-3 rounded-xl border border-border bg-surface-panel px-6 py-5 text-center">
                        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-active text-accent">
                          <i class="fa-solid fa-database text-s" />
                        </div>
                        <div class="space-y-1">
                          <p class="text-m font-semibold text-text">
                            Choose a database
                          </p>
                          <p class="text-s leading-relaxed text-text-muted">
                            Select a database from the dropdown above to start
                            editing and run queries.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!resultsCollapsed() && !isCompactResult() && (
              <div
                class="resizer resizer-v"
                onMouseDown={handleEditorResize}
                onDblClick={handleEditorResizerDoubleClick}
              />
            )}

            <div
              class={`results-island app-panel flex flex-col ${
                resultsCollapsed() || isCompactResult()
                  ? "flex-none mt-[var(--layout-gap)]"
                  : "flex-1"
              }`}
            >
              <div class="flex items-center justify-between p-2.5 flex-shrink-0">
                <div class="flex items-center gap-2">
                  <span class="app-section-title">Results</span>
                </div>
                <div class="flex items-center gap-2">
                  <Show when={tab.result?.statistics}>
                    <button
                      type="button"
                      onClick={() => setShowStats(true)}
                      disabled={tab.isExecuting}
                      class="btn btn-secondary"
                    >
                      <i class="fa-solid fa-chart-simple" />
                      <span>Statistics</span>
                    </button>
                  </Show>
                  <button
                    type="button"
                    onClick={() => setResultsCollapsed(!resultsCollapsed())}
                    class="btn btn-secondary"
                  >
                    <i
                      class={`fa-solid fa-chevron-${resultsCollapsed() ? "up" : "down"}`}
                    />
                    <span>{resultsCollapsed() ? "Expand" : "Collapse"}</span>
                  </button>
                </div>
              </div>
              {!resultsCollapsed() && (
                <div
                  class={isCompactResult() ? "min-h-[200px]" : "flex-1 min-h-0"}
                >
                  <ResultsGrid
                    result={tab.result}
                    error={tab.error}
                    isExecuting={tab.isExecuting}
                    sourceSql={tab.sql}
                    tableViewStates={getResultTableViewStates(tab.id)}
                    onTableViewStateChange={(resultSetIndex, state) =>
                      handleResultTableViewStateChange(
                        tab.id,
                        resultSetIndex,
                        state,
                      )
                    }
                    onGenerateSql={handleGeneratedRowSql}
                    onReExecute={() => handleExecute()}
                    onSendErrorToChat={handleSendResultErrorToChat}
                    onSendResultToChat={handleSendResultToChat}
                  />
                </div>
              )}
            </div>
          </div>

          {props.aiChatOpen && (
            <AIChatPanel
              currentCode={tab.sql}
              currentDatabase={props.currentDatabase}
              currentResultMessage={currentResultMessage()}
              onApplyCode={handleGeneratedRowSql}
              width={aiChatWidth()}
              onWidthChange={setAiChatWidth}
              pendingMessage={pendingChatMessage()}
              onPendingMessageHandled={(id) => {
                setPendingChatMessage((current) =>
                  current?.id === id ? null : current,
                );
              }}
            />
          )}
          </div>
        ) : (
          <div class="app-panel flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
          {props.connected ? (
            <>
              <i class="fa-solid fa-terminal text-3xl opacity-20" />
              <p class="text-m">No open queries</p>
              <div class="empty-state-actions mt-1">
                {props.onOpenSqlFile && (
                  <button
                    type="button"
                    onClick={props.onOpenSqlFile}
                    class="btn btn-primary empty-state-btn"
                  >
                    <i class="fa-regular fa-folder" />
                    <span class="empty-state-btn-label">Open File</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => props.onTabAdd()}
                  class="btn btn-secondary empty-state-btn"
                >
                  <i class="fa-solid fa-plus" />
                  <span class="empty-state-btn-label">New File</span>
                </button>
              </div>
              <Show when={(props.executedQueries ?? []).length > 0}>
                <div class="mt-6 w-full max-w-[320px]">
                  <div class="border-t border-border/30 pt-4">
                    <p class="text-s font-medium text-text-muted/60 mb-3 text-center flex items-center justify-center gap-1.5">
                      <i class="fa-solid fa-clock-rotate-left text-xs" />
                      Recent queries
                    </p>
                    <div class="flex flex-col gap-1">
                      <For each={(props.executedQueries ?? []).slice(0, 5)}>
                        {(item) => (
                          <Tooltip content={item.title} placement="top">
                            <button
                              type="button"
                              onClick={() =>
                                props.onTabAdd(item.sql, item.title)
                              }
                              class="w-full text-left px-3 py-2 rounded-md text-s text-text-muted hover:text-text hover:bg-surface-hover transition-colors cursor-pointer block truncate"
                            >
                              {item.title}
                            </button>
                          </Tooltip>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Show>
            </>
          ) : (props.isInitializing ?? false) ? (
            <>
              <i class="fa-solid fa-spinner animate-spin text-3xl opacity-30" />
              <p class="text-m">Connecting to your server…</p>
              <p class="text-s opacity-60">Restoring your last session</p>
            </>
          ) : (
            <>
              <i class="fa-solid fa-plug-circle-xmark text-3xl opacity-20" />
              <p class="text-m">Not connected to a server</p>
              <p class="text-s opacity-60">
                Connect to a SQL Server to start running queries
              </p>
              {props.onConnect && (
                <button
                  type="button"
                  onClick={props.onConnect}
                  class="btn btn-primary empty-state-btn mt-1"
                >
                  <i class="fa-solid fa-plug" />
                  <span class="empty-state-btn-label">Connect Server</span>
                </button>
              )}
            </>
          )}
          </div>
        );
      })()}
      {editorContextMenu()?.visible && (
        <ContextMenu
          items={getEditorContextMenuItems()}
          x={editorContextMenu()!.x}
          y={editorContextMenu()!.y}
          onClose={() => setEditorContextMenu(null)}
        />
      )}

      {tabContextMenu()?.visible && (
        <ContextMenu
          items={getTabContextMenuItems(tabContextMenu()!.tabId)}
          x={tabContextMenu()!.x}
          y={tabContextMenu()!.y}
          onClose={() => setTabContextMenu(null)}
        />
      )}

      {confirmClose() && (
        <ConfirmDialog
          title={
            confirmClose()!.type === "single"
              ? "Close Tab"
              : confirmClose()!.type === "others"
                ? "Close Other Tabs"
                : "Close All Tabs"
          }
          message={
            confirmClose()!.type === "single"
              ? "Are you sure you want to close this tab? Any unsaved changes will be lost."
              : confirmClose()!.type === "others"
                ? "Are you sure you want to close all other tabs? Any unsaved changes will be lost."
                : "Are you sure you want to close all tabs? Any unsaved changes will be lost."
          }
          confirmLabel={
            confirmClose()!.type === "single" ? "Close" : "Close All"
          }
          variant="danger"
          onConfirm={() => {
            const cc = confirmClose()!;
            if (cc.type === "single" && cc.tabId) {
              props.onTabClose(cc.tabId);
            } else if (cc.type === "others" && cc.tabId) {
              props.onTabCloseOthers(cc.tabId);
            } else if (cc.type === "all") {
              props.onTabCloseAll();
            }
            setConfirmClose(null);
          }}
          onCancel={() => setConfirmClose(null)}
        />
      )}

      <Show when={historyOpen() && activeTab()}>
        {(tab) => (
          <EditorHistoryDialog
            tab={tab()}
            onClose={() => setHistoryOpen(false)}
            onRestore={(sql) => {
              if (!hasDatabaseSelected()) return;
              props.onTabUpdate(
                tab().id,
                { sql },
                actionHistoryOptions("Restore"),
              );
            }}
          />
        )}
      </Show>

      <Show when={showStats() && activeTab()?.result?.statistics}>
        {(stats) => (
          <StatisticsDialog
            statistics={stats()}
            onClose={() => setShowStats(false)}
          />
        )}
      </Show>
    </div>
  );
}
