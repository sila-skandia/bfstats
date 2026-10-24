namespace api.Recordings.Models;

/// <summary>
/// A bfstats.io round a recording might be of (<see cref="api.Recordings.StatsRoundMatcher"/>):
/// on its server, of its level, begun within any time zone's reach of its header. Times are
/// UTC, as the rounds are kept. <see cref="EndUtc"/> is null while the round runs.
/// <see cref="Players"/> is how many players bfstats.io saw in it, <see cref="Matched"/> how
/// many of them the recording has.
/// </summary>
public sealed record StatsRoundCandidate(
    string RoundId,
    DateTime StartUtc,
    DateTime? EndUtc,
    int Players,
    int Matched);
