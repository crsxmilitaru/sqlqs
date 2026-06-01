using StreamJsonRpc;
using Sqlqs.Contracts.Scripting;
using Sqlqs.Sidecar.Smo;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class ScriptingRpc
{
    private readonly ScriptingService _scripting;

    public ScriptingRpc(ScriptingService scripting)
    {
        _scripting = scripting;
    }

    [JsonRpcMethod("scripting.scriptObject", UseSingleObjectParameterDeserialization = true)]
    public Task<ScriptObjectResponse> ScriptObjectAsync(ScriptObjectRequest request, CancellationToken cancellationToken)
    {
        return _scripting.ScriptObjectAsync(request, cancellationToken);
    }
}
