import { describe, expect, it } from "vitest";
import {
  formatSqlDateValue,
  formatTimestamp,
  parseSqlTimestamp,
} from "./sql-date";

describe("parseSqlTimestamp", () => {
  it("parses dates without a time", () => {
    expect(parseSqlTimestamp("2026-08-31")).toEqual({
      year: 2026,
      month: 8,
      day: 31,
      hour: 0,
      minute: 0,
      second: 0,
      hasTime: false,
      hasOffset: false,
    });
  });

  it("parses fractional timestamps with an offset", () => {
    expect(parseSqlTimestamp("2026-08-31T14:05:06.123+03:00")).toEqual({
      year: 2026,
      month: 8,
      day: 31,
      hour: 14,
      minute: 5,
      second: 6,
      hasTime: true,
      hasOffset: true,
    });
  });

  it("rejects non-SQL timestamp strings", () => {
    expect(parseSqlTimestamp("31/08/2026")).toBeNull();
  });
});

describe("formatSqlDateValue", () => {
  it("preserves the wall-clock value of timezone-naive SQL dates", () => {
    expect(
      formatSqlDateValue(
        "2026-08-31 14:05:06.123",
        "datetime2(3)",
        "DD/MM/YYYY HH:mm:ss",
      ),
    ).toBe("31/08/2026 14:05:06");
  });

  it("formats date columns without a time", () => {
    expect(
      formatSqlDateValue(
        "2026-08-31 14:05:06",
        "date",
        "MM/DD/YYYY HH:mm:ss",
      ),
    ).toBe("08/31/2026");
  });

  it("converts datetimeoffset values to UTC", () => {
    expect(
      formatSqlDateValue(
        "2026-08-31T14:05:06+03:00",
        "datetimeoffset",
        "utc",
      ),
    ).toBe("2026-08-31 11:05:06 UTC");
  });

  it("passes through nulls, non-date values, and invalid dates", () => {
    expect(formatSqlDateValue(null, "datetime", "iso")).toBe("NULL");
    expect(formatSqlDateValue(42, "int", "iso")).toBe("42");
    expect(formatSqlDateValue("invalid", "datetime", "iso")).toBe("invalid");
  });
});

describe("formatTimestamp", () => {
  it("formats absolute timestamps in UTC", () => {
    expect(
      formatTimestamp(new Date("2026-08-31T14:05:06Z"), "utc"),
    ).toBe("2026-08-31 14:05:06 UTC");
  });

  it("returns invalid values unchanged", () => {
    expect(formatTimestamp("not-a-date", "iso")).toBe("not-a-date");
  });
});
