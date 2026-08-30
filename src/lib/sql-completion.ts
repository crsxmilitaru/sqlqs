import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  identifierApply,
  loadSchemaCatalog,
  normalizeIdentifier,
  qualifiedObjectKey,
  unquoteIdentifier,
  type SchemaCatalog,
  type SchemaColumn,
  type SchemaObjectEntry,
  type SchemaParameter,
} from "./schema-catalog";
import type { EditorSuggestionStyle } from "./settings";

export interface SqlCompletionOptions {
  currentDatabase?: string;
  databases?: string[];
}

interface CatalogContext {
  catalog: SchemaCatalog;
  currentDatabase?: string;
  databases: string[];
}

interface SqlSourceContext {
  from: number;
  quoted: string | null;
  parents: string[];
  empty?: boolean;
  aliases: Record<string, string[]> | null;
  statement: SyntaxNode | null;
}

interface VisibleTableRef {
  table: SchemaObjectEntry;
  alias?: string;
}

type SqlClause =
  | "select"
  | "from"
  | "join"
  | "on"
  | "where"
  | "group"
  | "having"
  | "order"
  | "set"
  | "update"
  | "insert"
  | "insert-columns"
  | "delete"
  | "exec"
  | "exec-args"
  | "with"
  | "create"
  | "alter"
  | "drop"
  | "truncate"
  | "begin"
  | "txn"
  | "cursor"
  | "fetch"
  | "ddl-name"
  | "other";

const MAX_COMPLETION_OPTIONS = 80;
const SIMPLE_WORD_RE = /[#@A-Za-z_][\w@$#]*$/;
const BRACKET_WORD_RE = /\[[^\]]*$/;
const QUOTE_WORD_RE = /"[^"]*$/;
const FROM_END_KEYWORDS = new Set(
  "where group having order union intersect except all distinct limit offset fetch for option".split(
    " ",
  ),
);
const TABLE_ALIAS_STOP_WORDS = new Set(
  "as on where from into update merge apply truncate alter drop inner left right full cross outer join with nolock index force group order having union except intersect set values select when then using matched not by pivot unpivot option exec execute".split(
    " ",
  ),
);
const CLAUSE_KEYWORDS: Record<string, SqlClause> = {
  select: "select",
  from: "from",
  join: "join",
  apply: "join",
  on: "on",
  where: "where",
  group: "group",
  having: "having",
  order: "order",
  set: "set",
  update: "update",
  insert: "insert",
  into: "insert",
  delete: "delete",
  exec: "exec",
  execute: "exec",
  with: "with",
  merge: "from",
  create: "create",
  alter: "alter",
  drop: "drop",
  truncate: "truncate",
  begin: "begin",
  commit: "txn",
  rollback: "txn",
  cursor: "cursor",
  fetch: "fetch",
  if: "where",
  while: "where",
  table: "ddl-name",
  view: "ddl-name",
  procedure: "ddl-name",
  proc: "ddl-name",
  function: "ddl-name",
  trigger: "ddl-name",
  index: "ddl-name",
};
const IDENTIFIER_TOKEN = String.raw`(?:\[[^\]]+(?:\]\][^\]]*)*\]|"[^"]+(?:""[^"]*)*"|[#@A-Za-z_][\w@$#]*)`;

// A completion request runs several helpers over the same statement and
// document text; these per-text caches keep each pass to one execution.
const MAX_TEXT_CACHE_ENTRIES = 8;

function createTextCache<R>() {
  const cache = new Map<string, R>();
  return (text: string, compute: () => R): R => {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
    const result = compute();
    if (cache.size >= MAX_TEXT_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(text, result);
    return result;
  };
}

function memoizeLast<A, B, R>(compute: (a: A, b: B) => R): (a: A, b: B) => R {
  let lastKey: [A, B] | undefined;
  let lastResult: R;
  return (a, b) => {
    if (lastKey && lastKey[0] === a && lastKey[1] === b) return lastResult;
    lastKey = [a, b];
    lastResult = compute(a, b);
    return lastResult;
  };
}

const docTextCache = new WeakMap<Text, string>();

function docText(state: EditorState): string {
  let text = docTextCache.get(state.doc);
  if (text === undefined) {
    text = state.doc.toString();
    docTextCache.set(state.doc, text);
  }
  return text;
}

export interface CompletionWord {
  from: number;
  to: number;
  text: string;
  quoted: string | null;
}

function getCompletionWord(
  context: CompletionContext,
): CompletionWord | null {
  const bracket = context.matchBefore(BRACKET_WORD_RE);
  if (bracket) {
    return {
      from: bracket.from,
      to: bracket.to,
      text: bracket.text,
      quoted: "[",
    };
  }
  const quote = context.matchBefore(QUOTE_WORD_RE);
  if (quote) {
    return {
      from: quote.from,
      to: quote.to,
      text: quote.text,
      quoted: '"',
    };
  }
  const word = context.matchBefore(SIMPLE_WORD_RE);
  if (word) {
    return {
      from: word.from,
      to: word.to,
      text: word.text,
      quoted: null,
    };
  }
  return null;
}

function resolveSourceContext(
  context: CompletionContext,
  base: SqlSourceContext,
): SqlSourceContext {
  const word = getCompletionWord(context);
  if (word) {
    return {
      ...base,
      from: word.from,
      quoted: word.quoted ?? base.quoted,
      empty: false,
    };
  }
  if (context.explicit) {
    return { ...base, from: context.pos, empty: false };
  }
  return base;
}

function tokenBeforeNode(node: SyntaxNode): SyntaxNode {
  const cursor = node.cursor().moveTo(node.from, -1);
  while (/Comment/.test(cursor.name)) {
    cursor.moveTo(cursor.from, -1);
  }
  return cursor.node;
}

function idName(state: EditorState, node: SyntaxNode): string {
  return unquoteIdentifier(state.doc.sliceString(node.from, node.to));
}

function isIdentifierNode(
  node: SyntaxNode | null | undefined,
): node is SyntaxNode {
  return Boolean(
    node && (node.name === "Identifier" || node.name === "QuotedIdentifier"),
  );
}

function pathForNode(state: EditorState, node: SyntaxNode): string[] {
  if (node.name === "CompositeIdentifier") {
    const path: string[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (isIdentifierNode(child)) {
        path.push(idName(state, child));
      }
    }
    return path;
  }
  return [idName(state, node)];
}

function parentsForNode(state: EditorState, node: SyntaxNode): string[] {
  const path: string[] = [];
  let current: SyntaxNode | null = node;

  while (current?.name === ".") {
    const name = tokenBeforeNode(current);
    if (!isIdentifierNode(name)) {
      break;
    }

    path.unshift(idName(state, name));
    current = tokenBeforeNode(name);
  }

  return path;
}

function findStatementNode(node: SyntaxNode | null): SyntaxNode | null {
  for (let current = node; current; current = current.parent) {
    if (current.name === "Statement") {
      return current;
    }
  }
  return null;
}

function getAliases(
  state: EditorState,
  at: SyntaxNode,
): Record<string, string[]> | null {
  const statement = findStatementNode(at);
  if (!statement) {
    return null;
  }

  let aliases: Record<string, string[]> | null = null;
  let sawFrom = false;
  let prevIdentifier: SyntaxNode | null = null;

  for (let scan = statement.firstChild; scan; scan = scan.nextSibling) {
    const keyword =
      scan.name === "Keyword"
        ? state.doc.sliceString(scan.from, scan.to).toLowerCase()
        : null;
    let alias: string | null = null;

    if (!sawFrom) {
      sawFrom = keyword === "from";
    } else if (
      keyword === "as" &&
      prevIdentifier &&
      isIdentifierNode(scan.nextSibling)
    ) {
      alias = idName(state, scan.nextSibling);
    } else if (keyword && FROM_END_KEYWORDS.has(keyword)) {
      break;
    } else if (prevIdentifier && isIdentifierNode(scan)) {
      alias = idName(state, scan);
    }

    if (alias) {
      if (!aliases) {
        aliases = Object.create(null) as Record<string, string[]>;
      }
      aliases[alias] = pathForNode(state, prevIdentifier!);
    }

    prevIdentifier = /Identifier$/.test(scan.name) ? scan : null;
  }

  return aliases;
}

function getSqlSourceContext(
  state: EditorState,
  startPos: number,
): SqlSourceContext {
  const node = syntaxTree(state).resolveInner(startPos, -1);
  const statement = findStatementNode(node);
  const aliases = getAliases(state, node);

  if (
    node.name === "Identifier" ||
    node.name === "QuotedIdentifier" ||
    node.name === "Keyword"
  ) {
    return {
      from: node.from,
      quoted:
        node.name === "QuotedIdentifier"
          ? state.doc.sliceString(node.from, node.from + 1)
          : null,
      parents: parentsForNode(state, tokenBeforeNode(node)),
      aliases,
      statement,
    };
  }

  if (node.name === ".") {
    return {
      from: startPos,
      quoted: null,
      parents: parentsForNode(state, node),
      aliases,
      statement,
    };
  }

  return {
    from: startPos,
    quoted: null,
    parents: [],
    empty: true,
    aliases,
    statement,
  };
}

function isCompletionBlocked(context: CompletionContext): boolean {
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (node.name === "LineComment" || node.name === "BlockComment") {
    return true;
  }
  if (node.name === "String") {
    const literal = context.state.doc.sliceString(node.from, node.to);
    return !looksLikeSql(literal);
  }
  return false;
}

function skipWs(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function readIdentifierAt(
  text: string,
  index: number,
): { name: string; next: number } | null {
  const start = skipWs(text, index);
  if (start >= text.length) return null;
  if (text[start] === "[") {
    let current = "";
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === "]" && text[i + 1] === "]") {
        current += "]";
        i++;
        continue;
      }
      if (text[i] === "]") {
        return { name: current, next: i + 1 };
      }
      current += text[i];
    }
    return null;
  }
  if (text[start] === '"') {
    let current = "";
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      if (text[i] === '"') {
        return { name: current, next: i + 1 };
      }
      current += text[i];
    }
    return null;
  }
  const match = text.slice(start).match(/^[#@A-Za-z_][\w@$#]*/);
  if (!match) return null;
  return { name: match[0], next: start + match[0].length };
}

function readBalancedParens(
  text: string,
  index: number,
): { inner: string; next: number } | null {
  const start = skipWs(text, index);
  if (text[start] !== "(") return null;
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) {
        return { inner: text.slice(start + 1, i), next: i + 1 };
      }
    }
  }
  return null;
}

const SQL_LITERAL_RE =
  /\b(SELECT|INSERT|UPDATE|DELETE|FROM|JOIN|WHERE|GROUP|HAVING|ORDER|WITH|DECLARE|EXEC)\b/i;

/** Dynamic-SQL literals (SET @sql = 'SELECT ...') look like queries and
 *  should be completed as SQL, unlike ordinary data strings. */
function looksLikeSql(text: string): boolean {
  return text.length >= 24 && SQL_LITERAL_RE.test(text);
}

const stripCache = new Map<string, Map<boolean, string>>();

