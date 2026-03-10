using System.Diagnostics;

namespace api.Telemetry;

public static class ActivitySources
{
    public static readonly ActivitySource PlayerStats = new("PlayerStats");
    public static readonly ActivitySource Database = new("Database");
    public static readonly ActivitySource BfListApi = new("BfListApi");
    public static readonly ActivitySource Cache = new("Cache");
    public static readonly ActivitySource StatsCollection = new("StatsCollection");
    public static readonly ActivitySource Gamification = new("Gamification");
    public static readonly ActivitySource RankingCalculation = new("RankingCalculation");
    public static readonly ActivitySource AggregateCalculation = new("AggregateCalculation");
    public static readonly ActivitySource SqliteAnalytics = new("BfStats.SqliteAnalytics");
    public static readonly ActivitySource Backfill = new("BfStats.Backfill");
    public static readonly ActivitySource AIChat = new("BfStats.AIChat");
}
