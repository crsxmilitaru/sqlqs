import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import ObjectExplorer from "./ObjectExplorer";

describe("ObjectExplorer", () => {
  it("renders its primary sections without databases", () => {
    render(() => (
      <ObjectExplorer
        databases={[]}
        onSelect={vi.fn()}
        onDatabaseChange={vi.fn()}
        onDeleteHistory={vi.fn()}
      />
    ));

    expect(screen.getByText("Databases")).toBeInTheDocument();
    expect(screen.getByText("Queries")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });
});
