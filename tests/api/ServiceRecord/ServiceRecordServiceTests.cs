using System.Text.Json;
using api.Armoury;
using api.Armoury.Models;
using api.Caching;
using api.MapDossiers;
using api.MapDossiers.Models;
using api.ServiceRecord;
using api.ServiceRecord.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace api.tests.ServiceRecord;

public sealed class ServiceRecordServiceTests : IDisposable
{
    private const string Player = "BetMan";

    // What the API's MVC and Redis serialisers both use.
    private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly IServiceRecordStore store = Substitute.For<IServiceRecordStore>();
    private readonly IMapDossierService dossiers = Substitute.For<IMapDossierService>();
    private readonly IMapDossierResolver resolver = Substitute.For<IMapDossierResolver>();
    private readonly IMeshArmouryIndex meshIndex = Substitute.For<IMeshArmouryIndex>();
    private readonly ICacheService cache = Substitute.For<ICacheService>();
    private readonly MemoryCache memoryCache = new(new MemoryCacheOptions());
    private readonly ServiceRecordService service;

    public ServiceRecordServiceTests()
    {
        store.PlayerExistsAsync(Player, Arg.Any<CancellationToken>()).Returns(true);
        cache.GetAsync<PlayerServiceRecord>(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((PlayerServiceRecord?)null);
        dossiers.GetAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((MapDossier?)null);
        resolver.SearchPath(Arg.Any<string>()).Returns(callInfo => [callInfo.Arg<string>()]);

        meshIndex.TreesFor(Arg.Any<string>()).Returns(callInfo => [callInfo.Arg<string>(), "bf1942"]);
        meshIndex.ResolveVehicle(Arg.Any<string>(), Arg.Any<IReadOnlyList<string>>())
            .Returns(callInfo => new VehicleAssets(
                $"models/thumbs/{callInfo.Arg<string>().ToLowerInvariant()}.png",
                $"models/{callInfo.Arg<string>()}.glb"));
        meshIndex.ResolveFigure(Arg.Any<string?>(), Arg.Any<IReadOnlyList<string>>(), Arg.Any<IReadOnlyList<string>>())
            .Returns(callInfo => new ArmyFigure(callInfo.ArgAt<string?>(0) ?? "", null,
                [.. callInfo.ArgAt<IReadOnlyList<string>>(1).Select(kit => new FigureKit(kit, "Colt", $"models/poses/{kit}.pose.glb", []))]));

        var armoury = new ArmouryService(dossiers, meshIndex, NullLogger<ArmouryService>.Instance);
        service = new ServiceRecordService(store, dossiers, resolver, armoury, meshIndex, memoryCache, cache,
            NullLogger<ServiceRecordService>.Instance);
    }

    private static MapDossierTeam Team(int index, string nation, string label, string skin, params string[] kits) => new()
    {
        Index = index,
        Nation = nation,
        Label = label,
        Skin = skin,
        Kits = [.. kits.Select(kit => new MapDossierKit { Template = kit, Name = kit, Icon = kit.ToLowerInvariant(), IconPath = $"kits/bf1942/{kit.ToLowerInvariant()}.png" })],
    };

    private static MapDossierArsenalEntry Machine(int team, string template, string category) => new()
    {
        Team = team,
        Template = template,
        Name = template.ToUpperInvariant(),
        Key = template.ToLowerInvariant(),
        Icon = template.ToLowerInvariant(),
        Category = category,
        IconPath = $"vehicles/bf1942/{template.ToLowerInvariant()}.png",
    };

    private void Dossier(string gameId, string mapName, MapDossier dossier) =>
        dossiers.GetAsync(gameId, mapName, Arg.Any<CancellationToken>()).Returns(dossier);

    private void Rows(params ServiceRecordRow[] rows) => Window(false, rows);

    private void Window(bool capped, params ServiceRecordRow[] rows) =>
        store.GetRowsAsync(Player, Arg.Any<CancellationToken>()).Returns(new ServiceRecordRows(rows, capped));

    private static ServiceRecordRow Row(string gameId, string map, string label, double minutes, int rounds = 1,
        int kills = 0, int deaths = 0, int score = 0, int wins = 0, int losses = 0, DateTime? oldestStart = null) =>
        new(gameId, map, label, rounds, kills, deaths, score, minutes, wins, losses, oldestStart);

    private static MapDossier Wake() => new()
    {
        Mod = "bf1942",
        Map = "wake",
        DisplayName = "Wake",
        Teams =
        [
            Team(1, "jp", "Japan", "JapaneseSoldier", "Jap_Scout", "Jap_Assault"),
            Team(2, "us", "United States", "USMarineSoldier", "USMarine_Scout", "UsMarine_Assault"),
        ],
        Arsenal =
        [
            Machine(1, "chi-ha", "land"),
            Machine(1, "zero", "air"),
            Machine(1, "Stationary_mg42", "emplacement"),
            Machine(2, "sherman", "land"),
            Machine(2, "corsair", "air"),
            Machine(2, "AA_allies", "emplacement"),
        ],
    };

    private static MapDossier IwoJima() => new()
    {
        Mod = "bf1942",
        Map = "iwo_jima",
        DisplayName = "Iwo Jima",
        Teams =
        [
            Team(1, "jp", "Japan", "JapaneseSoldier", "Jap_AT"),
            Team(2, "us", "United States", "USMarineSoldier", "USMarine_AT"),
        ],
        Arsenal =
        [
            // Spelled differently from Wake's, still the same machine.
            Machine(2, "Sherman", "land"),
            Machine(2, "lvt2", "sea"),
            Machine(1, "kate", "air"),
        ],
    };

    private static MapDossier Map(string mod, string map, string displayName, MapDossierTeam axis, MapDossierTeam allied,
        params MapDossierArsenalEntry[] arsenal) =>
        new() { Mod = mod, Map = map, DisplayName = displayName, Teams = [axis, allied], Arsenal = arsenal };

    private async Task<PlayerServiceRecord> RecordAsync()
    {
        var record = await service.GetAsync(Player);
        Assert.NotNull(record);
        return record;
    }

    [Fact]
    public async Task CreditsEachSideOfAMapToItsArmy()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(
            Row("bf1942", "wake", "Axis", 30, rounds: 3, kills: 12, deaths: 6, score: 40, wins: 2, losses: 1),
            Row("bf1942", "wake", "Allied", 20, rounds: 2, kills: 4, deaths: 5, score: 9, wins: 1, losses: 1));

        var record = await RecordAsync();

        Assert.Equal(Player, record.PlayerName);
        Assert.Equal(50, record.TotalMinutes);
        Assert.Equal(50, record.AttributedMinutes);
        Assert.Collection(record.Armies,
            japan =>
            {
                Assert.Equal("bf1942:jp:JapaneseSoldier", japan.Key);
                Assert.Equal("Imperial Japanese Army", japan.Name);
                Assert.Equal("axis", japan.Side);
                Assert.Equal("bf1942", japan.Mod);
                Assert.Equal("jp", japan.Nation);
                Assert.Equal("Japan", japan.NationLabel);
                Assert.Equal(30, japan.Minutes);
                Assert.Equal(3, japan.Rounds);
                Assert.Equal(12, japan.Kills);
                Assert.Equal(6, japan.Deaths);
                Assert.Equal(40, japan.Score);
                Assert.Equal(2, japan.Wins);
                Assert.Equal(1, japan.Losses);
            },
            marines =>
            {
                Assert.Equal("US Marine Corps", marines.Name);
                Assert.Equal("allied", marines.Side);
                Assert.Equal(20, marines.Minutes);
            });
        Assert.Equal(new ServiceRecordSide("axis", 30, 3, 12, 6, 2, 1), record.Sides[0]);
        Assert.Equal(new ServiceRecordSide("allied", 20, 2, 4, 5, 1, 1), record.Sides[1]);
        Assert.Equal(new ServiceRecordUnattributed(0, 0), record.Unattributed);
    }

