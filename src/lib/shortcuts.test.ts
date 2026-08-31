import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModifierKeyLabel, isMacOS } from "./platform";
import { getAppShortcutCategories } from "./shortcuts";

vi.mock("./platform", () => ({
  getModifierKeyLabel: vi.fn(),
  isMacOS: vi.fn(),
}));

describe("getAppShortcutCategories", () => {
  beforeEach(() => {
    vi.mocked(getModifierKeyLabel).mockReturnValue("Ctrl");
    vi.mocked(isMacOS).mockReturnValue(false);
  });

  it("uses the current platform modifier", () => {
    const categories = getAppShortcutCategories(false);
    const general = categories.find((category) => category.title === "General");

    expect(general?.shortcuts).toContainEqual({
      label: "Open SQL file",
      keys: ["Ctrl+O"],
    });
  });

  it("includes developer shortcuts only for preview builds", () => {
    expect(
      getAppShortcutCategories(false).some(
        (category) => category.title === "Developer",
      ),
    ).toBe(false);
    expect(
      getAppShortcutCategories(true).some(
        (category) => category.title === "Developer",
      ),
    ).toBe(true);
  });

  it("uses Command shortcuts on macOS", () => {
    vi.mocked(getModifierKeyLabel).mockReturnValue("Cmd");
    vi.mocked(isMacOS).mockReturnValue(true);

    const queryEditor = getAppShortcutCategories(false).find(
      (category) => category.title === "Query editor",
    );

    expect(queryEditor?.shortcuts).toContainEqual({
      label: "Execute query",
      keys: ["F5", "Cmd+Enter"],
    });
  });
});
