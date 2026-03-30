import { useCallback, useEffect, useRef, useState } from "react";
import { loadPreferences, loadSavedTabs, saveTabs } from "../lib/settings";
import { generateTabTitle } from "../lib/sql";
import type { QueryTab } from "../lib/types";

let tabCounter = 1;

function createTab(sql = ""): QueryTab {
  const id = `tab-${tabCounter++}`;
  return {
    id,
    title: "New Query",
    sql,
    savedSql: sql,
    isExecuting: false,
  };
}

export function useTabs() {
  const [tabs, setTabs] = useState<QueryTab[]>(() => {
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
  });

  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");
  const tabsRef = useRef<QueryTab[]>(tabs);
  tabsRef.current = tabs;

  useEffect(() => {
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return;
    saveTabs(
      tabs.map((t) => ({
        title: t.title,
        sql: t.sql,
        userTitle: t.userTitle,
        sourceId: t.sourceId,
        pinned: t.pinned,
      })),
    );
  }, [tabs]);

  const addTab = useCallback((sql: string = "", title?: string, sourceId?: string, userTitle?: boolean) => {
    if (sourceId) {
      const existing = tabsRef.current.find((t) => t.sourceId === sourceId);
      if (existing) {
        setActiveTabId(existing.id);
        return existing.id;
      }
    }

    const normalizedSql = sql.replace(/\r\n/g, "\n");
    const tab = createTab(normalizedSql);

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

    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab.id;
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        setActiveTabId("");
      } else if (activeTabId === tabId) {
        const lastTab = next[next.length - 1];
        setActiveTabId(lastTab ? lastTab.id : "");
      }
      return next;
    });
  }, [activeTabId]);

  const closeAllTabs = useCallback(() => {
    setTabs((prev) => {
      const pinned = prev.filter((t) => t.pinned);
      if (pinned.length > 0) {
        setActiveTabId(pinned[0].id);
        return pinned;
      }
      setActiveTabId("");
      return [];
    });
  }, []);

  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === tabId || t.pinned));
    setActiveTabId(tabId);
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<QueryTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    );
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const duplicateTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return "";
    const newTab = createTab(tab.sql);
    newTab.title = tab.title;
    newTab.userTitle = tab.userTitle;
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, []);

  const togglePin = useCallback((tabId: string) => {
    setTabs((prev) => {
      const tabIndex = prev.findIndex((t) => t.id === tabId);
      if (tabIndex === -1) return prev;
      const tab = prev[tabIndex];
      const newPinned = !tab.pinned;
      const next = prev.filter((t) => t.id !== tabId);
      const updatedTab = { ...tab, pinned: newPinned || undefined };

      // Place at the end of pinned section
      const lastPinnedIndex = next.reduce((acc, t, i) => (t.pinned ? i : acc), -1);
      next.splice(lastPinnedIndex + 1, 0, updatedTab);

      return next;
    });
  }, []);

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
  };
}
