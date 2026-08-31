import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import StatisticsDialog from "./StatisticsDialog";
import type { QueryStatistics } from "../../lib/types";

const statistics: QueryStatistics = {
  parseAndCompileCpuTimeMs: 3,
  executionCpuTimeMs: 7,
  parseAndCompileElapsedTimeMs: 4,
  executionElapsedTimeMs: 16,
  tableIo: [
    {
      tableName: "dbo.Orders",
      scanCount: 2,
      logicalReads: 1500,
      physicalReads: 40,
      readAheadReads: 300,
      lobLogicalReads: 0,
      lobPhysicalReads: 0,
      lobReadAheadReads: 0,
    },
    {
      tableName: "dbo.Customers",
      scanCount: 1,
      logicalReads: 200,
      physicalReads: 10,
      readAheadReads: 0,
      lobLogicalReads: 5,
      lobPhysicalReads: 2,
      lobReadAheadReads: 1,
    },
  ],
};

describe("StatisticsDialog", () => {
  it("renders aggregated KPIs and table I/O rows", async () => {
    const onClose = vi.fn();
    render(() => (
      <StatisticsDialog statistics={statistics} onClose={onClose} />
    ));

    expect(
      screen.getByText("Query Execution Statistics"),
    ).toBeInTheDocument();
    expect(screen.getByText("10 ms")).toBeInTheDocument();
    expect(screen.getByText("20 ms")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/[^\d]/g, "") === "2058",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 tables\s*touched/)).toBeInTheDocument();
    expect(screen.getByText("dbo.Orders")).toBeInTheDocument();
    expect(screen.getByText("dbo.Customers")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent?.replace(/[^\d]/g, "") === "1500",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Logical reads are page requests satisfied from the buffer cache/,
      ),
    ).toBeInTheDocument();
  });

  it("shows an empty state without table I/O", () => {
    render(() => (
      <StatisticsDialog
        statistics={{ ...statistics, tableIo: [] }}
        onClose={vi.fn()}
      />
    ));

    expect(
      screen.getByText((_, element) => element?.textContent === "0"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.textContent?.replace(/\s+/g, " ").trim() ===
          "0 tables touched",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("No Table I/O operations reported by SQL Server."),
    ).toBeInTheDocument();
  });
});
