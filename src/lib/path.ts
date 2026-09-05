export function joinPath(...segments: string[]): string {
  const filtered = segments.filter(Boolean);
  const isUnc = filtered.length > 0 && /^[\\/]{2}/.test(filtered[0]);

  const joined = filtered
    .map((segment, index) => {
      const normalized = segment.replace(/\\/g, "/");
      return index === 0
        ? normalized.replace(/\/+$/g, "")
        : normalized.replace(/^\/+|\/+$/g, "");
    })
    .join("/");

  if (/^[A-Za-z]:/.test(joined)) {
    return joined.replace(/\//g, "\\");
  }
  if (isUnc) {
    return "\\\\" + joined.replace(/^\/+/, "").replace(/\//g, "\\");
  }
  return joined;
}

export function getSavedQueriesDir(documentsPath: string): string {
  return joinPath(documentsPath, "SQL Query Studio", "Queries");
}

export function getThemesDir(documentsPath: string): string {
  return joinPath(documentsPath, "SQL Query Studio", "Themes");
}

export function sanitizeSavedQueryFileName(title: string): string {
  const sanitized = title.replace(/[<>:"/\\|?*]/g, "_").trim() || "Query";
  return `${sanitized}.sql`;
}

export function baseFileName(path: string): string {
  const lastSep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return lastSep >= 0 ? path.slice(lastSep + 1) : path;
}

export function normalizePath(path: string): string {
  const clean = path.startsWith("saved:") ? path.slice("saved:".length) : path;
  return clean.replace(/\\/g, "/").toLowerCase();
}

export function isSamePath(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}

export function resolveSavedQueryFilePath(
  tabOrSource?: { savedQueryFilePath?: string; sourceId?: string } | string | null,
): string | undefined {
  if (!tabOrSource) return undefined;
  if (typeof tabOrSource === "string") {
    return tabOrSource.startsWith("saved:")
      ? tabOrSource.slice("saved:".length)
      : tabOrSource;
  }
  return (
    tabOrSource.savedQueryFilePath ??
    (tabOrSource.sourceId?.startsWith("saved:")
      ? tabOrSource.sourceId.slice("saved:".length)
      : undefined)
  );
}
