using api.ImageStorage;
using api.PlayerBanners;
using api.Signatures.Models;
using SixLabors.Fonts;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing;
using SixLabors.ImageSharp.Drawing.Processing;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace api.Signatures;

/// <summary>
/// The look every forum signature shares. Back to front: the level's loading screen, graded
/// down to a dark, cool, desaturated plate with the text side pushed near black; a mod-coloured
/// slash; the posed hero (a soldier, tank or aircraft drawn from the mesh viewer's models, its
/// muzzle flash and tracers already painted on) on the right; scanlines and grain; then the
/// words, which each renderer lays out on the left. Authored at
/// <see cref="DesignWidth"/> x <see cref="DesignHeight"/> and drawn crisply at any width the
/// caller asks for. See features/forum-signatures/README.md.
/// </summary>
public sealed class SignatureCanvas(BannerFonts fonts, IMapImageResolver maps)
{
    public const int DesignWidth = 800;
    public const int DesignHeight = 200;
    public const int MinWidth = 320;
    public const int MaxWidth = 1600;
    public const int DefaultWidth = DesignWidth;

    public static readonly Color Ink = BannerColor.Rgba(244, 240, 228, 255);
    public static readonly Color InkMuted = BannerColor.Rgba(176, 170, 152, 255);
    public static readonly Color Gold = BannerColor.Rgba(255, 196, 0, 255);
    public static readonly Color Shadow = BannerColor.Rgba(0, 0, 0, 215);

    public static int ClampWidth(int width) => Math.Clamp(width, MinWidth, MaxWidth);

    public BannerFonts Fonts => fonts;

    /// <summary>
    /// A frame for one signature: the backdrop and hero already composited, ready for
    /// <see cref="Frame.Paint"/> to lay the words over. The caller disposes it.
    /// </summary>
    public async Task<Frame> BeginAsync(SignatureArt art, string? gameId, string? mapName, int width,
        CancellationToken ct = default)
    {
        var s = ClampWidth(width) / (float)DesignWidth;
        var w = (int)MathF.Round(DesignWidth * s);
        var h = (int)MathF.Round(DesignHeight * s);
        var accent = ParseAccent(art.Mod.Accent);

#pragma warning disable CA2000 // Ownership passes to the Frame, which the caller disposes.
        var image = new Image<Rgba32>(w, h, BannerColor.Rgba(12, 13, 11, 255).ToPixel<Rgba32>());
#pragma warning restore CA2000
        try
        {
            await DrawBackdropAsync(image, art, gameId, mapName, ct);
            image.Mutate(ctx => ctx.Paint(canvas => Grade(canvas, w, h, s, accent)));
            await DrawHeroAsync(image, art, ct);
            image.Mutate(ctx => ctx.Paint(canvas => Texture(canvas, w, h, s)));
        }
        catch
        {
            image.Dispose();
            throw;
        }
        return new Frame(image, s, accent, fonts);
    }

    /// <summary>The level's loading screen, cover-fitted and graded; a plain plate when there is none.</summary>
    private async Task DrawBackdropAsync(Image<Rgba32> image, SignatureArt art, string? gameId, string? mapName,
        CancellationToken ct)
    {
        var path = BackdropPath(art, gameId, mapName);
        if (path is null)
            return;

        try
        {
            using var plate = await Image.LoadAsync<Rgba32>(path, ct);
            plate.Mutate(ctx => ctx
                .Resize(new ResizeOptions
                {
                    Size = new Size(image.Width, image.Height),
                    Mode = ResizeMode.Crop,
                    // Loading screens put their subject in the middle; keep a little above it.
                    CenterCoordinates = new PointF(0.55f, 0.42f)
                })
                .Saturate(0.55f)
                .Brightness(0.8f)
                .Contrast(1.12f)
                .GaussianBlur(Math.Max(0.6f, image.Width / 900f)));
            image.Mutate(ctx => ctx.DrawImage(plate, Point.Empty, 1f));
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            // A broken or missing screen costs the signature its backdrop, not the image.
        }
    }

    private string? BackdropPath(SignatureArt art, string? gameId, string? mapName)
    {
        var mapsRoot = TournamentImagesConfig.ResolveMapsPath();
        foreach (var (game, map) in Candidates(art, gameId, mapName))
        {
            var rel = maps.Resolve(game, map, MapImageKind.Loading);
            if (rel is null)
                continue;
            var full = System.IO.Path.Combine(mapsRoot, rel);
            if (File.Exists(full))
                return full;
        }
        return null;
    }

    /// <summary>The map asked for (a server's current map) in its own game, then the scene's own level.</summary>
    private static IEnumerable<(string Game, string Map)> Candidates(SignatureArt art, string? gameId, string? mapName)
    {
        var home = art.Mod.GameIds.Count > 0 ? art.Mod.GameIds[0] : art.Mod.Id;
        var game = string.IsNullOrWhiteSpace(gameId) ? home : gameId;
        if (!string.IsNullOrWhiteSpace(mapName))
            yield return (game, mapName);
        if (!string.IsNullOrWhiteSpace(art.Scene.Backdrop))
            yield return (home, art.Scene.Backdrop);
    }

