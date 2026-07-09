using NodaTime;

namespace api.Data.Entities;

/// <summary>
/// Pre-computed or computed-on-demand cached Player Wrapped data.
/// Kept as JSON to avoid redundant CPU/DB intensive queries on demand.
/// </summary>
public class PlayerWrappedCache
{
    public required string PlayerName { get; set; }
    public required string ServerGuid { get; set; } // "global" for cross-server
    public int Year { get; set; }
    public required string JsonData { get; set; }
    public Instant CalculatedAt { get; set; }
}
