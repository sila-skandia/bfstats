using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// A shared recording's round fingerprint (<see cref="RoundFingerprint"/>), kept so that the
/// other recordings of its round are found from the database alone: its file is never read
/// again to compare it. A few thousand keys at most, eight bytes each.
/// </summary>
public class RecordingFingerprint
{
    /// <summary>Raised when what goes into a fingerprint changes: every recording's is read
    /// again from its file, in the background.</summary>
    public const int CurrentVersion = 1;

    public int RecordingId { get; set; }

    public int Version { get; set; }

    public int KeyCount { get; set; }

    public int PlayerKeyCount { get; set; }

    /// <summary><see cref="RoundFingerprint.PlayerSample"/>.</summary>
    public long PlayerSample { get; set; }

    /// <summary><see cref="RoundFingerprint.ObjectSample"/>.</summary>
    public long ObjectSample { get; set; }

    public double LiveFromSeconds { get; set; }

    public double LiveToSeconds { get; set; }

    /// <summary><see cref="RoundFingerprint.PackKeys"/>.</summary>
    public byte[] Keys { get; set; } = [];

    /// <summary>The settings (<see cref="api.Recordings.RecordingsOptions.RoundSettings"/>)
    /// this recording was last compared with the others under; '' for never.</summary>
    public string RoundsChecked { get; set; } = "";

    public Instant CreatedAt { get; set; }

    public Recording Recording { get; set; } = null!;

    public RoundFingerprint Read() => new(
        RoundFingerprint.UnpackKeys(Keys),
        (uint)Math.Clamp(PlayerSample, 0, RoundFingerprint.Everything),
        (uint)Math.Clamp(ObjectSample, 0, RoundFingerprint.Everything),
        LiveFromSeconds,
        LiveToSeconds);

    public static RecordingFingerprint From(RoundFingerprint fingerprint, Instant now) => new()
    {
        Version = CurrentVersion,
        KeyCount = fingerprint.Keys.Count,
        PlayerKeyCount = fingerprint.PlayerKeyCount,
        PlayerSample = fingerprint.PlayerSample,
        ObjectSample = fingerprint.ObjectSample,
        LiveFromSeconds = Math.Round(fingerprint.LiveFromSeconds, 3),
        LiveToSeconds = Math.Round(fingerprint.LiveToSeconds, 3),
        Keys = fingerprint.PackKeys(),
        CreatedAt = now,
    };

    /// <summary>This row made to hold <paramref name="fingerprint"/>, as read again.</summary>
    public void Replace(RoundFingerprint fingerprint, Instant now)
    {
        var fresh = From(fingerprint, now);
        Version = fresh.Version;
        KeyCount = fresh.KeyCount;
        PlayerKeyCount = fresh.PlayerKeyCount;
        PlayerSample = fresh.PlayerSample;
        ObjectSample = fresh.ObjectSample;
        LiveFromSeconds = fresh.LiveFromSeconds;
        LiveToSeconds = fresh.LiveToSeconds;
        Keys = fresh.Keys;
        RoundsChecked = "";
        CreatedAt = now;
    }
}
