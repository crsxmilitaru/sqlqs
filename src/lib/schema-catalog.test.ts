import { beforeEach, describe, expect, it } from "vitest";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import type { DatabaseSchemaCatalogEntry } from "./types";
import {
  bracketIdentifier,
  buildSchemaCatalog,
  identifierApply,
  invalidateSchemaCatalog,
  loadSchemaCatalog,
  normalizeIdentifier,
  qualifiedObjectKey,
  unquoteIdentifier,
} from "./schema-catalog";

const entries: DatabaseSchemaCatalogEntry[] = [
  {
    schema_name: "dbo",
    object_name: "Users",
    object_kind: "TABLE",
    columns: [
      {
        name: "Id",
        type_name: "int",
        is_nullable: false,
        is_identity: true,
        is_primary_key: true,
      },
      {
        name: "Id",
        type_name: "int",
        is_nullable: false,
        is_identity: true,
        is_primary_key: true,
      },
    ],
    parameters: [],
  },
  {
    schema_name: "audit",
    object_name: "FindUsers",
    object_kind: "PROCEDURE",
    columns: [],
    parameters: [
      { name: "@Name", type_name: "nvarchar", is_output: false },
    ],
  },
];

describe("schema catalog identifiers", () => {
  it("normalizes and safely quotes SQL identifiers", () => {
    expect(unquoteIdentifier("[Order]]Lines]")).toBe("Order]Lines");
    expect(normalizeIdentifier('"Users"')).toBe("users");
    expect(bracketIdentifier("Order]Lines")).toBe("[Order]]Lines]");
    expect(identifierApply("Users")).toBe("Users");
    expect(identifierApply("Order Lines")).toBe("[Order Lines]");
    expect(qualifiedObjectKey("DBO", "[Users]")).toBe("dbo.users");
  });
});

describe("schema catalog construction", () => {
  it("indexes tables and routines while removing duplicate columns", () => {
    const catalog = buildSchemaCatalog(entries);

    expect(catalog.schemas).toEqual(["audit", "dbo"]);
    expect(catalog.tablesByQualifiedName.get("dbo.users")?.columns).toHaveLength(
      1,
    );
    expect(catalog.routinesByName.get("findusers")?.[0]).toMatchObject({
      schema: "audit",
      kind: "PROCEDURE",
      parameters: [{ name: "@Name", typeName: "nvarchar", isOutput: false }],
    });
  });
});

describe("schema catalog loading", () => {
  beforeEach(() => {
    invalidateSchemaCatalog();
    setInvokeHandler((command) => {
      if (command === "get_database_schema_catalog") return entries;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("reuses a cached database catalog", async () => {
    const first = await loadSchemaCatalog("app");
    const second = await loadSchemaCatalog("app");

    expect(second).toBe(first);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_database_schema_catalog", {
      database: "app",
    });
  });

  it("reloads only the invalidated database", async () => {
    await loadSchemaCatalog("app");
    await loadSchemaCatalog("archive");

    invalidateSchemaCatalog("app");
    await loadSchemaCatalog("app");
    await loadSchemaCatalog("archive");

    expect(invokeMock).toHaveBeenCalledTimes(3);
  });
});
