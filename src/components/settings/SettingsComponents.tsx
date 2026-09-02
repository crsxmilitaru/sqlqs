import { Show, For, createSignal, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import type { ThemeOption } from "../../lib/theme";
import type { SavedConnection } from "../../lib/types";
import {
  getAppShortcutCategories,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "../../lib/shortcuts";
import {
  getGoBackShortcutLabel,
  getGoForwardShortcutLabel,
} from "../../lib/editor-navigation";
import { Icon } from "../ui/Icons";
import Input from "../ui/Input";
import Dropdown from "../ui/Dropdown";
import Tooltip from "../ui/Tooltip";

export function SettingsNavButtons(props: {
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  class?: string;
}) {
  return (
    <div class={`flex items-center gap-1 ${props.class ?? ""}`}>
      <Tooltip content={`Go Back (${getGoBackShortcutLabel()})`} placement="bottom">
        <button
          type="button"
          aria-label="Go Back"
          onClick={props.onGoBack}
          disabled={!props.canGoBack}
          class="control-icon-btn"
        >
          <Icon name="arrow-left" class="text-s" />
        </button>
      </Tooltip>
      <Tooltip content={`Go Forward (${getGoForwardShortcutLabel()})`} placement="bottom">
        <button
          type="button"
          aria-label="Go Forward"
          onClick={props.onGoForward}
          disabled={!props.canGoForward}
          class="control-icon-btn"
        >
          <Icon name="arrow-right" class="text-s" />
        </button>
      </Tooltip>
    </div>
  );
}

export function SettingsSection(props: { children: JSX.Element; class?: string }) {
  return <div class={`settings-section ${props.class ?? ""}`}>{props.children}</div>;
}

export function SettingTitle(props: { title: string; description: JSX.Element }) {
  return (
    <div>
      <h4 class="text-m font-medium text-text">{props.title}</h4>
      <p class="text-s text-text-muted mt-0.5">{props.description}</p>
    </div>
  );
}

export function ResetButton(props: {
  onReset: () => void;
  defaultValueLabel?: string;
  class?: string;
}) {
  const tooltipContent = () =>
    props.defaultValueLabel !== undefined
      ? `Reset to default (${props.defaultValueLabel})`
      : "Reset to default";

  return (
    <Tooltip content={tooltipContent()} placement="top">
      <button
        type="button"
        onClick={props.onReset}
        aria-label={tooltipContent()}
        class={`text-text-muted hover:text-accent p-1.5 transition-colors text-s rounded-md hover:bg-surface-active cursor-pointer leading-none flex items-center justify-center shrink-0 ${props.class ?? ""}`}
      >
        <Icon name="rotate-left" class="text-xs" />
      </button>
    </Tooltip>
  );
}

export function SettingContainer(props: {
  isModified?: boolean;
  onReset?: () => void;
  defaultValueLabel?: string;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <div class="relative flex items-center w-full">
      <Show when={props.isModified && props.onReset}>
        <div class="absolute right-[calc(100%+10px)] top-1/2 -translate-y-1/2 flex items-center justify-center">
          <ResetButton
            onReset={props.onReset!}
            defaultValueLabel={props.defaultValueLabel}
          />
        </div>
      </Show>
      <div
        class={`settings-section flex-1 min-w-0 ${
          props.isModified ? "is-modified" : ""
        } ${props.class ?? ""}`}
      >
        {props.children}
      </div>
    </div>
  );
}

export function ToggleSetting(props: {
  title: string;
  description: JSX.Element;
  checked: boolean;
  onToggle: () => void;
  defaultValue?: boolean;
  onReset?: () => void;
}) {
  const isModified = () =>
    props.defaultValue !== undefined && props.checked !== props.defaultValue;

  const handleReset = () => {
    if (props.onReset) {
      props.onReset();
    } else if (props.defaultValue !== undefined && props.checked !== props.defaultValue) {
      props.onToggle();
    }
  };

  return (
    <SettingContainer
      isModified={isModified()}
      onReset={handleReset}
      defaultValueLabel={props.defaultValue ? "On" : "Off"}
    >
      <div class="flex items-center justify-between gap-4">
        <SettingTitle title={props.title} description={props.description} />
        <button
          type="button"
          onClick={props.onToggle}
          class="settings-toggle shrink-0"
          data-checked={props.checked}
          aria-label={props.title}
          aria-pressed={props.checked}
        />
      </div>
    </SettingContainer>
  );
}

export function RangeSetting(props: {
  title: string;
  description: JSX.Element;
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  valueLabel?: JSX.Element;
  onInput: (value: number) => void;
}) {
  const valueLabel = () => props.valueLabel ?? props.value;
  const isModified = createMemo(() => props.value !== props.defaultValue);

  return (
    <SettingContainer
      isModified={isModified()}
      onReset={() => props.onInput(props.defaultValue)}
      defaultValueLabel={String(props.defaultValue)}
    >
      <div class="flex items-center justify-between mb-3">
        <SettingTitle title={props.title} description={props.description} />
        <span class="text-m font-medium text-accent tabular-nums">
          {valueLabel()}
        </span>
      </div>
      <input
        type="range"
        name={props.name}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={(event) =>
          props.onInput(Number.parseInt(event.currentTarget.value, 10))
        }
        class="settings-range"
      />
      <div class="flex justify-between text-s text-text-muted mt-2 select-none">
        <span>{props.min}</span>
        <span>{props.max}</span>
      </div>
    </SettingContainer>
  );
}

export function DropdownSetting<T extends string>(props: {
  title: string;
  description: JSX.Element;
  value: T;
  defaultValue?: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  onReset?: () => void;
  disabled?: boolean;
  minWidth?: string;
  children?: JSX.Element;
}) {
  const isModified = () =>
    props.defaultValue !== undefined && props.value !== props.defaultValue;

  const defaultOptionLabel = () => {
    if (props.defaultValue === undefined) return undefined;
    const matched = props.options.find((o) => o.value === props.defaultValue);
    return matched?.label ?? props.defaultValue;
  };

  const handleReset = () => {
    if (props.onReset) {
      props.onReset();
    } else if (props.defaultValue !== undefined) {
      props.onChange(props.defaultValue);
    }
  };

  return (
    <SettingContainer
      isModified={isModified()}
      onReset={handleReset}
      defaultValueLabel={defaultOptionLabel()}
    >
      <div class="flex items-center justify-between gap-4">
        <div classList={{ "opacity-50": props.disabled }}>
          <SettingTitle title={props.title} description={props.description} />
        </div>
        <div class={`shrink-0 ${props.minWidth ?? "min-w-[160px]"}`}>
          <Dropdown
            value={props.value}
            options={props.options}
            disabled={props.disabled}
            onChange={(val) => props.onChange(val as T)}
          />
        </div>
      </div>
      {props.children}
    </SettingContainer>
  );
}

export function NumberInputSetting(props: {
  title: string;
  description: JSX.Element;
  name: string;
  value: number;
  defaultValue: number;
  min?: string;
  max?: string;
  onInput: (value: number) => void;
  onReset?: () => void;
}) {
  const isModified = () => props.value !== props.defaultValue;

  return (
    <SettingContainer
      isModified={isModified()}
      onReset={() =>
        props.onReset ? props.onReset() : props.onInput(props.defaultValue)
      }
      defaultValueLabel={String(props.defaultValue)}
    >
      <div class="flex items-center justify-between gap-4">
        <SettingTitle title={props.title} description={props.description} />
        <div class="w-[120px] shrink-0">
          <Input
            type="number"
            name={props.name}
            min={props.min ?? "0"}
            max={props.max}
            value={String(props.value)}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value;
              const n = Number.parseInt(raw, 10);
              const minVal = props.min !== undefined ? Number.parseInt(props.min, 10) : 0;
              const maxVal = props.max !== undefined ? Number.parseInt(props.max, 10) : Infinity;
              const min = Number.isFinite(minVal) ? minVal : 0;
              const max = Number.isFinite(maxVal) ? maxVal : Infinity;
              const safe = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
              props.onInput(safe);
            }}
          />
        </div>
      </div>
    </SettingContainer>
  );
}

