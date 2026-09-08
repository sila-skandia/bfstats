using System.Text.Json;
using api.MapDossiers;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.MapDossiers;

[Collection(SharedAssetsPath.Name)]
public sealed class MapDossierServiceTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly MapDossierService service;

    public MapDossierServiceTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-dossier-svc-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "dossiers", "bf1942"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "dossiers", "fhsw"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "hud", "vehicles", "bf1942"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "hud", "vehicles", "fhsw"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "hud", "weapons", "bf1942"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "hud", "kits", "bf1942"));
        Directory.CreateDirectory(Path.Combine(assetsRoot, "hud", "kits", "fhsw"));

        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        File.WriteAllText(Path.Combine(assetsRoot, "dossiers", "manifest.json"), """
        {
          "version": 1,
          "mods": {
            "bf1942": { "searchPath": ["bf1942"], "maps": ["wake"] },
            "fhsw": { "searchPath": ["fhsw", "bf1942"], "maps": ["wake"] }
          }
        }
        """);

        WriteIcon("vehicles", "bf1942", "sherman");
        WriteIcon("weapons", "bf1942", "mg42");
        WriteIcon("kits", "bf1942", "scoutaxis");
        WriteIcon("kits", "bf1942", "antitankallies");

        service = new MapDossierService(
            new MapDossierResolver(NullLogger<MapDossierResolver>.Instance),
            NullLogger<MapDossierService>.Instance);
    }

    private void WriteIcon(string kind, string mod, string key) =>
        File.WriteAllBytes(Path.Combine(assetsRoot, "hud", kind, mod, key + ".png"), [0x89, 0x50]);

    private void WriteDossier(string mod, string map, string arsenalJson) =>
        File.WriteAllText(Path.Combine(assetsRoot, "dossiers", mod, map + ".json"), $$"""
        {
          "mod": "{{mod}}",
          "map": "{{map}}",
          "displayName": "Wake",
          "worldSize": 2048,
          "teams": [
            {"index":1,"nation":"jp","label":"Japan","tickets":100,"ticketLossPerMin":5,"isAssault":true,
             "kits":[{"template":"Jap_Scout","name":"Scout","role":"scout","icon":"japscout"}]},
            {"index":2,"nation":"us","label":"United States","tickets":100,"ticketLossPerMin":30,"isAssault":false,
             "kits":[{"template":"US_AT","name":"AT","role":"at","icon":"usat"}]}
          ],
          "controlPoints": [{"name":"The Airfield","id":"the_airfield","team":2,"x":0.67,"y":0.62}],
          "controlPointsPlottable": true,
          "arsenal": {{arsenalJson}}
        }
        """);

    [Fact]
    public async Task GetAsync_ReturnsNull_WhenTheMapHasNoDossier()
    {
        Assert.Null(await service.GetAsync("bf1942", "kursk_custom"));
    }

    [Fact]
    public async Task GetAsync_ReadsTeamsAndControlPoints()
    {
        WriteDossier("bf1942", "wake", "[]");

        var dossier = await service.GetAsync("bf1942", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("Wake", dossier.DisplayName);
        Assert.Equal(2048, dossier.WorldSize);
        Assert.True(dossier.ControlPointsPlottable);
        Assert.Collection(dossier.Teams,
            first =>
            {
                Assert.Equal("jp", first.Nation);
                Assert.True(first.IsAssault);
                Assert.Equal(5, first.TicketLossPerMin);
            },
            second =>
            {
                Assert.Equal("us", second.Nation);
                Assert.False(second.IsAssault);
            });
        var flag = Assert.Single(dossier.ControlPoints);
        Assert.Equal("The Airfield", flag.Name);
        Assert.Equal(0.67, flag.X);
    }

    [Fact]
    public async Task GetAsync_FallsBackToRoleAndSideForKitArt()
    {
        // Only bf1918 names kit icons after the kit template. Everyone else files them
        // by role and side, and the level's "at" is the art's "antitank".
        WriteDossier("bf1942", "wake", "[]");

        var dossier = await service.GetAsync("bf1942", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("kits/bf1942/scoutaxis.png", Assert.Single(dossier.Teams[0].Kits).IconPath);
        Assert.Equal("kits/bf1942/antitankallies.png", Assert.Single(dossier.Teams[1].Kits).IconPath);
    }

    [Fact]
    public async Task GetAsync_PrefersKitArtNamedAfterTheTemplate()
    {
        // bf1918 files kit icons under the template name; that beats the role fallback.
        WriteIcon("kits", "bf1942", "japscout");
        WriteDossier("bf1942", "wake", "[]");

        var dossier = await service.GetAsync("bf1942", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("kits/bf1942/japscout.png", Assert.Single(dossier.Teams[0].Kits).IconPath);
    }

    [Fact]
    public async Task GetAsync_LeavesKitArtNullWhenNothingMatches()
    {
        // A mod kit outside the stock five has no role to fall back on, so the caller
        // renders its name rather than borrowing unrelated art.
        await File.WriteAllTextAsync(Path.Combine(assetsRoot, "dossiers", "fhsw", "wake.json"), """
        {
          "mod": "fhsw", "map": "wake", "displayName": "Wake", "worldSize": 2048,
          "teams": [
            {"index":1,"nation":"jp","label":"Japan","isAssault":false,
             "kits":[{"template":"1Jap_Kneemortar","name":"Kneemortar","role":null,"icon":"1japkneemortar"}]},
            {"index":2,"nation":"us","label":"United States","isAssault":false,"kits":[]}
          ],
          "controlPoints": [], "controlPointsPlottable": false, "arsenal": []
        }
        """);

        var dossier = await service.GetAsync("fhsw", "wake");

        Assert.NotNull(dossier);
        var kit = Assert.Single(dossier.Teams[0].Kits);
        Assert.Equal("Kneemortar", kit.Name);
        Assert.Null(kit.Role);
        Assert.Null(kit.IconPath);
    }

    [Fact]
    public async Task GetAsync_PointsArsenalEntriesAtTheirIcons()
    {
        WriteDossier("bf1942", "wake", """
        [
          {"team":2,"template":"sherman","name":"M4 Sherman","key":"sherman","icon":"sherman","category":"land","spawnPoints":3},
          {"team":1,"template":"Stationary_mg42","name":"MG42","key":"stationarymg42","icon":"mg42","category":"emplacement","spawnPoints":3}
        ]
        """);

        var dossier = await service.GetAsync("bf1942", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("vehicles/bf1942/sherman.png", dossier.Arsenal[0].IconPath);
        // Weapons and vehicles live in sibling folders; both are searched.
        Assert.Equal("weapons/bf1942/mg42.png", dossier.Arsenal[1].IconPath);
    }

    [Fact]
    public async Task GetAsync_FindsIconsThroughTheModInheritanceChain()
    {
        // FHSW's own Wake fields a base-game Sherman it ships no art for, so the icon
        // has to come from the parent mod the same way the engine would find it.
        WriteDossier("fhsw", "wake", """
        [{"team":2,"template":"sherman","name":"M4 Sherman","key":"sherman","icon":"sherman","category":"land","spawnPoints":3}]
        """);

        var dossier = await service.GetAsync("fhsw", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("vehicles/bf1942/sherman.png", Assert.Single(dossier.Arsenal).IconPath);
    }

    [Fact]
    public async Task GetAsync_PrefersTheModsOwnIconOverTheInheritedOne()
    {
        WriteIcon("vehicles", "fhsw", "sherman");
        WriteDossier("fhsw", "wake", """
        [{"team":2,"template":"sherman","name":"M4 Sherman","key":"sherman","icon":"sherman","category":"land","spawnPoints":3}]
        """);

        var dossier = await service.GetAsync("fhsw", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("vehicles/fhsw/sherman.png", Assert.Single(dossier.Arsenal).IconPath);
    }

    [Fact]
    public async Task GetAsync_DropsUnclassifiedEntriesWithNoIcon()
    {
        // Levels place scripting and scenery objects through the same spawners as
        // vehicles; an object the game classifies nowhere and draws no icon for is not
        // materiel and has no business in an arsenal.
        WriteDossier("bf1942", "wake", """
        [
          {"team":1,"template":"killercage_axis","name":"Killercage Axis","key":"killercageaxis","icon":"killercageaxis","category":"unknown","spawnPoints":12},
          {"team":2,"template":"sherman","name":"M4 Sherman","key":"sherman","icon":"sherman","category":"land","spawnPoints":3}
        ]
        """);

        var dossier = await service.GetAsync("bf1942", "wake");

        Assert.NotNull(dossier);
        Assert.Equal("sherman", Assert.Single(dossier.Arsenal).Key);
    }

    [Fact]
    public async Task GetAsync_KeepsClassifiedEntriesTheGameShipsNoIconFor()
    {
        // A hull the engine classifies as a vehicle is real materiel even where no art
        // exists — the caller renders it without a picture rather than omitting it.
        WriteDossier("bf1942", "wake", """
        [{"team":1,"template":"bf110","name":"Messerschmitt Bf 110","key":"bf110","icon":"bf110","category":"air","spawnPoints":1}]
        """);

        var dossier = await service.GetAsync("bf1942", "wake");

        Assert.NotNull(dossier);
        var entry = Assert.Single(dossier.Arsenal);
        Assert.Equal("bf110", entry.Key);
        Assert.Null(entry.IconPath);
    }

    [Fact]
    public async Task GetAsync_ReturnsNull_WhenTheDossierFileIsUnreadable()
    {
        // The manifest promises a file that is corrupt: the page that asked should lose
        // its dossier panel, not fail outright.
        await File.WriteAllTextAsync(
            Path.Combine(assetsRoot, "dossiers", "bf1942", "wake.json"), "{ this is not json");

        Assert.Null(await service.GetAsync("bf1942", "wake"));
    }

    [Fact]
    public async Task GetAsync_ReturnsNull_WhenTheManifestPromisesAMissingFile()
    {
        Assert.Null(await service.GetAsync("bf1942", "wake"));
    }

    [Fact]
    public async Task GetAsync_SerialisesIconPathForClients()
    {
        WriteDossier("bf1942", "wake", """
        [{"team":2,"template":"sherman","name":"M4 Sherman","key":"sherman","icon":"sherman","category":"land","spawnPoints":3}]
        """);

        var dossier = await service.GetAsync("bf1942", "wake");
        var json = JsonSerializer.Serialize(dossier);

        Assert.Contains("\"iconPath\":\"vehicles/bf1942/sherman.png\"", json);
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        if (Directory.Exists(assetsRoot))
            Directory.Delete(assetsRoot, recursive: true);
    }
}
