namespace api.ServerBanners;

public interface IServerBannerService
{
    /// <summary>
    /// Renders a live server signature banner as PNG bytes. Player count, current map,
    /// and live team tickets are read fresh on every call — no caching, by design.
    /// </summary>
    /// <param name="showTickets">
    /// When true (default) the renderer shows the live Axis-vs-Allies ticket scoreboard
    /// if the BFList feed has ticket data for this server.
    /// </param>
    /// <returns>PNG bytes, or null if the server name does not match a tracked server.</returns>
    Task<byte[]?> RenderAsync(
        string serverName,
        ServerBannerStyle style,
        bool showTickets = true,
        CancellationToken cancellationToken = default);
}
