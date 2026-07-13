import {
  acceptCompletion,
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type Completion,
  completionKeymap,
  type CompletionResult,
  type CompletionSection,
  startCompletion,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { keywordCompletionSource, MSSQL, sql } from "@codemirror/lang-sql";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  syntaxTree,
  syntaxHighlighting,
} from "@codemirror/language";
import { linter } from "@codemirror/lint";
import {
  closeSearchPanel,
  getSearchQuery,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import {
  EditorState,
  Compartment,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import type { SyntaxNode } from "@lezer/common";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";
import {
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { loadEditorPreferences } from "../../lib/settings";
import { formatSqlWithPrefs } from "../../lib/sql-format";
import { sqlLinter } from "../../lib/sql-linter";
import type { ThemeSelection } from "../../lib/theme";
import type {
  DatabaseSchemaCatalogEntry,
  QueryTabUpdateOptions,
} from "../../lib/types";

const searchScrollbarPlugin = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;

    constructor(view: EditorView) {
      this.dom = document.createElement("div");
      this.dom.className = "cm-search-scrollbar-marks";
      this.dom.style.cssText =
        "position: absolute; right: 0; top: 0; bottom: 0; width: 6px; pointer-events: none; z-index: 100;";
      view.dom.appendChild(this.dom);
      this.updateMarks(view);
    }

    update(update: ViewUpdate) {
      const oldQuery = getSearchQuery(update.startState);
      const newQuery = getSearchQuery(update.state);

      if (
        update.docChanged ||
        update.viewportChanged ||
        update.geometryChanged ||
        !oldQuery.eq(newQuery)
      ) {
        this.updateMarks(update.view);
      }
    }

    updateMarks(view: EditorView) {
      const query = getSearchQuery(view.state);
      this.dom.innerHTML = "";

      const minimapGutter = view.dom.querySelector(
        ".cm-minimap-gutter",
      ) as HTMLElement | null;
      const scroller = view.scrollDOM;

      const scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
      const minimapWidth = minimapGutter ? minimapGutter.offsetWidth : 0;
      this.dom.style.right = `${minimapWidth + scrollbarWidth}px`;
      this.dom.style.display = minimapGutter ? "none" : "block";

      if (!query || !query.valid || !query.search) return;

      const cursor = query.getCursor(view.state.doc) as any;
      const scrollHeight = Math.max(view.scrollDOM.scrollHeight, 1);
      let count = 0;

      while (!cursor.next().done) {
        const pos = cursor.value.from;

        const block = view.lineBlockAt(pos);

        const top = (block.top / scrollHeight) * 100;

        const mark = document.createElement("div");
        mark.style.cssText = `position: absolute; top: ${top}%; height: 2px; width: 100%; background-color: var(--color-warning); opacity: 0.8;`;
        this.dom.appendChild(mark);

        count++;
        if (count > 1000) break;
      }
    }

    destroy() {
      this.dom.remove();
    }
  },
);

interface Props {
  value: string;
  onChange: (value: string, options?: QueryTabUpdateOptions) => void;
  onExecute: (selectedSql?: string) => void;
  onFormat?: () => void;
  readOnly?: boolean;
  theme: ThemeSelection;
  currentDatabase?: string;
  onContextMenu?: (e: MouseEvent) => void;
  onRef?: (handle: SqlEditorHandle) => void;
  onSearchPanelChange?: (open: boolean) => void;
  wrapLines?: boolean;
}

export interface SqlEditorHandle {
  focus: () => void;
  openCompletion: () => void;
  openSearch: () => void;
  getSelectedText: () => string;
  replaceSelection: (text: string) => void;
  formatSelection: () => boolean;
  selectAll: () => void;
  scrollToBottom: () => void;
}

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = "cm-foldMarker";
  marker.setAttribute("aria-hidden", "true");
  marker.dataset.state = open ? "open" : "closed";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 12 12");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", open ? "M3 4.5 6 7.5 9 4.5" : "M4.5 3 7.5 6 4.5 9");

  svg.appendChild(path);
  marker.appendChild(svg);

  return marker;
}

function historyOptionsForEditorUpdate(
  update: ViewUpdate,
): QueryTabUpdateOptions | undefined {
  const hasUserEvent = (event: string) =>
    update.transactions.some((transaction) => transaction.isUserEvent(event));

  if (hasUserEvent("input.paste")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Paste",
    };
  }

  if (hasUserEvent("delete.cut")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Cut",
    };
  }

  if (hasUserEvent("input.drop") || hasUserEvent("move.drop")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Drop",
    };
  }

  if (hasUserEvent("undo")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Undo",
    };
  }

  if (hasUserEvent("redo")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Redo",
    };
  }

  if (hasUserEvent("input.format")) {
    return {
      historyMode: "capture-current",
      historyType: "action",
      historyLabel: "Format",
    };
  }

  return undefined;
}

function formatSelectionInEditor(view: EditorView): boolean {
  const selection = view.state.selection.main;
  if (selection.from === selection.to) return false;

  const selectedSql = view.state.doc.sliceString(selection.from, selection.to);
  let formatted: string;
  try {
    formatted = formatSqlWithPrefs(selectedSql);
  } catch (err) {
    const _ignored = err;
    return true;
  }

  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: formatted },
    selection: {
      anchor: selection.from,
      head: selection.from + formatted.length,
    },
    scrollIntoView: true,
    annotations: Transaction.userEvent.of("input.format"),
  });
  return true;
}

interface SchemaTableEntry {
  name: string;
  schema: string;
  columns: string[];
}

interface SchemaCatalog {
  schemas: string[];
  tables: SchemaTableEntry[];
  tablesByName: Map<string, SchemaTableEntry[]>;
  tablesByQualifiedName: Map<string, SchemaTableEntry>;
  tablesBySchema: Map<string, SchemaTableEntry[]>;
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
  table: SchemaTableEntry;
  alias?: string;
}

