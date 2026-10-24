namespace api.Recordings.Models;

/// <summary>A shared recording of a bfstats.io round, as a list of rounds marks the round
/// recorded (features/recording-stats-round): enough to open its replay on play.bfstats.io.
/// The links are relative to the API's host, as the feed's are. <see cref="Group"/> is the
/// feed's round the recording is in (features/replay-feed, "Rounds"): one group plays merged.</summary>
public record RoundRecordingDto(
    string Slug,
    string Mod,
    string Level,
    double DurationSeconds,
    string RecordingUrl,
    string? ServerLogUrl,
    string? ThumbnailUrl,
    int Group);
