import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  onCleanup,
} from "solid-js";
import type { QueryTab, TabGroup, TabGroupColor } from "../../lib/types";
import {
  TAB_GROUP_COLORS,
  groupColorStyle,
} from "../../lib/tab-groups";
import ContextMenu, { type ContextMenuItem } from "../ui/ContextMenu";
import Tooltip from "../ui/Tooltip";
import { getModifierKeyLabel } from "../../lib/platform";

const DRAG_THRESHOLD = 5;
const MERGE_DWELL_MS = 350;

export type TabBarSegment =
  | {
      kind: "group";
      group: TabGroup;
      members: { tab: QueryTab; index: number }[];
    }
  | { kind: "tab"; tab: QueryTab; index: number };

export interface TabDropTarget {
  index: number;
  groupId: string | null;
}

interface Props {
  tabs: QueryTab[];
  groups: TabGroup[];
  activeTabId: string;
  pinnedCount: number;
  onTabChange: (id: string) => void;
  onTabClose: (id: string) => void;
  onTabCloseOthers: (id: string) => void;
  onTabCloseAll: () => void;
  onTabUpdate: (id: string, updates: Partial<QueryTab>) => void;
  onTabMove: (
    fromIndex: number,
    toIndex: number,
    groupId?: string | null,
    options?: { moveGroupId?: string },
  ) => void;
  onTabDuplicate: (id: string) => string;
  onTabTogglePin: (id: string) => void;
  onTabPromote: (id: string) => void;
  onTabReopen: () => string;
  canReopenClosedTab: () => boolean;
  onTabAdd: (sql?: string, title?: string, groupId?: string) => string;
  onOpenSqlFile?: () => void;
  onTabCreateGroup: (tabIds: string[], name?: string) => string;
  onTabAddToGroup: (groupId: string, tabIds: string[]) => void;
  onTabRemoveFromGroup: (tabIds: string[]) => void;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupSetColor: (groupId: string, color: TabGroupColor) => void;
  onGroupToggleCollapsed: (groupId: string) => void;
  onGroupUngroup: (groupId: string) => void;
  onGroupClose: (groupId: string) => void;
  onSave?: (id: string) => void;
  onSaveToFile?: (id: string) => void;
  requestSingleTabClose: (id: string) => void;
  requestCloseOthers: (id: string) => void;
  requestCloseAll: () => void;
  requestCloseGroup: (groupId: string) => void;
  requestCloseTabs: (tabIds: string[]) => void;
  isTabDirty: (tab: QueryTab) => boolean;
  setTabBarRef: (el: HTMLDivElement) => void;
  onRenamingChange: (renaming: boolean) => void;
}

