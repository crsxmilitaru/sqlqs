import { describe, expect, it, vi } from "vitest";
import {
  THEME_CHANGED_EVENT,
  applyTheme,
  getThemeMode,
  loadFollowSystemTheme,
  resolveTabColors,
  saveFollowSystemTheme,
  saveTheme,
} from "./theme";

describe("theme", () => {
  it("resolves built-in light and dark theme modes", () => {
    expect(getThemeMode("dark")).toBe("dark");
    expect(getThemeMode("light")).toBe("light");
    expect(getThemeMode("missing")).toBe("dark");
  });

  it("defaults to following the system and persists explicit choices", () => {
    expect(loadFollowSystemTheme()).toBe(true);

    saveFollowSystemTheme(false);

    expect(loadFollowSystemTheme()).toBe(false);
    expect(localStorage.getItem("app_theme_follow_system")).toBe("false");
  });

  it("applies theme colors and emits the selected mode", () => {
    const listener = vi.fn();
    window.addEventListener(THEME_CHANGED_EVENT, listener);

    const selection = applyTheme("light");

    expect(selection).toEqual({ id: "light", mode: "light" });
    expect(document.documentElement.dataset.themeId).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(listener).toHaveBeenCalledOnce();

    window.removeEventListener(THEME_CHANGED_EVENT, listener);
  });

  it("persists and applies custom themes", () => {
    const selection = saveTheme("custom-blue", {
      id: "custom-blue",
      name: "Custom Blue",
      mode: "dark",
      colors: {
        "--color-surface": "#001122",
        "--color-text": "#ffffff",
      },
      tabColors: [
        "#111111",
        "#222222",
        "#333333",
        "#444444",
        "#555555",
        "#666666",
        "#777777",
      ],
    });

    expect(selection).toEqual({ id: "custom-blue", mode: "dark" });
    expect(localStorage.getItem("app_theme")).toBe("custom-blue");
    expect(document.documentElement.style.getPropertyValue("--color-surface"))
      .toBe("#001122");
    expect(resolveTabColors({ mode: "dark", tabColors: ["#111111"] })).toEqual(
      ["#111111"],
    );
    expect(
      document.documentElement.style.getPropertyValue("--color-tab-group-blue"),
    ).toBe("#111111");
  });
});
