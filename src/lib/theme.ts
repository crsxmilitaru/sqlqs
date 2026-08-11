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
const THEME_STORAGE_KEY = "app_theme";
const FOLLOW_SYSTEM_STORAGE_KEY = "app_theme_follow_system";
export const THEME_CHANGED_EVENT = "sqlqs-theme-changed";

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

export function loadFollowSystemTheme(): boolean {
  const raw = localStorage.getItem(FOLLOW_SYSTEM_STORAGE_KEY);
  if (raw === null) {
    return true;
  }
  return raw === "true";
}

export function saveFollowSystemTheme(enabled: boolean) {
  localStorage.setItem(FOLLOW_SYSTEM_STORAGE_KEY, String(enabled));
}

function getSystemThemeMode(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function resolveActiveThemeId(savedId: string, followSystem: boolean): string {
  if (followSystem) {
    return getSystemThemeMode() === "dark" ? "dark" : "light";
  }
  return savedId || "dark";
}

function emitThemeChanged(selection: ThemeSelection) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ThemeSelection>(THEME_CHANGED_EVENT, { detail: selection }),
  );
}

let preferredWindowTheme: WindowTheme = "dark";
let followSystemTheme = loadFollowSystemTheme();
let windowThemeSyncStarted = false;
let lastSyncedWindowTheme: WindowTheme | null = null;

async function applyNativeWindowTheme(windowTheme: WindowTheme) {
  if (!isTauri()) {
    return;
  }

  const win = getCurrentWindow();
  const dark = windowTheme === "dark";
  preferredWindowTheme = windowTheme;

  await win.setTheme(windowTheme).catch(() => undefined);
  await invoke("set_mica_theme", { dark }).catch(() => undefined);
  await win
    .setEffects({ effects: [Effect.Mica], state: EffectState.Active })
    .catch(() => undefined);
}

function ensureWindowThemeSync() {
  if (!isTauri() || windowThemeSyncStarted || typeof window === "undefined") {
    return;
  }

  windowThemeSyncStarted = true;

  const onSystemSchemeChange = () => {
    if (loadFollowSystemTheme()) {
      loadTheme();
      return;
    }
    void applyNativeWindowTheme(preferredWindowTheme);
  };

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onSystemSchemeChange);
  } else {
    media.addListener(onSystemSchemeChange);
  }
}

async function syncWindowTheme(windowTheme: WindowTheme) {
  ensureWindowThemeSync();
  if (lastSyncedWindowTheme === windowTheme) {
    preferredWindowTheme = windowTheme;
    return;
  }
  lastSyncedWindowTheme = windowTheme;
  void applyNativeWindowTheme(windowTheme);
}

export function applyTheme(themeId: string) {
  const theme = resolveTheme(themeId);

  const root = document.documentElement;
  root.dataset.themeId = theme.id;

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

  const selection = { id: theme.id, mode: windowTheme };
  emitThemeChanged(selection);
  return selection;
}

export function saveTheme(themeId: string, customThemeData?: ThemeOption) {
  followSystemTheme = false;
  saveFollowSystemTheme(false);

  if (customThemeData) {
    localStorage.setItem("active_custom_theme_data", JSON.stringify(customThemeData));
    customThemesRegistry.set(customThemeData.id, customThemeData);
    localStorage.setItem(THEME_STORAGE_KEY, customThemeData.id);
    return applyTheme(customThemeData.id);
  }

  const theme = resolveTheme(themeId);
  localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  return applyTheme(theme.id);
}

export function setFollowSystemTheme(enabled: boolean): ThemeSelection {
  followSystemTheme = enabled;
  saveFollowSystemTheme(enabled);

  if (!enabled && !localStorage.getItem(THEME_STORAGE_KEY)) {
    const activeId =
      document.documentElement.dataset.themeId ||
      (getSystemThemeMode() === "dark" ? "dark" : "light");
    localStorage.setItem(THEME_STORAGE_KEY, activeId);
  }

  return loadTheme();
}

export function loadTheme(): ThemeSelection {
  followSystemTheme = loadFollowSystemTheme();
  const savedId = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  const themeId = resolveActiveThemeId(savedId, followSystemTheme);
  return applyTheme(resolveTheme(themeId).id);
}
