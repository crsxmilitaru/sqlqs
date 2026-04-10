export function joinPath(...segments: string[]): string {
  const joined = segments
    .filter(Boolean)
    .map((segment, index) => {
      const normalized = segment.replace(/\\/g, "/");
      return index === 0
        ? normalized.replace(/\/+$/g, "")
        : normalized.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
  // Preserve native backslashes on Windows paths (e.g. C:/Users → C:\Users)
  if (/^[A-Za-z]:/.test(joined)) {
    return joined.replace(/\//g, "\\");
  }
  return joined;
}

export function getSavedQueriesDir(documentsPath: string): string {
  return joinPath(documentsPath, "SQL Query Studio", "Queries");
}
