import { format, type KeywordCase } from "sql-formatter";
import { loadFormatPreferences } from "./settings";

export function formatSqlWithPrefs(sql: string): string {
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