    /// <summary>
    /// Pushes the text side toward black, keeps the hero side open, cools the shadows and
    /// cuts a mod-coloured slash behind where the hero stands.
    /// </summary>
    private static void Grade(DrawingCanvas canvas, int w, int h, float s, Color accent)
    {
        var full = new RectanglePolygon(0, 0, w, h);
        // A cool cast over the whole plate: blue-green shadows read as dusk, not mud.
        canvas.Fill(Brushes.Solid(BannerColor.Rgba(10, 22, 30, 70)), full);

        canvas.Fill(new LinearGradientBrush(new PointF(0, 0), new PointF(w, 0), GradientRepetitionMode.None,
            new ColorStop(0f, BannerColor.Rgba(6, 7, 6, 225)),
            new ColorStop(0.42f, BannerColor.Rgba(6, 7, 6, 170)),
            new ColorStop(0.66f, BannerColor.Rgba(6, 7, 6, 60)),
            new ColorStop(1f, BannerColor.Rgba(6, 7, 6, 40))), full);

        var (r, g, b) = Rgb(accent);
        // The slash: two parallelograms leaning forward, behind the hero.
        var x0 = 0.60f * w;
        Slash(canvas, x0, 0.075f * w, h, BannerColor.Rgba(r, g, b, 46));
        Slash(canvas, x0 + 0.095f * w, 0.018f * w, h, BannerColor.Rgba(r, g, b, 90));

        // A warm glow where the hero stands, so the figure reads off a dark plate.
        canvas.Fill(new RadialGradientBrush(new PointF(0.80f * w, 0.55f * h), 0.42f * w, GradientRepetitionMode.None,
            new ColorStop(0f, BannerColor.Rgba(255, 196, 120, 30)),
            new ColorStop(1f, BannerColor.Rgba(0, 0, 0, 0))), full);

        // Top and bottom burn.
        canvas.Fill(new LinearGradientBrush(new PointF(0, 0), new PointF(0, h), GradientRepetitionMode.None,
            new ColorStop(0f, BannerColor.Rgba(0, 0, 0, 120)),
            new ColorStop(0.22f, BannerColor.Rgba(0, 0, 0, 0)),
            new ColorStop(0.75f, BannerColor.Rgba(0, 0, 0, 0)),
            new ColorStop(1f, BannerColor.Rgba(0, 0, 0, 150))), full);
        _ = s;
    }

    private static void Slash(DrawingCanvas canvas, float x, float width, float h, Color colour)
    {
        var lean = h * 0.42f;
        canvas.Fill(Brushes.Solid(colour), new Polygon(new LinearLineSegment(
            new PointF(x + lean, 0), new PointF(x + lean + width, 0),
            new PointF(x + width, h), new PointF(x, h))));
    }

    /// <summary>The hero art on the right: scaled to the full height, right-aligned.</summary>
    private static async Task DrawHeroAsync(Image<Rgba32> image, SignatureArt art, CancellationToken ct)
    {
        if (!File.Exists(art.HeroPath))
            return;

        using var hero = await Image.LoadAsync<Rgba32>(art.HeroPath, ct);
        var heroH = image.Height;
        var heroW = (int)MathF.Round(hero.Width * heroH / (float)hero.Height);
        hero.Mutate(ctx => ctx.Resize(heroW, heroH, KnownResamplers.Lanczos3));
        image.Mutate(ctx => ctx.DrawImage(hero, new Point(image.Width - heroW, 0), 1f));
    }

    /// <summary>Scanlines and a hairline frame with corner ticks: the HUD read.</summary>
    private static void Texture(DrawingCanvas canvas, int w, int h, float s)
    {
        var line = Pens.Solid(BannerColor.Rgba(0, 0, 0, 34), Math.Max(1f, s));
        var step = Math.Max(3f, 3f * s);
        for (var y = 0f; y < h; y += step)
            canvas.DrawLine(line, new PointF(0, y), new PointF(w, y));

        canvas.Draw(Pens.Solid(BannerColor.Rgba(255, 255, 255, 26), Math.Max(1f, s)),
            new RectanglePolygon(0.5f, 0.5f, w - 1, h - 1));
    }

    public static Color ParseAccent(string? hex)
    {
        if (hex is { Length: 7 } && hex[0] == '#'
            && byte.TryParse(hex.AsSpan(1, 2), System.Globalization.NumberStyles.HexNumber, null, out var r)
            && byte.TryParse(hex.AsSpan(3, 2), System.Globalization.NumberStyles.HexNumber, null, out var g)
            && byte.TryParse(hex.AsSpan(5, 2), System.Globalization.NumberStyles.HexNumber, null, out var b))
            return BannerColor.Rgba(r, g, b, 255);
        return Gold;
    }

    public static (byte R, byte G, byte B) Rgb(Color colour)
    {
        var px = colour.ToPixel<Rgba32>();
        return (px.R, px.G, px.B);
    }

