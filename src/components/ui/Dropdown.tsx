import {
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  Show,
  For,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";
import { Icon } from "./Icons";

interface DropdownOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  filterable?: boolean;
  openUpwards?: boolean;
  compact?: boolean;
  title?: string;
}

export default function Dropdown(props: Props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1);
  const [isKeyboardNavigating, setIsKeyboardNavigating] = createSignal(false);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  let dropdownRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let filterInputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let optionsListRef: HTMLDivElement | undefined;
  let itemRefs: (HTMLButtonElement | null)[] = [];

  const portalTarget = () => {
    if (typeof document === "undefined") return null;
    return (
      (dropdownRef?.closest(".app-shell") as HTMLElement | null) ??
      document.body
    );
  };

  const placeholder = () => props.placeholder ?? "Select…";
  const disabled = () => props.disabled ?? false;
  const className = () => props.class ?? "";
  const filterable = () => props.filterable ?? false;
  const compact = () => props.compact ?? false;
  const title = () =>
    props.title !== undefined ? props.title : selectedOption()?.label;
  const listboxId = `dropdown-listbox-${Math.random().toString(36).slice(2)}`;
  const accessibleLabel = () => props.placeholder ?? "Select option";

  const selectedOption = createMemo(() =>
    props.options.find((opt) => opt.value === props.value),
  );

  const filteredOptions = createMemo(() =>
    filterable() && filter()
      ? props.options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(filter().toLowerCase()) ||
          opt.value.toLowerCase().includes(filter().toLowerCase()),
      )
      : props.options,
  );

  function close() {
    setIsOpen(false);
    setFilter("");
    setHighlightedIndex(-1);
    setIsKeyboardNavigating(false);
  }

  const VIEWPORT_PAD = 8;
  const POPUP_GAP = 4;
  const DEFAULT_MAX_HEIGHT = 208;
  const MIN_PREFERRED_SPACE = 160;

  function updatePosition() {
    if (!buttonRef) return;
    const rect = buttonRef.getBoundingClientRect();
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;

    const spaceBelow = Math.max(0, vh - rect.bottom - POPUP_GAP - VIEWPORT_PAD);
    const spaceAbove = Math.max(0, rect.top - POPUP_GAP - VIEWPORT_PAD);

    const shouldOpenUp =
      props.openUpwards !== undefined
        ? props.openUpwards
        : spaceBelow < Math.min(DEFAULT_MAX_HEIGHT, MIN_PREFERRED_SPACE) &&
          spaceAbove > spaceBelow;

    const availableHeight = shouldOpenUp ? spaceAbove : spaceBelow;
    const panelMaxHeight = Math.max(
      48,
      Math.min(DEFAULT_MAX_HEIGHT, availableHeight),
    );

    const panelWidth = Math.min(
      rect.width,
      Math.max(60, vw - 2 * VIEWPORT_PAD),
    );
    const panelLeft = Math.max(
      VIEWPORT_PAD,
      Math.min(rect.left, vw - panelWidth - VIEWPORT_PAD),
    );

    const nextStyle: JSX.CSSProperties = {
      position: "fixed",
      left: `${panelLeft}px`,
      width: `${panelWidth}px`,
      "max-height": `${panelMaxHeight}px`,
    };

    if (shouldOpenUp) {
      nextStyle.bottom = `${vh - rect.top + POPUP_GAP}px`;
      nextStyle.top = "auto";
    } else {
      nextStyle.top = `${rect.bottom + POPUP_GAP}px`;
      nextStyle.bottom = "auto";
    }

    setPopupStyle(nextStyle);
  }

  function scrollOptionsToTop() {
    if (!optionsListRef) return;
    optionsListRef.scrollTop = 0;
    const afterRender =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback: (timestamp: number) => void) =>
          window.setTimeout(() => callback(Date.now()), 0);
    afterRender(() => {
      if (optionsListRef) {
        optionsListRef.scrollTop = 0;
      }
    });
  }

  function resetFilteredNavigation() {
    setIsKeyboardNavigating(true);
    setHighlightedIndex(filteredOptions().length > 0 ? 0 : -1);
    scrollOptionsToTop();
  }

  createEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef &&
        !dropdownRef.contains(event.target as Node) &&
        listRef &&
        !listRef.contains(event.target as Node)
      ) {
        close();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
    });
  });

  createEffect(() => {
    if (!isOpen()) return;

    updatePosition();
    if (filterable() && filterInputRef) {
      filterInputRef.focus();
    }

    const idx = filteredOptions().findIndex((opt) => opt.value === props.value);
    setHighlightedIndex(idx >= 0 ? idx : 0);

    const handleReposition = () => updatePosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", handleReposition);
      window.visualViewport.addEventListener("scroll", handleReposition);
    }

    onCleanup(() => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener("resize", handleReposition);
        window.visualViewport.removeEventListener("scroll", handleReposition);
      }
    });
  });

  createEffect(() => {
    const idx = highlightedIndex();
    if (idx >= 0 && itemRefs[idx]) {
      itemRefs[idx]?.scrollIntoView({ block: "nearest" });
    }
  });

  createEffect(() => {
    filter();
    resetFilteredNavigation();
  });

  function handleSelect(optionValue: string) {
    props.onChange(optionValue);
    close();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isOpen()) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        e.preventDefault();
        e.stopPropagation();
        updatePosition();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        setIsKeyboardNavigating(true);
        setHighlightedIndex((prev) => {
          const optionCount = filteredOptions().length;
          if (optionCount === 0) return -1;
          return prev >= 0 && prev < optionCount - 1 ? prev + 1 : 0;
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        setIsKeyboardNavigating(true);
        setHighlightedIndex((prev) => {
          const optionCount = filteredOptions().length;
          if (optionCount === 0) return -1;
          return prev > 0 ? prev - 1 : optionCount - 1;
        });
        break;
      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        if (highlightedIndex() >= 0 && filteredOptions()[highlightedIndex()]) {
          handleSelect(filteredOptions()[highlightedIndex()].value);
        }
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close();
        break;
    }
  }

  return (
    <div
      ref={dropdownRef}
      class={`relative ${className()}`}
      onKeyDown={handleKeyDown}
    >
      <button
        ref={buttonRef}
        type="button"
        title={title()}
        onClick={() => {
          if (disabled()) return;
          if (!isOpen()) updatePosition();
          setIsOpen(!isOpen());
        }}
        disabled={disabled()}
        role="combobox"
        aria-label={accessibleLabel()}
        aria-expanded={isOpen()}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        class="dropdown-trigger flex items-center justify-between gap-2 rounded-md w-full transition-colors text-text placeholder-text-muted focus:border-accent/40 focus:ring-1 focus:ring-accent/20 focus:outline-none"
        classList={{
          "px-2.5 h-[30px] text-s": compact(),
          "px-3 h-[34px] text-m": !compact(),
          "opacity-50 cursor-default": disabled(),
          "cursor-pointer": !disabled(),
        }}
      >
        <span
          class={`truncate ${selectedOption() ? "text-text" : "text-text-muted"}`}
        >
          {selectedOption() ? selectedOption()!.label : placeholder()}
        </span>
        <Icon
          name="chevron-down"
          class={`text-text-muted text-icon transition-transform duration-150 ${
            isOpen() ? "rotate-180" : ""
          }`}
        />
      </button>

      <Show when={isOpen() && portalTarget()}>
        <Portal mount={portalTarget()!}>
          <div
            ref={listRef}
            style={popupStyle()}
            class="dropdown-panel z-[100000] py-1 rounded-lg flex flex-col items-stretch animate-popover-in"
            data-keyboard-nav={isKeyboardNavigating() ? "true" : undefined}
            id={listboxId}
            role="listbox"
          >
            <Show when={filterable()}>
              <div class="px-2 pb-2 pt-1 flex-shrink-0 border-b border-border/5">
                <div class="dropdown-search flex items-center gap-2 h-8 px-2.5 rounded-md transition-colors">
                  <Icon name="magnifying-glass" class="text-3xs opacity-40" />
                  <input
                    ref={filterInputRef}
                    type="text"
                    name="dropdown-filter"
                    autocomplete="off"
                    aria-label={`Search ${accessibleLabel().toLowerCase()}`}
                    value={filter()}
                    onInput={(e) => {
                      setFilter(e.currentTarget.value);
                      resetFilteredNavigation();
                    }}
                    placeholder="Search databases…"
                    class="w-full bg-transparent text-m text-text caret-accent placeholder:text-text-muted/60 outline-none"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
            </Show>
            <div ref={optionsListRef} class="flex-1 min-h-0 overflow-y-auto">
              <Show
                when={filteredOptions().length > 0}
                fallback={
                  <div class="px-2.5 py-2 text-sm text-text-muted">
                    No results
                  </div>
                }
              >
                <For each={filteredOptions()}>
                  {(option, index) => (
                    <button
                      ref={(el) => {
                        itemRefs[index()] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={option.value === props.value}
                      onClick={() => handleSelect(option.value)}
                      onPointerMove={() => {
                        setIsKeyboardNavigating(false);
                        setHighlightedIndex(index());
                      }}
                      class={`
                        dropdown-option w-[calc(100%-8px)] mx-1 px-2.5 py-1.5 text-m text-left transition-colors rounded-sm cursor-pointer
                        ${index() === highlightedIndex() ? "dropdown-option--active" : ""}
                        ${option.value === props.value ? "dropdown-option--selected" : ""}
                      `}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}
