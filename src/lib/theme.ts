import { invoke, isTauri } from "@tauri-apps/api/core";
import { Effect, EffectState, getCurrentWindow, type Theme as WindowTheme } from "@tauri-apps/api/window";
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

const LIGHT_THEMES = new Set(["light", "soft-light"]);

export const THEMES: ThemeOption[] = [
  dark,
  oled,
  midnight,
  dracula,
  light,
  softLight
] as ThemeOption[];

function resolveTheme(themeId: string): ThemeOption {
  return THEMES.find((theme) => theme.id === themeId) || THEMES[0];
}

function resolveWindowTheme(themeId: string): WindowTheme {
  return LIGHT_THEMES.has(themeId) ? "light" : "dark";
}

async function syncWindowTheme(windowTheme: WindowTheme) {
  if (!isTauri()) {
    return;
  }

  const win = getCurrentWindow();
  const dark = windowTheme === "dark";

  await win.setTheme(windowTheme).catch(() => undefined);
  await invoke("set_mica_theme", { dark }).catch(() => undefined);
  await win
    .setEffects({ effects: [Effect.Mica], state: EffectState.Active })
    .catch(() => undefined);
}

export function applyTheme(themeId: string) {
  const theme = resolveTheme(themeId);

  const root = document.documentElement;

  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }

  const windowTheme = resolveWindowTheme(theme.id);
  root.dataset.themeMode = windowTheme;
  root.style.colorScheme = windowTheme;
  void syncWindowTheme(windowTheme);
}

export function saveTheme(themeId: string) {
  const theme = resolveTheme(themeId);
  localStorage.setItem("app_theme", theme.id);
  applyTheme(theme.id);
}

export function loadTheme() {
  const theme = resolveTheme(localStorage.getItem("app_theme") || "dark");
  applyTheme(theme.id);
  return { id: theme.id };
}
