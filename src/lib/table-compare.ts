import type { ColumnInfo, QueryResult } from "./types";

export interface TableCompareRef {
  database: string;
  schema: string;
  table: string;
}

export interface MultiCompareOptions {
  schema: string;
  table: string;
  databases: string[];
  keyColumns: string[];
  compareColumns: string[];
  whereClause?: string;
  rowLimit: number;
}

export interface CompareCountSummary {
  matching: number;
  missing: number;
  changed: number;
}

const NON_HASHABLE_TYPES = new Set([
  "text",
  "ntext",
  "image",
  "xml",
  "sql_variant",
  "geography",
  "geometry",
  "timestamp",
  "rowversion",
  "hierarchyid",
]);

export function bracketIdentifier(name: string): string {
  return `[${name.replace(/\]/g, "]]")}]`;
}

export function threePartTable(ref: TableCompareRef): string {
  return `${bracketIdentifier(ref.database)}.${bracketIdentifier(ref.schema)}.${bracketIdentifier(ref.table)}`;
}

function objectIdLiteral(ref: TableCompareRef): string {
  const name = `${ref.database}.${ref.schema}.${ref.table}`;
  return `N'${name.replace(/'/g, "''")}'`;
}

function baseTypeName(typeName: string): string {
  const idx = typeName.indexOf("(");
  return (idx >= 0 ? typeName.slice(0, idx) : typeName).trim().toLowerCase();
}

export function isNonHashableType(typeName: string): boolean {
  return NON_HASHABLE_TYPES.has(baseTypeName(typeName));
}

export function pickComparableColumns(
  columns: ColumnInfo[],
  keyColumns: string[],
): ColumnInfo[] {
  const keySet = new Set(keyColumns.map((key) => key.toLowerCase()));
  return columns.filter(
    (column) =>
      !keySet.has(column.name.toLowerCase()) &&
      !isNonHashableType(column.type_name),
  );
}

export function uniqueCompareColumns(
  keyColumns: string[],
  compareColumns: string[],
): string[] {
  const keySet = new Set(keyColumns.map((column) => column.toLowerCase()));
  return compareColumns.filter((column) => !keySet.has(column.toLowerCase()));
}

export function intersectCompareColumnsAcross(
  columnSets: ColumnInfo[][],
  keyColumns: string[],
): { compare: ColumnInfo[]; ignored: string[] } {
  const first = columnSets[0];
  if (!first) return { compare: [], ignored: [] };

  const comparable = pickComparableColumns(first, keyColumns);
  const otherNameSets = columnSets.slice(1).map(
    (columns) =>
      new Set(
        pickComparableColumns(columns, keyColumns).map((column) =>
          column.name.toLowerCase(),
        ),
      ),
  );

  const compare = comparable.filter((column) =>
    otherNameSets.every((names) => names.has(column.name.toLowerCase())),
  );
  const ignored = comparable
    .filter(
      (column) =>
        !otherNameSets.every((names) => names.has(column.name.toLowerCase())),
    )
    .map((column) => column.name);
  return { compare, ignored };
}

export function missingKeyColumnsAcross(
  columnSets: ColumnInfo[][],
  keyColumns: string[],
): string[] {
  const nameSets = columnSets.map(
    (columns) => new Set(columns.map((column) => column.name.toLowerCase())),
  );
  return keyColumns.filter((key) => {
    const lower = key.toLowerCase();
    return nameSets.some((names) => !names.has(lower));
  });
}

export function buildKeyColumnsSql(
  ref: TableCompareRef,
  preferPrimaryKey = true,
): string {
  const database = bracketIdentifier(ref.database);
  const objectId = objectIdLiteral(ref);

  if (preferPrimaryKey) {
    return `SELECT c.name
FROM ${database}.sys.indexes i
INNER JOIN ${database}.sys.index_columns ic
  ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN ${database}.sys.columns c
  ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID(${objectId})
  AND i.is_primary_key = 1
  AND ic.key_ordinal > 0
ORDER BY ic.key_ordinal`;
  }

  return `SELECT c.name
FROM ${database}.sys.indexes i
INNER JOIN ${database}.sys.index_columns ic
  ON i.object_id = ic.object_id AND i.index_id = ic.index_id
INNER JOIN ${database}.sys.columns c
  ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE i.object_id = OBJECT_ID(${objectId})
  AND i.is_unique = 1
  AND ic.key_ordinal > 0
  AND i.index_id = (
    SELECT TOP (1) i2.index_id
    FROM ${database}.sys.indexes i2
    WHERE i2.object_id = OBJECT_ID(${objectId}) AND i2.is_unique = 1
    ORDER BY CASE WHEN i2.is_primary_key = 1 THEN 0 ELSE 1 END, i2.index_id
  )
ORDER BY ic.key_ordinal`;
}

