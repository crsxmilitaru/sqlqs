import { createSignal, For } from "solid-js";
import { Portal } from "solid-js/web";

export type ToastTone = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  /** How long the toast stays visible, in milliseconds. Defaults to 4500. */
  duration?: number;
}

interface ToastEntry {
  id: number;
  tone: ToastTone;
  message: string;
}

const [toasts, setToasts] = createSignal<ToastEntry[]>([]);
let nextId = 0;

function dismiss(id: number) {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

function push(tone: ToastTone, message: string, options?: ToastOptions) {
  const id = nextId++;
  const duration = options?.duration ?? 4500;
  setToasts((prev) => [...prev, { id, tone, message }]);
  if (duration > 0) {
    window.setTimeout(() => dismiss(id), duration);
  }
  return id;
}

/** Show a transient toast notification. Available app-wide without a provider. */
export const toast = {
  success: (message: string, options?: ToastOptions) =>
    push("success", message, options),
  error: (message: string, options?: ToastOptions) =>
    push("error", message, { ...options, duration: 7000 }),
  info: (message: string, options?: ToastOptions) =>
    push("info", message, options),
  warning: (message: string, options?: ToastOptions) =>
    push("warning", message, options),
  dismiss,
};

const TONE_STYLES: Record<ToastTone, { wrap: string; icon: string }> = {
  success: {
    wrap: "border-success/30 bg-success/10 text-success",
    icon: "fa-circle-check",
  },
  error: {
    wrap: "border-error/30 bg-error/10 text-error",
    icon: "fa-circle-exclamation",
  },
  warning: {
    wrap: "border-warning/30 bg-warning/10 text-warning",
    icon: "fa-triangle-exclamation",
  },
  info: {
    wrap: "border-accent/30 bg-accent/10 text-accent",
    icon: "fa-circle-info",
  },
};

/**
 * Mount once near the root of the app. Renders the toast stack in a portal
 * anchored to the bottom-right of the viewport.
 */
export default function Toaster() {
  return (
    <Portal>
      <div
        class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
      >
        <For each={toasts()}>
          {(entry) => {
            const style = TONE_STYLES[entry.tone];
            return (
              <div
                role="status"
                class={`pointer-events-auto flex items-start gap-2 max-w-sm rounded-lg border px-3 py-2 shadow-lg bg-surface text-text animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-fast)] ${style.wrap}`}
              >
                <i class={`fa-solid ${style.icon} mt-0.5 flex-shrink-0`} />
                <span class="text-s leading-relaxed flex-1 min-w-0 break-words text-text">
                  {entry.message}
                </span>
                <button
                  type="button"
                  class="flex-shrink-0 text-text-muted hover:text-text transition-colors -mr-1"
                  aria-label="Dismiss notification"
                  onClick={() => dismiss(entry.id)}
                >
                  <i class="fa-solid fa-xmark" />
                </button>
              </div>
            );
          }}
        </For>
      </div>
    </Portal>
  );
}
