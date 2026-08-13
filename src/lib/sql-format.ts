import { loadFormatPreferences } from "./settings";

type KeywordCase = "upper" | "lower" | "preserve";

export async function formatSqlWithPrefs(sql: string): Promise<string> {
  const { format } = await import("sql-formatter");
  const prefs = loadFormatPreferences();
  const keywordCase: KeywordCase =
    prefs.keywordCase === "upper"
      ? "upper"
      : prefs.keywordCase === "lower"
        ? "lower"
        : "preserve";
  return format(sql, {
    language: "tsql",
    keywordCase,
    tabWidth: prefs.indentSize,
    useTabs: false,
    ...(prefs.maxLineLength > 0
      ? { expressionWidth: prefs.maxLineLength }
      : {}),
  });
}
