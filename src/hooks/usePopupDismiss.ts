import { createEffect, onCleanup } from "solid-js";

interface PopupDismissOptions {
  getPopup: () => HTMLElement | undefined;
  getIgnore?: () => (HTMLElement | undefined)[];
  onClose: () => void;
}

export function usePopupDismiss(options: PopupDismissOptions) {
  createEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (options.getPopup()?.contains(target)) return;
      if (options.getIgnore?.().some((el) => el?.contains(target))) return;
      options.onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        options.onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });
}
