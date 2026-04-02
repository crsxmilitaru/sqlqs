export interface ConnectionConfig {
  server: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  use_windows_auth: boolean;
  encrypt: boolean;
  trust_server_certificate: boolean;
}

export interface QueryResult {
  result_sets: ResultSet[];
  rows_affected: number;
  messages: string[];
  elapsed_ms: number;
}

export interface ResultSet {
  columns: ColumnInfo[];
  rows: (string | number | boolean | null)[][];
}

export interface ColumnInfo {
  name: string;
  type_name: string;
  is_identity: boolean;
}

export interface DatabaseObject {
  name: string;
  schema_name: string;
  object_type: string;
}

export interface DatabaseSchemaCatalogEntry {
  table_name: string;
  schema_name: string;
  columns: string[];
}

export interface ServerDatabaseObject extends DatabaseObject {
  database: string;
}

export interface ServerObjectSearchResponse {
  results: ServerDatabaseObject[];
  total_matches: number;
  initialized: boolean;
  indexing: boolean;
  database_count: number;
  processed_database_count: number;
  failed_databases: string[];
}

export interface ServerObjectIndexStatus {
  initialized: boolean;
  indexing: boolean;
  database_count: number;
  processed_database_count: number;
  failed_databases: string[];
  object_count: number;
}

export interface SavedConnection {
  name: string;
  config: ConnectionConfig;
}

export interface AppSettings {
  connections: SavedConnection[];
  last_connection?: string;
  keep_logged_in: boolean;
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  savedSql: string;
  result?: QueryResult;
  isExecuting: boolean;
  error?: string;
  sourceId?: string;
  userTitle?: boolean;
  pinned?: boolean;
}

export interface ExecutedQuery {
  sql: string;
  title: string;
  database: string;
  executedAt: number;
}

export interface GeminiStatus {
  hasKey: boolean;
  lastError?: string;
}

export type UpdateMessageTone = "info" | "success" | "error";
