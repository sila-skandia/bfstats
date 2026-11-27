using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.Recordings;

/// <summary>
/// Each game's recordings folder (features/bfv-through-bfstats): BF1942's on the recordings
/// volume, Battlefield Vietnam's on bfv's disk. A recording's files are only ever looked for in
/// its own game's folder.
/// </summary>
public interface IRecordingStores
{
    /// <summary>The folder for <paramref name="game"/>; a 503 the uploader reads when that game
    /// has none set.</summary>
    IRecordingStorage Require(string game);

    /// <summary>The folder for <paramref name="game"/>, or null when it has none.</summary>
    IRecordingStorage? Find(string game);

    /// <summary>Every game that has a folder, with it.</summary>
    IReadOnlyList<(string Game, IRecordingStorage Storage)> All { get; }
}

public sealed class RecordingStores : IRecordingStores
{
    private readonly Dictionary<string, IRecordingStorage> byGame;

    /// <summary>BF1942's folder is the one the rest of the API already uses (<paramref name="bf1942"/>).</summary>
    public RecordingStores(IRecordingStorage bf1942, IOptions<RecordingsOptions> options, ILogger<RecordingStorage>? logger = null)
        : this(bf1942, RecordingStorage.ForBfv(options.Value, logger))
    {
    }

    public RecordingStores(IRecordingStorage bf1942, IRecordingStorage? bfv)
    {
        byGame = new(StringComparer.Ordinal) { [RecordingGames.Bf1942] = bf1942 };
        if (bfv is not null) byGame[RecordingGames.Bfv] = bfv;
        All = [.. byGame.Select(kv => (kv.Key, kv.Value))];
    }

    public IReadOnlyList<(string Game, IRecordingStorage Storage)> All { get; }

    public IRecordingStorage? Find(string game) => byGame.GetValueOrDefault(game);

    public IRecordingStorage Require(string game) =>
        Find(game) ?? throw new RecordingRejectedException(
            game == RecordingGames.Bfv
                ? "bfstats is not taking Battlefield Vietnam recordings just now."
                : "bfstats does not take recordings of that game.",
            StatusCodes.Status503ServiceUnavailable);
}
