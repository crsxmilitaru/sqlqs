import { describe, expect, it } from "vitest";
import type { ColumnInfo, QueryResult } from "./types";
import {
  buildKeyColumnsSql,
  buildMultiCompareScript,
  buildMultiDiffSql,
  hasTableInDatabase,
  intersectCompareColumnsAcross,
  isNonHashableType,
  isPresentColumn,
  missingKeyColumnsAcross,
  parseKeyColumnsResult,
  parseMultiCountResult,
  parseValueColumn,
  pickComparableColumns,
  threePartTable,
  uniqueCompareColumns,
  valueColumn,
  type MultiCompareOptions,
} from "./table-compare";

function column(name: string, typeName: string): ColumnInfo {
  return {
    name,
    type_name: typeName,
    is_identity: false,
    is_nullable: true,
  };
}

function queryResult(rows: QueryResult["result_sets"][number]["rows"]): QueryResult {
  return {
    result_sets: [{ columns: [], rows }],
    rows_affected: 0,
    messages: [],
    elapsed_ms: 1,
    outputs: [],
  };
}

const options: MultiCompareOptions = {
  schema: "dbo",
  table: "Users",
  databases: ["app", "archive"],
  keyColumns: ["Id"],
  compareColumns: ["Id", "Name"],
  whereClause: "IsActive = 1",
  rowLimit: 25,
};

describe("table comparison metadata", () => {
  it("quotes complete table names", () => {
    expect(
      threePartTable({
        database: "Sales]Archive",
        schema: "reporting",
        table: "Order Lines",
      }),
    ).toBe("[Sales]]Archive].[reporting].[Order Lines]");
  });

  it("excludes keys and non-hashable values", () => {
    const columns = [
      column("Id", "int"),
      column("Name", "nvarchar(100)"),
      column("Payload", "xml"),
    ];

    expect(isNonHashableType("XML")).toBe(true);
    expect(pickComparableColumns(columns, ["id"]).map((item) => item.name))
      .toEqual(["Name"]);
    expect(uniqueCompareColumns(["ID"], ["Id", "Name"])).toEqual(["Name"]);
  });

  it("keeps only comparable columns shared by every database", () => {
    const result = intersectCompareColumnsAcross(
      [
        [column("Id", "int"), column("Name", "nvarchar"), column("Age", "int")],
        [column("Id", "int"), column("Name", "nvarchar")],
      ],
      ["Id"],
    );

    expect(result.compare.map((item) => item.name)).toEqual(["Name"]);
    expect(result.ignored).toEqual(["Age"]);
    expect(
      missingKeyColumnsAcross([[column("Id", "int")], [column("Name", "nvarchar")]], [
        "Id",
      ]),
    ).toEqual(["Id"]);
  });

  it("encodes and parses generated comparison columns", () => {
    expect(valueColumn("DisplayName", 2)).toBe("DisplayName__db2");
    expect(parseValueColumn("DisplayName__db2")).toEqual({
      column: "DisplayName",
      index: 2,
    });
    expect(parseValueColumn("DisplayName")).toBeNull();
    expect(isPresentColumn("present__db3")).toBe(true);
  });
});

describe("table comparison SQL", () => {
  it("builds primary and unique key discovery queries", () => {
    const ref = { database: "app", schema: "dbo", table: "Users" };

    expect(buildKeyColumnsSql(ref)).toContain("i.is_primary_key = 1");
    expect(buildKeyColumnsSql(ref, false)).toContain("i.is_unique = 1");
    expect(buildKeyColumnsSql(ref)).toContain("OBJECT_ID(N'app.dbo.Users')");
  });

  it("builds bounded multi-database comparison SQL", () => {
    const script = buildMultiCompareScript(options);

    expect(script).toContain("FROM [app].[dbo].[Users] d0");
    expect(script).toContain("FROM [archive].[dbo].[Users] d1");
    expect(script).toContain("WHERE (IsActive = 1)");
    expect(script).toContain("SELECT TOP (25)");
    expect(script).toContain("[Name__db0]");
    expect(script).not.toContain("[Id__db0]");
  });

  it("validates keys and database count", () => {
    expect(() =>
      buildMultiDiffSql({ ...options, keyColumns: [] }),
    ).toThrow("At least one key column is required.");
    expect(() =>
      buildMultiDiffSql({ ...options, databases: ["app"] }),
    ).toThrow("Select at least two databases.");
  });
});

describe("table comparison results", () => {
  it("parses key and count result sets", () => {
    expect(parseKeyColumnsResult(queryResult([["Id"], [" TenantId "], [null]])))
      .toEqual(["Id", "TenantId"]);
    expect(parseMultiCountResult(queryResult([[4, 2, 1]]))).toEqual({
      matching: 4,
      missing: 2,
      changed: 1,
    });
  });

  it("finds a table with case-insensitive schema and name matching", () => {
    expect(
      hasTableInDatabase(
        [{ name: "Users", schema_name: "dbo", object_type: "TABLE" }],
        "DBO",
        "users",
      ),
    ).toBe(true);
  });
});
