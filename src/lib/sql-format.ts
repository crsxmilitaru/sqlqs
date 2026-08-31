import { loadFormatPreferences } from "./settings";

type KeywordCase = "upper" | "lower" | "preserve";

export async function formatSqlWithPrefs(sql: string): Promise<string> {
  const { format } = await import("sql-formatter");
  const prefs = loadFormatPreferences();
  const keywordCase: KeywordCase =
    prefs.keywordCase === "upper"
      ? "upper"
      : prefs.keywordCase === "lower"
        ? "lower"
        : "preserve";
  const formatted = format(sql, {
    language: "tsql",
    keywordCase,
    tabWidth: prefs.indentSize,
    useTabs: false,
    linesBetweenQueries: prefs.formatStyle === "compact" ? 0 : 1,
  });
  return prefs.formatStyle === "compact"
    ? layoutCompact(withSourceBreaks(formatted, sql), prefs.indentSize)
    : formatted;
}

type TokenKind =
  | "word"
  | "num"
  | "str"
  | "ident"
  | "lcomment"
  | "bcomment"
  | "op"
  | "comma"
  | "open"
  | "close"
  | "semi"
  | "dot"
  | "scope"
  | "colon"
  | "break";

type Token =
  | { kind: "word"; value: string }
  | { kind: "num"; value: string }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "lcomment"; value: string }
  | { kind: "bcomment"; value: string }
  | { kind: "op"; value: string }
  | { kind: "comma" }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "semi" }
  | { kind: "dot" }
  | { kind: "scope" }
  | { kind: "colon" }
  | { kind: "break" };

