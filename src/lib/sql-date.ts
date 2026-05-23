import type { DateFormat } from "./settings";
import { formatLocalDateTime } from "./system-locale";

export const NAIVE_DATE_TYPES = new Set([
  "date",
  "datetime",
  "datetime2",
  "smalldatetime",
]);
export const ALL_DATE_TYPES = new Set([...NAIVE_DATE_TYPES, "datetimeoffset"]);

const SQL_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/;

export interface SqlTimestampParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hasTime: boolean;
  hasOffset: boolean;
}

export function parseSqlTimestamp(str: string): SqlTimestampParts | null {
  const m = SQL_TIMESTAMP_RE.exec(str);
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: m[4] ? Number(m[4]) : 0,
    minute: m[5] ? Number(m[5]) : 0,
    second: m[6] ? Number(m[6]) : 0,
    hasTime: m[4] != null,
    hasOffset: m[7] != null,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatParts(p: SqlTimestampParts, withTime: boolean): string {
  return formatByPattern(p, "YYYY-MM-DD HH:mm:ss", withTime);
}

function formatByPattern(
  p: SqlTimestampParts,
  format: DateFormat,
  withTime: boolean,
): string {
  let datePart: string;
  let timeSep = " ";
  switch (format) {
    case "iso":
      datePart = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
      timeSep = "T";
      break;
    case "DD/MM/YYYY HH:mm:ss":
      datePart = `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
      break;
    case "MM/DD/YYYY HH:mm:ss":
      datePart = `${pad2(p.month)}/${pad2(p.day)}/${p.year}`;
      break;
    case "DD.MM.YYYY HH:mm:ss":
      datePart = `${pad2(p.day)}.${pad2(p.month)}.${p.year}`;
      break;
    default:
      datePart = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
      break;
  }
  if (!withTime) return datePart;
  return `${datePart}${timeSep}${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
}

export function formatTimestamp(
  value: number | string | Date | null | undefined,
  dateFormat: DateFormat,
  withTime: boolean = true,
): string {
  if (value === null || value === undefined) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);

  if (dateFormat === "local") {
    return formatLocalDateTime(d, withTime);
  }

  if (dateFormat === "utc") {
    const utcParts: SqlTimestampParts = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      hasTime: true,
      hasOffset: true,
    };
    return `${formatParts(utcParts, withTime)} UTC`;
  }

  const parts: SqlTimestampParts = {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
    hasTime: true,
    hasOffset: false,
  };
  return formatByPattern(parts, dateFormat, withTime);
}

export function formatSqlDateValue(
  val: unknown,
  typeName: string,
  dateFormat: DateFormat,
): string {
  if (val == null) return "NULL";
  const str = String(val);

  const baseType = typeName.split("(")[0].toLowerCase();
  if (!ALL_DATE_TYPES.has(baseType)) return str;

  const parsed = parseSqlTimestamp(str);
  if (!parsed) return str;

  const isDateOnly = baseType === "date";
  const withTime = !isDateOnly && parsed.hasTime;

  // Naive types (date, datetime, datetime2, smalldatetime) carry no timezone
  // information from SQL Server. Never round-trip through Date, which would
  // reinterpret them as local time and produce shifted output.
  if (!parsed.hasOffset) {
    if (dateFormat === "local") {
      const d = new Date(
        parsed.year,
        parsed.month - 1,
        parsed.day,
        parsed.hour,
        parsed.minute,
        parsed.second,
      );
      if (Number.isNaN(d.getTime())) return formatByPattern(parsed, dateFormat, withTime);
      return formatLocalDateTime(d, !isDateOnly);
    }
    return formatByPattern(parsed, dateFormat, withTime);
  }

  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return formatByPattern(parsed, dateFormat, withTime);

  if (dateFormat === "local") {
    return formatLocalDateTime(d, !isDateOnly);
  }
  if (dateFormat === "utc") {
    const utcParts: SqlTimestampParts = {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      hasTime: true,
      hasOffset: true,
    };
    return `${formatParts(utcParts, withTime)} UTC`;
  }
  return formatByPattern(parsed, dateFormat, withTime);
}
