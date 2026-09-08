using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Text.Json.Serialization;
using api.ImageStorage;

namespace api.MapDossiers;

public interface IMapDossierResolver
{
    /// <summary>
    /// Resolves a bflist (gameId, mapName) pair to a path relative to the dossier folder,
    /// or null when the map has no dossier.
    /// </summary>
    string? Resolve(string gameId, string mapName);

    /// <summary>
    /// The mod content inheritance chain for a gameId, most specific first
    /// (e.g. ["fhsw", "fh", "bf1942"]). Empty when the mod is unknown.
    /// </summary>
    IReadOnlyList<string> SearchPath(string gameId);
}

/// <summary>
/// Resolves the per-map battle intel extracted from a Battlefield 1942 installation.
///
/// Addressing matches <see cref="MapImageResolver"/> exactly — a server's gameId and
/// mapName, lowercased, with spaces folded back to the underscores the level folder uses.
/// The same two traps apply: bflist reports mods in inconsistent case, and mods inherit
/// levels from their parents, so an FHSW server can report a base-game map.
/// </summary>
public class MapDossierResolver(ILogger<MapDossierResolver> logger) : IMapDossierResolver
{
    private static readonly TimeSpan ManifestRecheckInterval = TimeSpan.FromMinutes(5);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly Lock gate = new();
    private DossierManifest? manifest;
    private DateTime lastLoadUtc = DateTime.MinValue;
    private DateTime manifestWriteTimeUtc = DateTime.MinValue;

    public string? Resolve(string gameId, string mapName)
    {
        if (string.IsNullOrWhiteSpace(gameId) || string.IsNullOrWhiteSpace(mapName))
            return null;

        var normalizedGame = Normalize(gameId);
        var normalizedMap = NormalizeMap(mapName);

        var loaded = LoadManifest();
        if (loaded is null)
        {
            // No manifest: probe the direct path only, with no inheritance to fall back on.
            var direct = Path.Combine(normalizedGame, normalizedMap + ".json");
            return File.Exists(Path.Combine(TournamentImagesConfig.ResolveDossiersPath(), direct))
                ? direct
                : null;
        }

        if (!loaded.Mods.TryGetValue(normalizedGame, out var mod))
            return null;

        var searchPath = mod.SearchPath.Count > 0 ? mod.SearchPath : [normalizedGame];
        foreach (var candidateMod in searchPath)
        {
            if (!loaded.Mods.TryGetValue(candidateMod, out var candidate))
                continue;
            if (!candidate.Maps.Contains(normalizedMap, StringComparer.OrdinalIgnoreCase))
                continue;

            return Path.Combine(candidateMod, normalizedMap + ".json");
        }

        return null;
    }

    public IReadOnlyList<string> SearchPath(string gameId)
    {
        if (string.IsNullOrWhiteSpace(gameId))
            return [];

        var normalizedGame = Normalize(gameId);
        var loaded = LoadManifest();
        if (loaded is null || !loaded.Mods.TryGetValue(normalizedGame, out var mod))
            return [normalizedGame];

        return mod.SearchPath.Count > 0 ? mod.SearchPath : [normalizedGame];
    }

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();

    private static string NormalizeMap(string mapName)
    {
        var trimmed = mapName.Trim();
        if (trimmed.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[..^5];
        return trimmed.ToLowerInvariant().Replace(' ', '_');
    }

    private DossierManifest? LoadManifest()
    {
        lock (gate)
        {
            if (manifest is not null && DateTime.UtcNow - lastLoadUtc < ManifestRecheckInterval)
                return manifest;

            var path = Path.Combine(TournamentImagesConfig.ResolveDossiersPath(), "manifest.json");
            lastLoadUtc = DateTime.UtcNow;

            try
            {
                var info = new FileInfo(path);
                if (!info.Exists)
                {
                    manifest = null;
                    return null;
                }

                // The tree is replaced out-of-band through the filebrowser container, so a
                // regenerated manifest has to be picked up without a restart.
                if (manifest is not null && info.LastWriteTimeUtc == manifestWriteTimeUtc)
                    return manifest;

                using var stream = File.OpenRead(path);
                manifest = JsonSerializer.Deserialize<DossierManifest>(stream, JsonOptions);
                manifestWriteTimeUtc = info.LastWriteTimeUtc;

                logger.LogInformation("Loaded map dossier manifest with {ModCount} mods from {Path}",
                    manifest?.Mods.Count ?? 0, path);
                return manifest;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load map dossier manifest from {Path}", path);
                manifest = null;
                return null;
            }
        }
    }
}

public record DossierManifest
{
    [JsonPropertyName("version")]
    public int Version { get; init; }

    [JsonPropertyName("generated")]
    public string? Generated { get; init; }

    [JsonPropertyName("mods")]
    public Dictionary<string, DossierManifestMod> Mods { get; init; } =
        new(StringComparer.OrdinalIgnoreCase);
}

public record DossierManifestMod
{
    /// <summary>Mod fallback chain, most specific first (e.g. ["fhsw", "fh", "bf1942"]).</summary>
    [JsonPropertyName("searchPath")]
    public List<string> SearchPath { get; init; } = [];

    /// <summary>Level keys this mod ships a dossier for.</summary>
    [JsonPropertyName("maps")]
    public List<string> Maps { get; init; } = [];
}
