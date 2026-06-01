namespace Sqlqs.Contracts.Query;

public sealed class ExecuteSqlRequest
{
    public string ConnectionId { get; set; } = string.Empty;
    public string Sql { get; set; } = string.Empty;
    public long? MaxRows { get; set; }

    /// <summary>
    /// When non-null and non-empty, every batch is executed sequentially under
    /// a single connection lease so that session state (transactions, temp
    /// tables, SET options) is preserved across GO boundaries.
    /// </summary>
    public IReadOnlyList<string>? Batches { get; set; }
}
