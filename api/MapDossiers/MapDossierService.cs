using Microsoft.Extensions.Logging;
using System.Text.Json;
using api.ImageStorage;
using api.MapDossiers.Models;

namespace api.MapDossiers;

public interface IMapDossierService
{
    /// <summary>
    /// Loads the dossier for a live server's map, or null when the map has none.
    /// </summary>
    Task<MapDossier?> GetAsync(string gameId, string mapName, CancellationToken cancellationToken = default);
}

/// <summary>
/// Serves the map dossiers, finishing two jobs the extractor cannot do on its own.
///
/// It points each arsenal entry at the in-game icon for that machine, walking the mod's
/// content inheritance chain the way the engine does so an FHSW map that fields a
/// base-game Sherman gets the base game's art.
///
/// It also drops the entries that are not materiel at all. A level's spawner list is
/// full of scripting and scenery objects — FHSW alone places thousands of "killercage"
/// boundary markers — and the reliable tell is an object the game classifies nowhere
/// under Vehicles or Stationary_Weapons *and* ships no icon for.
/// </summary>
public class MapDossierService(
    IMapDossierResolver resolver,
    ILogger<MapDossierService> logger) : IMapDossierService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private static readonly string[] IconKinds = ["vehicles", "weapons"];

    /// <summary>Nations the game files the Axis kit art under.</summary>
    private static readonly HashSet<string> AxisNations =
        new(StringComparer.OrdinalIgnoreCase) { "ger", "jp", "ita", "fin" };

    private static readonly TimeSpan IconIndexTtl = TimeSpan.FromMinutes(10);

    // A map fields a few dozen machines and a mod chain is up to three deep, so probing
    // the filesystem per entry would be hundreds of stat calls per request. The icon set
    // is ~2700 files that only change when the asset tree is replaced, so listing each
    // directory once and holding the names is far cheaper.
    private readonly Lock iconGate = new();
    private readonly Dictionary<string, HashSet<string>> iconIndex = new(StringComparer.Ordinal);
    private DateTime iconIndexLoadedUtc = DateTime.MinValue;

    public async Task<MapDossier?> GetAsync(string gameId, string mapName,
        CancellationToken cancellationToken = default)
    {
        var relativePath = resolver.Resolve(gameId, mapName);
        if (relativePath is null)
            return null;

        var fullPath = Path.Combine(TournamentImagesConfig.ResolveDossiersPath(), relativePath);

        MapDossier? dossier;
        try
        {
            await using var stream = File.OpenRead(fullPath);
            dossier = await JsonSerializer.DeserializeAsync<MapDossier>(
                stream, JsonOptions, cancellationToken);
        }
        catch (Exception ex)
        {
            // The manifest said this map has a dossier, so a read failure is a real fault
            // in the asset tree rather than an ordinary miss. Degrade to "no dossier"
            // instead of failing the page that asked for it.
            logger.LogError(ex, "Failed to read map dossier {Path} for {GameId}/{MapName}",
                fullPath, gameId, mapName);
            return null;
        }

        if (dossier is null)
            return null;

        var searchPath = resolver.SearchPath(gameId);
        return dossier with
        {
            Arsenal = ResolveArsenal(dossier.Arsenal, searchPath),
            Teams = [.. dossier.Teams.Select(team => team with
            {
                Kits = ResolveKits(team, searchPath),
            })],
        };
    }

    private List<MapDossierArsenalEntry> ResolveArsenal(
        IReadOnlyList<MapDossierArsenalEntry> arsenal, IReadOnlyList<string> searchPath)
    {
        var resolved = new List<MapDossierArsenalEntry>(arsenal.Count);

        foreach (var entry in arsenal)
        {
            var iconPath = FindIcon(searchPath, entry.Icon);
            if (iconPath is null && entry.Category == "unknown")
                continue;

            resolved.Add(entry with { IconPath = iconPath });
        }

        return resolved;
    }

    /// <summary>
    /// Points each kit at the best art available to this mod.
    ///
    /// Mods file kit icons two different ways. bf1918 names them after the kit template,
    /// which matches directly. Everyone else — including the base game — names them by
    /// role and side ("assaultaxis"), so that is the fallback. Walking the search path
    /// means DC Final, which ships no kit art of its own, picks up Desert Combat's
    /// modern kits rather than the base game's 1942 ones.
    /// </summary>
    private List<MapDossierKit> ResolveKits(MapDossierTeam team, IReadOnlyList<string> searchPath)
    {
        var side = SideOf(team);
        var resolved = new List<MapDossierKit>(team.Kits.Count);

        foreach (var kit in team.Kits)
        {
            var iconPath = FindIcon(searchPath, kit.Icon, "kits");
            if (iconPath is null && kit.Role is not null)
            {
                // The art is filed under "antitank" where the level says "at".
                var role = kit.Role == "at" ? "antitank" : kit.Role;
                iconPath = FindIcon(searchPath, role + side, "kits");
            }

            resolved.Add(kit with { IconPath = iconPath });
        }

        return resolved;
    }

    private static string SideOf(MapDossierTeam team)
    {
        if (team.Nation is not null)
            return AxisNations.Contains(team.Nation) ? "axis" : "allies";

        // No nation to go on: Refractor's convention is team 1 Axis, team 2 Allied.
        return team.Index == 1 ? "axis" : "allies";
    }

    private string? FindIcon(IReadOnlyList<string> searchPath, string icon,
        params string[] kinds)
    {
        if (string.IsNullOrWhiteSpace(icon))
            return null;

        var wanted = kinds.Length > 0 ? kinds : IconKinds;
        foreach (var mod in searchPath)
        {
            foreach (var kind in wanted)
            {
                if (IconNames(kind, mod).Contains(icon))
                    return $"{kind}/{mod}/{icon}.png";
            }
        }

        return null;
    }

    private HashSet<string> IconNames(string kind, string mod)
    {
        lock (iconGate)
        {
            if (DateTime.UtcNow - iconIndexLoadedUtc > IconIndexTtl)
            {
                iconIndex.Clear();
                iconIndexLoadedUtc = DateTime.UtcNow;
            }

            var key = $"{kind}/{mod}";
            if (iconIndex.TryGetValue(key, out var cached))
                return cached;

            var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var directory = Path.Combine(TournamentImagesConfig.ResolveHudPath(), kind, mod);
            try
            {
                if (Directory.Exists(directory))
                {
                    foreach (var file in Directory.EnumerateFiles(directory, "*.png"))
                        names.Add(Path.GetFileNameWithoutExtension(file));
                }
            }
            catch (Exception ex)
            {
                // An unreadable icon directory costs the arsenal its pictures, not the
                // dossier itself, so cache the empty result and carry on.
                logger.LogWarning(ex, "Could not list HUD icons in {Directory}", directory);
            }

            iconIndex[key] = names;
            return names;
        }
    }
}
