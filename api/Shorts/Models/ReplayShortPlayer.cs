namespace api.Shorts.Models;

/// <summary>A player a Short is about (the owner, 2026-11-04: "capture the player featured in the
/// short ... and allow that to be a filter"): its killer, and every man killed in it, a
/// compilation's many. <see cref="Name"/> is the raw stored name, as <c>Player.Name</c> is.</summary>
public class ReplayShortPlayer
{
    public long Id { get; set; }
    public int ShortId { get; set; }
    public string Name { get; set; } = "";

    /// <summary><see cref="ShortPlayerRoles.Killer"/> or <see cref="ShortPlayerRoles.Victim"/>.</summary>
    public string Role { get; set; } = "";

    public ReplayShort Short { get; set; } = null!;
}
