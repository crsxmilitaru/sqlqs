import { invoke } from "@tauri-apps/api/core";
import type { DatabaseSchemaCatalogEntry } from "./types";

export type SchemaObjectKind =
  | "TABLE"
  | "VIEW"
  | "PROCEDURE"
  | "FUNCTION"
  | "SYNONYM"
  | "TYPE"
  | "CTE";

export interface SchemaColumn {
  name: string;
  typeName: string;
  isNullable: boolean;
  isIdentity: boolean;
  isPrimaryKey: boolean;
}

export interface SchemaParameter {
  name: string;
  typeName: string;
  isOutput: boolean;
}

export interface SchemaObjectEntry {
  name: string;
  schema: string;
  kind: SchemaObjectKind;
  columns: SchemaColumn[];
  parameters: SchemaParameter[];
}

export interface SchemaCatalog {
  schemas: string[];
  tables: SchemaObjectEntry[];
  routines: SchemaObjectEntry[];
  userTypes: SchemaObjectEntry[];
  userTypesByName: Map<string, SchemaObjectEntry[]>;
  userTypesByQualifiedName: Map<string, SchemaObjectEntry>;
  tablesByName: Map<string, SchemaObjectEntry[]>;
  tablesByQualifiedName: Map<string, SchemaObjectEntry>;
  tablesBySchema: Map<string, SchemaObjectEntry[]>;
  routinesByName: Map<string, SchemaObjectEntry[]>;
  routinesByQualifiedName: Map<string, SchemaObjectEntry>;
  routinesBySchema: Map<string, SchemaObjectEntry[]>;
}

