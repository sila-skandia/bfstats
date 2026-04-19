namespace api.PlayerBanners;

public interface IPlayerBannerService
{
    /// <summary>
    /// Renders a player signature banner as PNG bytes.
    /// </summary>
    /// <param name="playerName">Exact player name.</param>
    /// <param name="style">Which base banner background to use.</param>
    /// <param name="serverGuid">Optional — when provided, stats are filtered to that server. Otherwise lifetime stats across all servers.</param>
    /// <returns>PNG bytes, or null if the player has no stats.</returns>
    Task<byte[]?> RenderAsync(
        string playerName,
        BannerStyle style,
        string? serverGuid,
        CancellationToken cancellationToken = default);
}
