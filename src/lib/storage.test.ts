import { beforeEach, describe, expect, it } from "vitest";
import { loadStoredStringSet } from "./storage";

const FALLBACK = new Set(["default"]);

describe("loadStoredStringSet", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads a stored JSON array into a set", () => {
    localStorage.setItem("key", JSON.stringify(["a", "b"]));
    expect(loadStoredStringSet("key", FALLBACK)).toEqual(new Set(["a", "b"]));
  });

  it("returns the fallback for a missing key", () => {
    expect(loadStoredStringSet("key", FALLBACK)).toBe(FALLBACK);
  });

  it("returns the fallback for non-array JSON", () => {
    localStorage.setItem("key", JSON.stringify({ a: 1 }));
    expect(loadStoredStringSet("key", FALLBACK)).toBe(FALLBACK);
  });

  it("returns the fallback for malformed JSON", () => {
    localStorage.setItem("key", "{not json");
    expect(loadStoredStringSet("key", FALLBACK)).toBe(FALLBACK);
  });
});
