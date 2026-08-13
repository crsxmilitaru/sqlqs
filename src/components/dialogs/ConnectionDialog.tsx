import { createSignal, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { isMacOS } from "../../lib/platform";
import type {
  AppSettings,
  ConnectionConfig,
  SavedConnection,
} from "../../lib/types";
import Dropdown from "../ui/Dropdown";
import Input from "../ui/Input";
import DialogCloseButton from "../ui/DialogCloseButton";
import DialogShell from "../ui/DialogShell";

type ConnectMode = "fields" | "connectionString";

function splitConnectionStringParts(value: string) {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === ";") {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  if (current || value.endsWith(";")) {
    parts.push(current.trim());
  }

  return parts;
}

function unquoteConnectionStringValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseConnectionStringPreview(value: string) {
  const parts = splitConnectionStringParts(value).filter(Boolean);
  const pairs = new Map<string, string>();

  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    const key = rawKey?.trim().toLowerCase();
    if (!key || rest.length === 0) continue;
    pairs.set(key, unquoteConnectionStringValue(rest.join("=")));
  }

  const server =
    pairs.get("server") ||
    pairs.get("data source") ||
    pairs.get("addr") ||
    pairs.get("address") ||
    pairs.get("network address") ||
    pairs.get("datasource") ||
    "";
  const database =
    pairs.get("database") ||
    pairs.get("initial catalog") ||
    pairs.get("catalog") ||
    "";

  return {
    server: server.replace(/^tcp:/i, ""),
    database: database || undefined,
  };
}

interface Props {
  onConnect: (config: ConnectionConfig) => void;
  onClose: () => void;
  editConnection?: SavedConnection;
  onSaved?: (updated: SavedConnection) => void;
}

