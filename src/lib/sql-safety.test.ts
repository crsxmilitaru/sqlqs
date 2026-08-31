import { describe, expect, it } from "vitest";
import { findUnguardedDestructiveStatements } from "./sql-safety";

describe("findUnguardedDestructiveStatements", () => {
  it("flags UPDATE and DELETE statements without a WHERE clause", () => {
    expect(
      findUnguardedDestructiveStatements(
        "UPDATE dbo.Users SET IsActive = 0; DELETE FROM dbo.Sessions",
      ),
    ).toEqual([
      {
        kind: "UPDATE",
        preview: "UPDATE dbo.Users SET IsActive = 0",
      },
      {
        kind: "DELETE",
        preview: "DELETE FROM dbo.Sessions",
      },
    ]);
  });

  it("allows UPDATE and DELETE statements with top-level WHERE clauses", () => {
    expect(
      findUnguardedDestructiveStatements(
        "UPDATE dbo.Users SET IsActive = 0 WHERE Id = 1; DELETE FROM dbo.Sessions WHERE ExpiresAt < GETDATE()",
      ),
    ).toEqual([]);
  });

  it("does not count a nested WHERE as a guard", () => {
    expect(
      findUnguardedDestructiveStatements(
        "UPDATE dbo.Users SET Score = (SELECT MAX(Score) FROM dbo.Archive WHERE Archive.UserId = Users.Id)",
      ).map((item) => item.kind),
    ).toEqual(["UPDATE"]);
  });

  it("always flags TRUNCATE and reports MERGE once", () => {
    const sql = [
      "TRUNCATE TABLE dbo.Logs",
      "GO",
      "MERGE dbo.Users AS target",
      "USING dbo.PendingUsers AS source ON source.Id = target.Id",
      "WHEN MATCHED THEN UPDATE SET target.Name = source.Name",
      "WHEN NOT MATCHED THEN INSERT (Id, Name) VALUES (source.Id, source.Name);",
    ].join("\n");

    expect(
      findUnguardedDestructiveStatements(sql).map((item) => item.kind),
    ).toEqual(["TRUNCATE", "MERGE"]);
  });

  it("ignores destructive keywords in strings, comments, and identifiers", () => {
    const sql = [
      "SELECT 'DELETE FROM dbo.Users';",
      "-- UPDATE dbo.Users SET IsActive = 0",
      "/* TRUNCATE TABLE dbo.Logs */",
      "SELECT [MERGE] FROM dbo.AuditLog;",
    ].join("\n");

    expect(findUnguardedDestructiveStatements(sql)).toEqual([]);
  });

  it("splits batches at semicolons and GO", () => {
    const sql = [
      "UPDATE dbo.Users SET IsActive = 0 WHERE Id = 1;",
      "DELETE FROM dbo.Sessions",
      "GO",
      "TRUNCATE TABLE dbo.Logs",
    ].join("\n");

    expect(
      findUnguardedDestructiveStatements(sql).map((item) => item.kind),
    ).toEqual(["DELETE", "TRUNCATE"]);
  });

  it("limits previews to 100 characters", () => {
    const result = findUnguardedDestructiveStatements(
      `UPDATE dbo.Users SET Name = '${"x".repeat(120)}'`,
    );

    expect(result[0]?.preview).toHaveLength(101);
    expect(result[0]?.preview.endsWith("…")).toBe(true);
  });
});
