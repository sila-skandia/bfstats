using api.PlayerBanners.Models;
using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace api.PlayerBanners;

/// <summary>
/// Composites a minimal player overlay onto a base banner: prominent player name,
/// a single inline stats row, and a corner watermark. No backing fills — typography
/// alone (white fill with an offset dark drop shadow) carries legibility against
/// varied backdrops.
/// </summary>
public sealed class BannerRenderer(BannerFonts fonts)
{
    // Forum signature width — most BBCode forums cap signature images around 600–800px wide.
    private const int TargetWidth = 720;

    public async Task<byte[]> RenderAsync(Image baseImage, BannerStats stats, CancellationToken ct = default)
    {
        baseImage.Mutate(ctx =>
        {
            if (baseImage.Width != TargetWidth)
            {
                ctx.Resize(new ResizeOptions
                {
                    Mode = ResizeMode.Stretch,
                    Size = new Size(TargetWidth, (int)Math.Round(baseImage.Height * (TargetWidth / (float)baseImage.Width)))
                });
            }
        });

        var width = baseImage.Width;
        var height = baseImage.Height;

        baseImage.Mutate(ctx =>
        {
            DrawStatsScrim(ctx, width, height);
            DrawPlayerName(ctx, stats, width, height);
            DrawServerLine(ctx, stats, width, height);
            DrawStatsLine(ctx, stats, width, height);
            DrawWatermark(ctx, width, height);
        });

        var ms = new MemoryStream();
        await baseImage.SaveAsync(ms, new PngEncoder
        {
            ColorType = PngColorType.RgbWithAlpha,
            CompressionLevel = PngCompressionLevel.BestCompression
        }, ct);
        return ms.ToArray();
    }

