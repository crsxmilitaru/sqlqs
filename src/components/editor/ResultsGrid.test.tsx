import { fireEvent, render, screen } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryResult } from "../../lib/types";
import { setInvokeHandler } from "../../test/tauri";
import ResultsGrid from "./ResultsGrid";

const result: QueryResult = {
  result_sets: [
    {
      columns: [
        {
          name: "Id",
          type_name: "int",
          is_identity: true,
          is_nullable: false,
        },
        {
          name: "Name",
          type_name: "nvarchar",
          is_identity: false,
          is_nullable: false,
        },
      ],
      rows: [
        [2, "Bob"],
        [1, "Alice"],
        [3, "Carol"],
        [4, "Dan"],
        [5, "Eve"],
        [6, "Frank"],
      ],
    },
  ],
  rows_affected: 0,
  messages: [],
  elapsed_ms: 10,
  outputs: [],
};

function renderGrid(overrides: Partial<Parameters<typeof ResultsGrid>[0]> = {}) {
  const onTableViewStateChange = vi.fn();
  render(() => (
    <ResultsGrid
      result={result}
      isExecuting={false}
      sourceSql="SELECT Id, Name FROM dbo.Users"
      tableViewStates={{}}
      onTableViewStateChange={onTableViewStateChange}
      {...overrides}
    />
  ));
  return { onTableViewStateChange };
}

describe("ResultsGrid", () => {
  beforeEach(() => {
    setInvokeHandler((command) => {
      if (command === "extract_table_name") return "dbo.Users";
      if (command === "extract_result_set_table_names") return ["dbo.Users"];
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("shows execution and empty-result states", () => {
    const { unmount } = render(() => (
      <ResultsGrid
        isExecuting
        tableViewStates={{}}
        onTableViewStateChange={vi.fn()}
      />
    ));

    expect(screen.getByText("Executing query…")).toBeInTheDocument();
    unmount();

    render(() => (
      <ResultsGrid
        isExecuting={false}
        tableViewStates={{}}
        onTableViewStateChange={vi.fn()}
      />
    ));
    expect(screen.getByText(/to execute/)).toBeInTheDocument();
  });

  it("forwards errors to chat", () => {
    const onSendErrorToChat = vi.fn();
    renderGrid({ result: undefined, error: "Invalid object", onSendErrorToChat });

    fireEvent.click(screen.getByRole("button", { name: "Send to Chat" }));

    expect(onSendErrorToChat).toHaveBeenCalledWith("Invalid object");
  });

  it("updates sorting and filtering state", () => {
    const { onTableViewStateChange } = renderGrid();

    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    expect(onTableViewStateChange).toHaveBeenCalledWith(0, {
      sortConfig: { colIndex: 1, direction: "asc" },
      filters: {},
    });

    fireEvent.input(screen.getByRole("textbox", { name: "Filter Name" }), {
      target: { value: "bo" },
    });
    expect(onTableViewStateChange).toHaveBeenCalledWith(0, {
      sortConfig: null,
      filters: { 1: "bo" },
    });
  });

  it("sends a bounded Markdown representation to chat", () => {
    const onSendResultToChat = vi.fn();
    renderGrid({ onSendResultToChat });

    fireEvent.click(screen.getByRole("button", { name: "Send to Chat" }));

    expect(onSendResultToChat).toHaveBeenCalledOnce();
    expect(onSendResultToChat.mock.calls[0][0]).toContain("| Id | Name |");
    expect(onSendResultToChat.mock.calls[0][0]).toContain("| 2 | Bob |");
  });
});
