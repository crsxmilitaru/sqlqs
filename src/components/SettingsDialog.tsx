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
import Tooltip from "./Tooltip";

interface Props {
  onClose: () => void;
  version: string | null;
  onCheckForUpdates: () => void | Promise<void>;
  checkingForUpdates: boolean;
  updateMessage: string | null;
  updateMessageTone: UpdateMessageTone;
  onThemeChange?: (theme: { id: string }) => void;
}

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
  const [activeTab, setActiveTab] = useState<"general" | "appearance" | "ai" | "about">("general");
  const [themeId, setThemeId] = useState(currentTheme.id);
  const [persistTabs, setPersistTabs] = useState(prefs.persistTabs);
  const [maxHistory, setMaxHistory] = useState(prefs.maxHistoryItems);

  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>(AiService.getStatus());
  const [aiEnabled, setAiEnabled] = useState(AiService.isEnabled());
  const [apiKey, setApiKey] = useState(AiService.getApiKey() || "");
  const [modelId, setModelId] = useState(AiService.getModel());
  const [showApiKey, setShowApiKey] = useState(false);

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
      className="absolute top-11 inset-x-0 bottom-0 z-[70] flex items-center justify-center bg-black/55 backdrop-blur-md"
      onMouseDown={onClose}
    >
      <div
        className="w-[600px] h-[400px] max-w-[92vw] flex flex-col rounded-2xl border border-white/[0.08] bg-surface-raised/95 shadow-2xl overflow-hidden"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex flex-1 overflow-hidden">
          <div className="w-40 bg-surface/40 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
            <h2 className="text-[11px] font-semibold text-text-muted mb-2 px-3 uppercase tracking-wider">Settings</h2>
            <button
              onClick={() => setActiveTab("general")}
              className={`text-left px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${activeTab === "general" ? "bg-accent/15 text-accent" : "text-text hover:text-accent hover:bg-surface-hover"}`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab("appearance")}
              className={`text-left px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${activeTab === "appearance" ? "bg-accent/15 text-accent" : "text-text hover:text-accent hover:bg-surface-hover"}`}
            >
              Appearance
            </button>
            <button
              onClick={() => setActiveTab("ai")}
              className={`text-left px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${activeTab === "ai" ? "bg-accent/15 text-accent" : "text-text hover:text-accent hover:bg-surface-hover"}`}
            >
              AI
            </button>
            <button
              onClick={() => setActiveTab("about")}
              className={`text-left px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${activeTab === "about" ? "bg-accent/15 text-accent" : "text-text hover:text-accent hover:bg-surface-hover"}`}
            >
              About
            </button>
          </div>

          <div className="flex-1 p-6 flex flex-col overflow-y-auto relative">
            {activeTab === "general" && (
              <div className="flex-1 animate-in fade-in duration-200">
                <h3 className="text-xl font-semibold text-text mb-6">General</h3>

                <div className="space-y-6">
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
                      className={`relative w-10 h-[22px] rounded-full transition-colors ${persistTabs ? "bg-accent" : "bg-white/15"}`}
                    >
                      <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${persistTabs ? "translate-x-[18px]" : ""}`} />
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-medium text-text">History limit</h4>
                        <p className="text-xs text-text-muted mt-0.5">Maximum number of queries to keep in history</p>
                      </div>
                      <span className="text-sm text-text-muted tabular-nums">{maxHistory}</span>
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
                      className="w-full accent-accent"
                    />
                    <div className="flex justify-between text-[11px] text-text-muted mt-1">
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
                <h3 className="text-xl font-semibold text-text mb-6">Appearance</h3>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-sm font-medium text-text mb-3">Theme</h4>
                    <div className="grid grid-cols-2 gap-3">
                      {THEMES.map(theme => (
                        <button
                          key={theme.id}
                          onClick={() => setThemeId(theme.id)}
                          className={`flex flex-col gap-2 p-3 rounded-xl border transition-all text-left ${themeId === theme.id
                            ? "border-accent bg-accent/5 ring-1 ring-accent/30"
                            : "border-border bg-surface hover:bg-surface-hover"
                            }`}
                        >
                          <div className="font-medium text-[13px] flex items-center justify-between">
                            {theme.name}
                            {themeId === theme.id && <i className="fa-solid fa-check text-accent text-xs" />}
                          </div>
                          <div className="flex h-10 w-full rounded-md overflow-hidden border border-border/50 shadow-sm" style={{ backgroundColor: theme.colors["--color-surface-raised"] }}>
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
              </div>
            )}

            {activeTab === "ai" && (
              <div className="flex-1 animate-in fade-in duration-200">
                <h3 className="text-xl font-semibold text-text mb-6">Autocomplete</h3>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-text">Enable AI Autocomplete</h4>
                      <p className="text-xs text-text-muted mt-0.5">Get intelligent T-SQL suggestions as you type</p>
                    </div>
                    <button
                      onClick={() => {
                        const next = !aiEnabled;
                        setAiEnabled(next);
                        AiService.setEnabled(next);
                      }}
                      className={`relative w-10 h-[22px] rounded-full transition-colors ${aiEnabled ? "bg-accent" : "bg-white/15"}`}
                    >
                      <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow transition-transform ${aiEnabled ? "translate-x-[18px]" : ""}`} />
                    </button>
                  </div>

                  <div className={`bg-surface p-4 rounded-xl border border-white/5 transition-opacity ${aiEnabled ? "" : "opacity-50 pointer-events-none"}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <div>
                        <h4 className="text-sm font-medium text-text">API Configuration</h4>
                        <p className="text-xs text-text-muted mt-0.5">Google Gemini</p>
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                        {geminiStatus.hasKey ? (
                          <span className="px-2 py-0.5 bg-success/15 text-success text-[11px] font-semibold rounded-full border border-success/20">
                            CONFIGURED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-warning/15 text-warning text-[11px] font-semibold rounded-full border border-warning/20">
                            REQUIRED
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-[11px] text-text-muted uppercase tracking-wider block mb-1.5">
                          Gemini Model ID
                        </label>
                        <input
                          type="text"
                          value={modelId}
                          onChange={(e) => setModelId(e.target.value)}
                          placeholder="e.g. gemini-3.1-flash-lite-preview"
                          className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent/50 outline-none transition-all"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-text-muted uppercase tracking-wider block mb-1.5">
                          Gemini API Key
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type={showApiKey ? "text" : "password"}
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              placeholder="Paste your API key here..."
                              className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-accent/50 outline-none transition-all pr-10"
                            />
                            <button
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
                            >
                              <i className={`fa-solid ${showApiKey ? "fa-eye-slash" : "fa-eye"} text-xs`} />
                            </button>
                          </div>
                          <button
                            onClick={handleSaveAiSettings}
                            className="app-btn app-btn-primary px-4"
                          >
                            Save
                          </button>
                        </div>
                        <p className="text-[10px] text-text-muted mt-2">
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
                <h3 className="text-xl font-semibold text-text mb-6">About</h3>
                <div className="mb-6 flex items-center gap-4 bg-surface p-4 rounded-xl border border-white/5 shadow-inner">
                  <img src="/favicon.png" alt="SQL Query Studio icon" className="h-14 w-14 rounded-lg object-contain drop-shadow-md" />
                  <div>
                    <h2 className="text-lg font-semibold text-text tracking-wide">SQL Query Studio</h2>
                    <p className="text-[13px] text-text-muted mt-0.5">A lightweight SQL editor for SQL Server.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-4 border-b border-border">
                    <span className="text-sm text-text">Version</span>
                    <span className="text-sm text-text-muted">{version ?? "unknown"}</span>
                  </div>

                  <a
                    href={REPOSITORY_URL}
                    onClick={handleOpenRepository}
                    className="inline-flex items-center gap-2 text-[13px] text-accent transition-colors hover:text-accent-hover font-medium py-1"
                  >
                    <i className="fa-brands fa-github text-base opacity-80" />
                    View Source on GitHub
                  </a>

                  <div className="pt-4 mt-4 border-t border-border">
                    <button
                      onClick={() => void onCheckForUpdates()}
                      disabled={checkingForUpdates}
                      className="app-btn app-btn-primary w-full py-2"
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
                  className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/10 text-text-muted hover:text-text transition-colors"
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
