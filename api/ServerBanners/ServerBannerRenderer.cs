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
/// Generates the server signature banner entirely from code — no base image. The
/// "Neutral Depth" (v4) layout: a near-black card split into a left art panel (one of
/// four futuristic treatments — Reticle / Hologram / Waveform / Console) and a right
/// data column carrying the server name, live player count, current map, IP, and the
/// live Axis-vs-Allies ticket scoreboard. Reticle is full-bleed (no separate panel).
///
/// The whole banner is authored in a fixed 960x200 "design space"; rendering scales the
/// whole thing to the requested output <c>width</c> (aspect locked), painting crisply at
/// 1:1 — bigger widths read larger and stay sharp on high-DPI / 4K displays, smaller widths
/// fit forums that cap signature dimensions. All layout literals stay in design units — only
/// the drawing primitives and fonts scale at paint time (see <see cref="Pass"/>).
/// </summary>
public sealed class ServerBannerRenderer(BannerFonts fonts)
{
    public const int DesignWidth = 960;
    public const int DesignHeight = 200;

    public const int MinWidth = 320;
    public const int MaxWidth = 1920;
    public const int DefaultWidth = 960;

    /// <summary>Clamps an arbitrary requested output width into the supported range.</summary>
    public static int ClampWidth(int width) => Math.Clamp(width, MinWidth, MaxWidth);

    public Task<byte[]> RenderAsync(
        ServerBannerStats stats,
        ServerBannerStyle style,
        int width = DefaultWidth,
        CancellationToken ct = default)
        => new Pass(fonts, ClampWidth(width) / (float)DesignWidth).RenderAsync(stats, style, ct);

    /// <summary>
    /// Per-render worker. Holds the immutable scale factor so the parent renderer can stay a
    /// thread-safe singleton — concurrent requests each get their own Pass.
    /// </summary>
    private sealed class Pass(BannerFonts fonts, float s)
    {
        // ---- design-space geometry (unscaled) ---------------------------------
        private const int Width = DesignWidth;
        private const int Height = DesignHeight;
        private const int ArtWidth = 312;

        // ---- Neutral Depth palette (mirrors --mm-* tokens) --------------------
        private static readonly Color CardBg     = Color.FromRgba(14, 14, 14, 255);   // banner base (#0e0e0e)
        private static readonly Color Ink        = Color.FromRgba(255, 255, 255, 255);
        private static readonly Color InkSoft    = Color.FromRgba(214, 214, 214, 255);
        private static readonly Color InkMuted   = Color.FromRgba(170, 170, 170, 255); // brighter than the UI muted so labels don't blend into the art
        private static readonly Color InkFaint   = Color.FromRgba(112, 112, 112, 255);
        private static readonly Color Olive      = Color.FromRgba(154, 166, 102, 255); // --mm-accent-soft
        private static readonly Color OliveText  = Color.FromRgba(196, 209, 132, 255); // brightened olive for body text (IP) over the dark/tinted backdrop
        private static readonly Color OliveDeep  = Color.FromRgba(125, 136, 73, 255);  // --mm-accent
        private static readonly Color Allies     = Color.FromRgba(125, 163, 76, 255);  // --mm-success
        private static readonly Color Axis       = Color.FromRgba(214, 90, 90, 255);   // --mm-kill
        private static readonly Color LoadBusy   = Color.FromRgba(197, 162, 58, 255);  // --mm-load-busy
        private static readonly Color Rule       = Color.FromRgba(45, 45, 45, 255);    // --mm-rule
        private static readonly Color RuleStrong = Color.FromRgba(61, 61, 61, 255);    // --mm-rule-strong

        // Drop shadow behind painted text — opaque enough to hold an edge over the art glow.
        private static readonly Color TextShadow = Color.FromRgba(0, 0, 0, 205);

