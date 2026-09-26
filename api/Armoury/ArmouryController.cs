using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using api.Armoury.Models;

namespace api.Armoury;

/// <summary>
/// Public endpoint for the armies each map fields, drawn from the game's own level files and
/// the mesh site's extracted soldiers. No authentication required — this is game data.
/// </summary>
[ApiController]
[Route("stats/armoury")]
public class ArmouryController(IArmouryService armouryService) : ControllerBase
{
    /// <summary>
    /// The two armies of a map, addressed the way bflist reports it:
    /// /stats/armoury/maps/{gameId}/{mapName}. Resolves through the mod's inherited content
    /// the way the dossier endpoint does.
    /// </summary>
    /// <param name="gameId">bflist gameId, e.g. "bf1942", "xpack2", "eod"</param>
    /// <param name="mapName">bflist mapName, e.g. "wake", "battle of the bulge"</param>
    [HttpGet("maps/{gameId}/{mapName}")]
    // Built from level configuration and the asset tree, both of which only change when the
    // asset volume is republished — the same trade the dossier endpoint makes.
    [ResponseCache(Duration = 86400, Location = ResponseCacheLocation.Any)]
    [ProducesResponseType<MapArmies>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetMapArmies(string gameId, string mapName,
        CancellationToken cancellationToken)
    {
        var armies = await armouryService.GetMapArmiesAsync(gameId, mapName, cancellationToken);
        if (armies is null)
            return NotFound(new { error = "No dossier for this map" });

        return Ok(armies);
    }
}
