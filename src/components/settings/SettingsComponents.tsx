import { Show, For } from "solid-js";
import type { JSX } from "solid-js";
import type { ThemeOption } from "../../lib/theme";
import type { SavedConnection } from "../../lib/types";
import {
  getAppShortcutCategories,
  type ShortcutDefinition,
} from "../../lib/shortcuts";
import { Icon } from "../ui/Icons";

export function SettingsSection(props: { children: JSX.Element }) {
  return <div class="settings-section">{props.children}</div>;
}

export function SettingTitle(props: { title: string; description: JSX.Element }) {
  return (
    <div>
      <h4 class="text-m font-medium text-text">{props.title}</h4>
      <p class="text-s text-text-muted mt-0.5">{props.description}</p>
    </div>
  );
}

export function ToggleSetting(props: {
  title: string;
  description: JSX.Element;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <SettingsSection>
      <div class="flex items-center justify-between">
        <SettingTitle title={props.title} description={props.description} />
        <button
          type="button"
          onClick={props.onToggle}
          class="settings-toggle"
          data-checked={props.checked}
          aria-label={props.title}
          aria-pressed={props.checked}
        />
      </div>
    </SettingsSection>
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

  return (
    <SettingsSection>
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
      <div class="flex justify-between text-s text-text-muted mt-2">
        <span>{props.min}</span>
        <span>{props.defaultValue} (default)</span>
        <span>{props.max}</span>
      </div>
    </SettingsSection>
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
        <span class={props.custom ? "truncate pr-16" : ""}>
          {props.theme.name}
        </span>
        <div class="flex items-center gap-2">
          <Show when={props.custom}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onEdit?.();
              }}
              class="text-text-muted hover:text-text p-1 transition-colors"
              aria-label={`Edit ${props.theme.name}`}
            >
              <Icon name="pen" class="text-s" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onDelete?.();
              }}
              class="text-text-muted hover:text-error p-1 transition-colors"
              aria-label={`Delete ${props.theme.name}`}
            >
              <Icon name="trash" class="text-s" />
            </button>
          </Show>
          <Show when={props.selected}>
            <Icon name="check" class="text-accent text-s ml-1" />
          </Show>
        </div>
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

export function ShortcutsReference(props: { isPreviewBuild: boolean }) {
  const categories = () => getAppShortcutCategories(props.isPreviewBuild);

  return (
    <div class="space-y-5">
      <For each={categories()}>
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
    </div>
  );
}
