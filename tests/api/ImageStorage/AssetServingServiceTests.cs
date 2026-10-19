using api.ImageStorage;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.ImageStorage;

public class AssetServingServiceTests
{
    [Fact]
    public async Task GetAssetAsync_MissingArcadeMap_ReturnsNotFound()
    {
        var service = new AssetServingService(NullLogger<AssetServingService>.Instance);
        var root = CreateTempDir();
        try
        {
            var result = await service.GetAssetAsync(root, "maps/wake/ingame.webp");
            Assert.False(result.IsSuccess);
            Assert.Equal(404, result.StatusCode);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task GetAssetAsync_WebpMap_ReturnsImageWebp()
    {
        var service = new AssetServingService(NullLogger<AssetServingService>.Instance);
        var root = CreateTempDir();
        try
        {
            var file = Path.Combine(root, "maps", "wake", "ingame.webp");
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(file, [0x52, 0x49, 0x46, 0x46]);

            var result = await service.GetAssetAsync(root, "maps/wake/ingame.webp");
            Assert.True(result.IsSuccess);
            Assert.Equal("image/webp", result.ContentType);
            Assert.Equal("ingame.webp", result.FileName);
            await result.FileStream!.DisposeAsync();
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task GetAssetAsync_GlbMesh_ReturnsModelGltfBinary()
    {
        var service = new AssetServingService(NullLogger<AssetServingService>.Instance);
        var root = CreateTempDir();
        try
        {
            var file = Path.Combine(root, "models", "Sherman_Complex_base.glb");
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(file, [0x67, 0x6C, 0x54, 0x46]);

            var result = await service.GetAssetAsync(root, "models/Sherman_Complex_base.glb");
            Assert.True(result.IsSuccess);
            Assert.Equal("model/gltf-binary", result.ContentType);
            Assert.Equal("Sherman_Complex_base.glb", result.FileName);
            await result.FileStream!.DisposeAsync();
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData("LCI(R).Midway-1942.glb")]
    [InlineData("3,9inchType98wRadar.glb")]
    [InlineData("PrinceOW_+20000.glb")]
    [InlineData("charly's_nest.glb")]
    [InlineData("German_Helmets5@Todtenbruch-1944.kit.glb")]
    [InlineData("mstngnstrt~ce87b60c.glb")]
    [InlineData("icon_bomb250 copy.glb")]
    public async Task GetAssetAsync_GameFileNamePunctuation_IsServed(string name)
    {
        var service = new AssetServingService(NullLogger<AssetServingService>.Instance);
        var root = CreateTempDir();
        try
        {
            var file = Path.Combine(root, "models", name);
            Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            await File.WriteAllBytesAsync(file, [0x67, 0x6C, 0x54, 0x46]);

            var result = await service.GetAssetAsync(root, $"models/{name}");
            Assert.True(result.IsSuccess, result.ErrorMessage);
            await result.FileStream!.DisposeAsync();
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Theory]
    [InlineData("../secret.glb")]
    [InlineData("models/../../secret.glb")]
    [InlineData("models/./x.glb")]
    [InlineData("/etc/passwd")]
    [InlineData("C:/x.glb")]
    [InlineData("models\\x.glb")]
    [InlineData("models/x;.glb")]
    public async Task GetAssetAsync_TraversalAndUnsafeCharacters_AreRejected(string path)
    {
        var service = new AssetServingService(NullLogger<AssetServingService>.Instance);
        var root = CreateTempDir();
        try
        {
            var result = await service.GetAssetAsync(root, path);
            Assert.False(result.IsSuccess);
            Assert.Equal(400, result.StatusCode);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static string CreateTempDir()
    {
        var path = Path.Combine(Path.GetTempPath(), "arcade-assets-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }
}
