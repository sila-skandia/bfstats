using api.PlayerBanners;
using api.ServerBanners.Models;
using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace api.ServerBanners;

/// <summary>
/// Generates the server signature banner entirely from code — no base image. A
/// neon/futuristic backdrop (deep-black diagonal gradient + accent glow + variant-specific
/// geometric overlay) carries the bfstats.io aesthetic; the hero server name, IP,
/// live stats row, LIVE pill, and BFSTATS.IO watermark sit on top.
/// </summary>
public sealed class ServerBannerRenderer(BannerFonts fonts)
{
    private const int Width = 960;
    private const int Height = 200;

    private static readonly Color BaseBlack = Color.FromRgba(13, 17, 23, 255);
    private static readonly Color DeepBlack = Color.FromRgba(5, 7, 9, 255);
    private static readonly Color Goldenrod = Color.FromRgba(218, 165, 32, 255);

    public async Task<byte[]> RenderAsync(ServerBannerStats stats, ServerBannerStyle style, CancellationToken ct = default)
    {
        using var image = new Image<Rgba32>(Width, Height, BaseBlack.ToPixel<Rgba32>());
        var palette = style.Palette();

        image.Mutate(ctx =>
        {
            DrawBackground(ctx, palette);
            DrawVariantOverlay(ctx, style, palette);
            DrawCornerBrackets(ctx, palette);
            DrawSideRail(ctx, palette);
            DrawStatsScrim(ctx);
            DrawServerName(ctx, stats, palette);
            DrawIpPortLine(ctx, stats);
            DrawStatsLine(ctx, stats, palette);
            DrawLiveDot(ctx, stats);
            DrawWatermark(ctx, palette);
        });

        var ms = new MemoryStream();
        await image.SaveAsync(ms, new PngEncoder
        {
            ColorType = PngColorType.RgbWithAlpha,
            CompressionLevel = PngCompressionLevel.BestCompression
        }, ct);
        return ms.ToArray();
    }

    // ---- backdrop ---------------------------------------------------------

    private static void DrawBackground(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // Diagonal gradient: deep near-black top-left → base black mid → subtle accent-tinted
        // black bottom-right. Gives depth without competing with foreground text.
        var bg = new LinearGradientBrush(
            new PointF(0, 0),
            new PointF(Width, Height),
            GradientRepetitionMode.None,
            new ColorStop(0f, DeepBlack),
            new ColorStop(0.6f, BaseBlack),
            new ColorStop(1f, palette.Tint));
        ctx.Fill(bg, new RectangularPolygon(0, 0, Width, Height));

        // Accent glow anchored at the right edge — radial feel via a tall elliptical
        // gradient brush. Keeps the hero-name side (left) clean and darker.
        var (r, g, b) = Rgb(palette.Accent);
        var glow = new RadialGradientBrush(
            new PointF(Width * 0.92f, Height * 0.5f),
            Height * 0.85f,
            GradientRepetitionMode.None,
            new ColorStop(0f, Color.FromRgba(r, g, b, 34)),
            new ColorStop(0.55f, Color.FromRgba(r, g, b, 14)),
            new ColorStop(1f, Color.FromRgba(0, 0, 0, 0)));
        ctx.Fill(glow, new RectangularPolygon(0, 0, Width, Height));
    }

    private static void DrawVariantOverlay(IImageProcessingContext ctx, ServerBannerStyle style, ServerBannerPalette palette)
    {
        switch (style)
        {
            case ServerBannerStyle.Grid:     DrawGridOverlay(ctx, palette); break;
            case ServerBannerStyle.Hud:      DrawHudOverlay(ctx, palette); break;
            case ServerBannerStyle.Scanline: DrawScanlineOverlay(ctx, palette); break;
            case ServerBannerStyle.Circuit:  DrawCircuitOverlay(ctx, palette); break;
        }
    }

