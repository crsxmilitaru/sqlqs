import { createEffect, onCleanup, For, Show } from "solid-js";
import type { ColumnInfo } from "../lib/types";

interface Props {
  columns: ColumnInfo[];
  hiddenColumnIndices: Set<number>;
  onToggle: (index: number) => void;
  onToggleAll: (showAll: boolean) => void;
  anchorRef: HTMLButtonElement | undefined;
  onClose: () => void;
}

export default function ColumnSelector(props: Props) {
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

  const allVisible = () => props.hiddenColumnIndices.size === 0;

  return (
    <div
      ref={popupRef}
      class="absolute top-full mt-1 right-0 w-[240px] bg-surface-panel border border-border rounded-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 shadow-md shadow-black/20"
    >
      <div class="flex items-center justify-between px-3 py-2.5 border-b border-border bg-surface-header/30">
        <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">
          Column Visibility
        </span>
        <button
          onClick={() => props.onToggleAll(allVisible())}
          class="text-[10px] font-medium text-accent hover:text-accent-hover transition-colors cursor-pointer"
        >
          {allVisible() ? "Hide All" : "Show All"}
        </button>
      </div>
      <div class="p-1 max-h-[320px] overflow-y-auto custom-scrollbar">
        <For each={props.columns}>
          {(col, i) => {
            const isVisible = () => !props.hiddenColumnIndices.has(i());
            return (
              <button
                onClick={() => props.onToggle(i())}
                class={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-all cursor-pointer group ${isVisible()
                    ? "hover:bg-surface-hover"
                    : "opacity-40 hover:opacity-60 hover:bg-surface-hover"
                  }`}
              >
                <div
                  class={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${isVisible()
                      ? "border-accent bg-accent"
                      : "border-border bg-surface-header"
                    }`}
                >
                  <Show when={isVisible()}>
                    <i class="fa-solid fa-check text-[10px] text-white" />
                  </Show>
                </div>
                <div class="flex-1 min-w-0">
                  <div class={`text-xs font-medium truncate ${isVisible() ? "text-text" : "text-text-muted"}`}>
                    {col.name}
                  </div>
                  <div class="text-[10px] text-text-muted/60 font-normal uppercase tracking-tighter truncate">
                    {col.type_name}
                  </div>
                </div>
              </button>
            );
          }}
        </For>
      </div>
      <Show when={props.hiddenColumnIndices.size > 0}>
        <div class="px-3 py-2 bg-accent/5 border-t border-accent/10">
          <p class="text-[10px] text-accent/80 font-medium italic">
            {props.hiddenColumnIndices.size} column{props.hiddenColumnIndices.size > 1 ? "s" : ""} hidden
          </p>
        </div>
      </Show>
    </div>
  );
}
