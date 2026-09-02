import { describe, expect, it } from "vitest";
import {
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
