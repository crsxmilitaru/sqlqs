import { describe, expect, it } from "vitest";
import { generateTabTitle } from "./sql";

describe("generateTabTitle", () => {
  it("uses the first non-empty SQL line", () => {
    expect(generateTabTitle("\r\n  SELECT *\r\nFROM dbo.Users")).toBe(
      "SELECT *",
    );
  });

  it("returns an empty title for whitespace-only SQL", () => {
    expect(generateTabTitle(" \r\n\t ")).toBe("");
  });

  it("limits generated titles to 80 characters", () => {
    const title = generateTabTitle(`SELECT '${"x".repeat(100)}'`);

    expect(title).toHaveLength(80);
    expect(title.endsWith("...")).toBe(true);
  });
});
