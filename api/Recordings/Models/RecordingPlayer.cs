namespace api.Recordings.Models;

/// <summary>
/// A player seen in a recording's round, bots included (features/replay-on-stats-pages): the
/// index a player's page finds the rounds they played in by. <see cref="PlayerName"/> is as
/// the recording wrote it, each byte as U+0000 to U+00FF; a name as bfstats.io has it is
/// looked up through <see cref="api.Utils.PlayerNameDecoder.ToRecording"/>. The same names
/// are in <see cref="Recording.PlayersJson"/>, in the order the round met them.
/// </summary>
public class RecordingPlayer
{
    public int RecordingId { get; set; }

    public string PlayerName { get; set; } = "";

    public Recording Recording { get; set; } = null!;
}
