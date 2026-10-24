using System.Globalization;
using System.Text.RegularExpressions;
using api.Recordings.Models;

namespace api.Recordings;

/// <summary>
/// Which bfstats.io round a shared recording is of (features/recording-stats-round). A
/// recording names its server and level, and when it began on the recording PC's own clock,
/// which says no zone; bfstats.io keeps the server's rounds in UTC with the players it saw in
/// each. So the candidates are the server's rounds of the level that any zone could put the
/// recording in, and the round is the one whose players the recording has, by a wide margin:
/// the same level comes round again on the same server within a day, often with many of the
/// same regulars. The zone the recording fits the round in, when only one does, ties the
/// recording's clock to the round's (a round report's moment opens the replay at it).
/// </summary>
public static partial class StatsRoundMatcher
{
    /// <summary>Raised when the rules below change, so every recording is looked at again.</summary>
    public const int Version = 1;

    /// <summary>Zones are whole quarter hours (UTC+5:45 among them) from UTC-12 to UTC+14.</summary>
    public const int ZoneStepMinutes = 15;

    public const int WestmostZoneMinutes = -12 * 60;

    public const int EastmostZoneMinutes = 14 * 60;

    /// <summary>The longest round looked back for: a recording begun late in a long round
    /// still finds it.</summary>
    public static readonly TimeSpan LongestRound = TimeSpan.FromHours(6);

    /// <summary>How far a recording may run past its round's edges. bfstats.io sees a round
    /// begin and end on its next poll of BFList, up to a minute late, and a PC's clock can be
    /// a minute or two out.</summary>
    public static readonly TimeSpan Slack = TimeSpan.FromMinutes(5);

    /// <summary>A recording with no start in its header is looked for among the rounds this
    /// long before it was shared, by its players alone.</summary>
    public static readonly TimeSpan UndatedLookback = TimeSpan.FromDays(3);

    /// <summary>The round must have at least this share of the players the smaller of the two
    /// lists has. bfstats.io misses players who stay a minute or less, and a recording sees bots
    /// BFList does not list, so the two never agree whole; a matched round on the live site
    /// shares 72% to 100%, the next best at most 24% (features/recording-stats-round).</summary>
    public const double MinShare = 0.4;

    /// <summary>A second round with this share of the best one's matched players makes the
    /// match too close to call, and the recording is left unmatched.</summary>
    public const double CloseCall = 0.6;

    private static readonly string[] LocalFormats =
        ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm"];

    [GeneratedRegex("[^a-z0-9]", RegexOptions.CultureInvariant)]
    private static partial Regex NotLetterOrDigit();

    /// <summary>The header's start, as written (no zone), or null when it has none.</summary>
    public static DateTime? ParseLocal(string recordedLocal) =>
        DateTime.TryParseExact(recordedLocal, LocalFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var local)
            ? DateTime.SpecifyKind(local, DateTimeKind.Unspecified)
            : null;

    /// <summary>A level as bfstats.io and a recording both name it: <c>battle_of_britain</c>
    /// and <c>Battle of Britain</c> are <c>battleofbritain</c>.</summary>
    public static string LevelKey(string name) => NotLetterOrDigit().Replace(name.ToLowerInvariant(), "");

    /// <summary>The span of round starts (UTC) a recording's round can have begun in: every
    /// zone's reading of its header, back by <see cref="LongestRound"/>, and never after it was
    /// shared.</summary>
    public static (DateTime From, DateTime To) Window(DateTime? local, DateTime sharedUtc)
    {
        if (local is not { } start) return (sharedUtc - UndatedLookback, sharedUtc);
        var from = start.AddMinutes(-EastmostZoneMinutes) - LongestRound;
        var to = start.AddMinutes(-WestmostZoneMinutes) + Slack;
        return (DateTime.SpecifyKind(from, DateTimeKind.Utc), DateTime.SpecifyKind(to < sharedUtc ? to : sharedUtc, DateTimeKind.Utc));
    }

    /// <summary>
    /// The zones (UTC offsets, minutes) that put a recording of <paramref name="durationSeconds"/>
    /// begun at <paramref name="local"/> inside <paramref name="round"/>: it begins no earlier
    /// than the round, and ends by the round's end and before it was shared, each give or take
    /// <see cref="Slack"/>. A round still running ends, for this, when the recording was shared.
    /// </summary>
    public static List<int> Zones(DateTime local, double durationSeconds, DateTime sharedUtc, StatsRoundCandidate round)
    {
        var duration = TimeSpan.FromSeconds(Math.Max(0, durationSeconds));
        var roundEnd = round.EndUtc ?? sharedUtc;
        var zones = new List<int>();
        for (var zone = WestmostZoneMinutes; zone <= EastmostZoneMinutes; zone += ZoneStepMinutes)
        {
            var start = local.AddMinutes(-zone);
            var end = start + duration;
            if (start >= round.StartUtc - Slack && end <= roundEnd + Slack && end <= sharedUtc + Slack) zones.Add(zone);
        }
        return zones;
    }

    /// <summary>
    /// The round a recording is of among <paramref name="candidates"/> (its server's rounds of
    /// its level in <see cref="Window"/>), or null when none is clearly it. A round the
    /// recording cannot fit in under any zone is out; of the rest, the one sharing the most
    /// players wins, if it shares <see cref="MinShare"/> of them and no other comes within
    /// <see cref="CloseCall"/> of it. The zone is the one that fits, or, when several do (a
    /// recording begun mid-round), the one <paramref name="zoneHints"/> (the zones the
    /// uploader's other recordings came out in) name most, else none.
    /// </summary>
    public static StatsRoundPick? Pick(
        DateTime? local,
        double durationSeconds,
        DateTime sharedUtc,
        int recordingPlayers,
        IReadOnlyCollection<StatsRoundCandidate> candidates,
        IReadOnlyCollection<int> zoneHints)
    {
        var fitting = candidates
            .Select(c => (Round: c, Zones: local is { } start ? Zones(start, durationSeconds, sharedUtc, c) : []))
            .Where(c => local is null || c.Zones.Count > 0)
            .Where(c => c.Round.Matched > 0)
            .OrderByDescending(c => c.Round.Matched)
            .ThenBy(c => c.Round.RoundId, StringComparer.Ordinal)
            .ToList();
        if (fitting.Count == 0) return null;
        var (best, zones) = fitting[0];
        if (best.Matched < MinShare * Math.Min(recordingPlayers, best.Players)) return null;
        if (fitting.Count > 1 && fitting[1].Round.Matched >= CloseCall * best.Matched) return null;
        return new StatsRoundPick(best.RoundId, Zone(zones, zoneHints), best.Matched);
    }

    private static int? Zone(List<int> zones, IReadOnlyCollection<int> hints)
    {
        if (zones.Count == 1) return zones[0];
        var named = hints.Where(zones.Contains).GroupBy(z => z).Select(g => (Zone: g.Key, Count: g.Count()))
            .OrderByDescending(z => z.Count).ToList();
        if (named.Count == 0 || (named.Count > 1 && named[1].Count == named[0].Count)) return null;
        return named[0].Zone;
    }
}
