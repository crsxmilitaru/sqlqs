import { createSignal, createEffect, onCleanup } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import {
  loadPreferences,
  loadSavedTabs,
  loadTabGroups,
  saveTabs,
  saveTabGroups,
  type SavedTab,
} from "../lib/settings";
import { generateTabTitle } from "../lib/sql";
import { defaultGroupName, nextGroupColor } from "../lib/tab-groups";
import { toast } from "../components/ui/Toaster";
import type {
  ClosedTab,
  QueryTab,
  QueryTabHistoryEntry,
  QueryTabHistoryEntryType,
  QueryTabUpdateOptions,
  TabGroup,
  TabGroupColor,
} from "../lib/types";

let tabCounter = 1;
let groupCounter = 1;
const MAX_CLOSED_TABS = 20;
const MAX_TAB_HISTORY_ITEMS = 25;
const MAX_TAB_HISTORY_SQL_CHARS = 120_000;
const MAX_TAB_HISTORY_TOTAL_CHARS = 600_000;
const MAX_PERSISTED_TAB_HISTORY_TOTAL_CHARS = 1_000_000;
const TAB_HISTORY_IDLE_DELAY_MS = 3_000;
let didNotifyTabGroupPersistError = false;
let didNotifyTabsPersistError = false;

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

function createClosedTabSnapshot(
  tab: QueryTab,
  index: number,
  group?: TabGroup,
): ClosedTab {
  return {
    title: tab.title,
    sql: tab.sql,
    savedSql: tab.savedSql,
    history: trimHistory(tab.history),
    userTitle: tab.userTitle,
    sourceId: tab.sourceId,
    pinned: tab.pinned,
    temporary: tab.temporary,
    groupId: tab.groupId,
    group: group ? { ...group } : undefined,
    index,
  };
}

function createGroupId() {
  return `group-${groupCounter++}`;
}

function normalizeTabOrder(
  tabs: QueryTab[],
  groups: TabGroup[],
): { tabs: QueryTab[]; groups: TabGroup[] } {
  for (const tab of tabs) {
    if (tab.pinned) {
      tab.groupId = undefined;
    }
  }

  const activeGroupIds = new Set<string>();
  for (const tab of tabs) {
    if (tab.groupId && !tab.pinned) {
      activeGroupIds.add(tab.groupId);
    }
  }

  const nextGroups = groups.filter((group) => activeGroupIds.has(group.id));
  const originalIndex = new Map(tabs.map((tab, index) => [tab.id, index]));

  const pinned = tabs.filter((tab) => tab.pinned);
  const unpinned = tabs.filter((tab) => !tab.pinned);

  const groupOrder: string[] = [];
  const groupMembers = new Map<string, QueryTab[]>();
  const ungrouped: QueryTab[] = [];

  for (const tab of unpinned) {
    if (tab.groupId && activeGroupIds.has(tab.groupId)) {
      if (!groupMembers.has(tab.groupId)) {
        groupOrder.push(tab.groupId);
        groupMembers.set(tab.groupId, []);
      }
      groupMembers.get(tab.groupId)!.push(tab);
    } else {
      tab.groupId = undefined;
      ungrouped.push(tab);
    }
  }

  type Segment =
    | { kind: "group"; groupId: string; position: number }
    | { kind: "tab"; tab: QueryTab; position: number };

  const segments: Segment[] = [];

  for (const groupId of groupOrder) {
    const members = groupMembers.get(groupId) ?? [];
    if (members.length === 0) continue;
    const position = Math.min(
      ...members.map((member) => originalIndex.get(member.id) ?? 0),
    );
    segments.push({ kind: "group", groupId, position });
  }

  for (const tab of ungrouped) {
    segments.push({
      kind: "tab",
      tab,
      position: originalIndex.get(tab.id) ?? 0,
    });
  }

  segments.sort((a, b) => a.position - b.position);

  const nextTabs: QueryTab[] = [...pinned];
  for (const segment of segments) {
    if (segment.kind === "group") {
      nextTabs.push(...(groupMembers.get(segment.groupId) ?? []));
      continue;
    }
    nextTabs.push(segment.tab);
  }

  return { tabs: nextTabs, groups: nextGroups };
}

