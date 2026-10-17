namespace api.Recordings.Models;

/// <summary>What a <see cref="RecordingTally"/> counts.</summary>
public enum RecordingTallyKind
{
    /// <summary>The cards in the whole feed.</summary>
    Cards = 0,

    /// <summary>The recordings in the whole feed.</summary>
    Recordings = 1,

    /// <summary>The cards with a recording made on the server named.</summary>
    Server = 2,

    /// <summary>The cards with a recording shared by the player named.</summary>
    Uploader = 3,
}
