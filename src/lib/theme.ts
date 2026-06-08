import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  Effect,
  EffectState,
  getCurrentWindow,
  type Theme as WindowTheme,
} from "@tauri-apps/api/window";
import dark from "../themes/dark.json";
import oled from "../themes/oled.json";
import midnight from "../themes/midnight.json";
import dracula from "../themes/dracula.json";
import light from "../themes/light.json";
import softLight from "../themes/soft-light.json";

export type ThemeMode = "light" | "dark";

export interface ThemeOption {
  id: string;
  name: string;
  mode?: ThemeMode;
  colors: {
    [key: string]: string;
  };
}

export interface ThemeSelection {
  id: string;
  mode: ThemeMode;
}

export interface ThemeColorField {
  key: string;
  label: string;
  desc: string;
}

const LIGHT_THEMES = new Set(["light", "soft-light"]);

export const THEMES: ThemeOption[] = [
  dark,
  oled,
  midnight,
  dracula,
  light,
  softLight,
] as ThemeOption[];

export const EDITABLE_THEME_COLOR_FIELDS: ThemeColorField[] = [
  {
    key: "--color-surface",
    label: "Surface Background",
    desc: "Main app background",
  },
  {
    key: "--color-surface-panel",
    label: "Surface Panel",
    desc: "Sidebar and panels background",
  },
  { key: "--color-text", label: "Text Color", desc: "Primary text color" },
  {
    key: "--color-accent",
    label: "Accent Color",
    desc: "Action buttons, highlights and focus states",
  },
  {
    key: "--color-accent-text",
    label: "Accent Text Color",
    desc: "Text color inside accent elements",
  },
  {
    key: "--color-success",
    label: "Success Color",
    desc: "Success tags and message labels",
  },
  {
    key: "--color-error",
    label: "Error Color",
    desc: "Alert dialogs and destructive elements",
  },
  {
    key: "--color-warning",
    label: "Warning Color",
    desc: "Warning states and labels",
  },
];

const THEME_COLOR_KEYS = EDITABLE_THEME_COLOR_FIELDS.map((field) => field.key);

const customThemesRegistry = new Map<string, ThemeOption>();

export function registerCustomThemes(customThemes: ThemeOption[]) {
  customThemesRegistry.clear();
  for (const t of customThemes) {
    customThemesRegistry.set(t.id, t);
  }
}

function resolveTheme(themeId: string): ThemeOption {
  if (customThemesRegistry.has(themeId)) {
    return customThemesRegistry.get(themeId)!;
  }
  if (themeId && !THEMES.some((t) => t.id === themeId)) {
    const cachedData = localStorage.getItem("active_custom_theme_data");
    if (cachedData) {
      try {
        const theme = JSON.parse(cachedData) as ThemeOption;
        if (theme && theme.id === themeId) {
          return theme;
        }
      } catch {}
    }
  }
  return THEMES.find((theme) => theme.id === themeId) || THEMES[0];
}

function resolveWindowTheme(theme: ThemeOption): WindowTheme {
  if (theme.mode) {
    return theme.mode;
  }
  return LIGHT_THEMES.has(theme.id) ? "light" : "dark";
}

export function getThemeMode(themeId: string): ThemeMode {
  return resolveWindowTheme(resolveTheme(themeId));
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

  for (const key of THEME_COLOR_KEYS) {
    root.style.removeProperty(key);
  }

  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(key, value);
  }

  const windowTheme = resolveWindowTheme(theme);
  root.dataset.themeMode = windowTheme;
  root.style.colorScheme = windowTheme;
  void syncWindowTheme(windowTheme);
}

export function saveTheme(themeId: string, customThemeData?: ThemeOption) {
  if (customThemeData) {
    localStorage.setItem("active_custom_theme_data", JSON.stringify(customThemeData));
    customThemesRegistry.set(customThemeData.id, customThemeData);
    localStorage.setItem("app_theme", customThemeData.id);
    applyTheme(customThemeData.id);
  } else {
    const theme = resolveTheme(themeId);
    localStorage.setItem("app_theme", theme.id);
    applyTheme(theme.id);
  }
}

export function loadTheme() {
  const savedId = localStorage.getItem("app_theme") || "dark";
  const theme = resolveTheme(savedId);
  applyTheme(theme.id);
  return { id: theme.id, mode: resolveWindowTheme(theme) };
}