export default function EditorTabBar(props: Props) {
  const [renamingTabId, setRenamingTabId] = createSignal<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = createSignal<string | null>(
    null,
  );
  const [renameValue, setRenameValue] = createSignal("");
  const [selectedTabIds, setSelectedTabIds] = createSignal<Set<string>>(
    new Set(),
  );
  const [selectionAnchorId, setSelectionAnchorId] = createSignal<string | null>(
    null,
  );
  const [tabContextMenu, setTabContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const [tabBarContextMenu, setTabBarContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    groupId: string;
  } | null>(null);
  const [collapsedGroupMenu, setCollapsedGroupMenu] = createSignal<{
    visible: boolean;
    x: number;
    y: number;
    groupId: string;
  } | null>(null);
  const [dragTabId, setDragTabId] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<TabDropTarget | null>(null);
  const [mergeTargetTabId, setMergeTargetTabId] = createSignal<string | null>(
    null,
  );

  let renameInputRef: HTMLInputElement | undefined;
  let dragRef: {
    tabId: string;
    fromIndex: number;
    startX: number;
    startY: number;
    active: boolean;
    moveGroupId?: string;
  } | null = null;
  let justDraggedRef = false;
  let mergeDwellTimer: number | undefined;
  let cleanupDragListeners: (() => void) | undefined;

  const tabBarSegments = createMemo((): TabBarSegment[] => {
    const segments: TabBarSegment[] = [];
    const groupMap = new Map(props.groups.map((group) => [group.id, group]));
    let index = 0;
    while (index < props.tabs.length) {
      const tab = props.tabs[index];
      if (tab.groupId && groupMap.has(tab.groupId)) {
        const groupId = tab.groupId;
        const group = groupMap.get(groupId)!;
        const members: { tab: QueryTab; index: number }[] = [];
        while (
          index < props.tabs.length &&
          props.tabs[index].groupId === groupId
        ) {
          members.push({ tab: props.tabs[index], index });
          index += 1;
        }
        segments.push({ kind: "group", group, members });
      } else {
        segments.push({ kind: "tab", tab, index });
        index += 1;
      }
    }
    return segments;
  });

  const groupCollapsed = (groupId: string) =>
    props.groups.find((group) => group.id === groupId)?.collapsed ?? false;

  createEffect(() => {
    const renaming = Boolean(renamingTabId() || renamingGroupId());
    props.onRenamingChange(renaming);
    if (renaming && renameInputRef) {
      renameInputRef.focus();
      renameInputRef.select();
    }
  });

  onCleanup(() => {
    props.onRenamingChange(false);
    cleanupDragListeners?.();
    if (mergeDwellTimer !== undefined) {
      window.clearTimeout(mergeDwellTimer);
    }
  });

  function clearMergeDwell() {
    if (mergeDwellTimer !== undefined) {
      window.clearTimeout(mergeDwellTimer);
      mergeDwellTimer = undefined;
    }
    setMergeTargetTabId(null);
  }

  function getSelectionTabIds(contextTabId?: string): string[] {
    const selected = selectedTabIds();
    if (selected.size > 1) {
      return [...selected];
    }
    if (contextTabId) return [contextTabId];
    return [];
  }

  function handleStartRenameTab(tab: QueryTab) {
    setRenamingGroupId(null);
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
  }

  function handleStartRenameGroup(group: TabGroup) {
    setRenamingTabId(null);
    setRenamingGroupId(group.id);
    setRenameValue(group.name);
  }

  function handleRenameTab(tabId: string) {
    if (renameValue().trim()) {
      props.onTabUpdate(tabId, {
        title: renameValue().trim(),
        userTitle: true,
      });
    }
    setRenamingTabId(null);
    setRenameValue("");
  }

  function handleRenameGroup(groupId: string) {
    if (renameValue().trim()) {
      props.onGroupRename(groupId, renameValue().trim());
    }
    setRenamingGroupId(null);
    setRenameValue("");
  }

  function handleRenameKeyDown(e: KeyboardEvent, kind: "tab" | "group", id: string) {
    if (e.key === "Enter") {
      if (kind === "tab") handleRenameTab(id);
      else handleRenameGroup(id);
    } else if (e.key === "Escape") {
      setRenamingTabId(null);
      setRenamingGroupId(null);
      setRenameValue("");
    }
  }

  function handleTabClick(e: MouseEvent, tab: QueryTab, index: number) {
    if (justDraggedRef) return;
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    if (isCtrl) {
      setSelectedTabIds((prev) => {
        const next = new Set(prev);
        if (next.has(tab.id)) next.delete(tab.id);
        else next.add(tab.id);
        return next;
      });
      setSelectionAnchorId(tab.id);
      return;
    }
    if (isShift && selectionAnchorId()) {
      const anchorIndex = props.tabs.findIndex(
        (item) => item.id === selectionAnchorId(),
      );
      if (anchorIndex !== -1) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const next = new Set<string>();
        for (let i = start; i <= end; i += 1) {
          next.add(props.tabs[i].id);
        }
        setSelectedTabIds(next);
        return;
      }
    }
    setSelectedTabIds(new Set<string>());
    setSelectionAnchorId(tab.id);
    props.onTabChange(tab.id);
  }

  function resolveDropGroupId(index: number): string | null {
    const left = props.tabs[index - 1];
    const right = props.tabs[index];
    if (left?.groupId && left.groupId === right?.groupId) return left.groupId;
    if (left?.groupId && !left.pinned) return left.groupId;
    if (right?.groupId && !right.pinned) return right.groupId;
    return null;
  }

  function computeDropTarget(
    clientX: number,
    draggedTabId: string,
  ): TabDropTarget | null {
    const tabBar = document.querySelector<HTMLElement>(
      '[data-editor-tab-bar="true"]',
    );
    if (!tabBar) return null;

    const tabElements = tabBar.querySelectorAll<HTMLElement>("[data-tab-index]");
    const currentTabs = props.tabs;
    const draggedTab = currentTabs.find((tab) => tab.id === draggedTabId);
    if (!draggedTab) return null;

    let result = currentTabs.length;
    for (const el of tabElements) {
      const idx = Number(el.dataset.tabIndex);
      const targetTab = currentTabs[idx];
      if (!targetTab) continue;
      if (!!draggedTab.pinned !== !!targetTab.pinned) continue;

      const rect = el.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (clientX < midpoint) {
        result = idx;
        break;
      }
    }

    return { index: result, groupId: resolveDropGroupId(result) };
  }

  function updateMergeTarget(clientX: number, clientY: number, dragTabIdValue: string) {
    const tabBar = document.querySelector<HTMLElement>(
      '[data-editor-tab-bar="true"]',
    );
    if (!tabBar) {
      clearMergeDwell();
      return;
    }

    const draggedTab = props.tabs.find((tab) => tab.id === dragTabIdValue);
    if (!draggedTab || draggedTab.pinned) {
      clearMergeDwell();
      return;
    }

    const tabElements = tabBar.querySelectorAll<HTMLElement>("[data-tab-index]");
    let foundTarget: string | null = null;
    for (const el of tabElements) {
      const idx = Number(el.dataset.tabIndex);
      const targetTab = props.tabs[idx];
      if (!targetTab || targetTab.id === dragTabIdValue || targetTab.pinned) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const relativeX = (clientX - rect.left) / rect.width;
      if (relativeX >= 0.3 && relativeX <= 0.7) {
        foundTarget = targetTab.id;
        break;
      }
    }

    if (!foundTarget) {
      clearMergeDwell();
      return;
    }

    if (mergeTargetTabId() === foundTarget) return;

    clearMergeDwell();
    mergeDwellTimer = window.setTimeout(() => {
      setMergeTargetTabId(foundTarget);
      mergeDwellTimer = undefined;
    }, MERGE_DWELL_MS);
  }

  function handleTabPointerDown(
    e: PointerEvent,
    tabId: string,
    index: number,
    options?: { moveGroupId?: string },
  ) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("button, input")) return;

    dragRef = {
      tabId,
      fromIndex: index,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      moveGroupId: options?.moveGroupId,
    };

    const onPointerMove = (ev: PointerEvent) => {
      const drag = dragRef;
      if (!drag) return;

      if (!drag.active) {
        if (Math.abs(ev.clientX - drag.startX) < DRAG_THRESHOLD) return;
        drag.active = true;
        setDragTabId(drag.tabId);
        document.body.style.cursor = "grabbing";
      }

      if (drag.moveGroupId) {
        const target = computeDropTarget(ev.clientX, drag.tabId);
        setDropTarget(target);
        clearMergeDwell();
        return;
      }

      updateMergeTarget(ev.clientX, ev.clientY, drag.tabId);
      const target = computeDropTarget(ev.clientX, drag.tabId);
      setDropTarget(target);
    };

    const onPointerUp = () => {
      cleanupDragListeners?.();
      document.body.style.cursor = "";

      const drag = dragRef;
      if (drag?.active) {
        justDraggedRef = true;
        requestAnimationFrame(() => {
          justDraggedRef = false;
        });

        const mergeTarget = mergeTargetTabId();
        if (mergeTarget && !drag.moveGroupId) {
          const mergeIds = [drag.tabId, mergeTarget];
          props.onTabCreateGroup(mergeIds);
        } else {
          const currentDrop = dropTarget();
          if (currentDrop && drag.fromIndex !== currentDrop.index) {
            const adjusted =
              currentDrop.index > drag.fromIndex
                ? currentDrop.index - 1
                : currentDrop.index;
            if (drag.fromIndex !== adjusted) {
              if (drag.moveGroupId) {
                props.onTabMove(drag.fromIndex, currentDrop.index, undefined, {
                  moveGroupId: drag.moveGroupId,
                });
              } else {
                props.onTabMove(
                  drag.fromIndex,
                  currentDrop.index,
                  currentDrop.groupId,
                );
              }
            }
          }
        }
        setDropTarget(null);
        clearMergeDwell();
      }

      dragRef = null;
      setDragTabId(null);
    };

    cleanupDragListeners?.();
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    cleanupDragListeners = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      cleanupDragListeners = undefined;
    };
  }

  function buildAddToGroupItems(tabIds: string[]): ContextMenuItem[] {
    const validIds = tabIds.filter((id) => {
      const tab = props.tabs.find((item) => item.id === id);
      return tab && !tab.pinned;
    });
    if (validIds.length === 0) return [];

    const submenu: ContextMenuItem[] = [
      {
        id: "new-group",
        label: "New group",
        icon: <i class="fa-solid fa-folder-plus" />,
        onClick: () => props.onTabCreateGroup(validIds),
      },
    ];

    for (const group of props.groups) {
      submenu.push({
        id: `group-${group.id}`,
        label: group.name,
        icon: (
          <span
            class="tab-group-color-dot"
            style={groupColorStyle(group.color)}
          />
        ),
        onClick: () => props.onTabAddToGroup(group.id, validIds),
      });
    }

    const items: ContextMenuItem[] = [
      {
        id: "add-to-group",
        label: "Add to Group",
        icon: <i class="fa-solid fa-object-group" />,
        children: submenu,
      },
    ];

    const groupedIds = validIds.filter((id) => {
      const tab = props.tabs.find((item) => item.id === id);
      return tab?.groupId;
    });
    if (groupedIds.length > 0) {
      items.push({
        id: "remove-from-group",
        label: "Remove from Group",
        icon: <i class="fa-solid fa-folder-minus" />,
        onClick: () => props.onTabRemoveFromGroup(groupedIds),
      });
    }

    return items;
  }

  const getTabContextMenuItems = (tabId: string): ContextMenuItem[] => {
    const tab = props.tabs.find((item) => item.id === tabId);
    const mod = getModifierKeyLabel();
    const selectionIds = getSelectionTabIds(tabId);
    const isMulti = selectionIds.length > 1;

    if (isMulti) {
      return [
        {
          id: "group-selection",
          label: `Group ${selectionIds.length} Tabs`,
          icon: <i class="fa-solid fa-object-group" />,
          onClick: () => props.onTabCreateGroup(selectionIds),
        },
        ...buildAddToGroupItems(selectionIds),
        { id: "sep-selection", separator: true },
        {
          id: "close-selection",
          label: `Close ${selectionIds.length} Tabs`,
          icon: <i class="fa-solid fa-xmark" />,
          onClick: () => props.requestCloseTabs(selectionIds),
        },
      ];
    }

    const items: ContextMenuItem[] = [
      {
        id: "close",
        label: "Close Tab",
        icon: <i class="fa-solid fa-xmark" />,
        shortcut: `${mod}+W`,
        onClick: () => props.requestSingleTabClose(tabId),
      },
      {
        id: "close-others",
        label: "Close Others",
        icon: <i class="fa-solid fa-rectangle-xmark" />,
        onClick: () => props.requestCloseOthers(tabId),
      },
      {
        id: "close-all",
        label: "Close All",
        icon: <i class="fa-solid fa-trash" />,
        onClick: () => props.requestCloseAll(),
      },
      { id: "sep-actions", separator: true },
      {
        id: "rename",
        label: "Rename",
        icon: <i class="fa-solid fa-i-cursor" />,
        onClick: () => {
          if (tab) handleStartRenameTab(tab);
        },
      },
      {
        id: "duplicate",
        label: "Duplicate Tab",
        icon: <i class="fa-solid fa-clone" />,
        onClick: () => props.onTabDuplicate(tabId),
      },
      {
        id: "pin",
        label: tab?.pinned ? "Unpin Tab" : "Pin Tab",
        icon: (
          <i
            class="fa-solid fa-thumbtack"
            style={tab?.pinned ? { opacity: "0.5" } : undefined}
          />
        ),
        onClick: () => props.onTabTogglePin(tabId),
      },
      ...buildAddToGroupItems([tabId]),
    ];

    if (props.onSave || props.onSaveToFile) {
      items.push({ id: "sep-tab-1", separator: true });
      const sqlEmpty = !tab?.sql.trim();
      if (props.onSave) {
        items.push({
          id: "save-sql",
          label: "Save SQL",
          icon: <i class="fa-solid fa-floppy-disk" />,
          disabled: sqlEmpty,
          onClick: () => props.onSave!(tabId),
        });
      }
      if (props.onSaveToFile) {
        items.push({
          id: "save-sql-file",
          label: "Save SQL to file",
          icon: <i class="fa-regular fa-floppy-disk" />,
          disabled: sqlEmpty,
          onClick: () => props.onSaveToFile!(tabId),
        });
      }
    }

    return items;
  };

  const getTabBarContextMenuItems = (): ContextMenuItem[] => {
    const mod = getModifierKeyLabel();
    const hasClosableTabs = props.tabs.some((tab) => !tab.pinned);
    const selectionIds = [...selectedTabIds()];

    const items: ContextMenuItem[] = [
      {
        id: "new",
        label: "New Query",
        icon: <i class="fa-solid fa-plus" />,
        shortcut: `${mod}+T`,
        onClick: () => props.onTabAdd(),
      },
      {
        id: "reopen-closed",
        label: "Reopen Closed Tab",
        icon: <i class="fa-solid fa-rotate-left" />,
        shortcut: `${mod}+Shift+T`,
        disabled: !props.canReopenClosedTab(),
        onClick: () => props.onTabReopen(),
      },
    ];

    if (selectionIds.length > 1) {
      items.push({
        id: "group-selection",
        label: `Group ${selectionIds.length} Tabs`,
        icon: <i class="fa-solid fa-object-group" />,
        onClick: () => props.onTabCreateGroup(selectionIds),
      });
    }

    if (props.onOpenSqlFile) {
      items.push({
        id: "open-file",
        label: "Open File",
        icon: <i class="fa-regular fa-folder" />,
        shortcut: `${mod}+O`,
        onClick: () => props.onOpenSqlFile!(),
      });
    }

    if (props.tabs.length > 0) {
      items.push({ id: "sep-close", separator: true });
      items.push({
        id: "close-all",
        label: "Close All",
        icon: <i class="fa-solid fa-trash" />,
        disabled: !hasClosableTabs,
        onClick: () => props.requestCloseAll(),
      });
    }

    return items;
  };

  const getGroupContextMenuItems = (groupId: string): ContextMenuItem[] => {
    const group = props.groups.find((item) => item.id === groupId);
    if (!group) return [];
    const collapsed = groupCollapsed(groupId);

    return [
      {
        id: "rename-group",
        label: "Rename",
        icon: <i class="fa-solid fa-i-cursor" />,
        onClick: () => handleStartRenameGroup(group),
      },
      {
        id: "color-group",
        label: "Color",
        icon: <i class="fa-solid fa-palette" />,
        children: TAB_GROUP_COLORS.map((color) => ({
          id: `color-${color}`,
          label: color.charAt(0).toUpperCase() + color.slice(1),
          icon: (
            <span class="tab-group-color-dot" style={groupColorStyle(color)} />
          ),
          onClick: () => props.onGroupSetColor(groupId, color),
        })),
      },
      {
        id: "new-tab-in-group",
        label: "New Tab in Group",
        icon: <i class="fa-solid fa-plus" />,
        onClick: () => {
          const tabId = props.onTabAdd("", undefined, groupId);
          if (tabId) props.onTabChange(tabId);
        },
      },
      { id: "sep-group-1", separator: true },
      {
        id: "toggle-collapse",
        label: collapsed ? "Expand Group" : "Collapse Group",
        icon: <i class={`fa-solid fa-${collapsed ? "expand" : "compress"}`} />,
        onClick: () => props.onGroupToggleCollapsed(groupId),
      },
      {
        id: "ungroup",
        label: "Ungroup",
        icon: <i class="fa-solid fa-folder-open" />,
        onClick: () => props.onGroupUngroup(groupId),
      },
      {
        id: "close-group",
        label: "Close Group",
        icon: <i class="fa-solid fa-trash" />,
        danger: true,
        onClick: () => props.requestCloseGroup(groupId),
      },
    ];
  };

  const getCollapsedGroupMenuItems = (groupId: string): ContextMenuItem[] => {
    const members = props.tabs.filter((tab) => tab.groupId === groupId);

    const items: ContextMenuItem[] = [
      {
        id: "expand-group",
        label: "Expand Group",
        icon: <i class="fa-solid fa-expand" />,
        onClick: () => props.onGroupToggleCollapsed(groupId),
      },
      { id: "sep-members", separator: true },
      ...members.map((tab) => ({
        id: `member-${tab.id}`,
        label: tab.title,
        onClick: () => {
          if (groupCollapsed(groupId)) {
            props.onGroupToggleCollapsed(groupId);
          }
          props.onTabChange(tab.id);
        },
      })),
    ];

    return items;
  };

  function handleTabBarContextMenu(e: MouseEvent) {
    e.preventDefault();
    setTabContextMenu(null);
    setGroupContextMenu(null);
    setCollapsedGroupMenu(null);
    setTabBarContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
    });
  }

  createEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (
        e.target instanceof HTMLElement &&
        (e.target.closest("input, textarea, select") ||
          (e.target.closest("[contenteditable='true']") &&
            !e.target.closest(".cm-editor")))
      ) {
        return;
      }

      if (e.key === "Escape") {
        setSelectedTabIds(new Set<string>());
        return;
      }

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      if (!isCtrlOrMeta || e.altKey) return;

      if (e.shiftKey && e.key.toLowerCase() === "g") {
        const selected = [...selectedTabIds()];
        if (selected.length >= 2) {
          e.preventDefault();
          props.onTabCreateGroup(selected);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  function handleTabContextMenu(e: MouseEvent, tabId: string) {
    e.preventDefault();
    e.stopPropagation();
    setTabBarContextMenu(null);
    setGroupContextMenu(null);
    setCollapsedGroupMenu(null);
    setTabContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  }

  function handleGroupContextMenu(e: MouseEvent, groupId: string) {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu(null);
    setTabBarContextMenu(null);
    setCollapsedGroupMenu(null);
    setGroupContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      groupId,
    });
  }

  function handleGroupHeaderPointerDown(
    e: PointerEvent,
    group: TabGroup,
    firstMemberIndex: number,
  ) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest("input")) return;

    const tabId = props.tabs[firstMemberIndex]?.id ?? "";
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;

    const onPointerMove = (ev: PointerEvent) => {
      if (!active) {
        if (
          Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(ev.clientY - startY) < DRAG_THRESHOLD
        ) {
          return;
        }
        active = true;
        setDragTabId(tabId);
        document.body.style.cursor = "grabbing";
      }
      setDropTarget(computeDropTarget(ev.clientX, tabId));
    };

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";

      if (active) {
        const currentDrop = dropTarget();
        if (currentDrop && firstMemberIndex !== currentDrop.index) {
          justDraggedRef = true;
          requestAnimationFrame(() => {
            justDraggedRef = false;
          });
          props.onTabMove(firstMemberIndex, currentDrop.index, undefined, {
            moveGroupId: group.id,
          });
        }
        setDropTarget(null);
        setDragTabId(null);
      }
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }

  function showDropBefore(index: number) {
    return dropTarget()?.index === index;
  }

  function showDropAfter(index: number) {
    return (
      dropTarget()?.index === index + 1 && index === props.tabs.length - 1
    );
  }

  function renderTab(tab: QueryTab, index: number) {
    const isActive = () => tab.id === props.activeTabId;
    const isDragging = () => tab.id === dragTabId();
    const isModified = () => props.isTabDirty(tab);
    const isSelected = () => selectedTabIds().has(tab.id);
    const isMergeTarget = () => tab.id === mergeTargetTabId();

    return (
      <div class="flex items-center flex-shrink-0">
        {showDropBefore(index) && <div class="tab-drop-indicator" />}
        <div
          data-tab-index={index}
          onPointerDown={(e) => handleTabPointerDown(e, tab.id, index)}
          role="tab"
          tabIndex={0}
          aria-selected={isActive()}
          onKeyDown={(e) => {
            if ((e.target as Element).closest("input, button")) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onTabChange(tab.id);
            }
          }}
          class={`tab flex items-center gap-2 text-s whitespace-nowrap select-none flex-shrink-0 tab-animate-in ${isActive() ? "active text-text cursor-default" : "text-text cursor-pointer"} ${isDragging() ? "dragging" : ""} ${tab.pinned ? "pinned" : ""} ${tab.temporary ? "temporary" : ""} ${renamingTabId() === tab.id ? "renaming" : ""} ${isSelected() ? "selected" : ""} ${isMergeTarget() ? "tab-merge-target" : ""}`}
          onClick={(e) => handleTabClick(e, tab, index)}
          onDblClick={(e) => {
            e.stopPropagation();
            if (tab.temporary) {
              props.onTabPromote(tab.id);
              return;
            }
            handleStartRenameTab(tab);
          }}
          on:mousedown={(e: MouseEvent) => {
            if (e.button === 1) {
              e.preventDefault();
              props.requestSingleTabClose(tab.id);
            }
          }}
          onContextMenu={(e) => handleTabContextMenu(e, tab.id)}
        >
          {tab.pinned && (
            <i class="fa-solid fa-thumbtack text-[9px] text-text-muted pin-icon" />
          )}
          <div class="flex-1 min-w-0 mr-2">
            {renamingTabId() === tab.id ? (
              <input
                ref={renameInputRef}
                type="text"
                name="tab-title"
                autocomplete="off"
                aria-label="Rename tab"
                value={renameValue()}
                onInput={(e) => setRenameValue(e.currentTarget.value)}
                onBlur={() => handleRenameTab(tab.id)}
                onKeyDown={(e) => handleRenameKeyDown(e, "tab", tab.id)}
                class="tab-rename-input"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <Tooltip content={tab.title} placement="bottom" class="w-full min-w-0">
                <span class="tab-title truncate block" data-text={tab.title}>
                  {tab.title}
                </span>
              </Tooltip>
            )}
          </div>
          <div class="flex items-center justify-center w-5 h-5 flex-shrink-0 relative">
            {tab.isExecuting && (
              <span class="animate-pulse text-warning text-s absolute">
                &#9679;
              </span>
            )}
            {isModified() && !tab.isExecuting && (
              <span class="modified-dot absolute" title="Unsaved changes" />
            )}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                props.requestSingleTabClose(tab.id);
              }}
              class={`tab-close-btn relative flex items-center justify-center rounded hover:bg-surface-active text-text-muted hover:text-text cursor-pointer ${isActive() ? "active" : ""}`}
            >
              <i class="fa-solid fa-xmark text-s" />
            </button>
          </div>
        </div>
        {showDropAfter(index) && <div class="tab-drop-indicator" />}
        {tab.pinned &&
          index === props.pinnedCount - 1 &&
          props.pinnedCount < props.tabs.length && <div class="pin-divider" />}
      </div>
    );
  }

  function renderGroupHeader(group: TabGroup, firstMemberIndex: number) {
    const memberCount = () =>
      props.tabs.filter((tab) => tab.groupId === group.id).length;
    const collapsed = () => groupCollapsed(group.id);

    return (
      <div
        class={`tab-group-header ${renamingGroupId() === group.id ? "renaming" : ""}`}
        style={groupColorStyle(group.color)}
        onPointerDown={(e) =>
          handleGroupHeaderPointerDown(e, group, firstMemberIndex)
        }
        onClick={() => {
          if (justDraggedRef || renamingGroupId() === group.id) return;
          props.onGroupToggleCollapsed(group.id);
        }}
        onDblClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleStartRenameGroup(group);
        }}
        onContextMenu={(e) => handleGroupContextMenu(e, group.id)}
      >
        {renamingGroupId() === group.id ? (
          <input
            ref={renameInputRef}
            type="text"
            name="group-title"
            autocomplete="off"
            aria-label="Rename group"
            value={renameValue()}
            onInput={(e) => setRenameValue(e.currentTarget.value)}
            onBlur={() => handleRenameGroup(group.id)}
            onKeyDown={(e) => handleRenameKeyDown(e, "group", group.id)}
            class="tab-rename-input"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <Tooltip content={group.name} placement="bottom" class="min-w-0">
              <span class="tab-group-title">{group.name}</span>
            </Tooltip>
            <Show when={collapsed()}>
              <span class="tab-group-count">{memberCount()}</span>
            </Show>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        ref={props.setTabBarRef}
        data-editor-tab-bar="true"
        on:mousedown={(e: MouseEvent) => {
          if (e.button === 1) e.preventDefault();
        }}
        role="tablist"
        class="flex overflow-x-auto overflow-y-hidden tab-bar min-w-0 h-full"
        onContextMenu={handleTabBarContextMenu}
      >
        <For each={tabBarSegments()}>
          {(segment) => {
            if (segment.kind === "tab") {
              return renderTab(segment.tab, segment.index);
            }

            const group = segment.group;
            const members = segment.members;
            const collapsed = () => groupCollapsed(group.id);
            const firstMemberIndex = members[0]?.index ?? 0;

            return (
              <div
                class={`tab-group flex flex-shrink-0 ${
                  collapsed()
                    ? "tab-group-collapsed items-center"
                    : "items-stretch"
                }`}
                style={groupColorStyle(group.color)}
              >
                {renderGroupHeader(group, firstMemberIndex)}
                <Show when={!collapsed()}>
                  <For each={members}>
                    {(member) => renderTab(member.tab, member.index)}
                  </For>
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      <Show when={tabContextMenu()?.visible}>
        <ContextMenu
          items={getTabContextMenuItems(tabContextMenu()!.tabId)}
          x={tabContextMenu()!.x}
          y={tabContextMenu()!.y}
          onClose={() => setTabContextMenu(null)}
        />
      </Show>

      <Show when={tabBarContextMenu()?.visible}>
        <ContextMenu
          items={getTabBarContextMenuItems()}
          x={tabBarContextMenu()!.x}
          y={tabBarContextMenu()!.y}
          onClose={() => setTabBarContextMenu(null)}
        />
      </Show>

      <Show when={groupContextMenu()?.visible}>
        <ContextMenu
          items={getGroupContextMenuItems(groupContextMenu()!.groupId)}
          x={groupContextMenu()!.x}
          y={groupContextMenu()!.y}
          onClose={() => setGroupContextMenu(null)}
        />
      </Show>

      <Show when={collapsedGroupMenu()?.visible}>
        <ContextMenu
          items={getCollapsedGroupMenuItems(collapsedGroupMenu()!.groupId)}
          x={collapsedGroupMenu()!.x}
          y={collapsedGroupMenu()!.y}
          onClose={() => setCollapsedGroupMenu(null)}
        />
      </Show>
    </>
  );
}
