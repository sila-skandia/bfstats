using api.ImageStorage;
using api.MapDossiers;
using api.PlayerStats;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.ImageStorage;

[Collection(SharedAssetsPath.Name)]
public sealed class NewModsResolverTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;

    public NewModsResolverTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-new-mods-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "maps"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "dossiers"));

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        File.WriteAllText(Path.Combine(assetsRoot, "maps", "manifest.json"), """
        {
          "version": 1,
          "mods": {
            "bg42": {
              "searchPath": ["bg42", "bf1942"],
              "maps": {
                "3706-kanchatzu_incident": ["minimap", "thumbnail"]
              }
            },
            "warfront": {
              "searchPath": ["warfront", "bf1942"],
              "maps": {
                "aachen": ["minimap", "thumbnail"]
              }
            },
            "pirates": {
              "searchPath": ["pirates", "bf1942"],
              "maps": {
                "bfp_beached": ["minimap", "thumbnail"]
              }
            },
            "finnwars": {
              "searchPath": ["finnwars", "bf1942"],
              "maps": {
                "ayrapaa": ["minimap", "thumbnail"]
              }
            },
            "bfheroes": {
              "searchPath": ["bfheroes", "bf1942"],
              "maps": {
                "buccaneer_bay": ["minimap", "thumbnail"]
              }
            }
          }
        }
        """);

        File.WriteAllText(Path.Combine(assetsRoot, "dossiers", "manifest.json"), """
        {
          "version": 1,
          "mods": {
            "bg42": {
              "searchPath": ["bg42", "bf1942"],
              "maps": ["3706-kanchatzu_incident"]
            },
            "warfront": {
              "searchPath": ["warfront", "bf1942"],
              "maps": ["aachen"]
            },
            "pirates": {
              "searchPath": ["pirates", "bf1942"],
              "maps": ["bfp_beached"]
            },
            "finnwars": {
              "searchPath": ["finnwars", "bf1942"],
              "maps": ["ayrapaa"]
            },
            "bfheroes": {
              "searchPath": ["bfheroes", "bf1942"],
              "maps": ["buccaneer_bay"]
            }
          }
        }
        """);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        try
        {
            if (Directory.Exists(assetsRoot))
                Directory.Delete(assetsRoot, recursive: true);
        }
        catch
        {
            // Best effort cleanup in temp
        }
    }

    [Theory]
    [InlineData("battlegroup42", "bg42")]
    [InlineData("bg42", "bg42")]
    [InlineData("warfront1", "warfront")]
    [InlineData("warfront", "warfront")]
    [InlineData("bfpirates", "pirates")]
    [InlineData("pirates", "pirates")]
    [InlineData("finnwars", "finnwars")]
    [InlineData("bfheroes", "bfheroes")]
    public void MapImageResolver_CanonicalizesNewMods(string inputMod, string expectedMod)
    {
        Assert.Equal(expectedMod, MapImageResolver.CanonicalizeMod(inputMod));
    }

    [Theory]
    [InlineData("battlegroup42", "3706-kanchatzu_incident", "bg42/3706-kanchatzu_incident.png")]
    [InlineData("warfront1", "aachen", "warfront/aachen.png")]
    [InlineData("bfpirates", "bfp_beached", "pirates/bfp_beached.png")]
    [InlineData("finnwars", "ayrapaa", "finnwars/ayrapaa.png")]
    [InlineData("bfheroes", "buccaneer_bay", "bfheroes/buccaneer_bay.png")]
    public void MapImageResolver_ResolvesMapsForNewMods(string mod, string map, string expectedPath)
    {
        var resolver = new MapImageResolver(NullLogger<MapImageResolver>.Instance);
        var resolved = resolver.Resolve(mod, map, MapImageKind.Thumbnail);
        Assert.Equal(expectedPath.Replace('/', Path.DirectorySeparatorChar), resolved);
    }

    [Fact]
    public void MapDossierResolver_SearchPath_CanonicalizesModAliases()
    {
        var resolver = new MapDossierResolver(NullLogger<MapDossierResolver>.Instance);
        var searchPath = resolver.SearchPath("battlegroup42");
        Assert.Contains("bg42", searchPath);
    }

    [Theory]
    [InlineData("battlegroup42", "bg42")]
    [InlineData("warfront", "warfront")]
    [InlineData("warfront1", "warfront")]
    [InlineData("pirates", "pirates")]
    [InlineData("bfpirates", "pirates")]
    [InlineData("finnwars", "finnwars")]
    [InlineData("bfheroes", "bfheroes")]
    public void SqlitePlayerStatsService_CanonicalizesNewMods(string serverMod, string expectedMod)
    {
        Assert.Equal(expectedMod, SqlitePlayerStatsService.CanonicalizeMod(serverMod, "any_map"));
    }
}
