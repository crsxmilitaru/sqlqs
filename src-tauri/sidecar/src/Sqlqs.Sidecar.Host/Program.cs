using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using StreamJsonRpc;
using Sqlqs.Sidecar.Host.Rpc;
using Sqlqs.Sidecar.Smo;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Host;

internal static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var stdin = Console.OpenStandardInput();
        var stdout = Console.OpenStandardOutput();

        Console.SetOut(Console.Error);

        var startedAt = Stopwatch.StartNew();
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString() ?? "0.0.0";

        var formatter = new SystemTextJsonFormatter();
        formatter.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        formatter.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
        var handler = new HeaderDelimitedMessageHandler(stdout, stdin, formatter);
        using var rpc = new JsonRpc(handler);

        await using var connections = new ConnectionService();
        var schema = new SchemaReader(connections);
        var queries = new QueryExecutor(connections);
        var scripting = new ScriptingService(connections);
        var backups = new BackupService(connections);
        var xe = new XeService(connections);

        var targetOptions = new JsonRpcTargetOptions
        {
            UseSingleObjectParameterDeserialization = true,
        };

        rpc.AddLocalRpcTarget(new HealthRpc(version, startedAt), targetOptions);
        rpc.AddLocalRpcTarget(new ConnectionRpc(connections), targetOptions);
        rpc.AddLocalRpcTarget(new SchemaRpc(schema), targetOptions);
        rpc.AddLocalRpcTarget(new QueryRpc(queries), targetOptions);
        rpc.AddLocalRpcTarget(new ScriptingRpc(scripting), targetOptions);
        rpc.AddLocalRpcTarget(new BackupRpc(backups), targetOptions);
        rpc.AddLocalRpcTarget(new XeRpc(xe), targetOptions);

        Console.Error.WriteLine($"[sqlqs-sidecar] starting host {version} (pid {Environment.ProcessId})");

        rpc.StartListening();

        try
        {
            await rpc.Completion.ConfigureAwait(false);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[sqlqs-sidecar] fatal: {ex}");
            return 1;
        }
    }
}
