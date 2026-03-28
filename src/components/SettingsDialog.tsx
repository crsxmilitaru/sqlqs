import { open } from "@tauri-apps/plugin-shell";
import { type MouseEvent, useEffect, useState } from "react";
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
}

type Tab = "general" | "appearance" | "ai" | "about";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "fa-solid fa-gear" },
  { id: "appearance", label: "Appearance", icon: "fa-solid fa-palette" },
  { id: "ai", label: "AI", icon: "fa-solid fa-wand-magic-sparkles" },
  { id: "about", label: "About", icon: "fa-solid fa-circle-info" },
];

const REPOSITORY_URL = "https://github.com/crsxmilitaru/sqlqs";

export default function SettingsDialog({
  onClose,
  version,
  onCheckForUpdates,
  checkingForUpdates,
  updateMessage,
  updateMessageTone,
  onThemeChange,
}: Props) {
  const currentTheme = loadTheme();
  const prefs = loadPreferences();
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [themeId, setThemeId] = useState(currentTheme.id);
  const [persistTabs, setPersistTabs] = useState(prefs.persistTabs);
  const [maxHistory, setMaxHistory] = useState(prefs.maxHistoryItems);

  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>(AiService.getStatus());
  const [apiKey, setApiKey] = useState(AiService.getApiKey() || "");
  const [modelId, setModelId] = useState(AiService.getModel());
  const [showApiKey, setShowApiKey] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  useEffect(() => {
    saveTheme(themeId);
    onThemeChange?.({ id: themeId });
  }, [themeId, onThemeChange]);

  const handleSaveAiSettings = () => {
    AiService.setApiKey(apiKey);
    AiService.setModel(modelId);
    setGeminiStatus(AiService.getStatus());
  };

  const updateMessageClass =
    updateMessageTone === "error"
      ? "text-error"
      : updateMessageTone === "success"
        ? "text-success"
        : "text-text-muted";

  async function handleOpenRepository(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    await open(REPOSITORY_URL);
  }

  return (
    <div
      className={`absolute top-11 inset-x-0 bottom-0 z-[70] flex items-center justify-center bg-black/50 transition-opacity duration-200 ${visible ? "opacity-100" : "opacity-0"}`}
      onMouseDown={onClose}
    >
      <div
        className={`w-[600px] h-[420px] max-w-[92vw] flex flex-col rounded-2xl border border-white/[0.08] bg-surface-raised shadow-2xl overflow-hidden transition-all duration-200 ${visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.97] translate-y-2"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-[168px] bg-surface/50 border-r border-border p-3 flex flex-col gap-0.5 overflow-y-auto">
            <h2 className="text-[11px] font-semibold text-text-muted mb-2 px-2.5 uppercase tracking-wider">Settings</h2>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`settings-nav-btn ${activeTab === tab.id ? "active" : ""}`}
              >
                <i className={tab.icon} />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 p-6 flex flex-col overflow-y-auto relative">
            {activeTab === "general" && (
              <div className="flex-1 animate-in fade-in duration-200">
                <h3 className="text-base font-semibold text-text mb-5">General</h3>

                <div className="space-y-5">
                  <div className="settings-section">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-medium text-text">Restore tabs on startup</h4>
                        <p className="text-xs text-text-muted mt-0.5">Keep your open tabs between app restarts</p>
                      </div>
                      <button
                        onClick={() => {
                          const next = !persistTabs;
                          setPersistTabs(next);
                          savePersistTabs(next);
                        }}
                        className="settings-toggle"
                        data-checked={persistTabs}
                      />
                    </div>
                  </div>

                  <div className="settings-section">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-medium text-text">History limit</h4>
                        <p className="text-xs text-text-muted mt-0.5">Maximum number of queries to keep in history</p>
                      </div>
                      <span className="text-sm font-medium text-accent tabular-nums">{maxHistory}</span>
                    </div>
                    <input
                      type="range"
                      min={MIN_MAX_HISTORY}
                      max={MAX_MAX_HISTORY}
                      step={10}
                      value={maxHistory}
                      onChange={(e) => {
                        const val = Number.parseInt(e.target.value, 10);
                        setMaxHistory(val);
                        saveMaxHistoryItems(val);
                      }}
                      className="settings-range"
                    />
                    <div className="flex justify-between text-[11px] text-text-muted mt-2">
                      <span>{MIN_MAX_HISTORY}</span>
                      <span>{DEFAULT_MAX_HISTORY} (default)</span>
                      <span>{MAX_MAX_HISTORY}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "appearance" && (
              <div className="flex-1 animate-in fade-in duration-200">
                <h3 className="text-base font-semibold text-text mb-5">Appearance</h3>

                <div>
                  <h4 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Theme</h4>
                  <div className="grid grid-cols-2 gap-2.5">
                    {THEMES.map(theme => (
                      <button
                        key={theme.id}
                        onClick={() => setThemeId(theme.id)}
                        className={`flex flex-col gap-2 p-3 rounded-lg border transition-all text-left ${themeId === theme.id
                          ? "border-accent bg-accent/8 ring-1 ring-accent/25"
                          : "border-border bg-surface hover:bg-surface-hover hover:border-white/15"
                          }`}
                      >
                        <div className="font-medium text-[13px] flex items-center justify-between">
                          {theme.name}
                          {themeId === theme.id && <i className="fa-solid fa-check text-accent text-xs" />}
                        </div>
                        <div className="flex h-10 w-full rounded-md overflow-hidden border border-border/50" style={{ backgroundColor: theme.colors["--color-surface-raised"] }}>
                          <div className="w-10 h-full border-r border-border/30" style={{ backgroundColor: theme.colors["--color-surface"] }} />
                          <div className="flex-1 p-2 flex flex-col gap-1.5 relative">
                            <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: theme.colors["--color-surface-active"] }} />
                            <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: theme.colors["--color-surface-hover"] }} />
                            <div className="absolute bottom-2 right-2 w-3 h-3 rounded-full" style={{ backgroundColor: theme.colors["--color-accent"] }} />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "ai" && (
              <div className="flex-1 animate-in fade-in duration-200">
                <h3 className="text-base font-semibold text-text mb-5">AI Assistant</h3>
                <div className="space-y-5">
                  <div className="settings-section">
                    <div className="flex items-center gap-3 mb-4">
                      <div>
                        <h4 className="text-sm font-medium text-text">API Configuration</h4>
                        <p className="text-xs text-text-muted mt-0.5">Google Gemini</p>
                      </div>
                      <div className="ml-auto">
                        {geminiStatus.hasKey ? (
                          <span className="px-2.5 py-1 bg-success/10 text-success text-[11px] font-semibold rounded-full border border-success/20">
                            CONFIGURED
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 bg-warning/10 text-warning text-[11px] font-semibold rounded-full border border-warning/20">
                            REQUIRED
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3.5">
                      <div>
                        <label className="text-xs font-medium text-text-muted block mb-1.5">
                          Gemini Model ID
                        </label>
                        <Input
                          type="text"
                          value={modelId}
                          onChange={(e) => setModelId(e.target.value)}
                          placeholder="e.g. gemini-2.0-flash"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-text-muted block mb-1.5">
                          Gemini API Key
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input
                              type={showApiKey ? "text" : "password"}
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              placeholder="Paste your API key here..."
                              className="pr-9"
                            />
                            <button
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                            >
                              <i className={`fa-solid ${showApiKey ? "fa-eye-slash" : "fa-eye"} text-xs`} />
                            </button>
                          </div>
                          <button
                            onClick={handleSaveAiSettings}
                            className="btn btn-primary px-4"
                          >
                            Save
                          </button>
                        </div>
                        <p className="text-[11px] text-text-muted mt-2">
                          Get your API key for free at{" "}
                          <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
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

            {activeTab === "about" && (
              <div className="flex-1 animate-in fade-in duration-200">
                <h3 className="text-base font-semibold text-text mb-5">About</h3>
                <div className="settings-section mb-5">
                  <div className="flex items-center gap-4">
                    <img src="/favicon.png" alt="SQL Query Studio icon" className="h-12 w-12 rounded-lg object-contain drop-shadow-md" />
                    <div>
                      <h2 className="text-sm font-semibold text-text">SQL Query Studio</h2>
                      <p className="text-xs text-text-muted mt-0.5">A lightweight SQL editor for SQL Server.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <span className="text-sm text-text-muted">Version</span>
                    <span className="text-sm font-medium text-text">{version ?? "unknown"}</span>
                  </div>

                  <a
                    href={REPOSITORY_URL}
                    onClick={handleOpenRepository}
                    className="inline-flex items-center gap-2 text-[13px] text-accent transition-colors hover:text-accent-hover font-medium py-1"
                  >
                    <i className="fa-brands fa-github text-base opacity-80" />
                    View Source on GitHub
                  </a>

                  <div className="pt-3 mt-2 border-t border-border">
                    <button
                      onClick={() => void onCheckForUpdates()}
                      disabled={checkingForUpdates}
                      className="btn btn-primary w-full py-2"
                    >
                      {checkingForUpdates ? "Checking for updates..." : "Check for Updates"}
                    </button>
                    {updateMessage && <p className={`text-xs mt-3 text-center ${updateMessageClass}`}>{updateMessage}</p>}
                  </div>
                </div>
              </div>
            )}

            <div className="absolute top-4 right-4 z-10">
              <Tooltip content="Close" placement="bottom">
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-surface-hover text-text-muted hover:text-text transition-colors"
                >
                  <i className="fa-solid fa-xmark text-sm" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
