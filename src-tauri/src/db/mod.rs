mod backup;
mod connection;
mod object_index;
mod query;
mod schema;
mod scripting;
mod types;

pub use backup::{
    backup_database, create_backup_schedule, delete_backup_schedule, get_backup_defaults,
    inspect_backup_file, list_backup_schedules, restore_database,
};
pub use connection::{
    connect, parse_connection_string, strip_password_from_connection_string, SqlClient,
};
pub use object_index::{search_server_objects, CachedServerObjectIndex};
pub use query::execute_query;
pub use schema::{
    get_ai_schema_summary, get_columns, get_current_database_name, get_database_schema_catalog,
    get_databases, get_foreign_keys, get_identity_columns, get_indexes, get_primary_key_columns,
    get_table_column_metadata, get_tables,
};
pub use scripting::{generate_create_script, get_object_definition};
pub use types::{
    BackupDatabaseRequest, BackupDefaults, BackupFileInfo, BackupOperationResult,
    BackupScheduleInfo, BackupScheduleRequest, ColumnInfo, ConnectionConfig, DatabaseObject,
    DatabaseSchemaCatalogEntry, QueryResult, RestoreDatabaseRequest, ServerObjectIndexStatus,
    ServerObjectSearchResponse,
};
