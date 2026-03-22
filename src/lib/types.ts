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
}

export interface DatabaseObject {
  name: string;
  schema_name: string;
  object_type: string;
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
  result?: QueryResult;
  isExecuting: boolean;
  error?: string;
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

export interface SqlCompletionRequest {
  before_cursor: string;
  after_cursor: string;
}

export interface SqlCompletionResult {
  insert_text: string;
  model_label: string;
  device_used: string;
  duration_ms: number;
}

export type UpdateMessageTone = "info" | "success" | "error";
