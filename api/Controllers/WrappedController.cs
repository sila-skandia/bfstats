using api.Wrapped;
using api.Wrapped.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.Threading.Tasks;

namespace api.Controllers;

[ApiController]
[Route("stats/[controller]")]
public class WrappedController(
    IWrappedService wrappedService,
    ILogger<WrappedController> logger) : ControllerBase
{
    /// <summary>
    /// Retrieves the Server Wrapped 2026 statistics for a given server.
    /// Access is restricted to users with the Admin role.
    /// </summary>
    [Authorize(Policy = "Admin")]
    [HttpGet("server/{serverGuid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status403Forbidden)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<ServerWrappedResponseDto>> GetServerWrapped(string serverGuid, [FromQuery] int year = 2026)
    {
        logger.LogInformation("Retrieving Server Wrapped statistics for GUID: {ServerGuid}, Year: {Year} (Admin Only)", serverGuid, year);
        
        try
        {
            var response = await wrappedService.GetServerWrappedAsync(serverGuid, year);
            if (response == null)
            {
                logger.LogWarning("Server Wrapped data for GUID {ServerGuid} not found", serverGuid);
                return NotFound(new { error = $"Server Wrapped data for GUID {serverGuid} could not be found." });
            }

            return Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to retrieve Server Wrapped statistics for GUID {ServerGuid}", serverGuid);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Retrieves the Global Player Wrapped statistics for a given player.
    /// </summary>
    [HttpGet("player/{playerName}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlayerWrappedResponseDto>> GetGlobalPlayerWrapped(string playerName, [FromQuery] int year = 2026)
    {
        logger.LogInformation("Retrieving Global Player Wrapped statistics for {PlayerName}, Year: {Year}", playerName, year);
        
        try
        {
            var response = await wrappedService.GetPlayerWrappedAsync(playerName, "global", year);
            if (response == null)
            {
                logger.LogWarning("Global Player Wrapped data for player {PlayerName} not found", playerName);
                return NotFound(new { error = $"Global Player Wrapped data for player {playerName} could not be found." });
            }

            return Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to retrieve Global Player Wrapped statistics for player {PlayerName}", playerName);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Retrieves the Server-Specific Player Wrapped statistics for a given player.
    /// </summary>
    [HttpGet("player/{playerName}/{serverGuid}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PlayerWrappedResponseDto>> GetServerPlayerWrapped(string playerName, string serverGuid, [FromQuery] int year = 2026)
    {
        logger.LogInformation("Retrieving Server-Specific Player Wrapped statistics for {PlayerName}, Server: {ServerGuid}, Year: {Year}", playerName, serverGuid, year);
        
        try
        {
            var response = await wrappedService.GetPlayerWrappedAsync(playerName, serverGuid, year);
            if (response == null)
            {
                logger.LogWarning("Server-Specific Player Wrapped data for player {PlayerName} on server {ServerGuid} not found", playerName, serverGuid);
                return NotFound(new { error = $"Server-Specific Player Wrapped data for player {playerName} on server {serverGuid} could not be found." });
            }

            return Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to retrieve Server-Specific Player Wrapped statistics for player {PlayerName} on server {ServerGuid}", playerName, serverGuid);
            return StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message });
        }
    }
}