export default function ConnectionDialog(props: Props) {
  const supportsWindowsAuth = !isMacOS();
  const [mode, setMode] = createSignal<ConnectMode>("fields");
  const [server, setServer] = createSignal("localhost");
  const [database, setDatabase] = createSignal("");
  const [username, setUsername] = createSignal("sa");
  const [password, setPassword] = createSignal("");
  const [useWindowsAuth, setUseWindowsAuth] = createSignal(false);
  const [encrypt, setEncrypt] = createSignal(false);
  const [trustCert, setTrustCert] = createSignal(true);
  const [connectionString, setConnectionString] = createSignal("");
  const [saveName, setSaveName] = createSignal("");
  const [rememberPassword, setRememberPassword] = createSignal(false);
  const [savedConnections, setSavedConnections] = createSignal<
    SavedConnection[]
  >([]);
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal("");
  const [visible, setVisible] = createSignal(false);

  const isEditMode = () => Boolean(props.editConnection);

  onMount(() => {
    loadSavedConnections();
    requestAnimationFrame(() => setVisible(true));

    if (!supportsWindowsAuth) {
      setUseWindowsAuth(false);
    }

    if (props.editConnection) {
      loadConnection(props.editConnection);
    }
  });

  async function loadSavedConnections() {
    try {
      const settings: AppSettings = await invoke("load_connections");
      setSavedConnections(settings.connections);

      if (!props.editConnection && settings.last_connection) {
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
    setPassword("");
    setRememberPassword(false);

    if (cfg.connection_string) {
      setMode("connectionString");
      setConnectionString(cfg.connection_string);
      setSaveName(saved.name);
    } else {
      setMode("fields");
      setServer(cfg.server);
      setDatabase(cfg.database || "");
      setUsername(cfg.username || "sa");
      setPassword("");
      setRememberPassword(false);
      setUseWindowsAuth(supportsWindowsAuth && cfg.use_windows_auth);
      setEncrypt(cfg.encrypt);
      setTrustCert(cfg.trust_server_certificate);
      setSaveName(saved.name);
    }

    try {
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

    let config: ConnectionConfig;

    if (mode() === "connectionString") {
      const cs = connectionString().trim();
      if (!cs) {
        setError("Connection string is required");
        setConnecting(false);
        return;
      }
      config = {
        server: "",
        use_windows_auth: false,
        encrypt: false,
        trust_server_certificate: false,
        connection_string: cs,
        password: password() || undefined,
      };
    } else {
      config = {
        server: server(),
        database: database() || undefined,
        username: useWindowsAuth() ? undefined : username(),
        password: useWindowsAuth() ? undefined : password(),
        use_windows_auth: useWindowsAuth(),
        encrypt: encrypt(),
        trust_server_certificate: trustCert(),
      };
    }

    const trimmedSaveName = saveName().trim();
    const connectionPreview =
      mode() === "connectionString"
        ? parseConnectionStringPreview(connectionString())
        : null;
    const effectiveSaveName = trimmedSaveName || null;
    const effectiveRememberPassword = rememberPassword();

    const editingName = props.editConnection?.name;
    const isRename =
      Boolean(editingName) &&
      Boolean(effectiveSaveName) &&
      editingName !== effectiveSaveName;

    try {
      await invoke("connect_to_server", {
        config,
        saveConnection: effectiveSaveName,
        rememberPassword: effectiveRememberPassword,
      });
      if (isRename) {
        try {
          if (!effectiveRememberPassword) {
            const existing: string | null = await invoke(
              "load_saved_password",
              { connectionName: editingName },
            );
            if (existing) {
              await invoke("set_connection_password", {
                name: effectiveSaveName,
                password: existing,
              });
            }
          }
          await invoke("delete_saved_connection", { name: editingName });
        } catch (err) {
          console.error("Failed to remove old connection after rename:", err);
        }
      }
      props.onConnect(
        connectionPreview ? { ...config, ...connectionPreview } : config,
      );
    } catch (err: any) {
      setError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  async function handleSaveOnly() {
    setError("");
    const trimmedSaveName = saveName().trim();
    if (!trimmedSaveName) {
      setError("Name is required to save.");
      return;
    }

    let saveConfig: ConnectionConfig;
    if (mode() === "connectionString") {
      const cs = connectionString().trim();
      if (!cs) {
        setError("Connection string is required.");
        return;
      }
      saveConfig = {
        server: "",
        use_windows_auth: false,
        encrypt: false,
        trust_server_certificate: false,
        connection_string: cs,
      };
    } else {
      saveConfig = {
        server: server(),
        database: database() || undefined,
        username: useWindowsAuth() ? undefined : username(),
        use_windows_auth: useWindowsAuth(),
        encrypt: encrypt(),
        trust_server_certificate: trustCert(),
      };
    }

    setConnecting(true);
    try {
      const current: AppSettings = await invoke("load_connections");
      const oldName = props.editConnection?.name;
      const updated: SavedConnection = {
        name: trimmedSaveName,
        config: saveConfig,
      };

      const connections = current.connections.slice();
      if (oldName) {
        const idx = connections.findIndex((c) => c.name === oldName);
        if (idx >= 0) connections[idx] = updated;
        else connections.push(updated);
      } else {
        const idx = connections.findIndex((c) => c.name === trimmedSaveName);
        if (idx >= 0) connections[idx] = updated;
        else connections.push(updated);
      }

      const nextLast =
        current.last_connection === oldName
          ? trimmedSaveName
          : current.last_connection;

      await invoke("save_connections_settings", {
        payload: {
          connections,
          last_connection: nextLast,
          auto_connect_startup: current.auto_connect_startup,
        },
      });

      if (oldName && oldName !== trimmedSaveName) {
        const existing: string | null = await invoke("load_saved_password", {
          connectionName: oldName,
        });
        if (existing) {
          await invoke("set_connection_password", {
            name: trimmedSaveName,
            password: existing,
          });
          await invoke("set_connection_password", {
            name: oldName,
            password: "",
          });
        }
      }

      if (rememberPassword() && password()) {
        await invoke("set_connection_password", {
          name: trimmedSaveName,
          password: password(),
        });
      }

      props.onSaved?.(updated);
    } catch (err: any) {
      setError(String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <DialogShell
      visible={visible()}
      onClose={props.onClose}
      class="w-[480px] max-h-[90vh] overflow-y-auto overflow-x-hidden shadow-2xl"
      ariaLabel={isEditMode() ? "Edit Connection" : "Connect to Server"}
    >
        <div class="flex items-center justify-between px-6 py-4 border-b border-overlay-xs bg-transparent">
          <h2 class="text-m font-semibold text-text">
            {isEditMode() ? "Edit Connection" : "Connect to Server"}
          </h2>
          <DialogCloseButton onClick={props.onClose} />
        </div>

        <form onSubmit={handleSubmit} class="p-6 flex flex-col gap-4">
          {!isEditMode() && savedConnections().length > 0 && (
            <div class="flex flex-col gap-1.5">
              <label class="text-s font-medium text-text-muted select-none">
                Saved Connections
              </label>
              <Dropdown
                value={saveName()}
                options={savedConnections().map((c) => ({
                  value: c.name,
                  label: c.name,
                }))}
                onChange={(val) => {
                  const conn = savedConnections().find((c) => c.name === val);
                  if (conn) loadConnection(conn);
                }}
                placeholder="-- Select --"
              />
            </div>
          )}

          <div class="flex bg-surface-panel rounded-lg p-1 border border-border">
            <button
              type="button"
              onClick={() => setMode("fields")}
              class={`flex-1 text-m px-3 py-1.5 rounded-md transition-colors cursor-pointer ${mode() === "fields" ? "bg-surface-active text-text font-medium" : "text-text-muted hover:text-text"}`}
            >
              Fields
            </button>
            <button
              type="button"
              onClick={() => setMode("connectionString")}
              class={`flex-1 text-m px-3 py-1.5 rounded-md transition-colors cursor-pointer ${mode() === "connectionString" ? "bg-surface-active text-text font-medium" : "text-text-muted hover:text-text"}`}
            >
              Connection String
            </button>
          </div>

          {mode() === "connectionString" ? (
            <>
              <div class="flex flex-col gap-1.5">
                <label class="text-s font-medium text-text-muted select-none">
                  Connection String
                </label>
                <textarea
                  name="connection-string"
                  value={connectionString()}
                  onInput={(e) => setConnectionString(e.currentTarget.value)}
                  placeholder="Server=localhost;Database=mydb;User Id=sa;Password=secret;TrustServerCertificate=true"
                  required
                  autofocus
                  rows={4}
                  class="w-full bg-surface-input border border-border rounded-lg px-3 py-2 text-m text-text placeholder:text-text-muted/50 resize-none outline-none focus:border-accent transition-colors font-mono"
                />
              </div>
              <div class="flex gap-4 mt-0.5">
                <div class="flex-1 flex flex-col gap-1.5">
                  <label class="text-s font-medium text-text-muted select-none">
                    Password (optional override)
                  </label>
                  <Input
                    type="password"
                    name="connection-password-override"
                    value={password()}
                    onInput={(e) => setPassword(e.currentTarget.value)}
                    placeholder="Override password from string"
                  />
                  <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer mt-1.5 select-none">
                    <input
                      type="checkbox"
                      name="remember-password"
                      checked={rememberPassword()}
                      onChange={(e) =>
                        setRememberPassword(e.currentTarget.checked)
                      }
                    />
                    <span>Remember password</span>
                  </label>
                </div>
              </div>
            </>
          ) : (
            <>
              <div class="flex flex-col gap-1.5">
                <label class="text-s font-medium text-text-muted select-none">
                  Server
                </label>
                <Input
                  name="server"
                  value={server()}
                  onInput={(e) => {
                    const val = e.currentTarget.value;
                    setServer(val);
                    setSaveName(
                      generateSaveName(val, username(), useWindowsAuth()),
                    );
                  }}
                  placeholder="hostname or hostname\instance"
                  required
                  autofocus
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-s font-medium text-text-muted select-none">
                  Database (optional)
                </label>
                <Input
                  name="database"
                  value={database()}
                  onInput={(e) => setDatabase(e.currentTarget.value)}
                  placeholder="master"
                />
              </div>

              {supportsWindowsAuth && (
                <label class="flex items-center gap-2.5 text-m text-text cursor-pointer mt-0.5 select-none">
                  <input
                    type="checkbox"
                    name="use-windows-auth"
                    checked={useWindowsAuth()}
                    onChange={(e) => setUseWindowsAuth(e.currentTarget.checked)}
                  />
                  <span>Windows Authentication</span>
                </label>
              )}

              {!useWindowsAuth() && (
                <div class="flex gap-4 mt-0.5">
                  <div class="flex-1 flex flex-col gap-1.5">
                    <label class="text-s font-medium text-text-muted select-none">
                      Username
                    </label>
                    <Input
                      name="username"
                      value={username()}
                      onInput={(e) => {
                        const val = e.currentTarget.value;
                        setUsername(val);
                        setSaveName(
                          generateSaveName(server(), val, useWindowsAuth()),
                        );
                      }}
                    />
                  </div>
                  <div class="flex-1 flex flex-col gap-1.5">
                    <label class="text-s font-medium text-text-muted select-none">
                      Password
                    </label>
                    <Input
                      type="password"
                      name="password"
                      value={password()}
                      onInput={(e) => setPassword(e.currentTarget.value)}
                    />
                    <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer mt-1 select-none">
                      <input
                        type="checkbox"
                        name="remember-password"
                        checked={rememberPassword()}
                        onChange={(e) =>
                          setRememberPassword(e.currentTarget.checked)
                        }
                      />
                      <span>Remember password</span>
                    </label>
                  </div>
                </div>
              )}

              <div class="flex gap-6 mt-1.5 mb-1">
                <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="encrypt"
                    checked={encrypt()}
                    onChange={(e) => setEncrypt(e.currentTarget.checked)}
                  />
                  <span>Encrypt</span>
                </label>
                <label class="flex items-center gap-2.5 text-m text-text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="trust-cert"
                    checked={trustCert()}
                    onChange={(e) => setTrustCert(e.currentTarget.checked)}
                  />
                  <span>Trust Server Certificate</span>
                </label>
              </div>
            </>
          )}

          <div class="border-t border-border mt-1 pt-4 flex flex-col gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="text-s font-medium text-text-muted select-none">
                Save as (optional)
              </label>
              <Input
                name="save-name"
                value={saveName()}
                onInput={(e) => setSaveName(e.currentTarget.value)}
                placeholder="My Server"
              />
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
            {isEditMode() && (
              <button
                type="button"
                onClick={handleSaveOnly}
                disabled={connecting()}
                class="btn btn-secondary px-6 py-1.5"
              >
                {connecting() ? "Saving…" : "Save"}
              </button>
            )}
            <button
              type="submit"
              disabled={connecting()}
              class="btn btn-primary px-6 py-1.5"
            >
              {connecting()
                ? "Connecting…"
                : isEditMode()
                  ? "Save & Connect"
                  : "Connect"}
            </button>
          </div>
        </form>
    </DialogShell>
  );
}