function themeColor(theme: ThemeOption, key: string): string {
  return theme.colors[key] ?? "transparent";
}

function themePreviewMix(
  theme: ThemeOption,
  key: string,
  amount: number,
): string {
  return `color-mix(in srgb, ${themeColor(theme, key)} ${amount}%, transparent)`;
}

export function ThemeCard(props: {
  theme: ThemeOption;
  selected: boolean;
  custom?: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      props.onSelect();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={handleKeyDown}
      aria-pressed={props.selected}
      class={`settings-theme-card ${props.selected ? "is-selected" : ""}`}
    >
      <div class="font-medium text-m flex items-center justify-between">
        <span class="truncate">
          {props.theme.name}
        </span>
        <Show when={props.selected}>
          <Icon name="check" class="text-accent text-s ml-1" />
        </Show>
      </div>
      <div
        class="settings-theme-preview"
        style={{
          "background-color": themeColor(props.theme, "--color-surface-panel"),
        }}
      >
        <div
          class="w-10 h-full border-r border-border/30"
          style={{ "background-color": themeColor(props.theme, "--color-surface") }}
        />
        <div class="flex-1 p-2 flex flex-col gap-1.5 relative">
          <div
            class="h-1.5 w-1/2 rounded-full"
            style={{
              "background-color": themePreviewMix(props.theme, "--color-text", 9),
            }}
          />
          <div
            class="h-1.5 w-3/4 rounded-full"
            style={{
              "background-color": themePreviewMix(props.theme, "--color-text", 5),
            }}
          />
          <div
            class="absolute bottom-2 right-2 w-3 h-3 rounded-full"
            style={{ "background-color": themeColor(props.theme, "--color-accent") }}
          />
        </div>
      </div>
      <Show when={props.custom}>
        <div class="flex items-center justify-end gap-1.5 pt-1">
          <Tooltip content="Edit" placement="top">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onEdit?.();
              }}
              class="btn btn-secondary px-2 py-1.5"
              aria-label={`Edit ${props.theme.name}`}
            >
              <Icon name="pen" class="text-s" />
            </button>
          </Tooltip>
          <Tooltip content="Delete" placement="top">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onDelete?.();
              }}
              class="btn btn-secondary px-2 py-1.5 text-error"
              aria-label={`Delete ${props.theme.name}`}
            >
              <Icon name="trash" class="text-s" />
            </button>
          </Tooltip>
        </div>
      </Show>
    </div>
  );
}

