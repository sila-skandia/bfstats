using api.Recordings;
using api.ServerMedia.Models;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;

namespace api.ServerMedia;

/// <summary>
/// The thumbnails beside each server in bfstats.io's landing page list
/// (features/dogfights-on-stats-pages): a few of its Shorts, replays and recorded dogfights,
/// for every server in one answer.
/// </summary>
[ApiController]
[Route("stats/server-media")]
public class ServerMediaController(IServerMediaService media) : ControllerBase
{
    [HttpGet]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<ServerMediaListDto>> List(
        [FromQuery] int perServer = ServerMediaService.DefaultPerServer, CancellationToken ct = default) =>
        Ok(await media.ListAsync(perServer, ct));
}
