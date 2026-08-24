import type { TabGroupColor } from "./types";

export const TAB_GROUP_COLORS: TabGroupColor[] = [
  "blue",
  "cyan",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
];

export const TAB_GROUP_COLOR_VARS: Record<TabGroupColor, string> = {
  blue: "--color-tab-group-blue",
  cyan: "--color-tab-group-cyan",
  green: "--color-tab-group-green",
  yellow: "--color-tab-group-yellow",
  orange: "--color-tab-group-orange",
  red: "--color-tab-group-red",
  purple: "--color-tab-group-purple",
};

export function groupColorStyle(color: TabGroupColor): Record<string, string> {
  return { "--group-color": `var(${TAB_GROUP_COLOR_VARS[color]})` };
}

export function nextGroupColor(existing: TabGroupColor[]): TabGroupColor {
  const used = new Set(existing);
  const available = TAB_GROUP_COLORS.find((color) => !used.has(color));
  return available ?? TAB_GROUP_COLORS[existing.length % TAB_GROUP_COLORS.length];
}

export function defaultGroupName(index: number): string {
  return `Group ${index}`;
}
