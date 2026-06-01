using StreamJsonRpc;
using Sqlqs.Contracts.Xe;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class XeRpc
{
    private readonly XeService _xe;

    public XeRpc(XeService xe)
    {
        _xe = xe;
    }

    [JsonRpcMethod("xe.startSession", UseSingleObjectParameterDeserialization = true)]
    public Task<StartXeSessionResponse> StartAsync(StartXeSessionRequest request, CancellationToken cancellationToken)
    {
        return _xe.StartSessionAsync(request, cancellationToken);
    }

    [JsonRpcMethod("xe.stopSession", UseSingleObjectParameterDeserialization = true)]
    public Task StopAsync(StopXeSessionRequest request, CancellationToken cancellationToken)
    {
        return _xe.StopSessionAsync(request, cancellationToken);
    }

    [JsonRpcMethod("xe.readSession", UseSingleObjectParameterDeserialization = true)]
    public Task<ReadXeSessionResponse> ReadAsync(ReadXeSessionRequest request, CancellationToken cancellationToken)
    {
        return _xe.ReadSessionAsync(request, cancellationToken);
    }
}
