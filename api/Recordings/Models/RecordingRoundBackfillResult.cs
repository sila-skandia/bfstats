namespace api.Recordings.Models;

/// <summary>One pass of <see cref="api.Recordings.IRecordingRoundService.BackfillAsync"/>: the
/// recordings whose fingerprints were read from their files, those whose files could not be
/// read, those compared with the others, and the new links that made.</summary>
public sealed record RecordingRoundBackfillResult(int Read, int Failed, int Compared, int Linked);
