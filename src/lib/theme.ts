import dark from "../themes/dark.json";
import oled from "../themes/oled.json";
import midnight from "../themes/midnight.json";
import dracula from "../themes/dracula.json";
import light from "../themes/light.json";
import softLight from "../themes/soft-light.json";

export interface ThemeOption {
  id: string;
  name: string;
  colors: {
    [key: string]: string;
  };
}

export const THEMES: ThemeOption[] = [
  dark,
  oled,
  midnight,
  dracula,
  light,
  softLight
] as ThemeOption[];

export function applyTheme(themeId: string) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];

  const root = document.documentElement;

  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }
}

export function saveTheme(themeId: string) {
  localStorage.setItem("app_theme", themeId);
  applyTheme(themeId);
}

export function loadTheme() {
  const themeId = localStorage.getItem("app_theme") || "dark";
  applyTheme(themeId);
  return { id: themeId };
}