const SCHEMA_SECTION: CompletionSection = { name: "Schemas", rank: 20 };
const TABLE_SECTION: CompletionSection = { name: "Tables", rank: 30 };
const COLUMN_SECTION: CompletionSection = { name: "Columns", rank: 10 };
const ALIAS_SECTION: CompletionSection = { name: "Aliases", rank: 15 };
const KEYWORD_SECTION: CompletionSection = { name: "Keywords", rank: 50 };
const SECTION_CAPS: Record<string, number> = {
  Aliases: 10,
  Columns: 50,
  Schemas: 5,
  Tables: 8,
  Keywords: 5,
};
const DEFAULT_SECTION_CAP = 8;
const IDENTIFIER_VALID_FOR = /^[\w@$#[\]"]*$/;
const QUOTED_IDENTIFIER_VALID_FOR = /^[\w\s@$#[\]"]*$/;
const SIMPLE_IDENTIFIER_RE = /^[A-Za-z_@#][A-Za-z0-9_@$#]*$/;
const FROM_END_KEYWORDS = new Set(
  "where group having order union intersect except all distinct limit offset fetch for option".split(
    " ",
  ),
);
const TABLE_ALIAS_STOP_WORDS = new Set(
  "as on where inner left right full cross outer join with nolock index force group order having union except intersect set values select when then using matched not by pivot unpivot option".split(
    " ",
  ),
);
const SCHEMA_CATALOG_TTL_MS = 5 * 60 * 1000;
const SCHEMA_CATALOG_MAX_ENTRIES = 24;

const schemaCatalogCache = new Map<
  string,
  { catalog: SchemaCatalog; expiresAt: number }
>();
const schemaCatalogLoaders = new Map<string, Promise<SchemaCatalog>>();
let schemaCatalogGeneration = 0;

function trimSchemaCatalogCache() {
  const now = Date.now();
  for (const [database, cached] of schemaCatalogCache) {
    if (cached.expiresAt <= now) {
      schemaCatalogCache.delete(database);
    }
  }

  while (schemaCatalogCache.size > SCHEMA_CATALOG_MAX_ENTRIES) {
    const oldestDatabase = schemaCatalogCache.keys().next().value as
      | string
      | undefined;
    if (!oldestDatabase) break;
    schemaCatalogCache.delete(oldestDatabase);
  }
}

function getCachedSchemaCatalog(database: string): SchemaCatalog | undefined {
  const cached = schemaCatalogCache.get(database);
  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    schemaCatalogCache.delete(database);
    return undefined;
  }

  schemaCatalogCache.delete(database);
  schemaCatalogCache.set(database, cached);
  return cached.catalog;
}

function setCachedSchemaCatalog(database: string, catalog: SchemaCatalog) {
  schemaCatalogCache.delete(database);
  schemaCatalogCache.set(database, {
    catalog,
    expiresAt: Date.now() + SCHEMA_CATALOG_TTL_MS,
  });
  trimSchemaCatalogCache();
}

export function invalidateSchemaCatalog(database?: string) {
  if (database) {
    schemaCatalogCache.delete(database);
  } else {
    schemaCatalogCache.clear();
  }
  schemaCatalogGeneration++;
}

function normalizeIdentifier(name: string): string {
  return unquoteIdentifier(name).toLowerCase();
}

function unquoteIdentifier(name: string): string {
  const trimmed = name.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).replace(/\]\]/g, "]");
  }
  if (
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("`") && trimmed.endsWith("`"))) &&
    trimmed.length >= 2
  ) {
    return trimmed.slice(1, -1).replace(/""/g, '"').replace(/``/g, "`");
  }
  return trimmed;
}

function bracketIdentifier(name: string): string {
  return `[${name.replace(/\]/g, "]]")}]`;
}

function identifierApply(name: string): string {
  return SIMPLE_IDENTIFIER_RE.test(name) ? name : bracketIdentifier(name);
}

function qualifiedTableKey(schema: string, table: string): string {
  return `${normalizeIdentifier(schema)}.${normalizeIdentifier(table)}`;
}

function buildSchemaCatalog(
  entries: DatabaseSchemaCatalogEntry[],
): SchemaCatalog {
  const schemaSet = new Map<string, string>();
  const tables: SchemaTableEntry[] = [];
  const tablesByName = new Map<string, SchemaTableEntry[]>();
  const tablesByQualifiedName = new Map<string, SchemaTableEntry>();
  const tablesBySchema = new Map<string, SchemaTableEntry[]>();

  for (const entry of entries) {
    if (!entry.table_name) continue;

    const table: SchemaTableEntry = {
      name: entry.table_name,
      schema: entry.schema_name,
      columns: Array.from(new Set(entry.columns.filter(Boolean))),
    };
    const schemaKey = normalizeIdentifier(table.schema);
    const tableKey = normalizeIdentifier(table.name);
    const qualifiedKey = qualifiedTableKey(table.schema, table.name);

    schemaSet.set(schemaKey, table.schema);
    tables.push(table);

    const sameName = tablesByName.get(tableKey);
    if (sameName) {
      sameName.push(table);
    } else {
      tablesByName.set(tableKey, [table]);
    }

    tablesByQualifiedName.set(qualifiedKey, table);

    const sameSchema = tablesBySchema.get(schemaKey);
    if (sameSchema) {
      sameSchema.push(table);
    } else {
      tablesBySchema.set(schemaKey, [table]);
    }
  }

  tables.sort(
    (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
  );
  for (const list of tablesByName.values()) {
    list.sort(
      (a, b) =>
        a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
    );
  }
  for (const list of tablesBySchema.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    schemas: Array.from(schemaSet.values()).sort((a, b) => a.localeCompare(b)),
    tables,
    tablesByName,
    tablesByQualifiedName,
    tablesBySchema,
  };
}

async function loadSchemaCatalog(database: string): Promise<SchemaCatalog> {
  const cached = getCachedSchemaCatalog(database);
  if (cached) {
    return cached;
  }

  const existingLoader = schemaCatalogLoaders.get(database);
  if (existingLoader) {
    return existingLoader;
  }

  const loader = invoke<DatabaseSchemaCatalogEntry[]>(
    "get_database_schema_catalog",
    {
      database,
    },
  )
    .then((entries) => {
      const catalog = buildSchemaCatalog(entries);
      setCachedSchemaCatalog(database, catalog);
      return catalog;
    })
    .finally(() => {
      schemaCatalogLoaders.delete(database);
    });

  schemaCatalogLoaders.set(database, loader);
  return loader;
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
  return (
    node.name === "String" ||
    node.name === "LineComment" ||
    node.name === "BlockComment"
  );
}

function makeIdentifierCompletion(
  label: string,
  type: string,
  detail: string | undefined,
  section: CompletionSection,
  boost = 0,
): Completion {
  const apply = identifierApply(label);
  return {
    label,
    type,
    detail,
    section,
    boost,
    ...(apply === label ? {} : { apply }),
  };
}

function makeSchemaCompletion(schema: string): Completion {
  return {
    label: schema,
    type: "namespace",
    detail: "schema",
    section: SCHEMA_SECTION,
    boost: 2,
    apply: `${identifierApply(schema)}.`,
  };
}

function makeTableCompletion(entry: SchemaTableEntry, boost = 0): Completion {
  return makeIdentifierCompletion(
    entry.name,
    "type",
    entry.schema,
    TABLE_SECTION,
    boost,
  );
}

function makeColumnCompletion(
  column: string,
  detail: string,
  boost = 0,
): Completion {
  return makeIdentifierCompletion(
    column,
    "property",
    detail,
    COLUMN_SECTION,
    boost,
  );
}

function makeAliasCompletion(
  alias: string,
  table: SchemaTableEntry,
): Completion {
  return {
    label: alias,
    type: "constant",
    detail: `${table.schema}.${table.name}`,
    section: ALIAS_SECTION,
    boost: 1,
    apply: `${identifierApply(alias)}.`,
  };
}

function maybeQuoteCompletions(
  openingQuote: string,
  options: Completion[],
): Completion[] {
  const closingQuote = openingQuote === "[" ? "]" : openingQuote;
  return options.map((completion) => ({
    ...completion,
    label: completion.label.startsWith(openingQuote)
      ? completion.label
      : `${openingQuote}${completion.label}${closingQuote}`,
    apply: undefined,
  }));
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
      validFor: QUOTED_IDENTIFIER_VALID_FOR,
    };
  }

  return {
    from: source.from,
    options,
    validFor: IDENTIFIER_VALID_FOR,
  };
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

