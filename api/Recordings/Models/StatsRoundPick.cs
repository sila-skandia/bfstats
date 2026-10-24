namespace api.Recordings.Models;

/// <summary>The bfstats.io round a recording is of, the recording PC's UTC offset in minutes
/// when one zone alone fits it, and how many players the two share.</summary>
public sealed record StatsRoundPick(string RoundId, int? ZoneMinutes, int Matched);
