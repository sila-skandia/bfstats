using Microsoft.AspNetCore.Mvc;

namespace api.ImageStorage;

/// <summary>
/// Public endpoints for serving assets (images, files, etc.)
/// No authentication required - safe for public distribution
/// Supports multiple asset types through different routes
/// </summary>
[ApiController]
[Route("stats/assets")]
public class AssetsController(
    IAssetServingService assetServingService,
    IMapImageResolver mapImageResolver) : ControllerBase
{
    /// <summary>
    /// Get a tournament asset file by relative path
    /// Path should be relative to the tournaments folder, e.g., "golden-gun/map1.png"
    /// </summary>
    /// <param name="path">Relative path to the asset file within tournaments</param>
    [HttpGet("tournaments/{*path}")]
    public async Task<IActionResult> GetTournamentAsset(string path)
    {
        var basePath = TournamentImagesConfig.ResolveTournamentsPath();
        var result = await assetServingService.GetAssetAsync(basePath, path);
        return HandleAssetResult(result);
    }

    /// <summary>
    /// Get a player asset file by relative path
    /// Path should be relative to the players folder, e.g., "some-player/avatar.png"
    /// </summary>
    /// <param name="path">Relative path to the asset file within players</param>
    [HttpGet("players/{*path}")]
    public async Task<IActionResult> GetPlayerAsset(string path)
    {
        var basePath = Path.Combine(TournamentImagesConfig.ResolveBasePath(), "players");
        var result = await assetServingService.GetAssetAsync(basePath, path);
        return HandleAssetResult(result);
    }

    /// <summary>
    /// Spawn-screen maps for Field Lore theater recon.
    /// Path is relative to the arcade folder, e.g. "maps/wake/ingame.webp".
    /// </summary>
    [HttpGet("arcade/{*path}")]
    public async Task<IActionResult> GetArcadeAsset(string path)
    {
        var basePath = Path.Combine(TournamentImagesConfig.ResolveBasePath(), "arcade");
        var result = await assetServingService.GetAssetAsync(basePath, path);
        return HandleAssetResult(result);
    }

    /// <summary>
    /// In-game HUD icons, class badges, and loading animation frames.
    /// Path is relative to the hud folder, e.g. "classes/assault.png".
    /// </summary>
    [HttpGet("hud/{*path}")]
    public async Task<IActionResult> GetHudAsset(string path)
    {
        var basePath = Path.Combine(TournamentImagesConfig.ResolveBasePath(), "hud");
        var result = await assetServingService.GetAssetAsync(basePath, path);
        return HandleAssetResult(result);
    }

    /// <summary>
    /// Full-resolution theater loading artwork.
    /// Path is relative to the theaters folder, e.g. "pacific.webp".
    /// </summary>
    [HttpGet("theaters/{*path}")]
    public async Task<IActionResult> GetTheaterAsset(string path)
    {
        var basePath = Path.Combine(TournamentImagesConfig.ResolveBasePath(), "theaters");
        var result = await assetServingService.GetAssetAsync(basePath, path);
        return HandleAssetResult(result);
    }

    /// <summary>
    /// 3D WebGL models in binary glTF (.glb) format.
    /// Path is relative to the models folder, e.g. "tiger.glb".
    /// </summary>
    [HttpGet("models/{*path}")]
    public async Task<IActionResult> GetModelAsset(string path)
    {
        var basePath = Path.Combine(TournamentImagesConfig.ResolveBasePath(), "models");
        var result = await assetServingService.GetAssetAsync(basePath, path);
        return HandleAssetResult(result);
    }

    /// <summary>
    /// Get the preview image for a map, addressed the way bflist reports it:
    /// /stats/assets/maps/{gameId}/{mapName}. Map names may be given with spaces or
    /// underscores and in any case ("fhsw/Operation Coronet-1946" works).
    /// Falls back through the mod's inherited content path, so a map that only ships
    /// with a parent mod still resolves.
    /// </summary>
    /// <param name="gameId">bflist gameId, e.g. "bf1942", "dc_final", "fhsw"</param>
    /// <param name="mapName">bflist mapName, e.g. "wake", "battle of the bulge"</param>
    /// <param name="kind">"thumbnail" (default, 128x128 preview) or "minimap" (512x512 in-game map)</param>
    [HttpGet("maps/{gameId}/{mapName}")]
    public async Task<IActionResult> GetMapImage(string gameId, string mapName,
        [FromQuery] string kind = "thumbnail")
    {
        if (!Enum.TryParse<MapImageKind>(kind, ignoreCase: true, out var imageKind))
            return BadRequest(new { error = "kind must be 'thumbnail' or 'minimap'" });

        // A caller may pass the filename form ("wake.png") or the raw map name ("wake").
        if (mapName.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            mapName = mapName[..^4];

        var relativePath = mapImageResolver.Resolve(gameId, mapName, imageKind);
        if (relativePath is null)
            return NotFound(new { error = "No image for this map" });

        var basePath = TournamentImagesConfig.ResolveMapsPath();
        var result = await assetServingService.GetAssetAsync(basePath, relativePath);
        return HandleAssetResult(result);
    }

    private IActionResult HandleAssetResult(AssetResult result)
    {
        if (!result.IsSuccess)
        {
            return result.StatusCode switch
            {
                400 => BadRequest(new { error = result.ErrorMessage }),
                403 => Forbid(),
                404 => NotFound(new { error = result.ErrorMessage }),
                500 => StatusCode(500, new { error = result.ErrorMessage }),
                _ => StatusCode(result.StatusCode, new { error = result.ErrorMessage })
            };
        }

        return File(result.FileStream!, result.ContentType!, result.FileName, enableRangeProcessing: true);
    }
}
