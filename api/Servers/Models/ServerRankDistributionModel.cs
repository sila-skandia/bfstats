namespace api.Servers.Models;

/// <summary>
/// Response for paged server player rankings.
/// </summary>
public class ServerPlayerRankingsResponse
{
    public string ServerGuid { get; set; } = "";
    public string ServerName { get; set; } = "";
    public int Days { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalCount { get; set; }
    public int TotalPages { get; set; }
    public string SortBy { get; set; } = "active";
    public int MinRounds { get; set; }
    public List<ServerPlayerRankingItem> Rankings { get; set; } = new();
}

/// <summary>
/// Individual player ranking entry on a server.
/// </summary>
public class ServerPlayerRankingItem
{
    public int Rank { get; set; }
    public string PlayerName { get; set; } = "";
    public int MinutesPlayed { get; set; }
    public int TotalKills { get; set; }
    public int TotalDeaths { get; set; }
    public double KdRatio { get; set; }
    public double KillRate { get; set; }
    public int TotalScore { get; set; }
    public int TotalRounds { get; set; }
    public int FirstPlaces { get; set; }
    public int SecondPlaces { get; set; }
    public int ThirdPlaces { get; set; }
    public int TotalPlacements { get; set; }
    public int PlacementPoints { get; set; }
}

/// <summary>
/// Response for server rank distributions across performance metrics.
/// </summary>
public class ServerRankDistributionResponse
{
    public string ServerGuid { get; set; } = "";
    public string ServerName { get; set; } = "";
    public int Days { get; set; }
    public int MinRounds { get; set; }
    public int TotalPlayers { get; set; }

    public MetricDistribution KdDistribution { get; set; } = new();
    public MetricDistribution ScoreDistribution { get; set; } = new();
    public MetricDistribution KillsDistribution { get; set; } = new();
    public MetricDistribution PlayTimeDistribution { get; set; } = new();
    public MetricDistribution KillRateDistribution { get; set; } = new();
}

/// <summary>
/// Distribution statistics and histogram bands for a specific metric.
/// </summary>
public class MetricDistribution
{
    public string MetricName { get; set; } = "";
    public double Average { get; set; }
    public double Median { get; set; }
    public double P75 { get; set; }
    public double P90 { get; set; }
    public double P95 { get; set; }
    public double P99 { get; set; }
    public double Min { get; set; }
    public double Max { get; set; }
    public List<DistributionBand> Bands { get; set; } = new();
}

/// <summary>
/// Frequency band bucket in a distribution histogram.
/// </summary>
public class DistributionBand
{
    public string Label { get; set; } = "";
    public double MinValue { get; set; }
    public double? MaxValue { get; set; }
    public int Count { get; set; }
    public double Percentage { get; set; }
}
