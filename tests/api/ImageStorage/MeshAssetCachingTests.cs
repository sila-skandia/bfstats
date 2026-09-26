using api.ImageStorage;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.ImageStorage;

/// <summary>
/// Cloudflare's zone rule bypasses the cache for any response without a Cache-Control, so a
/// mesh asset served without one reached the node on every profile view.
/// </summary>
[Collection(SharedAssetsPath.Name)]
public sealed class MeshAssetCachingTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly AssetsController controller;

    public MeshAssetCachingTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-mesh-cache-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "mesh", "models", "poses"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "hud"));
        File.WriteAllBytes(Path.Combine(assetsRoot, "mesh", "models", "poses", "RussianSoldier__DP.pose.glb"), [0x67, 0x6C]);
        File.WriteAllBytes(Path.Combine(assetsRoot, "hud", "icon.png"), [0x89, 0x50]);

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        controller = new AssetsController(
            new AssetServingService(NullLogger<AssetServingService>.Instance),
            Substitute.For<IMapImageResolver>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    [Fact]
    public async Task GetMeshAsset_CarriesTheMeshSitesCachePolicy()
    {
        var result = await controller.GetMeshAsset("models/poses/RussianSoldier__DP.pose.glb");

        var file = Assert.IsType<FileStreamResult>(result);
        await file.FileStream.DisposeAsync();
        Assert.Equal("public, max-age=300, s-maxage=86400", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task GetMeshAsset_DoesNotCacheAMiss()
    {
        var result = await controller.GetMeshAsset("models/poses/Nobody__Nothing.pose.glb");

        Assert.IsType<NotFoundObjectResult>(result);
        Assert.Empty(controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task OtherAssetRoutesAreUnchanged()
    {
        var result = await controller.GetHudAsset("icon.png");

        var file = Assert.IsType<FileStreamResult>(result);
        await file.FileStream.DisposeAsync();
        Assert.Empty(controller.Response.Headers.CacheControl.ToString());
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        if (Directory.Exists(assetsRoot))
            Directory.Delete(assetsRoot, recursive: true);
    }
}
