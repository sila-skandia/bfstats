using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// Two recordings of one round, or two an admin has said are not (features/replay-feed,
/// "Rounds"). The pair is kept once, <see cref="RecordingId"/> the lower id. A round is every
/// recording reached through links that are not <see cref="RecordingRoundLinkKind.Separated"/>,
/// so three recordings are one round when the first matches the second and the second the
/// third, though the first and the third share no moment.
/// </summary>
public class RecordingRoundLink
{
    public int Id { get; set; }

    public int RecordingId { get; set; }

    public int OtherRecordingId { get; set; }

    public RecordingRoundLinkKind Kind { get; set; }

    /// <summary>Where the other recording's <c>t = 0</c> falls on this one's clock
    /// (<c>t_this = t_other + OffsetSeconds</c>); null when nothing measured it.</summary>
    public double? OffsetSeconds { get; set; }

    /// <summary>Keys of every kind paired at the offset (<see cref="RoundMatch.Matched"/>).</summary>
    public int? MatchedKeys { get; set; }

    /// <summary>Player keys paired at the offset (<see cref="RoundMatch.MatchedPlayer"/>).</summary>
    public int? MatchedPlayerKeys { get; set; }

    /// <summary><see cref="RoundMatch.Share"/>.</summary>
    public double? Share { get; set; }

    /// <summary><see cref="RoundMatch.PlayerShare"/>.</summary>
    public double? PlayerShare { get; set; }

    /// <summary>The admin who linked or separated them; null for a detected link.</summary>
    public int? ByUserId { get; set; }

    public Instant CreatedAt { get; set; }

    public Recording Recording { get; set; } = null!;

    public Recording Other { get; set; } = null!;

    /// <summary>The evidence of <paramref name="match"/>, or none. An offset only a match
    /// agrees on: short of one, it is where a few keys happened to line up.</summary>
    public void Measured(RoundMatch? match)
    {
        OffsetSeconds = match is { SameRound: true } ? match.OffsetSeconds : null;
        MatchedKeys = match?.Matched;
        MatchedPlayerKeys = match?.MatchedPlayer;
        Share = match?.Share;
        PlayerShare = match?.PlayerShare;
    }
}
