using System.Globalization;

namespace api.Shorts;

/// <summary>What a Short can be of, and the key that makes it one per kill.</summary>
public static class ShortKinds
{
    public const string AirToAir = "air-to-air";
    /// <summary>A tank's shell into a plane (the owner, 2026-11-10: the rarest shot there is).</summary>
    public const string TankToAir = "tank-to-air";
    public const string GroundToAir = "ground-to-air";
    public const string TankToTank = "tank-to-tank";
    /// <summary>A man on foot who kills a tank.</summary>
    public const string TankBuster = "tank-buster";
    public const string LongShot = "long-shot";
    /// <summary>A man killed by nobody but himself: a crash, a fall, his own charge.</summary>
    public const string OwnGoal = "own-goal";
    /// <summary>A man killed within seconds of spawning.</summary>
    public const string SpawnDeath = "spawn-death";
    /// <summary>A player's kill streak in one life, its best kills in order.</summary>
    public const string Streak = "streak";
    /// <summary>A round's best-sounding fire, over the shooter's shoulder at 1x.</summary>
    public const string Asmr = "asmr";
    /// <summary>A clip a creator cut in the studio and shared.</summary>
    public const string Creator = "creator";
    public const string Other = "other";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        AirToAir, TankToAir, GroundToAir, TankToTank, TankBuster, LongShot, OwnGoal, SpawnDeath, Streak, Asmr, Creator, Other,
    };

    /// <summary><c>{recordingSlug}:{killTime:F2}:{victimPid}</c>, the same on every machine.</summary>
    public static string Key(string recordingSlug, double killTime, int victimPid) =>
        string.Create(CultureInfo.InvariantCulture, $"{recordingSlug}:{killTime:F2}:{victimPid}");
}
