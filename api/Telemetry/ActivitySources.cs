using System.Diagnostics;

namespace api.Telemetry;

public static class ActivitySources
{
    private static readonly AsyncLocal<bool> SuppressWrapped = new();

    /// <summary>
    /// While set, <see cref="StartWrapped(string)"/> creates nothing.
    ///
    /// A Wrapped calculation emits ~15 spans, which is exactly what you want when reading one
    /// player's waterfall and useless at 30,000 players — half a million spans buries every
    /// other trace in Seq. The crunch sets this for the per-player work on large runs, leaving
    /// the job-level spans (CrunchAllPlayers, BuildPopulationStats) intact, since those are the
    /// ones that answer "how long did it take".
    ///
    /// AsyncLocal, so it follows the async flow of one crunch worker without affecting
    /// concurrent workers or unrelated requests.
    /// </summary>
    public static bool SuppressWrappedTracing
    {
        get => SuppressWrapped.Value;
        set => SuppressWrapped.Value = value;
    }

    public static Activity? StartWrapped(string name) =>
        SuppressWrapped.Value ? null : Wrapped.StartActivity(name);

    public static Activity? StartWrapped(string name, ActivityKind kind, ActivityContext parentContext) =>
        SuppressWrapped.Value ? null : Wrapped.StartActivity(name, kind, parentContext);

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
    public static readonly ActivitySource Wrapped = new("BfStats.Wrapped");
}
