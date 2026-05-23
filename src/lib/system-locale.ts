import { invoke } from "@tauri-apps/api/core";

interface SystemLocaleInfo {
  locale: string;
  short_date_pattern: string | null;
  short_time_pattern: string | null;
  long_time_pattern: string | null;
}

let cached: SystemLocaleInfo | undefined;

export async function initSystemLocale(): Promise<void> {
  try {
    const info = await invoke<SystemLocaleInfo>("get_system_locale");
    if (info && typeof info === "object" && typeof info.locale === "string") {
      cached = info;
    }
    console.info("[sqlqs] system locale info:", cached);
  } catch (err) {
    cached = undefined;
    console.warn("[sqlqs] failed to fetch system locale:", err);
  }
}

export function getSystemLocale(): string | undefined {
  return cached?.locale;
}

export function formatLocalDateTime(d: Date, withTime: boolean): string {
  const datePattern = cached?.short_date_pattern;
  const timePattern = cached?.long_time_pattern ?? cached?.short_time_pattern;

  if (!datePattern) {
    const locale = cached?.locale;
    return withTime ? d.toLocaleString(locale) : d.toLocaleDateString(locale);
  }

  const datePart = applyPattern(d, datePattern);
  if (!withTime || !timePattern) return datePart;
  return `${datePart}, ${applyPattern(d, timePattern)}`;
}

function applyPattern(d: Date, pattern: string): string {
  let result = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "'") {
      const end = pattern.indexOf("'", i + 1);
      if (end === -1) {
        result += pattern.slice(i + 1);
        break;
      }
      result += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < pattern.length && pattern[j] === c) j++;
      result += formatToken(d, pattern.slice(i, j));
      i = j;
    } else {
      result += c;
      i++;
    }
  }
  return result;
}

const localeOpt = () => cached?.locale;

function formatToken(d: Date, token: string): string {
  switch (token) {
    case "yyyy":
      return String(d.getFullYear()).padStart(4, "0");
    case "yy":
      return String(d.getFullYear() % 100).padStart(2, "0");
    case "y":
      return String(d.getFullYear());
    case "MMMM":
      return d.toLocaleString(localeOpt(), { month: "long" });
    case "MMM":
      return d.toLocaleString(localeOpt(), { month: "short" });
    case "MM":
      return String(d.getMonth() + 1).padStart(2, "0");
    case "M":
      return String(d.getMonth() + 1);
    case "dddd":
      return d.toLocaleString(localeOpt(), { weekday: "long" });
    case "ddd":
      return d.toLocaleString(localeOpt(), { weekday: "short" });
    case "dd":
      return String(d.getDate()).padStart(2, "0");
    case "d":
      return String(d.getDate());
    case "HH":
      return String(d.getHours()).padStart(2, "0");
    case "H":
      return String(d.getHours());
    case "hh": {
      const h = d.getHours() % 12 || 12;
      return String(h).padStart(2, "0");
    }
    case "h":
      return String(d.getHours() % 12 || 12);
    case "mm":
      return String(d.getMinutes()).padStart(2, "0");
    case "m":
      return String(d.getMinutes());
    case "ss":
      return String(d.getSeconds()).padStart(2, "0");
    case "s":
      return String(d.getSeconds());
    case "tt":
      return d.getHours() < 12 ? "AM" : "PM";
    case "t":
      return d.getHours() < 12 ? "A" : "P";
    case "gg":
    case "g":
      return "";
    default:
      return token;
  }
}
