export function joinPath(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .map((segment, index) => {
      const normalized = segment.replace(/\\/g, "/");
      return index === 0
        ? normalized.replace(/\/+$/g, "")
        : normalized.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}

export function getSavedQueriesDir(documentsPath: string): string {
  return joinPath(documentsPath, "SQL Query Studio", "Saved Queries");
}
