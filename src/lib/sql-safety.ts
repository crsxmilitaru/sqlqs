export type DestructiveKind = "UPDATE" | "DELETE" | "TRUNCATE" | "MERGE";

export interface UnguardedStatement {
  kind: DestructiveKind;
  preview: string;
}

function stripStringsAndComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      out += "  ";
      i += 2;
      while (i < n && sql[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < n) {
        if (sql[i] === "*" && sql[i + 1] === "/") {
          out += "  ";
          i += 2;
          break;
        }
        out += sql[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (ch === "'") {
      out += " ";
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "  ";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          out += " ";
          i++;
          break;
        }
        out += sql[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (ch === "[") {
      out += "[";
      i++;
      while (i < n && sql[i] !== "]") {
        out += sql[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "]";
        i++;
      }
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

function isWordChar(c: string | undefined): boolean {
  return !!c && /[A-Za-z0-9_@#]/.test(c);
}

function splitStatements(sql: string): { text: string; offset: number }[] {
  const result: { text: string; offset: number }[] = [];
  let buf = "";
  let start = 0;
  let lineStart = true;

  const flush = () => {
    if (buf.trim()) result.push({ text: buf, offset: start });
    buf = "";
  };

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (ch === ";") {
      flush();
      start = i + 1;
      lineStart = true;
      continue;
    }

    if (lineStart && (ch === "G" || ch === "g")) {
      const next = sql[i + 1];
      if (next === "O" || next === "o") {
        const after = sql[i + 2];
        if (!isWordChar(after)) {
          let j = i + 2;
          while (
            j < sql.length &&
            sql[j] !== "\n" &&
            (sql[j] === " " || sql[j] === "\t" || sql[j] === "\r")
          ) {
            j++;
          }
          if (j >= sql.length || sql[j] === "\n") {
            flush();
            start = j < sql.length ? j + 1 : j;
            i = j;
            lineStart = true;
            continue;
          }
        }
      }
    }

    buf += ch;
    if (ch === "\n") lineStart = true;
    else if (ch !== " " && ch !== "\t" && ch !== "\r") lineStart = false;
  }

  flush();
  return result;
}

interface OpMatch {
  kind: DestructiveKind;
  pos: number;
  len: number;
}

const KEYWORDS: { kind: DestructiveKind; len: number }[] = [
  { kind: "TRUNCATE", len: 8 },
  { kind: "DELETE", len: 6 },
  { kind: "UPDATE", len: 6 },
  { kind: "MERGE", len: 5 },
];

function findTopLevelOps(text: string): OpMatch[] {
  const found: OpMatch[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth !== 0) continue;

    const prev = i > 0 ? text[i - 1] : "";
    if (isWordChar(prev)) continue;
    if (!/[A-Za-z]/.test(c)) continue;

    for (const kw of KEYWORDS) {
      if (i + kw.len > text.length) continue;
      const slice = text.slice(i, i + kw.len).toUpperCase();
      if (slice !== kw.kind) continue;
      if (isWordChar(text[i + kw.len])) continue;
      found.push({ kind: kw.kind, pos: i, len: kw.len });
      i += kw.len - 1;
      break;
    }
  }
  return found;
}

function hasTopLevelWhereAfter(text: string, startPos: number): boolean {
  let depth = 0;
  for (let i = startPos; i < text.length; i++) {
    const c = text[i];
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth !== 0) continue;
    if (c !== "W" && c !== "w") continue;
    if (isWordChar(text[i - 1])) continue;
    if (i + 5 > text.length) continue;
    if (text.slice(i, i + 5).toUpperCase() !== "WHERE") continue;
    if (isWordChar(text[i + 5])) continue;
    return true;
  }
  return false;
}

function previewFor(original: string, offset: number, len: number): string {
  const slice = original.slice(offset, offset + len).trim();
  return slice.length > 100 ? `${slice.slice(0, 100)}…` : slice;
}

export function findUnguardedDestructiveStatements(
  sql: string,
): UnguardedStatement[] {
  const stripped = stripStringsAndComments(sql);
  const statements = splitStatements(stripped);
  const results: UnguardedStatement[] = [];

  for (const stmt of statements) {
    const ops = findTopLevelOps(stmt.text);
    let mergeReported = false;
    for (const op of ops) {
      if (op.kind === "MERGE") {
        if (mergeReported) continue;
        mergeReported = true;
        results.push({
          kind: "MERGE",
          preview: previewFor(sql, stmt.offset, stmt.text.length),
        });
        continue;
      }
      if (op.kind === "TRUNCATE") {
        results.push({
          kind: "TRUNCATE",
          preview: previewFor(sql, stmt.offset, stmt.text.length),
        });
        continue;
      }
      if (mergeReported) continue;
      if (!hasTopLevelWhereAfter(stmt.text, op.pos + op.len)) {
        results.push({
          kind: op.kind,
          preview: previewFor(sql, stmt.offset, stmt.text.length),
        });
      }
    }
  }

  return results;
}
