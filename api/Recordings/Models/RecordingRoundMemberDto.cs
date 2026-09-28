namespace api.Recordings.Models;

/// <summary>
/// One recording of a round, as a card or a recording's page lists the round
/// (features/replay-feed, "Rounds"). <see cref="RoundOffsetSeconds"/> is where its
/// <c>t = 0</c> falls on the round's clock, the clock of the recording that began first, when
/// the links measured it. <see cref="Link"/> is how it is tied to the recording asked about:
/// <c>detected</c>, <c>linked</c> by an admin, <c>self</c>, or null when it is tied through
/// another; <see cref="MatchedKeys"/> and <see cref="PlayerShare"/> are that link's evidence.
/// </summary>
public record RecordingRoundMemberDto(
    string Slug,
    string Title,
    string UploaderName,
    string? UploaderPlayer,
    string RecordedBy,
    double DurationSeconds,
    double? RoundOffsetSeconds,
    string RecordingUrl,
    string? ServerLogUrl,
    string? ThumbnailUrl,
    string? Link,
    int? MatchedKeys,
    double? PlayerShare);
