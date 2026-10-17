using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.PlayerBanners;

/// <summary>Colour and text measuring shared by the player and server banners.</summary>
internal static class BannerColor
{
    /// <summary>A colour from 8-bit channels (ImageSharp 4 dropped <c>Color.FromRgba</c>).</summary>
    public static Color Rgba(byte r, byte g, byte b, byte a) => Color.FromPixel(new Rgba32(r, g, b, a));

    /// <summary>The size <paramref name="text"/> takes when drawn.</summary>
    public static FontRectangle Measure(string text, TextOptions options) => TextMeasurer.MeasureBounds(text, options);
}
