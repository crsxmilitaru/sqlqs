import { renderHook } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { EditorNavigationPoint } from "../lib/editor-navigation";
import { useEditorNavigation } from "./useEditorNavigation";

function navigationPoint(tabId: string, anchor: number): EditorNavigationPoint {
  return { tabId, anchor, head: anchor, scrollTop: 0, scrollLeft: 0 };
}

describe("useEditorNavigation", () => {
  it("moves backward and forward through remembered locations", () => {
    const openTabs = new Set(["tab-1", "tab-2", "tab-3"]);
    let current = navigationPoint("tab-3", 30);
    let settleRestore: (() => void) | undefined;
    const restorePoint = vi.fn(
      (point: EditorNavigationPoint, onSettled: () => void) => {
        current = point;
        settleRestore = onSettled;
      },
    );
    const { result } = renderHook(() =>
      useEditorNavigation({
        getPoint: () => current,
        restorePoint,
        tabExists: (tabId) => openTabs.has(tabId),
      }),
    );
    const first = navigationPoint("tab-1", 10);
    const second = navigationPoint("tab-2", 20);

    result.remember(first);
    result.remember(first);
    result.remember(second);
    result.goBack();

    expect(restorePoint).toHaveBeenLastCalledWith(second, expect.any(Function));
    expect(result.canGoForward()).toBe(true);

    settleRestore?.();
    result.goForward();

    expect(restorePoint).toHaveBeenLastCalledWith(
      navigationPoint("tab-3", 30),
      expect.any(Function),
    );
    settleRestore?.();
  });

  it("prunes navigation points for closed tabs", () => {
    const openTabs = new Set(["tab-1", "tab-2"]);
    const { result } = renderHook(() =>
      useEditorNavigation({
        getPoint: () => navigationPoint("tab-2", 20),
        restorePoint: vi.fn(),
        tabExists: (tabId) => openTabs.has(tabId),
      }),
    );
    result.remember(navigationPoint("tab-1", 10));
    result.remember(navigationPoint("tab-2", 20));

    result.prune(new Set(["tab-1"]));

    expect(result.canGoBack()).toBe(true);

    openTabs.clear();
    result.prune(new Set());

    expect(result.canGoBack()).toBe(false);
    expect(result.canGoForward()).toBe(false);
  });
});
