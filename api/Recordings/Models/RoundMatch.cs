namespace api.Recordings.Models;

/// <summary>
/// Two fingerprints compared (<see cref="api.Recordings.RoundMatcher"/>): the offset most of
/// their shared keys agree on, <c>t_first = t_second + OffsetSeconds</c>, and what agrees
/// there. <see cref="Matched"/> counts every key paired at that offset,
/// <see cref="MatchedPlayer"/> the player keys among them; each share is of the fewer keys
/// either recording has in the stretch both cover. <see cref="SameRound"/> is the verdict.
/// </summary>
public sealed record RoundMatch(
    double OffsetSeconds,
    int Matched,
    int MatchedPlayer,
    double Share,
    double PlayerShare,
    double OverlapSeconds,
    bool SameRound)
{
    public static readonly RoundMatch None = new(0, 0, 0, 0, 0, 0, false);
}
