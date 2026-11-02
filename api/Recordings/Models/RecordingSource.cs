namespace api.Recordings.Models;

/// <summary>
/// Which recorder wrote a recording (features/recording-source), from its header's
/// <c>plus</c>. A server recording comes from the server-side recorder
/// (<c>server-replay-recorder/N</c>, features/server-replay-recorder) and covers every player
/// on the battlefield; a client recording comes from bf42plus in one player's game and covers
/// what that client saw.
/// </summary>
public enum RecordingSource
{
    /// <summary>Not read yet: a row shared before the source was kept, until the file check
    /// (<see cref="api.Recordings.RecordingFileReconciler"/>) reads its header.</summary>
    Unknown = 0,

    /// <summary>bf42plus in a player's game: one player's view.</summary>
    Client = 1,

    /// <summary>The server-side recorder: the whole battlefield.</summary>
    Server = 2,
}
