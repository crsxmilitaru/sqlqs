import { createSignal, createEffect, onCleanup } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import {
  loadPreferences,
  loadSavedTabs,
  saveTabs,
  type SavedTab,
} from "../lib/settings";
import { generateTabTitle } from "../lib/sql";
import type {
  QueryTab,
  QueryTabHistoryEntry,
  QueryTabHistoryEntryType,
  QueryTabUpdateOptions,
} from "../lib/types";

let tabCounter = 1;
const MAX_TAB_HISTORY_ITEMS = 25;
const MAX_TAB_HISTORY_SQL_CHARS = 120_000;
const MAX_TAB_HISTORY_TOTAL_CHARS = 600_000;
const MAX_PERSISTED_TAB_HISTORY_TOTAL_CHARS = 1_000_000;
const TAB_HISTORY_IDLE_DELAY_MS = 3_000;

class QueryResultSnapshot {
  readonly __sqlqsQueryResultSnapshot = true;
}

function asQueryResultSnapshot(result: QueryTab["result"]) {
  if (
    result &&
    Object.getPrototypeOf(result) === Object.prototype
  ) {
    Object.setPrototypeOf(result, QueryResultSnapshot.prototype);
  }
  return result;
}

function normalizeSql(sql = "") {
  return sql.replace(/\r\n/g, "\n");
}

function isTemporarySource(sourceId?: string) {
  return sourceId?.startsWith("history:") || sourceId?.startsWith("saved:");
}

function createHistoryEntry(
  sql: string,
  type: QueryTabHistoryEntryType = "typing",
  label?: string,
): QueryTabHistoryEntry {
  return {
    id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sql,
    createdAt: Date.now(),
    type,
    label,
  };
}

function trimHistory(
  history: QueryTabHistoryEntry[] | undefined,
): QueryTabHistoryEntry[] | undefined {
  let totalChars = 0;
  const trimmed: QueryTabHistoryEntry[] = [];

  for (const entry of history ?? []) {
    if (entry.sql.length > MAX_TAB_HISTORY_SQL_CHARS) continue;
    if (trimmed.length >= MAX_TAB_HISTORY_ITEMS) break;
    if (totalChars + entry.sql.length > MAX_TAB_HISTORY_TOTAL_CHARS) break;

    trimmed.push(entry);
    totalChars += entry.sql.length;
  }

  return trimmed.length > 0 ? trimmed : undefined;
}

function shouldCaptureHistory(
  tab: QueryTab,
  snapshotSql: string,
  options?: { allowEmpty?: boolean; allowSavedSql?: boolean },
): boolean {
  if (!snapshotSql && !options?.allowEmpty) return false;
  if (snapshotSql.length > MAX_TAB_HISTORY_SQL_CHARS) return false;

  const latest = tab.history?.[0];
  if (latest?.sql === snapshotSql) return false;
  if (!options?.allowSavedSql && !latest && tab.savedSql === snapshotSql) {
    return false;
  }

  return true;
}

function addTabHistory(
  tab: QueryTab,
  snapshotSql: string,
  type: QueryTabHistoryEntryType = "typing",
  label?: string,
) {
  const entry = createHistoryEntry(snapshotSql, type, label);
  tab.history = trimHistory([entry, ...(tab.history ?? [])]);
}

function relabelLatestHistoryEntry(
  tab: QueryTab,
  type: QueryTabHistoryEntryType,
  label?: string,
) {
  const latest = tab.history?.[0];
  if (!latest) return;
  latest.type = type;
  latest.label = label;
  latest.createdAt = Date.now();
}

function captureBaselineHistory(tab: QueryTab, snapshotSql: string) {
  const baselineSql = normalizeSql(tab.savedSql);
  if (
    !tab.history?.length &&
    baselineSql &&
    baselineSql !== snapshotSql &&
    shouldCaptureHistory(tab, baselineSql, {
      allowSavedSql: true,
    })
  ) {
    addTabHistory(tab, baselineSql, "typing", "Before typing");
  }
}

function trimPersistedTabsHistory(tabs: SavedTab[]): SavedTab[] {
  let totalChars = 0;

  return tabs.map((tab) => {
    const history: QueryTabHistoryEntry[] = [];

    for (const entry of trimHistory(tab.history) ?? []) {
      if (
        totalChars + entry.sql.length >
        MAX_PERSISTED_TAB_HISTORY_TOTAL_CHARS
      ) {
        break;
      }

      history.push(entry);
      totalChars += entry.sql.length;
    }

    return {
      ...tab,
      history: history.length > 0 ? history : undefined,
    };
  });
}

function createTab(
  sql = "",
  temporary?: boolean,
  id = `tab-${tabCounter++}`,
): QueryTab {
  const normalizedSql = normalizeSql(sql);
  return {
    id,
    title: "New Query",
    sql: normalizedSql,
    savedSql: normalizedSql,
    isExecuting: false,
    temporary,
  };
}