function stripSqlCommentsAndStrings(
  sqlText: string,
  keepSqlLiterals = false,
): string {
  let byMode = stripCache.get(sqlText);
  if (!byMode) {
    byMode = new Map<boolean, string>();
    if (stripCache.size >= MAX_TEXT_CACHE_ENTRIES) {
      const oldest = stripCache.keys().next().value;
      if (oldest !== undefined) stripCache.delete(oldest);
    }
    stripCache.set(sqlText, byMode);
  }
  const cached = byMode.get(keepSqlLiterals);
  if (cached !== undefined) return cached;
  const stripped = stripSqlCommentsAndStringsUncached(sqlText, keepSqlLiterals);
  byMode.set(keepSqlLiterals, stripped);
  return stripped;
}

/** The output must stay length-aligned with the source: cursor offsets from
 *  the original statement are compared against positions in this text. */
function stripSqlCommentsAndStringsUncached(
  sqlText: string,
  keepSqlLiterals = false,
): string {
  let result = "";

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const next = sqlText[i + 1];

    if (char === "-" && next === "-") {
      result += "  ";
      i += 2;
      while (i < sqlText.length && sqlText[i] !== "\n") {
        result += " ";
        i++;
      }
      if (i < sqlText.length) {
        result += sqlText[i];
      }
      continue;
    }

    if (char === "/" && next === "*") {
      result += "  ";
      i += 2;
      while (i < sqlText.length) {
        if (sqlText[i] === "*" && sqlText[i + 1] === "/") {
          result += "  ";
          i++;
          break;
        }
        result += sqlText[i] === "\n" ? "\n" : " ";
        i++;
      }
      continue;
    }

    if (char === "'") {
      let content = "";
      let end = -1;
      let j = i;
      while (++j < sqlText.length) {
        if (sqlText[j] === "'") {
          if (sqlText[j + 1] === "'") {
            content += "'";
            j++;
          } else {
            end = j;
            break;
          }
        } else {
          content += sqlText[j];
        }
      }
      if (keepSqlLiterals && looksLikeSql(content)) {
        result += end > 0 ? sqlText.slice(i, end + 1) : sqlText.slice(i);
      } else {
        for (let k = i; k < (end > 0 ? end + 1 : sqlText.length); k++) {
          result += sqlText[k] === "\n" ? "\n" : " ";
        }
      }
      i = end > 0 ? end : sqlText.length - 1;
      continue;
    }

    result += char;
  }

  return result;
}

function splitIdentifierPath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inBracket = false;
  let inDoubleQuote = false;

  for (let i = 0; i < path.length; i++) {
    const char = path[i];

    if (inBracket) {
      current += char;
      if (char === "]") {
        if (path[i + 1] === "]") {
          current += path[++i];
        } else {
          inBracket = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === '"') {
        if (path[i + 1] === '"') {
          current += path[++i];
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    if (char === "[") {
      inBracket = true;
      current += char;
    } else if (char === '"') {
      inDoubleQuote = true;
      current += char;
    } else if (char === ".") {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  parts.push(current.trim());
  return parts.filter(Boolean).map(unquoteIdentifier);
}

function parseSelectListColumns(selectSql: string): string[] {
  const match = /\bSELECT\s+(?:ALL\s+|DISTINCT\s+)?/i.exec(selectSql);
  if (!match) return [];
  let index = match.index + match[0].length;
  const afterSelect = selectSql.slice(index);
  const topMatch = afterSelect.match(/^\s*TOP\s*(?:\([\s\d]+\)|\d+)\s*(?:PERCENT\s*)?(?:WITH\s+TIES\s*)?/i);
  if (topMatch) {
    index += topMatch[0].length;
  }

  let depth = 0;
  let fromAt = -1;
  for (let i = index; i < selectSql.length; i++) {
    const char = selectSql[i];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (
      depth === 0 &&
      (i === 0 || !/\w/.test(selectSql[i - 1])) &&
      selectSql.slice(i, i + 4).toUpperCase() === "FROM" &&
      (i + 4 >= selectSql.length || !/\w/.test(selectSql[i + 4]))
    ) {
      fromAt = i;
      break;
    }
  }
  const list = selectSql.slice(index, fromAt >= 0 ? fromAt : selectSql.length);

  const columns: string[] = [];
  for (const item of splitTopLevelItems(list)) {
    const named = selectItemName(item);
    if (named) columns.push(named.name);
  }
  return columns;
}

function splitTopLevelItems(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current.trim());
  return items;
}

const AS_ALIAS_RE = new RegExp(String.raw`\bAS\s+(${IDENTIFIER_TOKEN})\s*$`, "i");
const TRAILING_IDENT_RE = new RegExp(String.raw`(${IDENTIFIER_TOKEN})\s*$`);

function selectItemName(
  item: string,
): { name: string; aliased: boolean } | null {
  const trimmed = item.trim();
  if (!trimmed || trimmed === "*") return null;
  const asMatch = trimmed.match(AS_ALIAS_RE);
  if (asMatch) {
    return { name: unquoteIdentifier(asMatch[1]), aliased: true };
  }
  const identMatch = trimmed.match(TRAILING_IDENT_RE);
  if (identMatch && !/^\d/.test(identMatch[1])) {
    return { name: unquoteIdentifier(identMatch[1]), aliased: false };
  }
  return null;
}

function makeVirtualTable(
  name: string,
  columns: string[],
  schema = "",
): SchemaObjectEntry {
  return {
    name,
    schema,
    kind: "CTE",
    columns: columns.map((column) => ({
      name: column,
      typeName: "",
      isNullable: true,
      isIdentity: false,
      isPrimaryKey: false,
    })),
    parameters: [],
  };
}

const parseCtesCache = createTextCache<SchemaObjectEntry[]>();

function parseCtes(statementText: string): SchemaObjectEntry[] {
  return parseCtesCache(statementText, () => parseCtesUncached(statementText));
}

function parseCtesUncached(statementText: string): SchemaObjectEntry[] {
  const sanitized = stripSqlCommentsAndStrings(statementText, true);
  const withMatch = /^\s*WITH\s+/i.exec(sanitized);
  if (!withMatch) return [];
  let index = withMatch[0].length;
  const recursive = /^RECURSIVE\s+/i.exec(sanitized.slice(index));
  if (recursive) {
    index += recursive[0].length;
  }

  const ctes: SchemaObjectEntry[] = [];
  while (index < sanitized.length) {
    const nameTok = readIdentifierAt(sanitized, index);
    if (!nameTok) break;
    index = nameTok.next;
    let declaredColumns: string[] = [];
    const maybeCols = readBalancedParens(sanitized, index);
    const afterCols = skipWs(sanitized, maybeCols ? maybeCols.next : index);
    if (maybeCols && /^AS\b/i.test(sanitized.slice(afterCols))) {
      declaredColumns = maybeCols.inner
        .split(",")
        .map((part) => unquoteIdentifier(part.trim()))
        .filter(Boolean);
      index = maybeCols.next;
    }
    index = skipWs(sanitized, index);
    if (!/^AS\b/i.test(sanitized.slice(index))) break;
    index += 2;
    const body = readBalancedParens(sanitized, index);
    if (!body) break;
    const columns =
      declaredColumns.length > 0
        ? declaredColumns
        : parseSelectListColumns(body.inner);
    ctes.push(makeVirtualTable(nameTok.name, columns));
    index = skipWs(sanitized, body.next);
    if (sanitized[index] === ",") {
      index++;
      continue;
    }
    break;
  }
  return ctes;
}

const parseDerivedTablesCache = createTextCache<SchemaObjectEntry[]>();

function parseDerivedTables(statementText: string): SchemaObjectEntry[] {
  return parseDerivedTablesCache(statementText, () =>
    parseDerivedTablesUncached(statementText),
  );
}

function parseDerivedTablesUncached(statementText: string): SchemaObjectEntry[] {
  const sanitized = stripSqlCommentsAndStrings(statementText, true);
  const derived: SchemaObjectEntry[] = [];
  const trigger = /\b(?:FROM|JOIN|APPLY)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = trigger.exec(sanitized))) {
    const open = match.index + match[0].length - 1;
    const body = readBalancedParens(sanitized, open);
    if (!body) continue;
    let next = skipWs(sanitized, body.next);
    if (/^AS\b/i.test(sanitized.slice(next))) {
      next = skipWs(sanitized, next + 2);
    }
    const alias = readIdentifierAt(sanitized, next);
    if (!alias || TABLE_ALIAS_STOP_WORDS.has(alias.name.toLowerCase())) {
      continue;
    }
    derived.push(
      makeVirtualTable(alias.name, parseSelectListColumns(body.inner)),
    );
  }
  return derived;
}

const parseStatementTableReferencesCache = createTextCache<
  Array<{ path: string[]; alias?: string }>
>();

function parseStatementTableReferences(
  statementText: string,
): Array<{ path: string[]; alias?: string }> {
  return parseStatementTableReferencesCache(statementText, () =>
    parseStatementTableReferencesUncached(statementText),
  );
}

function parseStatementTableReferencesUncached(
  statementText: string,
): Array<{ path: string[]; alias?: string }> {
  const sanitized = stripSqlCommentsAndStrings(statementText, true);
  const tablePath = String.raw`${IDENTIFIER_TOKEN}(?:\s*\.\s*${IDENTIFIER_TOKEN}){0,2}`;
  const tableHints = String.raw`(?:\s+WITH\s*\([^)]*\))*`;
  const tableRefPattern = new RegExp(
    String.raw`\b(?:FROM|JOIN|UPDATE|INTO|MERGE|APPLY)\s+(${tablePath})${tableHints}(?:\s+(?:AS\s+)?(${IDENTIFIER_TOKEN}))?`,
    "gi",
  );
  const refs: Array<{ path: string[]; alias?: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = tableRefPattern.exec(sanitized))) {
    const path = splitIdentifierPath(match[1]);
    if (path.length === 0) {
      continue;
    }

    const rawAlias = match[2] ? unquoteIdentifier(match[2]) : undefined;
    const alias =
      rawAlias && !TABLE_ALIAS_STOP_WORDS.has(rawAlias.toLowerCase())
        ? rawAlias
        : undefined;

    refs.push({ path, alias });
  }

  return refs;
}

const parseInsertColumnContextMemo = memoizeLast(
  (statementText: string, cursorOffset: number) =>
    parseInsertColumnContextUncached(statementText, cursorOffset),
);

function parseInsertColumnContext(
  statementText: string,
  cursorOffset: number,
): { path: string[]; used: string[] } | null {
  return parseInsertColumnContextMemo(statementText, cursorOffset);
}

function parseInsertColumnContextUncached(
  statementText: string,
  cursorOffset: number,
): { path: string[]; used: string[] } | null {
  const sanitized = stripSqlCommentsAndStrings(statementText);
  const insert = /\bINSERT\s+(?:INTO\s+)?/gi;
  let match: RegExpExecArray | null;
  while ((match = insert.exec(sanitized))) {
    const pathTok = readIdentifierPath(sanitized, match.index + match[0].length);
    if (!pathTok) continue;
    let index = skipWs(sanitized, pathTok.next);
    const hints = /^WITH\s*\(/i.exec(sanitized.slice(index));
    if (hints) {
      const hinted = readBalancedParens(sanitized, index + hints[0].length - 1);
      if (hinted) index = skipWs(sanitized, hinted.next);
    }
    if (sanitized[index] !== "(") continue;
    const list = readBalancedParens(sanitized, index);
    if (!list) {
      if (cursorOffset > index) {
        const used = parseIdentifierList(sanitized.slice(index + 1, cursorOffset));
        return { path: pathTok.path, used };
      }
      continue;
    }
    if (cursorOffset > index && cursorOffset <= list.next) {
      return {
        path: pathTok.path,
        used: parseIdentifierList(list.inner),
      };
    }
  }
  return null;
}

function readIdentifierPath(
  text: string,
  index: number,
): { path: string[]; next: number } | null {
  const first = readIdentifierAt(text, index);
  if (!first) return null;
  const path = [first.name];
  let next = first.next;
  while (true) {
    const dotAt = skipWs(text, next);
    if (text[dotAt] !== ".") break;
    const part = readIdentifierAt(text, dotAt + 1);
    if (!part) break;
    path.push(part.name);
    next = part.next;
  }
  return { path, next };
}

function parseIdentifierList(text: string): string[] {
  return text
    .split(",")
    .map((part) => unquoteIdentifier(part.trim()))
    .filter(Boolean);
}

const parseExecContextMemo = memoizeLast(
  (statementText: string, cursorOffset: number) =>
    parseExecContextUncached(statementText, cursorOffset),
);

function parseExecContext(
  statementText: string,
  cursorOffset: number,
): { procPath: string[]; inArgs: boolean } | null {
  return parseExecContextMemo(statementText, cursorOffset);
}

function parseExecContextUncached(
  statementText: string,
  cursorOffset: number,
): { procPath: string[]; inArgs: boolean } | null {
  const sanitized = stripSqlCommentsAndStrings(statementText);
  const prefix = sanitized.slice(0, cursorOffset);
  const exec = /\b(?:EXEC|EXECUTE)\b/gi;
  let last: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = exec.exec(prefix))) {
    last = match;
  }
  if (!last) return null;
  const after = readIdentifierPath(sanitized, last.index + last[0].length);
  if (!after) {
    return { procPath: [], inArgs: false };
  }
  const inArgs = cursorOffset > after.next;
  return { procPath: after.path, inArgs };
}

