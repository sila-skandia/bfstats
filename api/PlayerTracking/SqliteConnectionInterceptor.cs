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

    /// <summary>Page cache per connection, in KiB (negative = KiB rather than pages).</summary>
    private const int CacheSizeKib = 262_144; // 256 MiB

    /// <summary>Bytes of the database to memory-map, avoiding a read() + copy per page.</summary>
    private const long MmapSizeBytes = 1L * 1024 * 1024 * 1024; // 1 GiB

    private void ConfigureConnection(DbConnection connection)
    {
        try
        {
            using var command = connection.CreateCommand();

            // Set busy_timeout - wait for locks instead of failing immediately with SQLITE_BUSY
            command.CommandText = $"PRAGMA busy_timeout = {busyTimeoutMs};";
            command.ExecuteNonQuery();

            // The default 2 MiB page cache is thrashed by the whole-table aggregate scans behind
            // stats/leaderboards/Wrapped, so every repeat scan pays full I/O again.
            command.CommandText = $"PRAGMA cache_size = -{CacheSizeKib};";
            command.ExecuteNonQuery();

            // GROUP BY / ORDER BY that can't be satisfied by an index build a temp b-tree, which
            // otherwise spills to a temp file on disk.
            command.CommandText = "PRAGMA temp_store = MEMORY;";
            command.ExecuteNonQuery();

            command.CommandText = $"PRAGMA mmap_size = {MmapSizeBytes};";
            command.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to configure SQLite PRAGMA settings on connection");
        }
    }
}
