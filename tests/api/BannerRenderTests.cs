using api.PlayerBanners;
using api.PlayerBanners.Models;
using api.ServerBanners;
using api.ServerBanners.Models;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.tests;

/// <summary>
/// The player and server banners render through ImageSharp.Drawing's canvas (ImageSharp 4):
/// every style, at the widths the API allows, comes out as a PNG of the size asked for, with
/// something drawn on it.
/// </summary>
public sealed class BannerRenderTests
{
    private static readonly BannerFonts Fonts = new();

    private static readonly ServerBannerStats Full = new(
        "*NEW* SiMPLE | BF1942", "1.2.3.4:14567", "Berlin", "conquest", 48, 64, true,
        new ServerBannerTickets("Axis", "Allies", 123, 87),
        new ServerBannerActivity([.. Enumerable.Range(0, 9).Select(i => new ServerBannerActivityBar(i * 4, i == 4, i > 4))]));

    private static readonly ServerBannerStats Empty = new("Quiet", "5.6.7.8:14567", null, null, 0, 32, false, null);

    public static TheoryData<ServerBannerStyle, int> Styles()
    {
        var data = new TheoryData<ServerBannerStyle, int>();
        foreach (var style in Enum.GetValues<ServerBannerStyle>())
        {
            data.Add(style, ServerBannerRenderer.MinWidth);
            data.Add(style, ServerBannerRenderer.MaxWidth);
        }
        return data;
    }

    [Theory]
    [MemberData(nameof(Styles))]
    public async Task A_server_banner_is_a_png_of_the_width_asked_for(ServerBannerStyle style, int width)
    {
        var renderer = new ServerBannerRenderer(Fonts);
        foreach (var stats in new[] { Full, Empty })
        {
            using var image = Image.Load<Rgba32>(await renderer.RenderAsync(stats, style, width));
            Assert.Equal(width, image.Width);
            Assert.Equal((int)MathF.Round(ServerBannerRenderer.DesignHeight * width / (float)ServerBannerRenderer.DesignWidth), image.Height);
            Assert.True(Colours(image) > 20, $"{style} at {width} drew almost nothing");
        }
    }

    [Fact]
    public async Task A_player_banner_is_drawn_over_its_base_at_signature_width()
    {
        using var baseImage = new Image<Rgba32>(1000, 250, new Rgba32(40, 60, 90, 255));
        var bytes = await new BannerRenderer(Fonts).RenderAsync(
            baseImage, new BannerStats("=NDR=Lapu", "MoonGamers.com | Est. 2004", 12345, 67890, 1.87, 432.5));

        using var image = Image.Load<Rgba32>(bytes);
        Assert.Equal(720, image.Width);
        Assert.Equal(180, image.Height);
        // The flat base plus the name, stats, scrim and watermark drawn over it.
        Assert.True(Colours(image) > 20);
    }

    private static int Colours(Image<Rgba32> image)
    {
        var seen = new HashSet<Rgba32>();
        image.ProcessPixelRows(rows =>
        {
            for (var y = 0; y < rows.Height; y += 3)
            {
                foreach (var px in rows.GetRowSpan(y)) seen.Add(px);
            }
        });
        return seen.Count;
    }
}
