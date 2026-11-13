using api.PlayerBanners;
using api.ServerBanners.Models;
using api.Signatures;
using api.Signatures.Models;
using api.Utils;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Drawing.Processing;

namespace api.ServerBanners;

/// <summary>
/// A server's live forum signature: the mod's posed hero over the loading screen of the map
/// the server is playing now (<see cref="SignatureCanvas"/>), and on the left the server's
/// name, whether it is up and what it is playing, and readouts for players, tickets and the
/// address to join.
/// </summary>
public sealed class ServerSignatureRenderer(SignatureCanvas canvas)
{
    private const float TextRight = 470f;

    private static readonly Color Live = BannerColor.Rgba(125, 200, 90, 255);
    private static readonly Color Down = BannerColor.Rgba(214, 90, 90, 255);
    private static readonly Color AxisRed = BannerColor.Rgba(232, 112, 100, 255);
    private static readonly Color AlliedGreen = BannerColor.Rgba(150, 196, 104, 255);

    public async Task<byte[]> RenderAsync(ServerBannerStats stats, SignatureArt art, int width, CancellationToken ct = default)
    {
        using var frame = await canvas.BeginAsync(art, stats.GameId, stats.Map, width, ct);
        frame.Paint(c =>
        {
            frame.Tag(c, art.Mod.Short, art.Scene.Label);

            var name = PlayerNameDecoder.Decode(stats.ServerName);
            var nameFont = frame.Fit(name, 34f, 17f, TextRight - 24f);
            frame.Text(c, frame.Clip(name, nameFont, TextRight - 24f), nameFont, 24f, 74f, SignatureCanvas.Ink, 2f);
            frame.Rule(c, 24f, 83f, 56f);

            StatusLine(frame, c, stats);

            var players = $"{stats.NumPlayers}/{stats.MaxPlayers}";
            var valueFont = frame.Display(27f);
            var playersWidth = frame.Width(players, valueFont) / frame.Scale;
            var blocks = new List<(string, string, Color)> { ("PLAYERS", players, SignatureCanvas.Gold) };
            if (stats.Tickets is { } t)
                blocks.Add(($"{Short(t.Team1Label)}  :  {Short(t.Team2Label)}", $"{t.Team1Tickets}:{t.Team2Tickets}",
                    t.Team1Tickets >= t.Team2Tickets ? AxisRed : AlliedGreen));
            PlayerSignatureRenderer.Readouts(frame, c, blocks, 24f, 140f, 178f, 27f);
            PlayersBar(frame, c, stats, playersWidth);

            Address(frame, c, stats.IpPort, blocks);
            frame.Watermark(c);
        });
        return await frame.EncodeAsync(ct);
    }

    /// <summary>"LIVE  BERLIN · CONQUEST", with a status dot.</summary>
    private static void StatusLine(SignatureCanvas.Frame frame, DrawingCanvas c, ServerBannerStats stats)
    {
        var colour = stats.IsOnline ? Live : Down;
        c.Fill(Brushes.Solid(colour), new SixLabors.ImageSharp.Drawing.EllipsePolygon(frame.P(28f, 99f), frame.U(3.6f)));
        var label = frame.Label(11f);
        var status = stats.IsOnline ? "LIVE" : "OFFLINE";
        frame.Text(c, status, label, 37f, 103.5f, colour, 1f);

        var map = string.IsNullOrWhiteSpace(stats.Map) ? null : stats.Map!.Replace('_', ' ').ToUpperInvariant();
        var mode = string.IsNullOrWhiteSpace(stats.GameMode) ? null : stats.GameMode!.ToUpperInvariant();
        var where = string.Join("  /  ", new[] { map, mode }.Where(v => v is not null));
        if (where.Length == 0)
            return;
        var x = 37f + frame.Width(status, label) / frame.Scale + 10f;
        frame.Text(c, frame.Clip(where, label, TextRight - x), label, x, 103.5f, SignatureCanvas.InkMuted, 1f);
    }

    /// <summary>A thin fill bar under the player count.</summary>
    private static void PlayersBar(SignatureCanvas.Frame frame, DrawingCanvas c, ServerBannerStats stats, float width)
    {
        if (stats.MaxPlayers <= 0)
            return;
        var fill = Math.Clamp(stats.NumPlayers / (float)stats.MaxPlayers, 0f, 1f);
        c.Fill(Brushes.Solid(BannerColor.Rgba(255, 255, 255, 40)), frame.Rect(24f, 183f, width, 2.5f));
        if (fill > 0)
            c.Fill(Brushes.Solid(SignatureCanvas.Gold), frame.Rect(24f, 183f, width * fill, 2.5f));
    }

    /// <summary>The join address as a smaller readout after the others.</summary>
    private static void Address(SignatureCanvas.Frame frame, DrawingCanvas c, string ipPort,
        IEnumerable<(string Label, string Value, Color Colour)> before)
    {
        var labelFont = frame.Label(9.5f);
        var valueFont = frame.Display(27f);
        var x = 24f;
        foreach (var (label, value, _) in before)
            x += Math.Max(frame.Width(label, labelFont), frame.Width(value, valueFont)) / frame.Scale + 26f;
        var ipFont = frame.Label(14f);
        if (x + frame.Width(ipPort, ipFont) / frame.Scale > TextRight + 40f)
            return;
        c.DrawLine(Pens.Solid(BannerColor.Rgba(255, 255, 255, 40), frame.U(1f)), frame.P(x - 13f, 131f), frame.P(x - 13f, 176f));
        frame.Text(c, "JOIN", labelFont, x, 140f, SignatureCanvas.InkMuted, 1f);
        frame.Text(c, ipPort, ipFont, x, 176f, SignatureCanvas.Ink, 1.2f);
    }

    private static string Short(string label) => label.Length > 8 ? label[..8] : label;
}
