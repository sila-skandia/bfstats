using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// What the feed's card for a round of several recordings shows of the whole round
/// (features/replay-feed, "Rounds"). <see cref="Recordings"/> is how many of its recordings are
/// in the feed; <see cref="DurationSeconds"/> the merged span, from the first to begin to the
/// last to end, where the links measured where each began; <see cref="Uploaders"/> everyone
/// who shared one, in round order; <see cref="ViewCount"/> the most-watched recording's (a
/// merged watch counts on every recording, so a sum would count it once for each);
/// <see cref="CommentCount"/> all of theirs; <see cref="CreatedAt"/> when the newest was
/// shared; <see cref="ThumbnailUrl"/> a recording's own cover, the lead's first, or null for the
/// level's art. <see cref="Weak"/>: the round holds together only through an admin's link its
/// recordings do not bear out.
/// </summary>
public record RecordingRoundCardDto(
    int Recordings,
    double DurationSeconds,
    IReadOnlyList<string> Uploaders,
    int ViewCount,
    int CommentCount,
    Instant CreatedAt,
    string? ThumbnailUrl,
    bool Weak);
