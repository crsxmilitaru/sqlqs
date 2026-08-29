import {
  createEffect,
  createMemo,
  createSignal,
  For,
  lazy,
  on,
  Show,
  Suspense,
  onCleanup,
} from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import type {
  ExecutedQuery,
  QueryTab,
  QueryTabUpdateOptions,
  TabGroup,
  TabGroupColor,
} from "../../lib/types";
import type { ApplyMode, PendingChatMessage } from "../ai/AIChatPanel";
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
  IconStop,
  IconWrapText,
} from "../ui/Icons";
import EditorHistoryDialog from "./EditorHistoryDialog";
import ResultsGrid, { type ResultsTableViewState } from "./ResultsGrid";
import type { SqlEditorHandle } from "./SqlEditor";
import Tooltip from "../ui/Tooltip";
import { Loader } from "../ui/Loader";
import { formatSqlWithPrefs } from "../../lib/sql-format";
import { AiService } from "../../lib/ai";
import ConfirmDialog from "../ui/ConfirmDialog";
import { loadPreferences } from "../../lib/settings";
import type { ThemeSelection } from "../../lib/theme";
import StatisticsDialog from "../dialogs/StatisticsDialog";
import EditorTabBar from "./EditorTabBar";
import {
  hasNavigationRestore,
  type EditorNavigationPoint,
} from "../../lib/editor-navigation";

const SqlEditor = lazy(() => import("./SqlEditor"));
const loadAIChatPanel = () => import("../ai/AIChatPanel");
const AIChatPanel = lazy(loadAIChatPanel);

const DEFAULT_EDITOR_HEIGHT = 300;
const MIN_EDITOR_HEIGHT = 100;
const MAX_EDITOR_HEIGHT = 800;
const MIN_RESULTS_PANEL_HEIGHT = 200;
const MIN_RESULTS_TABLE_PANEL_HEIGHT = 300;
const EDITOR_RESULTS_RESIZER_HEIGHT = 8;

function isTabDirty(tab: QueryTab): boolean {
  return tab.sql !== tab.savedSql;
}

function hasRestorableHistory(tab: QueryTab): boolean {
  return (tab.history ?? []).some(
    (entry) => entry.sql && entry.sql !== tab.sql,
  );
}

function restorableHistoryCount(tab: QueryTab): number {
  return (tab.history ?? []).filter(
    (entry) => entry.sql && entry.sql !== tab.sql,
  ).length;
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
  groups: TabGroup[];
  activeTabId: string;
  onTabChange: (id: string) => void;
  onTabAdd: (sql?: string, title?: string, groupId?: string) => string;
  onTabClose: (id: string) => void;
  onTabCloseOthers: (id: string) => void;
  onTabCloseAll: () => void;
  onTabUpdate: (
    id: string,
    updates: Partial<QueryTab>,
    options?: QueryTabUpdateOptions,
  ) => void;
  onTabMove: (
    fromIndex: number,
    toIndex: number,
    groupId?: string | null,
    options?: { moveGroupId?: string },
  ) => void;
  onTabDuplicate: (id: string) => string;
  onTabTogglePin: (id: string) => void;
  onTabPromote: (id: string) => void;
  onTabReopen: () => string;
  canReopenClosedTab: () => boolean;
  onTabCreateGroup: (tabIds: string[], name?: string) => string;
  onTabAddToGroup: (groupId: string, tabIds: string[]) => void;
  onTabRemoveFromGroup: (tabIds: string[]) => void;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupSetColor: (groupId: string, color: TabGroupColor) => void;
  onGroupToggleCollapsed: (groupId: string) => void;
  onRevealTab?: (tabId: string) => void;
  onGroupUngroup: (groupId: string) => void;
  onGroupClose: (groupId: string) => void;
  onOpenSqlFile?: () => void;
  onExecute: (id: string, customSql?: string) => void;
  onCancelQuery?: (id: string) => void;
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
  onNavigationPoint?: (point: EditorNavigationPoint) => void;
  onEditorHandle?: (handle: SqlEditorHandle | null) => void;
}

