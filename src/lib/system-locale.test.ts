import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatLocalDateTime,
  getSystemLocale,
  initSystemLocale,
} from "./system-locale";

describe("system locale", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("loads and applies native date and time patterns", async () => {
    vi.mocked(invoke).mockResolvedValue({
      locale: "en-GB",
      short_date_pattern: "dd/MM/yyyy",
      short_time_pattern: "HH:mm",
      long_time_pattern: "HH:mm:ss",
    });
    await initSystemLocale();

    expect(getSystemLocale()).toBe("en-GB");
    expect(formatLocalDateTime(new Date(2026, 7, 31, 14, 5, 6), true)).toBe(
      "31/08/2026, 14:05:06",
    );
  });

  it("supports quoted literals and 12-hour time patterns", async () => {
    vi.mocked(invoke).mockResolvedValue({
      locale: "en-US",
      short_date_pattern: "MMMM d, yyyy",
      short_time_pattern: "h:mm tt",
      long_time_pattern: null,
    });
    await initSystemLocale();

    expect(formatLocalDateTime(new Date(2026, 7, 31, 14, 5, 6), true)).toBe(
      "August 31, 2026, 2:05 PM",
    );
  });

  it("falls back to browser formatting when native locale loading fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("Unavailable"));
    const date = new Date(2026, 7, 31, 14, 5, 6);

    await initSystemLocale();

    expect(getSystemLocale()).toBeUndefined();
    expect(formatLocalDateTime(date, false)).toBe(date.toLocaleDateString());
  });
});
