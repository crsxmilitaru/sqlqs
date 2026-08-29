import { createMemo, createSignal } from "solid-js";
import {
  MAX_EDITOR_NAVIGATION_POINTS,
  pointsMatch,
  type EditorNavigationPoint,
} from "../lib/editor-navigation";

const RESTORE_FALLBACK_MS = 2000;

export function useEditorNavigation(options: {
  getPoint: () => EditorNavigationPoint | null;
  restorePoint: (point: EditorNavigationPoint, onSettled: () => void) => void;
  tabExists: (tabId: string) => boolean;
}) {
  const [backStack, setBackStack] = createSignal<EditorNavigationPoint[]>([]);
  const [forwardStack, setForwardStack] = createSignal<EditorNavigationPoint[]>(
    [],
  );
  let restoring = false;
  let restoreSeq = 0;
  let restoreTimer: number | undefined;
  let inFlight: EditorNavigationPoint | null = null;

  const canGoBack = createMemo(() =>
    backStack().some((point) => options.tabExists(point.tabId)),
  );
  const canGoForward = createMemo(() =>
    forwardStack().some((point) => options.tabExists(point.tabId)),
  );

  function pushCapped(
    setter: (fn: (prev: EditorNavigationPoint[]) => EditorNavigationPoint[]) => void,
    point: EditorNavigationPoint,
  ) {
    setter((prev) => [...prev, point].slice(-MAX_EDITOR_NAVIGATION_POINTS));
  }

  function remember(point: EditorNavigationPoint) {
    if (restoring || !point.tabId) return;
    if (!options.tabExists(point.tabId)) return;
    let added = false;
    setBackStack((prev) => {
      const last = prev[prev.length - 1];
      if (last && pointsMatch(last, point)) return prev;
      added = true;
      return [...prev, point].slice(-MAX_EDITOR_NAVIGATION_POINTS);
    });
    if (added) setForwardStack([]);
  }

  function prune(openTabIds: Set<string>) {
    const keepOpen = (prev: EditorNavigationPoint[]) => {
      const next = prev.filter((point) => openTabIds.has(point.tabId));
      return next.length === prev.length ? prev : next;
    };
    setBackStack(keepOpen);
    setForwardStack(keepOpen);
  }

  function popValid(
    stack: EditorNavigationPoint[],
  ): { point: EditorNavigationPoint; rest: EditorNavigationPoint[] } | null {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (options.tabExists(stack[index].tabId)) {
        return { point: stack[index], rest: stack.slice(0, index) };
      }
    }
    return null;
  }

  function goTo(point: EditorNavigationPoint) {
    const id = ++restoreSeq;
    restoring = true;
    inFlight = point;
    if (restoreTimer !== undefined) {
      window.clearTimeout(restoreTimer);
      restoreTimer = undefined;
    }
    const finish = () => {
      if (id !== restoreSeq) return;
      restoring = false;
      inFlight = null;
      if (restoreTimer !== undefined) {
        window.clearTimeout(restoreTimer);
        restoreTimer = undefined;
      }
    };
    options.restorePoint(point, finish);
    restoreTimer = window.setTimeout(finish, RESTORE_FALLBACK_MS);
  }

  function navigate(direction: "back" | "forward") {
    const isBack = direction === "back";
    const popped = popValid(isBack ? backStack() : forwardStack());
    if (!popped) {
      if (isBack) setBackStack([]);
      else setForwardStack([]);
      return;
    }
    const current = restoring && inFlight ? inFlight : options.getPoint();
    if (isBack) {
      setBackStack(popped.rest);
      if (current) pushCapped(setForwardStack, current);
    } else {
      setForwardStack(popped.rest);
      if (current) pushCapped(setBackStack, current);
    }
    goTo(popped.point);
  }

  return {
    remember,
    prune,
    goBack: () => navigate("back"),
    goForward: () => navigate("forward"),
    canGoBack,
    canGoForward,
  };
}
