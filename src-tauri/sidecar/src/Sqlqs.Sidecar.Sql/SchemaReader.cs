using Microsoft.Data.SqlClient;
using Sqlqs.Contracts.Schema;

namespace Sqlqs.Sidecar.Sql;

public sealed class SchemaReader
{
    private readonly ConnectionService _connections;

    public SchemaReader(ConnectionService connections)
    {
        _connections = connections;
    }

    public async Task<ListDatabasesResponse> ListDatabasesAsync(
        string connectionId,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;

        const string sql = """
            SELECT
                d.name,
                CASE WHEN d.database_id <= 4 THEN 1 ELSE 0 END AS is_system,
                d.state_desc,
                d.recovery_model_desc,
                d.collation_name
            FROM sys.databases d
            WHERE HAS_DBACCESS(d.name) = 1
            ORDER BY d.name
            """;

        var databases = new List<DatabaseInfo>();
        using var cmd = new SqlCommand(sql, connection);
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            databases.Add(new DatabaseInfo
            {
                Name = reader.GetString(0),
                IsSystem = reader.GetInt32(1) == 1,
                State = reader.IsDBNull(2) ? null : reader.GetString(2),
                RecoveryModel = reader.IsDBNull(3) ? null : reader.GetString(3),
                CollationName = reader.IsDBNull(4) ? null : reader.GetString(4),
            });
        }