        public async Task<byte[]> RenderAsync(ServerBannerStats stats, ServerBannerStyle style, CancellationToken ct = default)
        {
            var pxW = (int)MathF.Round(Width * s);
            var pxH = (int)MathF.Round(Height * s);
            using var image = new Image<Rgba32>(pxW, pxH, CardBg.ToPixel<Rgba32>());
            var palette = style.Palette();

            image.Mutate(ctx =>
            {
                DrawBackdrop(ctx, palette);

                var fullBleed = style == ServerBannerStyle.Reticle;
                var dataX0 = fullBleed ? 0f : ArtWidth;

                if (fullBleed)
                {
                    DrawReticle(ctx);
                }
                else
                {
                    DrawArt(ctx, style, stats);
                    ctx.DrawLine(Rule, U(1f), P(ArtWidth, 0), P(ArtWidth, Height));
                }

                DrawData(ctx, stats, dataX0, fullBleed);
                DrawFrame(ctx);
            });

            var ms = new MemoryStream();
            await image.SaveAsync(ms, new PngEncoder
            {
                ColorType = PngColorType.RgbWithAlpha,
                CompressionLevel = PngCompressionLevel.BestCompression
            }, ct);
            return ms.ToArray();
        }

        // ---- scaling helpers --------------------------------------------------
        // Geometry stays authored in design units; these convert to device pixels.

        private float U(float v) => v * s;
        private PointF P(float x, float y) => new(x * s, y * s);
        private RectangularPolygon Rect(float x, float y, float w, float h) => new(x * s, y * s, w * s, h * s);
        private EllipsePolygon Ellipse(float cx, float cy, float r) => new(cx * s, cy * s, r * s);

        // ---- backdrop + frame -------------------------------------------------

        private void DrawBackdrop(IImageProcessingContext ctx, ServerBannerPalette palette)
        {
            // Diagonal gradient toward a dim olive-tinted black, plus a soft olive glow
            // anchored top-right — keeps the data column (left) clean and dark.
            var bg = new LinearGradientBrush(
                P(0, 0),
                P(Width, Height),
                GradientRepetitionMode.None,
                new ColorStop(0f, CardBg),
                new ColorStop(0.65f, CardBg),
                new ColorStop(1f, palette.Tint));
            ctx.Fill(bg, Rect(0, 0, Width, Height));

            var (r, g, b) = Rgb(palette.Accent);
            var glow = new RadialGradientBrush(
                P(Width * 0.86f, Height * 0.32f),
                U(Height * 0.95f),
                GradientRepetitionMode.None,
                new ColorStop(0f, Color.FromRgba(r, g, b, 26)),
                new ColorStop(0.6f, Color.FromRgba(r, g, b, 10)),
                new ColorStop(1f, Color.FromRgba(0, 0, 0, 0)));
            ctx.Fill(glow, Rect(0, 0, Width, Height));
        }

        private void DrawFrame(IImageProcessingContext ctx)
        {
            // 1px hairline border + small olive corner ticks for the "device readout" feel.
            ctx.Draw(RuleStrong, U(1f), Rect(0.5f, 0.5f, Width - 1, Height - 1));

            var tick = WithAlpha(Olive, 200);
            const float arm = 13f, inset = 6f;
            // top-left
            ctx.DrawLine(tick, U(1.5f), P(inset, inset), P(inset + arm, inset));
            ctx.DrawLine(tick, U(1.5f), P(inset, inset), P(inset, inset + arm));
            // bottom-right
            ctx.DrawLine(tick, U(1.5f), P(Width - inset - arm, Height - inset), P(Width - inset, Height - inset));
            ctx.DrawLine(tick, U(1.5f), P(Width - inset, Height - inset), P(Width - inset, Height - inset - arm));
        }

        // ---- art panels -------------------------------------------------------

        private void DrawArt(IImageProcessingContext ctx, ServerBannerStyle style, ServerBannerStats stats)
        {
            switch (style)
            {
                case ServerBannerStyle.Hologram: DrawHologram(ctx); break;
                case ServerBannerStyle.Waveform: DrawWaveform(ctx, stats); break;
                case ServerBannerStyle.Console:  DrawConsole(ctx); break;
            }
        }