function resolveTablePath(
  catalog: SchemaCatalog,
  path: string[],
  currentDatabase?: string,
): SchemaTableEntry | undefined {
  const parts = path.map(normalizeIdentifier).filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length >= 3) {
    const database = parts[parts.length - 3];
    const schema = parts[parts.length - 2];
    const table = parts[parts.length - 1];
    if (currentDatabase && database !== normalizeIdentifier(currentDatabase)) {
      return undefined;
    }
    return catalog.tablesByQualifiedName.get(`${schema}.${table}`);
  }

  if (parts.length === 2) {
    return catalog.tablesByQualifiedName.get(`${parts[0]}.${parts[1]}`);
  }

  const matches = catalog.tablesByName.get(parts[0]);
  if (!matches?.length) {
    return undefined;
  }

  return (
    matches.find((entry) => normalizeIdentifier(entry.schema) === "dbo") ??
    matches[0]
  );
}

function tablesForSchemaPath(
  catalog: SchemaCatalog,
  parents: string[],
  currentDatabase?: string,
): SchemaTableEntry[] {
  const parts = parents.map(normalizeIdentifier).filter(Boolean);

  if (parts.length === 1) {
    return catalog.tablesBySchema.get(parts[0]) ?? [];
  }

  if (
    parts.length === 2 &&
    currentDatabase &&
    parts[0] === normalizeIdentifier(currentDatabase)
  ) {
    return catalog.tablesBySchema.get(parts[1]) ?? [];
  }

  return [];
}

function schemasForDatabasePath(
  catalog: SchemaCatalog,
  parents: string[],
  currentDatabase?: string,
): string[] {
  const parts = parents.map(normalizeIdentifier).filter(Boolean);
  if (
    parts.length === 1 &&
    currentDatabase &&
    parts[0] === normalizeIdentifier(currentDatabase)
  ) {
    return catalog.schemas;
  }
  return [];
}

function columnsForTable(entry: SchemaTableEntry, boost = 0): Completion[] {
  const detail = `${entry.schema}.${entry.name}`;
  return entry.columns.map((column) =>
    makeColumnCompletion(column, detail, boost),
  );
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

function stripSqlCommentsAndStrings(sqlText: string): string {
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
      result += " ";
      while (++i < sqlText.length) {
        result += sqlText[i] === "\n" ? "\n" : " ";
        if (sqlText[i] === "'") {
          if (sqlText[i + 1] === "'") {
            result += " ";
            i++;
          } else {
            break;
          }
        }
      }
      continue;
    }

    result += char;
  }

  return result;
}

