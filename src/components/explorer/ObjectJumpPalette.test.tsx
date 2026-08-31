import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ObjectJumpPalette from "./ObjectJumpPalette";

describe("ObjectJumpPalette", () => {
  it("shows the unavailable state while disconnected", async () => {
    render(() => (
      <ObjectJumpPalette
        open
        connected={false}
        indexStatus={{
          initialized: false,
          indexing: false,
          database_count: 0,
          processed_database_count: 0,
          failed_databases: [],
          object_count: 0,
        }}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    ));

    expect(
      await screen.findByRole("dialog", { name: "Jump to database object" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No recent objects yet — type to search across all databases."),
    ).toBeInTheDocument();
  });
});
