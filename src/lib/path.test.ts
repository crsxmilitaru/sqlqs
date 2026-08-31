import { describe, expect, it } from "vitest";
import {
  baseFileName,
  getSavedQueriesDir,
  joinPath,
  sanitizeSavedQueryFileName,
} from "./path";

describe("joinPath", () => {
  it("joins Windows paths with backslashes", () => {
    expect(
      joinPath(
        "C:\\Users\\TestUser\\Documents\\",
        "\\SQL Query Studio\\",
        "Queries",
      ),
    ).toBe("C:\\Users\\TestUser\\Documents\\SQL Query Studio\\Queries");
  });

  it("preserves UNC paths", () => {
    expect(joinPath("\\\\server\\share\\", "folder", "query.sql")).toBe(
      "\\\\server\\share\\folder\\query.sql",
    );
  });

  it("keeps non-Windows paths slash-separated", () => {
    expect(joinPath("/Users/cristian/", "/Documents/", "query.sql")).toBe(
      "/Users/cristian/Documents/query.sql",
    );
  });
});

describe("saved query paths", () => {
  it("builds the saved query directory", () => {
    expect(getSavedQueriesDir("C:\\Users\\TestUser\\Documents")).toBe(
      "C:\\Users\\TestUser\\Documents\\SQL Query Studio\\Queries",
    );
  });

  it("replaces invalid file name characters", () => {
    expect(sanitizeSavedQueryFileName('Quarterly: Sales/Revenue?*')).toBe(
      "Quarterly_ Sales_Revenue__.sql",
    );
  });

  it("uses a fallback for an empty title", () => {
    expect(sanitizeSavedQueryFileName("   ")).toBe("Query.sql");
  });

  it("extracts file names from Windows and Unix paths", () => {
    expect(baseFileName("C:\\queries\\report.sql")).toBe("report.sql");
    expect(baseFileName("/queries/report.sql")).toBe("report.sql");
    expect(baseFileName("report.sql")).toBe("report.sql");
  });
});
