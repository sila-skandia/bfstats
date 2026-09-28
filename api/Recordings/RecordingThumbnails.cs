using Microsoft.AspNetCore.Http;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace api.Recordings;

/// <summary>
/// A recording's cover: a frame of the replay, grabbed in the browser that watched it. What
/// arrives is decoded and written out afresh as a JPEG no wider than
/// <see cref="Width"/>, so what the feed serves is an image this code made, whatever was
/// sent.
/// </summary>
public static class RecordingThumbnails
{
    public const int Width = 640;
    public const int MaxBytes = 1024 * 1024;
    private const int MaxSide = 4096;

    /// <summary>
    /// How a cover is read: the formats a browser's canvas writes, one frame of it, and none
    /// of its metadata. ImageSharp decodes every frame by default, each at the full canvas,
    /// so an animated image of a few hundred frames that fits in a megabyte would take
    /// gigabytes; and what an image carries besides its pixels is not the feed's to serve.
    /// </summary>
    internal static readonly DecoderOptions Decoding = new()
    {
        Configuration = new Configuration(new JpegConfigurationModule(), new PngConfigurationModule(), new WebpConfigurationModule()),
        MaxFrames = 1,
        SkipMetadata = true,
    };

    public static async Task<byte[]> NormalizeAsync(Stream body, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await body.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > MaxBytes)
            {
                throw new RecordingRejectedException("A thumbnail can be at most 1 MB.", StatusCodes.Status413PayloadTooLarge);
            }
            await buffer.WriteAsync(chunk.AsMemory(0, read), ct);
        }
        buffer.Position = 0;
        try
        {
            var info = await Image.IdentifyAsync(Decoding, buffer, ct);
            if (info.Width is < 16 or > MaxSide || info.Height is < 16 or > MaxSide)
            {
                throw new RecordingRejectedException("A thumbnail must be between 16 and 4096 pixels a side.");
            }
            buffer.Position = 0;
            using var image = await Image.LoadAsync(Decoding, buffer, ct);
            if (image.Width > Width) image.Mutate(x => x.Resize(Width, 0));
            using var output = new MemoryStream();
            await image.SaveAsJpegAsync(output, new JpegEncoder { Quality = 82 }, ct);
            return output.ToArray();
        }
        catch (Exception ex) when (ex is UnknownImageFormatException or InvalidImageContentException or NotSupportedException)
        {
            throw new RecordingRejectedException("The thumbnail is not an image.", ex);
        }
    }
}