        private void DrawReticle(IImageProcessingContext ctx)
        {
            // Full-bleed targeting HUD: faint vertical scan grid, corner brackets, a centre
            // top tick, and decorative telemetry coordinates tucked into the top-right.
            var faint = WithAlpha(Olive, 10);
            for (var x = 40f; x < Width; x += 40f)
            {
                ctx.DrawLine(faint, U(1f), P(x, 0), P(x, Height));
            }

            var bracket = WithAlpha(Olive, 165);
            const float arm = 18f, inset = 14f;
            // four L brackets framing the canvas
            ctx.DrawLine(bracket, U(1.5f), P(inset, inset), P(inset + arm, inset));
            ctx.DrawLine(bracket, U(1.5f), P(inset, inset), P(inset, inset + arm));
            ctx.DrawLine(bracket, U(1.5f), P(Width - inset - arm, inset), P(Width - inset, inset));
            ctx.DrawLine(bracket, U(1.5f), P(Width - inset, inset), P(Width - inset, inset + arm));
            ctx.DrawLine(bracket, U(1.5f), P(inset, Height - inset - arm), P(inset, Height - inset));
            ctx.DrawLine(bracket, U(1.5f), P(inset, Height - inset), P(inset + arm, Height - inset));
            ctx.DrawLine(bracket, U(1.5f), P(Width - inset - arm, Height - inset), P(Width - inset, Height - inset));
            ctx.DrawLine(bracket, U(1.5f), P(Width - inset, Height - inset), P(Width - inset, Height - inset - arm));

            // centre top tick
            ctx.DrawLine(WithAlpha(Olive, 130), U(1f), P(Width / 2f, 10), P(Width / 2f, 20));
        }

        private void DrawHologram(IImageProcessingContext ctx)
        {
            // Projected wireframe terrain: a radial-lit panel with a perspective grid that
            // converges to a vanishing point near the top, an olive "peak" glow, scanlines.
            var bg = new RadialGradientBrush(
                P(ArtWidth / 2f, Height * 1.15f),
                U(Height * 1.1f),
                GradientRepetitionMode.None,
                new ColorStop(0f, Color.FromRgba(26, 31, 16, 255)),
                new ColorStop(0.7f, Color.FromRgba(10, 11, 7, 255)));
            ctx.Fill(bg, Rect(0, 0, ArtWidth, Height));

            var line = WithAlpha(Olive, 70);
            var vp = P(ArtWidth / 2f, 44f);

            // Perspective horizontals — denser toward the top (the horizon).
            for (var i = 0; i <= 7; i++)
            {
                var t = i / 7f;
                var y = 78f + (Height - 78f) * (t * t);
                ctx.DrawLine(WithAlpha(Olive, (byte)(40 + 35 * t)), U(1f), P(8, y), P(ArtWidth - 8, y));
            }
            // Converging verticals from the bottom edge to the vanishing point.
            for (var k = -3; k <= 3; k++)
            {
                var bottomX = ArtWidth / 2f + k * 46f;
                ctx.DrawLine(line, U(1f), P(bottomX, Height - 4), vp);
            }

            // Peak glow — soft olive cone above the horizon.
            var peak = new PathBuilder();
            peak.AddLines(P(ArtWidth / 2f, 30f), P(ArtWidth / 2f - 34f, 86f), P(ArtWidth / 2f + 34f, 86f));
            peak.CloseFigure();
            ctx.Fill(WithAlpha(Color.FromRgba(180, 192, 96, 255), 36), peak.Build());
            ctx.DrawLine(WithAlpha(Color.FromRgba(180, 192, 96, 255), 130), U(1f),
                P(ArtWidth / 2f - 34f, 86f), P(ArtWidth / 2f + 34f, 86f));

            DrawScanlines(ctx, ArtWidth);
        }

