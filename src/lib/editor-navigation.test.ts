import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMacOS } from "./platform";
import {
  consumeNavigationRestore,
  discardStaleNavigationRestore,
  getGoBackShortcutLabel,
  getGoForwardShortcutLabel,
  hasNavigationRestore,
  isGoBackKey,
  isGoForwardKey,
  isMouseBackButton,
  isMouseForwardButton,
  pointsMatch,
  queueNavigationRestore,
} from "./editor-navigation";

vi.mock("./platform", () => ({
  isMacOS: vi.fn(),
}));

const point = {
  tabId: "tab-1",
  anchor: 12,
  head: 12,
  scrollTop: 40,
  scrollLeft: 5,
};

describe("editor navigation restoration", () => {
  beforeEach(() => {
    vi.mocked(isMacOS).mockReturnValue(false);
    consumeNavigationRestore("tab-1");
    consumeNavigationRestore("tab-2");
  });

  it("queues and consumes a restoration for the matching tab", () => {
    const onSettled = vi.fn();
    queueNavigationRestore(point, onSettled);

    expect(hasNavigationRestore("tab-1")).toBe(true);
    expect(consumeNavigationRestore("tab-2")).toBeNull();

    const restore = consumeNavigationRestore("tab-1");

    expect(restore?.point).toEqual(point);
    restore?.onSettled?.();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(hasNavigationRestore("tab-1")).toBe(false);
  });

  it("discards stale restoration work and settles it", () => {
    const onSettled = vi.fn();
    queueNavigationRestore(point, onSettled);

    discardStaleNavigationRestore("tab-2");

    expect(hasNavigationRestore("tab-1")).toBe(false);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it("matches navigation points by tab and selection", () => {
    expect(pointsMatch(point, { ...point, scrollTop: 100 })).toBe(true);
    expect(pointsMatch(point, { ...point, head: 13 })).toBe(false);
    expect(pointsMatch(point, { ...point, tabId: "tab-2" })).toBe(false);
  });
});

describe("editor navigation shortcuts", () => {
  beforeEach(() => {
    vi.mocked(isMacOS).mockReturnValue(false);
  });

  it("uses Alt and horizontal arrows outside macOS", () => {
    expect(getGoBackShortcutLabel()).toBe("Alt+←");
    expect(getGoForwardShortcutLabel()).toBe("Alt+→");
    expect(
      isGoBackKey(
        new KeyboardEvent("keydown", { altKey: true, key: "ArrowLeft" }),
      ),
    ).toBe(true);
    expect(
      isGoForwardKey(
        new KeyboardEvent("keydown", { altKey: true, key: "ArrowRight" }),
      ),
    ).toBe(true);
  });

  it("uses Control and Minus on macOS", () => {
    vi.mocked(isMacOS).mockReturnValue(true);

    expect(getGoBackShortcutLabel()).toBe("Ctrl+-");
    expect(getGoForwardShortcutLabel()).toBe("Ctrl+Shift+-");
    expect(
      isGoBackKey(
        new KeyboardEvent("keydown", { ctrlKey: true, code: "Minus" }),
      ),
    ).toBe(true);
    expect(
      isGoForwardKey(
        new KeyboardEvent("keydown", {
          ctrlKey: true,
          shiftKey: true,
          code: "Minus",
        }),
      ),
    ).toBe(true);
  });

  it("recognizes mouse navigation buttons", () => {
    expect(isMouseBackButton(new MouseEvent("mousedown", { button: 3 }))).toBe(
      true,
    );
    expect(
      isMouseForwardButton(new MouseEvent("mousedown", { button: 4 })),
    ).toBe(true);
  });
});
