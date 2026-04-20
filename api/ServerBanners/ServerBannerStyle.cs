using SixLabors.ImageSharp;

namespace api.ServerBanners;

public enum ServerBannerStyle
{
    Grid,
    Hud,
    Scanline,
    Circuit
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
        style = ServerBannerStyle.Grid;
        return false;
    }

    public static ServerBannerPalette Palette(this ServerBannerStyle style) => style switch
    {
        ServerBannerStyle.Grid     => new(Accent: Color.FromRgba(255, 196, 0, 255),  Secondary: Color.FromRgba(61, 220, 132, 255), Tint: Color.FromRgba(18, 14, 2, 255)),
        ServerBannerStyle.Hud      => new(Accent: Color.FromRgba(61, 220, 132, 255), Secondary: Color.FromRgba(255, 196, 0, 255),  Tint: Color.FromRgba(6, 18, 12, 255)),
        ServerBannerStyle.Scanline => new(Accent: Color.FromRgba(120, 220, 255, 255),Secondary: Color.FromRgba(255, 196, 0, 255),  Tint: Color.FromRgba(6, 12, 22, 255)),
        ServerBannerStyle.Circuit  => new(Accent: Color.FromRgba(215, 120, 255, 255),Secondary: Color.FromRgba(61, 220, 132, 255), Tint: Color.FromRgba(14, 6, 22, 255)),
        _                          => new(Accent: Color.FromRgba(255, 196, 0, 255),  Secondary: Color.FromRgba(61, 220, 132, 255), Tint: Color.FromRgba(18, 14, 2, 255))
    };
}

/// <summary>
/// Per-style colour triad. Accent drives the hero name + overlay linework; Secondary
/// is the stats-row value colour (kept neon-green by default on most styles for the
/// "HUD readout" feel); Tint is the darkest gradient stop — a very dim accent-biased
/// black that subtly colours the backdrop without washing out the text.
/// </summary>
public readonly record struct ServerBannerPalette(Color Accent, Color Secondary, Color Tint);
