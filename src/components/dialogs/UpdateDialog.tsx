import { createSignal, onMount } from "solid-js";
import DialogShell from "../ui/DialogShell";
import { Icon } from "../ui/Icons";

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

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onCancel}
      class="w-[460px] max-w-[94vw] p-6 shadow-2xl"
      ariaLabel="Update available"
    >
        <div class="mb-6 flex items-start gap-4">
          <div class="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Icon name="circle-arrow-up" class="text-lg" />
          </div>
          <div>
            <h2 class="mb-1 text-lg font-semibold text-text">
              Update available
            </h2>
            <p class="text-sm text-text-muted">
              Version {props.version} is ready to install. You are currently
              running {props.currentVersion}.
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-3 border-t border-border pt-4">
          <button
            onClick={props.onCancel}
            class="btn btn-secondary px-5 py-1.5"
          >
            Later
          </button>
          <button onClick={props.onInstall} class="btn btn-primary px-5 py-1.5">
            Install update
          </button>
        </div>
    </DialogShell>
  );
}
