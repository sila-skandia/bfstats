namespace api.Recordings;

/// <summary>
/// The vanilla game and its two expansion packs, Road to Rome (<c>xpack1</c>) and Secret
/// Weapons (<c>xpack2</c>), are one game for recordings. A server rotating vanilla and pack
/// levels reports <c>bf1942</c> on a pack level, and a recording begun mid-round, whose level
/// is recognised by its flags, goes up as the pack it was found in: either way the same round
/// can carry any of the three ids (features/replay-feed, "Levels not in the viewer yet").
/// </summary>
public static class RecordingMods
{
    public static readonly IReadOnlyList<string> Vanilla = ["bf1942", "xpack1", "xpack2"];

    /// <summary>The ids a recording of <paramref name="mod"/> may share a round with.</summary>
    public static List<string> SameGame(string mod) => Vanilla.Contains(mod) ? [.. Vanilla] : [mod];

    public static bool AreSameGame(string a, string b) => a == b || (Vanilla.Contains(a) && Vanilla.Contains(b));
}