const SCHEMA_CATALOG_TTL_MS = 5 * 60 * 1000;
const SCHEMA_CATALOG_MAX_ENTRIES = 24;
const SIMPLE_IDENTIFIER_RE = /^[A-Za-z_@#][A-Za-z0-9_@$#]*$/;

const schemaCatalogCache = new Map<
  string,
  { catalog: SchemaCatalog; expiresAt: number }
>();
const schemaCatalogLoaders = new Map<string, Promise<SchemaCatalog>>();

export function unquoteIdentifier(name: string): string {
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

export function normalizeIdentifier(name: string): string {
  return unquoteIdentifier(name).toLowerCase();
}

export function bracketIdentifier(name: string): string {
  return `[${name.replace(/\]/g, "]]")}]`;
}

export function identifierApply(name: string): string {
  return SIMPLE_IDENTIFIER_RE.test(name) ? name : bracketIdentifier(name);
}

export function qualifiedObjectKey(schema: string, name: string): string {
  return `${normalizeIdentifier(schema)}.${normalizeIdentifier(name)}`;
}

function parseObjectKind(kind: string): SchemaObjectKind {
  switch (kind.trim().toUpperCase()) {
    case "VIEW":
      return "VIEW";
    case "PROCEDURE":
      return "PROCEDURE";
    case "FUNCTION":
      return "FUNCTION";
    case "SYNONYM":
      return "SYNONYM";
    case "TYPE":
      return "TYPE";
    default:
      return "TABLE";
  }
}

function indexEntry(
  map: Map<string, SchemaObjectEntry[]>,
  key: string,
  entry: SchemaObjectEntry,
) {
  const existing = map.get(key);
  if (existing) {
    existing.push(entry);
  } else {
    map.set(key, [entry]);
  }
}

function sortEntries(entries: SchemaObjectEntry[]) {
  entries.sort(
    (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
  );
}

function sortIndexed(map: Map<string, SchemaObjectEntry[]>, bySchema: boolean) {
  for (const list of map.values()) {
    if (bySchema) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      list.sort(
        (a, b) =>
          a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
      );
    }
  }
}

export function buildSchemaCatalog(
  entries: DatabaseSchemaCatalogEntry[],
): SchemaCatalog {
  const schemaSet = new Map<string, string>();
  const tables: SchemaObjectEntry[] = [];
  const routines: SchemaObjectEntry[] = [];
  const tablesByName = new Map<string, SchemaObjectEntry[]>();
  const tablesByQualifiedName = new Map<string, SchemaObjectEntry>();
  const tablesBySchema = new Map<string, SchemaObjectEntry[]>();
  const routinesByName = new Map<string, SchemaObjectEntry[]>();
  const routinesByQualifiedName = new Map<string, SchemaObjectEntry>();
  const routinesBySchema = new Map<string, SchemaObjectEntry[]>();
  const userTypes: SchemaObjectEntry[] = [];
  const userTypesByName = new Map<string, SchemaObjectEntry[]>();
  const userTypesByQualifiedName = new Map<string, SchemaObjectEntry>();

  const addTable = (entry: SchemaObjectEntry) => {
    const schemaKey = normalizeIdentifier(entry.schema);
    const nameKey = normalizeIdentifier(entry.name);
    const qualifiedKey = qualifiedObjectKey(entry.schema, entry.name);
    schemaSet.set(schemaKey, entry.schema);
    tables.push(entry);
    indexEntry(tablesByName, nameKey, entry);
    tablesByQualifiedName.set(qualifiedKey, entry);
    indexEntry(tablesBySchema, schemaKey, entry);
  };

  const addRoutine = (entry: SchemaObjectEntry) => {
    const schemaKey = normalizeIdentifier(entry.schema);
    const nameKey = normalizeIdentifier(entry.name);
    const qualifiedKey = qualifiedObjectKey(entry.schema, entry.name);
    schemaSet.set(schemaKey, entry.schema);
    routines.push(entry);
    indexEntry(routinesByName, nameKey, entry);
    routinesByQualifiedName.set(qualifiedKey, entry);
    indexEntry(routinesBySchema, schemaKey, entry);
  };

  for (const raw of entries) {
    if (!raw.object_name) continue;
    const kind = parseObjectKind(raw.object_kind);
    const seenColumns = new Set<string>();
    const columns: SchemaColumn[] = [];
    for (const column of raw.columns) {
      if (!column.name) continue;
      const key = column.name.toLowerCase();
      if (seenColumns.has(key)) continue;
      seenColumns.add(key);
      columns.push({
        name: column.name,
        typeName: column.type_name,
        isNullable: column.is_nullable,
        isIdentity: column.is_identity,
        isPrimaryKey: column.is_primary_key,
      });
    }
    const parameters: SchemaParameter[] = raw.parameters
      .filter((parameter) => parameter.name)
      .map((parameter) => ({
        name: parameter.name,
        typeName: parameter.type_name,
        isOutput: parameter.is_output,
      }));

    const entry: SchemaObjectEntry = {
      name: raw.object_name,
      schema: raw.schema_name || "dbo",
      kind,
      columns,
      parameters,
    };

    if (kind === "TYPE") {
      const schemaKey = normalizeIdentifier(entry.schema);
      schemaSet.set(schemaKey, entry.schema);
      userTypes.push(entry);
      indexEntry(userTypesByName, normalizeIdentifier(entry.name), entry);
      userTypesByQualifiedName.set(
        qualifiedObjectKey(entry.schema, entry.name),
        entry,
      );
    } else if (kind === "PROCEDURE" || kind === "FUNCTION") {
      addRoutine(entry);
      if (kind === "FUNCTION" && columns.length > 0) {
        addTable(entry);
      }
    } else {
      addTable(entry);
    }
  }

  sortEntries(tables);
  sortEntries(routines);
  sortEntries(userTypes);
  sortIndexed(tablesByName, false);
  sortIndexed(tablesBySchema, true);
  sortIndexed(routinesByName, false);
  sortIndexed(routinesBySchema, true);

  return {
    schemas: Array.from(schemaSet.values()).sort((a, b) => a.localeCompare(b)),
    tables,
    routines,
    userTypes,
    userTypesByName,
    userTypesByQualifiedName,
    tablesByName,
    tablesByQualifiedName,
    tablesBySchema,
    routinesByName,
    routinesByQualifiedName,
    routinesBySchema,
  };
}

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
}

export async function loadSchemaCatalog(database: string): Promise<SchemaCatalog> {
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

export function preloadSchemaCatalog(database: string) {
  void loadSchemaCatalog(database).catch((err) => {
    console.error(`Failed to preload schema catalog for "${database}":`, err);
  });
}
