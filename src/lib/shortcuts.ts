import { getModifierKeyLabel } from "./platform";

export interface ShortcutDefinition {
  label: string;
  keys: string[];
}

export interface ShortcutCategory {
  title: string;
  shortcuts: ShortcutDefinition[];
}

export function getAppShortcutCategories(isPreviewBuild: boolean): ShortcutCategory[] {
  const mod = getModifierKeyLabel();
  const categories: ShortcutCategory[] = [
    {
      title: "General",
      shortcuts: [
        { label: "Open SQL file", keys: [`${mod}+O`] },
        { label: "Save query tab", keys: [`${mod}+S`] },
        { label: "Open settings", keys: [`${mod}+,`] },
        {
          label: "Search database objects",
          keys: [`${mod}+P`, `${mod}+Shift+F`],
        },
        { label: "Close dialog", keys: ["Esc"] },
      ],
    },
    {
      title: "Query editor",
      shortcuts: [
        { label: "Execute query", keys: ["F5", `${mod}+Enter`] },
        { label: "Format SQL", keys: ["Alt+Shift+F"] },
        { label: "Find in editor", keys: [`${mod}+F`] },
        { label: "Find next", keys: [`${mod}+G`] },
        { label: "Move line up", keys: ["Alt+↑"] },
        { label: "Move line down", keys: ["Alt+↓"] },
        { label: "Undo", keys: [`${mod}+Z`] },
        { label: "Redo", keys: [`${mod}+Shift+Z`, `${mod}+Y`] },
        { label: "Cut", keys: [`${mod}+X`] },
        { label: "Copy", keys: [`${mod}+C`] },
        { label: "Paste", keys: [`${mod}+V`] },
        { label: "Select all", keys: [`${mod}+A`] },
      ],
    },
    {
      title: "Tabs",
      shortcuts: [
        { label: "New tab", keys: [`${mod}+T`] },
        { label: "Close tab", keys: [`${mod}+W`] },
        { label: "Reopen closed tab", keys: [`${mod}+Shift+T`] },
        { label: "Select multiple tabs", keys: [`${mod}+Click`, "Shift+Click"] },
        { label: "Group selected tabs", keys: [`${mod}+Shift+G`] },
        { label: "Switch to tab 1–9", keys: [`${mod}+1 … ${mod}+9`] },
        { label: "Next tab", keys: [`${mod}+Page Down`] },
        { label: "Previous tab", keys: [`${mod}+Page Up`] },
      ],
    },
    {
      title: "Results grid",
      shortcuts: [
        { label: "Cut", keys: [`${mod}+X`] },
        { label: "Copy", keys: [`${mod}+C`] },
        { label: "Paste", keys: [`${mod}+V`] },
        { label: "Select all", keys: [`${mod}+A`] },
      ],
    },
    {
      title: "Object search",
      shortcuts: [
        { label: "Navigate results", keys: ["↑ / ↓"] },
        { label: "Expand actions", keys: ["Enter / →"] },
        { label: "Collapse actions", keys: ["←"] },
        { label: "Focus filters", keys: ["Tab"] },
        { label: "Close", keys: ["Esc"] },
      ],
    },
    {
      title: "AI chat",
      shortcuts: [
        { label: "Send message", keys: ["Enter"] },
        { label: "New line", keys: ["Shift+Enter"] },
      ],
    },
    {
      title: "Chat history",
      shortcuts: [
        { label: "Navigate conversations", keys: ["↑ / ↓"] },
        { label: "Open conversation", keys: ["Enter"] },
        { label: "Delete conversation", keys: ["Del"] },
        { label: "Close", keys: ["Esc"] },
      ],
    },
  ];

  if (isPreviewBuild) {
    categories.push({
      title: "Developer",
      shortcuts: [
        {
          label: "Toggle developer tools",
          keys: ["F12", `${mod}+Shift+I`],
        },
      ],
    });
  }

  return categories;
}
