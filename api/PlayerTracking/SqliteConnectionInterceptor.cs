using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging;

namespace api.PlayerTracking;

/// <summary>
/// Interceptor that configures SQLite PRAGMA settings on each new connection.
/// This is necessary because SQLite PRAGMAs like busy_timeout are connection-specific
/// and must be set each time a new connection is opened.
/// </summary>
public class SqliteConnectionInterceptor(ILogger<SqliteConnectionInterceptor> logger, int busyTimeoutMs = 5000)
    : DbConnectionInterceptor
{
    public override void ConnectionOpened(DbConnection connection, ConnectionEndEventData eventData)
    {
        ConfigureConnection(connection);
        base.ConnectionOpened(connection, eventData);
    }

    public override async Task ConnectionOpenedAsync(DbConnection connection, ConnectionEndEventData eventData, CancellationToken cancellationToken = default)
    {
        ConfigureConnection(connection);
        await base.ConnectionOpenedAsync(connection, eventData, cancellationToken);
    }

    /// <summary>
    /// Caps how many rows ANALYZE (and PRAGMA optimize) samples per index. Without a cap,
    /// analysing this database means reading every index in full — PlayerObservations alone
    /// carries ~8.8GB of them — which on the network-attached volume takes minutes and
    /// saturates the disk. At 400 the sample is bounded and effectively free (measured
    /// 0.115s vs 1.305s for a full ANALYZE of PlayerSessions) and produced identical plans.
    /// This is per-connection, so it must be set here for SqliteStatisticsBackgroundService's
    /// PRAGMA optimize to inherit it.
    /// </summary>
    private const int AnalysisLimit = 400;

    private void ConfigureConnection(DbConnection connection)
    {
        try
        {
            using var command = connection.CreateCommand();

            // Set busy_timeout - wait for locks instead of failing immediately with SQLITE_BUSY
            command.CommandText = $"PRAGMA busy_timeout = {busyTimeoutMs};";
            command.ExecuteNonQuery();

            command.CommandText = $"PRAGMA analysis_limit = {AnalysisLimit};";
            command.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to configure SQLite PRAGMA settings on connection");
        }
    }
}
