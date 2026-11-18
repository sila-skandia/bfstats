using api.Dogfights.Models;
using api.Recordings;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;

namespace api.Dogfights;

/// <summary>
/// Recorded fights for bfstats.io's server and player pages (features/dogfights-on-stats-pages):
/// the dogfight school's list (features/dogfight-recordings), narrowed to a server or a pilot.
/// Public, open to any origin, as the recordings' feed is.
/// </summary>
[ApiController]
[Route("stats/dogfights")]
public class DogfightsController(IDogfightService dogfights) : ControllerBase
{
    [HttpGet]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<PagedDogfightsDto>> List(
        [FromQuery] string? server = null, [FromQuery] string? player = null, [FromQuery] string? kind = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = DogfightService.DefaultPageSize, CancellationToken ct = default) =>
        Ok(await dogfights.ListAsync(server, player, kind, page, pageSize, ct));
}
