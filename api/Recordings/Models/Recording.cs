using api.PlayerTracking;
using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// A bf42plus round recording someone shared to the REPLAY feed (features/replay-feed).
/// The file itself is <c>&lt;Slug&gt;.ndjson.gz</c> in the recordings directory, with its
/// server log beside it as <c>&lt;Slug&gt;.xml.gz</c> when one came with it.
/// </summary>
public class Recording
{
    public int Id { get; set; }

    /// <summary>The public id: in its links and its file names. Ten characters, lower case.</summary>
    public string Slug { get; set; } = "";

    public string Title { get; set; } = "";

    public int UploaderUserId { get; set; }

    /// <summary>The linked player name the uploader shared it as.</summary>
    public string UploaderName { get; set; } = "";

    /// <summary>The level's folder, lower case (<c>midway</c>): the recording's SetLevel, or the
    /// level the uploader's browser recognised by its flags for a file begun mid-round.</summary>
    public string Level { get; set; } = "";

    /// <summary>The viewer's mod id, lower case (<c>bf1942</c>, <c>xpack1</c>).</summary>
    public string Mod { get; set; } = "";

    /// <summary>The game type, from the mode file (<c>conquest.con</c> is <c>conquest</c>).</summary>
    public string GameMode { get; set; } = "";

    public string ServerName { get; set; } = "";

    /// <summary>The in-game name of the player whose client recorded the round.</summary>
    public string RecordedBy { get; set; } = "";

    /// <summary>The header's <c>start</c>: the recording PC's own clock, which names no zone
    /// (<c>2026-09-27T20:34:59</c>), kept as written.</summary>
    public string RecordedLocal { get; set; } = "";

    public double DurationSeconds { get; set; }

    /// <summary>Players seen in the round, bots included.</summary>
    public int PlayerCount { get; set; }

    /// <summary>JSON array of the round's player names, for the detail page.</summary>
    public string PlayersJson { get; set; } = "[]";

    /// <summary>The recorder's format version, the header's <c>v</c>.</summary>
    public int FormatVersion { get; set; }

    /// <summary>Bytes on disk: the gzipped recording.</summary>
    public long RecordingBytes { get; set; }

    /// <summary>The recording's size before compression.</summary>
    public long RecordingRawBytes { get; set; }

    /// <summary>Bytes on disk of the gzipped server log, 0 without one.</summary>
    public long ServerLogBytes { get; set; }

    /// <summary>Bytes on disk of the cover, a JPEG frame of the replay; 0 without one (the
    /// feed draws the level's loading screen instead).</summary>
    public long ThumbnailBytes { get; set; }

    /// <summary>SHA-256 of the uncompressed recording, hex: the same round shared twice is one entry.</summary>
    public string ContentHash { get; set; } = "";

    public int ViewCount { get; set; }

    public int CommentCount { get; set; }

    /// <summary>The file was not on disk when the API last looked (the host's root volume is
    /// not backed up): the recording leaves the feed until the same file is shared again.</summary>
    public bool FileMissing { get; set; }

    public Instant CreatedAt { get; set; }

    public Instant UpdatedAt { get; set; }

    /// <summary>The round it is one recording of, with the others found to be (features/replay-feed,
    /// "Rounds"): the lowest id among them. Null while it is the only one.</summary>
    public int? RoundId { get; set; }

    public User Uploader { get; set; } = null!;
}
