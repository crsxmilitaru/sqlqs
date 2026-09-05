import { renderHook } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabs } from "./useTabs";

describe("useTabs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("adds tabs, normalizes SQL, and reuses matching sources", () => {
    const { result } = renderHook(useTabs);

    const id = result.addTab("SELECT 1\r\nGO", undefined, "file:users");
    const duplicateId = result.addTab("SELECT 2", "Duplicate", "file:users");

    expect(duplicateId).toBe(id);
    expect(result.tabs()).toHaveLength(1);
    expect(result.tabs()[0]).toMatchObject({
      id,
      title: "SELECT 1",
      sql: "SELECT 1\nGO",
      savedSql: "SELECT 1\nGO",
      sourceId: "file:users",
    });
    expect(result.activeTabId()).toBe(id);
  });

  it("reuses a temporary preview tab and promotes it after editing", () => {
    const { result } = renderHook(useTabs);

    const firstId = result.addTab(
      "SELECT 1",
      "History 1",
      "history:1",
    );
    const secondId = result.addTab(
      "SELECT 2",
      "History 2",
      "history:2",
    );

    expect(secondId).toBe(firstId);
    expect(result.tabs()).toHaveLength(1);
    expect(result.tabs()[0].temporary).toBe(true);

    result.updateTab(secondId, { sql: "SELECT 3" }, { historyMode: "none" });

    expect(result.tabs()[0].temporary).toBeUndefined();
  });

  it("closes and reopens tabs at their previous position", () => {
    const { result } = renderHook(useTabs);
    const firstId = result.addTab("SELECT 1", "First");
    const secondId = result.addTab("SELECT 2", "Second");

    result.closeTab(firstId);

    expect(result.canReopenClosedTab()).toBe(true);
    const reopenedId = result.reopenClosedTab();

    expect(reopenedId).not.toBe(firstId);
    expect(result.tabs().map((tab) => tab.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(result.activeTabId()).toBe(reopenedId);
    expect(result.tabs().some((tab) => tab.id === secondId)).toBe(true);
  });

  it("exposes closed tabs and allows reopening by index", () => {
    const { result } = renderHook(useTabs);
    const firstId = result.addTab("SELECT 1", "First");
    const secondId = result.addTab("SELECT 2", "Second");

    result.closeTab(firstId);
    result.closeTab(secondId);

    expect(result.closedTabs()).toHaveLength(2);
    expect(result.closedTabs().map((tab) => tab.title)).toEqual([
      "First",
      "Second",
    ]);

    const reopenedId = result.reopenClosedTab(0);
    expect(
      result.tabs().some((t) => t.id === reopenedId && t.title === "First"),
    ).toBe(true);
    expect(result.closedTabs()).toHaveLength(1);
    expect(result.closedTabs()[0].title).toBe("Second");
  });

  it("keeps pinned tabs when closing all tabs", () => {
    const { result } = renderHook(useTabs);
    const pinnedId = result.addTab("SELECT 1", "Pinned");
    result.addTab("SELECT 2", "Regular");
    result.togglePin(pinnedId);

    result.closeAllTabs();

    expect(result.tabs()).toHaveLength(1);
    expect(result.tabs()[0]).toMatchObject({ id: pinnedId, pinned: true });
    expect(result.activeTabId()).toBe(pinnedId);
  });

  it("duplicates and reorders tabs without copying source identity", () => {
    const { result } = renderHook(useTabs);
    const firstId = result.addTab("SELECT 1", "First", "file:first");
    result.addTab("SELECT 2", "Second");

    const duplicateId = result.duplicateTab(firstId);
    result.reorderTabs(2, 0);

    expect(result.tabs()[0]).toMatchObject({
      id: duplicateId,
      title: "First",
      sql: "SELECT 1",
    });
    expect(result.tabs()[0].sourceId).toBeUndefined();
  });

  it("handles savedQueryFilePath and restores it on reopen", () => {
    const { result } = renderHook(useTabs);
    const tabId = result.addTab("SELECT 1", "Saved Query", "saved:C:\\Queries\\Saved.sql", true, {
      savedQueryFilePath: "C:\\Queries\\Saved.sql",
    });

    expect(result.tabs()[0].savedQueryFilePath).toBe("C:\\Queries\\Saved.sql");

    const dupId = result.duplicateTab(tabId);
    expect(result.tabs().find((t) => t.id === dupId)?.savedQueryFilePath).toBeUndefined();

    result.closeTab(tabId);
    const reopenedId = result.reopenClosedTab();
    expect(result.tabs().find((t) => t.id === reopenedId)?.savedQueryFilePath).toBe(
      "C:\\Queries\\Saved.sql",
    );
  });

  it("captures idle text history and the saved baseline", () => {
    vi.useFakeTimers();
    const { result } = renderHook(useTabs);
    const id = result.addTab("SELECT 1", "Users");

    result.updateTab(id, { sql: "SELECT 2" });
    vi.advanceTimersByTime(3000);

    expect(result.tabs()[0].history?.map((entry) => entry.sql)).toEqual([
      "SELECT 2",
      "SELECT 1",
    ]);
    expect(result.tabs()[0].history?.[1].label).toBe("Before typing");
  });

  it("creates, updates, and removes tab groups", () => {
    const { result } = renderHook(useTabs);
    const firstId = result.addTab("SELECT 1", "First");
    const secondId = result.addTab("SELECT 2", "Second");
    const thirdId = result.addTab("SELECT 3", "Third");

    const groupId = result.createGroup(
      [firstId, secondId],
      "Core queries",
      "purple",
    );

    expect(result.groups()).toEqual([
      { id: groupId, name: "Core queries", color: "purple" },
    ]);
    expect(
      result.tabs().filter((tab) => tab.groupId === groupId).map((tab) => tab.id),
    ).toEqual([firstId, secondId]);

    result.addTabsToGroup(groupId, [thirdId]);
    result.renameGroup(groupId, "Reporting");
    result.setGroupColor(groupId, "green");

    expect(result.tabs().every((tab) => tab.groupId === groupId)).toBe(true);
    expect(result.groups()[0]).toMatchObject({
      name: "Reporting",
      color: "green",
    });

    result.removeTabsFromGroup([secondId]);

    expect(result.tabs().find((tab) => tab.id === secondId)?.groupId)
      .toBeUndefined();
  });

  it("keeps pinned tabs outside groups", () => {
    const { result } = renderHook(useTabs);
    const pinnedId = result.addTab("SELECT 1", "Pinned");
    const regularId = result.addTab("SELECT 2", "Regular");
    result.togglePin(pinnedId);

    const groupId = result.createGroup([pinnedId, regularId]);

    expect(result.tabs().find((tab) => tab.id === pinnedId)).toMatchObject({
      pinned: true,
      groupId: undefined,
    });
    expect(result.tabs().find((tab) => tab.id === regularId)?.groupId).toBe(
      groupId,
    );
  });

  it("moves focus away when collapsing the active group", () => {
    const { result } = renderHook(useTabs);
    const firstId = result.addTab("SELECT 1", "First");
    const secondId = result.addTab("SELECT 2", "Second");
    const outsideId = result.addTab("SELECT 3", "Outside");
    const groupId = result.createGroup([firstId, secondId]);
    result.setActiveTabId(secondId);

    result.toggleGroupCollapsed(groupId);

    expect(result.groups()[0].collapsed).toBe(true);
    expect(result.activeTabId()).toBe(outsideId);

    result.revealTab(firstId);

    expect(result.groups()[0].collapsed).toBe(false);
  });

  it("restores a group when reopening one of its closed tabs", () => {
    const { result } = renderHook(useTabs);
    const firstId = result.addTab("SELECT 1", "First");
    const secondId = result.addTab("SELECT 2", "Second");
    const groupId = result.createGroup([firstId, secondId], "Grouped", "cyan");

    result.closeGroup(groupId);

    expect(result.tabs()).toEqual([]);
    expect(result.groups()).toEqual([]);

    const reopenedId = result.reopenClosedTab();

    expect(result.tabs()).toHaveLength(1);
    expect(result.tabs()[0]).toMatchObject({ id: reopenedId, groupId });
    expect(result.groups()).toEqual([
      { id: groupId, name: "Grouped", color: "cyan" },
    ]);
  });
});