export function useTabs() {
  const initialTabs: QueryTab[] = (() => {
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return [];
    try {
      const saved = loadSavedTabs();
      return saved.map((s) => {
        const tab = createTab(s.sql);
        tab.title = s.title;
        tab.userTitle = s.userTitle;
        tab.sourceId = s.sourceId;
        tab.pinned = s.pinned;
        tab.history = trimHistory(s.history);
        return tab;
      });
    } catch {
      return [];
    }
  })();

  const [tabsStore, setTabsStore] = createStore<QueryTab[]>(initialTabs);
  const tabs = () => tabsStore;

  const [activeTabId, setActiveTabId] = createSignal(tabsStore[0]?.id ?? "");
  const historyTimers = new Map<string, number>();

  function clearHistoryTimer(tabId: string) {
    const timer = historyTimers.get(tabId);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    historyTimers.delete(tabId);
  }

  function clearHistoryTimers(tabIds?: string[]) {
    if (!tabIds) {
      for (const timer of historyTimers.values()) {
        window.clearTimeout(timer);
      }
      historyTimers.clear();
      return;
    }

    tabIds.forEach(clearHistoryTimer);
  }

  function scheduleHistorySnapshot(tabId: string) {
    clearHistoryTimer(tabId);
    const timer = window.setTimeout(() => {
      historyTimers.delete(tabId);
      setTabsStore(
        produce((draft) => {
          const tab = draft.find((t) => t.id === tabId);
          if (!tab) return;

          const snapshotSql = normalizeSql(tab.sql);
          captureBaselineHistory(tab, snapshotSql);

          if (shouldCaptureHistory(tab, snapshotSql)) {
            addTabHistory(tab, snapshotSql, "typing");
          }
        }),
      );
    }, TAB_HISTORY_IDLE_DELAY_MS);
    historyTimers.set(tabId, timer);
  }

  onCleanup(() => clearHistoryTimers());

  createEffect(() => {
    const snapshot = tabsStore.map((t) => ({
      title: t.title,
      sql: t.sql,
      userTitle: t.userTitle,
      sourceId: t.sourceId,
      pinned: t.pinned,
      temporary: t.temporary,
      history: trimHistory(t.history),
    }));
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return;
    const persistedTabs = snapshot
      .filter((t) => !t.temporary)
      .map((t) => ({
        title: t.title,
        sql: t.sql,
        history: trimHistory(t.history),
        userTitle: t.userTitle,
        sourceId: t.sourceId,
        pinned: t.pinned,
      }));

    saveTabs(trimPersistedTabsHistory(persistedTabs));
  });

  const addTab = (
    sql: string = "",
    title?: string,
    sourceId?: string,
    userTitle?: boolean,
    options?: { temporary?: boolean },
  ) => {
    const current = unwrap(tabsStore);

    if (sourceId) {
      const existing = current.find((t) => t.sourceId === sourceId);
      if (existing) {
        setActiveTabId(existing.id);
        return existing.id;
      }
    }

    const normalizedSql = normalizeSql(sql);
    const temporary = options?.temporary ?? isTemporarySource(sourceId);
    const previewTab = temporary ? current.find((t) => t.temporary) : undefined;
    const tab = createTab(normalizedSql, temporary, previewTab?.id);

    if (previewTab) {
      clearHistoryTimer(previewTab.id);
    }

    if (sourceId) {
      tab.sourceId = sourceId;
    }
    if (userTitle) {
      tab.userTitle = true;
    }

    const trimmedTitle = title?.trim();
    if (trimmedTitle) {
      tab.title = trimmedTitle;
    } else if (normalizedSql) {
      const generatedTitle = generateTabTitle(normalizedSql);
      if (generatedTitle) {
        tab.title = generatedTitle;
      }
    }

    setTabsStore(
      produce((draft) => {
        if (!previewTab) {
          draft.push(tab);
          return;
        }
        const idx = draft.findIndex((t) => t.id === previewTab.id);
        if (idx === -1) {
          draft.push(tab);
        } else {
          draft[idx] = tab;
        }
      }),
    );
    setActiveTabId(tab.id);
    return tab.id;
  };

  const closeTab = (tabId: string) => {
    clearHistoryTimer(tabId);
    const current = unwrap(tabsStore);
    const next = current.filter((t) => t.id !== tabId);
    setTabsStore(next);
    if (next.length === 0) {
      setActiveTabId("");
    } else if (activeTabId() === tabId) {
      const lastTab = next[next.length - 1];
      setActiveTabId(lastTab ? lastTab.id : "");
    }
  };

  const closeAllTabs = () => {
    const current = unwrap(tabsStore);
    const pinned = current.filter((t) => t.pinned);
    clearHistoryTimers(current.filter((t) => !t.pinned).map((t) => t.id));
    setTabsStore(pinned);
    if (pinned.length > 0) {
      setActiveTabId(pinned[0].id);
    } else {
      setActiveTabId("");
    }
  };

  const closeOtherTabs = (tabId: string) => {
    const current = unwrap(tabsStore);
    clearHistoryTimers(
      current.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id),
    );
    setTabsStore(current.filter((t) => t.id === tabId || t.pinned));
    setActiveTabId(tabId);
  };

  const updateTab = (
    tabId: string,
    updates: Partial<QueryTab>,
    options?: QueryTabUpdateOptions,
  ) => {
    const safeUpdates =
      "result" in updates
        ? { ...updates, result: asQueryResultSnapshot(updates.result) }
        : updates;
    const sqlUpdate = typeof updates.sql === "string";
    const historyMode = options?.historyMode ?? (sqlUpdate ? "idle" : "none");
    const historyType =
      options?.historyType ??
      (historyMode === "idle" ? "typing" : "action");
    const trimmedHistoryLabel = options?.historyLabel?.trim() ?? "";
    const historyLabel = trimmedHistoryLabel
      ? trimmedHistoryLabel.slice(0, 80)
      : undefined;
    let didChangeSql = false;
    if (
      historyMode === "preserve-current" ||
      historyMode === "capture-current"
    ) {
      clearHistoryTimer(tabId);
    }

    setTabsStore(
      produce((draft) => {
        const tab = draft.find((t) => t.id === tabId);
        if (!tab) return;

        const originalSql = normalizeSql(tab.sql);
        const wasTemporary = tab.temporary;
        const nextSql = sqlUpdate ? normalizeSql(updates.sql) : undefined;
        const shouldCaptureCurrent =
          historyMode === "capture-current" ||
          (historyMode === "preserve-current" &&
            nextSql !== undefined &&
            originalSql !== nextSql);

        if (shouldCaptureCurrent) {
          captureBaselineHistory(tab, originalSql);
        }

        if (shouldCaptureCurrent) {
          if (
            tab.history?.[0]?.sql === originalSql &&
            (historyType === "action" || historyLabel)
          ) {
            relabelLatestHistoryEntry(tab, historyType, historyLabel);
          } else if (
            shouldCaptureHistory(tab, originalSql, {
              allowEmpty: true,
              allowSavedSql: true,
            })
          ) {
            addTabHistory(tab, originalSql, historyType, historyLabel);
          }
        }

        Object.assign(tab, safeUpdates);

        if (nextSql !== undefined) {
          didChangeSql = originalSql !== nextSql;
          tab.sql = nextSql;
          if (wasTemporary && tab.sql !== originalSql) {
            tab.temporary = undefined;
          }
        }

        if (typeof updates.savedSql === "string") {
          tab.savedSql = normalizeSql(updates.savedSql);
        }
      }),
    );

    if (didChangeSql && historyMode === "idle") {
      scheduleHistorySnapshot(tabId);
    }
  };

  const promoteTab = (tabId: string) => {
    setTabsStore(
      produce((draft) => {
        const tab = draft.find((t) => t.id === tabId);
        if (tab && tab.temporary) {
          tab.temporary = undefined;
        }
      }),
    );
  };

  const reorderTabs = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    const current = unwrap(tabsStore);
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setTabsStore(next);
  };

  const duplicateTab = (tabId: string) => {
    const current = unwrap(tabsStore);
    const tab = current.find((t) => t.id === tabId);
    if (!tab) return "";
    const newTab = createTab(tab.sql);
    newTab.title = tab.title;
    newTab.userTitle = tab.userTitle;
    newTab.history = trimHistory(tab.history);
    setTabsStore(
      produce((draft) => {
        draft.push(newTab);
      }),
    );
    setActiveTabId(newTab.id);
    return newTab.id;
  };

  const togglePin = (tabId: string) => {
    const current = unwrap(tabsStore);
    const tabIndex = current.findIndex((t) => t.id === tabId);
    if (tabIndex === -1) return;
    const tab = current[tabIndex];
    const newPinned = !tab.pinned;
    const next = current.filter((t) => t.id !== tabId);
    const updatedTab: QueryTab = {
      ...tab,
      pinned: newPinned || undefined,
      temporary: undefined,
    };
    const lastPinnedIndex = next.reduce(
      (acc, t, i) => (t.pinned ? i : acc),
      -1,
    );
    next.splice(lastPinnedIndex + 1, 0, updatedTab);
    setTabsStore(next);
  };

  return {
    tabs,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    updateTab,
    reorderTabs,
    duplicateTab,
    togglePin,
    promoteTab,
  };
}
