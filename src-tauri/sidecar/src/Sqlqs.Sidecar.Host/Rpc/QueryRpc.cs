using StreamJsonRpc;
using Sqlqs.Contracts.Query;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class QueryRpc
{
    private readonly QueryExecutor _executor;

    public QueryRpc(QueryExecutor executor)
    {
        _executor = executor;
    }

    [JsonRpcMethod("query.execute", UseSingleObjectParameterDeserialization = true)]
    public Task<ExecuteSqlResponse> ExecuteAsync(ExecuteSqlRequest request, CancellationToken cancellationToken)
    {
        if (request.Batches is { Count: > 0 })
        {
            return _executor.ExecuteBatchesAsync(request.ConnectionId, request.Batches, request.MaxRows, cancellationToken);
        }
        return _executor.ExecuteAsync(request.ConnectionId, request.Sql, request.MaxRows, cancellationToken);
    }
}
