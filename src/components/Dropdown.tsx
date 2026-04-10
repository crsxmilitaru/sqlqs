import { createSignal, createEffect, createMemo, onCleanup, Show, For } from "solid-js";
import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";

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
}

export default function Dropdown(props: Props) {
  const [isOpen, setIsOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1);
  const [popupStyle, setPopupStyle] = createSignal<JSX.CSSProperties>({});
  let dropdownRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let filterInputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let itemRefs: (HTMLButtonElement | null)[] = [];

  const portalTarget = () => {
    if (typeof document === "undefined") return null;
    return (dropdownRef?.closest(".app-shell") as HTMLElement | null) ?? document.body;
  };

  const placeholder = () => props.placeholder ?? "Select...";
  const disabled = () => props.disabled ?? false;
  const className = () => props.class ?? "";
  const filterable = () => props.filterable ?? false;
  const openUpwards = () => props.openUpwards ?? false;

  const selectedOption = createMemo(() => props.options.find((opt) => opt.value === props.value));

  const filteredOptions = createMemo(() =>
    filterable() && filter()
      ? props.options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(filter().toLowerCase()) ||
          opt.value.toLowerCase().includes(filter().toLowerCase())
      )
      : props.options
  );

  function close() {
    setIsOpen(false);
    setFilter("");
    setHighlightedIndex(-1);
  }

  function updatePosition() {
    if (!buttonRef) return;
    const rect = buttonRef.getBoundingClientRect();
    if (openUpwards()) {
      setPopupStyle({
        position: "fixed",
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + 4}px`,
        width: `${rect.width}px`,
      });
    } else {
      setPopupStyle({
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.bottom + 4}px`,
        width: `${rect.width}px`,
      });
    }
  }

  // Click outside handler
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

  // Position + focus when opened
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

    onCleanup(() => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    });
  });

  // Scroll highlighted item into view
  createEffect(() => {
    const idx = highlightedIndex();
    if (idx >= 0 && itemRefs[idx]) {
      itemRefs[idx]?.scrollIntoView({ block: "nearest" });
    }
  });

  // Reset highlight when filter changes
  createEffect(() => {
    filter(); // track dependency
    setHighlightedIndex(filteredOptions().length > 0 ? 0 : -1);
  });

  function handleSelect(optionValue: string) {
    props.onChange(optionValue);
    close();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (!isOpen()) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions().length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions().length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex() >= 0 && filteredOptions()[highlightedIndex()]) {
          handleSelect(filteredOptions()[highlightedIndex()].value);
        }
        break;
      case "Escape":
        e.preventDefault();
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
        onClick={() => !disabled() && setIsOpen(!isOpen())}
        disabled={disabled()}
        class={`
          dropdown-trigger
          flex items-center justify-between gap-2 px-2.5 h-[32px] text-m rounded-md w-full
          transition-all
          text-text placeholder-text-muted
          focus:border-accent/40 focus:ring-1 focus:ring-accent/20 focus:outline-none
          ${disabled() ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        `}
      >
        <span
          class={`truncate ${selectedOption() ? "text-text" : "text-text-muted"}`}
        >
          {selectedOption() ? selectedOption()!.label : placeholder()}
        </span>
        <i
          class={`fa-solid fa-chevron-down text-text-muted text-icon transition-transform duration-150 ${isOpen()
              ? openUpwards()
                ? ""
                : "rotate-180"
              : openUpwards()
                ? "rotate-180"
                : ""
            }`}
        />
      </button>

      <Show when={isOpen() && portalTarget()}>
        <Portal mount={portalTarget()!}>
          <div
            ref={listRef}
            style={popupStyle()}
            class="dropdown-panel z-[100000] py-1 rounded-lg max-h-52 flex flex-col items-stretch animate-popover-in"
            role="listbox"
          >
            <Show when={filterable()}>
              <div class="px-2 pb-2 pt-1 flex-shrink-0 border-b border-border/5">
                <div class="dropdown-search flex items-center gap-2 h-8 px-2.5 rounded-md transition-all">
                  <i class="fa-solid fa-magnifying-glass text-3xs opacity-40" />
                  <input
                    ref={filterInputRef}
                    type="text"
                    value={filter()}
                    onInput={(e) => setFilter(e.currentTarget.value)}
                    placeholder="Search databases..."
                    class="w-full bg-transparent text-m text-text caret-accent placeholder:text-text-muted/60 outline-none"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={handleKeyDown}
                  />
                </div>
              </div>
            </Show>
            <div class="flex-1 overflow-y-auto">
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
                      onMouseEnter={() => setHighlightedIndex(index())}
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
