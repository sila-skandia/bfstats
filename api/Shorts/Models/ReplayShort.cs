using NodaTime;

namespace api.Shorts.Models;

/// <summary>
/// One Short (features/replay-shorts): a 9:16 clip of a notable kill cut from a shared
/// recording, its video and poster on the recordings volume under <c>shorts/</c>.
/// </summary>
public class ReplayShort
{
    public int Id { get; set; }
    public string Slug { get; set; } = "";
    public string RecordingSlug { get; set; } = "";

    /// <summary>Seconds into the recording.</summary>
    public double KillTime { get; set; }

    public int VictimPid { get; set; }

    /// <summary><c>{recordingSlug}:{killTime:F2}:{victimPid}</c>: one Short per kill.</summary>
    public string Key { get; set; } = "";

    public string Kind { get; set; } = "";
    public string Title { get; set; } = "";
    public string Killer { get; set; } = "";
    public string Victim { get; set; } = "";
    public string Weapon { get; set; } = "";
    public string? KillerVehicle { get; set; }
    public string? VictimVehicle { get; set; }

    /// <summary>Metres from killer to victim.</summary>
    public double Distance { get; set; }

    public double LengthSeconds { get; set; }
    public string Level { get; set; } = "";
    public string Mod { get; set; } = "";
    public long VideoBytes { get; set; }

    /// <summary>The optional HD copy's size (<c>shorts/&lt;slug&gt;.hd.mp4</c>), 0 when there is
    /// none: an action roll's 1080p take beside its 4K one.</summary>
    public long HdVideoBytes { get; set; }

    /// <summary>The optional link copy's size (<c>shorts/&lt;slug&gt;.link.mp4</c>), 0 when there
    /// is none: a small 720p take for whatever unfurls the share link. Discord shows a linked
    /// video over about 50 MB as a bare link, and a roll's 4K is 300-480 MB (2026-11-12).</summary>
    public long LinkVideoBytes { get; set; }
    public long PosterBytes { get; set; }
    public Instant CreatedAt { get; set; }

    /// <summary><see cref="CreatedAt"/> in Unix milliseconds: ExtendedIso strings vary in their
    /// fractional digits and do not sort, so the week's window is read off this.</summary>
    public long CreatedAtMs { get; set; }

    public int Views { get; set; }

    /// <summary>When retention took it down for want of views (<c>POST /stats/shorts/prune</c>),
    /// null while it is live. A pruned row is a tombstone: its files are gone and its sizes 0,
    /// every read leaves it out, but <c>/stats/shorts/keys</c> still names its key, so the
    /// nightly render job does not film that kill again.</summary>
    public Instant? PrunedAt { get; set; }

    /// <summary>The signed-in player who shared it from the studio, and his linked in-game
    /// name; null for the render job's (features/replay-shorts, "Creators share").</summary>
    public int? CreatorUserId { get; set; }
    public string? CreatorName { get; set; }

    /// <summary>The players it is about: its killer and every man killed in it.</summary>
    public List<ReplayShortPlayer> Players { get; set; } = [];
}
