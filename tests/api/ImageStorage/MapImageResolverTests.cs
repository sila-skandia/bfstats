using api.ImageStorage;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.ImageStorage;

[Collection(SharedAssetsPath.Name)]
public sealed class MapImageResolverTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly MapImageResolver resolver;

    public MapImageResolverTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-map-images-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "maps"));

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        WriteManifest("""
        {
          "version": 1,
          "mods": {
            "bf1942": {
              "searchPath": ["bf1942"],
              "maps": {
                "wake": ["minimap", "thumbnail"],
                "battle_of_the_bulge": ["minimap", "thumbnail"]
              }
            },
            "fh": {
              "searchPath": ["fh", "bf1942"],
              "maps": {
                "coral_sea": ["minimap"]
              }
            },
            "fhsw": {
              "searchPath": ["fhsw", "fh", "bf1942"],
              "maps": {
                "operation_coronet-1946": ["minimap", "thumbnail"]
              }
            }
          }
        }
        """);

        resolver = new MapImageResolver(NullLogger<MapImageResolver>.Instance);
    }

    private void WriteManifest(string json) =>
        File.WriteAllText(Path.Combine(assetsRoot, "maps", "manifest.json"), json);

    [Fact]
    public void Resolves_map_in_its_own_mod()
    {
        Assert.Equal(Path.Combine("bf1942", "wake.png"),
            resolver.Resolve("bf1942", "wake", MapImageKind.Thumbnail));
    }

    [Theory]
    [InlineData("battle of the bulge")]
    [InlineData("Battle Of The Bulge")]
    [InlineData("battle_of_the_bulge")]
    public void Normalizes_case_and_spaces_in_map_name(string mapName)
    {
        Assert.Equal(Path.Combine("bf1942", "battle_of_the_bulge.png"),
            resolver.Resolve("bf1942", mapName, MapImageKind.Thumbnail));
    }

    [Fact]
    public void Normalizes_game_id_case()
    {
        Assert.Equal(Path.Combine("bf1942", "wake.png"),
            resolver.Resolve("BF1942", "Wake", MapImageKind.Thumbnail));
    }

    [Fact]
    public void Minimap_uses_map_suffix()
    {
        Assert.Equal(Path.Combine("bf1942", "wake.map.png"),
            resolver.Resolve("bf1942", "wake", MapImageKind.Minimap));
    }

    [Fact]
    public void Falls_back_through_the_mod_search_path()
    {
        // FHSW does not ship Wake; it inherits it from BF1942 two hops up the chain.
        Assert.Equal(Path.Combine("bf1942", "wake.png"),
            resolver.Resolve("fhsw", "wake", MapImageKind.Thumbnail));
    }

    [Fact]
    public void Prefers_the_mods_own_copy_over_an_inherited_one()
    {
        Assert.Equal(Path.Combine("fhsw", "operation_coronet-1946.png"),
            resolver.Resolve("fhsw", "operation coronet-1946", MapImageKind.Thumbnail));
    }

    [Fact]
    public void Returns_null_when_the_requested_kind_is_missing()
    {
        // Coral Sea ships a minimap but no thumbnail.
        Assert.Null(resolver.Resolve("fh", "coral sea", MapImageKind.Thumbnail));
        Assert.Equal(Path.Combine("fh", "coral_sea.map.png"),
            resolver.Resolve("fh", "coral sea", MapImageKind.Minimap));
    }

    [Fact]
    public void Returns_null_for_unknown_map_and_unknown_mod()
    {
        Assert.Null(resolver.Resolve("bf1942", "kursk custom", MapImageKind.Thumbnail));
        Assert.Null(resolver.Resolve("gcn_mario_kart", "wii drydry ruins", MapImageKind.Thumbnail));
    }

    [Theory]
    [InlineData("", "wake")]
    [InlineData("bf1942", "")]
    [InlineData("bf1942", "   ")]
    public void Returns_null_for_blank_input(string gameId, string mapName)
    {
        Assert.Null(resolver.Resolve(gameId, mapName, MapImageKind.Thumbnail));
    }

    [Fact]
    public void Falls_back_to_probing_the_filesystem_when_no_manifest_exists()
    {
        File.Delete(Path.Combine(assetsRoot, "maps", "manifest.json"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "maps", "bf1942"));
        File.WriteAllBytes(Path.Combine(assetsRoot, "maps", "bf1942", "wake.png"), [1, 2, 3]);

        var fresh = new MapImageResolver(NullLogger<MapImageResolver>.Instance);
        Assert.Equal(Path.Combine("bf1942", "wake.png"),
            fresh.Resolve("bf1942", "wake", MapImageKind.Thumbnail));
        Assert.Null(fresh.Resolve("bf1942", "midway", MapImageKind.Thumbnail));
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        if (Directory.Exists(assetsRoot))
            Directory.Delete(assetsRoot, recursive: true);
    }
}
