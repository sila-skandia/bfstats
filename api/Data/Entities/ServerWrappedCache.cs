using NodaTime;

namespace api.Data.Entities;

/// <summary>
/// Pre-computed and cached Server Wrapped data for a given year.
/// Helps avoid crunching heavy aggregates on every API request.
/// </summary>
public class ServerWrappedCache
{
    public required string ServerGuid { get; set; }
    public int Year { get; set; }
    public required string JsonData { get; set; }
    public Instant CalculatedAt { get; set; }
}
