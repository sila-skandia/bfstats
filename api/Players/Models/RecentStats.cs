namespace api.Players.Models;

// Lifetime time-series trend analysis for player performance.
// Bucket granularity adapts to the span covered so the chart stays readable
// even for veterans with years of history.
public class RecentStats
{
    public DateTime AnalysisPeriodStart { get; set; }
    public DateTime AnalysisPeriodEnd { get; set; }
    public int TotalRoundsAnalyzed { get; set; }

    // "daily" | "weekly" | "monthly"
    public string Granularity { get; set; } = "daily";

    // Time series data for K/D ratio and kill rate trends
    public List<TrendDataPoint> KdRatioTrend { get; set; } = new();
    public List<TrendDataPoint> KillRateTrend { get; set; } = new();
}