function parseStatementTableReferences(
  statementText: string,
): Array<{ path: string[]; alias?: string }> {
  const sanitized = stripSqlCommentsAndStrings(statementText);
  const identifier = String.raw`(?:\[[^\]]+(?:\]\][^\]]*)*\]|"[^"]+(?:""[^"]*)*"|[#@A-Za-z_][\w@$#]*)`;
  const tablePath = String.raw`${identifier}(?:\s*\.\s*${identifier}){0,2}`;
  const tableHints = String.raw`(?:\s+WITH\s*\([^)]*\))*`;
  const tableRefPattern = new RegExp(
    String.raw`\b(?:FROM|JOIN|UPDATE|INTO|MERGE)\s+(${tablePath})${tableHints}(?:\s+(?:AS\s+)?(${identifier}))?`,
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

function visibleTableRefs(
  context: CompletionContext,
  source: SqlSourceContext,
  catalog: SchemaCatalog,
  currentDatabase?: string,
): VisibleTableRef[] {
  const refs: VisibleTableRef[] = [];
  const seen = new Set<string>();
  const addRef = (table: SchemaTableEntry | undefined, alias?: string) => {
    if (!table) return;
    const key = `${qualifiedTableKey(table.schema, table.name)}:${alias ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ table, alias });
  };

  if (source.aliases) {
    for (const [alias, path] of Object.entries(source.aliases)) {
      addRef(resolveTablePath(catalog, path, currentDatabase), alias);
    }
  }

  if (source.statement) {
    const statementText = context.state.doc.sliceString(
      source.statement.from,
      source.statement.to,
    );
    for (const ref of parseStatementTableReferences(statementText)) {
      addRef(resolveTablePath(catalog, ref.path, currentDatabase), ref.alias);
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

function pathCompletions(
  catalog: SchemaCatalog,
  source: SqlSourceContext,
  currentDatabase?: string,
): Completion[] {
  const parents = source.parents.filter(Boolean);
  if (parents.length === 0) {
    return [];
  }

  const schemaOptions = schemasForDatabasePath(
    catalog,
    parents,
    currentDatabase,
  ).map(makeSchemaCompletion);
  if (schemaOptions.length > 0) {
    return schemaOptions;
  }

  if (parents.length === 1) {
    const aliasPath = aliasPathFor(source, parents[0]);
    const aliasTable = aliasPath
      ? resolveTablePath(catalog, aliasPath, currentDatabase)
      : undefined;
    if (aliasTable) {
      return columnsForTable(aliasTable, 3);
    }
  }

  const tableOptions = tablesForSchemaPath(
    catalog,
    parents,
    currentDatabase,
  ).map((entry) => makeTableCompletion(entry, 2));
  const table = resolveTablePath(catalog, parents, currentDatabase);
  const columnOptions = table ? columnsForTable(table, 3) : [];

  return dedupeCompletions([...columnOptions, ...tableOptions]);
}

function topLevelCompletions(
  context: CompletionContext,
  source: SqlSourceContext,
  catalog: SchemaCatalog,
  currentDatabase?: string,
): Completion[] {
  const visibleRefs = visibleTableRefs(
    context,
    source,
    catalog,
    currentDatabase,
  );
  const options: Completion[] = [];

  for (const ref of visibleRefs) {
    options.push(...columnsForTable(ref.table, 9));
    if (ref.alias) {
      options.push(makeAliasCompletion(ref.alias, ref.table));
    }
  }

  options.push(...catalog.schemas.map(makeSchemaCompletion));
  options.push(...catalog.tables.map((entry) => makeTableCompletion(entry)));

  return dedupeCompletions(options);
}

function getSectionName(section: Completion["section"]): string {
  if (!section) return "";
  return typeof section === "object" ? section.name : section;
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

function capPerSection(options: Completion[], query: string): Completion[] {
  const groups = new Map<
    string,
    Array<{ option: Completion; score: number }>
  >();

  for (const option of options) {
    const score = fuzzyMatchScore(option.label, query);
    if (query && score < 0) continue;
    const name = getSectionName(option.section);
    let arr = groups.get(name);
    if (!arr) {
      arr = [];
      groups.set(name, arr);
    }
    arr.push({ option, score: score + (option.boost ?? 0) * 50 });
  }

  const out: Completion[] = [];
  for (const [name, arr] of groups) {
    arr.sort((a, b) => b.score - a.score);
    const cap = SECTION_CAPS[name] ?? DEFAULT_SECTION_CAP;
    for (const { option } of arr.slice(0, cap)) {
      out.push(option);
    }
  }
  return out;
}

const sqlKeywordSource = keywordCompletionSource(MSSQL, true);
const EDITOR_LINE_GUTTER_CODE_GAP = 11;
const EDITOR_LINE_GUTTER_NUMBER_GAP = 4;
const EDITOR_CONTENT_LEFT_MARGIN = 0;
const EDITOR_LINE_START_PADDING = 0;
const EDITOR_LINE_END_PADDING = 8;
const EDITOR_MINIMAP_WIDTH = 70;
const MINIMAP_CODE_GAP = 10;
const MINIMAP_MIN_OVERLAY_HEIGHT = 14;
const MINIMAP_MAX_PIXEL_RATIO = 2;
const MINIMAP_SQL_KEYWORDS = new Set(
  [
    "ADD",
    "AND",
    "AS",
    "ASC",
    "BETWEEN",
    "BY",
    "CASE",
    "CAST",
    "COALESCE",
    "COUNT",
    "CREATE",
    "CROSS",
    "CURRENT_DATE",
    "DELETE",
    "DESC",
    "DISTINCT",
    "ELSE",
    "END",
    "EXISTS",
    "FROM",
    "FULL",
    "GROUP",
    "HAVING",
    "IN",
    "INNER",
    "INSERT",
    "INTERVAL",
    "INTO",
    "IS",
    "JOIN",
    "LEFT",
    "LIKE",
    "LIMIT",
    "NOT",
    "NULL",
    "ON",
    "OR",
    "ORDER",
    "OUTER",
    "OVER",
    "PARTITION",
    "RIGHT",
    "SELECT",
    "SET",
    "SUM",
    "THEN",
    "TRUE",
    "UNION",
    "UPDATE",
    "UPPER",
    "WHEN",
    "WHERE",
    "WITH",
  ].map((keyword) => keyword.toUpperCase()),
);

type FillMinimapColors = {
  comment: string;
  keyword: string;
  number: string;
  operator: string;
  property: string;
  search: string;
  string: string;
};

type FillMinimapMetrics = {
  clientHeight: number;
  height: number;
  maxScrollTop: number;
  overlayHeight: number;
  overlayTop: number;
  pixelRatio: number;
  scale: number;
  scrollHeight: number;
  width: number;
};

async function wrappedKeywordSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const result = await sqlKeywordSource(context);
  if (!result) return null;
  return {
    ...result,
    options: result.options.map((opt) => ({
      ...opt,
      section: opt.section ?? KEYWORD_SECTION,
    })),
  };
}

function buildFontTheme(family: string, size: number) {
  const resolvedFamily = family || "var(--font-mono)";
  return EditorView.theme({
    "&": { fontSize: `${size}px` },
    ".cm-scroller": { fontFamily: resolvedFamily },
    ".cm-content": { fontFamily: resolvedFamily },
    ".cm-gutters": { fontFamily: resolvedFamily },
  });
}

const editorGutterTheme = EditorView.theme({
  "&": {
    "--editor-line-gutter-code-gap": `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
    "--editor-line-gutter-number-gap": `${EDITOR_LINE_GUTTER_NUMBER_GAP}px`,
    "--editor-content-left-margin": `${EDITOR_CONTENT_LEFT_MARGIN}px`,
    "--editor-line-start-padding": `${EDITOR_LINE_START_PADDING}px`,
    "--editor-line-end-padding": `${EDITOR_LINE_END_PADDING}px`,
    "--editor-minimap-width": `${EDITOR_MINIMAP_WIDTH}px`,
    "--editor-minimap-code-gap": `${MINIMAP_CODE_GAP}px`,
    "--editor-active-line-bg":
      "color-mix(in srgb, var(--color-surface-panel) 95%, var(--color-text))",
  },
  ".cm-scroller > .cm-gutters-before": {
    backgroundColor: "var(--color-surface-panel)",
    borderRight: "0",
    boxShadow: "none",
    left: "0",
    overflow: "visible",
    paddingRight: `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
    position: "sticky",
    zIndex: "300",
  },
  ".cm-scroller > .cm-gutters-before::after": {
    backgroundColor: "var(--color-surface-panel)",
    bottom: "0",
    content: '""',
    pointerEvents: "none",
    position: "absolute",
    right: "0",
    top: "0",
    width: `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
    zIndex: "1",
  },
  ".cm-scroller > .cm-gutters-before .cm-gutter": {
    backgroundColor: "var(--color-surface-panel)",
    overflow: "visible",
    position: "relative",
    zIndex: "2",
  },
  ".cm-scroller > .cm-gutters-before .cm-gutterElement": {
    backgroundColor: "var(--color-surface-panel)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "3ch",
    padding: `0 ${EDITOR_LINE_GUTTER_NUMBER_GAP}px 0 4px`,
    textAlign: "right",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line-bg)",
  },
  ".cm-scroller > .cm-gutters-before .cm-activeLineGutter": {
    backgroundColor: "var(--editor-active-line-bg)",
    boxShadow: "none",
    position: "relative",
    zIndex: "3",
  },
  ".cm-scroller > .cm-gutters-before .cm-activeLineGutter::after": {
    backgroundColor: "var(--editor-active-line-bg)",
    bottom: "0",
    content: '""',
    left: "100%",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    width: `${EDITOR_LINE_GUTTER_CODE_GAP}px`,
  },
  ".cm-scroller > .cm-gutters-before + .cm-content": {
    paddingLeft: `${EDITOR_CONTENT_LEFT_MARGIN}px`,
  },
  ".cm-line": {
    padding: `0 ${EDITOR_LINE_END_PADDING}px 0 ${EDITOR_LINE_START_PADDING}px`,
  },
  "&.cm-minimap-enabled .cm-line": {
    paddingRight: `${
      EDITOR_MINIMAP_WIDTH + MINIMAP_CODE_GAP + EDITOR_LINE_END_PADDING
    }px`,
  },
});

