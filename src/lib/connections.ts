import type { ConnectionConfig, SavedConnection } from "./types";

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

export function parseConnectionStringPreview(value: string) {
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

export function summarizeConnection(c: SavedConnection): string {
  const cfg = c.config;
  if (cfg.connection_string) return "Connection string";
  const auth = cfg.use_windows_auth ? "Windows Auth" : cfg.username || "sa";
  const host = cfg.server || "(no server)";
  return cfg.database ? `${auth}@${host} · ${cfg.database}` : `${auth}@${host}`;
}

export function buildConnectionKey(
  config?: ConnectionConfig | null,
  serverFallback?: string,
): string {
  if (!config) {
    return serverFallback ? `${serverFallback.trim().toLowerCase()}#default` : "";
  }
  if (config.connection_string) {
    const preview = parseConnectionStringPreview(config.connection_string);
    const server = (preview.server || config.server || serverFallback || "")
      .trim()
      .toLowerCase();
    return server ? `cs:${server}` : `cs:${config.connection_string.trim().toLowerCase()}`;
  }
  const server = (config.server || serverFallback || "").trim().toLowerCase();
  if (!server) return "";
  const port = config.port ? `:${config.port}` : "";
  const auth = config.use_windows_auth
    ? "win"
    : (config.username || "").trim().toLowerCase() || "sql";
  return `${server}${port}#${auth}`;
}
