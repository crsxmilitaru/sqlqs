import { createSignal, onMount, onCleanup } from "solid-js";

interface Props {
  version: string;
  currentVersion: string;
  onInstall: () => void;
  onCancel: () => void;
}

export default function UpdateDialog(props: Props) {
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={props.onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[460px] max-w-[94vw] p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="mb-6 flex items-start gap-4">
          <div class="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <i class="fa-solid fa-circle-arrow-up text-lg" />
          </div>
          <div>
            <h2 class="mb-1 text-lg font-semibold text-text">Update available</h2>
            <p class="text-sm text-text-muted">
              Version {props.version} is ready to install. You are currently running {props.currentVersion}.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-3 border-t border-border pt-4">
          <button onClick={props.onCancel} class="btn btn-secondary px-5 py-1.5">
            Later
          </button>
          <button onClick={props.onInstall} class="btn btn-primary px-5 py-1.5">
            Install update
          </button>
        </div>
      </div>
    </div>
  );
}
