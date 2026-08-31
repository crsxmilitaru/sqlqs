import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import EditorHistoryDialog from "./EditorHistoryDialog";
import type { QueryTab, QueryTabHistoryEntry } from "../../lib/types";

const baseTab = {
  id: "tab-1",
  title: "query.sql",
  sql: "SELECT b\nFROM Orders b\nWHERE b.Id = 1",
} as unknown as QueryTab;

function historyEntry(
  id: string,
  sql: string,
  createdAt: number,
  type: "action" | "typing" = "typing",
  label?: string,
) {
  return { id, sql, createdAt, type, label } as QueryTabHistoryEntry;
}

function renderDialog(tab: QueryTab) {
  const onClose = vi.fn();
  const onRestore = vi.fn();
  render(() => (
    <EditorHistoryDialog tab={tab} onClose={onClose} onRestore={onRestore} />
  ));
  return { onClose, onRestore };
}

describe("EditorHistoryDialog", () => {
  it("renders restore points and a diff against the current editor", async () => {
    const now = Date.now();
    const tab = {
      ...baseTab,
      history: [
        historyEntry("h1", "SELECT a\nFROM Users a", now - 5 * 60_000),
        historyEntry(
          "h2",
          baseTab.sql,
          now - 60_000,
          "action",
          "Formatted",
        ),
      ],
    } as QueryTab;
    renderDialog(tab);

    expect(screen.getByText("1 restore point")).toBeInTheDocument();
    expect(screen.getByText("5 min ago")).toBeInTheDocument();
    expect(screen.getByText(/2 lines .{1,3} 21 chars/)).toBeInTheDocument();
    expect(screen.getByText("Snapshot vs Current")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ").trim() ===
          "2 removed - 3 added",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("SELECT a")).toBeInTheDocument();
    expect(screen.getByText("FROM Users a")).toBeInTheDocument();
    expect(screen.getByText("WHERE b.Id = 1")).toBeInTheDocument();
  });

  it("restores a snapshot and closes", async () => {
    const tab = {
      ...baseTab,
      history: [historyEntry("h1", "SELECT 1", Date.now() - 30_000)],
    } as QueryTab;
    const { onClose, onRestore } = renderDialog(tab);

    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));

    expect(onRestore).toHaveBeenCalledWith("SELECT 1");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("switches between restore points", async () => {
    const now = Date.now();
    const tab = {
      ...baseTab,
      history: [
        historyEntry("h1", "SELECT old", now - 3 * 3_600_000),
        historyEntry("h2", "SELECT newer", now - 2 * 3_600_000),
      ],
    } as QueryTab;
    renderDialog(tab);

    expect(screen.getByText(/3 hrs? ago/)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button").filter((b) =>
      /hrs? ago/.test(b.textContent ?? ""),
    );
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      expect(screen.getByText("SELECT newer")).toBeInTheDocument();
    });
    expect(screen.queryByText("SELECT old")).not.toBeInTheDocument();
  });

  it("shows action labels for action snapshots", async () => {
    const tab = {
      ...baseTab,
      history: [
        historyEntry("h1", "SELECT 2", Date.now() - 26 * 3_600_000, "action", "Renamed tab"),
      ],
    } as QueryTab;
    renderDialog(tab);

    expect(screen.getByText("Renamed tab")).toBeInTheDocument();
    expect(screen.getByText("1 day ago")).toBeInTheDocument();
  });

  it("shows an empty state without usable history", async () => {
    const tab = {
      ...baseTab,
      history: [historyEntry("h1", baseTab.sql, Date.now())],
    } as QueryTab;
    renderDialog(tab);

    expect(screen.getByText("0 restore points")).toBeInTheDocument();
    expect(
      screen.getByText("No text history is available for this editor."),
    ).toBeInTheDocument();
  });

  it("marks no-change snapshots as identical", async () => {
    const tab = {
      ...baseTab,
      history: [historyEntry("h1", "SELECT b\nFROM Orders b\nWHERE b.Id = 1", Date.now() - 10_000)],
    } as QueryTab;
    renderDialog(tab as QueryTab);

    expect(screen.getByText("0 restore points")).toBeInTheDocument();
  });
});
