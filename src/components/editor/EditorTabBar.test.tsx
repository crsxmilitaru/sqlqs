import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { QueryTab, TabGroup } from "../../lib/types";
import EditorTabBar from "./EditorTabBar";

function tab(id: string, title: string, groupId?: string): QueryTab {
  return {
    id,
    title,
    sql: `SELECT '${title}'`,
    savedSql: `SELECT '${title}'`,
    isExecuting: false,
    groupId,
  };
}

function createProps(
  overrides: Partial<Parameters<typeof EditorTabBar>[0]> = {},
): Parameters<typeof EditorTabBar>[0] {
  return {
    tabs: [tab("tab-1", "First"), tab("tab-2", "Second")],
    groups: [],
    activeTabId: "tab-1",
    pinnedCount: 0,
    onTabChange: vi.fn(),
    onTabClose: vi.fn(),
    onTabCloseOthers: vi.fn(),
    onTabCloseAll: vi.fn(),
    onTabUpdate: vi.fn(),
    onTabMove: vi.fn(),
    onTabDuplicate: vi.fn(() => "tab-copy"),
    onTabTogglePin: vi.fn(),
    onTabPromote: vi.fn(),
    onTabReopen: vi.fn(() => "tab-reopened"),
    canReopenClosedTab: () => false,
    onTabAdd: vi.fn(() => "tab-new"),
    onTabCreateGroup: vi.fn(() => "group-new"),
    onTabAddToGroup: vi.fn(),
    onTabRemoveFromGroup: vi.fn(),
    onGroupRename: vi.fn(),
    onGroupSetColor: vi.fn(),
    onGroupToggleCollapsed: vi.fn(),
    onGroupUngroup: vi.fn(),
    onGroupClose: vi.fn(),
    requestSingleTabClose: vi.fn(),
    requestCloseOthers: vi.fn(),
    requestCloseAll: vi.fn(),
    requestCloseGroup: vi.fn(),
    requestCloseTabs: vi.fn(),
    isTabDirty: () => false,
    setTabBarRef: vi.fn(),
    setTabBarContextMenuHandler: vi.fn(),
    onRenamingChange: vi.fn(),
    ...overrides,
  };
}

describe("EditorTabBar", () => {
  it("activates and closes individual tabs", () => {
    const onTabChange = vi.fn();
    const requestSingleTabClose = vi.fn();
    render(() => (
      <EditorTabBar
        {...createProps({ onTabChange, requestSingleTabClose })}
      />
    ));

    fireEvent.click(screen.getByRole("tab", { name: /Second/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close Second" }));

    expect(onTabChange).toHaveBeenCalledWith("tab-2");
    expect(requestSingleTabClose).toHaveBeenCalledWith("tab-2");
  });

  it("hides members and shows their count for collapsed groups", () => {
    const group: TabGroup = {
      id: "group-1",
      name: "Core",
      color: "blue",
      collapsed: true,
    };
    render(() => (
      <EditorTabBar
        {...createProps({
          tabs: [tab("tab-1", "First", group.id), tab("tab-2", "Second", group.id)],
          groups: [group],
        })}
      />
    ));

    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("toggles groups and promotes temporary tabs on double click", () => {
    const onGroupToggleCollapsed = vi.fn();
    const onTabPromote = vi.fn();
    const group: TabGroup = {
      id: "group-1",
      name: "Core",
      color: "cyan",
    };
    render(() => (
      <EditorTabBar
        {...createProps({
          tabs: [
            { ...tab("tab-1", "Preview", group.id), temporary: true },
          ],
          groups: [group],
          onGroupToggleCollapsed,
          onTabPromote,
        })}
      />
    ));

    fireEvent.click(screen.getByText("Core"));
    fireEvent.dblClick(screen.getByRole("tab", { name: /Preview/ }));

    expect(onGroupToggleCollapsed).toHaveBeenCalledWith("group-1");
    expect(onTabPromote).toHaveBeenCalledWith("tab-1");
  });
});