    [Fact]
    public async Task ReadsAlliesAsTeamTwo()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(Row("bf1942", "wake", "allies", 10));

        var army = Assert.Single((await RecordAsync()).Armies);

        Assert.Equal("US Marine Corps", army.Name);
    }

    [Fact]
    public async Task NumericAndEmptyLabelsAreOnNoSideAndInNoArmy()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(
            Row("bf1942", "wake", "1", 10, rounds: 2),
            Row("bf1942", "wake", "", 5, rounds: 1),
            Row("bf1942", "wake", "Axis", 20));

        var record = await RecordAsync();

        Assert.Equal(35, record.TotalMinutes);
        Assert.Equal(20, record.AttributedMinutes);
        Assert.Equal(new ServiceRecordUnattributed(15, 3), record.Unattributed);
        Assert.Equal(20, record.Sides[0].Minutes);
        Assert.Equal(0, record.Sides[1].Minutes);
        Assert.Equal(["Imperial Japanese Army"], record.Armies.Select(army => army.Name));
    }

    [Fact]
    public async Task AMapWithoutADossierCountsTowardItsSideButNoArmy()
    {
        Rows(Row("bf1942", "kursk_custom", "Axis", 40, rounds: 4, wins: 3));

        var record = await RecordAsync();

        Assert.Empty(record.Armies);
        Assert.Equal(40, record.TotalMinutes);
        Assert.Equal(0, record.AttributedMinutes);
        Assert.Equal(new ServiceRecordUnattributed(40, 4), record.Unattributed);
        Assert.Equal(new ServiceRecordSide("axis", 40, 4, 0, 0, 3, 0), record.Sides[0]);
    }

    [Fact]
    public async Task ADossierThatFailsToLoadCostsOnlyItsOwnSessions()
    {
        Dossier("bf1942", "wake", Wake());
        dossiers.GetAsync("bf1942", "broken", Arg.Any<CancellationToken>())
            .ThrowsAsync(new JsonException("truncated file"));
        Rows(Row("bf1942", "broken", "Allied", 25), Row("bf1942", "wake", "Axis", 10));

        var record = await RecordAsync();

        Assert.Equal(["Imperial Japanese Army"], record.Armies.Select(army => army.Name));
        Assert.Equal(new ServiceRecordUnattributed(25, 1), record.Unattributed);
        Assert.Equal(25, record.Sides[1].Minutes);
    }

    [Fact]
    public async Task ATeamTheDossierDoesNotDeclareIsUnattributed()
    {
        Dossier("bf1942", "wake", Wake() with { Teams = [Team(1, "jp", "Japan", "JapaneseSoldier")] });
        Rows(Row("bf1942", "wake", "Allied", 12));

        var record = await RecordAsync();

        Assert.Empty(record.Armies);
        Assert.Equal(12, record.Unattributed.Minutes);
        Assert.Equal(12, record.Sides[1].Minutes);
    }

    [Fact]
    public async Task AlwaysListsBothSidesAxisFirst()
    {
        Rows();

        var record = await RecordAsync();

        Assert.Equal([new ServiceRecordSide("axis", 0, 0, 0, 0, 0, 0), new ServiceRecordSide("allied", 0, 0, 0, 0, 0, 0)],
            record.Sides);
        Assert.Empty(record.Armies);
    }

    [Fact]
    public async Task MergesAnArmyAcrossMapsAndTheWorldWarTwoPacks()
    {
        var wehrmacht = Team(1, "ger", "Germany", "GermanSoldier", "German_Assault");
        Dossier("bf1942", "berlin", Map("bf1942", "berlin", "Berlin", wehrmacht, Team(2, "rus", "Soviet Union", "RussianSoldier")));
        Dossier("xpack2", "mimoyecques", Map("xpack2", "mimoyecques", "Mimoyecques",
            wehrmacht with { Kits = [new MapDossierKit { Template = "GermanElite_AT", Name = "AT" }] },
            Team(2, "brit", "Great Britain", "BritishSoldier")));
        Rows(
            Row("bf1942", "berlin", "Axis", 30, rounds: 3, kills: 10),
            Row("xpack2", "mimoyecques", "Axis", 45, rounds: 4, kills: 20));

        var army = Assert.Single((await RecordAsync()).Armies);

        Assert.Equal("bf1942:ger:GermanSoldier", army.Key);
        Assert.Equal("Wehrmacht", army.Name);
        Assert.Equal(75, army.Minutes);
        Assert.Equal(7, army.Rounds);
        Assert.Equal(30, army.Kills);
        Assert.Equal(
            [new ServiceRecordMap("xpack2", "mimoyecques", "Mimoyecques", 45, 4), new ServiceRecordMap("bf1942", "berlin", "Berlin", 30, 3)],
            army.Maps);
        // Kits and figure come from the map served on longest.
        Assert.Equal(["GermanElite_AT"], army.Kits.Select(kit => kit.Template));
        Assert.Equal(["GermanElite_AT"], army.Figure!.Kits.Select(kit => kit.Template));
        meshIndex.Received().TreesFor("xpack2");
    }

    [Fact]
    public async Task OneMapReportedUnderTwoAddressesIsOneMap()
    {
        Dossier("bf1942", "wake", Wake());
        Dossier("bf1942", "wake island", Wake());
        Rows(Row("bf1942", "wake island", "Axis", 10), Row("bf1942", "wake", "Axis", 25));

        var map = Assert.Single(Assert.Single((await RecordAsync()).Armies).Maps);

        // Linked through the address the player's minutes mostly came from.
        Assert.Equal(new ServiceRecordMap("bf1942", "wake", "Wake", 35, 2), map);
    }

    [Fact]
    public async Task ListsTheFiveMapsWithTheMostMinutes()
    {
        var axis = Team(1, "ger", "Germany", "GermanSoldier");
        var allied = Team(2, "us", "United States", "USSoldier");
        var rows = new List<ServiceRecordRow>();
        for (var i = 1; i <= 6; i++)
        {
            Dossier("bf1942", $"map{i}", Map("bf1942", $"map{i}", $"Map {i}", axis, allied));
            rows.Add(Row("bf1942", $"map{i}", "Axis", i * 10));
        }

        Rows([.. rows]);

        var army = Assert.Single((await RecordAsync()).Armies);

        Assert.Equal(["Map 6", "Map 5", "Map 4", "Map 3", "Map 2"], army.Maps.Select(map => map.DisplayName));
        Assert.Equal(210, army.Minutes);
    }

    [Fact]
    public async Task MotorPoolWeightsEachMachineByTheMinutesOfTheMapsThatFieldIt()
    {
        Dossier("bf1942", "wake", Wake());
        Dossier("bf1942", "iwo jima", IwoJima());
        Rows(Row("bf1942", "wake", "Allied", 60), Row("bf1942", "iwo jima", "Allied", 30));

        var army = Assert.Single((await RecordAsync()).Armies);

        // The Sherman spawns on both maps; the corsair only on Wake, the LVT only on Iwo
        // Jima. Emplacements and the other side's machines are not in the pool.
        Assert.Equal(
        [
            new ServiceRecordVehicle("sherman", "SHERMAN", "land", "vehicles/bf1942/sherman.png",
                "models/thumbs/sherman.png", "models/sherman.glb", 90, 2),
            new ServiceRecordVehicle("corsair", "CORSAIR", "air", "vehicles/bf1942/corsair.png",
                "models/thumbs/corsair.png", "models/corsair.glb", 60, 1),
            new ServiceRecordVehicle("lvt2", "LVT2", "sea", "vehicles/bf1942/lvt2.png",
                "models/thumbs/lvt2.png", "models/lvt2.glb", 30, 1),
        ], army.Vehicles);
    }

    [Fact]
    public async Task MotorPoolKeepsTheEightMostFielded()
    {
        var arsenal = Enumerable.Range(1, 10).Select(i => Machine(1, $"tank{i:00}", "land")).ToArray();
        Dossier("bf1942", "wake", Wake() with { Arsenal = arsenal });
        Rows(Row("bf1942", "wake", "Axis", 10));

        var army = Assert.Single((await RecordAsync()).Armies);

        Assert.Equal(8, army.Vehicles.Count);
        Assert.All(army.Vehicles, vehicle => Assert.Equal(10, vehicle.Minutes));
    }

    [Fact]
    public async Task SortsArmiesByMinutesAndRoundsToOneDecimal()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(Row("bf1942", "wake", "Axis", 10.04), Row("bf1942", "wake", "Allied", 12.36));

        var record = await RecordAsync();

        Assert.Equal(["US Marine Corps", "Imperial Japanese Army"], record.Armies.Select(army => army.Name));
        Assert.Equal([12.4, 10.0], record.Armies.Select(army => army.Minutes));
        Assert.Equal(22.4, record.TotalMinutes);
    }

    [Fact]
    public async Task ReadsEachDossierOnceForAllItsRows()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(Row("bf1942", "wake", "Axis", 10), Row("bf1942", "wake", "Allied", 10));

        await RecordAsync();

        await dossiers.Received(1).GetAsync("bf1942", "wake", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ReturnsNullForAnUnknownPlayer()
    {
        store.PlayerExistsAsync("Nobody", Arg.Any<CancellationToken>()).Returns(false);

        Assert.Null(await service.GetAsync("Nobody"));
        await store.DidNotReceive().GetRowsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ServesACachedRecordWithoutQuerying()
    {
        var cached = new PlayerServiceRecord(Player, 1, 1, [], [], new ServiceRecordUnattributed(0, 0),
            new ServiceRecordWindow(0, false, null));
        cache.GetAsync<PlayerServiceRecord>("service-record:v2:BetMan", Arg.Any<CancellationToken>()).Returns(cached);

        Assert.Same(cached, await service.GetAsync(Player));
        await store.DidNotReceive().PlayerExistsAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task CachesTheBuiltRecordForAnHour()
    {
        Rows();

        var record = await RecordAsync();

        await cache.Received(1).SetAsync("service-record:v2:BetMan", record, TimeSpan.FromHours(1),
            Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ReportsTheWindowOfSessionsItCovers()
    {
        var first = new DateTime(2026, 7, 1, 20, 0, 0, DateTimeKind.Utc);
        Dossier("bf1942", "wake", Wake());
        Window(true,
            Row("bf1942", "wake", "Axis", 10, rounds: 600, oldestStart: first.AddDays(3)),
            Row("bf1942", "wake", "7", 5, rounds: 400, oldestStart: first));

        var window = (await RecordAsync()).Window;

        // Every counted session, attributed or not, and the oldest of them.
        Assert.Equal(new ServiceRecordWindow(1000, true, first), window);
    }

    [Fact]
    public async Task ADesertCombatFinalServerKeepsInheritedMapsInItsOwnArmy()
    {
        // DC Final plays maps it inherits from Desert Combat, whose dossiers are filed under
        // desertcombat. The player was playing DC Final all the same: one United States.
        resolver.SearchPath("dc_final").Returns(["dc_final", "desertcombat", "bf1942"]);
        var usa = Team(2, "us", "United States", "USSoldier", "US_Assault");
        var iraq = Team(1, "", "Iraq", "IraqSoldier", "Iraq_Assault");
        Dossier("dc_final", "dc al nas", Map("dc_final", "dc_al_nas", "Al Nas", iraq, usa));
        Dossier("dc_final", "dc gazala", Map("desertcombat", "dc_gazala", "Gazala", iraq, usa));
        Rows(Row("dc_final", "dc al nas", "Allied", 30), Row("dc_final", "dc gazala", "Allied", 20));

        var army = Assert.Single((await RecordAsync()).Armies);

        Assert.Equal("dc_final:us", army.Key);
        Assert.Equal("dc_final", army.Mod);
        Assert.Equal(50, army.Minutes);
        Assert.Equal(2, army.Maps.Count);
    }

    [Fact]
    public async Task AServerThatDoesNotInheritTheDossiersModKeepsTheDossiersRoster()
    {
        // A bf1942 server reporting a DC map finds it through the resolver's fallback scan;
        // bf1942 inherits nothing from DC, so the army stays DC's.
        resolver.SearchPath("bf1942").Returns(["bf1942"]);
        var usa = Team(2, "us", "United States", "USSoldier", "US_Assault");
        var iraq = Team(1, "", "Iraq", "IraqSoldier", "Iraq_Assault");
        Dossier("bf1942", "dc al nas", Map("dc_final", "dc_al_nas", "Al Nas", iraq, usa));
        Rows(Row("bf1942", "dc al nas", "Axis", 30));

        var army = Assert.Single((await RecordAsync()).Armies);

        Assert.Equal("dc_final:iraq", army.Key);
    }

    [Fact]
    public async Task SerialisesTheContractFieldNames()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(Row("bf1942", "wake", "Axis", 10));
        var record = await RecordAsync();

        using var json = JsonDocument.Parse(JsonSerializer.Serialize(record, CamelCase));
        var root = json.RootElement;

        Assert.Equal(["playerName", "totalMinutes", "attributedMinutes", "sides", "armies", "unattributed", "window"], Names(root));
        Assert.Equal(["sessions", "capped", "since"], Names(root.GetProperty("window")));
        Assert.Equal(["side", "minutes", "rounds", "kills", "deaths", "wins", "losses"], Names(root.GetProperty("sides")[0]));
        Assert.Equal(["minutes", "rounds"], Names(root.GetProperty("unattributed")));

        var army = root.GetProperty("armies")[0];
        Assert.Equal(["key", "name", "nation", "nationLabel", "side", "mod", "minutes", "rounds", "kills", "deaths",
            "score", "wins", "losses", "maps", "kits", "figure", "vehicles"], Names(army));
        Assert.Equal(["gameId", "mapName", "displayName", "minutes", "rounds"], Names(army.GetProperty("maps")[0]));
        Assert.Equal(["template", "name", "role", "iconPath"], Names(army.GetProperty("kits")[0]));
        Assert.Equal(["skin", "thumb", "kits"], Names(army.GetProperty("figure")));
        Assert.Equal(["template", "weapon", "pose", "worn"], Names(army.GetProperty("figure").GetProperty("kits")[0]));
        Assert.Equal(["template", "name", "category", "iconPath", "thumb", "model", "minutes", "maps"],
            Names(army.GetProperty("vehicles")[0]));
    }

    [Fact]
    public async Task SurvivesTheRedisRoundTrip()
    {
        Dossier("bf1942", "wake", Wake());
        Rows(Row("bf1942", "wake", "Axis", 10), Row("bf1942", "wake", "Allied", 5));
        var record = await RecordAsync();

        var redis = new CacheService(
            new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions())),
            NullLogger<CacheService>.Instance);
        await redis.SetAsync("key", record, TimeSpan.FromMinutes(1));
        var restored = await redis.GetAsync<PlayerServiceRecord>("key");

        Assert.Equal(JsonSerializer.Serialize(record), JsonSerializer.Serialize(restored));
    }

    [Fact]
    public async Task Controller_Returns404ForAnUnknownPlayerAndDecodesTheName()
    {
        var records = Substitute.For<IServiceRecordService>();
        records.GetAsync("[BWT] Spion", Arg.Any<CancellationToken>()).Returns((PlayerServiceRecord?)null);

        var result = await new ServiceRecordController(records).GetServiceRecord("%5BBWT%5D%20Spion", CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
        await records.Received(1).GetAsync("[BWT] Spion", Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Controller_ReturnsTheRecord()
    {
        var records = Substitute.For<IServiceRecordService>();
        var record = new PlayerServiceRecord(Player, 0, 0, [], [], new ServiceRecordUnattributed(0, 0),
            new ServiceRecordWindow(0, false, null));
        records.GetAsync(Player, Arg.Any<CancellationToken>()).Returns(record);

        var result = await new ServiceRecordController(records).GetServiceRecord(Player, CancellationToken.None);

        Assert.Same(record, Assert.IsType<OkObjectResult>(result).Value);
    }

    private static List<string> Names(JsonElement element) =>
        [.. element.EnumerateObject().Select(property => property.Name)];

    public void Dispose() => memoryCache.Dispose();
}
