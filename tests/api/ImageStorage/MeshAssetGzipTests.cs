using System.IO.Compression;
using api.ImageStorage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.ImageStorage;

/// <summary>
/// The mesh route sends the <c>.glb.gz</c> the pipeline writes beside a glb to a client that
/// takes gzip, as nginx's gzip_static does on mesh.bfstats.io (features/mesh-asset-size), and
/// the plain glb whenever the copy is missing, is not of this glb, or is not wanted.
/// </summary>
[Collection(SharedAssetsPath.Name)]
public sealed class MeshAssetGzipTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly string glbPath;
    private readonly byte[] glb = [.. Enumerable.Range(0, 4000).Select(i => (byte)(i % 7))];

    public MeshAssetGzipTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-mesh-gzip-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "mesh", "maps", "bocage"));
        glbPath = Path.Combine(assetsRoot, "mesh", "maps", "bocage", "scene.glb");
        File.WriteAllBytes(glbPath, glb);
        WriteGzip(glb);

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);
    }

    [Fact]
    public async Task AClientThatTakesGzipGetsThePrecompressedCopy()
    {
        var (controller, file) = await Get("gzip, deflate, br");

        Assert.Equal("gzip", controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb.Length.ToString(), controller.Response.Headers["X-File-Size"].ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.Equal("model/gltf-binary", file.ContentType);
        Assert.False(file.EnableRangeProcessing);
        Assert.Equal(glb, await Inflate(file.FileStream));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("br")]
    [InlineData("gzip;q=0")]
    public async Task AnyOtherClientGetsThePlainGlb(string? acceptEncoding)
    {
        var (controller, file) = await Get(acceptEncoding);

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.True(file.EnableRangeProcessing);
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task ACopyOfAnotherLengthIsNotSent()
    {
        WriteGzip([1, 2, 3]);

        var (controller, file) = await Get("gzip");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task ACopyOlderThanItsGlbIsNotSent()
    {
        File.SetLastWriteTimeUtc(glbPath + ".gz", File.GetLastWriteTimeUtc(glbPath).AddMinutes(-5));

        var (controller, file) = await Get("gzip");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task AGlbWithNoCopyIsSentPlain()
    {
        File.Delete(glbPath + ".gz");

        var (controller, file) = await Get("gzip");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(glb, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task OtherMeshFilesAreNeverSwapped()
    {
        var json = Path.Combine(assetsRoot, "mesh", "maps", "maps.json");
        await File.WriteAllTextAsync(json, "[]");
        await File.WriteAllBytesAsync(json + ".gz", Gzip("[]"u8.ToArray()));
        var controller = Controller("gzip");

        var file = Assert.IsType<FileStreamResult>(await controller.GetMeshAsset("maps/maps.json"));

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Empty(controller.Response.Headers.Vary.ToString());
        Assert.Equal("[]"u8.ToArray(), await ReadAll(file.FileStream));
    }

    private async Task<(AssetsController, FileStreamResult)> Get(string? acceptEncoding)
    {
        var controller = Controller(acceptEncoding);
        var result = await controller.GetMeshAsset("maps/bocage/scene.glb");
        return (controller, Assert.IsType<FileStreamResult>(result));
    }

    private static AssetsController Controller(string? acceptEncoding)
    {
        var context = new DefaultHttpContext();
        if (acceptEncoding is not null)
            context.Request.Headers.AcceptEncoding = acceptEncoding;
        return new AssetsController(
            new AssetServingService(NullLogger<AssetServingService>.Instance),
            Substitute.For<IMapImageResolver>())
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    private void WriteGzip(byte[] content)
    {
        File.WriteAllBytes(glbPath + ".gz", Gzip(content));
        // The pipeline writes the copy after its glb.
        File.SetLastWriteTimeUtc(glbPath + ".gz", File.GetLastWriteTimeUtc(glbPath).AddSeconds(1));
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
