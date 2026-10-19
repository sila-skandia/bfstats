using System.IO.Compression;
using System.Security.Cryptography;
using api.ImageStorage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.ImageStorage;

/// <summary>
/// Phase 5 of features/mesh-asset-size stores each distinct model, rig or pose glb once as
/// <c>glbs/&lt;sha256&gt;.glb</c> and records the name -> sha in the tree's manifests, so the
/// superseded per-tree copies can be garbage-collected from the volume. The mesh route must
/// then resolve a per-tree path that misses through the right manifest and serve the blob,
/// with the same headers and the same .gz pair checks as a path hit — and fall back to a
/// plain 404 exactly as today for a name no manifest hashes.
/// </summary>
[Collection(SharedAssetsPath.Name)]
public sealed class MeshGlbStoreFallbackTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly MeshGlbStoreResolver resolver = new(NullLogger<MeshGlbStoreResolver>.Instance);

    private readonly byte[] modelBlob = Payload(1);
    private readonly byte[] cockpitBlob = Payload(2);
    private readonly byte[] wreckBlob = Payload(3);
    private readonly byte[] rigBlob = Payload(4);
    private readonly byte[] poseBlob = Payload(5);
    private readonly byte[] modBlob = Payload(6);
    private readonly byte[] survivor = Payload(7);

    private readonly string modelSha, cockpitSha, wreckSha, rigSha, poseSha, modSha, survivorSha;

    public MeshGlbStoreFallbackTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-mesh-store-" + Guid.NewGuid().ToString("N"));
        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        modelSha = WriteBlob(modelBlob);
        cockpitSha = WriteBlob(cockpitBlob);
        wreckSha = WriteBlob(wreckBlob);
        rigSha = WriteBlob(rigBlob);
        poseSha = WriteBlob(poseBlob);
        modSha = WriteBlob(modBlob);
        survivorSha = WriteBlob(Payload(8));

        // Tiger's per-tree glb is GC'd; OnDisk.glb survived (its manifest sha points at other
        // bytes, which a path hit must never reach for).
        Write("mesh/models/models.json", $$"""
        [
          { "template": "Tiger", "glb": "Tiger.glb", "sha": "{{modelSha}}",
            "cockpit": "Tiger.cockpit.glb", "cockpitSha": "{{cockpitSha}}",
            "variants": [ { "glb": "Tiger.wreck.glb", "sha": "{{wreckSha}}" } ] },
          { "template": "OnDisk", "glb": "OnDisk.glb", "sha": "{{survivorSha}}" },
          { "template": "Unhashed", "glb": "Unhashed.glb" },
          { "template": "Evil", "glb": "Evil.glb", "sha": "../../../../etc/passwd" }
        ]
        """);
        WriteBytes("mesh/models/OnDisk.glb", survivor);

        Write("mesh/models/viewmodels/index.json", $$"""
        { "format": "bf1942-rig-index/1", "rigs": ["USSoldier__M16"],
          "sha": { "USSoldier__M16.fp.glb": "{{rigSha}}" } }
        """);

        Write("mesh/models/poses/index.json", $$"""
        { "format": "bf1942-pose-index/1", "glb": ["USSoldier__M16"],
          "sha": { "USSoldier__M16.pose.glb": "{{poseSha}}",
                   "rigs/USSoldier.rig.glb": "{{poseSha}}" } }
        """);

        Write("mesh/models/mods/xpack2/models.json", $$"""
        [ { "template": "Sturmtiger", "glb": "Sturmtiger.glb", "sha": "{{modSha}}" } ]
        """);
    }

    [Theory]
    [InlineData("models/Tiger.glb", 1)]
    [InlineData("models/Tiger.cockpit.glb", 2)]
    [InlineData("models/Tiger.wreck.glb", 3)]
    [InlineData("models/viewmodels/USSoldier__M16.fp.glb", 4)]
    [InlineData("models/poses/USSoldier__M16.pose.glb", 5)]
    [InlineData("models/poses/rigs/USSoldier.rig.glb", 5)]
    [InlineData("models/mods/xpack2/Sturmtiger.glb", 6)]
    public async Task AGcdPerTreeGlbIsServedFromItsStoreBlob(string path, int payload)
    {
        var (controller, file) = await Get(path);

        Assert.Equal(Payload(payload), await ReadAll(file.FileStream));
        // The per-tree policy, not the store's: the name can re-resolve on a republish.
        Assert.Equal("public, max-age=300, s-maxage=86400", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.Equal("model/gltf-binary", file.ContentType);
    }

    [Fact]
    public async Task APerTreeFileStillOnDiskWinsOverItsBlob()
    {
        var (_, file) = await Get("models/OnDisk.glb");

        Assert.Equal(survivor, await ReadAll(file.FileStream));
        Assert.Equal("OnDisk.glb", file.FileDownloadName);
    }

    [Fact]
    public async Task AGzipClientGetsTheBlobsPrecompressedCopy()
    {
        WriteBlobGzip(modelSha, modelBlob);

        var (controller, file) = await Get("models/Tiger.glb", "gzip");

        Assert.Equal("gzip", controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(modelBlob.Length.ToString(), controller.Response.Headers["X-File-Size"].ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
        Assert.False(file.EnableRangeProcessing);
        Assert.Equal(modelBlob, await Inflate(file.FileStream));
    }

    [Fact]
    public async Task ABlobCopyOlderThanItsBlobFallsBackToThePlainBlob()
    {
        WriteBlobGzip(modelSha, modelBlob);
        var blob = Path.Combine(assetsRoot, "mesh", "glbs", modelSha + ".glb");
        File.SetLastWriteTimeUtc(blob + ".gz", File.GetLastWriteTimeUtc(blob).AddMinutes(-5));

        var (controller, file) = await Get("models/Tiger.glb", "gzip");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(modelBlob, await ReadAll(file.FileStream));
    }

    [Fact]
    public async Task ABlobCopyOfAnotherLengthFallsBackToThePlainBlob()
    {
        WriteBlobGzip(modelSha, [1, 2, 3]);

        var (controller, file) = await Get("models/Tiger.glb", "gzip");

        Assert.Empty(controller.Response.Headers.ContentEncoding.ToString());
        Assert.Equal(modelBlob, await ReadAll(file.FileStream));
    }

    [Theory]
    [InlineData("models/Nothing.glb")]                     // the manifest has no row for it
    [InlineData("models/Unhashed.glb")]                    // a row the store has not hashed
    [InlineData("models/Evil.glb")]                        // a sha that is not a sha
    [InlineData("models/mods/nowhere/Tiger.glb")]          // a tree with no manifest at all
    [InlineData("models/kits/Tiger.glb")]                  // a subpath no manifest covers
    [InlineData("models/viewmodels/skins/USSoldier.glb")]  // likewise
    [InlineData("maps/bocage/scene.glb")]                  // level scenes are out of the store
    public async Task ANameNoManifestHashesIs404ExactlyAsToday(string path)
    {
        var controller = Controller(null);

        Assert.IsType<NotFoundObjectResult>(await controller.GetMeshAsset(path));
    }

    [Fact]
    public async Task ARepublishedManifestIsReReadByItsStamp()
    {
        var controller = Controller(null);
        var first = Assert.IsType<FileStreamResult>(await controller.GetMeshAsset("models/Tiger.glb"));
        Assert.Equal(modelBlob, await ReadAll(first.FileStream));

        // A re-export rewrites the row with the new bytes' hash; the manifest's stamp moves.
        var manifest = Path.Combine(assetsRoot, "mesh", "models", "models.json");
        await File.WriteAllTextAsync(manifest, $$"""
        [ { "template": "Tiger", "glb": "Tiger.glb", "sha": "{{wreckSha}}" } ]
        """);
        File.SetLastWriteTimeUtc(manifest, DateTime.UtcNow.AddHours(1));

        var second = Assert.IsType<FileStreamResult>(await Controller(null).GetMeshAsset("models/Tiger.glb"));
        Assert.Equal(wreckBlob, await ReadAll(second.FileStream));
    }

    [Fact]
    public async Task AStoreBlobRequestedByItsOwnPathIsImmutable()
    {
        var (controller, file) = await Get($"glbs/{modelSha}.glb");

        Assert.Equal(modelBlob, await ReadAll(file.FileStream));
        Assert.Equal("public, max-age=31536000, immutable", controller.Response.Headers.CacheControl.ToString());
        Assert.Equal("Accept-Encoding", controller.Response.Headers.Vary.ToString());
    }

    private async Task<(AssetsController, FileStreamResult)> Get(string path, string? acceptEncoding = null)
    {
        var controller = Controller(acceptEncoding);
        var result = await controller.GetMeshAsset(path);
        return (controller, Assert.IsType<FileStreamResult>(result));
    }

    private AssetsController Controller(string? acceptEncoding)
    {
        var context = new DefaultHttpContext();
        if (acceptEncoding is not null)
            context.Request.Headers.AcceptEncoding = acceptEncoding;
        return new AssetsController(
            new AssetServingService(NullLogger<AssetServingService>.Instance),
            Substitute.For<IMapImageResolver>(),
            resolver)
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    private static byte[] Payload(int seed) => [.. Enumerable.Range(0, 600).Select(i => (byte)((i + seed) % (5 + seed)))];

    private string WriteBlob(byte[] content)
    {
        var sha = Convert.ToHexStringLower(SHA256.HashData(content));
        WriteBytes($"mesh/glbs/{sha}.glb", content);
        return sha;
    }

    private void WriteBlobGzip(string sha, byte[] content)
    {
        var blob = Path.Combine(assetsRoot, "mesh", "glbs", sha + ".glb");
        using (var stream = File.Create(blob + ".gz"))
        using (var gzip = new GZipStream(stream, CompressionLevel.SmallestSize))
            gzip.Write(content);
        // The store writes the copy after its blob.
        File.SetLastWriteTimeUtc(blob + ".gz", File.GetLastWriteTimeUtc(blob).AddSeconds(1));
    }

    private void Write(string relativePath, string content)
    {
        var path = Path.Combine(assetsRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private void WriteBytes(string relativePath, byte[] content)
    {
        var path = Path.Combine(assetsRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, content);
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
