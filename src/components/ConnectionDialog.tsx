import { useEffect, useState } from "react";
import type { AppSettings, ConnectionConfig, SavedConnection } from "../lib/types";
import Tooltip from "./Tooltip";

interface Props {
  onConnect: (config: ConnectionConfig) => void;
  onClose: () => void;
}

export default function ConnectionDialog({ onConnect, onClose }: Props) {
  const [server, setServer] = useState("localhost");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("sa");
  const [password, setPassword] = useState("");
  const [useWindowsAuth, setUseWindowsAuth] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [trustCert, setTrustCert] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSavedConnections();
  }, []);

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
    setUseWindowsAuth(cfg.use_windows_auth);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError("");

    const config: ConnectionConfig = {
      server,
      database: database || undefined,
      username: useWindowsAuth ? undefined : username,
      password: useWindowsAuth ? undefined : password,
      use_windows_auth: useWindowsAuth,
      encrypt,
      trust_server_certificate: trustCert,
    };

    const trimmedSaveName = saveName.trim();
    const generatedSaveName = database.trim()
      ? `${server.trim()} (${database.trim()})`
      : server.trim();
    const effectiveSaveName = keepLoggedIn
      ? (trimmedSaveName || generatedSaveName)
      : (trimmedSaveName || null);
    const effectiveRememberPassword =
      rememberPassword || (keepLoggedIn && !useWindowsAuth);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("connect_to_server", {
        config,
        saveConnection: effectiveSaveName,
        rememberPassword: effectiveRememberPassword,
        keepLoggedIn,
      });
      if (keepLoggedIn && !trimmedSaveName) {
        setSaveName(generatedSaveName);
      }
      onConnect(config);
    } catch (err: any) {
      setError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="absolute top-11 inset-x-0 bottom-0 bg-black/50 backdrop-blur-md flex items-center justify-center z-50">
      <div className="bg-surface-raised/90 backdrop-blur-xl border border-white/[0.08] shadow-2xl w-[480px] max-h-[90vh] overflow-auto rounded-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-transparent">
          <h2 className="text-sm font-semibold text-text">Connect to Server</h2>
          <Tooltip content="Close" placement="bottom">
            <button
              onClick={onClose}
              className="text-text-muted hover:bg-surface-overlay hover:text-text rounded-lg w-8 h-8 flex items-center justify-center transition-colors"
            >
              &times;
            </button>
          </Tooltip>
        </div>

        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
          {savedConnections.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-muted select-none">Saved Connections</label>
              <select
                className="winui-input px-3 py-1.5 text-sm text-text bg-surface"
                onChange={(e) => {
                  const conn = savedConnections.find((c) => c.name === e.target.value);
                  if (conn) loadConnection(conn);
                }}
                value={saveName}
              >
                <option value="">-- Select --</option>
                {savedConnections.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted select-none">Server</label>
            <input
              type="text"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="hostname or hostname\instance"
              className="winui-input px-3 py-1.5 text-sm text-text"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted select-none">Database (optional)</label>
            <input
              type="text"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder="master"
              className="winui-input px-3 py-1.5 text-sm text-text"
            />
          </div>

          <label className="flex items-center gap-2.5 text-sm text-text cursor-pointer mt-0.5 select-none">
            <input
              type="checkbox"
              checked={useWindowsAuth}
              onChange={(e) => setUseWindowsAuth(e.target.checked)}
            />
            <span>Windows Authentication</span>
          </label>

          {!useWindowsAuth && (
            <div className="flex gap-4 mt-0.5">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-muted select-none">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="winui-input px-3 py-1.5 text-sm text-text"
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-muted select-none">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="winui-input px-3 py-1.5 text-sm text-text"
                />
              </div>
            </div>
          )}

          <div className="flex gap-6 mt-1.5 mb-1">
            <label className="flex items-center gap-2.5 text-sm text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={encrypt}
                onChange={(e) => setEncrypt(e.target.checked)}
              />
              <span>Encrypt</span>
            </label>
            <label className="flex items-center gap-2.5 text-sm text-text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={trustCert}
                onChange={(e) => setTrustCert(e.target.checked)}
              />
              <span>Trust Server Certificate</span>
            </label>
          </div>

          <div className="border-t border-border mt-1 pt-4 flex flex-col gap-3">
            <div className="flex gap-4 items-start">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-xs font-medium text-text-muted select-none">Save as (optional)</label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="My Server"
                  className="winui-input px-3 py-1.5 text-sm text-text"
                />
              </div>
              <div className="flex flex-col gap-2 mt-[22px]">
                <label className="flex items-center gap-2.5 text-sm text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberPassword}
                    onChange={(e) => setRememberPassword(e.target.checked)}
                  />
                  <span>Remember password</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={keepLoggedIn}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setKeepLoggedIn(next);
                      if (next && !useWindowsAuth) {
                        setRememberPassword(true);
                      }
                    }}
                  />
                  <span>Keep me logged in</span>
                </label>
              </div>
            </div>
          </div>

          {error && (
            <div className="text-error text-sm bg-error/10 border border-error/30 rounded-lg px-3 py-2 mt-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-5 border-t border-border mt-1">
            <button
              type="button"
              onClick={onClose}
              className="app-btn px-6 py-1.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={connecting}
              className="app-btn app-btn-primary px-6 py-1.5"
            >
              {connecting ? "Connecting..." : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