        return new ListDatabasesResponse { Databases = databases };
    }

    public async Task<ListTablesResponse> ListTablesAsync(
        string connectionId,
        string database,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var db = QuoteIdentifier(database);

        var sql = $$"""
            SELECT schema_name, object_name, object_type FROM (
                SELECT s.name AS schema_name, o.name AS object_name,
                    CASE o.type
                        WHEN 'U'  THEN 'TABLE'
                        WHEN 'V'  THEN 'VIEW'
                        WHEN 'P'  THEN 'PROCEDURE'
                        WHEN 'FN' THEN 'FUNCTION'
                        WHEN 'IF' THEN 'FUNCTION'
                        WHEN 'TF' THEN 'FUNCTION'
                        WHEN 'TR' THEN 'TRIGGER'
                    END AS object_type
                FROM {{db}}.sys.objects o
                JOIN {{db}}.sys.schemas s ON o.schema_id = s.schema_id
                WHERE o.type IN ('U','V','P','FN','IF','TF','TR')
                UNION ALL
                SELECT s.name AS schema_name, t.name AS object_name, 'TYPE' AS object_type
                FROM {{db}}.sys.types t
                JOIN {{db}}.sys.schemas s ON t.schema_id = s.schema_id
                WHERE t.is_user_defined = 1
            ) x
            ORDER BY object_type, schema_name, object_name
            """;

        var objects = new List<DatabaseObject>();
        using var cmd = new SqlCommand(sql, connection);
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            objects.Add(new DatabaseObject
            {
                SchemaName = reader.GetString(0),
                Name = reader.GetString(1),
                ObjectType = reader.GetString(2),
            });
        }

        return new ListTablesResponse { Objects = objects };
    }

    public async Task<ListColumnsResponse> ListColumnsAsync(
        string connectionId,
        string database,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var db = QuoteIdentifier(database);
        var dbForObjectId = database.Replace("]", "]]").Replace("'", "''");

        var sql = $$"""
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE + CASE
                    WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL THEN '(' +
                        CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'max'
                             ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS VARCHAR) END + ')'
                    WHEN c.DATA_TYPE IN ('decimal','numeric') THEN '(' +
                        CAST(c.NUMERIC_PRECISION AS VARCHAR) + ',' + CAST(c.NUMERIC_SCALE AS VARCHAR) + ')'
                    ELSE '' END AS full_type,
                COLUMNPROPERTY(
                    OBJECT_ID('[{{dbForObjectId}}].[' + c.TABLE_SCHEMA + '].[' + c.TABLE_NAME + ']'),
                    c.COLUMN_NAME,
                    'IsIdentity'
                ) AS is_identity,
                CASE WHEN c.IS_NULLABLE = 'YES' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS is_nullable
            FROM {{db}}.INFORMATION_SCHEMA.COLUMNS c
            WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
            ORDER BY c.ORDINAL_POSITION
            """;

        var columns = new List<ColumnInfo>();
        using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@schema", schema);
        cmd.Parameters.AddWithValue("@table", table);
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            columns.Add(new ColumnInfo
            {
                Name = reader.GetString(0),
                TypeName = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                IsIdentity = !reader.IsDBNull(2) && reader.GetInt32(2) == 1,
                IsNullable = !reader.IsDBNull(3) && reader.GetBoolean(3),
            });
        }

        return new ListColumnsResponse { Columns = columns };
    }

    public async Task<ListIndexesResponse> ListIndexesAsync(
        string connectionId,
        string database,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var db = QuoteIdentifier(database);

        var sql = $$"""
            SELECT i.name AS index_name,
                   i.type_desc AS index_type,
                   i.is_unique,
                   i.is_primary_key,
                   STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
            FROM {{db}}.sys.indexes i
            JOIN {{db}}.sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
            JOIN {{db}}.sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
            JOIN {{db}}.sys.objects o ON i.object_id = o.object_id
            JOIN {{db}}.sys.schemas s ON o.schema_id = s.schema_id
            WHERE s.name = @schema AND o.name = @table AND i.name IS NOT NULL
            GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
            ORDER BY i.is_primary_key DESC, i.name
            """;

        var indexes = new List<IndexInfo>();
        using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@schema", schema);
        cmd.Parameters.AddWithValue("@table", table);
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            indexes.Add(new IndexInfo
            {
                Name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                TypeDescription = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                IsUnique = !reader.IsDBNull(2) && reader.GetBoolean(2),
                IsPrimaryKey = !reader.IsDBNull(3) && reader.GetBoolean(3),
                Columns = reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
            });
        }

        return new ListIndexesResponse { Indexes = indexes };
    }

    public async Task<ListForeignKeysResponse> ListForeignKeysAsync(
        string connectionId,
        string database,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var db = QuoteIdentifier(database);

        var sql = $$"""
            SELECT fk.name AS fk_name,
                   STRING_AGG(pc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS parent_columns,
                   rs.name AS ref_schema,
                   rt.name AS ref_table,
                   STRING_AGG(rc.name, ', ') WITHIN GROUP (ORDER BY fkc.constraint_column_id) AS ref_columns
            FROM {{db}}.sys.foreign_keys fk
            JOIN {{db}}.sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
            JOIN {{db}}.sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
            JOIN {{db}}.sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
            JOIN {{db}}.sys.objects pt ON fk.parent_object_id = pt.object_id
            JOIN {{db}}.sys.schemas ps ON pt.schema_id = ps.schema_id
            JOIN {{db}}.sys.objects rt ON fk.referenced_object_id = rt.object_id
            JOIN {{db}}.sys.schemas rs ON rt.schema_id = rs.schema_id
            WHERE ps.name = @schema AND pt.name = @table
            GROUP BY fk.name, rs.name, rt.name
            ORDER BY fk.name
            """;

        var fks = new List<ForeignKeyInfo>();
        using var cmd = new SqlCommand(sql, connection);
        cmd.Parameters.AddWithValue("@schema", schema);
        cmd.Parameters.AddWithValue("@table", table);
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            fks.Add(new ForeignKeyInfo
            {
                Name = reader.IsDBNull(0) ? string.Empty : reader.GetString(0),
                ParentColumns = reader.IsDBNull(1) ? string.Empty : reader.GetString(1),
                ReferencedSchema = reader.IsDBNull(2) ? string.Empty : reader.GetString(2),
                ReferencedTable = reader.IsDBNull(3) ? string.Empty : reader.GetString(3),
                ReferencedColumns = reader.IsDBNull(4) ? string.Empty : reader.GetString(4),
            });
        }

        return new ListForeignKeysResponse { ForeignKeys = fks };
    }

    public async Task<ListSchemaCatalogResponse> ListSchemaCatalogAsync(
        string connectionId,
        string database,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(connectionId, cancellationToken).ConfigureAwait(false);
        var connection = lease.Connection;
        var db = QuoteIdentifier(database);

        var sql = $$"""
            SELECT s.name AS schema_name,
                   o.name AS object_name,
                   c.name AS column_name
            FROM {{db}}.sys.objects o
            JOIN {{db}}.sys.schemas s ON o.schema_id = s.schema_id
            LEFT JOIN {{db}}.sys.columns c ON o.object_id = c.object_id
            WHERE o.type IN ('U', 'V') AND o.is_ms_shipped = 0
            ORDER BY s.name, o.name, c.column_id
            """;

        var entries = new List<SchemaCatalogEntry>();
        SchemaCatalogEntry? current = null;
        List<string>? currentColumns = null;

        using var cmd = new SqlCommand(sql, connection);
        using var reader = await cmd.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var schemaName = reader.IsDBNull(0) ? "dbo" : reader.GetString(0);
            var tableName = reader.IsDBNull(1) ? string.Empty : reader.GetString(1);
            if (string.IsNullOrEmpty(tableName)) continue;

            var columnName = reader.IsDBNull(2) ? null : reader.GetString(2);

            if (current is null ||
                !string.Equals(current.SchemaName, schemaName, StringComparison.Ordinal) ||
                !string.Equals(current.TableName, tableName, StringComparison.Ordinal))
            {
                currentColumns = new List<string>();
                current = new SchemaCatalogEntry
                {
                    SchemaName = schemaName,
                    TableName = tableName,
                    Columns = currentColumns,
                };
                entries.Add(current);
            }

            if (columnName is not null && currentColumns is not null)
            {
                currentColumns.Add(columnName);
            }
        }

        return new ListSchemaCatalogResponse { Entries = entries };
    }

    private static string QuoteIdentifier(string identifier)
    {
        return "[" + identifier.Replace("]", "]]") + "]";
    }
}
