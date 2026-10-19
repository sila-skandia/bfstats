using System.IO.Compression;
using api.ImageStorage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.ImageStorage;

/// <summary>
/// The mesh route prefers the <c>.glb.br</c> the pipeline writes beside the biggest glbs
/// (features/mesh-asset-size, phase 2b) for a client that takes brotli, as nginx's
/// brotli_static does on mesh.bfstats.io, falling back to the <c>.glb.gz</c> and then the
/// plain glb. Brotli has no trailer, so the pipeline opens every stream with an RFC 7932
/// metadata meta-block naming the glb's CRC-32 and length; the route checks that record's
/// length and the copy's mtime, exactly the gzip checks at the same cost.
/// </summary>
[Collection(SharedAssetsPath.Name)]
public sealed class MeshAssetBrotliTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly string glbPath;
    private readonly byte[] glb = [.. Enumerable.Range(0, 4000).Select(i => (byte)(i % 7))];

    public MeshAssetBrotliTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-mesh-brotli-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "mesh", "maps", "tobruk"));
        glbPath = Path.Combine(assetsRoot, "mesh", "maps", "tobruk", "scene.glb");
        File.WriteAllBytes(glbPath, glb);
        WriteCopy(".gz", Gzip(glb));
        WriteCopy(".br", Brotli(glb.Length));

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);
    }

    [Theory]
    [InlineData("gzip, deflate, br")]
    [InlineData("br")]
    [InlineData("gzip, deflate, br;q=1.0, zstd;q=0.8")]
    public async Task AClientThatTakesBrotliGetsTheBrotliCopy(string acceptEncoding)
    {
        var (controller, file) = await Get(acceptEncoding);

        Assert.Equal("br", controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb.Length.ToString(), controller.Response.Headers["X-File-Size"].ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.Equal("model/gltf-binary", file.ContentType);
        Assert.False(file.EnableRangeProcessing);
        Assert.Equal(await File.ReadAllBytesAsync(glbPath + ".br"), await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task AGzipOnlyClientStillGetsTheGzipCopy()
    {
        var (controller, file) = await Get("gzip");

        Assert.Equal("gzip", controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await Inflate(file.FileStream));
    }

    [Fact]
    public async Task WithoutABrotliCopyABrotliClientFallsBackToGzip()
    {
        File.Delete(glbPath + ".br");

        var (controller, file) = await Get("gzip, br");

        Assert.Equal("gzip", controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await Inflate(file.FileStream));
    }

    [Fact]
    public async Task ACopyRecordingAnotherLengthIsNotSent()
    {
        WriteCopy(".br", Brotli(glb.Length - 1));

        var (controller, file) = await Get("br");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task AStreamWithoutThePipelineRecordIsNotSent()
    {
        // A hand-made `brotli scene.glb` has no metadata block: never swapped in.
        using (var buffer = new MemoryStream())
        {
            using (var brotli = new BrotliStream(buffer, CompressionLevel.Optimal, leaveOpen: true))
                brotli.Write(glb);
            WriteCopy(".br", buffer.ToArray());
        }

        var (controller, file) = await Get("br");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task ACopyOlderThanItsGlbIsNotSent()
    {
        File.SetLastWriteTimeUtc(glbPath + ".br", File.GetLastWriteTimeUtc(glbPath).AddMinutes(-5));

        var (controller, file) = await Get("br");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    private async Task<(AssetsController, FileStreamResult)> Get(string acceptEncoding)
    {
        var context = new DefaultHttpContext();
        context.Request.Headers.AcceptEncoding = acceptEncoding;
        var controller = new AssetsController(
            new AssetServingService(NullLogger<AssetServingService>.Instance),
            Substitute.For<IMapImageResolver>())
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
        var result = await controller.GetMeshAsset("maps/tobruk/scene.glb");
        return (controller, Assert.IsType<FileStreamResult>(result));
    }

    private void WriteCopy(string suffix, byte[] content)
    {
        File.WriteAllBytes(glbPath + suffix, content);
        // The pipeline writes the copies after their glb.
        File.SetLastWriteTimeUtc(glbPath + suffix, File.GetLastWriteTimeUtc(glbPath).AddSeconds(1));
    }

    /// <summary>
    /// The first bytes of a pipeline `.br` (bf42/glbbr.py), byte for byte: the WBITS code
    /// for window 24, a metadata meta-block skipping 16 bytes, then the payload naming
    /// <paramref name="recordedLength"/>. The route reads only this record, so the stream
    /// body past it is immaterial here; the real decode path is covered by the pipeline's
    /// own tests and the headless viewer check.
    /// </summary>
    private static byte[] Brotli(long recordedLength)
    {
        long bits = 0b1111;              // WBITS code: window 24 ('1' + 0b111)
        int at = 4 + 1;                  // ISLAST 0
        bits |= 3L << at; at += 2;       // MNIBBLES code 3: a metadata block
        at += 1;                         // reserved 0
        bits |= 1L << at; at += 2;       // MSKIPBYTES 1
        bits |= 15L << at; at += 8;      // MSKIPLEN - 1
        var header = new byte[(at + 7) / 8];
        for (int i = 0; i < header.Length; i++)
            header[i] = (byte)(bits >> (8 * i));
        return
        [
            .. header,
            .. "GBR1"u8.ToArray(),
            .. BitConverter.GetBytes(0xDEADBEEFu),           // the CRC the route never reads
            .. BitConverter.GetBytes(recordedLength),
            .. new byte[64],                                 // stand-in for the compressed stream
        ];
    }

    private static byte[] Gzip(byte[] content)
    {
        using var buffer = new MemoryStream();
        using (var gzip = new GZipStream(buffer, CompressionLevel.SmallestSize))
            gzip.Write(content);
        return buffer.ToArray();
    }

    private static async Task<byte[]> Inflate(Stream stream)
    {
        await using var gzip = new GZipStream(stream, CompressionMode.Decompress);
        return await ReadAll(gzip);
    }

    private static async Task<byte[]> ReadAll(Stream stream)
    {
        await using (stream)
        {
            using var buffer = new MemoryStream();
            await stream.CopyToAsync(buffer);
            return buffer.ToArray();
        }
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        if (Directory.Exists(assetsRoot))
            Directory.Delete(assetsRoot, recursive: true);
    }
}