function clauseAtCursor(statementText: string, cursorOffset: number): SqlClause {
  const insertCols = parseInsertColumnContext(statementText, cursorOffset);
  if (insertCols) return "insert-columns";
  const exec = parseExecContext(statementText, cursorOffset);
  if (exec) return exec.inArgs || exec.procPath.length > 0 ? "exec-args" : "exec";

  const sanitized = stripSqlCommentsAndStrings(
    statementText.slice(0, cursorOffset),
    true,
  )
    // Table hints (FROM t WITH (NOLOCK)) are not CTE WITH clauses.
    .replace(/\bWITH\s*\([^)]*\)/gi, (hint) => " ".repeat(hint.length));
  const tokenRe = /\b[A-Za-z_][\w@$#]*\b/g;
  let last: SqlClause = "other";
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(sanitized))) {
    const mapped = CLAUSE_KEYWORDS[match[0].toLowerCase()];
    if (mapped) last = mapped;
  }
  return last;
}

function statementStartOffset(text: string): number {
  let cut = Math.max(0, text.lastIndexOf(";") + 1);
  const goRe = /(?:^|\n)[ \t]*GO\b[ \t]*(?=\r?\n|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = goRe.exec(text))) {
    cut = Math.max(cut, match.index + match[0].length);
  }
  return cut;
}

const fallbackStatementMemo = memoizeLast(
  (text: string, cursorOffset: number): { text: string; offset: number } =>
    fallbackStatementUncached(text, cursorOffset),
);

function fallbackStatement(
  text: string,
  cursorOffset: number,
): { text: string; offset: number } {
  return fallbackStatementMemo(text, cursorOffset);
}

function fallbackStatementUncached(
  text: string,
  cursorOffset: number,
): { text: string; offset: number } {
  const cut = statementStartOffset(text.slice(0, cursorOffset));
  return { text: text.slice(cut), offset: cursorOffset - cut };
}

function infoNode(lines: string[]): () => HTMLElement {
  return () => {
    const root = document.createElement("div");
    root.className = "cm-sql-completion-info";
    for (const line of lines) {
      const row = document.createElement("div");
      row.textContent = line;
      root.appendChild(row);
    }
    return root;
  };
}

function kindLabel(kind: SchemaObjectEntry["kind"]): string {
  switch (kind) {
    case "VIEW":
      return "view";
    case "PROCEDURE":
      return "procedure";
    case "FUNCTION":
      return "function";
    case "SYNONYM":
      return "synonym";
    case "TYPE":
      return "type";
    case "CTE":
      return "cte";
    default:
      return "table";
  }
}

function objectType(entry: SchemaObjectEntry): string {
  switch (entry.kind) {
    case "VIEW":
      return "interface";
    case "PROCEDURE":
      return "method";
    case "FUNCTION":
      return "function";
    default:
      return "type";
  }
}

function qualifiedName(entry: SchemaObjectEntry): string {
  return entry.schema ? `${entry.schema}.${entry.name}` : entry.name;
}

function parameterSignature(parameters: SchemaParameter[]): string {
  if (parameters.length === 0) return "()";
  return `(${parameters
    .map((parameter) => {
      const type = parameter.typeName ? ` ${parameter.typeName}` : "";
      const output = parameter.isOutput ? " OUTPUT" : "";
      return `${parameter.name}${type}${output}`;
    })
    .join(", ")})`;
}

function columnDetail(column: SchemaColumn): string {
  const parts = [column.typeName].filter(Boolean);
  if (column.isPrimaryKey) parts.push("PK");
  else if (column.isIdentity) parts.push("identity");
  return parts.join(" ");
}

