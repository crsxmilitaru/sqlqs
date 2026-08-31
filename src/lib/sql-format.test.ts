import { beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "sql-formatter";
import { loadFormatPreferences } from "./settings";
import { formatSqlWithPrefs } from "./sql-format";

vi.mock("sql-formatter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sql-formatter")>();
  return {
    ...actual,
    format: vi.fn((sql: string, opts?: any) => actual.format(sql, opts)),
  };
});

vi.mock("./settings", () => ({
  loadFormatPreferences: vi.fn(),
}));

describe("formatSqlWithPrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "expanded",
      indentSize: 4,
      keywordCase: "lower",
    });
  });

  it("passes SQL formatting preferences to the T-SQL formatter", async () => {
    await expect(formatSqlWithPrefs("SELECT 1")).resolves.toBe("select\n    1");

    expect(format).toHaveBeenCalledWith("SELECT 1", {
      language: "tsql",
      keywordCase: "lower",
      tabWidth: 4,
      useTabs: false,
      linesBetweenQueries: 1,
    });
  });

  it("preserves keyword case in expanded mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "expanded",
      indentSize: 2,
      keywordCase: "preserve",
    });

    await formatSqlWithPrefs("SELECT 1");

    expect(format).toHaveBeenCalledWith("SELECT 1", {
      language: "tsql",
      keywordCase: "preserve",
      tabWidth: 2,
      useTabs: false,
      linesBetweenQueries: 1,
    });
  });

  it("passes linesBetweenQueries as 0 when format style is compact", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    await formatSqlWithPrefs("SELECT 1; SELECT 2;");

    expect(format).toHaveBeenCalledWith("SELECT 1; SELECT 2;", {
      language: "tsql",
      keywordCase: "upper",
      tabWidth: 2,
      useTabs: false,
      linesBetweenQueries: 0,
    });
  });

  it("breaks clause keywords onto separate lines in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql = "SELECT id, name FROM dbo.users WHERE id = 1 AND is_active = 1;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "SELECT id, name",
        "FROM dbo.users",
        "WHERE id = 1 AND is_active = 1;",
      ].join("\n"),
    );
  });

  it("separates statements onto new lines in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql = "SELECT 1; SELECT 2; SELECT 3;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      "SELECT 1;\nSELECT 2;\nSELECT 3;",
    );
  });

  it("preserves source blank lines between compact statements", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql = "SELECT 1;\n\nSELECT 2;\nSELECT 3;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      "SELECT 1;\n\nSELECT 2;\nSELECT 3;",
    );

    const procedureSql =
      "CREATE PROCEDURE dbo.GetUser @Id INT AS\n\nDECLARE @name NVARCHAR(50);\n\nSELECT @Id;";
    await expect(formatSqlWithPrefs(procedureSql)).resolves.toBe(
      [
        "CREATE PROCEDURE dbo.GetUser",
        "  @Id INT",
        "AS",
        "",
        "DECLARE @name NVARCHAR(50);",
        "",
        "SELECT @Id;",
      ].join("\n"),
    );
  });

  it("indents procedure parameters and block bodies in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "CREATE PROCEDURE dbo.GetUser @Id INT, @Name NVARCHAR(50) = NULL AS BEGIN SELECT @Id, @Name; END;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "CREATE PROCEDURE dbo.GetUser",
        "  @Id INT,",
        "  @Name NVARCHAR(50) = NULL",
        "AS",
        "BEGIN",
        "  SELECT @Id, @Name;",
        "END;",
      ].join("\n"),
    );
  });

  it("formats CREATE TABLE column definitions across indented lines", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "CREATE TABLE dbo.Users (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(100) NULL, CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE());";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "CREATE TABLE dbo.Users(",
        "  Id INT NOT NULL PRIMARY KEY,",
        "  Name NVARCHAR(100) NULL,",
        "  CreatedAt DATETIME2 NOT NULL DEFAULT GETDATE()",
        ");",
      ].join("\n"),
    );
  });

  it("handles IF, WHILE, and ELSE statements with appropriate indentation", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const ifSql =
      "IF @x > 0 PRINT 'positive'; ELSE IF @x < 0 PRINT 'negative'; ELSE PRINT 'zero';";
    await expect(formatSqlWithPrefs(ifSql)).resolves.toBe(
      [
        "IF @x > 0",
        "  PRINT 'positive';",
        "ELSE IF @x < 0",
        "  PRINT 'negative';",
        "ELSE",
        "  PRINT 'zero';",
      ].join("\n"),
    );

    const whileSql =
      "WHILE @count < 10 BEGIN SET @count = @count + 1; PRINT @count; END;";
    await expect(formatSqlWithPrefs(whileSql)).resolves.toBe(
      [
        "WHILE @count < 10",
        "BEGIN",
        "  SET @count = @count + 1;",
        "  PRINT @count;",
        "END;",
      ].join("\n"),
    );
  });

  it("preserves Unicode identifiers, labels, and scientific notation in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql = "SELECT café, 1e-3, 1.0E+3 FROM dbo.Users;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      ["SELECT café, 1e-3, 1.0E+3", "FROM dbo.Users;"].join("\n"),
    );

    await expect(formatSqlWithPrefs("Retry: WHILE @x < 1 BREAK;")).resolves.toContain(
      "Retry:",
    );
  });

  it("keeps TRY/CATCH and distributed transaction boundaries together", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const tryCatchSql =
      "BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT 2; END CATCH;";
    await expect(formatSqlWithPrefs(tryCatchSql)).resolves.toBe(
      [
        "BEGIN TRY",
        "  SELECT 1;",
        "END TRY",
        "BEGIN CATCH",
        "  SELECT 2;",
        "END CATCH;",
      ].join("\n"),
    );

    const transactionSql =
      "BEGIN DISTRIBUTED TRANSACTION; UPDATE dbo.Users SET IsActive = 1; COMMIT TRANSACTION; SELECT 2;";
    await expect(formatSqlWithPrefs(transactionSql)).resolves.toBe(
      [
        "BEGIN DISTRIBUTED TRANSACTION;",
        "UPDATE dbo.Users SET IsActive = 1;",
        "COMMIT TRANSACTION;",
        "SELECT 2;",
      ].join("\n"),
    );

    const shortTranSql =
      "BEGIN DISTRIBUTED TRAN; UPDATE dbo.Users SET IsActive = 1; COMMIT TRAN; SELECT 2;";
    await expect(formatSqlWithPrefs(shortTranSql)).resolves.toBe(
      [
        "BEGIN DISTRIBUTED TRAN;",
        "UPDATE dbo.Users SET IsActive = 1;",
        "COMMIT TRAN;",
        "SELECT 2;",
      ].join("\n"),
    );
  });

  it("matches ELSE with the innermost unfinished IF", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "IF @a = 1 IF @b = 1 PRINT 1 ELSE PRINT 2 ELSE PRINT 3;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "IF @a = 1",
        "  IF @b = 1",
        "    PRINT 1",
        "  ELSE",
        "    PRINT 2",
        "ELSE",
        "  PRINT 3;",
      ].join("\n"),
    );
  });

  it("resets procedure indentation at a GO batch boundary", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "CREATE PROCEDURE dbo.GetUser @Id INT AS BEGIN SELECT @Id; END; GO SELECT 2;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "CREATE PROCEDURE dbo.GetUser",
        "  @Id INT",
        "AS",
        "BEGIN",
        "  SELECT @Id;",
        "END;",
        "GO",
        "SELECT 2;",
      ].join("\n"),
    );
  });

  it("keeps procedure indentation through nested blocks", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "CREATE PROCEDURE dbo.GetUser @Id INT AS BEGIN IF @Id > 0 BEGIN SELECT @Id; END; SELECT @Id; END;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "CREATE PROCEDURE dbo.GetUser",
        "  @Id INT",
        "AS",
        "BEGIN",
        "  IF @Id > 0",
        "  BEGIN",
        "    SELECT @Id;",
        "  END;",
        "  SELECT @Id;",
        "END;",
      ].join("\n"),
    );
  });

  it("preserves line comments, block comments, and quoted strings in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "-- fetch active users\nSELECT 'hello world', N'unicode string', [Column Name] FROM dbo.[User Table] /* inline block */ WHERE Id = 1;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "-- fetch active users",
        "SELECT 'hello world', N'unicode string', [Column Name]",
        "FROM dbo.[User Table] /* inline block */",
        "WHERE Id = 1;",
      ].join("\n"),
    );
  });

  it("formats inline CASE expressions and nested subquery parentheses in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "SELECT CASE WHEN Status = 1 THEN 'Active' WHEN Status = 2 THEN 'Pending' ELSE 'Inactive' END AS StatusLabel, COUNT(*) FROM dbo.Users WHERE Id IN (SELECT UserId FROM dbo.ActiveLogins WHERE LoggedInAt >= DATEADD(DAY, 7, GETDATE())) GROUP BY Status;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "SELECT CASE WHEN Status = 1 THEN 'Active' WHEN Status = 2 THEN 'Pending' ELSE 'Inactive' END AS StatusLabel, COUNT(*)",
        "FROM dbo.Users",
        "WHERE Id IN (SELECT UserId FROM dbo.ActiveLogins WHERE LoggedInAt >= DATEADD(DAY, 7, GETDATE()))",
        "GROUP BY Status;",
      ].join("\n"),
    );
  });

  it("puts JOIN keywords and ON clauses on separate lines", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "SELECT u.Id, o.Total FROM dbo.Users u INNER JOIN dbo.Orders o ON u.Id = o.UserId LEFT JOIN dbo.Items i ON o.Id = i.OrderId WHERE u.IsActive = 1;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "SELECT u.Id, o.Total",
        "FROM dbo.Users u",
        "INNER JOIN dbo.Orders o",
        "ON u.Id = o.UserId",
        "LEFT JOIN dbo.Items i",
        "ON o.Id = i.OrderId",
        "WHERE u.IsActive = 1;",
      ].join("\n"),
    );
  });

  it("handles procedure parameters declared with AS and preserves multi-line parameter list", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "CREATE PROCEDURE dbo.GetUser @Id AS INT, @Name AS NVARCHAR(50) = NULL AS BEGIN SELECT @Id, @Name; END;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "CREATE PROCEDURE dbo.GetUser",
        "  @Id AS INT,",
        "  @Name AS NVARCHAR(50) = NULL",
        "AS",
        "BEGIN",
        "  SELECT @Id, @Name;",
        "END;",
      ].join("\n"),
    );
  });

  it("formats CTE queries across indented lines in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "WITH ActiveUsers AS (SELECT Id, Name FROM dbo.Users WHERE IsActive = 1), OrdersSummary AS (SELECT UserId, COUNT(*) AS TotalOrders FROM dbo.Orders GROUP BY UserId) SELECT u.Name, o.TotalOrders FROM ActiveUsers u LEFT JOIN OrdersSummary o ON u.Id = o.UserId;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "WITH ActiveUsers AS (",
        "  SELECT Id, Name",
        "  FROM dbo.Users",
        "  WHERE IsActive = 1",
        "),",
        "OrdersSummary AS (",
        "  SELECT UserId, COUNT(*) AS TotalOrders",
        "  FROM dbo.Orders",
        "  GROUP BY UserId",
        ")",
        "SELECT u.Name, o.TotalOrders",
        "FROM ActiveUsers u",
        "LEFT JOIN OrdersSummary o",
        "ON u.Id = o.UserId;",
      ].join("\n"),
    );
  });

  it("keeps DELETE FROM on the same line in compact mode", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql = "DELETE FROM dbo.Users WHERE Id = 1 AND IsActive = 0;";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "DELETE FROM dbo.Users",
        "WHERE Id = 1 AND IsActive = 0;",
      ].join("\n"),
    );
  });

  it("formats CREATE TYPE AS TABLE column definitions across indented lines", async () => {
    vi.mocked(loadFormatPreferences).mockReturnValue({
      formatStyle: "compact",
      indentSize: 2,
      keywordCase: "upper",
    });

    const sql =
      "CREATE TYPE [dbo].[IntVarcharIdList] AS TABLE([id] [int] NULL, [status] [varchar](50) NULL);";
    await expect(formatSqlWithPrefs(sql)).resolves.toBe(
      [
        "CREATE TYPE [dbo].[IntVarcharIdList] AS TABLE (",
        "  [id] [int] NULL,",
        "  [status] [varchar](50) NULL",
        ");",
      ].join("\n"),
    );
  });
});
