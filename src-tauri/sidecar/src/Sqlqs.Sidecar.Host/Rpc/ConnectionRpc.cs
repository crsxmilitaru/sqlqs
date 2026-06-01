using StreamJsonRpc;
using Sqlqs.Contracts.Connection;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class ConnectionRpc
{
    private readonly ConnectionService _connections;

    public ConnectionRpc(ConnectionService connections)
    {
        _connections = connections;
    }

    [JsonRpcMethod("connection.open", UseSingleObjectParameterDeserialization = true)]
    public Task<OpenConnectionResponse> OpenAsync(OpenConnectionRequest request, CancellationToken cancellationToken)
    {
        return _connections.OpenAsync(request.Config, cancellationToken);
    }

    [JsonRpcMethod("connection.close", UseSingleObjectParameterDeserialization = true)]
    public Task CloseAsync(CloseConnectionRequest request)
    {
        return _connections.CloseAsync(request.ConnectionId);
    }

    [JsonRpcMethod("connection.changeDatabase", UseSingleObjectParameterDeserialization = true)]
    public Task ChangeDatabaseAsync(ChangeDatabaseRequest request, CancellationToken cancellationToken)
    {
        return _connections.ChangeDatabaseAsync(request.ConnectionId, request.Database, cancellationToken);
    }
}
