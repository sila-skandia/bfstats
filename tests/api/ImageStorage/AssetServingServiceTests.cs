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

    private static string CreateTempDir()
    {
        var path = Path.Combine(Path.GetTempPath(), "arcade-assets-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }
}
