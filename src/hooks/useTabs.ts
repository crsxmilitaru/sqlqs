import { createSignal, createEffect } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import { loadPreferences, loadSavedTabs, saveTabs } from "../lib/settings";
import { generateTabTitle } from "../lib/sql";
import type { QueryTab } from "../lib/types";

let tabCounter = 1;

function normalizeSql(sql = "") {
  return sql.replace(/\r\n/g, "\n");
}

function isTemporarySource(sourceId?: string) {
  return sourceId?.startsWith("history:") || sourceId?.startsWith("saved:");
}

function createTab(sql = "", temporary?: boolean, id = `tab-${tabCounter++}`): QueryTab {
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
        return tab;
      });
    } catch {
      return [];
    }
  })();

  const [tabsStore, setTabsStore] = createStore<QueryTab[]>(initialTabs);
  const tabs = () => tabsStore;

  const [activeTabId, setActiveTabId] = createSignal(tabsStore[0]?.id ?? "");

  createEffect(() => {
    // Track each tab field used in persistence so the effect reruns on edits.
    const snapshot = tabsStore.map((t) => ({
      title: t.title,
      sql: t.sql,
      userTitle: t.userTitle,
      sourceId: t.sourceId,
      pinned: t.pinned,
      temporary: t.temporary,
    }));
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return;
    saveTabs(
      snapshot
        .filter((t) => !t.temporary)
        .map((t) => ({
          title: t.title,
          sql: t.sql,
          userTitle: t.userTitle,
          sourceId: t.sourceId,
          pinned: t.pinned,
        })),
    );
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
    setTabsStore(pinned);
    if (pinned.length > 0) {
      setActiveTabId(pinned[0].id);
    } else {
      setActiveTabId("");
    }
  };

  const closeOtherTabs = (tabId: string) => {
    const current = unwrap(tabsStore);
    setTabsStore(current.filter((t) => t.id === tabId || t.pinned));
    setActiveTabId(tabId);
  };

  const updateTab = (tabId: string, updates: Partial<QueryTab>) => {
    setTabsStore(
      produce((draft) => {
        const tab = draft.find((t) => t.id === tabId);
        if (!tab) return;

        const originalSql = tab.sql;
        const wasTemporary = tab.temporary;

        Object.assign(tab, updates);

        if (typeof updates.sql === "string") {
          tab.sql = normalizeSql(updates.sql);
          if (wasTemporary && tab.sql !== originalSql) {
            tab.temporary = undefined;
          }
        }

        if (typeof updates.savedSql === "string") {
          tab.savedSql = normalizeSql(updates.savedSql);
        }
      }),
    );
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
    setTabsStore(produce((draft) => { draft.push(newTab); }));
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
    const updatedTab: QueryTab = { ...tab, pinned: newPinned || undefined, temporary: undefined };
    const lastPinnedIndex = next.reduce((acc, t, i) => (t.pinned ? i : acc), -1);
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
