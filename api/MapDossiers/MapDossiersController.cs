using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using api.MapDossiers.Models;

namespace api.MapDossiers;

/// <summary>
/// Public endpoint for the battle intel extracted from the game's own level archives.
/// No authentication required — this is game data, not user data.
/// </summary>
[ApiController]
[Route("stats/maps")]
public class MapDossiersController(IMapDossierService dossierService) : ControllerBase
{
    /// <summary>
    /// Get the dossier for a map, addressed the way bflist reports it:
    /// /stats/maps/{gameId}/{mapName}/dossier. Map names may be given with spaces or
    /// underscores and in any case ("fhsw/Operation Coronet-1946" works). Falls back
    /// through the mod's inherited content path, so a map that only ships with a parent
    /// mod still resolves.
    /// </summary>
    /// <param name="gameId">bflist gameId, e.g. "bf1942", "dc_final", "fhsw"</param>
    /// <param name="mapName">bflist mapName, e.g. "wake", "battle of the bulge"</param>
    [HttpGet("{gameId}/{mapName}/dossier")]
    // Level configuration only changes when the asset tree is replaced, so a stale copy
    // is harmless and the round trip is worth saving outright.
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    [ProducesResponseType<MapDossier>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetDossier(string gameId, string mapName,
        CancellationToken cancellationToken)
    {
        var dossier = await dossierService.GetAsync(gameId, mapName, cancellationToken);
        if (dossier is null)
            return NotFound(new { error = "No dossier for this map" });

        return Ok(dossier);
    }
}