        private void DrawWaveform(IImageProcessingContext ctx, ServerBannerStats stats)
        {
            // Population timeline as an equalizer: past hours (solid olive), the live current
            // hour (amber), and the forecast for the coming hours (dim olive). Falls back to a
            // static demo signal when no activity history is available.
            ctx.Fill(Color.FromRgba(17, 19, 8, 255), Rect(0, 0, ArtWidth, Height));

            var (players, isCurrent, isFuture) = ActivitySeries(stats);
            var realActivity = stats.Activity is { Bars.Count: > 0 };

            const float padX = 16f;
            const float baselineY = 150f;
            const float maxBarH = 104f;
            const float gap = 4f;
            var count = players.Length;
            var innerW = ArtWidth - padX * 2;
            var barW = (innerW - gap * (count - 1)) / count;
            var max = Math.Max(1.0, players.Max());

            // header so the panel reads as a chart, not decoration (real timeline only)
            if (realActivity)
            {
                DrawText(ctx, fonts.Label(9.5f), "ACTIVITY · ±4H", new PointF(padX, 28f), WithAlpha(Olive, 220));
            }

            var currentCenterX = padX + barW / 2f;
            for (var i = 0; i < count; i++)
            {
                var h = (float)(players[i] / max) * maxBarH;
                if (h < 2f && players[i] > 0)
                {
                    h = 2f; // keep tiny non-zero hours visible
                }
                var x = padX + i * (barW + gap);

                if (isCurrent[i])
                {
                    currentCenterX = x + barW / 2f;
                    ctx.Fill(WithAlpha(LoadBusy, 60), Rect(x - 2, baselineY - h - 2, barW + 4, h + 4));
                    ctx.Fill(WithAlpha(LoadBusy, 255), Rect(x, baselineY - h, barW, h));
                }
                else if (isFuture[i])
                {
                    // forecast — dim, hollow-ish
                    ctx.Fill(WithAlpha(Olive, 80), Rect(x, baselineY - h, barW, h));
                    ctx.DrawLine(WithAlpha(Olive, 150), U(1f), P(x, baselineY - h), P(x + barW, baselineY - h));
                }
                else
                {
                    ctx.Fill(WithAlpha(Olive, 205), Rect(x, baselineY - h, barW, h));
                }
            }

            ctx.DrawLine(WithAlpha(Olive, 100), U(1f), P(padX, baselineY), P(ArtWidth - padX, baselineY));

            // timeline captions (real ±4h window only)
            if (realActivity)
            {
                var capFont = fonts.Label(8.5f);
                DrawText(ctx, capFont, "−4H", new PointF(padX, 170f), InkMuted);
                DrawText(ctx, capFont, "NOW", new PointF(currentCenterX, 170f), WithAlpha(LoadBusy, 245), HorizontalAlignment.Center);
                DrawText(ctx, capFont, "+4H", new PointF(ArtWidth - padX, 170f), InkMuted, HorizontalAlignment.Right);
            }
        }

        /// <summary>
        /// Resolves the equalizer series — real activity timeline if present, else a static
        /// demo signal (all past, last bar "current").
        /// </summary>
        private static (double[] players, bool[] isCurrent, bool[] isFuture) ActivitySeries(ServerBannerStats stats)
        {
            if (stats.Activity is { Bars.Count: > 0 } activity)
            {
                var n = activity.Bars.Count;
                var players = new double[n];
                var isCurrent = new bool[n];
                var isFuture = new bool[n];
                for (var i = 0; i < n; i++)
                {
                    players[i] = activity.Bars[i].Players;
                    isCurrent[i] = activity.Bars[i].IsCurrent;
                    isFuture[i] = activity.Bars[i].IsFuture;
                }
                return (players, isCurrent, isFuture);
            }

            double[] demo = [22, 30, 26, 34, 40, 33, 44, 52, 48, 58, 66, 60, 72, 80, 76, 88, 94, 86, 98, 90, 82, 70, 64, 78];
            var cur = new bool[demo.Length];
            cur[^1] = true;
            return (demo, cur, new bool[demo.Length]);
        }

