using api.ServerMedia.Models;

namespace api.ServerMedia;

/// <summary>The landing page's media per server (features/dogfights-on-stats-pages).</summary>
public interface IServerMediaService
{
    /// <summary>Each server with Shorts, replays or dogfights, with up to
    /// <paramref name="perServer"/> (1 to 6) of them to show.</summary>
    Task<ServerMediaListDto> ListAsync(int perServer, CancellationToken ct);
}