const editorSafeAreaScrollMargins = EditorView.scrollMargins.of((view) => {
  const beforeGutter = view.dom.querySelector(
    ".cm-gutters-before",
  ) as HTMLElement | null;
  const minimapGutter = view.dom.querySelector(
    ".cm-minimap-gutter",
  ) as HTMLElement | null;

  return {
    left:
      (beforeGutter?.offsetWidth ?? 0) +
      EDITOR_LINE_GUTTER_CODE_GAP +
      EDITOR_CONTENT_LEFT_MARGIN +
      EDITOR_LINE_START_PADDING,
    right: minimapGutter
      ? minimapGutter.offsetWidth + MINIMAP_CODE_GAP + EDITOR_LINE_END_PADDING
      : EDITOR_LINE_END_PADDING,
  };
});

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const fillMinimapPlugin = ViewPlugin.fromClass(
  class {
    private canvas: HTMLCanvasElement;
    private dom: HTMLElement;
    private dragOffsetY: number | null = null;
    private frame: number | null = null;
    private inner: HTMLElement;
    private overlay: HTMLElement;
    private overlayContainer: HTMLElement;
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.dom = document.createElement("div");
      this.dom.className = "cm-gutters cm-minimap-container cm-minimap-gutter";
      this.dom.style.width = `${EDITOR_MINIMAP_WIDTH}px`;

      this.inner = document.createElement("div");
      this.inner.className = "cm-minimap-inner";

      this.canvas = document.createElement("canvas");

      this.overlayContainer = document.createElement("div");
      this.overlayContainer.className =
        "cm-minimap-overlay-container cm-minimap-overlay-mouse-over";
      this.overlay = document.createElement("div");
      this.overlay.className = "cm-minimap-overlay";

      this.overlayContainer.appendChild(this.overlay);
      this.inner.appendChild(this.canvas);
      this.inner.appendChild(this.overlayContainer);
      this.dom.appendChild(this.inner);
      view.scrollDOM.insertBefore(this.dom, view.contentDOM.nextSibling);

      this.overlayContainer.addEventListener("mousedown", this.onMouseDown);
      window.addEventListener("mousemove", this.onMouseMove);
      window.addEventListener("mouseup", this.onMouseUp);
      this.schedule(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.geometryChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        !getSearchQuery(update.startState).eq(getSearchQuery(update.state)) ||
        searchPanelOpen(update.startState) !== searchPanelOpen(update.state)
      ) {
        this.schedule(update.view);
      }
    }

    destroy() {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
      }
      this.overlayContainer.removeEventListener("mousedown", this.onMouseDown);
      window.removeEventListener("mousemove", this.onMouseMove);
      window.removeEventListener("mouseup", this.onMouseUp);
      this.dom.remove();
    }

    schedule(view: EditorView) {
      if (this.frame !== null) {
        cancelAnimationFrame(this.frame);
      }

      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.apply(view);
      });
    }

    private apply(view: EditorView) {
      this.view = view;
      const metrics = this.measure();
      const context = this.prepareCanvas(metrics);
      if (!context) return;

      this.drawDocument(context, metrics);
      this.drawSearchMatches(context, metrics);
      this.updateOverlay(metrics);
    }

    private measure(): FillMinimapMetrics {
      const width = Math.max(
        1,
        Math.floor(this.dom.getBoundingClientRect().width || EDITOR_MINIMAP_WIDTH),
      );
      const height = Math.max(
        1,
        Math.floor(
          this.view.scrollDOM.clientHeight ||
            this.view.dom.getBoundingClientRect().height,
        ),
      );
      const clientHeight = Math.max(1, this.view.scrollDOM.clientHeight);
      const scrollHeight = Math.max(clientHeight, this.view.scrollDOM.scrollHeight);
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MINIMAP_MAX_PIXEL_RATIO,
      );
      const rawOverlayHeight = (clientHeight / scrollHeight) * height;
      const overlayHeight =
        maxScrollTop > 0
          ? clamp(rawOverlayHeight, MINIMAP_MIN_OVERLAY_HEIGHT, height)
          : height;
      const maxOverlayTop = Math.max(0, height - overlayHeight);
      const overlayTop =
        maxScrollTop > 0
          ? clamp(
              (this.view.scrollDOM.scrollTop / maxScrollTop) * maxOverlayTop,
              0,
              maxOverlayTop,
            )
          : 0;

      return {
        clientHeight,
        height,
        maxScrollTop,
        overlayHeight,
        overlayTop,
        pixelRatio,
        scale: height / scrollHeight,
        scrollHeight,
        width,
      };
    }

    private prepareCanvas(metrics: FillMinimapMetrics) {
      const pixelWidth = Math.ceil(metrics.width * metrics.pixelRatio);
      const pixelHeight = Math.ceil(metrics.height * metrics.pixelRatio);
      if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
      if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
      this.canvas.style.width = `${metrics.width}px`;
      this.canvas.style.height = `${metrics.height}px`;

      const context = this.canvas.getContext("2d");
      if (!context) return null;

      context.setTransform(
        metrics.pixelRatio,
        0,
        0,
        metrics.pixelRatio,
        0,
        0,
      );
      context.clearRect(0, 0, metrics.width, metrics.height);
      return context;
    }

    private drawDocument(
      context: CanvasRenderingContext2D,
      metrics: FillMinimapMetrics,
    ) {
      const colors = this.getColors();
      const doc = this.view.state.doc;
      const charWidth = clamp(metrics.width / 46, 1.15, 1.75);

      for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
        const line = doc.line(lineNumber);
        const lineBlock = this.view.lineBlockAt(line.from);
        const y = lineBlock.top * metrics.scale;
        const lineHeight = Math.max(0.75, lineBlock.height * metrics.scale);
        if (y > metrics.height) break;
        if (y + lineHeight < 0) continue;

        this.drawSqlLine(
          context,
          line.text,
          2,
          y,
          lineHeight,
          charWidth,
          metrics.width - 4,
          colors,
        );
      }
    }

    private drawSearchMatches(
      context: CanvasRenderingContext2D,
      metrics: FillMinimapMetrics,
    ) {
      // The stored query survives closing the search panel (closeSearchPanel
      // only hides the panel, it does not clear the query), so we must also
      // bail out when the panel is closed to avoid drawing stale matches.
      if (!searchPanelOpen(this.view.state)) return;
      const query = getSearchQuery(this.view.state);
      if (!query || !query.valid || !query.search) return;

      const colors = this.getColors();
      const cursor = query.getCursor(this.view.state.doc) as any;
      let count = 0;

      while (!cursor.next().done) {
        const from = cursor.value.from as number;
        const to = cursor.value.to as number;
        const block = this.view.lineBlockAt(from);
        const y = clamp(
          block.top * metrics.scale,
          0,
          Math.max(0, metrics.height - 2),
        );
        const height = clamp(block.height * metrics.scale, 2, 5);
        const isSelected = this.view.state.selection.ranges.some(
          (range) => range.from === from && range.to === to,
        );

        context.globalAlpha = isSelected ? 0.96 : 0.74;
        context.fillStyle = colors.search;
        context.fillRect(0, y, metrics.width, height);
        context.globalAlpha = isSelected ? 1 : 0.9;
        context.fillRect(
          Math.max(0, metrics.width - 4),
          y,
          4,
          Math.max(height, 3),
        );

        count++;
        if (count > 1000) break;
      }

      context.globalAlpha = 1;
    }

    private drawSqlLine(
      context: CanvasRenderingContext2D,
      text: string,
      x: number,
      y: number,
      lineHeight: number,
      charWidth: number,
      maxWidth: number,
      colors: FillMinimapColors,
    ) {
      if (!text) return;

      const tokens =
        text.match(
          /--.*|'(?:''|[^'])*'|\[[^\]]+\]|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][\w$#]*\b|\s+|./g,
        ) ?? [];
      const blockHeight = clamp(lineHeight * 0.48, 1, 3.2);
      const blockY = y + Math.max(0, (lineHeight - blockHeight) / 2);
      const gap = clamp(charWidth * 0.72, 0.65, 1.35);

      for (const token of tokens) {
        if (x > maxWidth) break;

        if (/^\s+$/.test(token)) {
          x += token.replace(/\t/g, "    ").length * charWidth * 0.82;
          continue;
        }

        const tokenWidth = this.widthForToken(token, charWidth);
        const visibleWidth = Math.min(
          Math.max(1, tokenWidth),
          Math.max(1, maxWidth - x),
        );
        context.fillStyle = this.colorForToken(token, colors);
        context.globalAlpha = this.alphaForToken(token);
        context.fillRect(x, blockY, visibleWidth, blockHeight);

        x += tokenWidth + gap;
      }

      context.globalAlpha = 1;
    }

    private widthForToken(token: string, charWidth: number) {
      const visualColumns =
        token.length > 14 ? 14 + Math.sqrt(token.length - 14) * 2 : token.length;
      const width = visualColumns * charWidth;

      if (/^[()[\],.;:+*/<>=-]+$/.test(token)) {
        return Math.max(1, width * 0.55);
      }

      return Math.max(2.2, width);
    }

    private alphaForToken(token: string) {
      if (/^[()[\],.;:+*/<>=-]+$/.test(token)) return 0.48;
      if (token.startsWith("--")) return 0.46;
      return 0.78;
    }

    private colorForToken(token: string, colors: FillMinimapColors) {
      const upperToken = token.toUpperCase();
      if (token.startsWith("--")) return colors.comment;
      if (token.startsWith("'")) return colors.string;
      if (/^\d/.test(token)) return colors.number;
      if (MINIMAP_SQL_KEYWORDS.has(upperToken)) return colors.keyword;
      if (/^[()[\],.;:+*/<>=-]+$/.test(token)) return colors.operator;
      return colors.property;
    }

    private getColors(): FillMinimapColors {
      const style = window.getComputedStyle(this.view.dom);
      const read = (name: string, fallback: string) =>
        style.getPropertyValue(name).trim() || fallback;

      return {
        comment: read("--color-text-muted", "rgba(160, 160, 170, 0.8)"),
        keyword: read("--color-cm-keyword", "#ff71ce"),
        number: read("--color-warning", "#ffd166"),
        operator: read("--color-text-muted", "rgba(160, 160, 170, 0.8)"),
        property: read("--color-cm-property", "#ff6f91"),
        search: read("--color-warning", "#ffd166"),
        string: read("--color-cm-type", "#9be564"),
      };
    }

    private updateOverlay(metrics: FillMinimapMetrics) {
      this.overlay.style.height = `${metrics.overlayHeight}px`;
      this.overlay.style.top = `${metrics.overlayTop}px`;

      if (metrics.maxScrollTop <= 0) {
        this.overlayContainer.classList.add("cm-minimap-overlay-off");
      } else {
        this.overlayContainer.classList.remove("cm-minimap-overlay-off");
      }
    }

    private scrollFromClientY(clientY: number, dragOffsetY: number) {
      const metrics = this.measure();
      if (metrics.maxScrollTop <= 0) return;

      const rect = this.inner.getBoundingClientRect();
      const maxMapTop = Math.max(1, metrics.height - metrics.overlayHeight);
      const mapTop = clamp(clientY - rect.top - dragOffsetY, 0, maxMapTop);
      this.view.scrollDOM.scrollTop =
        (mapTop / maxMapTop) * metrics.maxScrollTop;
      this.updateOverlay(this.measure());
    }

    private onMouseDown = (event: MouseEvent) => {
      if (event.button === 2) return;
      event.preventDefault();

      const metrics = this.measure();
      if (metrics.maxScrollTop <= 0) return;

      if (event.target === this.overlay) {
        const overlayRect = this.overlay.getBoundingClientRect();
        this.dragOffsetY = event.clientY - overlayRect.top;
      } else {
        this.dragOffsetY = metrics.overlayHeight / 2;
      }

      this.overlayContainer.classList.add("cm-minimap-overlay-active");
      this.scrollFromClientY(event.clientY, this.dragOffsetY);
    };

    private onMouseMove = (event: MouseEvent) => {
      if (this.dragOffsetY === null) return;
      event.preventDefault();
      this.scrollFromClientY(event.clientY, this.dragOffsetY);
    };

    private onMouseUp = () => {
      this.dragOffsetY = null;
      this.overlayContainer.classList.remove("cm-minimap-overlay-active");
    };
  },
  {
    eventHandlers: {
      scroll() {
        this.schedule(this.view);
      },
    },
  },
);

