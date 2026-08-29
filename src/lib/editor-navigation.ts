import { isMacOS } from "./platform";

export interface EditorViewLocation {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface EditorNavigationPoint extends EditorViewLocation {
  tabId: string;
}

export const EDITOR_NAVIGATION_LINE_JUMP = 10;
export const EDITOR_NAVIGATION_CHAR_JUMP = 80;
export const MAX_EDITOR_NAVIGATION_POINTS = 50;

let pendingRestore: EditorNavigationPoint | null = null;
let pendingRestoreSettled: (() => void) | undefined;

export function queueNavigationRestore(
  point: EditorNavigationPoint,
  onSettled?: () => void,
) {
  pendingRestore = point;
  pendingRestoreSettled = onSettled;
}

export function hasNavigationRestore(tabId: string): boolean {
  return pendingRestore != null && pendingRestore.tabId === tabId;
}

export function consumeNavigationRestore(tabId: string): {
  point: EditorNavigationPoint;
  onSettled?: () => void;
} | null {
  if (!pendingRestore || pendingRestore.tabId !== tabId) return null;
  const point = pendingRestore;
  const onSettled = pendingRestoreSettled;
  pendingRestore = null;
  pendingRestoreSettled = undefined;
  return { point, onSettled };
}

export function discardStaleNavigationRestore(activeTabId: string) {
  if (!pendingRestore || pendingRestore.tabId === activeTabId) return;
  const settled = pendingRestoreSettled;
  pendingRestore = null;
  pendingRestoreSettled = undefined;
  settled?.();
}

export function pointsMatch(
  a: EditorNavigationPoint,
  b: EditorNavigationPoint,
): boolean {
  return a.tabId === b.tabId && a.anchor === b.anchor && a.head === b.head;
}

export function getGoBackShortcutLabel(): string {
  return isMacOS() ? "Ctrl+-" : "Alt+←";
}

export function getGoForwardShortcutLabel(): string {
  return isMacOS() ? "Ctrl+Shift+-" : "Alt+→";
}

function isNavModifierMatch(event: KeyboardEvent, forward: boolean): boolean {
  if (isMacOS()) {
    return (
      event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.shiftKey === forward &&
      event.code === "Minus"
    );
  }
  return (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.key === (forward ? "ArrowRight" : "ArrowLeft")
  );
}

export function isGoBackKey(event: KeyboardEvent): boolean {
  return isNavModifierMatch(event, false);
}

export function isGoForwardKey(event: KeyboardEvent): boolean {
  return isNavModifierMatch(event, true);
}

export function isMouseBackButton(event: MouseEvent): boolean {
  return event.button === 3;
}

export function isMouseForwardButton(event: MouseEvent): boolean {
  return event.button === 4;
}
