using api.MapDossiers;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.MapDossiers;

[Collection(SharedAssetsPath.Name)]
public sealed class MapDossierResolverTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly MapDossierResolver resolver;

    public MapDossierResolverTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-dossiers-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "dossiers"));

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        WriteManifest("""
        {
          "version": 1,
          "mods": {
            "bf1942": {
              "searchPath": ["bf1942"],
              "maps": ["wake", "battle_of_the_bulge"]
            },
            "fh": {
              "searchPath": ["fh", "bf1942"],
              "maps": ["operation_goodwood"]
            },
            "fhsw": {
              "searchPath": ["fhsw", "fh", "bf1942"],
              "maps": ["operation_coronet-1946"]
            }
          }
        }
        """);

        resolver = new MapDossierResolver(NullLogger<MapDossierResolver>.Instance);
    }

    private void WriteManifest(string json) =>
        File.WriteAllText(Path.Combine(assetsRoot, "dossiers", "manifest.json"), json);

    private static string Combine(params string[] parts) => Path.Combine(parts);

    [Fact]
    public void Resolve_ReturnsPath_ForMapTheModShips()
    {
        Assert.Equal(Combine("bf1942", "wake.json"), resolver.Resolve("bf1942", "wake"));
    }

    [Theory]
    [InlineData("BF1942")]
    [InlineData("Bf1942")]
    [InlineData("  bf1942  ")]
    public void Resolve_IgnoresGameIdCasingAndWhitespace(string gameId)
    {
        // bflist reports the same mod as both "bf1942" and "BF1942".
        Assert.Equal(Combine("bf1942", "wake.json"), resolver.Resolve(gameId, "wake"));
    }

    [Theory]
    [InlineData("battle of the bulge")]
    [InlineData("Battle Of The Bulge")]
    [InlineData("battle_of_the_bulge")]
    [InlineData("battle_of_the_bulge.json")]
    public void Resolve_AcceptsEitherMapNameForm(string mapName)
    {
        Assert.Equal(Combine("bf1942", "battle_of_the_bulge.json"), resolver.Resolve("bf1942", mapName));
    }

    [Fact]
    public void Resolve_WalksTheModInheritanceChain()
    {
        // An FHSW server can legitimately report a base-game map, because FHSW inherits
        // content it does not ship itself.
        Assert.Equal(Combine("bf1942", "wake.json"), resolver.Resolve("fhsw", "wake"));
        Assert.Equal(Combine("fh", "operation_goodwood.json"), resolver.Resolve("fhsw", "operation goodwood"));
    }

    [Fact]
    public void Resolve_PrefersTheMostSpecificModInTheChain()
    {
        WriteManifest("""
        {
          "version": 1,
          "mods": {
            "bf1942": { "searchPath": ["bf1942"], "maps": ["wake"] },
            "fhsw": { "searchPath": ["fhsw", "bf1942"], "maps": ["wake"] }
          }
        }
        """);

        Assert.Equal(Combine("fhsw", "wake.json"), resolver.Resolve("fhsw", "wake"));
    }

    [Fact]
    public void Resolve_ReturnsNull_ForUnknownMapOrMod()
    {
        Assert.Null(resolver.Resolve("bf1942", "kursk_custom"));
        Assert.Null(resolver.Resolve("bg42", "wake"));
    }

    [Theory]
    [InlineData("", "wake")]
    [InlineData("bf1942", "")]
    [InlineData("   ", "   ")]
    public void Resolve_ReturnsNull_ForBlankInput(string gameId, string mapName)
    {
        Assert.Null(resolver.Resolve(gameId, mapName));
    }

    [Fact]
    public void Resolve_FallsBackToDirectProbe_WhenManifestIsMissing()
    {
        File.Delete(Path.Combine(assetsRoot, "dossiers", "manifest.json"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "dossiers", "bf1942"));
        File.WriteAllText(Path.Combine(assetsRoot, "dossiers", "bf1942", "wake.json"), "{}");

        var fresh = new MapDossierResolver(NullLogger<MapDossierResolver>.Instance);

        Assert.Equal(Combine("bf1942", "wake.json"), fresh.Resolve("bf1942", "wake"));
        Assert.Null(fresh.Resolve("bf1942", "midway"));
    }

    [Fact]
    public void SearchPath_ReturnsTheDeclaredChain()
    {
        Assert.Equal(["fhsw", "fh", "bf1942"], resolver.SearchPath("FHSW"));
    }

    [Fact]
    public void SearchPath_FallsBackToTheModItself_WhenUnknown()
    {
        Assert.Equal(["bg42"], resolver.SearchPath("bg42"));
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        if (Directory.Exists(assetsRoot))
            Directory.Delete(assetsRoot, recursive: true);
    }
}