    private static void DrawGridOverlay(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // Blueprint grid — faint accent lines with every 4th line brightened for emphasis,
        // evoking CAD/schematic aesthetics without drowning the text.
        var faint = WithAlpha(palette.Accent, 16);
        var major = WithAlpha(palette.Accent, 40);
        const float step = 24f;

        for (var i = 1; i * step < Width; i++)
        {
            var x = i * step;
            var pen = i % 4 == 0 ? major : faint;
            ctx.DrawLine(pen, 1f, new PointF(x, 0), new PointF(x, Height));
        }
        for (var i = 1; i * step < Height; i++)
        {
            var y = i * step;
            var pen = i % 4 == 0 ? major : faint;
            ctx.DrawLine(pen, 1f, new PointF(0, y), new PointF(Width, y));
        }
    }

    private static void DrawHudOverlay(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // Altimeter-style tick rails on both edges plus a faint reticle circle mid-right.
        // Reticle sits between the stats scrim top and the LIVE pill so it doesn't clash.
        var accent = WithAlpha(palette.Accent, 55);
        var faint = WithAlpha(palette.Accent, 28);

        // Left altimeter rail
        const float railX = 10f;
        ctx.DrawLine(accent, 1f, new PointF(railX, Height * 0.12f), new PointF(railX, Height * 0.88f));
        for (var i = 0; i < 12; i++)
        {
            var y = Height * 0.12f + i * (Height * 0.76f / 11f);
            var len = i % 3 == 0 ? 8f : 4f;
            ctx.DrawLine(accent, 1f, new PointF(railX, y), new PointF(railX + len, y));
        }

        // Right altimeter rail (mirrored)
        const float rightRailX = Width - 10f;
        ctx.DrawLine(accent, 1f, new PointF(rightRailX, Height * 0.12f), new PointF(rightRailX, Height * 0.88f));
        for (var i = 0; i < 12; i++)
        {
            var y = Height * 0.12f + i * (Height * 0.76f / 11f);
            var len = i % 3 == 0 ? 8f : 4f;
            ctx.DrawLine(accent, 1f, new PointF(rightRailX, y), new PointF(rightRailX - len, y));
        }

        // Reticle — offset to keep it clear of hero name, IP line, and LIVE pill.
        const float cx = Width * 0.74f;
        const float cy = Height * 0.44f;
        const float r = 26f;
        ctx.Draw(faint, 1f, new EllipsePolygon(cx, cy, r));
        ctx.Draw(faint, 1f, new EllipsePolygon(cx, cy, r * 0.45f));
        ctx.DrawLine(faint, 1f, new PointF(cx - r - 6, cy), new PointF(cx + r + 6, cy));
        ctx.DrawLine(faint, 1f, new PointF(cx, cy - r - 6), new PointF(cx, cy + r + 6));
    }

    private static void DrawScanlineOverlay(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // CRT scanlines — very thin horizontals every 3px. Low alpha so they read as
        // texture rather than stripes. A subtle accent-tinted vignette on the corners
        // finishes the old-terminal feel.
        var line = WithAlpha(palette.Accent, 14);
        for (var y = 0; y < Height; y += 3)
        {
            ctx.DrawLine(line, 1f, new PointF(0, y), new PointF(Width, y));
        }

        // Corner vignette — darkens edges slightly for a tube-monitor curve hint.
        var vignette = new RadialGradientBrush(
            new PointF(Width * 0.5f, Height * 0.5f),
            Width * 0.6f,
            GradientRepetitionMode.None,
            new ColorStop(0f, Color.FromRgba(0, 0, 0, 0)),
            new ColorStop(0.7f, Color.FromRgba(0, 0, 0, 0)),
            new ColorStop(1f, Color.FromRgba(0, 0, 0, 90)));
        ctx.Fill(vignette, new RectangularPolygon(0, 0, Width, Height));
    }

