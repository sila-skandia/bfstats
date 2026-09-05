using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace api.ImageStorage;

public interface IMapImageResolver
{
    /// <summary>
    /// Resolves a bflist (gameId, mapName) pair to a path relative to the maps asset folder,
    /// or null when no image exists for that map.
    /// </summary>
    string? Resolve(string gameId, string mapName, MapImageKind kind);
}

public enum MapImageKind
{
    Thumbnail,
    Minimap
}

/// <summary>
/// Resolves map preview images extracted from a Battlefield 1942 installation.
///
/// bflist reports a server's map as gameId + mapName (e.g. "fhsw" + "operation coronet-1946").
/// Images are stored as maps/&lt;gameId&gt;/&lt;map_name&gt;.png, so the lookup key is the map name
/// lowercased with spaces turned back into the underscores the level folder uses.
///
/// A mod inherits content from the mods it declares in init.con (FHSW -> FH -> BF1942), so a
/// server can legitimately report a map that only ships with a parent mod. manifest.json records
/// each mod's search path and which images exist, letting a miss walk the same chain the game does.
/// </summary>
public class MapImageResolver(ILogger<MapImageResolver> logger) : IMapImageResolver
{
    private static readonly TimeSpan ManifestRecheckInterval = TimeSpan.FromMinutes(5);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly Lock _gate = new();
    private MapManifest? _manifest;
    private DateTime _lastLoadUtc = DateTime.MinValue;
    private DateTime _manifestWriteTimeUtc = DateTime.MinValue;

    public string? Resolve(string gameId, string mapName, MapImageKind kind)
    {
        if (string.IsNullOrWhiteSpace(gameId) || string.IsNullOrWhiteSpace(mapName))
            return null;

        var normalizedGame = gameId.Trim().ToLowerInvariant();
        var normalizedMap = mapName.Trim().ToLowerInvariant().Replace(' ', '_');
        var suffix = kind == MapImageKind.Minimap ? ".map.png" : ".png";

        var manifest = LoadManifest();
        if (manifest is null)
        {
            // No manifest: probe the direct path only, no inheritance information available.
            var direct = Path.Combine(normalizedGame, normalizedMap + suffix);
            return File.Exists(Path.Combine(TournamentImagesConfig.ResolveMapsPath(), direct)) ? direct : null;
        }

        if (!manifest.Mods.TryGetValue(normalizedGame, out var mod))
            return null;

        var wanted = kind == MapImageKind.Minimap ? "minimap" : "thumbnail";
        var searchPath = mod.SearchPath.Count > 0 ? mod.SearchPath : [normalizedGame];

        foreach (var candidateMod in searchPath)
        {
            if (!manifest.Mods.TryGetValue(candidateMod, out var candidate))
                continue;
            if (!candidate.Maps.TryGetValue(normalizedMap, out var kinds))
                continue;
            if (!kinds.Contains(wanted))
                continue;

            return Path.Combine(candidateMod, normalizedMap + suffix);
        }

        return null;
    }

    private MapManifest? LoadManifest()
    {
        lock (_gate)
        {
            if (_manifest is not null && DateTime.UtcNow - _lastLoadUtc < ManifestRecheckInterval)
                return _manifest;

            var path = Path.Combine(TournamentImagesConfig.ResolveMapsPath(), "manifest.json");
            _lastLoadUtc = DateTime.UtcNow;

            try
            {
                var info = new FileInfo(path);
                if (!info.Exists)
                {
                    _manifest = null;
                    return null;
                }

                // Assets are replaced out-of-band through the filebrowser container, so pick up
                // a regenerated manifest without needing a restart.
                if (_manifest is not null && info.LastWriteTimeUtc == _manifestWriteTimeUtc)
                    return _manifest;

                using var stream = File.OpenRead(path);
                _manifest = JsonSerializer.Deserialize<MapManifest>(stream, JsonOptions);
                _manifestWriteTimeUtc = info.LastWriteTimeUtc;

                logger.LogInformation("Loaded map image manifest with {ModCount} mods from {Path}",
                    _manifest?.Mods.Count ?? 0, path);
                return _manifest;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load map image manifest from {Path}", path);
                _manifest = null;
                return null;
            }
        }
    }
}

public record MapManifest
{
    [JsonPropertyName("version")]
    public int Version { get; init; }

    [JsonPropertyName("generated")]
    public string? Generated { get; init; }

    [JsonPropertyName("mods")]
    public Dictionary<string, MapManifestMod> Mods { get; init; } =
        new(StringComparer.OrdinalIgnoreCase);
}

public record MapManifestMod
{
    /// <summary>Mod fallback chain, most specific first (e.g. ["fhsw", "fh", "bf1942"]).</summary>
    [JsonPropertyName("searchPath")]
    public List<string> SearchPath { get; init; } = [];

    /// <summary>Map key to the image kinds available for it ("thumbnail", "minimap").</summary>
    [JsonPropertyName("maps")]
    public Dictionary<string, List<string>> Maps { get; init; } =
        new(StringComparer.OrdinalIgnoreCase);
}
