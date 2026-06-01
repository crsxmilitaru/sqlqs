using System.Diagnostics;
using System.Runtime.InteropServices;
using StreamJsonRpc;
using Sqlqs.Contracts.Health;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class HealthRpc
{
    private const int ProtocolVersion = 1;

    private readonly string _sidecarVersion;
    private readonly Stopwatch _uptime;

    public HealthRpc(string sidecarVersion, Stopwatch uptime)
    {
        _sidecarVersion = sidecarVersion;
        _uptime = uptime;
    }

    [JsonRpcMethod("health.ping", UseSingleObjectParameterDeserialization = true)]
    public PingResponse Ping()
    {
        return new PingResponse
        {
            SidecarVersion = _sidecarVersion,
            ProtocolVersion = ProtocolVersion,
            RuntimeDescription = RuntimeInformation.FrameworkDescription,
            ProcessId = Environment.ProcessId,
            UptimeMilliseconds = _uptime.ElapsedMilliseconds,
        };
    }
}
