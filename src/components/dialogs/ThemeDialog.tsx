import { createSignal, onMount, For, Index } from "solid-js";
import {
  EDITABLE_THEME_COLOR_FIELDS,
  getDefaultThemeForMode,
  resolveTabColors,
  type ThemeMode,
  type ThemeOption,
} from "../../lib/theme";
import Input from "../ui/Input";
import Dropdown from "../ui/Dropdown";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";

interface Props {
  onClose: () => void;
  onSave: (theme: ThemeOption) => void | Promise<void>;
  editTheme?: ThemeOption;
  activeThemeColors?: Record<string, string>;
  activeThemeTabColors?: string[];
  activeThemeMode?: ThemeMode;
}

function parseToHex(color: string): string {
  if (!color) return "#000000";
  const trimmed = color.trim().toLowerCase();

  if (trimmed.startsWith("#")) {
    if (trimmed.length === 4) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (trimmed.length >= 7) {
      return trimmed.slice(0, 7);
    }
  }

  if (trimmed.startsWith("rgb")) {
    const match = trimmed.match(/\d+/g);
    if (match && match.length >= 3) {
      const r = parseInt(match[0], 10);
      const g = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      const hex = (x: number) => {
        const h = x.toString(16);
        return h.length === 1 ? "0" + h : h;
      };
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    }
  }

  return "#000000";
}

