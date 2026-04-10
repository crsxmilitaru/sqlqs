import { createSignal, onMount } from "solid-js";
import { isMacOS } from "../lib/platform";
import type { AppSettings, ConnectionConfig, SavedConnection } from "../lib/types";
import Dropdown from "./Dropdown";
import Input from "./Input";
import Tooltip from "./Tooltip";

interface Props {
  onConnect: (config: ConnectionConfig) => void;
  onClose: () => void;
}

export default function ConnectionDialog(props: Props) {
  const supportsWindowsAuth = !isMacOS();
  const [server, setServer] = createSignal("localhost");
  const [database, setDatabase] = createSignal("");
  const [username, setUsername] = createSignal("sa");
  const [password, setPassword] = createSignal("");
  const [useWindowsAuth, setUseWindowsAuth] = createSignal(false);
  const [encrypt, setEncrypt] = createSignal(false);
  const [trustCert, setTrustCert] = createSignal(true);
  const [saveName, setSaveName] = createSignal("");
  const [rememberPassword, setRememberPassword] = createSignal(false);
  const [keepLoggedIn, setKeepLoggedIn] = createSignal(true);
  const [savedConnections, setSavedConnections] = createSignal<SavedConnection[]>([]);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [visible, setVisible] = createSignal(false);

  onMount(() => {
    loadSavedConnections();
    requestAnimationFrame(() => setVisible(true));

    if (!supportsWindowsAuth) {
      setUseWindowsAuth(false);
    }
  });

  async function loadSavedConnections() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const settings: AppSettings = await invoke("load_connections");
      setSavedConnections(settings.connections);
      setKeepLoggedIn(settings.keep_logged_in);

      if (settings.last_connection) {
        const last = settings.connections.find(
          (c) => c.name === settings.last_connection,
        );
        if (last) {
          loadConnection(last);
        }
      }
    } catch {}
  }

  async function loadConnection(saved: SavedConnection) {
    const cfg = saved.config;
    setServer(cfg.server);
    setDatabase(cfg.database || "");
    setUsername(cfg.username || "sa");
    setPassword("");
    setRememberPassword(false);
    setUseWindowsAuth(supportsWindowsAuth && cfg.use_windows_auth);
    setEncrypt(cfg.encrypt);
    setTrustCert(cfg.trust_server_certificate);
    setSaveName(saved.name);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const pass: string | null = await invoke("load_saved_password", {
        connectionName: saved.name,
      });
      if (pass) {
        setPassword(pass);
        setRememberPassword(true);
      }
    } catch {}
  }

  function generateSaveName(srv: string, user: string, winAuth: boolean) {
    const s = srv.trim();
    return !winAuth && user.trim() ? `${user.trim()}@${s}` : s;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    setConnecting(true);
    setError("");

    const config: ConnectionConfig = {
      server: server(),
      database: database() || undefined,
      username: useWindowsAuth() ? undefined : username(),
      password: useWindowsAuth() ? undefined : password(),
      use_windows_auth: useWindowsAuth(),
      encrypt: encrypt(),
      trust_server_certificate: trustCert(),
    };

    const trimmedSaveName = saveName().trim();
    const generatedSaveName = database().trim()
      ? `${server().trim()} (${database().trim()})`
      : server().trim();
    const effectiveSaveName = keepLoggedIn()
      ? (trimmedSaveName || generatedSaveName)
      : (trimmedSaveName || null);
    const effectiveRememberPassword =
      rememberPassword() || (keepLoggedIn() && !useWindowsAuth());

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("connect_to_server", {
        config,
        saveConnection: effectiveSaveName,
        rememberPassword: effectiveRememberPassword,
        keepLoggedIn: keepLoggedIn(),
      });
      if (keepLoggedIn() && !trimmedSaveName) {
        setSaveName(generatedSaveName);
      }
      props.onConnect(config);
    } catch (err: any) {
      setError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div
      class="dialog-overlay"
      data-visible={visible()}
      onMouseDown={props.onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        class="dialog-surface w-[480px] max-h-[90vh] overflow-y-auto overflow-x-hidden shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs bg-transparent">
          <h2 class="text-m font-semibold text-text">Connect to Server</h2>
          <Tooltip content="Close" placement="bottom">
            <button
              onClick={props.onClose}
              class="text-text-muted hover:bg-surface-overlay hover:text-text rounded-lg w-8 h-8 flex items-center justify-center transition-colors cursor-pointer"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        <form onSubmit={handleSubmit} class="p-6 flex flex-col gap-4">
          {savedConnections().length > 0 && (
            <div class="flex flex-col gap-1.5">
              <label class="text-s font-medium text-text-muted select-none">Saved Connections</label>
              <Dropdown
                value={saveName()}
                options={savedConnections().map((c) => ({ value: c.name, label: c.name }))}
                onChange={(val) => {
                  const conn = savedConnections().find((c) => c.name === val);
                  if (conn) loadConnection(conn);
                }}
                placeholder="-- Select --"
              />
            </div>
          )}

          <div class="flex flex-col gap-1.5">
            <label class="text-s font-medium text-text-muted select-none">Server</label>
            <Input
              value={server()}
              onInput={(e) => {
                const val = e.currentTarget.value;
                setServer(val);
                setSaveName(generateSaveName(val, username(), useWindowsAuth()));
              }}
              placeholder="hostname or hostname\instance"
              required
              autofocus
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-s font-medium text-text-muted select-none">Database (optional)</label>
            <Input
              value={database()}
              onInput={(e) => setDatabase(e.currentTarget.value)}
              placeholder="master"
            />
          </div>

          {supportsWindowsAuth && (
            <label class="flex items-center gap-2.5 text-m text-text cursor-pointer mt-0.5 select-none">
              <input
                type="checkbox"
                checked={useWindowsAuth()}
                onChange={(e) => setUseWindowsAuth(e.currentTarget.checked)}
              />
              <span>Windows Authentication</span>
            </label>
          )}

          {!useWindowsAuth() && (
            <div class="flex gap-4 mt-0.5">
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-s font-medium text-text-muted select-none">Username</label>
                <Input
                  value={username()}
                  onInput={(e) => {
                    const val = e.currentTarget.value;
                    setUsername(val);
                    setSaveName(generateSaveName(server(), val, useWindowsAuth()));
                  }}
                />
              </div>
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-s font-medium text-text-muted select-none">Password</label>
                <Input
                  type="password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
              </div>
            </div>
          )}

          <div class="flex gap-6 mt-1.5 mb-1">
            <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={encrypt()}
                onChange={(e) => setEncrypt(e.currentTarget.checked)}
              />
              <span>Encrypt</span>
            </label>
            <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={trustCert()}
                onChange={(e) => setTrustCert(e.currentTarget.checked)}
              />
              <span>Trust Server Certificate</span>
            </label>
          </div>

          <div class="border-t border-border mt-1 pt-4 flex flex-col gap-3">
            <div class="flex gap-4 items-start">
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-s font-medium text-text-muted select-none">Save as (optional)</label>
                <Input
                  value={saveName()}
                  onInput={(e) => setSaveName(e.currentTarget.value)}
                  placeholder="My Server"
                />
              </div>
              <div class="flex flex-col gap-2 mt-[22px]">
                <label class={`flex items-center gap-2.5 text-m text-text-muted select-none ${keepLoggedIn() ? "opacity-50 cursor-default" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={rememberPassword() || keepLoggedIn()}
                    disabled={keepLoggedIn()}
                    onChange={(e) => setRememberPassword(e.currentTarget.checked)}
                  />
                  <span>Remember password</span>
                </label>
                <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={keepLoggedIn()}
                    onChange={(e) => {
                      const next = e.currentTarget.checked;
                      setKeepLoggedIn(next);
                      if (next && !useWindowsAuth()) {
                        setRememberPassword(true);
                      }
                    }}
                  />
                  <span>Keep me logged in</span>
                </label>
              </div>
            </div>
          </div>

          {error() && (
            <div class="text-error text-m bg-error/10 border border-error/30 rounded-lg px-3 py-2 mt-2">
              {error()}
            </div>
          )}

          <div class="flex justify-end gap-3 pt-5 border-t border-border mt-1">
            <button
              type="button"
              onClick={props.onClose}
              class="btn btn-secondary px-6 py-1.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting()}
              class="btn btn-primary px-6 py-1.5"
            >
              {connecting() ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
