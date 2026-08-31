import { describe, expect, it } from "vitest";
import { sqlLinter } from "./sql-linter";

function lint(sql: string) {
  const view = {
    state: {
      doc: {
        toString: () => sql,
      },
    },
  } as unknown as Parameters<typeof sqlLinter>[0];

  return sqlLinter(view);
}

describe("sqlLinter", () => {
  it("accepts valid SQL and empty input", () => {
    expect(lint("")).toEqual([]);
    expect(lint("SELECT Id FROM dbo.Users WHERE Id = 1")).toEqual([]);
    expect(lint("UPDATE dbo.Users SET Name = 'Jane' WHERE Id = 1")).toEqual(
      [],
    );
  });

  it("reports statements that start with FROM or WHERE", () => {
    expect(lint("FROM dbo.Users").map((item) => item.message)).toEqual([
      "FROM without a preceding SELECT, DELETE, or UPDATE",
    ]);
    expect(lint("WHERE Id = 1").map((item) => item.message)).toEqual([
      "WHERE without a preceding SELECT, UPDATE, or DELETE",
    ]);
  });

  it("reports malformed INSERT and UPDATE statements", () => {
    expect(lint("INSERT dbo.Users VALUES (1)")[0]?.message).toBe(
      "INSERT without INTO",
    );
    expect(lint("UPDATE dbo.Users WHERE Id = 1")[0]?.message).toBe(
      "UPDATE statement without SET clause",
    );
  });

  it("allows the T-SQL DELETE target syntax", () => {
    expect(lint("DELETE dbo.Users WHERE Id = 1")).toEqual([]);
  });

  it("reports SELECT statements that imply a missing FROM", () => {
    expect(lint("SELECT dbo.Users.Id WHERE Id = 1")[0]?.message).toBe(
      "SELECT statement without FROM clause",
    );
  });

  it("reports unclosed strings and unbalanced parentheses", () => {
    expect(lint("SELECT 'unfinished")[0]?.message).toBe(
      "Unclosed string literal",
    );
    expect(lint("SELECT (1")[0]?.message).toBe(
      "Unclosed parenthesis (1 unmatched)",
    );
    expect(lint("SELECT 1)")[0]?.message).toBe(
      "Unmatched closing parenthesis",
    );
  });

  it("requires BY after ORDER and GROUP", () => {
    expect(lint("SELECT Id FROM dbo.Users ORDER Id")[0]?.message).toBe(
      "ORDER without BY",
    );
    expect(lint("SELECT Id FROM dbo.Users GROUP Id")[0]?.message).toBe(
      "GROUP without BY",
    );
  });

  it("splits batches at GO", () => {
    expect(
      lint("SELECT 1\nGO\nFROM dbo.Users").map((item) => item.message),
    ).toEqual(["FROM without a preceding SELECT, DELETE, or UPDATE"]);
  });
});