export function ConnectionRow(props: {
  connection: SavedConnection;
  summary: string;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div class="settings-connection-row">
      <div class="flex flex-col gap-0.5 min-w-0 flex-1">
        <span class="text-m font-medium text-text truncate">
          {props.connection.name}
        </span>
        <span class="text-s text-text-muted truncate">{props.summary}</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onMoveUp}
          disabled={props.index === 0}
          aria-label={`Move ${props.connection.name} up`}
          class="btn btn-secondary px-2 py-1.5 disabled:opacity-30"
        >
          <Icon name="arrow-up" class="text-s" />
        </button>
        <button
          type="button"
          onClick={props.onMoveDown}
          disabled={props.index === props.total - 1}
          aria-label={`Move ${props.connection.name} down`}
          class="btn btn-secondary px-2 py-1.5 disabled:opacity-30"
        >
          <Icon name="arrow-down" class="text-s" />
        </button>
        <button
          type="button"
          onClick={props.onEdit}
          aria-label={`Edit ${props.connection.name}`}
          class="btn btn-secondary px-2 py-1.5"
        >
          <Icon name="pen" class="text-s" />
        </button>
        <button
          type="button"
          onClick={props.onDelete}
          aria-label={`Delete ${props.connection.name}`}
          class="btn btn-secondary px-2 py-1.5 text-error"
        >
          <Icon name="trash" class="text-s" />
        </button>
      </div>
    </div>
  );
}

function ShortcutKeyBadge(props: { keys: string }) {
  if (props.keys.includes("…") || props.keys.includes(" / ")) {
    return <kbd class="font-sans text-3xs">{props.keys}</kbd>;
  }

  const parts = () => props.keys.split("+");

  return (
    <span class="inline-flex items-center gap-0.5">
      <For each={parts()}>
        {(part, index) => (
          <>
            {index() > 0 && (
              <span class="text-text-muted/50 text-3xs select-none">+</span>
            )}
            <kbd class="font-sans text-3xs">{part}</kbd>
          </>
        )}
      </For>
    </span>
  );
}

function ShortcutKeys(props: { keys: string[] }) {
  return (
    <span class="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
      <For each={props.keys}>
        {(keys, index) => (
          <>
            {index() > 0 && (
              <span class="text-text-muted/60 text-3xs select-none">or</span>
            )}
            <ShortcutKeyBadge keys={keys} />
          </>
        )}
      </For>
    </span>
  );
}

function ShortcutRow(props: { shortcut: ShortcutDefinition }) {
  return (
    <div class="settings-about-row">
      <span class="text-m text-text-muted">{props.shortcut.label}</span>
      <ShortcutKeys keys={props.shortcut.keys} />
    </div>
  );
}

function shortcutMatches(
  category: ShortcutCategory,
  shortcut: ShortcutDefinition,
  tokens: string[],
): boolean {
  const haystack =
    `${category.title} ${shortcut.label} ${shortcut.keys.join(" ")}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function ShortcutsReference(props: { isPreviewBuild: boolean }) {
  const [query, setQuery] = createSignal("");
  const categories = () => getAppShortcutCategories(props.isPreviewBuild);

  const searchTokens = createMemo(() =>
    query().toLowerCase().split(/\s+/).filter(Boolean),
  );

  const filteredCategories = createMemo(() => {
    const tokens = searchTokens();
    if (tokens.length === 0) return categories();

    return categories()
      .map((category) => ({
        ...category,
        shortcuts: category.shortcuts.filter((shortcut) =>
          shortcutMatches(category, shortcut, tokens),
        ),
      }))
      .filter((category) => category.shortcuts.length > 0);
  });

  return (
    <div class="space-y-5">
      <div class="relative">
        <Icon name="magnifying-glass" class="settings-search-icon" />
        <Input
          type="search"
          name="shortcuts-search"
          value={query()}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query()) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Search shortcuts…"
          class="pl-8"
          spellcheck={false}
          autocomplete="off"
          aria-label="Search shortcuts"
        />
      </div>
      <Show
        when={filteredCategories().length > 0}
        fallback={
          <SettingsSection>
            <p class="text-m text-text-muted text-center py-4">
              No shortcuts match your search.
            </p>
          </SettingsSection>
        }
      >
        <For each={filteredCategories()}>
          {(category) => (
            <SettingsSection>
              <h4 class="text-m font-medium text-text mb-3">{category.title}</h4>
              <div class="space-y-2">
                <For each={category.shortcuts}>
                  {(shortcut) => <ShortcutRow shortcut={shortcut} />}
                </For>
              </div>
            </SettingsSection>
          )}
        </For>
      </Show>
    </div>
  );
}
