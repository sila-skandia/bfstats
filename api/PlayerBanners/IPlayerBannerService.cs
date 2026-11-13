namespace api.PlayerBanners;

public interface IPlayerBannerService
{
    /// <summary>Renders a player's forum signature as PNG bytes.</summary>
    /// <param name="playerName">Exact player name.</param>
    /// <param name="modId">The mod whose models draw the hero; null for BF1942.</param>
    /// <param name="scene">The mod's scene; null for its first.</param>
    /// <param name="serverGuid">When provided, stats are scoped to that server; otherwise lifetime.</param>
    /// <returns>PNG bytes, or null if the player has no stats.</returns>
    Task<byte[]?> RenderAsync(
        string playerName,
        string? modId,
        string? scene,
        string? serverGuid,
        int width,
        CancellationToken cancellationToken = default);
}
