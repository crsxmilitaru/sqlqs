using System.Globalization;
using System.Text;
using Microsoft.SqlServer.Management.Common;
using Microsoft.SqlServer.Management.Smo;
using Sqlqs.Contracts.Scripting;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Smo;

public sealed class ScriptingService
{
    private readonly ConnectionService _connections;

    public ScriptingService(ConnectionService connections)
    {
        _connections = connections;
    }

    public async Task<ScriptObjectResponse> ScriptObjectAsync(
        ScriptObjectRequest request,
        CancellationToken cancellationToken)
    {
        await using var lease = await _connections.AcquireAsync(request.ConnectionId, cancellationToken).ConfigureAwait(false);
        return await Task.Run(() => ScriptObject(request, cancellationToken)).ConfigureAwait(false);
    }

    private ScriptObjectResponse ScriptObject(ScriptObjectRequest request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var sqlConn = _connections.Resolve(request.ConnectionId);

        var originalDatabase = sqlConn.Database;
        try
        {
            var server = new Server(new ServerConnection(sqlConn));
            var database = server.Databases[request.Database]
                ?? throw new InvalidOperationException($"Database '{request.Database}' not found");

            var schemaName = string.IsNullOrEmpty(request.Schema) ? "dbo" : request.Schema;
            var options = BuildScriptingOptions(request.Options, server.ServerVersion.Major);

            IEnumerable<string> scripts = request.ObjectType.ToUpperInvariant() switch
            {
                "TABLE" => ScriptTable(database, schemaName, request.Name, options),
                "VIEW" => ScriptView(database, schemaName, request.Name, options),
                "PROCEDURE" => ScriptStoredProcedure(database, schemaName, request.Name, options),
                "FUNCTION" => ScriptFunction(database, schemaName, request.Name, options),
                "TRIGGER" => ScriptTrigger(database, schemaName, request.Name, options),
                "TYPE" => ScriptUserType(database, schemaName, request.Name, options),
                var other => throw new NotSupportedException($"Object type '{other}' is not supported"),
            };

            var sb = new StringBuilder();
            foreach (var line in scripts)
            {
                cancellationToken.ThrowIfCancellationRequested();
                sb.AppendLine(line);
                sb.AppendLine("GO");
            }

            return new ScriptObjectResponse { Script = sb.ToString().TrimEnd() };
        }
        finally
        {
            RestoreDatabaseContext(sqlConn, originalDatabase);
        }
    }

    internal static void RestoreDatabaseContext(Microsoft.Data.SqlClient.SqlConnection connection, string originalDatabase)
    {
        if (string.IsNullOrEmpty(originalDatabase) ||
            string.Equals(connection.Database, originalDatabase, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        try
        {
            connection.ChangeDatabase(originalDatabase);
        }
        catch
        { /* empty */ }
    }

    private static ScriptingOptions BuildScriptingOptions(ScriptOptionsDto? dto, int serverVersionMajor)
    {
        dto ??= new ScriptOptionsDto();
        return new ScriptingOptions
        {
            IncludeHeaders = dto.IncludeHeaders,
            DriPrimaryKey = true,
            DriUniqueKeys = true,
            Indexes = dto.IncludeIndexes,
            DriIndexes = dto.IncludeIndexes,
            DriForeignKeys = dto.IncludeForeignKeys,
            DriChecks = dto.IncludeCheckConstraints,
            DriDefaults = dto.IncludeDefaults,
            Triggers = dto.IncludeTriggers,
            Permissions = dto.IncludePermissions,
            IncludeIfNotExists = dto.IncludeIfNotExists,
            ScriptDrops = dto.ScriptDrops,
            SchemaQualify = true,
            SchemaQualifyForeignKeysReferences = true,
            ExtendedProperties = true,
            AnsiPadding = false,
            NoCollation = false,
            FullTextIndexes = false,
            ScriptBatchTerminator = false,
            NoCommandTerminator = false,
            EnforceScriptingOptions = true,
            TargetServerVersion = MapServerVersion(serverVersionMajor),
            Encoding = Encoding.UTF8,
        };
    }

    private static SqlServerVersion MapServerVersion(int major) => major switch
    {
        <= 10 => SqlServerVersion.Version100,
        11 => SqlServerVersion.Version110,
        12 => SqlServerVersion.Version120,
        13 => SqlServerVersion.Version130,
        14 => SqlServerVersion.Version140,
        15 => SqlServerVersion.Version150,
        16 => SqlServerVersion.Version160,
        _ => SqlServerVersion.Version170,
    };

    private static IEnumerable<string> ScriptTable(Database db, string schema, string name, ScriptingOptions options)
    {
        var table = db.Tables[name, schema]
            ?? throw new InvalidOperationException($"Table '[{schema}].[{name}]' not found in '{db.Name}'");
        return table.Script(options).Cast<string>();
    }

    private static IEnumerable<string> ScriptView(Database db, string schema, string name, ScriptingOptions options)
    {
        var view = db.Views[name, schema]
            ?? throw new InvalidOperationException($"View '[{schema}].[{name}]' not found in '{db.Name}'");
        return view.Script(options).Cast<string>();
    }

    private static IEnumerable<string> ScriptStoredProcedure(Database db, string schema, string name, ScriptingOptions options)
    {
        var sp = db.StoredProcedures[name, schema]
            ?? throw new InvalidOperationException($"Procedure '[{schema}].[{name}]' not found in '{db.Name}'");
        return sp.Script(options).Cast<string>();
    }

    private static IEnumerable<string> ScriptFunction(Database db, string schema, string name, ScriptingOptions options)
    {
        var fn = db.UserDefinedFunctions[name, schema]
            ?? throw new InvalidOperationException($"Function '[{schema}].[{name}]' not found in '{db.Name}'");
        return fn.Script(options).Cast<string>();
    }

    private static IEnumerable<string> ScriptTrigger(Database db, string schema, string name, ScriptingOptions options)
    {
        foreach (Table table in db.Tables)
        {
            if (!string.Equals(table.Schema, schema, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var trigger = table.Triggers[name];
            if (trigger is not null)
            {
                return trigger.Script(options).Cast<string>();
            }
        }
        foreach (View view in db.Views)
        {
            if (!string.Equals(view.Schema, schema, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            var trigger = view.Triggers[name];
            if (trigger is not null)
            {
                return trigger.Script(options).Cast<string>();
            }
        }
        var dbTrigger = db.Triggers[name];
        if (dbTrigger is not null)
        {
            return dbTrigger.Script(options).Cast<string>();
        }
        throw new InvalidOperationException(
            string.Format(CultureInfo.InvariantCulture, "Trigger '[{0}].[{1}]' not found", schema, name));
    }

    private static IEnumerable<string> ScriptUserType(Database db, string schema, string name, ScriptingOptions options)
    {
        var type = db.UserDefinedDataTypes[name, schema];
        if (type is not null) return type.Script(options).Cast<string>();
        var tableType = db.UserDefinedTableTypes[name, schema];
        if (tableType is not null) return tableType.Script(options).Cast<string>();
        throw new InvalidOperationException($"User type '[{schema}].[{name}]' not found");
    }
}
