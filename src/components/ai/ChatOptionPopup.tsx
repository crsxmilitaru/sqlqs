import { createEffect, For, onCleanup, Show, type JSX } from "solid-js";
import Tooltip from "../ui/Tooltip";

export interface ChatOptionItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  selected?: boolean;
  disabled?: boolean;
  disabledNote?: string;
  disabledTitle?: string;
  category?: string;
}

interface Props {
  anchorRef: HTMLButtonElement | undefined;
  title: string;
  items: ChatOptionItem[];
  headerActionLabel?: JSX.Element;
  footer?: JSX.Element;
  onHeaderAction?: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function ChatOptionPopup(props: Props) {
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

  return (
    <div
      ref={popupRef}
      class="absolute bottom-full left-0 right-0 z-50 mb-2 bg-surface-panel border border-border rounded-lg animate-popover-in overflow-hidden"
    >
      <div class="bg-surface-header/30">
        <div class="flex items-center justify-between px-3 py-2 border-b border-border/60">
          <span class="text-s font-semibold text-text-muted uppercase tracking-wide">
            {props.title}
          </span>
          <Show when={props.headerActionLabel && props.onHeaderAction}>
            <button
              onClick={props.onHeaderAction}
              class="text-s text-text-muted hover:text-accent transition-colors cursor-pointer"
            >
              {props.headerActionLabel}
            </button>
          </Show>
        </div>
        <div class="max-h-[60vh] overflow-y-auto p-1 flex flex-col">
          <For each={props.items}>
            {(item, index) => {
              const showHeader = () => {
                if (!item.category) return false;
                const idx = index();
                return idx === 0 || props.items[idx - 1].category !== item.category;
              };
              return (
                <>
                  <Show when={showHeader()}>
                    <div class="px-2.5 py-1.5 mt-2.5 first:mt-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider select-none flex items-center gap-2">
                      <span>{item.category}</span>
                      <div class="h-px flex-1 bg-border/20" />
                    </div>
                  </Show>
                  <button
                    onClick={() => {
                      if (item.disabled) return;
                      props.onSelect(item.id);
                    }}
                    disabled={item.disabled}
                    title={item.disabled ? item.disabledTitle : undefined}
                    class={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors select-none ${
                      item.disabled
                        ? "opacity-50 cursor-default"
                        : "cursor-pointer hover:bg-surface-hover"
                    }`}
                  >
                    <i
                      class={`${item.icon} text-s w-4 text-center flex-shrink-0 ${
                        item.selected ? "text-accent" : "text-text-muted opacity-70"
                      }`}
                    />
                    <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div
                        class={`text-s font-medium truncate ${
                          item.selected ? "text-text" : "text-text/70"
                        }`}
                      >
                        {item.title}
                        <Show when={item.disabledNote}>
                          <span class="ml-2 text-xs font-normal text-text-muted">
                            {item.disabledNote}
                          </span>
                        </Show>
                      </div>
                      <Show when={item.subtitle}>
                        <Tooltip content={item.subtitle!} delay={300}>
                          <div class="text-xs text-text-muted leading-snug truncate">
                            {item.subtitle}
                          </div>
                        </Tooltip>
                      </Show>
                    </div>
                    <div
                      class={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                        item.selected
                          ? "bg-accent border-accent text-accent-text"
                          : "border-border"
                      }`}
                    >
                      <Show when={item.selected}>
                        <i class="fa-solid fa-check text-[10px]" />
                      </Show>
                    </div>
                  </button>
                </>
              );
            }}
          </For>
        </div>
        <Show when={props.footer}>
          <div class="border-t border-border/60 p-2">{props.footer}</div>
        </Show>
      </div>
    </div>
  );
}
