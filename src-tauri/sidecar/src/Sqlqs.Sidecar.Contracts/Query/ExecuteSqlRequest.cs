namespace Sqlqs.Contracts.Query;

public sealed class ExecuteSqlRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Sql { get; set; } = string.Empty;
    public long? MaxRows { get; set; }

    public IReadOnlyList<string>? Batches { get; set; }
}
