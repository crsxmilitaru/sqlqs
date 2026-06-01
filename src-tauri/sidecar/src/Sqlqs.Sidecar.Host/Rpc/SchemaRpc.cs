using StreamJsonRpc;
using Sqlqs.Contracts.Schema;
using Sqlqs.Sidecar.Sql;

namespace Sqlqs.Sidecar.Host.Rpc;

internal sealed class SchemaRpc
{
    private readonly SchemaReader _schema;

    public SchemaRpc(SchemaReader schema)
    {
        _schema = schema;
    }

    [JsonRpcMethod("schema.listDatabases", UseSingleObjectParameterDeserialization = true)]
    public Task<ListDatabasesResponse> ListDatabasesAsync(ListDatabasesRequest request, CancellationToken cancellationToken)
    {
        return _schema.ListDatabasesAsync(request.ConnectionId, cancellationToken);
    }

    [JsonRpcMethod("schema.listTables", UseSingleObjectParameterDeserialization = true)]
    public Task<ListTablesResponse> ListTablesAsync(ListTablesRequest request, CancellationToken cancellationToken)
    {
        return _schema.ListTablesAsync(request.ConnectionId, request.Database, cancellationToken);
    }

    [JsonRpcMethod("schema.listColumns", UseSingleObjectParameterDeserialization = true)]
    public Task<ListColumnsResponse> ListColumnsAsync(ListColumnsRequest request, CancellationToken cancellationToken)
    {
        return _schema.ListColumnsAsync(request.ConnectionId, request.Database, request.Schema, request.Table, cancellationToken);
    }

    [JsonRpcMethod("schema.listIndexes", UseSingleObjectParameterDeserialization = true)]
    public Task<ListIndexesResponse> ListIndexesAsync(ListIndexesRequest request, CancellationToken cancellationToken)
    {
        return _schema.ListIndexesAsync(request.ConnectionId, request.Database, request.Schema, request.Table, cancellationToken);
    }

    [JsonRpcMethod("schema.listForeignKeys", UseSingleObjectParameterDeserialization = true)]
    public Task<ListForeignKeysResponse> ListForeignKeysAsync(ListForeignKeysRequest request, CancellationToken cancellationToken)
    {
        return _schema.ListForeignKeysAsync(request.ConnectionId, request.Database, request.Schema, request.Table, cancellationToken);
    }

    [JsonRpcMethod("schema.listSchemaCatalog", UseSingleObjectParameterDeserialization = true)]
    public Task<ListSchemaCatalogResponse> ListSchemaCatalogAsync(ListSchemaCatalogRequest request, CancellationToken cancellationToken)
    {
        return _schema.ListSchemaCatalogAsync(request.ConnectionId, request.Database, cancellationToken);
    }
}
