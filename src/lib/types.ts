export interface ConnectionConfig {
  server: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  use_windows_auth: boolean;
  encrypt: boolean;
  trust_server_certificate: boolean;
  connection_string?: string;
}

export interface QueryResult {
  result_sets: ResultSet[];
  rows_affected: number;
  messages: string[];
  elapsed_ms: number;
  row_limit_applied?: number | null;
}

export interface ResultSet {
  columns: ColumnInfo[];
  rows: (string | number | boolean | null)[][];
  truncated?: boolean;
}

export interface ColumnInfo {
  name: string;
  type_name: string;
  is_identity: boolean;
  is_nullable: boolean;
}

export interface DatabaseObject {
  name: string;
  schema_name: string;
  object_type: string;
}

export type BackupType = "full" | "differential" | "log";
export type BackupScheduleFrequency = "daily" | "weekly" | "monthly";

export interface BackupDatabaseRequest {
  database: string;
  destination_path: string;
  backup_type: BackupType;
  overwrite: boolean;
  copy_only: boolean;
  compression: boolean;
  checksum: boolean;
}

export interface BackupOperationResult {
  message: string;
  elapsed_ms: number;
}

export interface BackupDefaults {
  backup_directory?: string | null;
  data_directory?: string | null;
  log_directory?: string | null;
}

export interface BackupFileInfo {
  logical_name: string;
  physical_name: string;
  file_type: string;
  size_bytes: number;
}

export interface RestoreFileMove {
  logical_name: string;
  physical_name: string;
}

export interface RestoreDatabaseRequest {
  source_path: string;
  target_database: string;
  replace_existing: boolean;
  recovery: boolean;
  restricted_user: boolean;
  file_moves: RestoreFileMove[];
}

export interface BackupScheduleRequest {
  job_name: string;
  database: string;
  destination_folder: string;
  backup_type: BackupType;
  frequency: BackupScheduleFrequency;
  time: string;
  weekly_days: number[];
  monthly_day?: number | null;
  copy_only: boolean;
  compression: boolean;
  checksum: boolean;
}

export interface BackupScheduleInfo {
  job_id: string;
  job_name: string;
  enabled: boolean;
  schedule_name?: string | null;
  next_run?: string | null;
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
  auto_connect_startup: boolean;
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
  temporary?: boolean;
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
