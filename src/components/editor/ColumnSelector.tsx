import { createEffect, createMemo, createSignal, onCleanup, onMount, For, Show } from "solid-js";
import type { ColumnInfo } from "../../lib/types";

interface Props {
  columns: ColumnInfo[];
  hiddenColumnIndices: Set<number>;
  onToggle: (index: number) => void;
  onSetHidden: (indices: number[], hidden: boolean) => void;
  anchorRef: HTMLButtonElement | undefined;
  onClose: () => void;
}

export default function ColumnSelector(props: Props) {
  let popupRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  const [search, setSearch] = createSignal("");

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

  onMount(() => {
    searchInputRef?.focus();
  });

  const normalizedSearch = createMemo(() => search().trim().toLowerCase());

  const filteredIndices = createMemo<number[]>(() => {
    const q = normalizedSearch();
    if (!q) return props.columns.map((_col, i) => i);
    return props.columns
      .map((_col, i) => i)
      .filter((i) => props.columns[i].name.toLowerCase().includes(q));
  });

  const visibleMatchingCount = createMemo(
    () =>
      filteredIndices().filter((i) => !props.hiddenColumnIndices.has(i)).length,
  );

  const masterState = createMemo<"all" | "none" | "some">(() => {
    const total = filteredIndices().length;
    if (total === 0) return "none";
    const visible = visibleMatchingCount();
    if (visible === total) return "all";
    if (visible === 0) return "none";
    return "some";
  });

  const toggleAllMatching = () => {
    const indices = filteredIndices();
    if (indices.length === 0) return;
    // "all"/"some" visible -> hide the rest; "none" -> show all matching.
    props.onSetHidden(indices, masterState() !== "none");
  };

  const handleSearchKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" && normalizedSearch()) {
      e.preventDefault();
      setSearch("");
    }
  };

  const hiddenCount = () => props.hiddenColumnIndices.size;

  return (
    <div
      ref={popupRef}
      class="absolute top-full mt-1 right-0 w-[240px] bg-surface-panel border border-border rounded-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 shadow-md shadow-black/20"
    >
      <div class="flex flex-col gap-2 px-2.5 py-2.5 border-b border-border bg-surface-header/30">
        <div class="flex items-center justify-between px-0.5">
          <span class="text-[10px] font-bold text-text-muted uppercase tracking-wider">
            Column Visibility
          </span>
          <Show when={hiddenCount() > 0}>
            <span class="text-[10px] font-medium text-accent/80">
              {hiddenCount()} hidden
            </span>
          </Show>
        </div>
        <div class="relative flex items-center">
          <i class="fa-solid fa-magnifying-glass pointer-events-none absolute left-2.5 text-[10px] text-text-muted/50" />
          <input
            ref={searchInputRef}
            type="text"
            value={search()}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            onKeyDown={handleSearchKeyDown}
            onKeyUp={(e) => e.stopPropagation()}
            placeholder="Search columns…"
            spellcheck={false}
            autocomplete="off"
            class="w-full h-7 pl-7 pr-7 text-xs rounded-md border border-border-subtle bg-surface-active text-text outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent"
          />
          <Show when={normalizedSearch()}>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                searchInputRef?.focus();
              }}
              aria-label="Clear search"
              class="absolute right-2 flex items-center justify-center w-4 h-4 text-text-muted/60 hover:text-text transition-colors"
            >
              <i class="fa-solid fa-xmark text-[10px]" />
            </button>
          </Show>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleAllMatching}
        disabled={filteredIndices().length === 0}
        class="w-full flex items-center gap-3 px-2.5 py-2 text-left transition-colors cursor-pointer hover:bg-surface-hover border-b border-border/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <MasterCheckbox state={masterState()} />
        <span class="flex-1 text-xs font-semibold text-text">Select All</span>
        <Show when={normalizedSearch() && filteredIndices().length > 0}>
          <span class="text-[10px] text-text-muted/60 font-normal">
            {filteredIndices().length}
          </span>
        </Show>
      </button>

      <div class="p-1 max-h-[260px] overflow-y-auto custom-scrollbar">
        <Show
          when={filteredIndices().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center gap-2 px-3 py-8 text-center text-text-muted">
              <i class="fa-solid fa-magnifying-glass opacity-30" />
              <p class="text-xs">No matching columns</p>
            </div>
          }
        >
          <For each={filteredIndices()}>
            {(i) => {
              const col = props.columns[i];
              const isVisible = () => !props.hiddenColumnIndices.has(i);
              return (
                <button
                  onClick={() => props.onToggle(i)}
                  class={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors cursor-pointer group ${
                    isVisible()
                      ? "hover:bg-surface-hover"
                      : "opacity-40 hover:opacity-60 hover:bg-surface-hover"
                  }`}
                >
                  <div
                    class={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                      isVisible()
                        ? "border-accent bg-accent"
                        : "border-border bg-surface-header"
                    }`}
                  >
                    <Show when={isVisible()}>
                      <i class="fa-solid fa-check text-[10px] text-accent-text" />
                    </Show>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div
                      class={`text-xs font-medium truncate ${isVisible() ? "text-text" : "text-text-muted"}`}
                    >
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
        </Show>
      </div>
    </div>
  );
}

function MasterCheckbox(props: { state: "all" | "none" | "some" }) {
  return (
    <div
      class={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
        props.state === "all"
          ? "border-accent bg-accent"
          : props.state === "some"
            ? "border-accent bg-accent/40"
            : "border-border bg-surface-header"
      }`}
    >
      <Show when={props.state === "all"}>
        <i class="fa-solid fa-check text-[10px] text-accent-text" />
      </Show>
      <Show when={props.state === "some"}>
        <i class="fa-solid fa-minus text-[8px] text-accent-text" />
      </Show>
    </div>
  );
}
