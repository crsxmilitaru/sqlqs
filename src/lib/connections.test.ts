import { describe, expect, it } from "vitest";
import {
  buildConnectionKey,
  parseConnectionStringPreview,
  summarizeConnection,
} from "./connections";
import type { SavedConnection } from "./types";

describe("parseConnectionStringPreview", () => {
  it("extracts server and database", () => {
    expect(
      parseConnectionStringPreview(
        "Server=tcp:localhost,1433;Database=master;User Id=sa;Password=secret",
      ),
    ).toEqual({ server: "localhost,1433", database: "master" });
  });

  it("matches alias keys case-insensitively and handles quotes", () => {
    expect(
      parseConnectionStringPreview('Data Source="MY-HOST";Initial Catalog="My Db"'),
    ).toEqual({ server: "MY-HOST", database: "My Db" });
  });

  it("returns undefined database when absent", () => {
    expect(parseConnectionStringPreview("Server=localhost")).toEqual({
      server: "localhost",
      database: undefined,
    });
  });
});

describe("summarizeConnection", () => {
  it("summarizes sql auth with database", () => {
    const conn: SavedConnection = {
      name: "dev",
      config: {
        server: "localhost",
        database: "master",
        username: "sa",
        use_windows_auth: false,
        encrypt: false,
        trust_server_certificate: true,
      },
    };
    expect(summarizeConnection(conn)).toBe("sa@localhost · master");
  });

  it("summarizes windows auth without database", () => {
    const conn: SavedConnection = {
      name: "win",
      config: {
        server: "prod",
        use_windows_auth: true,
        encrypt: false,
        trust_server_certificate: false,
      },
    };
    expect(summarizeConnection(conn)).toBe("Windows Auth@prod");
  });

  it("labels connection string configs", () => {
    const conn: SavedConnection = {
      name: "cs",
      config: {
        server: "",
        use_windows_auth: false,
        encrypt: false,
        trust_server_certificate: false,
        connection_string: "Server=x;Database=y",
      },
    };
    expect(summarizeConnection(conn)).toBe("Connection string");
  });
});

describe("buildConnectionKey", () => {
  it("builds a key for windows authentication", () => {
    expect(
      buildConnectionKey({
        server: "localhost",
        use_windows_auth: true,
        encrypt: false,
        trust_server_certificate: true,
      }),
    ).toBe("localhost#win");
  });

  it("builds a key with port and sql auth username", () => {
    expect(
      buildConnectionKey({
        server: "192.168.1.100",
        port: 1433,
        username: "SA",
        use_windows_auth: false,
        encrypt: true,
        trust_server_certificate: true,
      }),
    ).toBe("192.168.1.100:1433#sa");
  });

  it("extracts server from connection string", () => {
    expect(
      buildConnectionKey({
        server: "",
        use_windows_auth: false,
        encrypt: false,
        trust_server_certificate: false,
        connection_string: "Server=tcp:sql-prod,1433;Database=test",
      }),
    ).toBe("cs:sql-prod,1433");
  });

  it("falls back to serverFallback when config is missing", () => {
    expect(buildConnectionKey(null, "fallback-srv")).toBe("fallback-srv#default");
  });
});