function whereSql(whereClause: string | undefined): string {
  const trimmed = whereClause?.trim();
  if (!trimmed) return "";
  return `WHERE (${trimmed})`;
}

function dbAlias(index: number): string {
  return `d${index}`;
}

function presentColumn(index: number): string {
  return `present__db${index}`;
}

function hashColumn(index: number): string {
  return `hash__db${index}`;
}

export function valueColumn(column: string, index: number): string {
  return `${column}__db${index}`;
}

export function isPresentColumn(name: string): boolean {
  return /^present__db\d+$/i.test(name);
}

export function parseValueColumn(
  name: string,
): { column: string; index: number } | null {
  const match = name.match(/^(.*)__db(\d+)$/i);
  if (!match) return null;
  return { column: match[1]!, index: Number(match[2]) };
}

function hashPart(alias: string, column: string): string {
  const qualified = `${alias}.${bracketIdentifier(column)}`;
  const asNvarchar = `CAST(${qualified} AS NVARCHAR(MAX))`;
  return `CASE WHEN ${qualified} IS NULL THEN N'N;' ELSE CONCAT(N'V;', CAST(DATALENGTH(${asNvarchar}) AS NVARCHAR(20)), N';', ${asNvarchar}, N';') END`;
}

function payloadHashExpr(alias: string, compareColumns: string[]): string {
  if (compareColumns.length === 0) {
    return "CAST(0x AS VARBINARY(32))";
  }
  const parts = compareColumns.map((column) => hashPart(alias, column));
  return `HASHBYTES('SHA2_256', CONCAT(${parts.join(", ")}))`;
}

function buildDataCte(
  index: number,
  ref: TableCompareRef,
  keyColumns: string[],
  compareColumns: string[],
  whereClause?: string,
): string {
  const alias = dbAlias(index);
  const table = threePartTable(ref);
  const selectKeys = keyColumns
    .map((column) => `${alias}.${bracketIdentifier(column)}`)
    .join(", ");
  const selectCompare = compareColumns
    .map((column) => `${alias}.${bracketIdentifier(column)}`)
    .join(", ");

  return `${alias}_data AS (
  SELECT
    ${selectKeys},
    ${selectCompare ? `${selectCompare},` : ""}
    ${payloadHashExpr(alias, compareColumns)} AS payload_hash,
    CAST(1 AS bit) AS is_present
  FROM ${table} ${alias}
  ${whereSql(whereClause)}
)`;
}

function keySelectList(alias: string, keyColumns: string[]): string {
  return keyColumns
    .map((column) => `${alias}.${bracketIdentifier(column)}`)
    .join(", ");
}

function joinOnKeys(
  leftAlias: string,
  rightAlias: string,
  keyColumns: string[],
): string {
  return keyColumns
    .map((column) => {
      const left = `${leftAlias}.${bracketIdentifier(column)}`;
      const right = `${rightAlias}.${bracketIdentifier(column)}`;
      return `(${left} = ${right} OR (${left} IS NULL AND ${right} IS NULL))`;
    })
    .join(" AND ");
}

function presentSum(databaseCount: number): string {
  return Array.from(
    { length: databaseCount },
    (_, index) => `CAST(${bracketIdentifier(presentColumn(index))} AS int)`,
  ).join(" + ");
}

function hashesDifferExpr(databaseCount: number): string {
  const parts: string[] = [];
  for (let i = 0; i < databaseCount; i += 1) {
    for (let j = i + 1; j < databaseCount; j += 1) {
      parts.push(
        `(${bracketIdentifier(presentColumn(i))} = 1 AND ${bracketIdentifier(presentColumn(j))} = 1 AND ${bracketIdentifier(hashColumn(i))} <> ${bracketIdentifier(hashColumn(j))})`,
      );
    }
  }
  if (parts.length === 0) return "CAST(0 AS bit)";
  return `(${parts.join(" OR ")})`;
}

