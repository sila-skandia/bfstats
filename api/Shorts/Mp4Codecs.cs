using System.Buffers.Binary;
using System.Text;

namespace api.Shorts;

/// <summary>
/// The codecs an MP4 holds, read from each track's sample description (<c>moov/trak/mdia/minf/stbl/stsd</c>),
/// no decoder. A browser's MediaRecorder asked for a bare <c>video/mp4</c> writes VP9 and Opus into it in
/// Firefox and in Chromium builds without an H.264 encoder, and no iPhone plays that (2026-11-19, a studio
/// share that would not play on iOS). A studio share must be H.264 with AAC sound, or none.
/// </summary>
public static class Mp4Codecs
{
    private const long MaxMoovBytes = 32L * 1024 * 1024;
    private static readonly HashSet<string> Path = ["moov", "trak", "mdia", "minf", "stbl"];

    /// <summary>Video sample entries an iPhone plays.</summary>
    public static readonly HashSet<string> PlayableVideo = ["avc1", "avc3"];

    /// <summary>The sample entry fourcc of each track (<c>avc1</c>, <c>vp09</c>, <c>mp4a</c>, <c>Opus</c>...),
    /// or empty when the file holds no moov it can read.</summary>
    public static async Task<List<string>> ReadAsync(string path, CancellationToken ct)
    {
        await using var source = File.OpenRead(path);
        var length = source.Length;
        long at = 0;
        var head = new byte[16];
        while (at + 8 <= length)
        {
            source.Position = at;
            var got = await source.ReadAtLeastAsync(head, 8, throwOnEndOfStream: false, ct);
            if (got < 8) break;
            long size = BinaryPrimitives.ReadUInt32BigEndian(head);
            var type = Encoding.ASCII.GetString(head, 4, 4);
            var header = 8;
            if (size == 1)
            {
                if (got < 16) break;
                size = (long)BinaryPrimitives.ReadUInt64BigEndian(head.AsSpan(8));
                header = 16;
            }
            else if (size == 0)
            {
                size = length - at;
            }
            if (size < header || at + size > length) break;
            if (type == "moov")
            {
                if (size > MaxMoovBytes) break;
                var payload = new byte[size - header];
                source.Position = at + header;
                await source.ReadExactlyAsync(payload, ct);
                var found = new List<string>();
                Walk(payload, found);
                return found;
            }
            at += size;
        }
        return [];
    }

    /// <summary>Why a studio share would not play on every phone, or null when it will (or when no
    /// sample description could be read, which says nothing either way).</summary>
    public static string? Unplayable(IReadOnlyList<string> codecs)
    {
        var video = codecs.Where(c => c is not ("mp4a" or "Opus" or "opus" or "ac-3" or "ec-3")).ToList();
        var audio = codecs.Except(video).ToList();
        if (video.Any(c => !PlayableVideo.Contains(c)) || audio.Any(c => c != "mp4a"))
        {
            return $"That clip is {string.Join(" and ", codecs.Select(Name).Distinct())} inside an MP4, which iPhones cannot play. "
                + "Record it in Chrome, Edge or Safari, which record H.264.";
        }
        return null;
    }

    private static string Name(string fourcc) => fourcc switch
    {
        "vp09" => "VP9",
        "vp08" => "VP8",
        "av01" => "AV1",
        "Opus" or "opus" => "Opus",
        "mp4a" => "AAC",
        "avc1" or "avc3" => "H.264",
        "hvc1" or "hev1" => "HEVC",
        _ => fourcc,
    };

    private static void Walk(ReadOnlySpan<byte> payload, List<string> found)
    {
        var at = 0;
        while (at + 8 <= payload.Length)
        {
            long size = BinaryPrimitives.ReadUInt32BigEndian(payload[at..]);
            var type = Encoding.ASCII.GetString(payload.Slice(at + 4, 4));
            var header = 8;
            if (size == 1)
            {
                if (at + 16 > payload.Length) return;
                size = (long)BinaryPrimitives.ReadUInt64BigEndian(payload[(at + 8)..]);
                header = 16;
            }
            else if (size == 0)
            {
                size = payload.Length - at;
            }
            if (size < header || at + size > payload.Length) return;
            var body = payload.Slice(at + header, (int)size - header);
            if (Path.Contains(type))
            {
                Walk(body, found);
            }
            else if (type == "stsd" && body.Length >= 16)
            {
                // Full box (4), entry count (4), then the first entry's size (4) and fourcc (4).
                found.Add(Encoding.ASCII.GetString(body.Slice(12, 4)));
            }
            at += (int)size;
        }
    }
}