        private void DrawConsole(IImageProcessingContext ctx)
        {
            // Command-ops readout: REC live-feed header + segment meters with decorative
            // telemetry. Purely flavour — the live count, map, and tickets all live in the
            // right-hand data column, so we don't echo them here.
            ctx.Fill(Color.FromRgba(12, 14, 8, 255), Rect(0, 0, ArtWidth, Height));
            const float padX = 18f;
            var mono = fonts.Label(11f);

            // REC header
            var recY = 30f;
            ctx.Fill(Axis, Ellipse(padX + 4, recY - 4, 4f));
            ctx.Fill(WithAlpha(Axis, 70), Ellipse(padX + 4, recY - 4, 7f));
            DrawText(ctx, mono, "LIVE FEED", new PointF(padX + 16, recY), InkMuted);

            // segment meter row 1 (mostly on, one hot)
            DrawSegments(ctx, padX, 52f, ArtWidth - padX, [true, true, true, true, false, false], hotIndex: 4);

            // decorative telemetry — flavour only, no duplicated stats
            DrawText(ctx, mono, "> uplink stable · 24ms", new PointF(padX, 92f), WithAlpha(OliveText, 230));
            DrawText(ctx, mono, "> stream sync OK", new PointF(padX, 116f), WithAlpha(OliveText, 230));

            // segment meter row 2
            DrawSegments(ctx, padX, 150f, ArtWidth - padX, [true, true, false, false, false, false], hotIndex: 2);
        }

        private void DrawSegments(IImageProcessingContext ctx, float x0, float y, float x1, bool[] on, int hotIndex)
        {
            const float gap = 4f, h = 7f;
            var segW = (x1 - x0 - gap * (on.Length - 1)) / on.Length;
            for (var i = 0; i < on.Length; i++)
            {
                var x = x0 + i * (segW + gap);
                Color c = i == hotIndex ? LoadBusy : on[i] ? Olive : WithAlpha(OliveDeep, 64);
                ctx.Fill(c, Rect(x, y, segW, h));
            }
        }

        private void DrawScanlines(IImageProcessingContext ctx, float width)
        {
            var line = WithAlpha(Color.FromRgba(0, 0, 0, 255), 70);
            for (var y = 0; y < Height; y += 4)
            {
                ctx.DrawLine(line, U(1f), P(0, y), P(width, y));
            }
        }

        // ---- data column ------------------------------------------------------

        private void DrawData(IImageProcessingContext ctx, ServerBannerStats stats, float x0, bool fullBleed)
        {
            var padL = fullBleed ? x0 + 34f : x0 + 24f;
            var padR = Width - 26f;

            // soft scrim so text stays legible over the art glow on the full-bleed reticle
            if (fullBleed)
            {
                var scrim = new LinearGradientBrush(
                    P(0, 0), P(Width * 0.6f, 0), GradientRepetitionMode.None,
                    new ColorStop(0f, Color.FromRgba(0, 0, 0, 165)),
                    new ColorStop(1f, Color.FromRgba(0, 0, 0, 0)));
                ctx.Fill(scrim, Rect(0, 0, Width, Height));
            }

            DrawStatusDot(ctx, stats, padL);
            DrawServerName(ctx, stats, padL + 16f, padR);
            DrawIpLine(ctx, stats, padL + 16f);
            DrawCount(ctx, stats, padL);
            DrawMapBlock(ctx, stats, padR, fullBleed);
            DrawBottomRow(ctx, stats, padL, padR);
            DrawCoords(ctx, fullBleed, padR);
        }

