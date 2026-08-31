import { CompletionContext } from "@codemirror/autocomplete";
import { MSSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSchemaCatalogEntry } from "./types";
import { invalidateSchemaCatalog } from "./schema-catalog";
import { invokeMock, setInvokeHandler } from "../test/tauri";
import { sqlCompletionSource } from "./sql-completion";

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
        name: "DisplayName",
        type_name: "nvarchar",
        is_nullable: false,
        is_identity: false,
        is_primary_key: false,
      },
    ],
    parameters: [],
  },
];

function completionContext(
  doc: string,
  explicit = false,
  position = doc.length,
) {
  const state = EditorState.create({
    doc,
    selection: { anchor: position },
    extensions: [sql({ dialect: MSSQL, upperCaseKeywords: true })],
  });
  return new CompletionContext(state, position, explicit);
}

describe("SQL completion", () => {
  beforeEach(() => {
    invalidateSchemaCatalog();
    setInvokeHandler((command) => {
      if (command === "get_database_schema_catalog") return entries;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("suggests matching T-SQL keywords", async () => {
    const result = await sqlCompletionSource(completionContext("SEL"), {});

    expect(result?.from).toBe(0);
    expect(result?.options.some((option) => option.label === "SELECT")).toBe(
      true,
    );
  });

  it("does not offer completions inside comments", async () => {
    await expect(
      sqlCompletionSource(completionContext("-- SEL"), {}),
    ).resolves.toBeNull();
  });

  it("loads schema entries for qualified table completion", async () => {
    const result = await sqlCompletionSource(
      completionContext("SELECT * FROM dbo.Us"),
      { currentDatabase: "app", databases: ["app"] },
    );

    expect(result?.options.some((option) => option.label === "Users")).toBe(
      true,
    );
    expect(invokeMock).toHaveBeenCalledWith("get_database_schema_catalog", {
      database: "app",
    });
  });

  it("offers columns for a known table alias", async () => {
    const result = await sqlCompletionSource(
      completionContext(
        "SELECT u.Dis FROM dbo.Users u",
        false,
        "SELECT u.Dis".length,
      ),
      { currentDatabase: "app" },
    );

    expect(
      result?.options.some((option) => option.label === "DisplayName"),
    ).toBe(true);
  });
});
