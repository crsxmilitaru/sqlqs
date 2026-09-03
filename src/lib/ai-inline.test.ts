import { describe, expect, it } from "vitest";
import { sanitizeInlineCompletion } from "./ai";

describe("sanitizeInlineCompletion", () => {
  it("strips wrapping sql code fences", () => {
    expect(sanitizeInlineCompletion("```sql\nSELECT 1\n```")).toBe("SELECT 1");
  });

  it("strips bare code fences", () => {
    expect(sanitizeInlineCompletion("```\nSELECT 1\n```")).toBe("SELECT 1");
  });

  it("keeps leading whitespace for mid-line continuations", () => {
    expect(sanitizeInlineCompletion("  AND [Name] = 'x'")).toBe(
      "  AND [Name] = 'x'",
    );
  });

  it("cuts the suggestion at a stray closing fence", () => {
    expect(sanitizeInlineCompletion("SELECT 1\n```\nextra")).toBe("SELECT 1");
  });

  it("trims trailing blank space and newlines", () => {
    expect(sanitizeInlineCompletion("SELECT 1  \n\n")).toBe("SELECT 1");
  });

  it("preserves inner line breaks", () => {
    expect(sanitizeInlineCompletion(" *\nFROM [Orders]")).toBe(
      " *\nFROM [Orders]",
    );
  });

  it("normalizes CRLF line endings", () => {
    expect(sanitizeInlineCompletion(" *\r\nFROM [Orders]\r\n")).toBe(
      " *\nFROM [Orders]",
    );
  });

  it("rejects empty and whitespace-only suggestions", () => {
    expect(sanitizeInlineCompletion("")).toBeNull();
    expect(sanitizeInlineCompletion("   \n  ")).toBeNull();
    expect(sanitizeInlineCompletion("```")).toBeNull();
  });
});