        private void DrawStatusDot(IImageProcessingContext ctx, ServerBannerStats stats, float x)
        {
            var live = stats.IsOnline && stats.NumPlayers > 0;
            var color = live ? Allies : InkFaint;
            var cy = 30f;
            if (live)
            {
                var (r, g, b) = Rgb(color);
                ctx.Fill(Color.FromRgba(r, g, b, 60), Ellipse(x + 4, cy, 8f));
                ctx.Fill(Color.FromRgba(r, g, b, 120), Ellipse(x + 4, cy, 5.5f));
            }
            ctx.Fill(color, Ellipse(x + 4, cy, 4f));
        }

        private void DrawServerName(IImageProcessingContext ctx, ServerBannerStats stats, float x, float right)
        {
            var font = fonts.Label(16f);
            var name = (stats.ServerName ?? "").ToUpperInvariant();
            var maxW = right - x - 70f; // leave room so the coords/watermark area stays clear
            name = TruncateToWidth(font, name, maxW);
            DrawText(ctx, font, name, new PointF(x, 37f), Ink);
        }

        private void DrawIpLine(IImageProcessingContext ctx, ServerBannerStats stats, float x)
        {
            if (string.IsNullOrWhiteSpace(stats.IpPort))
            {
                return;
            }
            var font = fonts.Label(12.5f);
            DrawText(ctx, font, stats.IpPort, new PointF(x, 59f), OliveText);
        }

        private void DrawCount(IImageProcessingContext ctx, ServerBannerStats stats, float x)
        {
            var frac = stats.MaxPlayers > 0 ? (float)stats.NumPlayers / stats.MaxPlayers : 0f;
            var countColor = frac <= 0 ? InkFaint
                : frac >= 0.95f ? Axis
                : frac >= 0.6f ? LoadBusy
                : Ink;

            var countFont = fonts.Display(58f);
            var baseline = 138f;
            var countStr = stats.NumPlayers.ToString();
            DrawText(ctx, countFont, countStr, new PointF(x, baseline), countColor);

            if (stats.MaxPlayers > 0)
            {
                var w = MeasureWidth(countFont, countStr);
                var capFont = fonts.Label(18f);
                DrawText(ctx, capFont, $"/{stats.MaxPlayers}", new PointF(x + w + 6f, baseline), InkMuted);
            }
        }

        private void DrawMapBlock(IImageProcessingContext ctx, ServerBannerStats stats, float right, bool fullBleed)
        {
            var label = fullBleed ? "MAP" : "CURRENT MAP";
            var labelFont = fonts.Label(10.5f);
            var mapFont = fonts.Label(16f);
            var map = string.IsNullOrWhiteSpace(stats.Map) ? "UNKNOWN" : stats.Map!.ToUpperInvariant();

            DrawText(ctx, labelFont, label, new PointF(right, 112f), InkMuted, HorizontalAlignment.Right);
            DrawText(ctx, mapFont, map, new PointF(right, 134f), Ink, HorizontalAlignment.Right);
        }

        private void DrawBottomRow(IImageProcessingContext ctx, ServerBannerStats stats, float left, float right)
        {
            var baseline = 182f;

            // brand wordmark, bottom-right
            var brandFont = fonts.Label(12.5f);
            const string brand = "bfstats.io";
            DrawText(ctx, brandFont, brand, new PointF(right, baseline), OliveText, HorizontalAlignment.Right);
            var brandLeft = right - MeasureWidth(brandFont, brand) - 18f;

            if (stats.Tickets is { } tk)
            {
                DrawTickets(ctx, tk, left, brandLeft, baseline);
            }
            else if (!string.IsNullOrWhiteSpace(stats.GameMode))
            {
                var modeFont = fonts.Label(11f);
                DrawText(ctx, modeFont, NormalizeGameMode(stats.GameMode), new PointF(left, baseline), InkMuted);
            }
        }