function commitNormalized(
  setTabsStore: (tabs: QueryTab[]) => void,
  setGroupsStore: (groups: TabGroup[]) => void,
  tabs: QueryTab[],
  groups: TabGroup[],
) {
  const normalized = normalizeTabOrder(
    tabs.map((tab) => ({ ...tab })),
    [...groups],
  );
  setTabsStore(normalized.tabs);
  setGroupsStore(normalized.groups);
}

function collapsedGroupIds(groups: TabGroup[]): Set<string> {
  return new Set(
    groups.filter((group) => group.collapsed).map((group) => group.id),
  );
}

function isTabVisible(tab: QueryTab, collapsedIds: Set<string>): boolean {
  return !tab.groupId || !collapsedIds.has(tab.groupId);
}

function firstVisibleTabId(tabs: QueryTab[], groups: TabGroup[]): string {
  const collapsedIds = collapsedGroupIds(groups);
  return (
    tabs.find((tab) => isTabVisible(tab, collapsedIds))?.id ??
    tabs[0]?.id ??
    ""
  );
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
  const initialGroups: TabGroup[] = (() => {
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return [];
    try {
      return loadTabGroups();
    } catch {
      return [];
    }
  })();

  const initialTabs: QueryTab[] = (() => {
    const prefs = loadPreferences();
    if (!prefs.persistTabs) return [];
    try {
      const saved = loadSavedTabs();
      const tabs = saved.map((s) => {
        const tab = createTab(s.sql);
        tab.title = s.title;
        tab.savedSql =
          typeof s.savedSql === "string"
            ? normalizeSql(s.savedSql)
            : normalizeSql(s.sql);
        tab.userTitle = s.userTitle;
        tab.sourceId = s.sourceId;
        tab.pinned = s.pinned;
        tab.groupId = s.groupId;
        tab.history = trimHistory(s.history);
        return tab;
      });
      const normalized = normalizeTabOrder(tabs, initialGroups);
      for (const group of normalized.groups) {
        const match = /^group-(\d+)$/.exec(group.id);
        if (match) {
          groupCounter = Math.max(groupCounter, Number(match[1]) + 1);
        }
      }
      return normalized.tabs;
    } catch {
      return [];
    }
  })();

  const [tabsStore, setTabsStore] = createStore<QueryTab[]>(initialTabs);
  const tabs = () => tabsStore;

  const [groupsStore, setGroupsStore] = createStore<TabGroup[]>(
    initialGroups.length > 0
      ? normalizeTabOrder(initialTabs, initialGroups).groups
      : [],
  );
  const groups = () => groupsStore;
  const getTabGroup = (tab: QueryTab) =>
    tab.groupId
      ? unwrap(groupsStore).find((group) => group.id === tab.groupId)
      : undefined;

  const [activeTabId, setActiveTabId] = createSignal(
    firstVisibleTabId(tabsStore, groupsStore),
  );

  const [closedTabsStack, setClosedTabsStack] = createSignal<ClosedTab[]>([]);
  const historyTimers = new Map<string, number>();

  function pushClosedTabs(
    tabsToClose: { tab: QueryTab; index: number; group?: TabGroup }[],
  ) {
    if (tabsToClose.length === 0) return;
    setClosedTabsStack((prev) => {
      const next = [
        ...prev,
        ...tabsToClose.map(({ tab, index, group }) =>
          createClosedTabSnapshot(tab, index, group),
        ),
      ];
      return next.length > MAX_CLOSED_TABS
        ? next.slice(next.length - MAX_CLOSED_TABS)
        : next;
    });
  }

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

    tabIds.forEach((id) => {
      clearHistoryTimer(id);
    });
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
      savedSql: t.savedSql,
      userTitle: t.userTitle,
      sourceId: t.sourceId,
      pinned: t.pinned,
      groupId: t.groupId,
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
        savedSql: t.savedSql,
        history: trimHistory(t.history),
        userTitle: t.userTitle,
        sourceId: t.sourceId,
        pinned: t.pinned,
        groupId: t.groupId,
      }));

    const tabsSaved = saveTabs(trimPersistedTabsHistory(persistedTabs));
    if (!tabsSaved && !didNotifyTabsPersistError) {
      didNotifyTabsPersistError = true;
      toast.error(
        "Failed to save open tabs. They will not persist after restart.",
      );
    } else if (tabsSaved) {
      didNotifyTabsPersistError = false;
    }
    const groupsSaved = saveTabGroups(
      groupsStore.map((group) => ({
        id: group.id,
        name: group.name,
        color: group.color,
        collapsed: group.collapsed || undefined,
      })),
    );
    if (!groupsSaved && !didNotifyTabGroupPersistError) {
      didNotifyTabGroupPersistError = true;
      toast.error(
        "Failed to save tab groups. They will not persist after restart.",
      );
    } else if (groupsSaved) {
      didNotifyTabGroupPersistError = false;
    }
  });

  const addTab = (
    sql: string = "",
    title?: string,
    sourceId?: string,
    userTitle?: boolean,
    options?: { temporary?: boolean; groupId?: string },
  ) => {
    const current = unwrap(tabsStore);

    if (sourceId) {
      const existing = current.find((t) => t.sourceId === sourceId);
      if (existing) {
        if (options?.temporary === false && existing.temporary) {
          promoteTab(existing.id);
        }
        setActiveTabId(existing.id);
        return existing.id;
      }
    }

    const normalizedSql = normalizeSql(sql);
    const temporary = options?.temporary ?? isTemporarySource(sourceId);
    const previewTab = temporary ? current.find((t) => t.temporary) : undefined;
    const tab = createTab(normalizedSql, temporary, previewTab?.id);
    const targetGroupId = options?.groupId;
    if (targetGroupId && groupsStore.some((group) => group.id === targetGroupId)) {
      tab.groupId = targetGroupId;
    }

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
          if (tab.groupId) {
            const lastMemberIndex = draft.reduce(
              (acc, currentTab, index) =>
                currentTab.groupId === tab.groupId ? index : acc,
              -1,
            );
            if (lastMemberIndex >= 0) {
              draft.splice(lastMemberIndex + 1, 0, tab);
              return;
            }
          }
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
    if (tab.groupId) {
      commitNormalized(setTabsStore, setGroupsStore, unwrap(tabsStore), [
        ...unwrap(groupsStore),
      ]);
    }
    setActiveTabId(tab.id);
    return tab.id;
  };

  const closeTab = (tabId: string) => {
    clearHistoryTimer(tabId);
    const current = unwrap(tabsStore);
    const index = current.findIndex((t) => t.id === tabId);
    if (index === -1) return;
    const closedTab = current[index];
    pushClosedTabs([{ tab: closedTab, index, group: getTabGroup(closedTab) }]);
    const next = current.filter((t) => t.id !== tabId);
    const nextGroups = unwrap(groupsStore);
    commitNormalized(setTabsStore, setGroupsStore, next, nextGroups);
    if (next.length === 0) {
      setActiveTabId("");
    } else if (activeTabId() === tabId) {
      const collapsedIds = collapsedGroupIds(nextGroups);
      const nextIndex = Math.min(index, next.length - 1);
      let targetTab = next[nextIndex];
      if (!isTabVisible(targetTab, collapsedIds)) {
        const visibleTab =
          next.slice(nextIndex).find((t) => isTabVisible(t, collapsedIds)) ??
          [...next.slice(0, nextIndex)]
            .reverse()
            .find((t) => isTabVisible(t, collapsedIds));
        if (visibleTab) {
          targetTab = visibleTab;
        }
      }
      setActiveTabId(targetTab ? targetTab.id : "");
    }
  };

  const closeAllTabs = () => {
    const current = unwrap(tabsStore);
    pushClosedTabs(
      current
        .map((tab, index) => ({ tab, index, group: getTabGroup(tab) }))
        .filter(({ tab }) => !tab.pinned),
    );
    const pinned = current.filter((t) => t.pinned);
    clearHistoryTimers(current.filter((t) => !t.pinned).map((t) => t.id));
    const nextGroups = pinned.length > 0 ? unwrap(groupsStore) : [];
    commitNormalized(setTabsStore, setGroupsStore, pinned, nextGroups);
    if (pinned.length > 0) {
      setActiveTabId(pinned[0].id);
    } else {
      setActiveTabId("");
    }
  };

  const closeOtherTabs = (tabId: string) => {
    const current = unwrap(tabsStore);
    pushClosedTabs(
      current
        .map((tab, index) => ({ tab, index, group: getTabGroup(tab) }))
        .filter(({ tab }) => tab.id !== tabId && !tab.pinned),
    );
    clearHistoryTimers(
      current.filter((t) => t.id !== tabId && !t.pinned).map((t) => t.id),
    );
    const next = current.filter((t) => t.id === tabId || t.pinned);
    commitNormalized(setTabsStore, setGroupsStore, next, unwrap(groupsStore));
    setActiveTabId(tabId);
  };

  const reopenClosedTab = () => {
    const stack = closedTabsStack();
    if (stack.length === 0) return "";
    const closed = stack[stack.length - 1];
    setClosedTabsStack(stack.slice(0, -1));

    const current = unwrap(tabsStore);
    let temporary = closed.temporary;
    if (temporary && current.some((t) => t.temporary)) {
      temporary = undefined;
    }

    const tab = createTab(closed.sql, temporary);
    tab.title = closed.title;
    tab.savedSql = normalizeSql(closed.savedSql);
    tab.history = closed.history;
    tab.userTitle = closed.userTitle;
    tab.sourceId = closed.sourceId;
    tab.pinned = closed.pinned;
    tab.groupId = closed.groupId;
    const currentGroups = unwrap(groupsStore);
    const restoredGroup = closed.group;
    let nextGroups = currentGroups;
    if (
      restoredGroup &&
      !currentGroups.some((group) => group.id === restoredGroup.id)
    ) {
      nextGroups = [...currentGroups, { ...restoredGroup }];
    }

    setTabsStore(
      produce((draft) => {
        if (closed.pinned) {
          const lastPinnedIndex = draft.reduce(
            (acc, t, i) => (t.pinned ? i : acc),
            -1,
          );
          const insertIndex = Math.min(closed.index, lastPinnedIndex + 1);
          draft.splice(insertIndex, 0, tab);
          return;
        }

        const pinnedCount = draft.filter((t) => t.pinned).length;
        const insertIndex = Math.min(
          Math.max(closed.index, pinnedCount),
          draft.length,
        );
        draft.splice(insertIndex, 0, tab);
      }),
    );
    commitNormalized(setTabsStore, setGroupsStore, unwrap(tabsStore), nextGroups);
    setActiveTabId(tab.id);
    return tab.id;
  };

  const canReopenClosedTab = () => closedTabsStack().length > 0;

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
          if (didChangeSql && !tab.userTitle) {
            const generatedTitle = generateTabTitle(tab.sql);
            if (generatedTitle) tab.title = generatedTitle;
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
    moveTab(fromIndex, toIndex);
  };

  const moveTab = (
    fromIndex: number,
    toIndex: number,
    groupId?: string | null,
    options?: { moveGroupId?: string },
  ) => {
    if (fromIndex === toIndex && groupId === undefined && !options?.moveGroupId) {
      return;
    }

    let current = [...unwrap(tabsStore)];
    const currentGroups = [...unwrap(groupsStore)];

    if (options?.moveGroupId) {
      const moving = current.filter((tab) => tab.groupId === options.moveGroupId);
      current = current.filter((tab) => tab.groupId !== options.moveGroupId);
      const adjustedTo =
        toIndex > fromIndex ? toIndex - moving.length : toIndex;
      current.splice(Math.max(0, adjustedTo), 0, ...moving);
      commitNormalized(setTabsStore, setGroupsStore, current, currentGroups);
      return;
    }

    if (fromIndex < 0 || fromIndex >= current.length) return;
    const [moved] = current.splice(fromIndex, 1);
    if (!moved) return;

    if (groupId !== undefined && !moved.pinned) {
      moved.groupId = groupId || undefined;
    }

    let insertAt = toIndex;
    if (fromIndex < toIndex) {
      insertAt = toIndex - 1;
    }
    insertAt = Math.max(0, Math.min(insertAt, current.length));
    current.splice(insertAt, 0, moved);
    commitNormalized(setTabsStore, setGroupsStore, current, currentGroups);
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
      groupId: undefined,
    };
    const lastPinnedIndex = next.reduce(
      (acc, t, i) => (t.pinned ? i : acc),
      -1,
    );
    next.splice(lastPinnedIndex + 1, 0, updatedTab);
    commitNormalized(setTabsStore, setGroupsStore, next, unwrap(groupsStore));
  };

  const createGroup = (
    tabIds: string[],
    name?: string,
    color?: TabGroupColor,
  ) => {
    const current = unwrap(tabsStore);
    const currentGroups = unwrap(groupsStore);
    const validIds = tabIds.filter((id) => {
      const tab = current.find((item) => item.id === id);
      return tab && !tab.pinned;
    });
    if (validIds.length === 0) return "";

    const groupId = createGroupId();
    const groupColor =
      color ?? nextGroupColor(currentGroups.map((group) => group.color));
    const groupName =
      name?.trim() || defaultGroupName(currentGroups.length + 1);

    const nextTabs = current.map((tab) =>
      validIds.includes(tab.id) ? { ...tab, groupId } : tab,
    );
    const nextGroups = [
      ...currentGroups,
      { id: groupId, name: groupName, color: groupColor },
    ];
    commitNormalized(setTabsStore, setGroupsStore, nextTabs, nextGroups);
    return groupId;
  };

  const addTabsToGroup = (groupId: string, tabIds: string[]) => {
    const current = unwrap(tabsStore);
    if (!groupsStore.some((group) => group.id === groupId)) return;
    const nextTabs = current.map((tab) => {
      if (tabIds.includes(tab.id) && !tab.pinned) {
        return { ...tab, groupId };
      }
      return tab;
    });
    commitNormalized(setTabsStore, setGroupsStore, nextTabs, [
      ...unwrap(groupsStore),
    ]);
  };

  const removeTabsFromGroup = (tabIds: string[]) => {
    const current = unwrap(tabsStore);
    const nextTabs = current.map((tab) =>
      tabIds.includes(tab.id) ? { ...tab, groupId: undefined } : tab,
    );
    commitNormalized(setTabsStore, setGroupsStore, nextTabs, [
      ...unwrap(groupsStore),
    ]);
  };

  const renameGroup = (groupId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setGroupsStore(
      produce((draft) => {
        const group = draft.find((item) => item.id === groupId);
        if (group) group.name = trimmed;
      }),
    );
  };

  const setGroupColor = (groupId: string, color: TabGroupColor) => {
    setGroupsStore(
      produce((draft) => {
        const group = draft.find((item) => item.id === groupId);
        if (group) group.color = color;
      }),
    );
  };

  const toggleGroupCollapsed = (groupId: string) => {
    const current = unwrap(tabsStore);
    const group = groupsStore.find((item) => item.id === groupId);
    if (!group) return;

    const willCollapse = !group.collapsed;
    const memberIds = new Set(
      current.filter((tab) => tab.groupId === groupId).map((tab) => tab.id),
    );

    if (willCollapse) {
      if (memberIds.has(activeTabId())) {
        const collapsedIds = collapsedGroupIds(unwrap(groupsStore));
        const activeIndex = current.findIndex(
          (tab) => tab.id === activeTabId(),
        );
        let fallbackId = "";
        for (let index = activeIndex - 1; index >= 0; index -= 1) {
          if (
            !memberIds.has(current[index].id) &&
            isTabVisible(current[index], collapsedIds)
          ) {
            fallbackId = current[index].id;
            break;
          }
        }
        if (!fallbackId) {
          for (let index = activeIndex + 1; index < current.length; index += 1) {
            if (
              !memberIds.has(current[index].id) &&
              isTabVisible(current[index], collapsedIds)
            ) {
              fallbackId = current[index].id;
              break;
            }
          }
        }
        if (fallbackId) {
          setActiveTabId(fallbackId);
        }
      }
    } else {
      const active = current.find((tab) => tab.id === activeTabId());
      if (active?.groupId && active.groupId !== groupId) {
        const firstMember = current.find((tab) => tab.groupId === groupId);
        if (firstMember) setActiveTabId(firstMember.id);
      }
    }

    setGroupsStore(
      produce((draft) => {
        if (willCollapse) {
          const item = draft.find((entry) => entry.id === groupId);
          if (item) item.collapsed = true;
          return;
        }
        for (const item of draft) {
          item.collapsed = item.id !== groupId;
        }
      }),
    );
  };

  const revealTab = (tabId: string) => {
    const tab = unwrap(tabsStore).find((item) => item.id === tabId);
    if (!tab) return;
    const groups = unwrap(groupsStore);

    if (!tab.groupId) {
      if (groups.every((group) => group.collapsed)) return;
      setGroupsStore(
        produce((draft) => {
          for (const item of draft) {
            item.collapsed = true;
          }
        }),
      );
      return;
    }

    const groupId = tab.groupId;
    if (!groups.some((group) => group.id === groupId)) return;
    if (
      groups.every((group) =>
        group.id === groupId ? !group.collapsed : group.collapsed,
      )
    ) {
      return;
    }

    setGroupsStore(
      produce((draft) => {
        for (const item of draft) {
          item.collapsed = item.id !== groupId;
        }
      }),
    );
  };

  const ungroupGroup = (groupId: string) => {
    const current = unwrap(tabsStore);
    const nextTabs = current.map((tab) =>
      tab.groupId === groupId ? { ...tab, groupId: undefined } : tab,
    );
    const nextGroups = unwrap(groupsStore).filter(
      (group) => group.id !== groupId,
    );
    commitNormalized(setTabsStore, setGroupsStore, nextTabs, nextGroups);
  };

  const closeGroup = (groupId: string) => {
    const current = unwrap(tabsStore);
    const members = current.filter((tab) => tab.groupId === groupId);
    if (members.length === 0) return;
    const group = unwrap(groupsStore).find((item) => item.id === groupId);
    pushClosedTabs(
      members.map((tab) => ({ tab, index: current.indexOf(tab), group })),
    );
    clearHistoryTimers(members.map((tab) => tab.id));
    const nextTabs = current.filter((tab) => tab.groupId !== groupId);
    const nextGroups = unwrap(groupsStore).filter(
      (group) => group.id !== groupId,
    );
    if (members.some((tab) => tab.id === activeTabId())) {
      const remaining = nextTabs;
      if (remaining.length === 0) {
        setActiveTabId("");
      } else {
        const closedIndex = current.findIndex(
          (tab) => tab.id === activeTabId(),
        );
        const fallback =
          remaining[Math.min(closedIndex, remaining.length - 1)] ??
          remaining[remaining.length - 1];
        setActiveTabId(fallback.id);
      }
    }
    commitNormalized(setTabsStore, setGroupsStore, nextTabs, nextGroups);
  };

  return {
    tabs,
    groups,
    activeTabId,
    setActiveTabId,
    addTab,
    closeTab,
    closeAllTabs,
    closeOtherTabs,
    updateTab,
    reorderTabs,
    moveTab,
    duplicateTab,
    togglePin,
    promoteTab,
    reopenClosedTab,
    canReopenClosedTab,
    createGroup,
    addTabsToGroup,
    removeTabsFromGroup,
    renameGroup,
    setGroupColor,
    toggleGroupCollapsed,
    revealTab,
    ungroupGroup,
    closeGroup,
  };
}
