namespace api.Recordings.Models;

/// <summary>
/// What two recordings' fingerprints say of their being one round, for an admin about to link
/// them (features/replay-feed, "Rounds"): the keys paired at the offset most of them agree
/// on, the players' own among them, those as a share of the fewer either recording has where
/// both recorded, and that stretch. <see cref="Measured"/> is false while either has no
/// fingerprint yet. <see cref="OneRound"/> is detection's verdict by <see cref="MinMatches"/>,
/// <see cref="MinPlayerKeys"/> and <see cref="MinPlayerShare"/>, and false for two recordings
/// of different levels or game types whatever the keys say (<see cref="SameLevel"/>).
/// <see cref="Summary"/> says it in a line.
/// </summary>
public record RecordingRoundEvidenceDto(
    bool Measured,
    int MatchedKeys,
    int MatchedPlayerKeys,
    double PlayerShare,
    double OverlapSeconds,
    bool SameLevel,
    bool OneRound,
    int MinMatches,
    int MinPlayerKeys,
    double MinPlayerShare,
    string Summary);
