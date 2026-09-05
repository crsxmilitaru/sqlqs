import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { usePopupDismiss } from "../../hooks/usePopupDismiss";
import { resolveSavedQueryFilePath } from "../../lib/path";
import { groupColorStyle } from "../../lib/tab-groups";
import type { ClosedTab, QueryTab, TabGroup } from "../../lib/types";

interface TabSearchPopupProps {
  anchor?: HTMLElement;
  open: boolean;
  onClose: () => void;
  tabs: QueryTab[];
  groups?: TabGroup[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  closedTabs?: ClosedTab[];
  onReopenTab: (index?: number) => void;
}

interface ClosedTabItem {
  closedTab: ClosedTab;
  originalIndex: number;
}

type NavItem =
  | { type: "open"; id: string }
  | { type: "closed"; originalIndex: number };

const VIEWPORT_PAD = 8;
const ANCHOR_GAP = 6;

function getSqlSnippet(sql?: string): string {
  if (!sql) return "";
  const firstLine =
    sql
      .trim()
      .split("\n")
      .find((line) => line.trim().length > 0) || "";
  return firstLine.replace(/\s+/g, " ").slice(0, 45);
}

function getTabSubtitle(tab: {
  savedQueryFilePath?: string;
  sourceId?: string;
  sql?: string;
}): string {
  if (resolveSavedQueryFilePath(tab)) {
    return "Queries";
  }
  const snippet = getSqlSnippet(tab.sql);
  return snippet || "New Query";
}

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function TabSearchPopup(props: TabSearchPopupProps) {
  let popupRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const [position, setPosition] = createSignal({ x: 0, y: 0 });
  const [placed, setPlaced] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [isClosedCollapsed, setIsClosedCollapsed] = createSignal(true);

  function place() {
    const el = popupRef;
    if (!el || !props.anchor) return;
    const rect = props.anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = el.offsetWidth || 300;
    const height = el.offsetHeight || 300;

    const x = Math.min(
      Math.max(VIEWPORT_PAD, rect.left),
      vw - width - VIEWPORT_PAD,
    );
    let y = rect.bottom + ANCHOR_GAP;
    if (y + height > vh - VIEWPORT_PAD) {
      y = Math.max(VIEWPORT_PAD, rect.top - height - ANCHOR_GAP);
    }
    setPosition({ x, y });
    setPlaced(true);
  }

  usePopupDismiss({
    getPopup: () => popupRef,
    getIgnore: () => [props.anchor],
    onClose: props.onClose,
  });

  onMount(() => {
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
    });
  });

  createEffect(() => {
    if (props.open) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        place();
        inputRef?.focus();
      });
    }
  });

  const groupMap = createMemo(
    () => new Map((props.groups ?? []).map((g) => [g.id, g])),
  );

  const trimmedQuery = () => query().trim().toLowerCase();

  const filteredOpenTabs = createMemo(() => {
    const q = trimmedQuery();
    if (!q) return props.tabs;
    return props.tabs.filter((tab) => {
      if (tab.title.toLowerCase().includes(q)) return true;
      const path = resolveSavedQueryFilePath(tab);
      if (path?.toLowerCase().includes(q)) return true;
      if (tab.sql.toLowerCase().includes(q)) return true;
      if (
        tab.groupId &&
        groupMap().get(tab.groupId)?.name.toLowerCase().includes(q)
      ) {
        return true;
      }
      return false;
    });
  });

  const reversedClosedTabs = createMemo((): ClosedTabItem[] => {
    const list = props.closedTabs ?? [];
    return list
      .map((closedTab, originalIndex) => ({ closedTab, originalIndex }))
      .reverse();
  });

  const filteredClosedTabs = createMemo(() => {
    const q = trimmedQuery();
    if (!q) return reversedClosedTabs();
    return reversedClosedTabs().filter(({ closedTab }) => {
      if (closedTab.title.toLowerCase().includes(q)) return true;
      const path = resolveSavedQueryFilePath(closedTab);
      if (path?.toLowerCase().includes(q)) return true;
      if (closedTab.sql.toLowerCase().includes(q)) return true;
      if (closedTab.group?.name.toLowerCase().includes(q)) return true;
      return false;
    });
  });

  const showClosedList = () =>
    !isClosedCollapsed() || trimmedQuery().length > 0;

  const selectableItems = createMemo((): NavItem[] => {
    const items: NavItem[] = [];
    for (const tab of filteredOpenTabs()) {
      items.push({ type: "open", id: tab.id });
    }
    if (showClosedList()) {
      for (const item of filteredClosedTabs()) {
        items.push({ type: "closed", originalIndex: item.originalIndex });
      }
    }
    return items;
  });

  createEffect(
    on(
      query,
      () => setSelectedIndex(0),
      { defer: true },
    ),
  );

  function handleKeyDown(e: KeyboardEvent) {
    const items = selectableItems();
    if (items.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % items.length);
      scrollSelectedIntoView();
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
      scrollSelectedIntoView();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const current = items[selectedIndex()];
      if (!current) return;
      if (current.type === "open") {
        props.onSelectTab(current.id);
      } else {
        props.onReopenTab(current.originalIndex);
      }
      props.onClose();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  }

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      const el = popupRef?.querySelector('[aria-selected="true"]');
      el?.scrollIntoView({ block: "nearest" });
    });
  }

  function getGlobalIndex(item: NavItem): number {
    return selectableItems().findIndex((nav) => {
      if (nav.type !== item.type) return false;
      if (nav.type === "open" && item.type === "open") {
        return nav.id === item.id;
      }
      if (nav.type === "closed" && item.type === "closed") {
        return nav.originalIndex === item.originalIndex;
      }
      return false;
    });
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Search Tabs"
          class="dropdown-panel fixed rounded-xl w-[300px] py-1 flex flex-col z-[100000] border border-border shadow-2xl animate-popover-in"
          style={{
            left: `${position().x}px`,
            top: `${position().y}px`,
            visibility: placed() ? "visible" : "hidden",
          }}
          onKeyDown={handleKeyDown}
        >
          <div class="px-2 pb-1 pt-1 flex-shrink-0">
            <div class="dropdown-search flex items-center gap-2 h-8 px-2.5 rounded-md transition-colors">
              <i class="fa-solid fa-magnifying-glass text-3xs opacity-40 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                name="tab-search"
                autocomplete="off"
                placeholder="Search tabs…"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                class="w-full bg-transparent text-m text-text caret-accent placeholder:text-text-muted/60 outline-none"
                aria-label="Search tabs"
              />
            </div>
          </div>

          <div
            role="listbox"
            class="max-h-[380px] overflow-y-auto p-1.5 flex flex-col gap-0.5"
          >
            <Show when={filteredOpenTabs().length > 0}>
              <div class="px-2.5 pt-2 pb-1 text-2xs font-semibold text-text-muted uppercase tracking-wider select-none">
                Open Tabs
              </div>
              <For each={filteredOpenTabs()}>
                {(tab) => {
                  const globalIdx = () =>
                    getGlobalIndex({ type: "open", id: tab.id });
                  const isHighlighted = () => selectedIndex() === globalIdx();
                  const group = () =>
                    tab.groupId ? groupMap().get(tab.groupId) : undefined;

                  return (
                    <div
                      role="option"
                      tabIndex={-1}
                      aria-selected={isHighlighted()}
                      onClick={() => {
                        props.onSelectTab(tab.id);
                        props.onClose();
                      }}
                      class="group flex items-center gap-2.5 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                      classList={{
                        "bg-surface-active text-text": isHighlighted(),
                        "hover:bg-surface-hover text-text-muted hover:text-text":
                          !isHighlighted(),
                      }}
                    >
                      <div class="flex-1 min-w-0 flex flex-col">
                        <div class="text-xs font-medium text-text truncate leading-snug flex items-center gap-1.5">
                          <span class="truncate">{tab.title}</span>
                          <Show when={tab.sql !== tab.savedSql}>
                            <span class="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                          </Show>
                        </div>
                        <div class="text-2xs text-text-muted truncate leading-normal flex items-center gap-1">
                          <Show when={group()}>
                            <span
                              style={groupColorStyle(group()!.color)}
                              class="text-[var(--group-color)] font-medium"
                            >
                              {group()!.name}
                            </span>
                            <span>•</span>
                          </Show>
                          <span class="truncate font-mono">
                            {getTabSubtitle(tab)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        aria-label={`Close ${tab.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onCloseTab(tab.id);
                        }}
                        class="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-active transition-all ml-auto flex-shrink-0 cursor-pointer"
                      >
                        <i class="fa-solid fa-xmark text-xs" />
                      </button>
                    </div>
                  );
                }}
              </For>
            </Show>

            <Show when={filteredClosedTabs().length > 0}>
              <button
                type="button"
                onClick={() => setIsClosedCollapsed((prev) => !prev)}
                class="w-full px-2.5 pt-2 pb-1 flex items-center justify-between text-2xs font-semibold text-text-muted uppercase tracking-wider select-none hover:text-text transition-colors cursor-pointer"
              >
                <span>Recently Closed ({filteredClosedTabs().length})</span>
                <i
                  class="fa-solid fa-chevron-down text-2xs transition-transform duration-150"
                  classList={{ "-rotate-90": !showClosedList() }}
                />
              </button>

              <Show when={showClosedList()}>
                <For each={filteredClosedTabs()}>
                  {({ closedTab, originalIndex }) => {
                    const globalIdx = () =>
                      getGlobalIndex({
                        type: "closed",
                        originalIndex,
                      });
                    const isHighlighted = () => selectedIndex() === globalIdx();
                    const timeAgo = () => formatTimeAgo(closedTab.closedAt);

                    return (
                      <div
                        role="option"
                        tabIndex={-1}
                        aria-selected={isHighlighted()}
                        onClick={() => {
                          props.onReopenTab(originalIndex);
                          props.onClose();
                        }}
                        class="group flex items-center gap-2.5 px-3 py-1.5 rounded-lg cursor-pointer transition-colors"
                        classList={{
                          "bg-surface-active text-text": isHighlighted(),
                          "hover:bg-surface-hover text-text-muted hover:text-text":
                            !isHighlighted(),
                        }}
                      >
                        <div class="flex-1 min-w-0 flex flex-col">
                          <div class="text-xs font-medium text-text truncate leading-snug">
                            {closedTab.title}
                          </div>
                          <div class="text-2xs text-text-muted truncate leading-normal flex items-center gap-1">
                            <Show when={timeAgo()}>
                              <span>{timeAgo()}</span>
                              <span>•</span>
                            </Show>
                            <Show when={closedTab.group}>
                              <span
                                style={groupColorStyle(
                                  closedTab.group!.color,
                                )}
                                class="text-[var(--group-color)] font-medium"
                              >
                                {closedTab.group!.name}
                              </span>
                              <span>•</span>
                            </Show>
                            <span class="truncate font-mono">
                              {getTabSubtitle(closedTab)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </Show>

            <Show when={selectableItems().length === 0}>
              <div class="py-6 px-4 text-center text-xs text-text-muted select-none">
                {trimmedQuery()
                  ? `No tabs match "${query()}"`
                  : "No tabs open"}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
