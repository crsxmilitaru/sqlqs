import { type Diagnostic } from "@codemirror/lint";
import type { EditorView } from "@codemirror/view";

const SQL_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "INSERT",
  "INTO",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
  "TABLE",
  "VIEW",
  "INDEX",
  "PROCEDURE",
  "FUNCTION",
  "TRIGGER",
  "BEGIN",
  "END",
  "IF",
  "ELSE",
  "WHILE",
  "RETURN",
  "DECLARE",
  "EXEC",
  "EXECUTE",
  "WITH",
  "AS",
  "JOIN",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "EXISTS",
  "BETWEEN",
  "LIKE",
  "IS",
  "NULL",
  "CASE",
  "WHEN",
  "THEN",
  "ORDER",
  "BY",
  "GROUP",
  "HAVING",
  "UNION",
  "ALL",
  "TOP",
  "DISTINCT",
  "VALUES",
  "GO",
  "USE",
  "GRANT",
  "REVOKE",
  "DENY",
  "MERGE",
  "TRUNCATE",
  "ROLLBACK",
  "COMMIT",
  "TRANSACTION",
  "TRY",
  "CATCH",
  "THROW",
  "PRINT",
  "RAISERROR",
]);

interface Token {
  type:
    | "keyword"
    | "string"
    | "comment"
    | "paren"
    | "operator"
    | "identifier"
    | "number"
    | "semicolon"
    | "comma"
    | "other";
  value: string;
  from: number;
  to: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }

    if (text[i] === "-" && text[i + 1] === "-") {
      const start = i;
      while (i < text.length && text[i] !== "\n") i++;
      tokens.push({
        type: "comment",
        value: text.slice(start, i),
        from: start,
        to: i,
      });
      continue;
    }

    if (text[i] === "/" && text[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/"))
        i++;
      if (i < text.length - 1) i += 2;
      else i = text.length;
      tokens.push({
        type: "comment",
        value: text.slice(start, i),
        from: start,
        to: i,
      });
      continue;
    }

    if (text[i] === "'") {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
        } else if (text[i] === "'") {
          i++;
          break;
        } else {
          i++;
        }
      }
      tokens.push({
        type: "string",
        value: text.slice(start, i),
        from: start,
        to: i,
      });
      continue;
    }

    if (text[i] === "[") {
      const start = i;
      i++;
      while (i < text.length && text[i] !== "]") i++;
      if (i < text.length) i++;
      tokens.push({
        type: "identifier",
        value: text.slice(start, i),
        from: start,
        to: i,
      });
      continue;
    }

    if (text[i] === "(" || text[i] === ")") {
      tokens.push({ type: "paren", value: text[i], from: i, to: i + 1 });
      i++;
      continue;
    }

    if (text[i] === ";") {
      tokens.push({ type: "semicolon", value: ";", from: i, to: i + 1 });
      i++;
      continue;
    }

    if (text[i] === ",") {
      tokens.push({ type: "comma", value: ",", from: i, to: i + 1 });
      i++;
      continue;
    }

    if (/[+\-*/<>=!%&|^~]/.test(text[i])) {
      const start = i;
      while (i < text.length && /[+\-*/<>=!%&|^~]/.test(text[i])) i++;
      tokens.push({
        type: "operator",
        value: text.slice(start, i),
        from: start,
        to: i,
      });
      continue;
    }

    if (/\d/.test(text[i])) {
      const start = i;
      while (i < text.length && /[\d.]/.test(text[i])) i++;
      tokens.push({
        type: "number",
        value: text.slice(start, i),
        from: start,
        to: i,
      });
      continue;
    }

    if (/[a-zA-Z_@#]/.test(text[i])) {
      const start = i;
      while (i < text.length && /[a-zA-Z0-9_@#$.]/.test(text[i])) i++;
      const word = text.slice(start, i);
      const upper = word.toUpperCase();
      tokens.push({
        type: SQL_KEYWORDS.has(upper) ? "keyword" : "identifier",
        value: word,
        from: start,
        to: i,
      });
      continue;
    }

    i++;
  }

  return tokens;
}

type StatementTokens = Token[];

function splitStatements(tokens: Token[]): StatementTokens[] {
  const statements: StatementTokens[] = [];
  let current: Token[] = [];

  for (const token of tokens) {
    if (token.type === "comment") continue;

    if (
      token.type === "semicolon" ||
      (token.type === "keyword" && token.value.toUpperCase() === "GO")
    ) {
      if (current.length > 0) {
        statements.push(current);
        current = [];
      }
      continue;
    }

    current.push(token);
  }

  if (current.length > 0) {
    statements.push(current);
  }

  return statements;
}

function lintStatement(tokens: StatementTokens): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (tokens.length === 0) return diagnostics;

  const firstKeyword =
    tokens[0].type === "keyword" ? tokens[0].value.toUpperCase() : null;

  // SELECT without FROM. We only consider depth-0 tokens so scalar subqueries
  // (SELECT (SELECT 1) AS x) and CTE-style nested SELECTs do not trigger the warning.
  if (firstKeyword === "SELECT") {
    let depth = 0;
    let hasFromAtDepth0 = false;
    let hasIntoAtDepth0 = false;
    let hasFilterClause = false;
    let hasQualifiedRef = false;

    for (let i = 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "paren") {
        if (t.value === "(") depth++;
        else if (t.value === ")") depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth !== 0) continue;

      if (t.type === "keyword") {
        const kw = t.value.toUpperCase();
        if (kw === "FROM") hasFromAtDepth0 = true;
        else if (kw === "INTO") hasIntoAtDepth0 = true;
        else if (
          kw === "WHERE" ||
          kw === "GROUP" ||
          kw === "HAVING" ||
          kw === "ORDER"
        ) {
          hasFilterClause = true;
        }
      }

      // A qualified identifier like `schema.table` or `t.col` strongly suggests a
      // table reference. Skip if it's followed by `(`, which indicates a function call
      // such as `dbo.GetDate()`.
      if (
        t.type === "identifier" &&
        !t.value.startsWith("@") &&
        t.value.includes(".")
      ) {
        const next = tokens[i + 1];
        if (!(next?.type === "paren" && next.value === "(")) {
          hasQualifiedRef = true;
        }
      }
    }

    if (
      !hasFromAtDepth0 &&
      !hasIntoAtDepth0 &&
      (hasFilterClause || hasQualifiedRef)
    ) {
      const selectToken = tokens[0];
      diagnostics.push({
        from: selectToken.from,
        to: selectToken.to,
        severity: "warning",
        message: "SELECT statement without FROM clause",
      });
    }
  }

  if (firstKeyword === "FROM") {
    diagnostics.push({
      from: tokens[0].from,
      to: tokens[0].to,
      severity: "error",
      message: "FROM without a preceding SELECT, DELETE, or UPDATE",
    });
  }

  if (firstKeyword === "WHERE") {
    diagnostics.push({
      from: tokens[0].from,
      to: tokens[0].to,
      severity: "error",
      message: "WHERE without a preceding SELECT, UPDATE, or DELETE",
    });
  }

  if (firstKeyword === "INSERT") {
    const hasInto = tokens.some(
      (t) => t.type === "keyword" && t.value.toUpperCase() === "INTO",
    );
    if (!hasInto) {
      diagnostics.push({
        from: tokens[0].from,
        to: tokens[0].to,
        severity: "warning",
        message: "INSERT without INTO",
      });
    }
  }

  if (firstKeyword === "UPDATE") {
    const hasSet = tokens.some(
      (t) => t.type === "keyword" && t.value.toUpperCase() === "SET",
    );
    if (!hasSet) {
      diagnostics.push({
        from: tokens[0].from,
        to: tokens[0].to,
        severity: "warning",
        message: "UPDATE statement without SET clause",
      });
    }
  }

  if (firstKeyword === "DELETE") {
    const hasFrom = tokens.some(
      (t) => t.type === "keyword" && t.value.toUpperCase() === "FROM",
    );
    if (!hasFrom) {
      // DELETE can also be used without FROM in T-SQL (DELETE tablename WHERE...)
      const nextToken = tokens[1];
      if (!nextToken || nextToken.type === "keyword") {
        diagnostics.push({
          from: tokens[0].from,
          to: tokens[0].to,
          severity: "warning",
          message: "DELETE without FROM or target table",
        });
      }
    }
  }

  let parenDepth = 0;
  let firstUnmatched: Token | null = null;
  for (const token of tokens) {
    if (token.type === "paren" && token.value === "(") {
      if (parenDepth === 0) firstUnmatched = token;
      parenDepth++;
    } else if (token.type === "paren" && token.value === ")") {
      parenDepth--;
      if (parenDepth < 0) {
        diagnostics.push({
          from: token.from,
          to: token.to,
          severity: "error",
          message: "Unmatched closing parenthesis",
        });
        parenDepth = 0;
      }
    }
  }
  if (parenDepth > 0 && firstUnmatched) {
    diagnostics.push({
      from: firstUnmatched.from,
      to: firstUnmatched.to,
      severity: "error",
      message: `Unclosed parenthesis (${parenDepth} unmatched)`,
    });
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "keyword" && t.value.toUpperCase() === "ORDER") {
      const next = tokens[i + 1];
      if (
        !next ||
        next.type !== "keyword" ||
        next.value.toUpperCase() !== "BY"
      ) {
        diagnostics.push({
          from: t.from,
          to: t.to,
          severity: "error",
          message: "ORDER without BY",
        });
      }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "keyword" && t.value.toUpperCase() === "GROUP") {
      const next = tokens[i + 1];
      if (
        !next ||
        next.type !== "keyword" ||
        next.value.toUpperCase() !== "BY"
      ) {
        diagnostics.push({
          from: t.from,
          to: t.to,
          severity: "error",
          message: "GROUP without BY",
        });
      }
    }
  }

  return diagnostics;
}

function lintUnclosedStrings(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/"))
        i++;
      if (i < text.length - 1) i += 2;
      else i = text.length;
      continue;
    }

    if (text[i] === "'") {
      const start = i;
      i++;
      let closed = false;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") {
          i += 2;
        } else if (text[i] === "'") {
          closed = true;
          i++;
          break;
        } else {
          i++;
        }
      }
      if (!closed) {
        diagnostics.push({
          from: start,
          to: Math.min(start + 1, text.length),
          severity: "error",
          message: "Unclosed string literal",
        });
      }
      continue;
    }

    i++;
  }

  return diagnostics;
}

export function sqlLinter(view: EditorView): Diagnostic[] {
  const text = view.state.doc.toString();
  if (!text.trim()) return [];

  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...lintUnclosedStrings(text));

  const tokens = tokenize(text);
  const statements = splitStatements(tokens);
  for (const stmt of statements) {
    diagnostics.push(...lintStatement(stmt));
  }

  return diagnostics;
}
