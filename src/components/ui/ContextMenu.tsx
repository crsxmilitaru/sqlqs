import {
  createSignal,
  createEffect,
  onCleanup,
  onMount,
  Show,
  For,
} from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "./Icons";
import { toast } from "./Toaster";

export interface ContextMenuItem {
  id: string;
  label?: string;
  icon?: JSX.Element;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => unknown;
}

interface Props {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

const VIEWPORT_PAD = 8;

function viewportSize() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function clampToViewport(x: number, y: number, width: number, height: number) {
  const { width: vw, height: vh } = viewportSize();
  const maxX = Math.max(VIEWPORT_PAD, vw - width - VIEWPORT_PAD);
  const maxY = Math.max(VIEWPORT_PAD, vh - height - VIEWPORT_PAD);
  return {
    x: Math.min(Math.max(VIEWPORT_PAD, x), maxX),
    y: Math.min(Math.max(VIEWPORT_PAD, y), maxY),
  };
}

function ContextSubmenu(props: {
  items: ContextMenuItem[];
  renderItem: (item: ContextMenuItem, isSubmenuItem: boolean) => JSX.Element;
}) {
  let submenuRef: HTMLDivElement | undefined;
  const [style, setStyle] = createSignal<JSX.CSSProperties>({
    top: "-8px",
    left: "100%",
    visibility: "hidden",
  });

  function fit() {
    const el = submenuRef;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const { width: vw, height: vh } = viewportSize();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const parentRect = parent.getBoundingClientRect();
    const spaceRight = vw - parentRect.right - VIEWPORT_PAD;
    const spaceLeft = parentRect.left - VIEWPORT_PAD;
    const openLeft = width > spaceRight && spaceLeft > spaceRight;

    let top = -8;
    if (parentRect.top + top + height > vh - VIEWPORT_PAD) {
      top = vh - VIEWPORT_PAD - height - parentRect.top;
    }
    if (parentRect.top + top < VIEWPORT_PAD) {
      top = VIEWPORT_PAD - parentRect.top;
    }

    setStyle({
      top: `${top}px`,
      left: openLeft ? "auto" : "100%",
      right: openLeft ? "100%" : "auto",
      "margin-left": openLeft ? "0" : "-4px",
      "margin-right": openLeft ? "-4px" : "0",
      visibility: "visible",
    });
  }

  onMount(() => {
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
    });
  });

  return (
    <div
      ref={submenuRef}
      class="popup-menu absolute rounded-lg animate-popover-in"
      style={style()}
    >
      <For each={props.items}>
        {(child) =>
          child.separator ? (
            <div class="my-1.5 h-px bg-border/50 mx-2" />
          ) : (
            props.renderItem(child, true)
          )
        }
      </For>
    </div>
  );
}

export default function ContextMenu(props: Props) {
  let menuRef: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ x: props.x, y: props.y });
  const [placed, setPlaced] = createSignal(false);
  const [activeSubmenu, setActiveSubmenu] = createSignal<string | null>(null);

  function reposition() {
    if (!menuRef) return;
    setPosition(
      clampToViewport(props.x, props.y, menuRef.offsetWidth, menuRef.offsetHeight),
    );
    setPlaced(true);
  }

  createEffect(() => {
    const x = props.x;
    const y = props.y;
    const frame = requestAnimationFrame(() => {
      if (!menuRef) return;
      setPosition(
        clampToViewport(x, y, menuRef.offsetWidth, menuRef.offsetHeight),
      );
      setPlaced(true);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });

  createEffect(() => {
    const handleResize = () => reposition();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
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

    let result: unknown;
    try {
      result = item.onClick?.();
    } catch (err) {
      toast.error(String(err));
    }
    props.onClose();
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch((err) => {
        toast.error(String(err));
      });
    }
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
          <span class="w-4 h-4 flex items-center justify-center flex-shrink-0 opacity-90">
            {item.icon}
          </span>
        )}
        <span class="flex-1 whitespace-nowrap">{item.label}</span>
        {item.shortcut && (
          <span class="text-text-muted text-3xs ml-4 whitespace-nowrap">{item.shortcut}</span>
        )}
        {item.children && !isSubmenuItem && (
          <Icon name="chevron-right" class="text-icon-xs text-text-muted" />
        )}
      </button>
    );
  };

  return (
    <Portal>
      <div
        ref={menuRef}
        class="popup-menu fixed rounded-lg"
        classList={{ "animate-popover-in": placed() }}
        style={{
          left: `${position().x}px`,
          top: `${position().y}px`,
          visibility: placed() ? "visible" : "hidden",
        }}
      >
        <For each={props.items}>
          {(item) => {
            if (item.separator) {
              return <div class="my-1.5 h-px bg-border/50 mx-2" />;
            }

            return (
              <div class="relative">
                {renderItem(item)}

                <Show when={item.children && activeSubmenu() === item.id}>
                  <ContextSubmenu items={item.children!} renderItem={renderItem} />
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Portal>
  );
}
