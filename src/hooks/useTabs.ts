import { createSignal, createEffect } from "solid-js";
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
  const [tabs, setTabs] = createSignal<QueryTab[]>((() => {
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
  })());

  const [activeTabId, setActiveTabId] = createSignal(tabs()[0]?.id ?? "");
  let tabsSnapshot = tabs();

  // Keep tabsSnapshot in sync
  createEffect(() => {
    tabsSnapshot = tabs();
  });

  createEffect(() => {
    const currentTabs = tabs();
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return;
    saveTabs(
      currentTabs
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
    if (sourceId) {
      const existing = tabsSnapshot.find((t) => t.sourceId === sourceId);
      if (existing) {
        setActiveTabId(existing.id);
        return existing.id;
      }
    }

    const normalizedSql = normalizeSql(sql);
    const temporary = options?.temporary ?? isTemporarySource(sourceId);
    const previewTab = temporary ? tabsSnapshot.find((t) => t.temporary) : undefined;
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

    setTabs((prev) => {
      if (!previewTab) {
        return [...prev, tab];
      }

      return prev.map((currentTab) => (currentTab.id === previewTab.id ? tab : currentTab));
    });
    setActiveTabId(tab.id);
    return tab.id;
  };

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        setActiveTabId("");
      } else if (activeTabId() === tabId) {
        const lastTab = next[next.length - 1];
        setActiveTabId(lastTab ? lastTab.id : "");
      }
      return next;
    });
  };

  const closeAllTabs = () => {
    setTabs((prev) => {
      const pinned = prev.filter((t) => t.pinned);
      if (pinned.length > 0) {
        setActiveTabId(pinned[0].id);
        return pinned;
      }
      setActiveTabId("");
      return [];
    });
  };

  const closeOtherTabs = (tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === tabId || t.pinned));
    setActiveTabId(tabId);
  };

  const updateTab = (tabId: string, updates: Partial<QueryTab>) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) {
          return t;
        }

        const nextTab: QueryTab = {
          ...t,
          ...updates,
        };

        if (typeof updates.sql === "string") {
          nextTab.sql = normalizeSql(updates.sql);
          if (t.temporary && nextTab.sql !== t.sql) {
            nextTab.temporary = undefined;
          }
        }

        if (typeof updates.savedSql === "string") {
          nextTab.savedSql = normalizeSql(updates.savedSql);
        }

        return nextTab;
      }),
    );
  };

  const promoteTab = (tabId: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId && t.temporary ? { ...t, temporary: undefined } : t)),
    );
  };

  const reorderTabs = (fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const duplicateTab = (tabId: string) => {
    const tab = tabsSnapshot.find((t) => t.id === tabId);
    if (!tab) return "";
    const newTab = createTab(tab.sql);
    newTab.title = tab.title;
    newTab.userTitle = tab.userTitle;
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  };

  const togglePin = (tabId: string) => {
    setTabs((prev) => {
      const tabIndex = prev.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return prev;
      const tab = prev[tabIndex];
      const newPinned = !tab.pinned;
      const next = prev.filter((t) => t.id !== tabId);
      const updatedTab = { ...tab, pinned: newPinned || undefined, temporary: undefined };

      // Place at the end of pinned section
      const lastPinnedIndex = next.reduce((acc, t, i) => (t.pinned ? i : acc), -1);
      next.splice(lastPinnedIndex + 1, 0, updatedTab);

      return next;
    });
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