function columnInfo(column: SchemaColumn, table: SchemaObjectEntry) {
  const nullability = column.isNullable ? "NULL" : "NOT NULL";
  const flags = [
    column.isPrimaryKey ? "PK" : "",
    column.isIdentity ? "IDENTITY" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return infoNode(
    [
      qualifiedName(table),
      [column.typeName, nullability, flags].filter(Boolean).join(" "),
    ].filter(Boolean),
  );
}

function makeIdentifierCompletion(
  label: string,
  type: string,
  detail: string | undefined,
  boost = 0,
  info?: Completion["info"],
): Completion {
  const apply = identifierApply(label);
  return {
    label,
    type,
    detail,
    boost,
    info,
    ...(apply === label ? {} : { apply }),
  };
}

function makeDatabaseCompletion(database: string): Completion {
  return {
    label: database,
    type: "class",
    detail: "database",
    boost: 3,
    apply: `${identifierApply(database)}.`,
  };
}

function makeSchemaCompletion(schema: string): Completion {
  return {
    label: schema,
    type: "namespace",
    detail: "schema",
    boost: 2,
    apply: `${identifierApply(schema)}.`,
  };
}

const tableCompletionCache = new WeakMap<SchemaObjectEntry, Completion>();

function makeTableCompletion(entry: SchemaObjectEntry, boost = 0): Completion {
  let base = tableCompletionCache.get(entry);
  if (!base) {
    const extra =
      entry.kind === "FUNCTION" && entry.parameters.length > 0
        ? parameterSignature(entry.parameters)
        : `${entry.columns.length} col${entry.columns.length === 1 ? "" : "s"}`;
    base = makeIdentifierCompletion(
      entry.name,
      objectType(entry),
      entry.schema || kindLabel(entry.kind),
      0,
      infoNode([qualifiedName(entry), `${kindLabel(entry.kind)} · ${extra}`]),
    );
    // Table-valued functions also surface through the table index; keep them
    // callable so FROM/APPLY completions do not insert a bare name.
    if (entry.kind === "FUNCTION") {
      base = { ...base, apply: `${base.apply ?? entry.name}(` };
    }
    tableCompletionCache.set(entry, base);
  }
  return boost === 0 ? base : { ...base, boost };
}

const routineCompletionCache = new WeakMap<SchemaObjectEntry, Completion>();

function makeRoutineCompletion(entry: SchemaObjectEntry, boost = 0): Completion {
  let base = routineCompletionCache.get(entry);
  if (!base) {
    const applyName = identifierApply(entry.name);
    const apply =
      entry.kind === "FUNCTION" ? `${applyName}(` : applyName;
    base = {
      label: entry.name,
      type: objectType(entry),
      detail: entry.schema,
      boost: 0,
      apply: apply === entry.name ? undefined : apply,
      info: infoNode([
        qualifiedName(entry),
        `${kindLabel(entry.kind)} ${parameterSignature(entry.parameters)}`,
      ]),
    };
    routineCompletionCache.set(entry, base);
  }
  return boost === 0 ? base : { ...base, boost };
}

const columnCompletionCache = new WeakMap<SchemaColumn, Completion>();

function makeColumnCompletion(
  column: SchemaColumn,
  table: SchemaObjectEntry,
  boost = 0,
): Completion {
  let base = columnCompletionCache.get(column);
  if (!base) {
    base = makeIdentifierCompletion(
      column.name,
      column.isPrimaryKey ? "pk" : "property",
      columnDetail(column) || qualifiedName(table),
      0,
      columnInfo(column, table),
    );
    columnCompletionCache.set(column, base);
  }
  const effectiveBoost = boost + (column.isPrimaryKey ? 1 : 0);
  return effectiveBoost === 0 ? base : { ...base, boost: effectiveBoost };
}

function makeParameterCompletion(parameter: SchemaParameter, boost = 0): Completion {
  const label = parameter.name.startsWith("@")
    ? parameter.name
    : `@${parameter.name}`;
  return {
    label,
    type: "variable",
    detail: [parameter.typeName, parameter.isOutput ? "OUTPUT" : ""]
      .filter(Boolean)
      .join(" "),
    boost,
    apply: `${label} = `,
  };
}

function makeAliasCompletion(
  alias: string,
  table: SchemaObjectEntry,
): Completion {
  return {
    label: alias,
    type: "constant",
    detail: qualifiedName(table),
    boost: 1,
    apply: `${identifierApply(alias)}.`,
    info: infoNode([`alias of ${qualifiedName(table)}`]),
  };
}

// Quoting a label must not drop the suffix a completion carries in apply,
// such as a function's "(" or a database/schema's ".".
function quotedApply(
  completion: Completion,
  quotedLabel: string,
): string | undefined {
  const apply = completion.apply;
  if (typeof apply !== "string") return undefined;
  const bracketed = identifierApply(completion.label);
  if (apply !== completion.label && apply !== bracketed) {
    const prefix = apply.startsWith(completion.label)
      ? completion.label
      : apply.startsWith(bracketed)
        ? bracketed
        : null;
    return prefix ? quotedLabel + apply.slice(prefix.length) : undefined;
  }
  return undefined;
}

function maybeQuoteCompletions(
  openingQuote: string,
  options: Completion[],
): Completion[] {
  const closingQuote = openingQuote === "[" ? "]" : openingQuote;
  return options.map((completion) => {
    const label = completion.label.startsWith(openingQuote)
      ? completion.label
      : `${openingQuote}${completion.label}${closingQuote}`;
    const apply = quotedApply(completion, label);
    return { ...completion, label, apply };
  });
}

function completionResult(
  context: CompletionContext,
  source: SqlSourceContext,
  options: Completion[],
): CompletionResult | null {
  if (options.length === 0) {
    return null;
  }

  const quoted = source.quoted;
  if (quoted) {
    const closingQuote = quoted === "[" ? "]" : quoted;
    const quoteAfter =
      context.state.sliceDoc(context.pos, context.pos + 1) === closingQuote;
    return {
      from: source.from,
      to: quoteAfter ? context.pos + 1 : undefined,
      options: maybeQuoteCompletions(quoted, options),
    };
  }

  return { from: source.from, options };
}

function dedupeCompletions(options: Completion[]): Completion[] {
  const seen = new Set<string>();
  const result: Completion[] = [];

  for (const option of options) {
    const key = `${option.type ?? ""}:${option.label}:${option.detail ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(option);
  }

  return result;
}

function isKnownDatabase(name: string, databases: string[]): boolean {
  const key = normalizeIdentifier(name);
  return databases.some((database) => normalizeIdentifier(database) === key);
}

function resolveFromMap(
  catalog: SchemaCatalog,
  path: string[],
  currentDatabase: string | undefined,
  tables: boolean,
): SchemaObjectEntry | undefined {
  const parts = path.map(normalizeIdentifier).filter(Boolean);
  if (parts.length === 0) return undefined;
  const byQualified = tables
    ? catalog.tablesByQualifiedName
    : catalog.routinesByQualifiedName;
  const byName = tables ? catalog.tablesByName : catalog.routinesByName;

  if (parts.length >= 3) {
    const database = parts[parts.length - 3];
    const schema = parts[parts.length - 2];
    const name = parts[parts.length - 1];
    if (currentDatabase && database !== normalizeIdentifier(currentDatabase)) {
      return undefined;
    }
    return byQualified.get(`${schema}.${name}`);
  }

  if (parts.length === 2) {
    return byQualified.get(`${parts[0]}.${parts[1]}`);
  }

  const matches = byName.get(parts[0]);
  if (!matches?.length) return undefined;
  return (
    matches.find((entry) => normalizeIdentifier(entry.schema) === "dbo") ??
    matches[0]
  );
}

function resolveTablePath(
  catalog: SchemaCatalog,
  path: string[],
  currentDatabase?: string,
): SchemaObjectEntry | undefined {
  return resolveFromMap(catalog, path, currentDatabase, true);
}

function resolveRoutinePath(
  catalog: SchemaCatalog,
  path: string[],
  currentDatabase?: string,
): SchemaObjectEntry | undefined {
  return resolveFromMap(catalog, path, currentDatabase, false);
}

async function catalogForName(
  name: string,
  ctx: CatalogContext,
): Promise<SchemaCatalog | undefined> {
  if (
    ctx.currentDatabase &&
    normalizeIdentifier(name) === normalizeIdentifier(ctx.currentDatabase)
  ) {
    return ctx.catalog;
  }
  if (!isKnownDatabase(name, ctx.databases)) {
    return undefined;
  }
  try {
    return await loadSchemaCatalog(name);
  } catch (err) {
    console.error(`Failed to load schema catalog for "${name}":`, err);
    return undefined;
  }
}

const COLUMN_DEF_STOP_WORDS = new Set([
  "constraint",
  "primary",
  "foreign",
  "unique",
  "check",
  "default",
]);

function parseColumnDefinitionNames(parenBody: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  const items: string[] = [];
  for (let i = 0; i < parenBody.length; i++) {
    const char = parenBody[i];
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current);

  for (const item of items) {
    const name = readIdentifierAt(stripSqlCommentsAndStrings(item), 0);
    if (!name) continue;
    if (COLUMN_DEF_STOP_WORDS.has(name.name.toLowerCase())) continue;
    columns.push(name.name);
  }
  return columns;
}

const parseSelectIntoTempTablesCache = createTextCache<SchemaObjectEntry[]>();

function parseSelectIntoTempTables(
  statementText: string,
): SchemaObjectEntry[] {
  return parseSelectIntoTempTablesCache(statementText, () =>
    parseSelectIntoTempTablesUncached(statementText),
  );
}

function parseSelectIntoTempTablesUncached(
  statementText: string,
): SchemaObjectEntry[] {
  const sanitized = stripSqlCommentsAndStrings(statementText, true);
  const intoRe = /\bSELECT\s+([\s\S]*?)\s+INTO\s+(#[\w@$#]+)\b/gi;
  const tables: SchemaObjectEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = intoRe.exec(sanitized))) {
    tables.push(
      makeVirtualTable(
        match[2],
        parseSelectListColumns(`SELECT ${match[1]} FROM __x`),
      ),
    );
  }
  return tables;
}

const parseCreateTableDefinitionsCache = createTextCache<SchemaObjectEntry[]>();

function parseCreateTableDefinitions(
  statementText: string,
): SchemaObjectEntry[] {
  return parseCreateTableDefinitionsCache(statementText, () =>
    parseCreateTableDefinitionsUncached(statementText),
  );
}

function parseCreateTableDefinitionsUncached(
  statementText: string,
): SchemaObjectEntry[] {
  const sanitized = stripSqlCommentsAndStrings(statementText, true);
  const tableRe = /\b(?:CREATE\s+TABLE\s+(#[\w@$#]+)|DECLARE\s+(@[\w@$#]+)\s+TABLE)\s*\(/gi;
  const tables: SchemaObjectEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(sanitized))) {
    const body = readBalancedParens(sanitized, match.index + match[0].length - 1);
    if (!body) continue;
    tables.push(makeVirtualTable(match[1] ?? match[2], parseColumnDefinitionNames(body.inner)));
  }
  return tables;
}

function virtualTables(statementText: string): SchemaObjectEntry[] {
  return [
    ...parseCtes(statementText),
    ...parseDerivedTables(statementText),
    ...parseSelectIntoTempTables(statementText),
    ...parseCreateTableDefinitions(statementText),
  ];
}

// temp tables and table variables survive across statements in a batch, so the
// statement's own virtuals are merged with the whole document's
function batchVirtualTables(
  statementText: string,
  docText: string,
  catalog: SchemaCatalog,
): SchemaObjectEntry[] {
  return [
    ...virtualTables(statementText),
    ...virtualTables(docText),
    ...tableTypeVariables(docText, catalog),
  ];
}

function resolveVirtual(
  virtuals: SchemaObjectEntry[],
  path: string[],
): SchemaObjectEntry | undefined {
  if (path.length !== 1) return undefined;
  const key = normalizeIdentifier(path[0]);
  return virtuals.find((entry) => normalizeIdentifier(entry.name) === key);
}

async function resolveTablePathAny(
  ctx: CatalogContext,
  path: string[],
  virtuals: SchemaObjectEntry[] = [],
): Promise<SchemaObjectEntry | undefined> {
  const virtual = resolveVirtual(virtuals, path);
  if (virtual) return virtual;
  if (path.filter(Boolean).length >= 3) {
    const database = path[path.length - 3];
    const other = await catalogForName(database, ctx);
    if (!other) return undefined;
    return resolveTablePath(other, path.slice(-2), database);
  }
  return resolveTablePath(ctx.catalog, path, ctx.currentDatabase);
}

function tablesForSchema(
  catalog: SchemaCatalog,
  schema: string,
): SchemaObjectEntry[] {
  return catalog.tablesBySchema.get(normalizeIdentifier(schema)) ?? [];
}

function routinesForSchema(
  catalog: SchemaCatalog,
  schema: string,
): SchemaObjectEntry[] {
  return catalog.routinesBySchema.get(normalizeIdentifier(schema)) ?? [];
}

function columnsForTable(
  entry: SchemaObjectEntry,
  boost = 0,
  used?: Set<string>,
): Completion[] {
  return entry.columns
    .filter((column) => !used || !used.has(column.name.toLowerCase()))
    .map((column) => makeColumnCompletion(column, entry, boost));
}

async function visibleTableRefs(
  context: CompletionContext,
  source: SqlSourceContext,
  ctx: CatalogContext,
): Promise<VisibleTableRef[]> {
  const refs: VisibleTableRef[] = [];
  const seen = new Set<string>();
  const statementText = source.statement
    ? context.state.doc.sliceString(source.statement.from, source.statement.to)
    : fallbackStatement(docText(context.state), context.pos).text;
  const ctes = parseCtes(statementText);
  const derivedTables = parseDerivedTables(statementText);
  const virtuals = batchVirtualTables(
    statementText,
    docText(context.state),
    ctx.catalog,
  );
  const addRef = (table: SchemaObjectEntry | undefined, alias?: string) => {
    if (!table) return;
    const key = `${qualifiedObjectKey(table.schema, table.name)}:${alias ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ table, alias });
  };

  for (const cte of ctes) {
    addRef(cte);
  }
  for (const derived of derivedTables) {
    addRef(derived, derived.name);
  }

  for (const ref of parseStatementTableReferences(statementText)) {
    addRef(await resolveTablePathAny(ctx, ref.path, virtuals), ref.alias);
  }

  if (source.aliases) {
    for (const [alias, path] of Object.entries(source.aliases)) {
      addRef(await resolveTablePathAny(ctx, path, virtuals), alias);
    }
  }

  return refs;
}

function aliasPathFor(
  source: SqlSourceContext,
  alias: string,
): string[] | undefined {
  if (!source.aliases) {
    return undefined;
  }

  const aliasKey = normalizeIdentifier(alias);
  const found = Object.entries(source.aliases).find(
    ([key]) => normalizeIdentifier(key) === aliasKey,
  );
  return found?.[1];
}

