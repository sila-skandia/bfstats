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
    /// <param name="width">
    /// Output PNG width in pixels (height follows the locked 960x200 aspect). The banner is
    /// authored at 960x200 and painted crisply at 1:1 for the requested size — larger widths
    /// read bigger and stay sharp on high-DPI / 4K displays, smaller widths fit forums that
    /// cap signature dimensions. Clamped to
    /// <see cref="ServerBannerRenderer.MinWidth"/>..<see cref="ServerBannerRenderer.MaxWidth"/>.
    /// </param>
    /// <returns>PNG bytes, or null if the server name does not match a tracked server.</returns>
    Task<byte[]?> RenderAsync(
        string serverName,
        ServerBannerStyle style,
        bool showTickets = true,
        int width = ServerBannerRenderer.DefaultWidth,
        CancellationToken cancellationToken = default);
}
