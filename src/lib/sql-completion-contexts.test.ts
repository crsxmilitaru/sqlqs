import { CompletionContext } from "@codemirror/autocomplete";
import { MSSQL, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSchemaCatalogEntry } from "./types";
import { invalidateSchemaCatalog } from "./schema-catalog";
import { setInvokeHandler } from "../test/tauri";
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
        name: "Email",
        type_name: "nvarchar",
        is_nullable: false,
        is_identity: false,
        is_primary_key: false,
      },
    ],
    parameters: [],
  },
  {
    schema_name: "dbo",
    object_name: "Orders",
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
        name: "UserId",
        type_name: "int",
        is_nullable: true,
        is_identity: false,
        is_primary_key: false,
      },
      {
        name: "Total",
        type_name: "decimal",
        is_nullable: false,
        is_identity: false,
        is_primary_key: false,
      },
    ],
    parameters: [],
  },
  {
    schema_name: "dbo",
    object_name: "GetUser",
    object_kind: "PROCEDURE",
    columns: [],
    parameters: [
      {
        name: "@UserId",
        type_name: "int",
        is_output: false,
      },
    ],
  },
  {
    schema_name: "dbo",
    object_name: "SplitValues",
    object_kind: "FUNCTION",
    columns: [
      {
        name: "Value",
        type_name: "nvarchar",
        is_nullable: true,
        is_identity: false,
        is_primary_key: false,
      },
    ],
    parameters: [
      { name: "@Input", type_name: "nvarchar", is_output: false },
    ],
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

function labels(result: { options: readonly { label: string }[] } | null) {
  return result?.options.map((option) => option.label) ?? [];
}

describe("SQL completion contexts", () => {
  beforeEach(() => {
    invalidateSchemaCatalog();
    setInvokeHandler((command) => {
      if (command === "get_database_schema_catalog") return entries;
      throw new Error(`Unexpected Tauri command: ${command}`);
    });
  });

  it("suggests CTE columns after the CTE definition", async () => {
    const doc = "WITH Recent AS (SELECT Id FROM dbo.Users)\nSELECT R. FROM Recent R";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.indexOf("R.") + 2),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("Id");
  });

  it("suggests columns of CTEs declared with column lists", async () => {
    const doc = "WITH c (Id, Email) AS (SELECT Id, Email FROM dbo.Users)\nSELECT c. FROM c";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.indexOf("c.") + 2),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("Email");
  });

  it("suggests columns of CREATE TABLE temp tables", async () => {
    const doc =
      "CREATE TABLE #t (A int, B nvarchar(50));\nSELECT #t. FROM #t;";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.lastIndexOf("#t.") + 4),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("A");
    expect(labels(result)).toContain("B");
  });

  it("suggests columns of derived tables", async () => {
    const doc =
      "SELECT x. FROM (SELECT Id, Total FROM dbo.Orders) AS x";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.indexOf("x.") + 2),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("Total");
  });

  it("suggests insertable columns inside INSERT lists", async () => {
    const doc = "INSERT INTO dbo.Users (Em) VALUES ('a')";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.indexOf("(Em") + 3),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("Email");
  });

  it("suggests procedure names after EXEC", async () => {
    const result = await sqlCompletionSource(
      completionContext("EXEC dbo.Get"),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("GetUser");
  });

  it("suggests procedure parameters inside EXEC arguments", async () => {
    const doc = "EXEC dbo.GetUser @";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.length),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("@UserId");
  });

  it("offers table names in FROM clauses", async () => {
    const result = await sqlCompletionSource(
      completionContext("SELECT * FROM de"),
      { currentDatabase: "app", databases: ["app", "archive"] },
    );

    const options = labels(result);
    expect(options.length).toBeGreaterThan(0);
    expect(options).toContain("Orders");
  });

  it("suggests schemas and tables through database-qualified paths", async () => {
    const result = await sqlCompletionSource(
      completionContext("SELECT * FROM app.db"),
      { currentDatabase: "app", databases: ["app"] },
    );

    expect(labels(result).length).toBeGreaterThan(0);
  });

  it("proposes join condition pairs after ON", async () => {
    const doc =
      "SELECT o.Id FROM dbo.Orders o INNER JOIN dbo.Users u ON ";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.length),
      { currentDatabase: "app" },
    );

    const options = labels(result);
    expect(
      options.some(
        (label) => label.includes("=") && label.includes("Id"),
      ),
    ).toBe(true);
  });

  it("suggests clause-appropriate keywords after WHERE", async () => {
    const doc = "SELECT * FROM dbo.Users WHERE ";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.length),
      { currentDatabase: "app" },
    );

    const options = labels(result);
    expect(options).toContain("AND");
    expect(options).toContain("LIKE");
    expect(options).toContain("BETWEEN");
  });

  it("suggests data types in DECLARE statements", async () => {
    const result = await sqlCompletionSource(
      completionContext("DECLARE @n IN"),
      {},
    );

    expect(labels(result)).toContain("INT");
  });

  it("suggests column-definition keywords inside CREATE TABLE", async () => {
    const doc = "CREATE TABLE #x (Id INT NOT ";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.length),
      {},
    );

    expect(labels(result)).toContain("NULL");
  });

  it("offers snippets at statement start", async () => {
    const result = await sqlCompletionSource(completionContext("ss"), {});

    expect(labels(result)).toContain("ssf");
  });

  it("filters columns by fuzzy typed prefixes", async () => {
    const doc = "SELECT u.Em FROM dbo.Users u";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.indexOf("u.Em") + 4),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("Email");
    expect(labels(result)).not.toContain("Id");
  });

  it("completes quoted identifiers with matching brackets", async () => {
    const doc = "SELECT * FROM [dbo].[Or";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.length),
      { currentDatabase: "app" },
    );

    expect(result?.options.some((o) => o.label === "[Orders]")).toBe(true);
  });

  it("suggests DDL targets after DROP TABLE", async () => {
    const result = await sqlCompletionSource(
      completionContext("DROP TABLE dbo.Or"),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("Orders");
    expect(labels(result)).not.toContain("GetUser");
  });

  it("suggests declared variables", async () => {
    const doc = "DECLARE @ids INT;\nSELECT @i";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.length),
      { currentDatabase: "app" },
    );

    expect(labels(result)).toContain("@ids");
  });

  it("returns null for empty option sets in comments-only documents", async () => {
    await expect(
      sqlCompletionSource(completionContext("/* SEL */", true, 4), {}),
    ).resolves.toBeNull();
  });

  it("avoids suggesting already-used INSERT columns", async () => {
    const doc = "INSERT INTO dbo.Orders (Id, To) VALUES (1, 2)";
    const result = await sqlCompletionSource(
      completionContext(doc, true, doc.indexOf("To") + 2),
      { currentDatabase: "app" },
    );

    const options = labels(result);
    expect(options).toContain("Total");
  });
});