    private void DrawPlayerName(IImageProcessingContext ctx, BannerStats stats, int width, int height)
    {
        var nameSize = height * 0.30f;
        var leftEdge = width * 0.03f;

        var font = fonts.Display(nameSize);
        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Center,
            Origin = new PointF(leftEdge, height * 0.30f),
            WrappingLength = width * 0.94f
        };
        // Rusted-gold hero name ties into the brand accent (#ffc400) and reads as the
        // clear focal point above the server subtitle and stats row below.
        DrawTextWithShadow(ctx, stats.PlayerName, options, Color.FromRgba(255, 196, 0, 255), nameSize * 0.045f);
    }

    /// <summary>
    /// Small muted subtitle between the hero name and the stats line that names the server
    /// scope. Long server names often blow past the inline stats row, so they get a dedicated
    /// row where they can occupy the full width.
    /// </summary>
    private void DrawServerLine(IImageProcessingContext ctx, BannerStats stats, int width, int height)
    {
        if (string.IsNullOrWhiteSpace(stats.ServerName))
        {
            return;
        }

        var size = height * 0.115f;
        var leftEdge = width * 0.03f;
        var baseline = height * 0.68f;
        // Display (Roboto-Bold) gives the subtitle extra weight so it holds up at small size
        // against the gradient scrim — Label weight was too thin to read cleanly.
        var font = fonts.Display(size);

        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Bottom,
            Origin = new PointF(leftEdge, baseline),
            WrappingLength = width * 0.94f
        };
        // Goldenrod — a darker, aged gold that sits one tier below the bright #FFC400 hero
        // name. Keeps the palette warm/unified while giving the subtitle its own register.
        DrawTextWithShadow(
            ctx,
            stats.ServerName!.ToUpperInvariant(),
            options,
            Color.FromRgba(218, 165, 32, 255),
            size * 0.09f);
    }

    /// <summary>
    /// Paints a soft bottom-up dark gradient over the lower half of the image so the
    /// stats line reads cleanly regardless of backdrop (snow, bright sky, light maps, etc).
    /// The top of the image is left untouched so the artwork still carries the vibe.
    /// </summary>
    private static void DrawStatsScrim(IImageProcessingContext ctx, int width, int height)
    {
        var scrimTop = height * 0.50f;
        var gradient = new LinearGradientBrush(
            new PointF(0, scrimTop),
            new PointF(0, height),
            GradientRepetitionMode.None,
            new ColorStop(0f, Color.FromRgba(0, 0, 0, 0)),
            new ColorStop(0.45f, Color.FromRgba(0, 0, 0, 110)),
            new ColorStop(1f, Color.FromRgba(0, 0, 0, 200)));
        var region = new RectangularPolygon(0, scrimTop, width, height - scrimTop);
        ctx.Fill(gradient, region);
    }

    private void DrawStatsLine(IImageProcessingContext ctx, BannerStats stats, int width, int height)
    {
        var size = height * 0.165f;
        var leftEdge = width * 0.03f;
        var baseline = height * 0.86f;
        var font = fonts.Label(size);

        // Each block renders as <value> <LABEL> with a fixed gap between blocks.
        // Trailing spaces in measured strings get trimmed, so the inter-segment gap
        // is added explicitly in pixels rather than relying on whitespace.
        var blocks = new (string value, string label)[]
        {
            (FormatInt(stats.TotalKills), "KILLS"),
            (FormatInt(stats.TotalScore), "SCORE"),
            stats.KdRatio.ToString("0.00") is var kd ? (kd, "K/D") : default,
            (FormatHours(stats.TotalHours), "HRS")
        };

        var blockGap = size * 1.0f;          // gap between e.g. "12.8K KILLS" and "244K SCORE"
        var inBlockGap = size * 0.45f;       // gap between value and its label
        var x = leftEdge;
        var textOpts = new TextOptions(font);

        // Neon-green value color borrows the UI's #3ddc84 accent — gives the numbers
        // a dashboard/HUD readout feel against the white labels and gold hero name.
        var valueColor = Color.FromRgba(61, 220, 132, 255);

        foreach (var (value, label) in blocks)
        {
            DrawSegment(ctx, font, value, new PointF(x, baseline), size, valueColor);
            x += TextMeasurer.MeasureSize(value, textOpts).Width + inBlockGap;
            DrawSegment(ctx, font, label, new PointF(x, baseline), size, Color.White);
            x += TextMeasurer.MeasureSize(label, textOpts).Width + blockGap;
        }
    }

    private static void DrawSegment(IImageProcessingContext ctx, Font font, string text, PointF origin, float size, Color fill)
    {
        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Bottom,
            Origin = origin
        };
        // Offset dark drop shadow keeps glyph edges crisp against busy backdrops.
        DrawTextWithShadow(ctx, text, options, fill, size * 0.06f);
    }

    private void DrawWatermark(IImageProcessingContext ctx, int width, int height)
    {
        var size = height * 0.085f;
        var font = fonts.Label(size);
        const string text = "BFSTATS.IO";
        var rightEdge = width - width * 0.025f;
        var topEdge = height * 0.06f;

        // Dark "chip" backing — guarantees legibility on snow, bright sky, or light map
        // backdrops without needing to darken the whole top of the artwork.
        var textBounds = TextMeasurer.MeasureSize(text, new TextOptions(font));
        var padX = size * 0.45f;
        var padY = size * 0.25f;
        var chipRect = new RectangularPolygon(
            rightEdge - textBounds.Width - padX,
            topEdge - padY,
            textBounds.Width + padX * 2,
            textBounds.Height + padY * 2);
        ctx.Fill(Color.FromRgba(0, 0, 0, 160), chipRect);

        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Origin = new PointF(rightEdge, topEdge)
        };
        // Rusted-gold wordmark — matches the UI's #ffc400 accent. A warm dark drop shadow
        // inside the chip finishes the brand-stamp feel.
        var rustedGold = Color.FromRgba(255, 196, 0, 245);
        DrawTextWithShadow(ctx, text, options, rustedGold, size * 0.06f, Color.FromRgba(42, 20, 0, 220));
    }

    private static void DrawTextWithShadow(
        IImageProcessingContext ctx,
        string text,
        RichTextOptions options,
        Color fill,
        float shadowOffset,
        Color? shadowColor = null)
    {
        var shadow = shadowColor ?? Color.FromRgba(0, 0, 0, 190);
        var shadowOptions = new RichTextOptions(options.Font)
        {
            HorizontalAlignment = options.HorizontalAlignment,
            VerticalAlignment = options.VerticalAlignment,
            Origin = new PointF(options.Origin.X + shadowOffset, options.Origin.Y + shadowOffset),
            WrappingLength = options.WrappingLength
        };
        ctx.DrawText(shadowOptions, text, Brushes.Solid(shadow));
        ctx.DrawText(options, text, Brushes.Solid(fill));
    }

    private static string FormatInt(int value)
    {
        if (value >= 1_000_000) return $"{value / 1_000_000.0:0.##}M";
        if (value >= 100_000) return $"{value / 1_000.0:0}K";
        if (value >= 10_000) return $"{value / 1_000.0:0.#}K";
        return value.ToString("N0");
    }

    private static string FormatHours(double hours)
    {
        if (hours >= 10_000) return $"{hours / 1000:0.#}K";
        if (hours >= 1000) return $"{hours / 1000:0.##}K";
        return ((int)hours).ToString("N0");
    }
}
