using api.Signatures;

namespace api.ServerBanners;

public interface IServerBannerService
{
    /// <summary>
    /// Renders a live server signature as PNG bytes: the server's live map, player count and
    /// (optionally) tickets over a posed hero from the chosen mod's models, with the current
    /// map's loading screen behind. Player count is the collector's stored
    /// <c>CurrentNumPlayers</c>; map and tickets are read fresh on every call.
    /// </summary>
    /// <param name="modId">The mod whose art to draw (<c>fhsw</c>); null for the server's own.</param>
    /// <param name="scene">The mod's scene (<c>armour</c>); null for its first.</param>
    /// <param name="width">Output width; the height keeps the 4:1 design. Clamped to
    /// <see cref="SignatureCanvas.MinWidth"/>..<see cref="SignatureCanvas.MaxWidth"/>.</param>
    /// <returns>PNG bytes, or null if the server name does not match a tracked server.</returns>
    Task<byte[]?> RenderAsync(
        string serverName,
        string? modId,
        string? scene,
        bool showTickets = true,
        int width = SignatureCanvas.DefaultWidth,
        CancellationToken cancellationToken = default);
}
