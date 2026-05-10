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

  // Convert to native Windows separators for drive-letter (`C:\…`) and UNC
  // (`\\server\share\…`) paths. Mac/Linux paths fall through with `/`.
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
