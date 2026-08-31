import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryTab } from "../../lib/types";
import QueryEditorPanel from "./QueryEditorPanel";

const editorSelection = vi.hoisted(() => ({ value: "" }));

vi.mock("./SqlEditor", () => ({
  default: (props: {
    onRef?: (handle: {
      focus: () => void;
      openCompletion: () => void;
      openSearch: () => void;
      getSelectedText: () => string;
      replaceSelection: (text: string) => void;
      formatSelection: () => boolean;
      applyFormattedDocument: (text: string) => void;
      selectAll: () => void;
      scrollToBottom: () => void;
      retainStates: (tabIds: string[]) => void;
    }) => void;
  }) => {
    props.onRef?.({
      focus: vi.fn(),
      openCompletion: vi.fn(),
      openSearch: vi.fn(),
      getSelectedText: () => editorSelection.value,
      replaceSelection: vi.fn(),
      formatSelection: () => false,
      applyFormattedDocument: vi.fn(),
      selectAll: vi.fn(),
      scrollToBottom: vi.fn(),
      retainStates: vi.fn(),
    });
    return <div data-testid="sql-editor" />;
  },
}));

vi.mock("./ResultsGrid", () => ({
  default: () => <div data-testid="results-grid" />,
}));

vi.mock("../ai/AIChatPanel", () => ({
  default: () => <div data-testid="ai-chat" />,
}));

vi.mock("../../lib/ai", () => ({
  AiService: {
    listAvailableModels: vi.fn().mockResolvedValue([]),
  },
}));

function createProps(
  overrides: Partial<Parameters<typeof QueryEditorPanel>[0]> = {},
): Parameters<typeof QueryEditorPanel>[0] {
  return {
    tabs: [],
    groups: [],
    activeTabId: "",
    onTabChange: vi.fn(),
    onTabAdd: vi.fn(() => "tab-new"),
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
    onTabCreateGroup: vi.fn(() => "group-new"),
    onTabAddToGroup: vi.fn(),
    onTabRemoveFromGroup: vi.fn(),
    onGroupRename: vi.fn(),
    onGroupSetColor: vi.fn(),
    onGroupToggleCollapsed: vi.fn(),
    onGroupUngroup: vi.fn(),
    onGroupClose: vi.fn(),
    onExecute: vi.fn(),
    connected: false,
    theme: { id: "dark", mode: "dark" },
    aiChatOpen: false,
    onAiChatOpenChange: vi.fn(),
    ...overrides,
  };
}

function queryTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    id: "tab-1",
    title: "Users",
    sql: "SELECT * FROM dbo.Users",
    savedSql: "SELECT * FROM dbo.Users",
    isExecuting: false,
    ...overrides,
  };
}

describe("QueryEditorPanel", () => {
  beforeEach(() => {
    editorSelection.value = "";
  });

  it("offers the connection action while disconnected", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(() => <QueryEditorPanel {...createProps({ onConnect })} />);

    await user.click(screen.getByRole("button", { name: "Connect Server" }));

    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("offers open, new, and reopen actions when no tabs are open", async () => {
    const user = userEvent.setup();
    const onOpenSqlFile = vi.fn();
    const onTabAdd = vi.fn(() => "tab-new");
    const onTabReopen = vi.fn(() => "tab-reopened");
    render(() => (
      <QueryEditorPanel
        {...createProps({
          connected: true,
          onOpenSqlFile,
          onTabAdd,
          onTabReopen,
          canReopenClosedTab: () => true,
        })}
      />
    ));

    await user.click(screen.getByRole("button", { name: "Open File" }));
    await user.click(screen.getByRole("button", { name: "New File" }));
    await user.click(
      screen.getByRole("button", { name: "Reopen Closed Tab" }),
    );

    expect(onOpenSqlFile).toHaveBeenCalledOnce();
    expect(onTabAdd).toHaveBeenCalledOnce();
    expect(onTabReopen).toHaveBeenCalledOnce();
  });

  it("executes the current editor selection", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    editorSelection.value = "SELECT Id FROM dbo.Users";
    const tab = queryTab();
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: "app",
          databases: ["app"],
          onExecute,
        })}
      />
    ));

    await screen.findByTestId("sql-editor");
    await user.click(await screen.findByRole("button", { name: "Execute" }));

    expect(onExecute).toHaveBeenCalledWith(
      "tab-1",
      "SELECT Id FROM dbo.Users",
    );
  });

  it("cancels an executing query once", async () => {
    const user = userEvent.setup();
    const onCancelQuery = vi.fn();
    const tab = queryTab({ isExecuting: true, execStartedAt: performance.now() });
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: "app",
          databases: ["app"],
          onCancelQuery,
        })}
      />
    ));

    const cancel = await screen.findByRole("button", { name: /Cancel/ });
    await user.click(cancel);
    await user.click(cancel);

    expect(onCancelQuery).toHaveBeenCalledOnce();
    expect(cancel).toBeDisabled();
  });

  it("confirms before closing a dirty tab", async () => {
    const user = userEvent.setup();
    const onTabClose = vi.fn();
    const tab = queryTab({ savedSql: "SELECT 1" });
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: "app",
          databases: ["app"],
          onTabClose,
        })}
      />
    ));

    await user.click(
      await screen.findByRole("button", { name: "Close Users" }),
    );
    expect(screen.getByRole("dialog", { name: "Close Tab" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onTabClose).toHaveBeenCalledWith("tab-1");
  });

  it("handles new-tab and reopen-tab keyboard shortcuts", async () => {
    const user = userEvent.setup();
    const onTabAdd = vi.fn(() => "tab-new");
    const onTabReopen = vi.fn(() => "tab-reopened");
    render(() => (
      <QueryEditorPanel
        {...createProps({
          connected: true,
          onTabAdd,
          onTabReopen,
          canReopenClosedTab: () => true,
        })}
      />
    ));

    await user.keyboard("{Control>}t{/Control}");
    await user.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");

    expect(onTabAdd).toHaveBeenCalledOnce();
    expect(onTabReopen).toHaveBeenCalledOnce();
  });
});
