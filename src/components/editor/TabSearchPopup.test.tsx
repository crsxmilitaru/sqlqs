import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { TabSearchPopup } from "./TabSearchPopup";
import type { ClosedTab, QueryTab } from "../../lib/types";

function createTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    id: "tab-1",
    title: "Customers Query",
    sql: "SELECT * FROM Customers",
    savedSql: "SELECT * FROM Customers",
    isExecuting: false,
    ...overrides,
  };
}

function createClosedTab(overrides: Partial<ClosedTab> = {}): ClosedTab {
  return {
    title: "Orders Report",
    sql: "SELECT * FROM Orders",
    savedSql: "SELECT * FROM Orders",
    index: 0,
    closedAt: Date.now() - 30000,
    ...overrides,
  };
}

function renderPopup(
  overrides: Partial<Parameters<typeof TabSearchPopup>[0]> = {},
) {
  const anchor = document.createElement("button");
  document.body.append(anchor);

  const defaultProps: Parameters<typeof TabSearchPopup>[0] = {
    anchor,
    open: true,
    onClose: vi.fn(),
    tabs: [
      createTab({
        id: "tab-1",
        title: "Customers Query",
        savedQueryFilePath: "C:\\Queries\\Customers.sql",
      }),
      createTab({
        id: "tab-2",
        title: "Products Inventory",
        sql: "",
        savedSql: "",
      }),
    ],
    activeTabId: "tab-1",
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    closedTabs: [createClosedTab({ title: "Orders Report" })],
    onReopenTab: vi.fn(),
    ...overrides,
  };

  const utils = render(() => <TabSearchPopup {...defaultProps} />);
  return { ...utils, props: defaultProps, anchor };
}

describe("TabSearchPopup", () => {
  it("renders open tabs with proper subtitles and collapsed recently closed header", () => {
    renderPopup();

    expect(screen.getByPlaceholderText("Search tabs…")).toBeInTheDocument();
    expect(screen.getByText("Open Tabs")).toBeInTheDocument();
    expect(screen.getByText("Customers Query")).toBeInTheDocument();
    expect(screen.getByText("Queries")).toBeInTheDocument();
    expect(screen.getByText("Products Inventory")).toBeInTheDocument();
    expect(screen.getByText("New Query")).toBeInTheDocument();
    expect(screen.getByText(/Recently Closed/)).toBeInTheDocument();
    expect(screen.queryByText("Orders Report")).not.toBeInTheDocument();
  });

  it("filters tabs based on search query and reveals matching closed tabs", async () => {
    renderPopup();

    const input = screen.getByPlaceholderText("Search tabs…");
    fireEvent.input(input, { target: { value: "Orders" } });

    expect(screen.getByText("Orders Report")).toBeInTheDocument();
    expect(screen.queryByText("Customers Query")).not.toBeInTheDocument();
  });

  it("calls onSelectTab when an open tab is clicked", () => {
    const { props } = renderPopup();

    fireEvent.click(screen.getByText("Products Inventory"));

    expect(props.onSelectTab).toHaveBeenCalledWith("tab-2");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("calls onCloseTab when close button is clicked", () => {
    const { props } = renderPopup();

    const closeBtn = screen.getByLabelText("Close Customers Query");
    fireEvent.click(closeBtn);

    expect(props.onCloseTab).toHaveBeenCalledWith("tab-1");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("calls onReopenTab when an expanded closed tab is clicked", () => {
    const { props } = renderPopup();

    fireEvent.click(screen.getByText(/Recently Closed/));
    expect(screen.getByText("Orders Report")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Orders Report"));

    expect(props.onReopenTab).toHaveBeenCalledWith(0);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape key is pressed", () => {
    const { props } = renderPopup();

    fireEvent.keyDown(screen.getByPlaceholderText("Search tabs…"), {
      key: "Escape",
    });

    expect(props.onClose).toHaveBeenCalled();
  });
});
