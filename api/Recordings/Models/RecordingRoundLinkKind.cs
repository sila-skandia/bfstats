namespace api.Recordings.Models;

/// <summary>How two recordings came to be, or not to be, one round.</summary>
public enum RecordingRoundLinkKind
{
    /// <summary>Their fingerprints matched (<see cref="api.Recordings.RoundMatcher"/>).</summary>
    Detected = 0,

    /// <summary>An admin put them in one round.</summary>
    Linked = 1,

    /// <summary>An admin took them apart: detection never links this pair again.</summary>
    Separated = 2,
}
