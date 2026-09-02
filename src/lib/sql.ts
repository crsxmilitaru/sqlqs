import { AiService } from "./ai";
import { loadPreferences } from "./settings";

const MAX_TAB_TITLE_LENGTH = 80;

export function generateTabTitle(sql: string): string {
  const line =
    sql.split(/\r?\n/).find((row) => row.trim().length > 0)?.trim() ?? "";
  if (!line) return "";
  if (line.length > MAX_TAB_TITLE_LENGTH) {
    return line.slice(0, MAX_TAB_TITLE_LENGTH - 3) + "...";
  }
  return line;
}

export async function resolveAutoTabTitle(sql: string): Promise<string> {
  const fallback = generateTabTitle(sql);
  if (loadPreferences().tabAutoNaming !== "ai") return fallback;
  try {
    const aiTitle = await AiService.generateTabTitle(sql);
    return aiTitle || fallback;
  } catch {
    return fallback;
  }
}

