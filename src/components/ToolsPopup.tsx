import { createSignal, createEffect, onCleanup, For } from "solid-js";
import { Show } from "solid-js";
import { AI_TOOLS, loadEnabledTools, saveEnabledTools } from "../lib/ai-tools";

interface Props {
  anchorRef: HTMLButtonElement | undefined;
  onClose: () => void;
}

export default function ToolsPopup(props: Props) {
  const [enabled, setEnabled] = createSignal(loadEnabledTools());
  let popupRef: HTMLDivElement | undefined;

  createEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = props.anchorRef;
      if (anchor && anchor.contains(e.target as Node)) return;
      if (popupRef && popupRef.contains(e.target as Node)) return;
      props.onClose();
    };
    document.addEventListener("mousedown", handleClick);
    onCleanup(() => document.removeEventListener("mousedown", handleClick));
  });

  const toggle = (id: string) => {
    const next = new Set(enabled());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setEnabled(next);
    saveEnabledTools(next);
  };

  return (
    <div ref={popupRef} class="absolute bottom-full mb-1.5 left-0 w-[240px] bg-surface-raised border border-border/50 rounded-lg animate-popover-in p-1 shadow-md shadow-black/20">
      <div class="flex flex-col">
        <For each={AI_TOOLS}>
          {(tool) => {
            const isOn = () => enabled().has(tool.id);
            return (
              <button
                onClick={() => toggle(tool.id)}
                class={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer select-none hover:bg-surface-hover/50`}
              >
                <i class={`${tool.icon} text-s w-4 text-center ${isOn() ? "text-accent" : "text-text-muted opacity-80"}`} />
                <div class="flex-1 min-w-0 pr-2 flex flex-col gap-0.5">
                  <div class={`text-xs font-medium truncate ${isOn() ? "text-text" : "text-text/80"}`}>{tool.label}</div>
                  <div class="text-[10px] text-text-muted leading-tight truncate">{tool.description}</div>
                </div>
                <div
                  class={`w-4 h-4 rounded-[4px] border flex-shrink-0 flex items-center justify-center transition-all ${
                    isOn() ? "bg-accent border-accent text-accent-text" : "border-border"
                  }`}
                >
                  <Show when={isOn()}>
                    <i class="fa-solid fa-check text-[10px]" />
                  </Show>
                </div>
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}
