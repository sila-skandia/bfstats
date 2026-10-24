namespace api.Recordings.Models;

/// <summary>One pass of <see cref="api.Recordings.IRecordingStatsRoundService.BackfillAsync"/>:
/// the recordings looked at, and how many of them a round was found for.</summary>
public sealed record RecordingStatsRoundBackfillResult(int Checked, int Matched);