function buildJoinedCte(options: MultiCompareOptions): string {
  const compareColumns = uniqueCompareColumns(
    options.keyColumns,
    options.compareColumns,
  );
  if (options.keyColumns.length === 0) {
    throw new Error("At least one key column is required.");
  }
  if (options.databases.length < 2) {
    throw new Error("Select at least two databases.");
  }

  const dataCtes = options.databases.map((database, index) =>
    buildDataCte(
      index,
      {
        database,
        schema: options.schema,
        table: options.table,
      },
      options.keyColumns,
      compareColumns,
      options.whereClause,
    ),
  );

  const keyUnions = options.databases
    .map((_, index) => {
      const alias = dbAlias(index);
      return `SELECT ${keySelectList(`${alias}_data`, options.keyColumns)} FROM ${alias}_data`;
    })
    .join("\n  UNION\n  ");

  const keyCoalesce = options.keyColumns
    .map((column) => {
      const coalesced = options.databases
        .map((_, index) => `${dbAlias(index)}.${bracketIdentifier(column)}`)
        .join(", ");
      return `COALESCE(${coalesced}) AS ${bracketIdentifier(column)}`;
    })
    .join(",\n    ");

  const presentSelects = options.databases
    .map((_, index) => {
      const alias = dbAlias(index);
      return `CASE WHEN ${alias}.is_present IS NULL THEN CAST(0 AS bit) ELSE CAST(1 AS bit) END AS ${bracketIdentifier(presentColumn(index))}`;
    })
    .join(",\n    ");

  const hashSelects = options.databases
    .map((_, index) => {
      const alias = dbAlias(index);
      return `${alias}.payload_hash AS ${bracketIdentifier(hashColumn(index))}`;
    })
    .join(",\n    ");

  const valueSelects = compareColumns
    .flatMap((column) =>
      options.databases.map((_, index) => {
        const alias = dbAlias(index);
        return `${alias}.${bracketIdentifier(column)} AS ${bracketIdentifier(valueColumn(column, index))}`;
      }),
    )
    .join(",\n    ");

  const leftJoins = options.databases
    .map((_, index) => {
      const alias = dbAlias(index);
      return `LEFT JOIN ${alias}_data ${alias}\n    ON ${joinOnKeys("k", alias, options.keyColumns)}`;
    })
    .join("\n  ");

  const valueSelectBlock = valueSelects ? `,\n    ${valueSelects}` : "";

  return `${dataCtes.join(",\n")},
all_keys AS (
  ${keyUnions}
),
joined AS (
  SELECT
    ${keyCoalesce},
    ${presentSelects},
    ${hashSelects}${valueSelectBlock}
  FROM all_keys k
  ${leftJoins}
)`;
}

function differsPredicate(databaseCount: number): string {
  const present = presentSum(databaseCount);
  return `(${present} < ${databaseCount} OR ${hashesDifferExpr(databaseCount)})`;
}

export function buildMultiCountSql(options: MultiCompareOptions): string {
  const cte = buildJoinedCte(options);
  const present = presentSum(options.databases.length);
  const hashesDiffer = hashesDifferExpr(options.databases.length);
  return `WITH ${cte}
SELECT
  SUM(CASE WHEN ${present} = ${options.databases.length} AND NOT ${hashesDiffer} THEN 1 ELSE 0 END) AS matching,
  SUM(CASE WHEN ${present} < ${options.databases.length} THEN 1 ELSE 0 END) AS missing,
  SUM(CASE WHEN ${present} = ${options.databases.length} AND ${hashesDiffer} THEN 1 ELSE 0 END) AS changed
FROM joined;`;
}

export function buildMultiDiffSql(options: MultiCompareOptions): string {
  const cte = buildJoinedCte(options);
  const compareColumns = uniqueCompareColumns(
    options.keyColumns,
    options.compareColumns,
  );
  const limit = Math.max(1, options.rowLimit);
  const firstKey = options.keyColumns[0]!;
  const presentCols = options.databases.map((_, index) =>
    bracketIdentifier(presentColumn(index)),
  );
  const valueCols = compareColumns.flatMap((column) =>
    options.databases.map((_, index) =>
      bracketIdentifier(valueColumn(column, index)),
    ),
  );
  const selectCols = [
    ...options.keyColumns.map((column) => bracketIdentifier(column)),
    ...presentCols,
    ...valueCols,
  ].join(",\n  ");

  return `WITH ${cte}
SELECT TOP (${limit})
  ${selectCols}
FROM joined
WHERE ${differsPredicate(options.databases.length)}
ORDER BY ${bracketIdentifier(firstKey)};`;
}

export function buildMultiCompareScript(options: MultiCompareOptions): string {
  return `${buildMultiCountSql(options)}\n\n${buildMultiDiffSql(options)}`;
}

export function parseKeyColumnsResult(result: QueryResult): string[] {
  const resultSet = result.result_sets[0];
  if (!resultSet) return [];
  return resultSet.rows
    .map((row) => String(row[0] ?? "").trim())
    .filter(Boolean);
}

export function parseMultiCountResult(result: QueryResult): CompareCountSummary {
  const summary: CompareCountSummary = {
    matching: 0,
    missing: 0,
    changed: 0,
  };
  const resultSet = result.result_sets[0];
  const row = resultSet?.rows[0];
  if (!row) return summary;
  summary.matching = Number(row[0] ?? 0);
  summary.missing = Number(row[1] ?? 0);
  summary.changed = Number(row[2] ?? 0);
  return summary;
}

export function hasTableInDatabase(
  objects: { name: string; schema_name: string; object_type: string }[],
  schema: string,
  table: string,
): boolean {
  const schemaLower = schema.toLowerCase();
  const tableLower = table.toLowerCase();
  return objects.some(
    (object) =>
      object.object_type === "TABLE" &&
      object.schema_name.toLowerCase() === schemaLower &&
      object.name.toLowerCase() === tableLower,
  );
}
