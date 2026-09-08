namespace api.ImageStorage;

/// <summary>
/// Centralized configuration for tournament images path resolution
/// Single source of truth for both static file serving and image indexing
/// </summary>
public static class TournamentImagesConfig
{
    /// <summary>
    /// Resolves the base assets storage path from environment variable
    /// Must be configured via ASSETS_STORAGE_PATH environment variable in production
    /// </summary>
    public static string ResolveBasePath()
    {
        var assetPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");

        if (string.IsNullOrWhiteSpace(assetPath))
        {
            // Fallback for local development
            assetPath = Path.Combine(Directory.GetCurrentDirectory(), "assets");
        }

        // Convert to absolute path if relative
        return Path.GetFullPath(assetPath);
    }

    /// <summary>
    /// Resolves the path to tournament-specific images (under tournaments/ subfolder)
    /// </summary>
    public static string ResolveTournamentsPath()
    {
        return Path.Combine(ResolveBasePath(), "tournaments");
    }

    /// <summary>
    /// Resolves the path to BF1942 map preview images (under maps/ subfolder),
    /// laid out as maps/&lt;gameId&gt;/&lt;mapName&gt;.png
    /// </summary>
    public static string ResolveMapsPath()
    {
        return Path.Combine(ResolveBasePath(), "maps");
    }

    /// <summary>
    /// Resolves the path to the per-map battle intel extracted from the game's level
    /// archives (under dossiers/), laid out as dossiers/&lt;gameId&gt;/&lt;mapName&gt;.json
    /// </summary>
    public static string ResolveDossiersPath()
    {
        return Path.Combine(ResolveBasePath(), "dossiers");
    }

    /// <summary>
    /// Resolves the path to the in-game HUD icon set (under hud/), which holds the
    /// vehicle and weapon icons the dossiers reference as hud/vehicles/&lt;mod&gt;/&lt;key&gt;.png
    /// </summary>
    public static string ResolveHudPath()
    {
        return Path.Combine(ResolveBasePath(), "hud");
    }

    /// <summary>
    /// Legacy method for backward compatibility - returns tournaments path
    /// </summary>
    public static string ResolvePath() => ResolveTournamentsPath();
}
