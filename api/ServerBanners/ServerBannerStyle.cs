using api.PlayerBanners;
using SixLabors.ImageSharp;

namespace api.ServerBanners;

/// <summary>
/// The four futuristic server-signature art treatments, all rendered on the shared
/// Neutral Depth (v4) palette. Each differs only in the left art panel; the data
/// column (name, count, map, IP, live tickets) is identical across styles.
/// </summary>
public enum ServerBannerStyle
{
    Reticle,
    Hologram,
    Waveform,
    Console
}

public static class ServerBannerStyleExtensions
{
    public static bool TryParse(string? input, out ServerBannerStyle style)
    {
        if (Enum.TryParse(input, ignoreCase: true, out ServerBannerStyle parsed))
        {
            style = parsed;
            return true;
        }
        style = ServerBannerStyle.Reticle;
        return false;
    }

    /// <summary>
    /// All four styles share the Neutral Depth palette (muted olive accent, amber busy
    /// tint). Only <see cref="ServerBannerPalette.Tint"/> shifts slightly per style to
    /// colour the backdrop glow toward each art treatment's mood.
    /// </summary>
    public static ServerBannerPalette Palette(this ServerBannerStyle style)
    {
        var tint = style switch
        {
            ServerBannerStyle.Reticle  => BannerColor.Rgba(14, 16, 9, 255),
            ServerBannerStyle.Hologram => BannerColor.Rgba(12, 17, 7, 255),
            ServerBannerStyle.Waveform => BannerColor.Rgba(13, 14, 8, 255),
            ServerBannerStyle.Console  => BannerColor.Rgba(12, 14, 8, 255),
            _                          => BannerColor.Rgba(14, 16, 9, 255)
        };

        return new ServerBannerPalette(
            Accent: BannerColor.Rgba(154, 166, 102, 255),   // --mm-accent-soft (olive)
            Secondary: BannerColor.Rgba(125, 163, 76, 255), // --mm-success (allies green)
            Tint: tint);
    }
}

/// <summary>
/// Per-style colour triad. Accent drives the art linework + brand wordmark; Secondary
/// is the allies/team-2 green; Tint is the darkest gradient stop — a dim olive-biased
/// black that subtly colours the backdrop without washing out the foreground text.
/// </summary>
public readonly record struct ServerBannerPalette(Color Accent, Color Secondary, Color Tint);
