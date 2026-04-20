namespace api.ServerBanners;

public interface IServerBannerService
{
    /// <summary>
    /// Renders a live server signature banner as PNG bytes. Player count and current
    /// map/mode are read fresh on every call — no caching, by design.
    /// </summary>
    /// <returns>PNG bytes, or null if the server name does not match a tracked server.</returns>
    Task<byte[]?> RenderAsync(
        string serverName,
        ServerBannerStyle style,
        CancellationToken cancellationToken = default);
}
