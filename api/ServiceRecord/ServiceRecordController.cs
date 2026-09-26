using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using api.Caching;
using api.ServiceRecord.Models;

namespace api.ServiceRecord;

/// <summary>
/// A player's service record: every army they fought for, named from the map's own level
/// files, with the soldier, kits and motor pool to draw it.
/// </summary>
[ApiController]
[Route("stats/players")]
public class ServiceRecordController(IServiceRecordService serviceRecordService) : ControllerBase
{
    /// <summary>
    /// /stats/players/{playerName}/service-record. 404 when the player does not exist; a
    /// player with nothing attributable still gets a record, with no armies.
    /// </summary>
    [HttpGet("{playerName}/service-record")]
    // Rebuilt at most hourly behind Redis; the edge absorbs repeat views for ten minutes
    // without pinning a stale copy in the visitor's browser.
    [EdgeCache(600)]
    [ProducesResponseType<PlayerServiceRecord>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> GetServiceRecord(string playerName, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return BadRequest(new { error = "Player name is required" });

        // Route values keep %2F and friends escaped; decode the rest the way the other
        // player endpoints do, preserving '+'.
        playerName = Uri.UnescapeDataString(playerName);

        var record = await serviceRecordService.GetAsync(playerName, cancellationToken);
        if (record is null)
            return NotFound(new { error = "Player not found" });

        return Ok(record);
    }
}