function buildMinimapExt() {
  return [
    EditorView.editorAttributes.of({ class: "cm-minimap-enabled" }),
    fillMinimapPlugin,
  ];
}

function buildAutocompletionExt(
  source: (context: CompletionContext) => Promise<CompletionResult | null>,
) {
  return autocompletion({
    defaultKeymap: true,
    closeOnBlur: false,
    maxRenderedOptions: 80,
    override: [source],
    activateOnCompletion: (completion) =>
      completion.type === "namespace" || completion.type === "constant",
  });
}

function buildThemeExtension(theme: ThemeSelection): Extension {
  return theme.mode === "light" ? [] : oneDark;
}

function buildReadOnlyExtension(readOnly: boolean): Extension {
  return readOnly
    ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
    : [linter(sqlLinter, { delay: 500 })];
}

function buildPlaceholderText(
  readOnly: boolean,
  currentDatabase: string | undefined,
): string {
  return readOnly && !currentDatabase
    ? "Select a database to enable the SQL editor."
    : `-- Write your SQL query here…`;
}

export default function SqlEditor(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let viewRef: EditorView | null = null;
  let schemaRef: {
    database?: string;
    catalog?: SchemaCatalog;
    generation: number;
  } = {
    generation: schemaCatalogGeneration,
  };
  const wrapCompartment = new Compartment();
  const lineNumbersCompartment = new Compartment();
  const minimapCompartment = new Compartment();
  const autocompleteCompartment = new Compartment();
  const fontThemeCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const placeholderCompartment = new Compartment();
  let lastSearchString = "";
  let lastCount = -1;

  const searchHistory: string[] = [];
  let historyIndex = -1;

  const handle: SqlEditorHandle = {
    focus() {
      viewRef?.focus();
    },
    openCompletion() {
      if (!viewRef) return;
      viewRef.focus();
      startCompletion(viewRef);
    },
    openSearch() {
      if (!viewRef) return;
      const panel = viewRef.dom.querySelector(".cm-panel.cm-search");
      if (panel) {
        closeSearchPanel(viewRef);
      } else {
        viewRef.focus();
        openSearchPanel(viewRef);
      }
    },
    getSelectedText() {
      if (!viewRef) return "";
      const selection = viewRef.state.selection.main;
      if (selection.from === selection.to) return "";
      return viewRef.state.doc.sliceString(selection.from, selection.to);
    },
    replaceSelection(text: string) {
      if (!viewRef) return;
      viewRef.focus();
      viewRef.dispatch(viewRef.state.replaceSelection(text));
    },
    formatSelection() {
      if (!viewRef) return false;
      viewRef.focus();
      return formatSelectionInEditor(viewRef);
    },
    selectAll() {
      if (!viewRef) return;
      viewRef.focus();
      viewRef.dispatch({
        selection: { anchor: 0, head: viewRef.state.doc.length },
        scrollIntoView: true,
      });
    },
    scrollToBottom() {
      if (!viewRef) return;
      const end = viewRef.state.doc.length;
      viewRef.dispatch({
        selection: { anchor: end },
        scrollIntoView: true,
      });
    },
  };

  onMount(() => {
    props.onRef?.(handle);
  });

  const schemaCompletionSource = async (context: CompletionContext) => {
    const database = props.currentDatabase;
    if (!database || isCompletionBlocked(context)) {
      return null;
    }

    const source = getSqlSourceContext(context.state, context.pos);
    if (source.empty && !context.explicit) {
      return null;
    }

    let catalog =
      schemaRef.database === database &&
      schemaRef.generation === schemaCatalogGeneration
        ? schemaRef.catalog
        : undefined;
    if (!catalog) {
      try {
        catalog = await loadSchemaCatalog(database);
      } catch (err) {
        console.error("Failed to load schema for autocomplete:", err);
        return null;
      }

      if (context.aborted || props.currentDatabase !== database) {
        return null;
      }

      schemaRef = { database, catalog, generation: schemaCatalogGeneration };
    }

    if (catalog.tables.length === 0) {
      return null;
    }

    const options =
      source.parents.length > 0
        ? pathCompletions(catalog, source, database)
        : topLevelCompletions(context, source, catalog, database);
    return completionResult(context, source, options);
  };

  const combinedCompletionSource = async (
    context: CompletionContext,
  ): Promise<CompletionResult | null> => {
    const [schemaResult, keywordResult] = await Promise.all([
      schemaCompletionSource(context),
      wrappedKeywordSource(context),
    ]);

    if (!schemaResult && !keywordResult) {
      return null;
    }

    const from = Math.min(
      schemaResult?.from ?? Number.POSITIVE_INFINITY,
      keywordResult?.from ?? Number.POSITIVE_INFINITY,
    );
    const queryText = unquoteIdentifier(
      context.state.sliceDoc(from, context.pos),
    );
    const merged = [
      ...(schemaResult?.options ?? []),
      ...(keywordResult?.options ?? []),
    ];
    const capped = capPerSection(merged, queryText);

    if (capped.length === 0) {
      return null;
    }

    return {
      from,
      options: capped,
      filter: false,
    };
  };

  createEffect(() => {
    if (!containerRef) return;

    const initialTheme = untrack(() => props.theme);
    const initialCurrentDatabase = untrack(() => props.currentDatabase);
    const initialReadOnly = untrack(() => Boolean(props.readOnly));
    const initialWrapLines = untrack(() => Boolean(props.wrapLines));

    const runExecute = (view: EditorView) => {
      const selection = view.state.selection.main;
      const selectedSql =
        selection.from !== selection.to
          ? view.state.doc.sliceString(selection.from, selection.to)
          : undefined;
      props.onExecute(selectedSql);
      return true;
    };

    const executeKeymap = keymap.of([
      { key: "F5", run: runExecute },
      { key: "Mod-Enter", run: runExecute },
    ]);
    const formatKeymap = keymap.of([
      {
        key: "Alt-Shift-f",
        run: (view) => {
          if (formatSelectionInEditor(view)) return true;
          if (props.onFormat) {
            props.onFormat();
            return true;
          }
          return false;
        },
      },
    ]);
    const lineMovementKeymap = keymap.of([
      { key: "Alt-ArrowUp", run: moveLineUp },
      { key: "Alt-ArrowDown", run: moveLineDown },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        props.onChange(
          update.state.doc.toString(),
          historyOptionsForEditorUpdate(update),
        );
      }

      if (viewRef && searchPanelOpen(update.state) && containerRef) {
        const panel = containerRef.querySelector(".cm-panel.cm-search");
        if (panel) {
          let countSpan = panel.querySelector(
            ".cm-search-match-count",
          ) as HTMLSpanElement | null;
          let countSpanCreated = false;
          if (!countSpan) {
            countSpan = document.createElement("span");
            countSpan.className =
              "cm-search-match-count text-xs opacity-60 pointer-events-none select-none inline-flex items-center whitespace-nowrap justify-center";
            countSpan.style.order = "0";
            countSpan.style.marginLeft = "8px";
            countSpan.style.marginRight = "8px";

            const nextBtn = panel.querySelector("button[name='next']");
            if (nextBtn && nextBtn.parentElement) {
              nextBtn.parentElement.insertBefore(countSpan, nextBtn);
            } else {
              panel.appendChild(countSpan);
            }
            countSpanCreated = true;
          }

          const query = getSearchQuery(update.state);
          const currentSearchString =
            query?.valid && query?.search
              ? `${query.search}|${query.caseSensitive}|${query.regexp}|${query.wholeWord}`
              : "";
          const queryChanged = currentSearchString !== lastSearchString;
          // Walk the document only when the query changed or the document
          // actually changed. Pure cursor moves, viewport changes, and focus
          // updates would otherwise cause an O(N) re-walk every keystroke.
          const needsWalk =
            queryChanged || update.docChanged || countSpanCreated;

          if (needsWalk) {
            lastSearchString = currentSearchString;

            if (!currentSearchString) {
              lastCount = -1;
            } else {
              let count = 0;
              const cursor = query.getCursor(update.state.doc) as any;
              while (!cursor.next().done) {
                count++;
                if (count >= 1000) break;
              }
              lastCount = count;
            }
          }

          if (lastCount === -1 || lastCount === 0) {
            countSpan.textContent = "No results";
          } else if (lastCount >= 1000) {
            countSpan.textContent = "1000+ results";
          } else {
            countSpan.textContent = `${lastCount} result${lastCount === 1 ? "" : "s"}`;
          }

          const hasResults = lastCount > 0;
          const replaceBtn = panel.querySelector(
            'button[name="replace"]',
          ) as HTMLButtonElement | null;
          const replaceAllBtn = panel.querySelector(
            'button[name="replaceAll"]',
          ) as HTMLButtonElement | null;
          const nextBtn = panel.querySelector(
            'button[name="next"]',
          ) as HTMLButtonElement | null;
          const prevBtn = panel.querySelector(
            'button[name="prev"]',
          ) as HTMLButtonElement | null;

          if (replaceBtn) replaceBtn.disabled = !hasResults;
          if (replaceAllBtn) replaceAllBtn.disabled = !hasResults;
          if (nextBtn) nextBtn.disabled = !hasResults;
          if (prevBtn) prevBtn.disabled = !hasResults;
        }
      }
    });

    const initialPrefs = loadEditorPreferences();

    const pasteHandler = EditorView.domEventHandlers({
      paste(event, view) {
        if (!loadEditorPreferences().formatOnPaste) return false;
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;
        try {
          const formatted = formatSqlWithPrefs(text);
          event.preventDefault();
          view.dispatch({
            ...view.state.replaceSelection(formatted),
            annotations: Transaction.userEvent.of("input.paste"),
          });
          return true;
        } catch {
          return false;
        }
      },
    });

    const state = EditorState.create({
      doc: untrack(() => props.value),
      extensions: [
        searchScrollbarPlugin,
        lineNumbersCompartment.of(initialPrefs.lineNumbers ? lineNumbers() : []),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        history(),
        foldGutter({
          markerDOM: (open) => createFoldMarker(open),
        }),
        bracketMatching(),
        closeBrackets(),
        autocompleteCompartment.of(
          initialPrefs.autocomplete
            ? buildAutocompletionExt(combinedCompletionSource)
            : [],
        ),
        sql({ dialect: MSSQL, upperCaseKeywords: true }),
        search(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        themeCompartment.of(buildThemeExtension(initialTheme)),
        editorGutterTheme,
        editorSafeAreaScrollMargins,
        fontThemeCompartment.of(
          buildFontTheme(initialPrefs.fontFamily, initialPrefs.fontSize),
        ),
        executeKeymap,
        formatKeymap,
        lineMovementKeymap,
        keymap.of([
          { key: "Tab", run: acceptCompletion },
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          ...foldKeymap,
          ...searchKeymap,
        ]),
        updateListener,
        pasteHandler,
        placeholderCompartment.of(
          placeholderExt(
            buildPlaceholderText(
              initialReadOnly,
              initialCurrentDatabase,
            ),
          ),
        ),
        wrapCompartment.of(initialWrapLines ? EditorView.lineWrapping : []),
        minimapCompartment.of(
          initialPrefs.minimap ? buildMinimapExt() : [],
        ),
        readOnlyCompartment.of(buildReadOnlyExtension(initialReadOnly)),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef,
    });

    viewRef = view;

    const enhanceSearchPanel = (panel: HTMLElement) => {
      if (panel.dataset.enhanced === "true") return;
      panel.dataset.enhanced = "true";
      panel.setAttribute("data-replace-open", "false");

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cm-search-toggle-replace";
      toggle.setAttribute("aria-label", "Toggle replace");
      toggle.setAttribute("title", "Toggle replace");
      toggle.innerHTML =
        '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M4.5 3 7.5 6 4.5 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        const isOpen = panel.getAttribute("data-replace-open") === "true";
        panel.setAttribute("data-replace-open", isOpen ? "false" : "true");
      });

      panel.insertBefore(toggle, panel.firstChild);

      const allButton = panel.querySelector('button[name="select"]');
      if (allButton) {
        allButton.remove();
      }

      const searchInput = panel.querySelector(
        'input[name="search"]',
      ) as HTMLInputElement;
      if (searchInput && searchInput.parentElement) {
        const wasFocused = document.activeElement === searchInput;

        const wrapper = document.createElement("div");
        wrapper.className = "cm-search-input-wrapper";
        searchInput.parentElement.insertBefore(wrapper, searchInput);
        wrapper.appendChild(searchInput);

        if (wasFocused || document.activeElement === document.body) {
          searchInput.focus();
        }

        searchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const val = searchInput.value;
            if (val && searchHistory[0] !== val) {
              searchHistory.unshift(val);
              if (searchHistory.length > 50) searchHistory.pop();
            }
            historyIndex = -1;
          } else if (e.key === "ArrowUp") {
            if (
              searchHistory.length > 0 &&
              historyIndex < searchHistory.length - 1
            ) {
              if (
                historyIndex === -1 &&
                searchInput.value &&
                searchHistory[0] !== searchInput.value
              ) {
                searchHistory.unshift(searchInput.value);
                historyIndex = 0;
              }
              historyIndex++;
              searchInput.value = searchHistory[historyIndex];
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              e.preventDefault();
            }
          } else if (e.key === "ArrowDown") {
            if (historyIndex > 0) {
              historyIndex--;
              searchInput.value = searchHistory[historyIndex];
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              e.preventDefault();
            } else if (historyIndex === 0) {
              historyIndex = -1;
              searchInput.value = "";
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              e.preventDefault();
            }
          }
        });

        const labels = panel.querySelectorAll("label");
        labels.forEach((label) => {
          const input = label.querySelector(
            'input[type="checkbox"]',
          ) as HTMLInputElement;
          if (!input) return;

          Array.from(label.childNodes).forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) node.remove();
          });

          label.classList.add("cm-search-option");

          const iconSpan = document.createElement("span");
          if (input.name === "case") {
            label.setAttribute("title", "Match Case");
            iconSpan.textContent = "Aa";
          } else if (input.name === "word") {
            label.setAttribute("title", "Match Whole Word");
            iconSpan.innerHTML = "<span class='underline'>ab</span>";
          } else if (input.name === "re") {
            label.setAttribute("title", "Use Regular Expression");
            iconSpan.textContent = ".*";
          }
          label.appendChild(iconSpan);

          wrapper.appendChild(label);
        });
      }
    };

    const panelObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (
            node.classList.contains("cm-panel") &&
            node.classList.contains("cm-search")
          ) {
            enhanceSearchPanel(node);
            props.onSearchPanelChange?.(true);
          } else {
            const nested = node.querySelector?.(".cm-panel.cm-search");
            if (nested instanceof HTMLElement) {
              enhanceSearchPanel(nested);
              props.onSearchPanelChange?.(true);
            }
          }
        });
        mutation.removedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (
            (node.classList.contains("cm-panel") &&
              node.classList.contains("cm-search")) ||
            node.querySelector?.(".cm-panel.cm-search")
          ) {
            props.onSearchPanelChange?.(false);
          }
        });
      }
    });
    panelObserver.observe(containerRef, { childList: true, subtree: true });

    onCleanup(() => {
      panelObserver.disconnect();
      view.destroy();
      viewRef = null;
    });
  });

  createEffect(() => {
    const value = props.value;
    if (viewRef && viewRef.state.doc.toString() !== value) {
      viewRef.dispatch({
        changes: {
          from: 0,
          to: viewRef.state.doc.length,
          insert: value,
        },
      });
    }
  });

  createEffect(() => {
    if (viewRef) {
      viewRef.dispatch({
        effects: wrapCompartment.reconfigure(
          props.wrapLines ? EditorView.lineWrapping : [],
        ),
      });
    }
  });

  createEffect(() => {
    const theme = props.theme;
    if (!viewRef) return;
    viewRef.dispatch({
      effects: themeCompartment.reconfigure(buildThemeExtension(theme)),
    });
  });

  createEffect(() => {
    const readOnly = Boolean(props.readOnly);
    const currentDatabase = props.currentDatabase;
    if (!viewRef) return;
    viewRef.dispatch({
      effects: [
        readOnlyCompartment.reconfigure(buildReadOnlyExtension(readOnly)),
        placeholderCompartment.reconfigure(
          placeholderExt(
            buildPlaceholderText(
              readOnly,
              currentDatabase,
            ),
          ),
        ),
      ],
    });
  });

  const editorPrefs = createMemo(() => loadEditorPreferences());
  const prefLineNumbers = createMemo(() => editorPrefs().lineNumbers);
  const prefMinimap = createMemo(() => editorPrefs().minimap);
  const prefAutocomplete = createMemo(() => editorPrefs().autocomplete);
  const prefFontFamily = createMemo(() => editorPrefs().fontFamily);
  const prefFontSize = createMemo(() => editorPrefs().fontSize);

  createEffect(() => {
    const enabled = prefLineNumbers();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: lineNumbersCompartment.reconfigure(enabled ? lineNumbers() : []),
    });
  });

  createEffect(() => {
    const enabled = prefMinimap();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: minimapCompartment.reconfigure(
        enabled ? buildMinimapExt() : [],
      ),
    });
  });

  createEffect(() => {
    const enabled = prefAutocomplete();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: autocompleteCompartment.reconfigure(
        enabled ? buildAutocompletionExt(combinedCompletionSource) : [],
      ),
    });
  });

  createEffect(() => {
    const family = prefFontFamily();
    const size = prefFontSize();
    if (!viewRef) return;
    viewRef.dispatch({
      effects: fontThemeCompartment.reconfigure(buildFontTheme(family, size)),
    });
  });

  createEffect(() => {
    const currentDatabase = props.currentDatabase;
    if (!currentDatabase) return;
    const cached = getCachedSchemaCatalog(currentDatabase);
    if (cached) {
      schemaRef = {
        database: currentDatabase,
        catalog: cached,
        generation: schemaCatalogGeneration,
      };
      return;
    }

    schemaRef = {
      database: currentDatabase,
      generation: schemaCatalogGeneration,
    };

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSchemaCatalog(currentDatabase)
        .then((catalog) => {
          if (cancelled || props.currentDatabase !== currentDatabase) {
            return;
          }

          schemaRef = {
            database: currentDatabase,
            catalog,
            generation: schemaCatalogGeneration,
          };
        })
        .catch((err) => {
          if (!cancelled) {
            console.error("Failed to preload schema for autocomplete:", err);
          }
        });
    }, 150);

    onCleanup(() => {
      cancelled = true;
      window.clearTimeout(timer);
    });
  });

  createEffect(() => {
    const currentDatabase = props.currentDatabase;
    if (!currentDatabase) {
      schemaRef = { generation: schemaCatalogGeneration };
    }
  });

  return (
    <div
      ref={containerRef}
      onContextMenu={props.onContextMenu}
      class="h-full min-h-0 w-full relative"
    />
  );
}
