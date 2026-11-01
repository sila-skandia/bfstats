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

    /// <summary>
    /// Returns the collection of mods recognized/installed in manifest.json (or the maps directory).
    /// </summary>
    IReadOnlyCollection<string> GetKnownMods();
}

public enum MapImageKind
{
    Thumbnail,
    Minimap,

    /// <summary>
    /// The level's loading screen, shrunk to 640px for use as a dimmed page backdrop.
    /// Stored as &lt;mod&gt;/&lt;map&gt;.load.webp and found on disk rather than through
    /// manifest.json (features/map-loading-art).
    /// </summary>
    Loading
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

    public IReadOnlyCollection<string> GetKnownMods()
    {
        var manifest = LoadManifest();
        if (manifest is not null)
            return manifest.Mods.Keys;

        var mapsPath = TournamentImagesConfig.ResolveMapsPath();
        if (Directory.Exists(mapsPath))
        {
            return Directory.GetDirectories(mapsPath)
                .Select(Path.GetFileName)
                .Where(name => !string.IsNullOrEmpty(name))
                .ToList()!;
        }

        return Array.Empty<string>();
    }

    public string? Resolve(string gameId, string mapName, MapImageKind kind)
    {
        if (string.IsNullOrWhiteSpace(gameId) || string.IsNullOrWhiteSpace(mapName))
            return null;

        var normalizedGame = gameId.Trim().ToLowerInvariant();
        var normalizedMap = NormalizeMap(mapName);
        var (suffix, wanted) = kind switch
        {
            MapImageKind.Minimap => (".map.png", "minimap"),
            MapImageKind.Loading => (".load.webp", "loading"),
            _ => (".png", "thumbnail")
        };

        var manifest = LoadManifest();
        if (manifest is null)
        {
            // No manifest: probe the direct path only, no inheritance information available.
            var direct = Path.Combine(normalizedGame, normalizedMap + suffix);
            if (File.Exists(Path.Combine(TournamentImagesConfig.ResolveMapsPath(), direct)))
                return direct;

            var mapsPath = TournamentImagesConfig.ResolveMapsPath();
            if (Directory.Exists(mapsPath))
            {
                foreach (var dir in Directory.GetDirectories(mapsPath))
                {
                    var fallback = Path.Combine(Path.GetFileName(dir), normalizedMap + suffix);
                    if (File.Exists(Path.Combine(mapsPath, fallback)))
                        return fallback;
                }
            }
            return null;
        }

        // Try resolving in requested mod's searchPath
        if (manifest.Mods.TryGetValue(normalizedGame, out var mod) ||
            manifest.Mods.TryGetValue(CanonicalizeMod(normalizedGame), out mod))
        {
            var searchPath = mod.SearchPath.Count > 0 ? mod.SearchPath : [normalizedGame];

            foreach (var candidateMod in searchPath)
            {
                if (!manifest.Mods.TryGetValue(candidateMod, out var candidate))
                    continue;
                if (Has(candidateMod, candidate, normalizedMap, kind, suffix, wanted))
                    return Path.Combine(candidateMod, normalizedMap + suffix);
            }
        }

        // If not found in the requested mod (e.g. server rotated mod and reports wrong gameId),
        // ignore the mod and find the first matching mod.
        return FallbackScan(manifest, normalizedMap, kind, suffix, wanted);
    }

    /// <summary>
    /// Whether a mod has this image. Thumbnails and minimaps are listed in manifest.json;
    /// loading screens are published as extra files beside them and never listed, so they
    /// are probed on disk. That keeps a loading-art publish from rewriting the manifest.
    /// </summary>
    private static bool Has(string modName, MapManifestMod mod, string map, MapImageKind kind, string suffix, string wanted)
    {
        if (kind == MapImageKind.Loading)
            return File.Exists(Path.Combine(TournamentImagesConfig.ResolveMapsPath(), modName, map + suffix));
        return mod.Maps.TryGetValue(map, out var kinds) && kinds.Contains(wanted);
    }

    private static string NormalizeMap(string mapName)
    {
        var trimmed = mapName.Trim();
        if (trimmed.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[..^4];
        var lower = trimmed.ToLowerInvariant().Replace(' ', '_');
        return lower switch
        {
            "wake_island" => "wake",
            "huskies" => "husky",
            "santa_croce" => "santo_croce",
            _ => lower
        };
    }

    public static string CanonicalizeMod(string mod) => mod switch
    {
        "fhsweurope" or "sks_fhsw" => "fhsw",
        "dc2" or "dc_extended" or "dc_realism" => "dc_final",
        "desertcombat" => "desertcombat",
        "eodp" => "eod",
        "xmas1918" => "bf1918",
        "battlegroup42" => "bg42",
        "warfront1" => "warfront",
        "bfpirates" => "pirates",
        _ => mod
    };

    private static string? FallbackScan(MapManifest manifest, string normalizedMap, MapImageKind kind, string suffix, string wanted)
    {
        string[] priorityMods = ["bf1942", "xpack1", "xpack2", "dc_final", "desertcombat", "fhsw", "fh", "eod", "bf1918", "gcmod", "interstate", "bg42", "warfront", "finnwars", "pirates", "bfheroes"];
        foreach (var candidateMod in priorityMods)
        {
            if (manifest.Mods.TryGetValue(candidateMod, out var candidate) &&
                Has(candidateMod, candidate, normalizedMap, kind, suffix, wanted))
            {
                return Path.Combine(candidateMod, normalizedMap + suffix);
            }
        }

        foreach (var (modName, candidate) in manifest.Mods)
        {
            if (Has(modName, candidate, normalizedMap, kind, suffix, wanted))
                return Path.Combine(modName, normalizedMap + suffix);
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
