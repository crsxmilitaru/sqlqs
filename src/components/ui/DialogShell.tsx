import { onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";

interface Props {
  visible: boolean;
  onClose: () => void;
  children: JSX.Element;
  class?: string;
  overlayClass?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  closeOnOverlay?: boolean;
  closeOnEscape?: boolean;
}

export default function DialogShell(props: Props) {
  const closeOnOverlay = () => props.closeOnOverlay ?? true;
  const closeOnEscape = () => props.closeOnEscape ?? true;

  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape()) {
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <div
      class={`dialog-overlay ${props.overlayClass ?? ""}`}
      data-visible={props.visible}
      onMouseDown={() => {
        if (closeOnOverlay()) props.onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={props.ariaLabel}
      aria-labelledby={props.ariaLabelledBy}
    >
      <div
        class={`dialog-surface ${props.class ?? ""}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );
}