    private static void DrawCircuitOverlay(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // Sparse PCB-style traces — right-angle paths with small filled via-dots at
        // corners/endpoints. Kept sparse so the eye lands on text, not the circuit.
        var trace = WithAlpha(palette.Accent, 50);
        var via = WithAlpha(palette.Accent, 110);

        (PointF a, PointF b)[] segments =
        [
            (new(0, 20),               new(120, 20)),
            (new(120, 20),             new(120, 72)),
            (new(120, 72),             new(210, 72)),
            (new(Width - 0, 38),       new(Width - 160, 38)),
            (new(Width - 160, 38),     new(Width - 160, 96)),
            (new(Width - 160, 96),     new(Width - 240, 96)),
            (new(60, Height - 22),     new(240, Height - 22)),
            (new(240, Height - 22),    new(240, Height - 60)),
            (new(Width - 40, Height - 44), new(Width - 180, Height - 44)),
        ];
        foreach (var (a, b) in segments)
        {
            ctx.DrawLine(trace, 1.2f, a, b);
        }

        // Vias at each endpoint.
        PointF[] vias =
        [
            new(120, 20), new(120, 72), new(210, 72),
            new(Width - 160, 38), new(Width - 160, 96), new(Width - 240, 96),
            new(240, Height - 22), new(240, Height - 60),
            new(Width - 40, Height - 44), new(Width - 180, Height - 44)
        ];
        foreach (var p in vias)
        {
            ctx.Fill(via, new EllipsePolygon(p.X, p.Y, 2.2f));
        }
    }

    private static void DrawCornerBrackets(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // Four L-shaped HUD brackets frame the canvas. Brightens the accent just enough
        // that the eye registers the "device readout" framing without distraction.
        var pen = WithAlpha(palette.Accent, 200);
        const float arm = 14f;
        const float inset = 6f;

        // Top-left
        ctx.DrawLine(pen, 1.5f, new PointF(inset, inset), new PointF(inset + arm, inset));
        ctx.DrawLine(pen, 1.5f, new PointF(inset, inset), new PointF(inset, inset + arm));
        // Top-right
        ctx.DrawLine(pen, 1.5f, new PointF(Width - inset - arm, inset), new PointF(Width - inset, inset));
        ctx.DrawLine(pen, 1.5f, new PointF(Width - inset, inset), new PointF(Width - inset, inset + arm));
        // Bottom-left
        ctx.DrawLine(pen, 1.5f, new PointF(inset, Height - inset - arm), new PointF(inset, Height - inset));
        ctx.DrawLine(pen, 1.5f, new PointF(inset, Height - inset), new PointF(inset + arm, Height - inset));
        // Bottom-right
        ctx.DrawLine(pen, 1.5f, new PointF(Width - inset - arm, Height - inset), new PointF(Width - inset, Height - inset));
        ctx.DrawLine(pen, 1.5f, new PointF(Width - inset, Height - inset), new PointF(Width - inset, Height - inset - arm));
    }

    private static void DrawSideRail(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        // Thin accent rail flush with the left text edge — acts as a visual spine tying
        // the hero name, IP, and stats row together.
        var pen = WithAlpha(palette.Accent, 220);
        const float x = Width * 0.025f;
        ctx.DrawLine(pen, 2f, new PointF(x, Height * 0.14f), new PointF(x, Height * 0.86f));
    }

    // ---- foreground text --------------------------------------------------

    private static void DrawStatsScrim(IImageProcessingContext ctx)
    {
        // Soft bottom-up scrim under the stats row for contrast against any overlay.
        var scrimTop = Height * 0.55f;
        var gradient = new LinearGradientBrush(
            new PointF(0, scrimTop),
            new PointF(0, Height),
            GradientRepetitionMode.None,
            new ColorStop(0f, Color.FromRgba(0, 0, 0, 0)),
            new ColorStop(1f, Color.FromRgba(0, 0, 0, 160)));
        ctx.Fill(gradient, new RectangularPolygon(0, scrimTop, Width, Height - scrimTop));
    }

