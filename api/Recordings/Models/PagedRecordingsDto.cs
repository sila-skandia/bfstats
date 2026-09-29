namespace api.Recordings.Models;

/// <summary>A page of the feed. Each item is a card (features/replay-feed, "Rounds"): a
/// recording on its own, or a round of several carried by its lead with
/// <see cref="RecordingSummaryDto.RoundCard"/>. <see cref="TotalCount"/> counts the cards the
/// feed shows, <see cref="RecordingCount"/> the recordings on them.</summary>
public record PagedRecordingsDto(
    IReadOnlyList<RecordingSummaryDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages,
    RecordingStorageDto Storage,
    int RecordingCount = 0);
