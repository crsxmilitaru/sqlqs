import { open } from "@tauri-apps/plugin-shell";
import { createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { AiService } from "../lib/ai";
import {
  DEFAULT_MAX_HISTORY,
  loadPreferences,
  MAX_MAX_HISTORY,
  MIN_MAX_HISTORY,
  saveMaxHistoryItems,
  savePersistTabs,
} from "../lib/settings";
import { loadTheme, saveTheme, THEMES } from "../lib/theme";
import type { GeminiStatus, UpdateMessageTone } from "../lib/types";
import Input from "./Input";
import Tooltip from "./Tooltip";

interface Props {
  onClose: () => void;
  version: string | null;
  onCheckForUpdates: () => void | Promise<unknown>;
  checkingForUpdates: boolean;
  updateMessage: string | null;
  updateMessageTone: UpdateMessageTone;
  onThemeChange?: (theme: { id: string }) => void;
  renderLayout?: (sidebar: JSX.Element, content: JSX.Element) => JSX.Element;
}

type Tab = "general" | "appearance" | "ai" | "about";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "fa-solid fa-gear" },
  { id: "appearance", label: "Appearance", icon: "fa-solid fa-palette" },
  { id: "ai", label: "AI", icon: "fa-solid fa-wand-magic-sparkles" },
  { id: "about", label: "About", icon: "fa-solid fa-circle-info" },
];

const REPOSITORY_URL = "https://github.com/crsxmilitaru/sqlqs";