function isWordStart(ch: string): boolean {
  return /[\p{L}_@#$]/u.test(ch);
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{M}\p{N}_@$#]/u.test(ch);
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  const n = sql.length;
  let i = 0;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : "";

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      let newlines = 0;
      while (
        i < n &&
        (sql[i] === " " || sql[i] === "\t" || sql[i] === "\n" || sql[i] === "\r")
      ) {
        if (sql[i] === "\n") newlines++;
        i++;
      }
      if (newlines >= 2) tokens.push({ kind: "break" });
      continue;
    }

    if (ch === "'" || ch === '"') {
      i = scanQuoted(sql, i, ch, ch, tokens, "str");
      continue;
    }
    if (ch === "[") {
      i = scanQuoted(sql, i, "[", "]", tokens, "ident");
      continue;
    }
    if (ch === "-" && next === "-") {
      let j = i;
      while (j < n && sql[j] !== "\n") j++;
      tokens.push({ kind: "lcomment", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      let j = i + 2;
      let depth = 1;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && j + 1 < n && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && j + 1 < n && sql[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      tokens.push({ kind: "bcomment", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(next))) {
      let j = i;
      while (j < n && /[0-9A-Za-z._]/.test(sql[j])) j++;
      if (
        j < n &&
        (sql[j] === "+" || sql[j] === "-") &&
        (sql[j - 1] === "e" || sql[j - 1] === "E")
      ) {
        j++;
        while (j < n && /[0-9]/.test(sql[j])) j++;
      }
      tokens.push({ kind: "num", value: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (isWordStart(ch)) {
      let j = i;
      while (j < n && isWordChar(sql[j])) j++;
      const word = sql.slice(i, j);
      if ((word === "N" || word === "n") && sql[j] === "'") {
        i = scanQuoted(sql, j, "'", "'", tokens, "str", word);
        continue;
      }
      tokens.push({ kind: "word", value: word });
      i = j;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "open" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "close" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    if (ch === ";") {
      tokens.push({ kind: "semi" });
      i++;
      continue;
    }
    if (ch === ":" && next === ":") {
      tokens.push({ kind: "scope" });
      i += 2;
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "colon" });
      i++;
      continue;
    }
    if (ch === ".") {
      tokens.push({ kind: "dot" });
      i++;
      continue;
    }
    let j = i;
    while (j < n && /[+\-*/%^&|~=<>.!]/.test(sql[j])) j++;
    if (j === i) {
      tokens.push({ kind: "op", value: sql[i] });
      i++;
    } else {
      tokens.push({ kind: "op", value: sql.slice(i, j) });
      i = j;
    }
  }

  return tokens;
}

function scanQuoted(
  sql: string,
  start: number,
  open: string,
  close: string,
  tokens: Token[],
  kind: "str" | "ident",
  prefix = "",
): number {
  const n = sql.length;
  let i = start + open.length;
  let out = prefix + open;
  while (i < n) {
    if (sql[i] === close) {
      if (i + 1 < n && sql[i + 1] === close) {
        out += close + close;
        i += 2;
      } else {
        out += close;
        i++;
        break;
      }
    } else {
      out += sql[i];
      i++;
    }
  }
  tokens.push({ kind, value: out });
  return i;
}

function sameToken(left: Token, right: Token): boolean {
  if (left.kind !== right.kind) return false;
  if ("value" in left && "value" in right) {
    return left.kind === "word"
      ? left.value.toUpperCase() === right.value.toUpperCase()
      : left.value === right.value;
  }
  return true;
}

function withSourceBreaks(formattedSql: string, sourceSql: string): Token[] {
  const formattedTokens = tokenize(formattedSql);
  const sourceTokens = tokenize(sourceSql);
  const breaksBefore = new Set<number>();
  let formattedIndex = 0;
  let pendingBreak = false;

  for (const sourceToken of sourceTokens) {
    if (sourceToken.kind === "break") {
      pendingBreak = true;
      continue;
    }

    while (
      formattedIndex < formattedTokens.length &&
      formattedTokens[formattedIndex].kind === "break"
    ) {
      formattedIndex++;
    }

    let matchIndex = formattedIndex;
    while (
      matchIndex < formattedTokens.length &&
      !sameToken(sourceToken, formattedTokens[matchIndex])
    ) {
      matchIndex++;
    }

    if (matchIndex === formattedTokens.length) {
      pendingBreak = false;
      continue;
    }

    if (pendingBreak) {
      breaksBefore.add(matchIndex);
      pendingBreak = false;
    }
    formattedIndex = matchIndex + 1;
  }

  const tokens: Token[] = [];
  for (let i = 0; i < formattedTokens.length; i++) {
    if (
      breaksBefore.has(i) &&
      tokens[tokens.length - 1]?.kind !== "break"
    ) {
      tokens.push({ kind: "break" });
    }
    if (
      formattedTokens[i].kind === "break" &&
      tokens[tokens.length - 1]?.kind === "break"
    ) {
      continue;
    }
    tokens.push(formattedTokens[i]);
  }
  return tokens;
}

const STATEMENT_WORDS = new Set([
  "SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "DECLARE", "PRINT",
  "EXEC", "EXECUTE", "USE", "IF", "WHILE", "RETURN", "CREATE", "ALTER",
  "DROP", "TRUNCATE", "GRANT", "DENY", "REVOKE", "WAITFOR", "THROW",
  "RAISERROR", "BACKUP", "RESTORE", "COMMIT", "ROLLBACK", "KILL",
  "CHECKPOINT", "DBCC", "BULK", "BREAK", "CONTINUE", "OPEN", "CLOSE",
  "FETCH", "WITH",
]);

const BODY_WORDS = new Set([...STATEMENT_WORDS, "SET"]);

const NO_NEWLINE_AFTER = new Set([
  "UNION", "EXCEPT", "INTERSECT", "INTO", "OR", "BULK", "GRANT", "DENY",
  "REVOKE", "DELETE",
]);

const CLAUSE_WORDS = new Set([
  "FROM", "WHERE", "HAVING", "GROUP", "ORDER", "VALUES",
]);

const JOIN_WORDS = new Set([
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER", "APPLY",
]);

const JOIN_MODIFIER_WORDS = new Set([
  "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "OUTER",
]);

const IF_AFTER_OBJECT = new Set([
  "TABLE", "PROCEDURE", "PROC", "FUNCTION", "TRIGGER", "VIEW", "INDEX",
  "DATABASE", "SEQUENCE", "SYNONYM", "SCHEMA", "TYPE", "USER", "ROLE",
]);

const HUG_PAREN_WORDS = new Set([
  "IDENTITY", "CAST", "CONVERT", "ISNULL", "COALESCE", "IIF", "NULLIF",
  "LEN", "LEFT", "RIGHT", "UPPER", "LOWER", "LTRIM", "RTRIM", "TRIM",
  "REPLACE", "SUBSTRING", "STUFF", "REPLICATE", "REVERSE", "SPACE",
  "CHARINDEX", "PATINDEX", "FORMAT", "CONCAT", "STRING_AGG", "STRING_SPLIT",
  "DATEADD", "DATEDIFF", "DATEPART", "DATENAME", "DAY", "MONTH", "YEAR",
  "ROUND", "FLOOR", "CEILING", "ABS", "SIGN", "SQRT", "POWER", "RAND",
  "COUNT", "MAX", "MIN", "SUM", "AVG", "STDEV", "VAR", "CHECKSUM_AGG",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE", "LAG", "LEAD", "FIRST_VALUE",
  "LAST_VALUE", "GETDATE", "GETUTCDATE", "SYSDATETIME", "SYSUTCDATETIME",
  "CURRENT_TIMESTAMP", "NEWID", "NEWSEQUENTIALID", "SCOPE_IDENTITY",
  "IDENT_CURRENT", "IDENT_SEED", "IDENT_INCR", "OBJECT_ID", "OBJECT_NAME",
  "DB_ID", "DB_NAME", "SCHEMA_ID", "SCHEMA_NAME", "SUSER_SNAME", "SUSER_SID",
  "USER_NAME", "USER_ID", "HOST_NAME", "HOST_ID", "APP_NAME", "ERROR_MESSAGE",
  "ERROR_NUMBER", "ERROR_SEVERITY", "ERROR_STATE", "ERROR_LINE",
  "ERROR_PROCEDURE", "XACT_STATE", "TRIGGER_NESTLEVEL", "CONTEXT_INFO",
  "NVARCHAR", "VARCHAR", "CHAR", "NCHAR", "TEXT", "NTEXT", "INT", "BIGINT",
  "SMALLINT", "TINYINT", "BIT", "DECIMAL", "NUMERIC", "FLOAT", "REAL",
  "MONEY", "SMALLMONEY", "DATETIME", "DATETIME2", "DATETIMEOFFSET",
  "SMALLDATETIME", "DATE", "TIME", "BINARY", "VARBINARY", "IMAGE",
  "UNIQUEIDENTIFIER", "XML", "SQL_VARIANT", "JSON_VALUE", "JSON_QUERY",
  "JSON_MODIFY", "OPENJSON",
]);

const SPACE_PAREN_WORDS = new Set([
  "SELECT", "FROM", "WHERE", "HAVING", "GROUP", "ORDER", "BY", "JOIN", "ON",
  "IN", "VALUES", "SET", "WITH", "AS", "AND", "OR", "NOT", "WHEN", "THEN",
  "ELSE", "OVER", "LIKE", "BETWEEN", "EXISTS", "ALL", "ANY", "SOME",
  "UNION", "EXCEPT", "INTERSECT", "DISTINCT", "TOP", "CASE", "OUTPUT",
  "USING", "TABLE", "PROCEDURE", "PROC", "VIEW", "FUNCTION", "INDEX",
  "TRIGGER", "DATABASE", "SCHEMA", "TYPE", "CHECK", "DEFAULT", "CONSTRAINT",
  "FOREIGN", "KEY", "PRIMARY", "REFERENCES", "FOR", "WHILE", "IF", "RETURN",
  "INTO", "MERGE", "UPDATE", "DELETE", "INSERT", "EXEC", "EXECUTE", "OPTION",
]);

function nextWord(tokens: Token[], i: number): string | null {
  const tk = tokens[i + 1];
  return tk && tk.kind === "word" ? tk.value.toUpperCase() : null;
}

interface ControlFrame {
  type: "if" | "while" | "else";
  state: "cond" | "await_body" | "body";
}

function isParamName(word: string): boolean {
  return word.startsWith("@") || word.startsWith("[@");
}

function layoutCompact(tokens: Token[], indentSize: number): string {
  const lines: string[] = [];
  let cur = "";
  let lineIndent = 0;
  let blockIndent = 0;
  let listDepth = 0;
  let listParenDepth = -1;
  let parenDepth = 0;
  let caseDepth = 0;
  let inCte = false;
  let pendingCteOpen = false;
  const cteParenStack: number[] = [];
  let prevWord = "";
  let prevKind: TokenKind | null = null;
  let prevNoSpaceAfter = false;
  let prevAfterDot = false;
  let prevAfterInto = false;
  let pendingCreateTable = false;
  let procParams = false;
  let procParamSeen = false;
  let afterProcAs = false;
  let procedureBlockDepth = 0;
  let lastStatement = "";
  let afterJoinKeyword = false;
  let pendingCompoundBegin: "TRY" | "CATCH" | null = null;
  let pendingCompoundEnd: "TRY" | "CATCH" | null = null;
  const controlStack: ControlFrame[] = [];

  function isQueryParenLevel(): boolean {
    return (
      parenDepth === 0 ||
      (cteParenStack.length > 0 &&
        parenDepth === cteParenStack[cteParenStack.length - 1])
    );
  }

  function recordWord(word: string) {
    prevWord = word;
    prevKind = "word";
    prevAfterDot = false;
    prevAfterInto = false;
  }

  function getControlIndent(): number {
    let count = 0;
    for (let j = 0; j < controlStack.length; j++) {
      if (controlStack[j].state === "body") count++;
    }
    return count;
  }

  function getProcIndent(): number {
    return procParams && procParamSeen && parenDepth === 0 ? 1 : 0;
  }

  function flush() {
    if (cur.trim()) lines.push(" ".repeat(lineIndent * indentSize) + cur);
    cur = "";
  }

  function append(text: string, noSpaceBefore = false) {
    if (cur === "") {
      lineIndent =
        blockIndent + listDepth + getProcIndent() + getControlIndent();
      cur = text;
    } else if (!noSpaceBefore && !prevNoSpaceAfter) {
      cur += " " + text;
    } else {
      cur += text;
    }
    prevNoSpaceAfter = false;
  }

  function popCompletedBodyFrames() {
    while (
      controlStack.length > 0 &&
      controlStack[controlStack.length - 1].state === "body"
    ) {
      controlStack.pop();
    }
  }

  function startBodyFrame(): boolean {
    if (parenDepth !== 0 || caseDepth !== 0 || controlStack.length === 0) {
      return false;
    }
    const top = controlStack[controlStack.length - 1];
    if (top.state === "cond" || top.state === "await_body") {
      top.state = "body";
      return true;
    }
    return false;
  }

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    switch (tk.kind) {
      case "break":
        flush();
        if (lines.length && lines[lines.length - 1] !== "") lines.push("");
        continue;
      case "semi":
        append(";", true);
        flush();
        popCompletedBodyFrames();
        if (parenDepth === 0) {
          pendingCreateTable = false;
          pendingCteOpen = false;
          procParams = false;
          afterProcAs = false;
          afterJoinKeyword = false;
          pendingCompoundBegin = null;
          pendingCompoundEnd = null;
        }
        lastStatement = "";
        prevWord = "";
        prevKind = "semi";
        prevAfterDot = false;
        prevAfterInto = false;
        continue;
      case "lcomment":
        append(tk.value);
        flush();
        prevKind = "lcomment";
        continue;
      case "bcomment":
        append(tk.value);
        prevKind = "bcomment";
        continue;
      case "comma":
        prevAfterDot = false;
        prevAfterInto = false;
        append(",", true);
        if (
          (listDepth > 0 && parenDepth === listParenDepth) ||
          (procParams && parenDepth === 0) ||
          (inCte && parenDepth === 0)
        ) {
          flush();
        }
        prevKind = "comma";
        continue;
      case "open": {
        const isProcParen = procParams && !procParamSeen && parenDepth === 0;
        const isColumnList = pendingCreateTable || isProcParen;
        const isCteBody = pendingCteOpen;
        pendingCreateTable = false;
        pendingCteOpen = false;
        parenDepth++;
        if (isCteBody) {
          cteParenStack.push(parenDepth);
        }
        const hug =
          !isCteBody &&
          (prevAfterDot ||
            (prevKind === "word" &&
              (HUG_PAREN_WORDS.has(prevWord) ||
                (!SPACE_PAREN_WORDS.has(prevWord) &&
                  !isColumnList &&
                  !prevAfterInto &&
                  prevWord !== "INTO"))) ||
            (prevKind === "ident" &&
              (isColumnList || listDepth > 0 || prevWord !== "INTO")));
        append("(", hug);
        prevNoSpaceAfter = true;
        prevAfterDot = false;
        prevAfterInto = false;
        if (isColumnList) {
          listDepth++;
          listParenDepth = parenDepth;
          flush();
        } else if (isCteBody) {
          blockIndent++;
          flush();
        }
        prevKind = "open";
        continue;
      }
      case "close": {
        const isCteClose =
          cteParenStack.length > 0 &&
          parenDepth === cteParenStack[cteParenStack.length - 1];
        const isColumnList = listDepth > 0 && parenDepth === listParenDepth;
        parenDepth = Math.max(0, parenDepth - 1);
        if (isColumnList) {
          listDepth--;
          flush();
        }
        if (isCteClose) {
          cteParenStack.pop();
          blockIndent = Math.max(0, blockIndent - 1);
          flush();
        }
        append(")", true);
        if (isCteClose) {
          if (tokens[i + 1]?.kind === "comma") {
            inCte = true;
          } else {
            inCte = false;
            flush();
          }
        }
        prevKind = "close";
        prevAfterDot = false;
        prevAfterInto = false;
        continue;
      }
      case "dot":
        append(".", true);
        prevNoSpaceAfter = true;
        prevKind = "dot";
        prevAfterDot = true;
        continue;
      case "scope":
        append("::", true);
        prevNoSpaceAfter = true;
        prevKind = "scope";
        prevAfterDot = true;
        continue;
      case "colon":
        append(":", true);
        prevKind = "colon";
        prevAfterDot = false;
        prevAfterInto = false;
        continue;
      case "num":
      case "str":
      case "op":
        prevAfterDot = false;
        prevAfterInto = false;
        append(tk.value);
        prevKind = tk.kind;
        continue;
      case "ident":
        if (tokens[i + 1]?.kind !== "open") {
          prevAfterDot = false;
          prevAfterInto = false;
        }
        append(tk.value);
        prevKind = "ident";
        if (tokens[i + 1]?.kind !== "dot") prevWord = tk.value.toUpperCase();
        continue;
      case "word": {
        const w = tk.value.toUpperCase();
        const nw = nextWord(tokens, i);
        const isTranNext = tokens[i + 2];
        const isTran =
          nw === "TRAN" ||
          nw === "TRANSACTION" ||
          (nw === "DISTRIBUTED" &&
            isTranNext?.kind === "word" &&
            (isTranNext.value.toUpperCase() === "TRANSACTION" ||
              isTranNext.value.toUpperCase() === "TRAN"));
        const isCompoundBegin = nw === "TRY" || nw === "CATCH";
        const isCompoundEnd = nw === "TRY" || nw === "CATCH";
        const isStatementWord =
          (STATEMENT_WORDS.has(w) ||
            (w === "SET" && lastStatement !== "UPDATE")) &&
          !(
            w === "WITH" &&
            (tokens[i + 1]?.kind === "open" ||
              lastStatement === "BACKUP" ||
              lastStatement === "RESTORE" ||
              ((lastStatement === "CREATE" || lastStatement === "ALTER") &&
                !afterProcAs))
          ) &&
          !(w === "FETCH" && prevWord === "ROWS") &&
          !(w === "IF" && IF_AFTER_OBJECT.has(prevWord));

        if (
          (w === "CREATE" && nw === "TABLE") ||
          (w === "TABLE" &&
            (prevWord === "AS" || isParamName(prevWord)))
        ) {
          pendingCreateTable = true;
        }
        if (
          (w === "PROCEDURE" || w === "PROC") &&
          (prevWord === "CREATE" || prevWord === "ALTER")
        ) {
          procParams = true;
          procParamSeen = false;
        }

        if (procParams && parenDepth === 0) {
          if (w === "AS" && prevWord !== "EXECUTE") {
            if (isParamName(prevWord)) {
              append(tk.value);
              recordWord(w);
              continue;
            }
            procParams = false;
            flush();
            append(tk.value);
            flush();
            afterProcAs = true;
            recordWord(w);
            continue;
          }
          if (!procParamSeen && (tk.value.startsWith("@") || tk.value.startsWith("[@"))) {
            flush();
            procParamSeen = true;
            append(tk.value);
            recordWord(w);
            continue;
          }
        }

        if (inCte && parenDepth === 0 && w === "AS") {
          pendingCteOpen = true;
        }

        if (pendingCompoundBegin === w) {
          append(tk.value);
          flush();
          blockIndent++;
          if (procedureBlockDepth > 0) procedureBlockDepth++;
          pendingCompoundBegin = null;
          lastStatement = "BEGIN";
          recordWord(w);
          continue;
        }

        if (pendingCompoundEnd === w) {
          append(tk.value);
          pendingCompoundEnd = null;
          recordWord(w);
          continue;
        }

        if (w === "BEGIN") {
          if (isTran) {
            if (startBodyFrame()) {
              flush();
            }
            append(tk.value);
          } else {
            const startsProcedureBlock =
              afterProcAs && controlStack.length === 0 && !isCompoundBegin;
            popCompletedBodyFrames();
            if (controlStack.length > 0) {
              const top = controlStack[controlStack.length - 1];
              if (top.state === "cond" || top.state === "await_body") {
                controlStack.pop();
              }
            }
            if (afterProcAs) {
              afterProcAs = false;
            }
            flush();
            append(tk.value);
            if (isCompoundBegin) {
              pendingCompoundBegin = nw as "TRY" | "CATCH";
              lastStatement = "BEGIN";
            } else {
              flush();
              blockIndent++;
              if (startsProcedureBlock) {
                procedureBlockDepth = 1;
              } else if (procedureBlockDepth > 0) {
                procedureBlockDepth++;
              }
              lastStatement = "BEGIN";
            }
          }
          recordWord(w);
          continue;
        }

        if (w === "END" && nw !== "CONVERSATION") {
          if (caseDepth > 0) {
            caseDepth--;
            append(tk.value);
          } else {
            popCompletedBodyFrames();
            controlStack.length = 0;
            afterProcAs = false;
            procParams = false;
            flush();
            blockIndent = Math.max(0, blockIndent - 1);
            append(tk.value);
            if (procedureBlockDepth > 0) {
              procedureBlockDepth--;
              if (procedureBlockDepth === 0) procParamSeen = false;
            }
            if (isCompoundEnd) {
              pendingCompoundEnd = nw as "TRY" | "CATCH";
            } else if (tokens[i + 1]?.kind !== "semi") {
              flush();
            }
          }
          recordWord(w);
          continue;
        }

        if (w === "CASE") {
          caseDepth++;
          append(tk.value);
          recordWord(w);
          continue;
        }

        if (w === "GO") {
          flush();
          blockIndent = 0;
          listDepth = 0;
          listParenDepth = -1;
          parenDepth = 0;
          caseDepth = 0;
          inCte = false;
          pendingCteOpen = false;
          cteParenStack.length = 0;
          prevWord = "";
          prevKind = null;
          prevAfterDot = false;
          prevAfterInto = false;
          pendingCreateTable = false;
          procParams = false;
          procParamSeen = false;
          afterProcAs = false;
          lastStatement = "";
          afterJoinKeyword = false;
          controlStack.length = 0;
          pendingCompoundBegin = null;
          pendingCompoundEnd = null;
          procedureBlockDepth = 0;
          prevNoSpaceAfter = false;
          append(tk.value);
          flush();
          continue;
        }

        if (
          (w === "UNION" || w === "EXCEPT" || w === "INTERSECT") &&
          isQueryParenLevel()
        ) {
          popCompletedBodyFrames();
          flush();
          append(tk.value);
          recordWord(w);
          continue;
        }

        if (
          (w === "IF" || w === "WHILE") &&
          parenDepth === 0 &&
          caseDepth === 0 &&
          !IF_AFTER_OBJECT.has(prevWord)
        ) {
          if (
            w === "IF" &&
            prevWord === "ELSE" &&
            controlStack.length > 0 &&
            controlStack[controlStack.length - 1].type === "else"
          ) {
            controlStack[controlStack.length - 1] = {
              type: "if",
              state: "cond",
            };
            append(tk.value);
            lastStatement = w;
            recordWord(w);
            continue;
          }

          if (!startBodyFrame()) {
            popCompletedBodyFrames();
          }
          flush();
          controlStack.push({
            type: w === "IF" ? "if" : "while",
            state: "cond",
          });
          append(tk.value);
          lastStatement = w;
          recordWord(w);
          continue;
        }

        if (w === "ELSE" && parenDepth === 0 && caseDepth === 0) {
          while (
            controlStack.length > 0 &&
            controlStack[controlStack.length - 1].type !== "if"
          ) {
            controlStack.pop();
          }
          if (controlStack.length > 0) {
            controlStack[controlStack.length - 1] = {
              type: "else",
              state: "await_body",
            };
          } else {
            controlStack.push({
              type: "else",
              state: "await_body",
            });
          }
          flush();
          append(tk.value);
          lastStatement = w;
          recordWord(w);
          continue;
        }

        const isBodyWord =
          parenDepth === 0 &&
          caseDepth === 0 &&
          BODY_WORDS.has(w) &&
          !(w === "SET" && lastStatement === "UPDATE");

        if (isBodyWord && startBodyFrame()) {
          flush();
          append(tk.value);
          lastStatement = w;
          recordWord(w);
          continue;
        }

        if (w === "WITH" && isStatementWord) {
          inCte = true;
        }

        if (
          isQueryParenLevel() &&
          isStatementWord &&
          !NO_NEWLINE_AFTER.has(prevWord)
        ) {
          popCompletedBodyFrames();
          flush();
          append(tk.value);
          lastStatement = w;
          afterJoinKeyword = JOIN_WORDS.has(w);
          recordWord(w);
          continue;
        }

        if (
          isQueryParenLevel() &&
          caseDepth === 0 &&
          !prevAfterDot
        ) {
          if (CLAUSE_WORDS.has(w) && !NO_NEWLINE_AFTER.has(prevWord)) {
            flush();
            append(tk.value);
            afterJoinKeyword = false;
            if (tokens[i + 1]?.kind !== "dot") prevWord = w;
            prevKind = "word";
            continue;
          }

          if (JOIN_WORDS.has(w) && !JOIN_MODIFIER_WORDS.has(prevWord)) {
            flush();
            append(tk.value);
            afterJoinKeyword = true;
            if (tokens[i + 1]?.kind !== "dot") prevWord = w;
            prevKind = "word";
            continue;
          }

          if (
            w === "ON" &&
            afterJoinKeyword &&
            prevWord !== "CREATE" &&
            prevWord !== "INDEX"
          ) {
            flush();
            append(tk.value);
            afterJoinKeyword = false;
            if (tokens[i + 1]?.kind !== "dot") prevWord = w;
            prevKind = "word";
            continue;
          }
        }

        append(tk.value);
        if (w === "INTO") {
          prevAfterInto = true;
        } else if (tokens[i + 1]?.kind !== "open") {
          prevAfterInto = false;
        }
        if (tokens[i + 1]?.kind !== "open") {
          prevAfterDot = false;
        }
        if (tokens[i + 1]?.kind !== "dot") prevWord = w;
        prevKind = "word";
        continue;
      }
    }
  }
  flush();
  return lines.join("\n").trim();
}
