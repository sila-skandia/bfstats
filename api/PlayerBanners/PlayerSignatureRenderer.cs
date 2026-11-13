using api.PlayerBanners.Models;
using api.Signatures;
using api.Signatures.Models;
using api.Utils;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;

namespace api.PlayerBanners;

/// <summary>
/// A player's forum signature: the mod's posed hero on the right over the level's graded
/// loading screen (<see cref="SignatureCanvas"/>), and on the left the mod tag, the player's
/// name, the server the stats are scoped to, and four readouts: K/D, kills, score, hours.
/// </summary>
public sealed class PlayerSignatureRenderer(SignatureCanvas canvas)
{
    // The words stop short of the hero, who starts around 60% across.
    private const float TextRight = 470f;

    public async Task<byte[]> RenderAsync(BannerStats stats, SignatureArt art, int width, CancellationToken ct = default)
    {
        using var frame = await canvas.BeginAsync(art, null, null, width, ct);
        frame.Paint(c =>
        {
            frame.Tag(c, art.Mod.Short, art.Scene.Label);

            var name = PlayerNameDecoder.Decode(stats.PlayerName);
            var nameFont = frame.Fit(name, 46f, 20f, TextRight - 24f);
            frame.Text(c, frame.Clip(name, nameFont, TextRight - 24f), nameFont, 24f, 86f, SignatureCanvas.Gold, 2.2f);
            frame.Rule(c, 24f, 95f, 56f);

            if (!string.IsNullOrWhiteSpace(stats.ServerName))
            {
                var font = frame.Label(11f);
                var server = PlayerNameDecoder.Decode(stats.ServerName!).ToUpperInvariant();
                frame.Text(c, frame.Clip(server, font, TextRight - 90f), font, 90f, 100.5f, SignatureCanvas.InkMuted, 1f);
            }

            var blocks = new (string Label, string Value, Color Colour)[]
            {
                ("K/D", stats.KdRatio.ToString("0.00"), SignatureCanvas.Gold),
                ("KILLS", Format.Count(stats.TotalKills), SignatureCanvas.Ink),
                ("SCORE", Format.Count(stats.TotalScore), SignatureCanvas.Ink),
                ("HOURS", Format.Hours(stats.TotalHours), SignatureCanvas.Ink),
            };
            Readouts(frame, c, blocks, 24f, 140f, 178f, 27f);
            frame.Watermark(c);
        });
        return await frame.EncodeAsync(ct);
    }

    /// <summary>A row of label-over-value readouts with hairline separators.</summary>
    internal static void Readouts(SignatureCanvas.Frame frame, DrawingCanvas c,
        IEnumerable<(string Label, string Value, Color Colour)> blocks, float x, float labelY, float valueY, float valueSize)
    {
        var labelFont = frame.Label(9.5f);
        var valueFont = frame.Display(valueSize);
        var first = true;
        foreach (var (label, value, colour) in blocks)
        {
            if (!first)
            {
                c.DrawLine(Pens.Solid(BannerColor.Rgba(255, 255, 255, 40), frame.U(1f)),
                    frame.P(x - 13f, labelY - 9f), frame.P(x - 13f, valueY - 2f));
            }
            first = false;
            frame.Text(c, label, labelFont, x, labelY, SignatureCanvas.InkMuted, 1f);
            frame.Text(c, value, valueFont, x, valueY, colour, 1.8f);
            var w = Math.Max(frame.Width(label, labelFont), frame.Width(value, valueFont)) / frame.Scale;
            x += w + 26f;
        }
    }
}
