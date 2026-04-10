import { createSignal, createEffect, onCleanup, onMount, Show, For } from "solid-js";
import type { JSX } from "solid-js";

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: JSX.Element;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

interface Props {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export default function ContextMenu(props: Props) {
  let menuRef: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ x: props.x, y: props.y });
  const [activeSubmenu, setActiveSubmenu] = createSignal<string | null>(null);

  onMount(() => {
    if (menuRef) {
      const rect = menuRef.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = props.x;
      let newY = props.y;

      if (props.x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 8;
      }
      if (props.y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 8;
      }

      setPosition({ x: Math.max(8, newX), y: Math.max(8, newY) });
    }
  });

  createEffect(() => {
    // Track reactive deps
    const x = props.x;
    const y = props.y;

    if (menuRef) {
      const rect = menuRef.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      if (x + rect.width > viewportWidth) {
        newX = viewportWidth - rect.width - 8;
      }
      if (y + rect.height > viewportHeight) {
        newY = viewportHeight - rect.height - 8;
      }

      setPosition({ x: Math.max(8, newX), y: Math.max(8, newY) });
    }
  });

  createEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        props.onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    });
  });

  function handleItemClick(item: ContextMenuItem) {
    if (item.disabled || item.separator) return;
    if (item.children) {
      setActiveSubmenu(activeSubmenu() === item.id ? null : item.id);
      return;
    }
    item.onClick?.();
    props.onClose();
  }

  const renderItem = (item: ContextMenuItem, isSubmenuItem = false) => {
    const itemClass = `popup-menu-item rounded-md mx-1 w-[calc(100%-8px)] ${
      item.disabled
        ? "opacity-50 cursor-default hover:bg-transparent hover:text-text-muted"
        : item.danger
          ? "text-error hover:bg-error/10 hover:text-error"
          : ""
    }`;

    return (
      <button
        class={itemClass}
        onClick={(e) => {
          e.stopPropagation();
          handleItemClick(item);
        }}
        onMouseEnter={() => {
          if (!isSubmenuItem) {
            setActiveSubmenu(item.children ? item.id : null);
          }
        }}
        disabled={item.disabled}
      >
        {item.icon && (
          <span class="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-90 text-white [&_i]:!text-white [&_svg]:!text-white">
            {item.icon}
          </span>
        )}
        <span class="flex-1">{item.label}</span>
        {item.shortcut && (
          <span class="text-text-muted text-3xs ml-4">
            {item.shortcut}
          </span>
        )}
        {item.children && !isSubmenuItem && (
          <i class="fa-solid fa-chevron-right text-icon-xs text-white/50" />
        )}
      </button>
    );
  };

  return (
    <div
      ref={menuRef}
      class="popup-menu fixed rounded-lg animate-popover-in"
      style={{ left: `${position().x}px`, top: `${position().y}px` }}
    >
      <For each={props.items}>
        {(item, index) => {
          if (item.separator) {
            return (
              <div class="my-1.5 h-px bg-border/50 mx-2" />
            );
          }

          return (
            <div class="relative">
              {renderItem(item)}

              <Show when={item.children && activeSubmenu() === item.id}>
                <div class="popup-menu absolute left-full -top-2 -ml-1 rounded-lg animate-popover-in">
                  <For each={item.children}>
                    {(child) => renderItem(child, true)}
                  </For>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
}