export default function SettingsView(props: Props) {
  const currentTheme = loadTheme();
  const prefs = loadPreferences();
  const [activeTab, setActiveTab] = createSignal<Tab>("general");
  const [themeId, setThemeId] = createSignal(currentTheme.id);
  const [persistTabs, setPersistTabs] = createSignal(prefs.persistTabs);
  const [maxHistory, setMaxHistory] = createSignal(prefs.maxHistoryItems);

  const [geminiStatus, setGeminiStatus] = createSignal<GeminiStatus>({ hasKey: false });
  const [apiKey, setApiKey] = createSignal("");
  const [modelId, setModelId] = createSignal(AiService.getModel());
  const [showApiKey, setShowApiKey] = createSignal(false);
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    requestAnimationFrame(() => setVisible(true));
  });

  onMount(() => {
    AiService.getApiKey().then((key) => {
      if (key) setApiKey(key);
    });
    AiService.getStatus().then(setGeminiStatus);
  });

  const handleSaveAiSettings = async () => {
    await AiService.setApiKey(apiKey());
    AiService.setModel(modelId());
    setGeminiStatus(await AiService.getStatus());
  };

  const updateMessageClass = () =>
    props.updateMessageTone === "error"
      ? "text-error"
      : props.updateMessageTone === "success"
        ? "text-success"
        : "text-text-muted";

  async function handleOpenRepository(event: MouseEvent) {
    event.preventDefault();
    await open(REPOSITORY_URL);
  }

  function handleThemeChange(newThemeId: string) {
    setThemeId(newThemeId);
    saveTheme(newThemeId);
    props.onThemeChange?.({ id: newThemeId });
  }

  const sidebarNode = (
    <>
        <div class="px-3 flex flex-col gap-0.5 overflow-y-auto flex-1 pt-4 pb-4">
            {TABS.map(tab => (
              <button
                onClick={() => setActiveTab(tab.id)}
                class={`settings-nav-btn ${activeTab() === tab.id ? "active" : ""}`}
              >
                <i class={tab.icon} />
                {tab.label}
              </button>
            ))}
          </div>
    </>
  );

  const contentNode = (
    <div class="max-w-3xl w-full mx-auto flex flex-col pb-10">
          {activeTab() === "general" && (
            <div class="flex-1 animate-in fade-in duration-[var(--duration-slow)]">
              <h1 class="text-2xl font-semibold text-text mb-8">General</h1>

                <div class="space-y-5">
                  <div class="settings-section">
                    <div class="flex items-center justify-between">
                      <div>
                        <h4 class="text-m font-medium text-text">Restore tabs on startup</h4>
                        <p class="text-s text-text-muted mt-0.5">Keep your open tabs between app restarts</p>
                      </div>
                      <button
                        onClick={() => {
                          const next = !persistTabs();
                          setPersistTabs(next);
                          savePersistTabs(next);
                        }}
                        class="settings-toggle"
                        data-checked={persistTabs()}
                      />
                    </div>
                  </div>

                  <div class="settings-section">
                    <div class="flex items-center justify-between mb-3">
                      <div>
                        <h4 class="text-m font-medium text-text">History limit</h4>
                        <p class="text-s text-text-muted mt-0.5">Maximum number of queries to keep in history</p>
                      </div>
                      <span class="text-m font-medium text-accent tabular-nums">{maxHistory()}</span>
                    </div>
                    <input
                      type="range"
                      min={MIN_MAX_HISTORY}
                      max={MAX_MAX_HISTORY}
                      step={10}
                      value={maxHistory()}
                      onInput={(e) => {
                        const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
                        setMaxHistory(val);
                        saveMaxHistoryItems(val);
                      }}
                      class="settings-range"
                    />
                    <div class="flex justify-between text-s text-text-muted mt-2">
                      <span>{MIN_MAX_HISTORY}</span>
                      <span>{DEFAULT_MAX_HISTORY} (default)</span>
                      <span>{MAX_MAX_HISTORY}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {activeTab() === "appearance" && (
            <div class="flex-1 animate-in fade-in duration-[var(--duration-slow)]">
              <h1 class="text-2xl font-semibold text-text mb-8">Appearance</h1>

                <div>
                  <h4 class="text-s font-medium text-text-muted uppercase tracking-wider mb-3">Theme</h4>
                  <div class="grid grid-cols-2 gap-2.5">
                    {THEMES.map(theme => (
                      <button
                        onClick={() => handleThemeChange(theme.id)}
                        class={`flex flex-col gap-2 p-3 rounded-lg border transition-all text-left ${themeId() === theme.id
                          ? "border-accent bg-accent/8 ring-1 ring-accent/25"
                          : "border-border bg-surface hover:bg-surface-hover hover:border-overlay-md"
                          }`}
                      >
                        <div class="font-medium text-m flex items-center justify-between">
                          {theme.name}
                          {themeId() === theme.id && <i class="fa-solid fa-check text-accent text-s" />}
                        </div>
                        <div class="flex h-10 w-full rounded-md overflow-hidden border border-border/50" style={{ "background-color": theme.colors["--color-surface-raised"] }}>
                          <div class="w-10 h-full border-r border-border/30" style={{ "background-color": theme.colors["--color-surface"] }} />
                          <div class="flex-1 p-2 flex flex-col gap-1.5 relative">
                            <div class="h-1.5 w-1/2 rounded-full" style={{ "background-color": theme.colors["--color-surface-active"] }} />
                            <div class="h-1.5 w-3/4 rounded-full" style={{ "background-color": theme.colors["--color-surface-hover"] }} />
                            <div class="absolute bottom-2 right-2 w-3 h-3 rounded-full" style={{ "background-color": theme.colors["--color-accent"] }} />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

          {activeTab() === "ai" && (
            <div class="flex-1 animate-in fade-in duration-[var(--duration-slow)]">
              <h1 class="text-2xl font-semibold text-text mb-8">AI Assistant</h1>
                <div class="space-y-5">
                  <div class="settings-section">
                    <div class="flex items-center gap-3 mb-4">
                      <div>
                        <h4 class="text-s font-medium text-text">API Configuration</h4>
                        <p class="text-s text-text-muted mt-0.5">Google Gemini</p>
                      </div>
                      <div class="ml-auto">
                        {geminiStatus().hasKey ? (
                          <span class="px-2.5 py-1 bg-success/10 text-success text-s font-semibold rounded-full border border-success/20">
                            CONFIGURED
                          </span>
                        ) : (
                          <span class="px-2.5 py-1 bg-warning/10 text-warning text-s font-semibold rounded-full border border-warning/20">
                            REQUIRED
                          </span>
                        )}
                      </div>
                    </div>

                    <div class="space-y-3.5">
                      <div>
                        <label class="text-s font-medium text-text-muted block mb-1.5">
                          Gemini Model ID
                        </label>
                        <Input
                          type="text"
                          value={modelId()}
                          onInput={(e) => setModelId((e.target as HTMLInputElement).value)}
                          placeholder="e.g. gemini-3.1-flash-lite-preview"
                        />
                      </div>
                      <div>
                        <label class="text-s font-medium text-text-muted block mb-1.5">
                          Gemini API Key
                        </label>
                        <div class="flex gap-2">
                          <div class="relative flex-1">
                            <Input
                              type={showApiKey() ? "text" : "password"}
                              value={apiKey()}
                              onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
                              placeholder="Paste your API key here..."
                              class="pr-9"
                            />
                            <button
                              onClick={() => setShowApiKey(!showApiKey())}
                              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                            >
                              <i class={`fa-solid ${showApiKey() ? "fa-eye-slash" : "fa-eye"} text-s`} />
                            </button>
                          </div>
                          <button
                            onClick={handleSaveAiSettings}
                            class="btn btn-primary px-4"
                          >
                            Save
                          </button>
                        </div>
                        <p class="text-s text-text-muted mt-2">
                          Get your API key for free at{" "}
                          <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-accent hover:underline"
                            onClick={(e) => {
                              e.preventDefault();
                              void open("https://aistudio.google.com/app/apikey");
                            }}
                          >
                            Google AI Studio
                          </a>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {activeTab() === "about" && (
            <div class="flex-1 animate-in fade-in duration-[var(--duration-slow)]">
              <h1 class="text-2xl font-semibold text-text mb-8">About</h1>
                <div class="settings-section mb-5">
                  <div class="flex items-center gap-4">
                    <img src="/favicon.png" alt="SQL Query Studio icon" class="h-12 w-12 rounded-lg object-contain drop-shadow-md" />
                    <div>
                      <h2 class="text-m font-semibold text-text">SQL Query Studio</h2>
                      <p class="text-s text-text-muted mt-0.5">A lightweight SQL editor for SQL Server.</p>
                    </div>
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="flex items-center justify-between py-2 border-b border-border">
                    <span class="text-m text-text-muted">Version</span>
                    <span class="text-m font-medium text-text">{props.version ?? "unknown"}</span>
                  </div>

                  <a
                    href={REPOSITORY_URL}
                    onClick={handleOpenRepository}
                    class="inline-flex items-center gap-2 text-m text-accent transition-colors hover:text-accent-hover font-medium py-1"
                  >
                    <i class="fa-brands fa-github text-base opacity-80" />
                    View Source on GitHub
                  </a>

                  <div class="pt-3 mt-2 border-t border-border">
                    <button
                      onClick={() => void props.onCheckForUpdates()}
                      disabled={props.checkingForUpdates}
                      class="btn btn-primary w-full py-2"
                    >
                      {props.checkingForUpdates ? "Checking for updates..." : "Check for Updates"}
                    </button>
                    {props.updateMessage && <p class={`text-s mt-3 text-center ${updateMessageClass()}`}>{props.updateMessage}</p>}
                  </div>
                </div>
              </div>
            )}

    </div>
  );

  if (props.renderLayout) {
    return props.renderLayout(sidebarNode, contentNode) as JSX.Element;
  }

  return (
    <div class="flex flex-1 w-full h-full bg-surface overflow-hidden animate-in fade-in duration-[var(--duration-slow)]">
      <div class="w-[260px] app-sidebar-surface border-r border-border flex flex-col gap-1 flex-shrink-0 z-10">
        {sidebarNode}
      </div>
      <div class="flex-1 p-8 md:p-12 overflow-y-auto relative bg-surface-panel">
        {contentNode}
      </div>
    </div>
  );
}