        private void DrawTickets(IImageProcessingContext ctx, ServerBannerTickets tk, float left, float right, float baseline)
        {
            var labelFont = fonts.Label(11f);
            var numFont = fonts.Label(16f);
            var t1 = tk.Team1Tickets;
            var t2 = tk.Team2Tickets;
            var total = Math.Max(1, t1 + t2);

            // left cluster: AXIS 142
            var x = left;
            DrawText(ctx, labelFont, tk.Team1Label, new PointF(x, baseline), Axis);
            x += MeasureWidth(labelFont, tk.Team1Label) + 7f;
            var t1Str = t1.ToString();
            DrawText(ctx, numFont, t1Str, new PointF(x, baseline), Axis);
            var leftEnd = x + MeasureWidth(numFont, t1Str) + 12f;

            // right cluster: 69 ALLIES (measured back from the right edge)
            var t2Str = t2.ToString();
            var alliesW = MeasureWidth(labelFont, tk.Team2Label);
            var t2W = MeasureWidth(numFont, t2Str);
            var rightStart = right - alliesW - t2W - 7f - 12f;
            DrawText(ctx, numFont, t2Str, new PointF(rightStart + 12f, baseline), Allies);
            DrawText(ctx, labelFont, tk.Team2Label, new PointF(right, baseline), Allies, HorizontalAlignment.Right);

            // proportional split track between the clusters
            var trackX = leftEnd;
            var trackW = rightStart - leftEnd;
            if (trackW > 20f)
            {
                var trackY = baseline - 8f;
                const float trackH = 4f;
                var aW = trackW * (t1 / (float)total);
                ctx.Fill(WithAlpha(Axis, 235), Rect(trackX, trackY, aW, trackH));
                ctx.Fill(WithAlpha(Allies, 235), Rect(trackX + aW, trackY, trackW - aW, trackH));
            }
        }

        private void DrawCoords(IImageProcessingContext ctx, bool fullBleed, float right)
        {
            if (!fullBleed)
            {
                return;
            }
            // decorative HUD telemetry, top-right corner (clear of the left-aligned name)
            var font = fonts.Label(10f);
            DrawText(ctx, font, "N 51·07 / E 1·19", new PointF(right, 26f), WithAlpha(Olive, 190), HorizontalAlignment.Right);
            DrawText(ctx, font, "ALT 0420 · HDG 270", new PointF(right, 44f), WithAlpha(Olive, 140), HorizontalAlignment.Right);
        }

        // ---- text helpers -----------------------------------------------------

        private void DrawText(
            IImageProcessingContext ctx,
            Font font,
            string text,
            PointF origin,
            Color fill,
            HorizontalAlignment hAlign = HorizontalAlignment.Left)
        {
            // The passed Font is design-sized (so layout measurement stays in design units);
            // paint with a scaled clone at the scaled origin.
            var scaled = new Font(font, font.Size * s);
            var sx = origin.X * s;
            var sy = origin.Y * s;
            var shadowOffset = MathF.Max(1f, s);

            var options = new RichTextOptions(scaled)
            {
                HorizontalAlignment = hAlign,
                VerticalAlignment = VerticalAlignment.Bottom,
                Origin = new PointF(sx, sy)
            };
            // subtle drop shadow for legibility over art
            var shadow = new RichTextOptions(scaled)
            {
                HorizontalAlignment = hAlign,
                VerticalAlignment = VerticalAlignment.Bottom,
                Origin = new PointF(sx + shadowOffset, sy + shadowOffset)
            };
            ctx.DrawText(shadow, text, Brushes.Solid(TextShadow));
            ctx.DrawText(options, text, Brushes.Solid(fill));
        }

        private static float MeasureWidth(Font font, string text) =>
            TextMeasurer.MeasureSize(text, new TextOptions(font)).Width;

        private static string TruncateToWidth(Font font, string text, float maxWidth)
        {
            if (MeasureWidth(font, text) <= maxWidth)
            {
                return text;
            }
            var ellipsis = "…";
            while (text.Length > 1 && MeasureWidth(font, text + ellipsis) > maxWidth)
            {
                text = text[..^1];
            }
            return text + ellipsis;
        }

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
}
