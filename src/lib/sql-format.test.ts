import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadFormatPreferences } from "./settings";
import { formatSqlWithPrefs } from "./sql-format";

const { formatMock } = vi.hoisted(() => ({
  formatMock: vi.fn(() => "FORMATTED"),
}));

vi.mock("sql-formatter", () => ({
  format: formatMock,
}));

vi.mock("./settings", () => ({
  loadFormatPreferences: vi.fn(),
}));

describe("formatSqlWithPrefs", () => {
  beforeEach(() => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      indentSize: 4,
      keywordCase: "lower",
      maxLineLength: 100,
    });
  });

  it("passes SQL formatting preferences to the T-SQL formatter", async () => {
    await expect(formatSqlWithPrefs("SELECT 1")).resolves.toBe("FORMATTED");

    expect(formatMock).toHaveBeenCalledWith("SELECT 1", {
      language: "tsql",
      keywordCase: "lower",
      tabWidth: 4,
      useTabs: false,
      expressionWidth: 100,
    });
  });

  it("omits expression width when no line limit is configured", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      indentSize: 2,
      keywordCase: "preserve",
      maxLineLength: 0,
    });

    await formatSqlWithPrefs("SELECT 1");

    expect(formatMock).toHaveBeenCalledWith("SELECT 1", {
      language: "tsql",
      keywordCase: "preserve",
      tabWidth: 2,
      useTabs: false,
    });
  });
});