function snippetCompletions(): Completion[] {
  return [
    snippetCompletion("SELECT * FROM ${table}", {
      label: "ssf",
      type: "snippet",
      detail: "SELECT * FROM",
      boost: -1,
    }),
    snippetCompletion("SELECT TOP (100) *\nFROM ${table}\nORDER BY ${column} DESC", {
      label: "top100",
      type: "snippet",
      detail: "SELECT TOP 100",
      boost: -1,
    }),
    snippetCompletion("INNER JOIN ${table} ON ${left} = ${right}", {
      label: "ij",
      type: "snippet",
      detail: "INNER JOIN",
      boost: -1,
    }),
    snippetCompletion("LEFT JOIN ${table} ON ${left} = ${right}", {
      label: "lj",
      type: "snippet",
      detail: "LEFT JOIN",
      boost: -1,
    }),
    snippetCompletion("RIGHT JOIN ${table} ON ${left} = ${right}", {
      label: "rj",
      type: "snippet",
      detail: "RIGHT JOIN",
      boost: -1,
    }),
    snippetCompletion("SELECT TOP ${n} *\nFROM ${table}", {
      label: "SELECT TOP",
      type: "snippet",
      detail: "query",
      boost: -2,
    }),
    snippetCompletion(
      "INSERT INTO ${table} (${columns})\nVALUES (${values})",
      {
        label: "INSERT INTO",
        type: "snippet",
        detail: "query",
        boost: -2,
      },
    ),
    snippetCompletion(
      "UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition}",
      {
        label: "UPDATE",
        type: "snippet",
        detail: "query",
        boost: -2,
      },
    ),
    snippetCompletion("DELETE FROM ${table}\nWHERE ${condition}", {
      label: "DELETE FROM",
      type: "snippet",
      detail: "query",
      boost: -2,
    }),
    snippetCompletion(
      "CREATE PROCEDURE ${schema}.${name}\nAS\nBEGIN\n  SET NOCOUNT ON;\n  ${body}\nEND",
      {
        label: "CREATE PROCEDURE",
        type: "snippet",
        detail: "ddl",
        boost: -3,
      },
    ),
  ];
}

function prefersTables(clause: SqlClause): boolean {
  return (
    clause === "from" ||
    clause === "join" ||
    clause === "update" ||
    clause === "insert" ||
    clause === "delete"
  );
}

function prefersColumns(clause: SqlClause): boolean {
  return (
    clause === "select" ||
    clause === "where" ||
    clause === "group" ||
    clause === "having" ||
    clause === "order" ||
    clause === "set" ||
    clause === "on" ||
    clause === "insert-columns"
  );
}

async function joinPairCompletions(
  sideTable: SchemaObjectEntry,
  sideName: string,
  statementText: string,
  ctx: CatalogContext,
  virtuals: SchemaObjectEntry[],
): Promise<Completion[]> {
  const refs = parseStatementTableReferences(statementText);
  const sideKey = normalizeIdentifier(sideName);
  const sideIndex = refs.findIndex(
    (ref) =>
      normalizeIdentifier(ref.alias ?? ref.path[ref.path.length - 1] ?? "") ===
      sideKey,
  );
  if (sideIndex < 0) return [];
  const partner =
    refs[sideIndex === refs.length - 1 ? sideIndex - 1 : sideIndex + 1] ??
    refs.find((_, index) => index !== sideIndex);
  if (!partner) return [];
  const partnerTable = await resolveTablePathAny(ctx, partner.path, virtuals);
  const partnerName = partner.alias ?? partner.path[partner.path.length - 1];
  if (!partnerTable || !partnerName) return [];

  const partnerColumns = new Set(
    partnerTable.columns.map((column) => normalizeIdentifier(column.name)),
  );
  const side = identifierApply(sideName);
  const other = identifierApply(partnerName);
  const pairs: Completion[] = [];
  for (const column of sideTable.columns) {
    if (!partnerColumns.has(normalizeIdentifier(column.name))) continue;
    const columnName = identifierApply(column.name);
    pairs.push({
      label: `${sideName}.${column.name} = ${partnerName}.${column.name}`,
      type: "property",
      detail: "join condition",
      boost: 60,
      apply: `${side}.${columnName} = ${other}.${columnName}`,
      info: infoNode([
        `join ${qualifiedName(sideTable)} with ${qualifiedName(partnerTable)}`,
      ]),
    });
  }
  return pairs;
}

async function pathCompletions(
  ctx: CatalogContext,
  source: SqlSourceContext,
  statementText: string,
  clause: SqlClause,
): Promise<Completion[]> {
  const parents = source.parents.filter(Boolean);
  if (parents.length === 0) {
    return [];
  }

  const wantRoutines = clause === "exec" || clause === "exec-args";
  const first = parents[0];
  const virtuals = virtualTables(statementText);

  if (parents.length === 1) {
    const aliasPath = aliasPathFor(source, first);
    if (aliasPath) {
      const aliasTable = await resolveTablePathAny(ctx, aliasPath, virtuals);
      if (aliasTable) {
        if (clause === "on") {
          return [
            ...columnsForTable(aliasTable, 15),
            ...(await joinPairCompletions(
              aliasTable,
              first,
              statementText,
              ctx,
              virtuals,
            )),
          ];
        }
        return columnsForTable(aliasTable, 4);
      }
    }
    const virtual = resolveVirtual(virtuals, [first]);
    if (virtual) {
      return columnsForTable(virtual, 4);
    }
  }

  if (parents.length === 1 && isKnownDatabase(first, ctx.databases)) {
    const other = await catalogForName(first, ctx);
    if (other) {
      return other.schemas.map(makeSchemaCompletion);
    }
  }

  if (parents.length === 2 && isKnownDatabase(parents[0], ctx.databases)) {
    const other = await catalogForName(parents[0], ctx);
    if (other) {
      const schemaObjects = wantRoutines
        ? routinesForSchema(other, parents[1]).map((entry) =>
            makeRoutineCompletion(entry, 2),
          )
        : tablesForSchema(other, parents[1]).map((entry) =>
            makeTableCompletion(entry, 2),
          );
      return dedupeCompletions(schemaObjects);
    }
  }

  if (parents.length >= 3 && isKnownDatabase(parents[0], ctx.databases)) {
    const other = await catalogForName(parents[0], ctx);
    if (other) {
      const table = resolveTablePath(other, parents.slice(-2), parents[0]);
      if (table) return columnsForTable(table, 3);
      const routine = resolveRoutinePath(other, parents.slice(-2), parents[0]);
      if (routine) {
        return routine.parameters.map((parameter) =>
          makeParameterCompletion(parameter, 4),
        );
      }
    }
  }

  const schemaName = parents[parents.length - 1];
  const tableOptions = tablesForSchema(ctx.catalog, schemaName).map((entry) =>
    makeTableCompletion(entry, 2),
  );
  // Outside EXEC only functions are valid, e.g. in FROM or SELECT lists.
  const routineOptions = routinesForSchema(ctx.catalog, schemaName)
    .filter((entry) => wantRoutines || entry.kind === "FUNCTION")
    .map((entry) => makeRoutineCompletion(entry, 2));
  const table = resolveTablePath(ctx.catalog, parents, ctx.currentDatabase);
  const columnOptions = table ? columnsForTable(table, 3) : [];
  const routine = resolveRoutinePath(
    ctx.catalog,
    parents,
    ctx.currentDatabase,
  );
  const parameterOptions = routine
    ? routine.parameters.map((parameter) => makeParameterCompletion(parameter, 4))
    : [];

  if (wantRoutines) {
    return dedupeCompletions([...routineOptions, ...parameterOptions]);
  }

  return dedupeCompletions([
    ...columnOptions,
    ...tableOptions,
    ...routineOptions,
  ]);
}

async function topLevelCompletions(
  context: CompletionContext,
  source: SqlSourceContext,
  ctx: CatalogContext,
  clause: SqlClause,
): Promise<Completion[]> {
  const fallback = fallbackStatement(docText(context.state), context.pos);
  const statementText = source.statement
    ? context.state.doc.sliceString(source.statement.from, source.statement.to)
    : fallback.text;
  const cursorOffset = source.statement
    ? context.pos - source.statement.from
    : fallback.offset;
  const options: Completion[] = [];

  const ddlTarget = parseDdlTargetContext(statementText, cursorOffset);
  if (ddlTarget) {
    const filter = (entry: SchemaObjectEntry) =>
      ddlTarget === "TABLE"
        ? entry.kind === "TABLE" || entry.kind === "CTE"
        : ddlTarget === "VIEW"
          ? entry.kind === "VIEW"
          : entry.kind === "PROCEDURE" || entry.kind === "FUNCTION";
    const entries =
      ddlTarget === "PROCEDURE" || ddlTarget === "FUNCTION"
        ? ctx.catalog.routines
        : ctx.catalog.tables;
    return dedupeCompletions(
      entries
        .filter(filter)
        .map((entry) =>
          ddlTarget === "PROCEDURE" || ddlTarget === "FUNCTION"
            ? makeRoutineCompletion(entry, 12)
            : makeTableCompletion(entry, 12),
        ),
    );
  }

  if (clause === "insert-columns") {
    const insert = parseInsertColumnContext(statementText, cursorOffset);
    if (insert) {
      const table = await resolveTablePathAny(
        ctx,
        insert.path,
        batchVirtualTables(
          statementText,
          docText(context.state),
          ctx.catalog,
        ),
      );
      if (table) {
        const used = new Set(insert.used.map((name) => name.toLowerCase()));
        return columnsForTable(table, 12, used);
      }
    }
  }

  if (clause === "exec" || clause === "exec-args") {
    const exec = parseExecContext(statementText, cursorOffset);
    if (exec?.inArgs && exec.procPath.length > 0) {
      let routine = resolveRoutinePath(
        ctx.catalog,
        exec.procPath,
        ctx.currentDatabase,
      );
      if (!routine && exec.procPath.length >= 3) {
        const other = await catalogForName(exec.procPath[0], ctx);
        if (other) {
          routine = resolveRoutinePath(
            other,
            exec.procPath.slice(-2),
            exec.procPath[0],
          );
        }
      }
      if (routine) {
        options.push(
          ...routine.parameters.map((parameter) =>
            makeParameterCompletion(parameter, 8),
          ),
        );
      }
    }
    options.push(
      ...ctx.catalog.routines.map((entry) => makeRoutineCompletion(entry, 4)),
    );
    options.push(...ctx.catalog.schemas.map(makeSchemaCompletion));
    return dedupeCompletions(options);
  }

  const visibleRefs = await visibleTableRefs(context, source, ctx);

  if (clause === "on") {
    const joinRefs = visibleRefs.slice(-2);
    if (joinRefs.length === 2) {
      const [left, right] = joinRefs;
      const leftNames = new Set(
        left.table.columns.map((column) => normalizeIdentifier(column.name)),
      );
      const rightNames = new Set(
        right.table.columns.map((column) => normalizeIdentifier(column.name)),
      );
      for (const ref of joinRefs) {
        const otherNames = ref === left ? rightNames : leftNames;
        for (const column of ref.table.columns) {
          const matches = otherNames.has(normalizeIdentifier(column.name));
          options.push(
            makeColumnCompletion(column, ref.table, matches ? 15 : 12),
          );
        }
        const sideName = ref.alias ?? ref.table.name;
        options.push(
          ...(await joinPairCompletions(
            ref.table,
            sideName,
            statementText,
            ctx,
            virtualTables(statementText),
          )),
        );
      }
      return dedupeCompletions(options);
    }
    for (const ref of joinRefs) {
      options.push(...columnsForTable(ref.table, 12));
    }
    return dedupeCompletions(options);
  }

  if (prefersTables(clause)) {
    options.push(...ctx.catalog.schemas.map(makeSchemaCompletion));
    options.push(
      ...ctx.catalog.tables.map((entry) => makeTableCompletion(entry, 4)),
    );
    options.push(
      ...ctx.catalog.routines
        .filter((entry) => entry.kind === "FUNCTION")
        .map((entry) => makeRoutineCompletion(entry, 4)),
    );
    const typed = context.state
      .sliceDoc(source.from, context.pos)
      .toLowerCase();
    for (const ref of visibleRefs) {
      if (ref.alias) {
        if (ref.alias.toLowerCase() !== typed) {
          options.push(makeAliasCompletion(ref.alias, ref.table));
        }
      } else {
        options.push(makeTableCompletion(ref.table, 6));
      }
    }
    options.push(...ctx.databases.map(makeDatabaseCompletion));
    return dedupeCompletions(options);
  }

  const selectList = selectListNames(statementText, cursorOffset);
  const usedColumns =
    clause === "select" && selectList.inList && selectList.names.size > 0
      ? selectList.names
      : undefined;
  const boostSelected = clause === "order" || clause === "group";

  for (const ref of visibleRefs) {
    const base = prefersColumns(clause) ? 11 : 9;
    if (boostSelected) {
      for (const column of ref.table.columns) {
        const inSelect = selectList.names.has(column.name.toLowerCase());
        options.push(
          makeColumnCompletion(column, ref.table, base + (inSelect ? 2 : 0)),
        );
      }
    } else {
      options.push(...columnsForTable(ref.table, base, usedColumns));
    }
    if (ref.alias) {
      options.push(makeAliasCompletion(ref.alias, ref.table));
    }
  }

  if (boostSelected) {
    for (const alias of selectList.aliases.values()) {
      options.push({
        label: alias,
        type: "property",
        detail: "select alias",
        boost: 12,
      });
    }
  }

  if (!prefersColumns(clause) || visibleRefs.length === 0) {
    options.push(...ctx.catalog.schemas.map(makeSchemaCompletion));
    options.push(
      ...ctx.catalog.tables.map((entry) => makeTableCompletion(entry)),
    );
    options.push(
      ...ctx.catalog.routines.map((entry) => makeRoutineCompletion(entry)),
    );
    options.push(...ctx.databases.map(makeDatabaseCompletion));
  } else if (clause === "select" || clause === "where" || clause === "having") {
    options.push(
      ...ctx.catalog.routines
        .filter((entry) => entry.kind === "FUNCTION")
        .map((entry) => makeRoutineCompletion(entry, 2)),
    );
  }

  return dedupeCompletions(options);
}

