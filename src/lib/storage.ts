export function loadStoredStringSet(key: string, fallback: Set<string>): Set<string> {
  let parsed: unknown;
  try {
    const raw = localStorage.getItem(key);
    if (raw) parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  return Array.isArray(parsed) ? new Set<string>(parsed) : fallback;
}