export default function QueryEditorPanel(props: Props) {
  const hasDatabaseSelected = () => Boolean(props.currentDatabase);

  const [confirmClose, setConfirmClose] = createSignal<{
    type: "single" | "others" | "all" | "group" | "multiple";
    tabId?: string;
    groupId?: string;
    tabIds?: string[];
  } | null>(null);

  const [tabBarRenaming, setTabBarRenaming] = createSignal(false);
  let tabBarRef: HTMLDivElement | undefined;
  let tabBarContextMenuHandler: ((e: MouseEvent) => void) | undefined;
  let savedTabBarScrollLeft = 0;
  let cleanupTabBarWheelListener: (() => void) | undefined;
  let cleanupEditorResizeListeners: (() => void) | undefined;
  let pendingEditorFocusFrame: number | undefined;

  onCleanup(() => {
    if (pendingEditorFocusFrame !== undefined) {
      cancelAnimationFrame(pendingEditorFocusFrame);
    }
    cleanupTabBarWheelListener?.();
    cleanupEditorResizeListeners?.();
  });

  function handleTabReopen() {
    const id = props.onTabReopen();
    if (!id) return;
    requestAnimationFrame(() => {
      if (tabBarRef) {
        tabBarRef.scrollLeft = tabBarRef.scrollWidth;
      }
    });
  }

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

    const handleTabBarScroll = () => {
      savedTabBarScrollLeft = el.scrollLeft;
    };

    el.addEventListener("wheel", handleTabBarWheel, { passive: true });
    el.addEventListener("scroll", handleTabBarScroll, { passive: true });
    requestAnimationFrame(() => {
      el.scrollLeft = savedTabBarScrollLeft;
    });
    cleanupTabBarWheelListener = () => {
      el.removeEventListener("wheel", handleTabBarWheel);
      el.removeEventListener("scroll", handleTabBarScroll);
      if (tabBarRef === el) {
        tabBarRef = undefined;
      }
    };
  }

  function handleTabRowDoubleClick(e: MouseEvent) {
    if (
      (e.target as Element).closest(
        ".tab, .tab-group-header, .tab-group, button, input, .ui-divider",
      )
    ) {
      return;
    }
    props.onTabAdd();
    requestAnimationFrame(() => {
      if (tabBarRef) {
        tabBarRef.scrollLeft = tabBarRef.scrollWidth;
      }
    });
  }

  function requestCloseGroup(groupId: string) {
    const members = props.tabs.filter((tab) => tab.groupId === groupId);
    const shouldConfirm = loadPreferences().confirmCloseUnsaved;
    const hasDirty = members.some((tab) => isTabDirty(tab));
    if (!shouldConfirm || !hasDirty) {
      props.onGroupClose(groupId);
      return;
    }
    setConfirmClose({ type: "group", groupId });
  }

  function requestCloseTabs(tabIds: string[]) {
    const targets = props.tabs.filter((tab) => tabIds.includes(tab.id));
    const shouldConfirm = loadPreferences().confirmCloseUnsaved;
    const hasDirty = targets.some(
      (tab) => !tab.temporary && isTabDirty(tab),
    );
    if (!shouldConfirm || !hasDirty) {
      for (const tab of targets) {
        props.onTabClose(tab.id);
      }
      return;
    }
    setConfirmClose({ type: "multiple", tabIds });
  }

  const pinnedCount = () => props.tabs.filter((t) => t.pinned).length;

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

  const [editorHeight, setEditorHeight] = createSignal(DEFAULT_EDITOR_HEIGHT);
  const [resultsCollapsed, setResultsCollapsed] = createSignal(false);
  const [resultsMaximized, setResultsMaximized] = createSignal(false);
  let editorHeightBeforeMaximize = DEFAULT_EDITOR_HEIGHT;
  const [showStats, setShowStats] = createSignal(false);
  const [elapsedMs, setElapsedMs] = createSignal(0);

  createEffect(on(() => props.activeTabId, () => setShowStats(false)));

  let elapsedTimer: ReturnType<typeof setInterval> | undefined;
  const [cancellingTabId, setCancellingTabId] = createSignal<string | null>(
    null,
  );

  createEffect(
    on(
      () => {
        const tab = activeTab();
        return [
          props.activeTabId,
          tab?.isExecuting ?? false,
          tab?.execStartedAt,
        ] as const;
      },
      ([_tabId, isExecuting, execStartedAt]) => {
        if (elapsedTimer !== undefined) {
          clearInterval(elapsedTimer);
          elapsedTimer = undefined;
        }

        if (isExecuting) {
          const startMark = execStartedAt ?? performance.now();
          const tick = () => {
            setElapsedMs(Math.max(0, performance.now() - startMark));
          };
          tick();
          elapsedTimer = setInterval(tick, 100);
          return;
        }

        setElapsedMs(0);
      },
    ),
  );

  createEffect(() => {
    const id = cancellingTabId();
    if (!id) return;
    const tab = props.tabs.find((t) => t.id === id);
    if (!tab?.isExecuting) setCancellingTabId(null);
  });

  onCleanup(() => {
    if (elapsedTimer !== undefined) {
      clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
  });

  const formattedElapsed = createMemo(() => {
    const ms = elapsedMs();
    if (ms <= 0) return "";
    const seconds = ms / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)}s`;
    return `${Math.floor(seconds)}s`;
  });

  function handleCancelExecute() {
    const tab = activeTab();
    if (!tab?.isExecuting || cancellingTabId() === tab.id) return;
    setCancellingTabId(tab.id);
    props.onCancelQuery?.(tab.id);
  }
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
  onCleanup(() => props.onEditorHandle?.(null));

  function handleNavigateTab(id: string) {
    if (id !== props.activeTabId) {
      props.onRevealTab?.(id);
    }
    props.onTabChange(id);
  }

  createEffect(() => {
    if (!props.connected) return;
    void import("./SqlEditor");
    const preloadAi = () => {
      void loadAIChatPanel();
      void AiService.listAvailableModels();
    };
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(preloadAi, { timeout: 1500 });
      onCleanup(() => window.cancelIdleCallback(idle));
      return;
    }
    const timeout = window.setTimeout(preloadAi, 400);
    onCleanup(() => window.clearTimeout(timeout));
  });

  const activeTab = createMemo(() =>
    Array.isArray(props.tabs)
      ? props.tabs.find((t) => t.id === props.activeTabId)
      : undefined,
  );

  createEffect(() => {
    const ids = props.tabs.map((tab) => tab.id);
    editorRef?.retainStates(ids);
  });
  const isActiveExecuting = createMemo(() => activeTab()?.isExecuting === true);
  const isActiveCancelling = createMemo(
    () => cancellingTabId() === props.activeTabId && isActiveExecuting(),
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
        tabBarRenaming();
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
        if (hasNavigationRestore(activeTabId)) return;
        focusEditorSoon();
      },
      { defer: true },
    ),
  );

  createEffect(
    on(
      () => props.activeTabId,
      (activeTabId) => {
        if (!activeTabId) return;
        requestAnimationFrame(() => {
          tabBarRef
            ?.querySelector('[role="tab"][aria-selected="true"]')
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
      },
      { defer: true },
    ),
  );

  const squareEditorTopLeft = createMemo(() => {
    if (!props.tabs || props.tabs.length === 0) return false;
    const first = props.tabs[0];
    if (
      first.groupId &&
      props.groups.some((group) => group.id === first.groupId)
    ) {
      return true;
    }
    return first.id === props.activeTabId;
  });

  const hidePlusSeparator = createMemo(() => {
    if (!props.tabs || props.tabs.length === 0) return false;
    const last = props.tabs[props.tabs.length - 1];
    if (
      last.groupId &&
      props.groups.some((group) => group.id === last.groupId)
    ) {
      return props.tabs.some(
        (tab) => tab.groupId === last.groupId && tab.id === props.activeTabId,
      );
    }
    return last.id === props.activeTabId;
  });

  function restoreResultsSize() {
    if (!resultsMaximized()) return;
    setResultsMaximized(false);
    setEditorHeight(editorHeightBeforeMaximize);
  }

  function maximizeResults() {
    if (resultsMaximized()) return;
    editorHeightBeforeMaximize = editorHeight();
    setResultsCollapsed(false);
    setResultsMaximized(true);
  }

  function toggleResultsMaximized() {
    if (resultsMaximized()) {
      restoreResultsSize();
      return;
    }
    maximizeResults();
  }

  createEffect(() => {
    const tab = activeTab();
    if (tab && !tab.result && !tab.error && !tab.isExecuting) {
      restoreResultsSize();
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

  const canMaximizeResults = createMemo(() => {
    const tab = activeTab();
    if (!tab || tab.error || !tab.result) return false;
    return tab.result.result_sets.some((resultSet) => resultSet.rows.length > 0);
  });

  createEffect(() => {
    if (!canMaximizeResults() && resultsMaximized()) {
      restoreResultsSize();
    }
  });

  const editorHasFixedHeight = () =>
    !resultsMaximized() && !resultsCollapsed() && !isCompactResult();

  const resultsPanelIsCompact = () =>
    resultsCollapsed() || (isCompactResult() && !resultsMaximized());

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
    if (activeTab()?.isExecuting) return;
    setResultsCollapsed(false);
    setResultTableViewStates((prev) => {
      const next = { ...prev };
      delete next[props.activeTabId!];
      return next;
    });
    props.onExecute(props.activeTabId, selectedSql);
  }

  async function handleFormatSql() {
    const tab = activeTab();
    if (!tab) return;
    try {
      const formatted = await formatSqlWithPrefs(tab.sql);
      editorRef?.applyFormattedDocument(formatted);
      props.onTabUpdate(
        tab.id,
        { sql: formatted },
        actionHistoryOptions("Format SQL"),
      );
    } catch (err) {
      console.error("Failed to format SQL:", err);
    }
  }

  function handleFormatSelection() {
    const tab = activeTab();
    if (!tab) return;
    if (editorRef?.formatSelection()) return;
    handleFormatSql();
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
      const nextText = format ? await formatSqlWithPrefs(text) : text;
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
      {
        id: "format",
        label: hasSelectedText ? "Format Selection" : "Format",
        icon: <IconFormat />,
        shortcut: "Alt+Shift+F",
        onClick: handleFormatSelection,
        disabled: !hasDatabaseSelected() || !tab?.sql.trim(),
      },
      { id: "sep-copy", separator: true },
      {
        id: "send-selection-to-chat",
        label: "Send to Chat",
        icon: <i class="fa-solid fa-comment-dots" />,
        onClick: handleSendSelectionToChat,
        disabled: !hasSelectedText,
      },
    ];
  };

  function handleEditorResizerDoubleClick(e: MouseEvent) {
    e.preventDefault();
    setEditorHeight(DEFAULT_EDITOR_HEIGHT);
  }

  function handleEditorResize(e: MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = editorHeight();
    const column = (e.currentTarget as HTMLElement).parentElement;
    const minResultsHeight = isCompactResult()
      ? MIN_RESULTS_PANEL_HEIGHT
      : MIN_RESULTS_TABLE_PANEL_HEIGHT;
    const onMove = (ev: MouseEvent) => {
      const maxFromPanel = column
        ? column.clientHeight - minResultsHeight - EDITOR_RESULTS_RESIZER_HEIGHT
        : MAX_EDITOR_HEIGHT;
      const newHeight = Math.max(
        MIN_EDITOR_HEIGHT,
        Math.min(
          Math.min(MAX_EDITOR_HEIGHT, maxFromPanel),
          startHeight + ev.clientY - startY,
        ),
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
      if (!isCtrlOrMeta || e.altKey) return;

      const collapsedIds = new Set(
        props.groups
          .filter((group) => group.collapsed)
          .map((group) => group.id),
      );
      const visible = props.tabs.filter(
        (tab) => !tab.groupId || !collapsedIds.has(tab.groupId),
      );

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
          if (index < visible.length) {
            e.preventDefault();
            handleNavigateTab(visible[index].id);
          }
          return;
        }
      }

      if (e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        if (props.canReopenClosedTab()) {
          handleTabReopen();
        }
        return;
      }

      if (e.key === "PageDown") {
        e.preventDefault();
        if (visible.length === 0) return;
        const index = visible.findIndex((tab) => tab.id === props.activeTabId);
        const nextIndex = index === -1 ? 0 : (index + 1) % visible.length;
        const nextId = visible[nextIndex].id;
        if (nextId !== props.activeTabId) {
          handleNavigateTab(nextId);
        }
        return;
      }

      if (e.key === "PageUp") {
        e.preventDefault();
        if (visible.length === 0) return;
        const index = visible.findIndex((tab) => tab.id === props.activeTabId);
        const nextIndex =
          index === -1
            ? visible.length - 1
            : (index - 1 + visible.length) % visible.length;
        const nextId = visible[nextIndex].id;
        if (nextId !== props.activeTabId) {
          handleNavigateTab(nextId);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="flex flex-col h-full min-h-0 overflow-hidden">
      <div class="flex flex-row flex-1 min-h-0 overflow-hidden">
      {(() => {
        const tab = activeTab();
        return tab && props.connected ? (
          <div class="flex flex-col flex-1 min-w-0 min-h-0">
            <div
              class={`editor-island flex flex-col min-w-0 overflow-hidden ${
                resultsMaximized()
                  ? "hidden"
                  : editorHasFixedHeight()
                    ? "flex-shrink-0"
                    : "flex-1"
              }`}
              style={
                editorHasFixedHeight()
                  ? { height: `${editorHeight()}px` }
                  : undefined
              }
            >
              <div
                class="flex items-stretch justify-between flex-shrink-0 min-w-0 bg-transparent h-9"
                onDblClick={handleTabRowDoubleClick}
                onContextMenu={(e) => tabBarContextMenuHandler?.(e)}
              >
                <div class="flex items-stretch min-w-0 flex-shrink overflow-hidden h-full">
                  {props.tabs.length > 0 && (
                    <>
                      <EditorTabBar
                        tabs={props.tabs}
                        groups={props.groups}
                        activeTabId={props.activeTabId}
                        pinnedCount={pinnedCount()}
                        onTabChange={handleNavigateTab}
                        onTabClose={props.onTabClose}
                        onTabCloseOthers={props.onTabCloseOthers}
                        onTabCloseAll={props.onTabCloseAll}
                        onTabUpdate={props.onTabUpdate}
                        onTabMove={props.onTabMove}
                        onTabDuplicate={props.onTabDuplicate}
                        onTabTogglePin={props.onTabTogglePin}
                        onTabPromote={props.onTabPromote}
                        onTabReopen={props.onTabReopen}
                        canReopenClosedTab={props.canReopenClosedTab}
                        onTabAdd={props.onTabAdd}
                        onOpenSqlFile={props.onOpenSqlFile}
                        onTabCreateGroup={props.onTabCreateGroup}
                        onTabAddToGroup={props.onTabAddToGroup}
                        onTabRemoveFromGroup={props.onTabRemoveFromGroup}
                        onGroupRename={props.onGroupRename}
                        onGroupSetColor={props.onGroupSetColor}
                        onGroupToggleCollapsed={props.onGroupToggleCollapsed}
                        onGroupUngroup={props.onGroupUngroup}
                        onGroupClose={props.onGroupClose}
                        onSave={props.onSave}
                        onSaveToFile={props.onSaveToFile}
                        requestSingleTabClose={requestSingleTabClose}
                        requestCloseOthers={requestCloseOthers}
                        requestCloseAll={requestCloseAll}
                        requestCloseGroup={requestCloseGroup}
                        requestCloseTabs={requestCloseTabs}
                        isTabDirty={isTabDirty}
                        setTabBarRef={setTabBarRef}
                        setTabBarContextMenuHandler={(handler) => {
                          tabBarContextMenuHandler = handler;
                        }}
                        onRenamingChange={setTabBarRenaming}
                      />
                      <div
                        class="ui-divider mx-0.5 self-center"
                        classList={{ "opacity-0": hidePlusSeparator() }}
                      />
                    </>
                  )}
                  <Tooltip content="New Query" placement="bottom" class="h-full items-center">
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
                      class="control-icon-btn control-icon-btn-sm ml-0 mr-1.5"
                    >
                      <i class="fa-solid fa-plus text-s" />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div
                class={`app-panel flex flex-col flex-1 min-w-0 min-h-0 ${
                  squareEditorTopLeft() ? "rounded-tl-none" : ""
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
                          disabled={isActiveExecuting()}
                        />
                      )}
                    <Show
                      when={isActiveExecuting() && !!props.onCancelQuery}
                      fallback={
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
                              isActiveExecuting()
                            }
                            class="btn btn-primary btn-compact btn-execute"
                          >
                            <IconPlay />
                            <span>Execute</span>
                          </button>
                        </Tooltip>
                      }
                    >
                      <Tooltip
                        content={
                          isActiveCancelling()
                            ? "Cancelling query…"
                            : "Cancel running query"
                        }
                        placement="bottom"
                      >
                        <button
                          type="button"
                          onClick={handleCancelExecute}
                          disabled={isActiveCancelling()}
                          class="btn btn-danger btn-compact"
                        >
                          <IconStop />
                          <Show when={formattedElapsed()}>
                            <span class="tabular-nums">{formattedElapsed()}</span>
                          </Show>
                          <span>{isActiveCancelling() ? "Cancelling…" : "Cancel"}</span>
                        </button>
                      </Tooltip>
                    </Show>
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
                        aria-label={`History ${restorableHistoryCount(tab)}`}
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
                  <Suspense fallback={<div class="h-full bg-surface-panel" />}>
                    <SqlEditor
                      tabId={tab.id}
                      value={tab.sql}
                      onChange={(val: string, options?: QueryTabUpdateOptions) =>
                        props.onTabUpdate(tab.id, { sql: val }, options)
                      }
                      onExecute={handleExecute}
                      onFormat={handleFormatSql}
                      readOnly={!hasDatabaseSelected()}
                      theme={props.theme}
                      currentDatabase={props.currentDatabase}
                      onContextMenu={handleEditorContextMenu}
                      onRef={(handle) => {
                        editorRef = handle;
                        props.onEditorHandle?.(handle);
                      }}
                      onSearchPanelChange={setSearchOpen}
                      onNavigationPoint={(point) => {
                        if (tabBarRenaming()) return;
                        props.onNavigationPoint?.(point);
                      }}
                      wrapLines={wrapLines()}
                    />
                  </Suspense>
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

            {editorHasFixedHeight() && (
              <div
                class="resizer resizer-v"
                onMouseDown={handleEditorResize}
                onDblClick={handleEditorResizerDoubleClick}
              />
            )}

            <div
              class={`results-island app-panel flex flex-col ${
                resultsPanelIsCompact()
                  ? "flex-none mt-[var(--layout-gap)]"
                  : "flex-1"
              }`}
              style={
                resultsPanelIsCompact()
                  ? undefined
                  : { "min-height": `${MIN_RESULTS_TABLE_PANEL_HEIGHT}px` }
              }
            >
              <div class="app-panel-header">
                <span class="app-section-title">Results</span>
                <div class="flex items-center gap-2">
                  <Show when={tab.result?.statistics}>
                    <button
                      type="button"
                      onClick={() => setShowStats(true)}
                      disabled={isActiveExecuting()}
                      class="btn btn-secondary"
                    >
                      <i class="fa-solid fa-chart-simple" />
                      <span>Statistics</span>
                    </button>
                  </Show>
                  <Show when={canMaximizeResults()}>
                    <button
                      type="button"
                      aria-label={
                        resultsMaximized()
                          ? "Restore results size"
                          : "Maximize results"
                      }
                      onClick={toggleResultsMaximized}
                      class="btn btn-secondary"
                    >
                      <i
                        class={`fa-solid ${
                          resultsMaximized() ? "fa-compress" : "fa-expand"
                        }`}
                      />
                      <span>{resultsMaximized() ? "Restore" : "Maximize"}</span>
                    </button>
                  </Show>
                  <button
                    type="button"
                    onClick={() => {
                      if (resultsMaximized()) restoreResultsSize();
                      setResultsCollapsed(!resultsCollapsed());
                    }}
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
                  class={
                    isCompactResult() && !resultsMaximized()
                      ? undefined
                      : "flex-1 min-h-0"
                  }
                  style={
                    isCompactResult() && !resultsMaximized()
                      ? { "min-height": `${MIN_RESULTS_PANEL_HEIGHT}px` }
                      : undefined
                  }
                >
                  <ResultsGrid
                    result={tab.result}
                    error={tab.error}
                    errorTone={tab.errorTone}
                    isExecuting={isActiveExecuting()}
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
                <Show when={props.canReopenClosedTab()}>
                  <button
                    type="button"
                    onClick={() => handleTabReopen()}
                    class="btn btn-secondary empty-state-btn"
                  >
                    <i class="fa-solid fa-rotate-left" />
                    <span class="empty-state-btn-label">Reopen Closed Tab</span>
                  </button>
                </Show>
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
            <Loader variant="vertical" text="Connecting…" />
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
      <Show when={props.aiChatOpen && props.connected && !!activeTab()}>
        <Suspense
          fallback={
            <div
              class="flex-shrink-0 h-full flex min-h-0"
              style={{ width: `${aiChatWidth()}px` }}
            >
              <div class="resizer resizer-h" />
              <div class="app-panel flex flex-col flex-1 min-w-0">
                <div class="relative flex-1 min-h-0 flex flex-col">
                  <div class="app-panel-header">
                    <span class="app-section-title">Chat</span>
                  </div>
                  <Loader variant="vertical" />
                </div>
              </div>
            </div>
          }
        >
          <AIChatPanel
            currentCode={activeTab()?.sql ?? ""}
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
        </Suspense>
      </Show>
      </div>
      {editorContextMenu()?.visible && (
        <ContextMenu
          items={getEditorContextMenuItems()}
          x={editorContextMenu()!.x}
          y={editorContextMenu()!.y}
          onClose={() => setEditorContextMenu(null)}
        />
      )}

      {confirmClose() && (
        <ConfirmDialog
          title={
            confirmClose()!.type === "single"
              ? "Close Tab"
              : confirmClose()!.type === "others"
                ? "Close Other Tabs"
                : confirmClose()!.type === "group"
                  ? "Close Group"
                  : confirmClose()!.type === "multiple"
                    ? "Close Tabs"
                    : "Close All Tabs"
          }
          message={
            confirmClose()!.type === "single"
              ? "Are you sure you want to close this tab? Any unsaved changes will be lost."
              : confirmClose()!.type === "others"
                ? "Are you sure you want to close all other tabs? Any unsaved changes will be lost."
                : confirmClose()!.type === "group"
                  ? "Are you sure you want to close this group? Any unsaved changes will be lost."
                  : confirmClose()!.type === "multiple"
                    ? "Are you sure you want to close the selected tabs? Any unsaved changes will be lost."
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
            } else if (cc.type === "group" && cc.groupId) {
              props.onGroupClose(cc.groupId);
            } else if (cc.type === "multiple" && cc.tabIds) {
              for (const tabId of cc.tabIds) {
                props.onTabClose(tabId);
              }
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