function fuzzyMatchScore(label: string, query: string): number {
  if (!query) return 0;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) return 10000;
  if (l.startsWith(q)) return 5000 - l.length;

  const idx = l.indexOf(q);
  if (idx >= 0) {
    const before = idx > 0 ? l[idx - 1] : "_";
    const isBoundary = before === "_" || before === "." || before === " ";
    return (isBoundary ? 1500 : 800) - idx - l.length;
  }

  let qi = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) {
      qi++;
      consecutive++;
      if (consecutive > maxConsecutive) maxConsecutive = consecutive;
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return -1;
  return 100 + maxConsecutive * 10 - l.length;
}

const NEXT_KEYWORDS: Record<SqlClause, readonly string[]> = {
  other: [
    "SELECT",
    "WITH",
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "EXEC",
    "CREATE",
    "ALTER",
    "DROP",
    "TRUNCATE",
    "DECLARE",
    "USE",
    "SET",
    "BEGIN",
    "IF",
    "WHILE",
    "PRINT",
    "COMMIT",
    "ROLLBACK",
    "THROW",
  ],
  select: [
    "FROM",
    "TOP",
    "DISTINCT",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "AS",
    "OVER",
    "PARTITION",
    "WHERE",
    "GROUP",
    "HAVING",
    "ORDER",
    "UNION",
    "ALL",
    "EXCEPT",
    "INTERSECT",
    "INTO",
    "FOR",
    "COLLATE",
    "OPTION",
  ],
  from: [
    "JOIN",
    "INNER",
    "LEFT",
    "RIGHT",
    "FULL",
    "CROSS",
    "OUTER",
    "APPLY",
    "ON",
    "WHERE",
    "GROUP",
    "ORDER",
    "AS",
    "FOR",
    "OPTION",
  ],
  join: [
    "JOIN",
    "INNER",
    "LEFT",
    "RIGHT",
    "FULL",
    "CROSS",
    "OUTER",
    "APPLY",
    "ON",
    "WHERE",
    "GROUP",
    "ORDER",
    "AS",
    "FOR",
    "OPTION",
  ],
  on: [
    "AND",
    "OR",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "JOIN",
    "INNER",
    "LEFT",
    "RIGHT",
    "CROSS",
    "OUTER",
    "WHERE",
    "GROUP",
    "ORDER",
  ],
  where: [
    "AND",
    "OR",
    "NOT",
    "IN",
    "LIKE",
    "BETWEEN",
    "IS",
    "NULL",
    "EXISTS",
    "SELECT",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "GROUP",
    "ORDER",
    "HAVING",
    "JOIN",
    "UNION",
    "COLLATE",
    "FOR",
    "OPTION",
  ],
  group: ["BY", "HAVING", "ORDER", "UNION"],
  having: ["AND", "OR", "ORDER", "UNION"],
  order: [
    "BY",
    "ASC",
    "DESC",
    "OFFSET",
    "ROWS",
    "FETCH",
    "NEXT",
    "ONLY",
    "UNION",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "OVER",
    "PARTITION",
    "FOR",
    "COLLATE",
    "OPTION",
  ],
  set: ["WHERE", "FROM", "OUTPUT"],
  update: ["SET", "FROM", "WHERE", "OUTPUT"],
  insert: ["INTO", "VALUES", "SELECT", "OUTPUT"],
  delete: ["FROM", "WHERE", "OUTPUT", "TOP"],
  "insert-columns": [],
  exec: [],
  "exec-args": [],
  with: ["AS", "RECURSIVE", "SELECT", "INSERT", "UPDATE", "DELETE"],
  create: [
    "TABLE",
    "PROCEDURE",
    "VIEW",
    "FUNCTION",
    "INDEX",
    "TRIGGER",
    "SCHEMA",
    "DATABASE",
    "TYPE",
    "SEQUENCE",
    "SYNONYM",
  ],
  alter: ["TABLE", "VIEW", "PROCEDURE", "FUNCTION", "INDEX", "TRIGGER"],
  drop: ["TABLE", "VIEW", "PROCEDURE", "FUNCTION", "INDEX", "TRIGGER"],
  truncate: ["TABLE"],
  begin: ["TRANSACTION", "TRAN", "TRY", "CATCH", "END"],
  txn: ["TRANSACTION", "TRAN", "WORK"],
  cursor: [
    "FOR",
    "LOCAL",
    "GLOBAL",
    "FORWARD_ONLY",
    "SCROLL",
    "STATIC",
    "KEYSET",
    "DYNAMIC",
    "FAST_FORWARD",
    "READ_ONLY",
    "OPTIMISTIC",
  ],
  fetch: [
    "NEXT",
    "PRIOR",
    "FIRST",
    "LAST",
    "ABSOLUTE",
    "RELATIVE",
    "FROM",
    "INTO",
  ],
  "ddl-name": [],
};
const NEXT_KEYWORD_STEP = 30;
const COMPLETION_BOOST_SCALE = 100;
const QUERY_CHARS_RE = /^[\w@$#[\]"]+$/;
// Inside [bracket] or "quoted" identifiers spaces, hyphens, and other
// characters are legal, so queries there use a looser validity check.
const QUOTED_QUERY_RE = /^[["][^\n]*$/;

const STATEMENT_START_BONUS = 200;

function nextKeywordPriority(
  clause: SqlClause,
  atLineStart: boolean,
): Map<string, number> {
  const priority = new Map<string, number>();
  const assign = (keywords: readonly string[], bonus: number) => {
    keywords.forEach((keyword, index) => {
      const score = (keywords.length - index) * NEXT_KEYWORD_STEP + bonus;
      if (score > (priority.get(keyword) ?? -Infinity)) {
        priority.set(keyword, score);
      }
    });
  };
  assign(NEXT_KEYWORDS[clause], 0);
  if (atLineStart && clause !== "other") {
    assign(NEXT_KEYWORDS.other, STATEMENT_START_BONUS);
  }
  return priority;
}

function keywordCompletions(
  clause: SqlClause,
  atLineStart: boolean,
): Completion[] {
  const keywords =
    atLineStart && clause !== "other"
      ? [...new Set([...NEXT_KEYWORDS.other, ...NEXT_KEYWORDS[clause]])]
      : NEXT_KEYWORDS[clause];
  return keywords.map((keyword) => ({
    label: keyword,
    type: "keyword",
  }));
}

const BUILTIN_FUNCTIONS: ReadonlyArray<readonly [string, string]> = [
  ["COUNT", "aggregate"],
  ["COUNT_BIG", "aggregate"],
  ["SUM", "aggregate"],
  ["AVG", "aggregate"],
  ["MIN", "aggregate"],
  ["MAX", "aggregate"],
  ["STDEV", "aggregate"],
  ["STRING_AGG", "aggregate"],
  ["COALESCE", "null"],
  ["ISNULL", "null"],
  ["NULLIF", "null"],
  ["IIF", "null"],
  ["CHOOSE", "null"],
  ["CAST", "conversion"],
  ["CONVERT", "conversion"],
  ["TRY_CAST", "conversion"],
  ["TRY_CONVERT", "conversion"],
  ["PARSE", "conversion"],
  ["LEN", "string"],
  ["LEFT", "string"],
  ["RIGHT", "string"],
  ["SUBSTRING", "string"],
  ["CHARINDEX", "string"],
  ["PATINDEX", "string"],
  ["REPLACE", "string"],
  ["STUFF", "string"],
  ["CONCAT", "string"],
  ["UPPER", "string"],
  ["LOWER", "string"],
  ["LTRIM", "string"],
  ["RTRIM", "string"],
  ["TRIM", "string"],
  ["FORMAT", "string"],
  ["QUOTENAME", "string"],
  ["REPLICATE", "string"],
  ["SPACE", "string"],
  ["STRING_SPLIT", "string"],
  ["GETDATE", "date"],
  ["GETUTCDATE", "date"],
  ["SYSDATETIME", "date"],
  ["SYSUTCDATETIME", "date"],
  ["DATEADD", "date"],
  ["DATEDIFF", "date"],
  ["DATEDIFF_BIG", "date"],
  ["DATEPART", "date"],
  ["DATENAME", "date"],
  ["YEAR", "date"],
  ["MONTH", "date"],
  ["DAY", "date"],
  ["EOMONTH", "date"],
  ["DATEFROMPARTS", "date"],
  ["ISDATE", "date"],
  ["ABS", "math"],
  ["ROUND", "math"],
  ["CEILING", "math"],
  ["FLOOR", "math"],
  ["POWER", "math"],
  ["SQRT", "math"],
  ["SIGN", "math"],
  ["RAND", "math"],
  ["ROW_NUMBER", "window · OVER"],
  ["RANK", "window · OVER"],
  ["DENSE_RANK", "window · OVER"],
  ["NTILE", "window · OVER"],
  ["LAG", "window · OVER"],
  ["LEAD", "window · OVER"],
  ["FIRST_VALUE", "window · OVER"],
  ["LAST_VALUE", "window · OVER"],
  ["SCOPE_IDENTITY", "identity"],
  ["IDENT_CURRENT", "identity"],
  ["NEWID", "misc"],
  ["HASHBYTES", "misc"],
  ["CHECKSUM", "misc"],
  ["JSON_VALUE", "json"],
  ["JSON_QUERY", "json"],
  ["JSON_MODIFY", "json"],
  ["ISJSON", "json"],
];

const BUILTIN_VARIABLES = [
  "@@ROWCOUNT",
  "@@ERROR",
  "@@IDENTITY",
  "@@TRANCOUNT",
  "@@FETCH_STATUS",
  "@@VERSION",
  "@@SERVERNAME",
  "@@SERVICENAME",
  "@@SPID",
  "@@LANGUAGE",
  "@@DATEFIRST",
  "@@NESTLEVEL",
];

const SQL_DATA_TYPES = [
  "INT",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "BIT",
  "DECIMAL",
  "NUMERIC",
  "FLOAT",
  "REAL",
  "MONEY",
  "SMALLMONEY",
  "CHAR",
  "VARCHAR",
  "NCHAR",
  "NVARCHAR",
  "TEXT",
  "NTEXT",
  "DATE",
  "TIME",
  "DATETIME",
  "DATETIME2",
  "SMALLDATETIME",
  "DATETIMEOFFSET",
  "BINARY",
  "VARBINARY",
  "UNIQUEIDENTIFIER",
  "XML",
  "SQL_VARIANT",
  "ROWVERSION",
];

const TABLE_HINT_KEYWORDS = [
  "NOLOCK",
  "READUNCOMMITTED",
  "READCOMMITTED",
  "REPEATABLEREAD",
  "SERIALIZABLE",
  "HOLDLOCK",
  "UPDLOCK",
  "TABLOCK",
  "TABLOCKX",
  "ROWLOCK",
  "READPAST",
  "FORCESEEK",
  "FORCESCAN",
];

const COLUMN_DEF_KEYWORDS = [
  "PRIMARY KEY",
  "FOREIGN KEY",
  "NOT NULL",
  "NULL",
  "IDENTITY",
  "DEFAULT",
  "UNIQUE",
  "CHECK",
  "REFERENCES",
  "CONSTRAINT",
  "COLLATE",
  "SPARSE",
  "ROWGUIDCOL",
];

function builtinFunctionCompletions(): Completion[] {
  return BUILTIN_FUNCTIONS.map(([name, category]) => ({
    label: name,
    type: "function",
    detail: category,
    boost: 3,
    apply: `${name}(`,
  }));
}

function builtinVariableCompletions(): Completion[] {
  return BUILTIN_VARIABLES.map((name) => ({
    label: name,
    type: "variable",
    detail: "system variable",
    boost: 3,
  }));
}

function dataTypeCompletions(boost = 10): Completion[] {
  return SQL_DATA_TYPES.map((name) => ({
    label: name,
    type: "type",
    detail: "type",
    boost,
  }));
}

function keywordListCompletions(
  keywords: readonly string[],
  boost: number,
): Completion[] {
  return keywords.map((keyword) => ({
    label: keyword,
    type: "keyword",
    boost,
  }));
}

const localVariableCompletionsCache = createTextCache<Completion[]>();

function localVariableCompletions(statementText: string): Completion[] {
  return localVariableCompletionsCache(statementText, () =>
    localVariableCompletionsUncached(statementText),
  );
}

function localVariableCompletionsUncached(statementText: string): Completion[] {
  const declared = new Set<string>();
  const declareRe = /\bDECLARE\s+(@[\w@$#]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = declareRe.exec(statementText))) {
    declared.add(match[1]);
  }
  return [...declared].map((name) => ({
    label: name,
    type: "variable",
    detail: "local variable",
    boost: 4,
  }));
}

function userTypeCompletions(
  catalog: SchemaCatalog | undefined,
  boost: number,
): Completion[] {
  if (!catalog || catalog.userTypes.length === 0) return [];
  return catalog.userTypes.map((entry) => ({
    label: entry.name,
    type: "type",
    detail: entry.columns.length > 0
      ? `table type · ${entry.schema}`
      : `type · ${entry.schema}`,
    boost,
  }));
}

// DECLARE @ids dbo.IntIdList turns @ids into a table variable whose columns
// come from the catalog's user-defined table types.
const tableTypeVariablesCaches = new WeakMap<
  SchemaCatalog,
  ReturnType<typeof createTextCache<SchemaObjectEntry[]>>
>();

function tableTypeVariables(
  statementText: string,
  catalog: SchemaCatalog | undefined,
): SchemaObjectEntry[] {
  if (!catalog || catalog.userTypesByName.size === 0) return [];
  let cache = tableTypeVariablesCaches.get(catalog);
  if (!cache) {
    cache = createTextCache<SchemaObjectEntry[]>();
    tableTypeVariablesCaches.set(catalog, cache);
  }
  return cache(statementText, () =>
    tableTypeVariablesUncached(statementText, catalog),
  );
}

function tableTypeVariablesUncached(
  statementText: string,
  catalog: SchemaCatalog | undefined,
): SchemaObjectEntry[] {
  if (!catalog || catalog.userTypesByName.size === 0) return [];
  const sanitized = stripSqlCommentsAndStrings(statementText, true);
  const declareRe =
    /\bDECLARE\s+(@[\w@$#]+)\s+(?:\[?[\w@$#]+]?\.)?\[?([A-Za-z_][\w@$#]*)]?/gi;
  const virtuals: SchemaObjectEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = declareRe.exec(sanitized))) {
    const typeName = match[2];
    if (typeName.toLowerCase() === "table") continue;
    const candidates = catalog.userTypesByName.get(
      normalizeIdentifier(typeName),
    );
    const userType = candidates?.find((entry) => entry.columns.length > 0);
    if (userType) {
      virtuals.push({
        name: match[1],
        schema: userType.schema,
        kind: "TYPE",
        columns: userType.columns,
        parameters: [],
      });
    }
  }
  return virtuals;
}

const QUERY_HINT_KEYWORDS = [
  "RECOMPILE",
  "MAXDOP",
  "FORCE ORDER",
  "LOOP JOIN",
  "MERGE JOIN",
  "HASH JOIN",
  "OPTIMIZE FOR",
  "FAST",
  "KEEPFIXED PLAN",
  "ROBUST PLAN",
  "USE HINT",
];
const FOR_KEYWORDS = ["XML", "JSON"];
const FOR_XML_KEYWORDS = [
  "PATH",
  "AUTO",
  "RAW",
  "EXPLICIT",
  "ELEMENTS",
  "ROOT",
  "TYPE",
];
const FOR_JSON_KEYWORDS = [
  "PATH",
  "AUTO",
  "ROOT",
  "INCLUDE_NULL_VALUES",
  "WITHOUT_ARRAY_WRAPPER",
];
const COLLATION_NAMES = [
  "SQL_Latin1_General_CP1_CI_AS",
  "SQL_Latin1_General_CP1_CS_AS",
  "Latin1_General_CI_AS",
  "Latin1_General_CS_AS",
  "Latin1_General_CI_AI",
  "Latin1_General_BIN2",
];
const PROC_HEADER_KEYWORDS = ["AS", "RETURNS", "WITH"];
const PROC_BODY_KEYWORDS = [
  "BEGIN",
  "OPEN",
  "CLOSE",
  "DEALLOCATE",
  "FETCH",
  "CURSOR",
  "SET",
  "NOCOUNT",
  "SELECT",
  "DECLARE",
  "IF",
  "RETURN",
  "EXEC",
  "INSERT",
  "UPDATE",
  "DELETE",
  "END",
  "THROW",
  "WHILE",
];

function selectListNames(
  statementText: string,
  cursorOffset: number,
): { names: Set<string>; aliases: Map<string, string>; inList: boolean } {
  const prefix = stripSqlCommentsAndStrings(
    statementText.slice(0, Math.max(0, cursorOffset)),
  );
  let selectEnd = -1;
  const selectRe = /\bSELECT\b/gi;
  let match: RegExpExecArray | null;
  while ((match = selectRe.exec(prefix))) {
    selectEnd = match.index + match[0].length;
  }
  if (selectEnd < 0) {
    return { names: new Set(), aliases: new Map(), inList: false };
  }

  let segment = prefix.slice(selectEnd);
  let inList = true;
  const cut =
    /\b(?:FROM|WHERE|GROUP|HAVING|ORDER|UNION|OPTION|INTO)\b/i.exec(segment);
  if (cut) {
    segment = segment.slice(0, cut.index);
    inList = false;
  }

  const items = splitTopLevelItems(segment);
  if (inList) items.pop();

  const names = new Set<string>();
  const aliases = new Map<string, string>();
  for (const item of items) {
    const named = selectItemName(item);
    if (!named) continue;
    names.add(named.name.toLowerCase());
    if (named.aliased) {
      aliases.set(named.name.toLowerCase(), named.name);
    }
  }
  return { names, aliases, inList };
}

function contextKeywords(
  statementText: string,
  cursorOffset: number,
  clause: SqlClause,
): { keywords: readonly string[]; boost: number } | null {
  const prefix = stripSqlCommentsAndStrings(
    statementText.slice(0, Math.max(0, cursorOffset)),
  );

  if (/\bOPTION\s*\(\s*[\w]*$/i.test(prefix)) {
    return { keywords: QUERY_HINT_KEYWORDS, boost: 12 };
  }
  if (/\bFOR\s+XML\s+[\w]*$/i.test(prefix)) {
    return { keywords: FOR_XML_KEYWORDS, boost: 12 };
  }
  if (/\bFOR\s+JSON\s+[\w]*$/i.test(prefix)) {
    return { keywords: FOR_JSON_KEYWORDS, boost: 12 };
  }
  if (/\bFOR\s+[\w]*$/i.test(prefix)) {
    return { keywords: FOR_KEYWORDS, boost: 12 };
  }
  if (/\bCOLLATE\s+[\w]*$/i.test(prefix)) {
    return { keywords: COLLATION_NAMES, boost: 12 };
  }

  const procHead = /\b(?:CREATE|ALTER)\s+(?:PROCEDURE|PROC|FUNCTION|TRIGGER|VIEW)\b/i.exec(
    prefix,
  );
  if (procHead) {
    const after = prefix.slice(procHead.index + procHead[0].length);
    const pastAs = after.search(/\bAS\b/i) >= 0;
    if (clause === "ddl-name" || clause === "other") {
      return {
        keywords: pastAs ? PROC_BODY_KEYWORDS : PROC_HEADER_KEYWORDS,
        boost: 12,
      };
    }
    // inside the body's own clauses keep body keywords available but below
    // columns/tables so they never displace real schema suggestions
    if (pastAs) return { keywords: PROC_BODY_KEYWORDS, boost: 5 };
  }
  return null;
}

type SqlTypeContext =
  | "type"
  | "column-def"
  | "column-def-constraint"
  | "type-param"
  | "hint"
  | null;

// Returns the current column-definition item ("Id INT", "Name VARCHAR(255)
// NOT N") when the cursor sits inside the top-level column list of a CREATE
// TABLE / DECLARE @v TABLE definition, tolerating nested parens. Null once
// the definition's paren has closed.
function tableDefinitionItem(prefix: string): string | null {
  // ALTER TABLE t ADD <column definition> reuses the same completion set
  const addRe = /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+/gi;
  let added: { end: number } | null = null;
  let addMatch: RegExpExecArray | null;
  while ((addMatch = addRe.exec(prefix))) {
    added = { end: addMatch.index + addMatch[0].length };
  }
  if (added && !/^[\s\S]*\b(?:CONSTRAINT|PRIMARY|FOREIGN|CHECK)\b/i.test(prefix.slice(added.end))) {
    const tail = prefix.slice(added.end);
    let depth = 0;
    let itemStart = 0;
    for (let i = 0; i < tail.length; i++) {
      const char = tail[i];
      if (char === "(") depth++;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (char === "," && depth === 0) itemStart = i + 1;
    }
    return tail.slice(itemStart);
  }

  const defRe = /\b(?:CREATE\s+TABLE|DECLARE\s+@[\w@$#]+\s+TABLE)\b/gi;
  let head: { end: number } | null = null;
  let match: RegExpExecArray | null;
  while ((match = defRe.exec(prefix))) {
    head = { end: match.index + match[0].length };
  }
  if (!head) return null;
  const rest = prefix.slice(head.end);
  const open = rest.indexOf("(");
  if (open < 0) return null;
  let depth = 0;
  let itemStart = open + 1;
  for (let i = open; i < rest.length; i++) {
    const char = rest[i];
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return null;
    } else if (char === "," && depth === 1) {
      itemStart = i + 1;
    }
  }
  return depth > 0 ? rest.slice(itemStart) : null;
}

function sqlTypeContextAt(
  statementText: string,
  cursorOffset: number,
): SqlTypeContext {
  const prefix = stripSqlCommentsAndStrings(
    statementText.slice(0, Math.max(0, cursorOffset)),
  );

  if (/\bWITH\s*\(\s*[\w]*$/i.test(prefix)) {
    return "hint";
  }
  const columnItem = tableDefinitionItem(prefix);
  if (columnItem !== null) {
    const tokens = columnItem.match(/\b[A-Za-z_@#][\w@$#]*/g) ?? [];
    tokens.pop();
    // name [type ...] typed already -> constraints come next, not more types
    return tokens.length >= 2 ? "column-def-constraint" : "column-def";
  }
  if (/\b(?:CAST|TRY_CAST)\s*\([^)]*\bAS\s+[\w]*$/i.test(prefix)) {
    return "type";
  }
  if (/\b(?:CONVERT|TRY_CONVERT|PARSE)\s*\(\s*[\w]*$/i.test(prefix)) {
    return "type";
  }
  if (/(?:\bDECLARE|,)\s*@[\w@$#]+\s+[\w]*$/i.test(prefix)) {
    return "type";
  }
  const procHead = /\b(?:CREATE|ALTER)\s+(?:PROCEDURE|PROC|FUNCTION)\b/i.exec(
    prefix,
  );
  if (
    procHead &&
    prefix.slice(procHead.index + procHead[0].length).search(/\bAS\b/i) < 0
  ) {
    return "type-param";
  }
  return null;
}

type DdlTargetKind = "TABLE" | "VIEW" | "PROCEDURE" | "FUNCTION";

function parseDdlTargetContext(
  statementText: string,
  cursorOffset: number,
): DdlTargetKind | null {
  const prefix = stripSqlCommentsAndStrings(
    statementText.slice(0, Math.max(0, cursorOffset)),
  );
  const ddlRe = /\b(?:DROP|ALTER)\s+(TABLE|VIEW|PROCEDURE|PROC|FUNCTION)\s+/gi;
  let match: RegExpExecArray | null;
  let last: { kind: string; end: number } | null = null;
  while ((match = ddlRe.exec(prefix))) {
    last = { kind: match[1].toUpperCase(), end: match.index + match[0].length };
  }
  if (!last) return null;
  const between = prefix.slice(last.end);
  if (/^\s*[\w@$#[\]".]*$/.test(between)) {
    if (last.kind === "PROC") return "PROCEDURE";
    return last.kind as DdlTargetKind;
  }
  return null;
}

function isExpressionClause(clause: SqlClause): boolean {
  return (
    clause === "select" ||
    clause === "where" ||
    clause === "having" ||
    clause === "order" ||
    clause === "on" ||
    clause === "set" ||
    clause === "insert-columns"
  );
}

const optionBaseScores = new WeakMap<Completion, number>();

function rankCompletions(
  options: readonly Completion[],
  query: string,
  clause: SqlClause,
  atLineStart: boolean,
): Completion[] {
  const keywordPriority = nextKeywordPriority(clause, atLineStart);

  const scored: Array<{ option: Completion; score: number }> = [];
  for (const option of options) {
    const match = fuzzyMatchScore(option.label, query);
    if (query && match < 0) continue;
    const priority = keywordPriority.get(option.label.toUpperCase()) ?? 0;
    const base = priority + (option.boost ?? 0) * COMPLETION_BOOST_SCALE;
    optionBaseScores.set(option, base);
    scored.push({ option, score: match + base });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_COMPLETION_OPTIONS).map((entry) => entry.option);
}

function refilterResult(
  current: CompletionResult,
  from: number,
  to: number,
  context: CompletionContext,
): CompletionResult | null {
  const query = context.state.sliceDoc(from, to);
  if (
    !query ||
    !(QUERY_CHARS_RE.test(query) || QUOTED_QUERY_RE.test(query))
  ) {
    return null;
  }

  const scored: Array<{ option: Completion; score: number }> = [];
  for (const option of current.options) {
    const score = fuzzyMatchScore(option.label, query);
    if (score >= 0) {
      scored.push({ option, score: score + (optionBaseScores.get(option) ?? 0) });
    }
  }
  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  return { ...current, from, to, options: scored.map((entry) => entry.option) };
}

export function buildAutocompletionExt(
  source: (context: CompletionContext) => Promise<CompletionResult | null>,
  style: EditorSuggestionStyle,
) {
  return autocompletion({
    defaultKeymap: true,
    closeOnBlur: false,
    maxRenderedOptions: 80,
    override: [source],
    activateOnTyping: style === "popup",
    compareCompletions: () => 0,
    activateOnCompletion: (completion) =>
      completion.type === "namespace" ||
      completion.type === "constant" ||
      completion.type === "class",
  });
}

export async function sqlCompletionSource(
  context: CompletionContext,
  options: SqlCompletionOptions,
): Promise<CompletionResult | null> {
  if (isCompletionBlocked(context)) {
    return null;
  }

  const source = resolveSourceContext(
    context,
    getSqlSourceContext(context.state, context.pos),
  );
  if (source.empty) {
    return null;
  }

  let catalog: SchemaCatalog | undefined;
  if (options.currentDatabase) {
    try {
      catalog = await loadSchemaCatalog(options.currentDatabase);
    } catch (err) {
      console.error("Failed to load schema for autocomplete:", err);
    }
    if (context.aborted) {
      return null;
    }
  }

  const fallback = fallbackStatement(docText(context.state), context.pos);
  const statementText = source.statement
    ? context.state.doc.sliceString(source.statement.from, source.statement.to)
    : fallback.text;
  const cursorOffset = source.statement
    ? context.pos - source.statement.from
    : fallback.offset;
  const clause = clauseAtCursor(statementText, Math.max(0, cursorOffset));
  const line = context.state.doc.lineAt(context.pos);
  const atLineStart = !line.text
    .slice(0, Math.min(source.from, context.pos) - line.from)
    .trim();

  const catalogCtx = catalog
    ? {
        catalog,
        currentDatabase: options.currentDatabase,
        databases: options.databases ?? [],
      }
    : undefined;

  const schemaOptions = catalogCtx
    ? source.parents.length > 0
      ? await pathCompletions(catalogCtx, source, statementText, clause)
      : await topLevelCompletions(context, source, catalogCtx, clause)
    : [];

  const typeContext = sqlTypeContextAt(statementText, cursorOffset);
  const contextKeywordList = contextKeywords(statementText, cursorOffset, clause);
  if (typeContext === "type") {
    schemaOptions.unshift(
      ...userTypeCompletions(catalog, 12),
      ...dataTypeCompletions(12),
    );
  } else if (typeContext === "type-param") {
    schemaOptions.unshift(
      ...userTypeCompletions(catalog, 13),
      ...dataTypeCompletions(12),
      ...keywordListCompletions(["AS"], 14),
      ...keywordListCompletions(["READONLY"], 13),
      ...keywordListCompletions(["OUTPUT", "VARYING", "RETURNS", "WITH"], 11),
    );
  } else if (typeContext === "column-def-constraint") {
    schemaOptions.unshift(
      ...COLUMN_DEF_KEYWORDS.map((keyword) => ({
        label: keyword,
        type: "keyword" as const,
        boost: keyword === "NOT NULL" ? 14 : 13,
      })),
      ...dataTypeCompletions(5),
    );
  } else if (typeContext === "column-def") {
    schemaOptions.unshift(
      ...userTypeCompletions(catalog, 12),
      ...dataTypeCompletions(12),
      ...COLUMN_DEF_KEYWORDS.map((keyword) => ({
        label: keyword,
        type: "keyword" as const,
        // NOT NULL outranks NULL so "NOT N|" completes to NOT NULL, not NULL
        boost: keyword === "NOT NULL" ? 11 : 10,
      })),
    );
  } else if (typeContext === "hint") {
    schemaOptions.unshift(...keywordListCompletions(TABLE_HINT_KEYWORDS, 12));
  } else if (contextKeywordList) {
    schemaOptions.unshift(
      ...keywordListCompletions(
        contextKeywordList.keywords,
        contextKeywordList.boost,
      ),
    );
  } else if (source.parents.length === 0 && isExpressionClause(clause)) {
    schemaOptions.push(
      ...builtinFunctionCompletions(),
      ...builtinVariableCompletions(),
      ...localVariableCompletions(docText(context.state)),
    );
  }

  if (
    source.parents.length === 0 &&
    (clause === "other" || clause === "ddl-name") &&
    !typeContext
  ) {
    schemaOptions.push(
      ...localVariableCompletions(docText(context.state)),
    );
  }

  if (source.parents.length === 0) {
    schemaOptions.push(...snippetCompletions());
    schemaOptions.push(...keywordCompletions(clause, atLineStart));
  }

  const base = completionResult(context, source, schemaOptions);
  if (!base) {
    return null;
  }

  const query = context.state.sliceDoc(base.from, context.pos);
  const ranked = rankCompletions(base.options, query, clause, atLineStart);
  if (ranked.length === 0) {
    return null;
  }

  return {
    ...base,
    options: ranked,
    filter: false,
    update: refilterResult,
  };
}
