import { useState, useCallback, useEffect } from "react";
import type { QueryTab } from "../lib/types";
import { loadPreferences, loadSavedTabs, saveTabs } from "../lib/settings";
import { generateTabTitle } from "../lib/sql";

let tabCounter = 1;

function createTab(): QueryTab {
  const id = `tab-${tabCounter++}`;
  return {
    id,
    title: `Query ${tabCounter - 1}`,
    sql: "",
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
        const tab = createTab();
        tab.title = s.title;
        tab.sql = s.sql;
        return tab;
      });
    } catch {
      return [];
    }
  });

  const [activeTabId, setActiveTabId] = useState(() => tabs[0]?.id ?? "");

  useEffect(() => {
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return;
    saveTabs(
      tabs.map((t) => ({
        title: t.title,
        sql: t.sql,
      })),
    );
  }, [tabs]);

  const addTab = useCallback((sql: string = "", title?: string) => {
    const tab = createTab();
    const normalizedSql = sql.replace(/\r\n/g, "\n");
    tab.sql = normalizedSql;

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
    setTabs([]);
    setActiveTabId("");
  }, []);

  const closeOtherTabs = useCallback((tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id === tabId));
    setActiveTabId(tabId);
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<QueryTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, ...updates } : t)),
    );
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
  };
}