    /// <summary>
    /// One signature being drawn: the composited image, its scale and the mod accent, with the
    /// text helpers both layouts use. Coordinates are in design units (800 x 200).
    /// </summary>
    public sealed class Frame(Image<Rgba32> image, float s, Color accent, BannerFonts fonts) : IDisposable
    {
        public Image<Rgba32> Image => image;
        public Color Accent => accent;
        public float Scale => s;

        public void Paint(CanvasAction draw) => image.Mutate(ctx => ctx.Paint(draw));

        public float U(float v) => v * s;
        public PointF P(float x, float y) => new(x * s, y * s);
        public RectanglePolygon Rect(float x, float y, float w, float h) => new(x * s, y * s, w * s, h * s);

        public Font Display(float size) => fonts.Display(size * s);
        public Font Label(float size) => fonts.Label(size * s);

        /// <summary>The largest size from <paramref name="start"/> down at which the text fits <paramref name="maxWidth"/>.</summary>
        public Font Fit(string text, float start, float min, float maxWidth, bool display = true)
        {
            for (var size = start; size > min; size -= 1f)
            {
                var font = display ? Display(size) : Label(size);
                if (Width(text, font) <= U(maxWidth))
                    return font;
            }
            return display ? Display(min) : Label(min);
        }

        /// <summary>The text cut with an ellipsis so it fits <paramref name="maxWidth"/> at this font.</summary>
        public string Clip(string text, Font font, float maxWidth)
        {
            if (Width(text, font) <= U(maxWidth))
                return text;
            for (var n = text.Length - 1; n > 1; n--)
            {
                var cut = text[..n].TrimEnd() + "...";
                if (Width(cut, font) <= U(maxWidth))
                    return cut;
            }
            return text[..1];
        }

        public float Width(string text, Font font) => BannerColor.Measure(text, new TextOptions(font)).Width;

        /// <summary>Text with a hard drop shadow, left/baseline anchored at a design point.</summary>
        public void Text(DrawingCanvas canvas, string text, Font font, float x, float y, Color fill,
            float shadow = 1.6f, HorizontalAlignment align = HorizontalAlignment.Left)
        {
            var at = P(x, y);
            var off = U(shadow);
            canvas.DrawText(new RichTextOptions(font)
            {
                Origin = new PointF(at.X + off, at.Y + off),
                HorizontalAlignment = align,
                VerticalAlignment = VerticalAlignment.Bottom
            }, text, Brushes.Solid(Shadow), null);
            canvas.DrawText(new RichTextOptions(font)
            {
                Origin = at,
                HorizontalAlignment = align,
                VerticalAlignment = VerticalAlignment.Bottom
            }, text, Brushes.Solid(fill), null);
        }

        /// <summary>
        /// The mod's tag, top left: a forward-leaning accent block holding the mod's short name,
        /// then the scene's caption in muted caps. Returns where the caption ended.
        /// </summary>
        public float Tag(DrawingCanvas canvas, string mod, string caption, float x = 24, float y = 16)
        {
            var font = Label(10.5f);
            var text = mod.ToUpperInvariant();
            var tw = Width(text, font) / s;
            const float h = 17f, pad = 8f, lean = 5f;
            canvas.Fill(Brushes.Solid(accent), new Polygon(new LinearLineSegment(
                P(x + lean, y), P(x + tw + pad * 2 + lean, y), P(x + tw + pad * 2, y + h), P(x, y + h))));
            canvas.DrawText(new RichTextOptions(font)
            {
                Origin = P(x + pad + lean / 2, y + h - 4.2f),
                VerticalAlignment = VerticalAlignment.Bottom
            }, text, Brushes.Solid(BannerColor.Rgba(14, 14, 12, 255)), null);
            var cx = x + tw + pad * 2 + lean + 8;
            var cap = caption.ToUpperInvariant();
            Text(canvas, cap, Label(10f), cx, y + h - 4.2f, InkMuted, 1f);
            return cx + Width(cap, Label(10f)) / s;
        }

        /// <summary>The site's mark, top right: the hero's sky is the emptiest corner.</summary>
        public void Watermark(DrawingCanvas canvas)
        {
            Text(canvas, "BFSTATS.IO", Label(9.5f), DesignWidth - 14, 22,
                BannerColor.Rgba(255, 196, 0, 210), 1f, HorizontalAlignment.Right);
        }

        /// <summary>A short accent rule: under the name, between the blocks.</summary>
        public void Rule(DrawingCanvas canvas, float x, float y, float length, float alpha = 1f)
        {
            var (r, g, b) = Rgb(accent);
            canvas.Fill(Brushes.Solid(BannerColor.Rgba(r, g, b, (byte)(255 * alpha))), Rect(x, y, length, 2.2f));
        }

        public async Task<byte[]> EncodeAsync(CancellationToken ct = default)
        {
            var ms = new MemoryStream();
            await image.SaveAsync(ms, new PngEncoder
            {
                ColorType = PngColorType.Rgb,
                CompressionLevel = PngCompressionLevel.BestCompression
            }, ct);
            return ms.ToArray();
        }

        public void Dispose() => image.Dispose();
    }
}