export default function ThemeDialog(props: Props) {
  const [name, setName] = createSignal("");
  const [mode, setMode] = createSignal<ThemeMode>("dark");
  const [colors, setColors] = createSignal<Record<string, string>>({});
  const [tabColors, setTabColors] = createSignal<string[]>([]);
  const [error, setError] = createSignal("");
  const [visible, setVisible] = createSignal(false);

  const applyBaseMode = (newMode: ThemeMode) => {
    setMode(newMode);
    const baseTheme = getDefaultThemeForMode(newMode);
    const nextColors: Record<string, string> = {};
    for (const field of EDITABLE_THEME_COLOR_FIELDS) {
      nextColors[field.key] = baseTheme.colors[field.key] || "#000000";
    }
    setColors(nextColors);
    setTabColors(resolveTabColors(baseTheme));
  };

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));

    if (props.editTheme) {
      setName(props.editTheme.name);
      setMode(props.editTheme.mode || "dark");
      setColors({ ...props.editTheme.colors });
      setTabColors(resolveTabColors(props.editTheme));
    } else {
      const currentMode = props.activeThemeMode ?? "dark";
      applyBaseMode(currentMode);
      if (props.activeThemeColors) {
        setColors((prev) => ({ ...prev, ...props.activeThemeColors }));
      }
      if (props.activeThemeTabColors && props.activeThemeTabColors.length > 0) {
        setTabColors([...props.activeThemeTabColors]);
      }
    }
  });

  const handleTabColorChange = (index: number, val: string) => {
    setTabColors((prev) => {
      const next = [...prev];
      next[index] = val;
      return next;
    });
  };

  const handleSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    setError("");

    const trimmedName = name().trim();
    if (!trimmedName) {
      setError("Theme name is required.");
      return;
    }

    const id = props.editTheme?.id || "custom-" + trimmedName.toLowerCase().replace(/[^a-z0-9_-]/g, "-") + "-" + Date.now();

    const newTheme: ThemeOption = {
      id,
      name: trimmedName,
      mode: mode(),
      colors: { ...colors() },
      tabColors: [...tabColors()],
    };

    props.onSave(newTheme);
  };

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[540px] max-w-[calc(100vw-32px)] shadow-2xl"
      ariaLabel={props.editTheme ? "Edit Theme" : "Create Theme"}
    >
      <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs bg-transparent">
        <h2 class="text-m font-semibold text-text">
          {props.editTheme ? "Edit Theme" : "Create Theme"}
        </h2>
        <DialogCloseButton onClick={props.onClose} />
      </div>

      <form onSubmit={handleSubmit} class="p-6 flex flex-col gap-4">
        <div class="flex gap-4">
          <div class="flex-1 flex flex-col gap-1.5 min-w-0">
            <label class="text-s font-medium text-text-muted select-none">
              Theme Name
            </label>
            <Input
              name="theme-name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="My Custom Theme"
              required
              autofocus
            />
          </div>
          <div class="w-[140px] flex flex-col gap-1.5 shrink-0">
            <label class="text-s font-medium text-text-muted select-none">
              Base Mode
            </label>
            <Dropdown
              value={mode()}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              onChange={(val) => applyBaseMode(val as ThemeMode)}
            />
          </div>
        </div>

        <div class="border-t border-border pt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          <For each={EDITABLE_THEME_COLOR_FIELDS}>
            {(field) => {
              const colorValue = () => colors()[field.key] || "";
              const hexValue = () => parseToHex(colorValue());

              return (
                <div class="flex flex-col gap-1 min-w-0">
                  <div class="flex justify-between items-center select-none gap-1">
                    <span class="text-s font-medium text-text-muted truncate">
                      {field.label}
                    </span>
                    <span class="text-[10px] text-text-muted/60 font-mono shrink-0">
                      {field.key}
                    </span>
                  </div>
                  <div class="flex gap-2 items-center w-full">
                    <div class="relative w-8 h-8 rounded-md border border-border overflow-hidden shrink-0 flex items-center justify-center bg-surface-hover">
                      <input
                        type="color"
                        name={`theme-color-${field.key}`}
                        value={hexValue()}
                        onInput={(e) => {
                          const val = e.currentTarget.value;
                          setColors((prev) => ({
                            ...prev,
                            [field.key]: val,
                          }));
                        }}
                        class="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer opacity-0"
                      />
                      <div
                        class="w-5 h-5 rounded-full border border-border/20 shadow-xs"
                        style={{ "background-color": colorValue() }}
                      />
                    </div>
                    <Input
                      name={`theme-color-hex-${field.key}`}
                      value={colorValue()}
                      onInput={(e) => {
                        const val = e.currentTarget.value;
                        setColors((prev) => ({
                          ...prev,
                          [field.key]: val,
                        }));
                      }}
                      placeholder="#000000"
                      class="flex-1 min-w-0 font-mono text-s"
                    />
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <div class="flex flex-col gap-1.5 pt-1">
          <span class="text-s font-medium text-text-muted select-none">
            Group Tabs
          </span>

          <div class="flex items-center justify-between">
            <Index each={tabColors()}>
              {(color, index) => {
                const hexValue = () => parseToHex(color());

                return (
                  <div class="flex flex-col items-center gap-1.5">
                    <div class="relative w-8 h-8 rounded-md border border-border overflow-hidden shrink-0 flex items-center justify-center bg-surface-hover hover:border-accent/40 hover:bg-surface-active transition-colors cursor-pointer">
                      <input
                        type="color"
                        name={`theme-tab-color-${index}`}
                        value={hexValue()}
                        onInput={(e) => {
                          handleTabColorChange(index, e.currentTarget.value);
                        }}
                        class="absolute inset-0 w-full h-full p-0 border-0 cursor-pointer opacity-0"
                        title={color()}
                      />
                      <div
                        class="w-5 h-5 rounded-full border border-border/20 shadow-xs pointer-events-none"
                        style={{ "background-color": color() }}
                      />
                    </div>
                    <input
                      type="text"
                      name={`theme-tab-color-hex-${index}`}
                      value={color()}
                      onInput={(e) => {
                        handleTabColorChange(index, e.currentTarget.value);
                      }}
                      placeholder="#000000"
                      spellcheck={false}
                      class="w-[60px] h-[24px] px-1 text-center text-xs font-mono rounded-md bg-surface-hover border border-border-subtle text-text placeholder-text-muted hover:bg-surface-active hover:border-border-muted focus:border-accent/40 focus:ring-1 focus:ring-accent/20 focus:outline-none transition-colors"
                    />
                  </div>
                );
              }}
            </Index>
          </div>
        </div>

        {error() && (
          <div class="text-error text-m bg-error/10 border border-error/30 rounded-lg px-3 py-2">
            {error()}
          </div>
        )}

        <div class="flex justify-end gap-3 pt-3 border-t border-border mt-1">
          <button
            type="button"
            onClick={props.onClose}
            class="btn btn-secondary px-6 py-1.5"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary px-6 py-1.5"
          >
            Save
          </button>
        </div>
      </form>
    </DialogShell>
  );
}
