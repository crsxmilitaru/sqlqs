import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryTab } from "../../lib/types";
import QueryEditorPanel from "./QueryEditorPanel";

const editorSelection = vi.hoisted(() => ({ value: "" }));
let selectionChangeCallback: ((hasSelection: boolean) => void) | undefined;
let historyDepthChangeCallback:
  | ((state: { canUndo: boolean; canRedo: boolean }) => void)
  | undefined;

vi.mock("./SqlEditor", () => ({
  default: (props: {
    onSelectionChange?: (hasSelection: boolean) => void;
    onHistoryDepthChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
    onContextMenu?: (e: MouseEvent) => void;
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
      undo: () => boolean;
      redo: () => boolean;
      canUndo: () => boolean;
      canRedo: () => boolean;
      toggleComment: () => boolean;
      toUpperCase: () => boolean;
      toLowerCase: () => boolean;
    }) => void;
  }) => {
    selectionChangeCallback = props.onSelectionChange;
    historyDepthChangeCallback = props.onHistoryDepthChange;
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
      undo: vi.fn(),
      redo: vi.fn(),
      canUndo: () => false,
      canRedo: () => false,
      toggleComment: vi.fn(),
      toUpperCase: vi.fn(),
      toLowerCase: vi.fn(),
    });
    return (
      <div
        data-testid="sql-editor"
        onContextMenu={(e: MouseEvent) => {
          props.onContextMenu?.(e);
        }}
      />
    );
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

  it("progressively overflows toolbar buttons into a more menu based on width", async () => {
    let resizeCallback:
      | ((entries: ResizeObserverEntry[], observer: ResizeObserver) => void)
      | undefined;
    class TestResizeObserver implements ResizeObserver {
      constructor(
        cb: (entries: ResizeObserverEntry[], observer: ResizeObserver) => void,
      ) {
        resizeCallback = cb;
      }
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const user = userEvent.setup();
    const tab = queryTab();
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: "app",
          databases: ["app"],
          onSave: vi.fn(),
        })}
      />
    ));

    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy SQL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Format SQL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UPPERCASE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "lowercase" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More actions" })).not.toBeInTheDocument();

    resizeCallback?.(
      [
        {
          contentRect: { width: 480, height: 40, top: 0, left: 0, bottom: 40, right: 480, x: 0, y: 0, toJSON: () => {} },
          target: document.createElement("div"),
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );

    const moreBtn = await screen.findByRole("button", { name: "More actions" });
    expect(moreBtn).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Redo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle Comment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy SQL" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Find" })).not.toBeInTheDocument();

    await user.click(moreBtn);
    expect(await screen.findByRole("button", { name: /Find/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /History/ })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    resizeCallback?.(
      [
        {
          contentRect: { width: 300, height: 40, top: 0, left: 0, bottom: 40, right: 300, x: 0, y: 0, toJSON: () => {} },
          target: document.createElement("div"),
        } as unknown as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Toggle Comment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy SQL" })).not.toBeInTheDocument();
  });

  it("disables all toolbar buttons when no database is selected", async () => {
    const tab = queryTab();
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: undefined,
          databases: [],
          onSave: vi.fn(),
          onSaveToFile: vi.fn(),
        })}
      />
    ));

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Toggle Comment" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy SQL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Format SQL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "UPPERCASE" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "lowercase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enable Word Wrap" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save SQL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save SQL to file" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Find" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "History" })).toBeDisabled();
  });

  it("verifies all toolbar buttons enabled/disabled states based on connection, SQL, and text selection", async () => {
    const tab = queryTab({
      history: [
        { id: "h-1", sql: "SELECT 1", createdAt: Date.now() - 1000, type: "action" },
        { id: "h-2", sql: "SELECT * FROM dbo.Users", createdAt: Date.now(), type: "typing" },
      ],
    });
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: "app",
          databases: ["app"],
          onSave: vi.fn(),
          onSaveToFile: vi.fn(),
        })}
      />
    ));

    await screen.findByTestId("sql-editor");

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Toggle Comment" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy SQL" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Format SQL" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Enable Word Wrap" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save SQL" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save SQL to file" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Find" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "History (1)" })).toBeEnabled();

    historyDepthChangeCallback?.({ canUndo: true, canRedo: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    expect(screen.getByRole("button", { name: "UPPERCASE" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "lowercase" })).toBeDisabled();

    selectionChangeCallback?.(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "UPPERCASE" })).toBeEnabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "lowercase" })).toBeEnabled(),
    );

    selectionChangeCallback?.(false);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "UPPERCASE" })).toBeDisabled(),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "lowercase" })).toBeDisabled(),
    );
  });

  it("verifies context menu editor items enabled and disabled states based on text selection", async () => {
    const user = userEvent.setup();
    const tab = queryTab();
    render(() => (
      <QueryEditorPanel
        {...createProps({
          tabs: [tab],
          activeTabId: tab.id,
          connected: true,
          currentDatabase: "app",
          databases: ["app"],
        })}
      />
    ));

    await screen.findByTestId("sql-editor");

    editorSelection.value = "";
    fireEvent.contextMenu(screen.getByTestId("sql-editor"), { clientX: 100, clientY: 100 });

    await waitFor(() => {
      const menu = document.querySelector(".popup-menu") as HTMLElement;
      expect(menu).toBeTruthy();
      expect(within(menu).getByRole("button", { name: /^Undo/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^Redo/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^Cut/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^Copy/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^UPPERCASE/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^lowercase/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^Send to Chat/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^Select All/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^Toggle Comment/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^Format/, hidden: true })).toBeEnabled();
    });

    await user.keyboard("{Escape}");

    historyDepthChangeCallback?.({ canUndo: true, canRedo: false });
    editorSelection.value = "SELECT *";
    fireEvent.contextMenu(screen.getByTestId("sql-editor"), { clientX: 100, clientY: 100 });

    await waitFor(() => {
      const menu = document.querySelector(".popup-menu") as HTMLElement;
      expect(menu).toBeTruthy();
      expect(within(menu).getByRole("button", { name: /^Undo/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^Redo/, hidden: true })).toBeDisabled();
      expect(within(menu).getByRole("button", { name: /^Cut/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^Copy/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^UPPERCASE/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^lowercase/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^Send to Chat/, hidden: true })).toBeEnabled();
      expect(within(menu).getByRole("button", { name: /^Format Selection/, hidden: true })).toBeEnabled();
    });

  });

  it("opens the tab search popup when clicking the search tabs button", async () => {
    const user = userEvent.setup();
    render(() => (
      <QueryEditorPanel
        {...createProps({
          connected: true,
          tabs: [queryTab({ id: "tab-1", title: "Test Tab" })],
          activeTabId: "tab-1",
        })}
      />
    ));

    const searchBtn = screen.getByRole("button", { name: "Search tabs" });
    expect(searchBtn).toBeInTheDocument();

    await user.click(searchBtn);

    expect(screen.getByPlaceholderText("Search tabs…")).toBeInTheDocument();
  });
});