    private void DrawServerName(IImageProcessingContext ctx, ServerBannerStats stats, ServerBannerPalette palette)
    {
        var nameSize = Height * 0.24f;
        var leftEdge = Width * 0.05f;
        var font = fonts.Display(nameSize);
        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Top,
            Origin = new PointF(leftEdge, Height * 0.10f),
            WrappingLength = Width * 0.82f
        };
        DrawGlowText(ctx, stats.ServerName, options, palette.Accent, nameSize * 0.08f);
    }

    private void DrawIpPortLine(IImageProcessingContext ctx, ServerBannerStats stats)
    {
        if (string.IsNullOrWhiteSpace(stats.IpPort))
        {
            return;
        }

        var size = Height * 0.1f;
        var leftEdge = Width * 0.05f;
        var baseline = Height * 0.62f;
        var font = fonts.Label(size);
        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Left,
            VerticalAlignment = VerticalAlignment.Bottom,
            Origin = new PointF(leftEdge, baseline)
        };
        DrawShadowText(ctx, stats.IpPort, options, Goldenrod, size * 0.08f);
    }

    private void DrawStatsLine(IImageProcessingContext ctx, ServerBannerStats stats, ServerBannerPalette palette)
    {
        var size = Height * 0.145f;
        var leftEdge = Width * 0.05f;
        var baseline = Height * 0.93f;
        var font = fonts.Label(size);

        var playerValue = stats.MaxPlayers > 0
            ? $"{stats.NumPlayers}/{stats.MaxPlayers}"
            : stats.NumPlayers.ToString();

        var blocks = new List<(string value, string label)>
        {
            (playerValue, "PLAYERS")
        };
        if (!string.IsNullOrWhiteSpace(stats.Map))
        {
            blocks.Add(("MAP", stats.Map!.ToUpperInvariant()));
        }
        var modeLabel = NormalizeGameMode(stats.GameMode);
        if (!string.IsNullOrWhiteSpace(modeLabel))
        {
            blocks.Add(("MODE", modeLabel));
        }

        var blockGap = size * 0.9f;
        var inBlockGap = size * 0.35f;
        var x = leftEdge;
        var maxRight = Width - Width * 0.04f;
        var textOpts = new TextOptions(font);

        for (var i = 0; i < blocks.Count; i++)
        {
            var (value, label) = blocks[i];
            var first = i == 0;

            var firstColor = first ? palette.Secondary : palette.Accent;
            var firstWidth = TextMeasurer.MeasureSize(value, textOpts).Width;
            var secondWidth = TextMeasurer.MeasureSize(label, textOpts).Width;
            if (x + firstWidth + inBlockGap + secondWidth > maxRight)
            {
                break;
            }

            DrawShadowText(ctx, value, WithOrigin(textOpts, new PointF(x, baseline)), firstColor, size * 0.06f);
            x += firstWidth + inBlockGap;
            DrawShadowText(ctx, label, WithOrigin(textOpts, new PointF(x, baseline)), Color.White, size * 0.06f);
            x += secondWidth + blockGap;
        }
    }

    private static void DrawLiveDot(IImageProcessingContext ctx, ServerBannerStats stats)
    {
        // Small glowing status dot in the top-right corner. Soft outer halo simulates
        // the Vue UI's box-shadow glow, then a crisp solid dot on top.
        var dotColor = stats.IsOnline
            ? Color.FromRgba(61, 220, 132, 255)
            : Color.FromRgba(220, 80, 80, 245);
        var cx = Width - Width * 0.025f;
        var cy = Height * 0.14f;
        const float coreRadius = 5.5f;

        var (r, g, b) = Rgb(dotColor);
        ctx.Fill(Color.FromRgba(r, g, b, 60), new EllipsePolygon(cx, cy, coreRadius * 2.4f));
        ctx.Fill(Color.FromRgba(r, g, b, 120), new EllipsePolygon(cx, cy, coreRadius * 1.6f));
        ctx.Fill(dotColor, new EllipsePolygon(cx, cy, coreRadius));
    }

    private void DrawWatermark(IImageProcessingContext ctx, ServerBannerPalette palette)
    {
        var size = Height * 0.07f;
        var font = fonts.Label(size);
        const string text = "BFSTATS.IO";
        // Watermark sits a touch left of the status dot so both live-state and brand
        // share the top-right corner without collision.
        var rightEdge = Width - Width * 0.045f;
        var topEdge = Height * 0.105f;
        var options = new RichTextOptions(font)
        {
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            Origin = new PointF(rightEdge, topEdge)
        };
        DrawShadowText(ctx, text, options, palette.Accent, size * 0.07f, Color.FromRgba(42, 20, 0, 220));
    }

    // ---- text helpers -----------------------------------------------------

    private static RichTextOptions WithOrigin(TextOptions baseOptions, PointF origin) => new(baseOptions.Font)
    {
        HorizontalAlignment = HorizontalAlignment.Left,
        VerticalAlignment = VerticalAlignment.Bottom,
        Origin = origin
    };

    private static void DrawShadowText(
        IImageProcessingContext ctx,
        string text,
        RichTextOptions options,
        Color fill,
        float shadowOffset,
        Color? shadowColor = null)
    {
        var shadow = shadowColor ?? Color.FromRgba(0, 0, 0, 200);
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

    /// <summary>
    /// Cheap glow: draw the text at eight angular offsets around its origin in a
    /// translucent accent colour, then stamp the solid fill on top. Approximates a
    /// neon halo without needing a separate blur/compose pass.
    /// </summary>
    private static void DrawGlowText(
        IImageProcessingContext ctx,
        string text,
        RichTextOptions options,
        Color fill,
        float glowRadius)
    {
        var (r, g, b) = Rgb(fill);
        var outer = Color.FromRgba(r, g, b, 45);
        var inner = Color.FromRgba(r, g, b, 90);
        var shadow = Color.FromRgba(0, 0, 0, 180);

        for (var i = 0; i < 8; i++)
        {
            var angle = i * MathF.PI / 4f;
            var dx = MathF.Cos(angle) * glowRadius;
            var dy = MathF.Sin(angle) * glowRadius;
            ctx.DrawText(OffsetOptions(options, dx, dy), text, Brushes.Solid(outer));
        }
        for (var i = 0; i < 8; i++)
        {
            var angle = i * MathF.PI / 4f + MathF.PI / 8f;
            var dx = MathF.Cos(angle) * glowRadius * 0.5f;
            var dy = MathF.Sin(angle) * glowRadius * 0.5f;
            ctx.DrawText(OffsetOptions(options, dx, dy), text, Brushes.Solid(inner));
        }
        // Dark offset drop shadow for edge bite against lighter overlay regions.
        ctx.DrawText(OffsetOptions(options, glowRadius * 0.6f, glowRadius * 0.6f), text, Brushes.Solid(shadow));
        ctx.DrawText(options, text, Brushes.Solid(fill));
    }

    private static RichTextOptions OffsetOptions(RichTextOptions options, float dx, float dy) => new(options.Font)
    {
        HorizontalAlignment = options.HorizontalAlignment,
        VerticalAlignment = options.VerticalAlignment,
        Origin = new PointF(options.Origin.X + dx, options.Origin.Y + dy),
        WrappingLength = options.WrappingLength
    };

    // ---- colour helpers ---------------------------------------------------

    private static Color WithAlpha(Color color, byte alpha)
    {
        var (r, g, b) = Rgb(color);
        return Color.FromRgba(r, g, b, alpha);
    }

    private static (byte r, byte g, byte b) Rgb(Color color)
    {
        var px = color.ToPixel<Rgba32>();
        return (px.R, px.G, px.B);
    }

    private static string NormalizeGameMode(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }

        var trimmed = raw.Trim().ToUpperInvariant();
        return trimmed switch
        {
            "GPM_CQ" => "CONQUEST",
            "GPM_CTF" => "CTF",
            "GPM_TDM" => "TDM",
            "GPM_OBJECTIVEMODE" or "OBJECTIVE MODE" => "OBJECTIVE",
            "GPM_COOP" or "COOP" => "CO-OP",
            "GPM_SP" or "SINGLEPLAYER" => "SINGLE-PLAYER",
            _ => trimmed
        };
    }
}
