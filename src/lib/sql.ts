export function generateTabTitle(sql: string): string {
  const s = sql.trim().replace(/\s+/g, " ");
  if (s.length > 80) {
    return s.substring(0, 77) + "...";
  }
  return s;
}

