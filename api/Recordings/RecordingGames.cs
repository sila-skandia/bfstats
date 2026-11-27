namespace api.Recordings;

/// <summary>
/// Which game a recording is of (features/bfv-through-bfstats). Read from the file's own
/// header, never from anything the uploader sends: a header with no <c>game</c> is BF1942 (every
/// recording shared before 2026-11-27, FHSW and the other mods included, whose <c>Mod</c> tells
/// them apart), <c>"bfv"</c> is Battlefield Vietnam. Each site lists its own game only.
/// </summary>
public static class RecordingGames
{
    public const string Bf1942 = "bf1942";
    public const string Bfv = "bfv";

    /// <summary>Every game the API takes, for a query's <c>game</c>.</summary>
    public static readonly IReadOnlyList<string> All = [Bf1942, Bfv];

    public const int MaxLength = 16;

    /// <summary>The game a query asks for: one of <see cref="All"/>, else BF1942, so a page that
    /// does not say (every bfstats.io page) sees what it always has.</summary>
    public static string FromQuery(string? game) =>
        game?.Trim().ToLowerInvariant() is { } asked && All.Contains(asked) ? asked : Bf1942;
}
