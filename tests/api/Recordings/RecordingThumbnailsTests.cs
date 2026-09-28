using api.Recordings;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;

namespace api.tests.Recordings;

public class RecordingThumbnailsTests
{
    private static async Task<MemoryStream> Encoded(Image image, Func<Image, Stream, Task> save)
    {
        var stream = new MemoryStream();
        await save(image, stream);
        stream.Position = 0;
        return stream;
    }

    /// <summary>ImageSharp decodes every frame by default, each the size of the whole canvas:
    /// a cover is read one frame deep, however many it holds.</summary>
    [Fact]
    public async Task Decoding_ReadsOneFrameOfAnAnimatedImage()
    {
        using var animated = new Image<Rgba32>(256, 256, new Rgba32(40, 60, 90, 255));
        for (var i = 0; i < 5; i++)
        {
            using var frame = new Image<Rgba32>(256, 256, new Rgba32((byte)(i * 40), 60, 90, 255));
            animated.Frames.AddFrame(frame.Frames.RootFrame);
        }
        await using var apng = await Encoded(animated, (image, stream) => image.SaveAsPngAsync(stream, new PngEncoder()));
        Assert.Equal(6, (await Image.LoadAsync(apng)).Frames.Count);
        apng.Position = 0;

        using var read = await Image.LoadAsync(RecordingThumbnails.Decoding, apng);
        Assert.Equal(1, read.Frames.Count);

        apng.Position = 0;
        var jpeg = await RecordingThumbnails.NormalizeAsync(apng, CancellationToken.None);
        Assert.Equal([0xFF, 0xD8, 0xFF], jpeg[..3]);
    }

    [Fact]
    public async Task Normalize_RefusesFormatsACanvasDoesNotWrite()
    {
        using var image = new Image<Rgba32>(64, 64, new Rgba32(40, 60, 90, 255));
        await using var gif = await Encoded(image, (i, s) => i.SaveAsGifAsync(s));
        await using var bmp = await Encoded(image, (i, s) => i.SaveAsBmpAsync(s));
        await using var tiff = await Encoded(image, (i, s) => i.SaveAsTiffAsync(s));

        foreach (var stream in new[] { gif, bmp, tiff })
        {
            var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
                () => RecordingThumbnails.NormalizeAsync(stream, CancellationToken.None));
            Assert.Contains("not an image", ex.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Normalize_RefusesACoverWiderThanAnyTheDialogsSend()
    {
        using var image = new Image<Rgba32>(RecordingThumbnails.MaxSide + 1, 64, new Rgba32(40, 60, 90, 255));
        await using var png = await Encoded(image, (i, s) => i.SaveAsPngAsync(s));

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => RecordingThumbnails.NormalizeAsync(png, CancellationToken.None));

        Assert.Contains("pixels a side", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Normalize_KeepsNothingButThePixels()
    {
        using var image = new Image<Rgba32>(320, 180, new Rgba32(40, 60, 90, 255));
        image.Metadata.ExifProfile = new ExifProfile();
        image.Metadata.ExifProfile.SetValue(ExifTag.Artist, "someone's name");
        image.Metadata.ExifProfile.SetValue(ExifTag.GPSLatitudeRef, "S");
        await using var jpeg = await Encoded(image, (i, s) => i.SaveAsJpegAsync(s));

        var normalized = await RecordingThumbnails.NormalizeAsync(jpeg, CancellationToken.None);

        using var kept = Image.Load(normalized);
        Assert.Null(kept.Metadata.ExifProfile);
        Assert.Equal(320, kept.Width);
    }
}
