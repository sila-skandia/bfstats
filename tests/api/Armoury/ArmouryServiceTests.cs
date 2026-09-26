using api.Armoury;
using api.Armoury.Models;
using api.MapDossiers;
using api.MapDossiers.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace api.tests.Armoury;

public class ArmouryServiceTests
{
    private readonly IMapDossierService dossierService = Substitute.For<IMapDossierService>();
    private readonly IMeshArmouryIndex meshIndex = Substitute.For<IMeshArmouryIndex>();
    private readonly ArmouryService service;

    public ArmouryServiceTests()
    {
        meshIndex.TreesFor(Arg.Any<string>()).Returns(["bf1942"]);
        service = new ArmouryService(dossierService, meshIndex, NullLogger<ArmouryService>.Instance);
    }

    private static MapDossier Wake() => new()
    {
        Mod = "bf1942",
        Map = "wake",
        DisplayName = "Wake",
        // Deliberately out of order: the response always leads with team 1.
        Teams =
        [
            new MapDossierTeam
            {
                Index = 2, Nation = "us", Label = "United States", Skin = "USMarineSoldier",
                Kits = [new MapDossierKit { Template = "USMarine_Scout", Name = "Scout", Role = "scout", Icon = "usmarinescout", IconPath = "kits/bf1942/scoutallies.png" }],
            },
            new MapDossierTeam
            {
                Index = 1, Nation = "jp", Label = "Japan", Skin = "JapaneseSoldier",
                Kits = [new MapDossierKit { Template = "Jap_Assault", Name = "Assault", Role = "assault", Icon = "japassault", IconPath = null }],
            },
        ],
    };

    [Fact]
    public async Task GetMapArmiesAsync_NamesBothSidesOfTheMap()
    {
        dossierService.GetAsync("bf1942", "wake", Arg.Any<CancellationToken>()).Returns(Wake());
        var marines = new ArmyFigure("USMarineSoldier", "models/thumbs/usmarinesoldier.png", []);
        meshIndex.ResolveFigure("USMarineSoldier", Arg.Any<IReadOnlyList<string>>(), Arg.Any<IReadOnlyList<string>>())
            .Returns(marines);

        var armies = await service.GetMapArmiesAsync("bf1942", "wake");

        Assert.NotNull(armies);
        Assert.Equal("wake", armies.Map);
        Assert.Equal("Wake", armies.DisplayName);
        Assert.Collection(armies.Teams,
            axis =>
            {
                Assert.Equal(1, axis.Index);
                Assert.Equal("axis", axis.Side);
                Assert.Equal("bf1942:jp:JapaneseSoldier", axis.Key);
                Assert.Equal("Imperial Japanese Army", axis.Name);
                Assert.Equal("Japan", axis.NationLabel);
                var kit = Assert.Single(axis.Kits);
                Assert.Equal(new ArmyKit("Jap_Assault", "Assault", "assault", null), kit);
                Assert.Null(axis.Figure);
            },
            allied =>
            {
                Assert.Equal("allied", allied.Side);
                Assert.Equal("US Marine Corps", allied.Name);
                Assert.Equal("kits/bf1942/scoutallies.png", Assert.Single(allied.Kits).IconPath);
                Assert.Same(marines, allied.Figure);
            });

        // The figure is asked for the level's own kits, through the dossier mod's trees.
        meshIndex.Received().ResolveFigure("USMarineSoldier",
            Arg.Is<IReadOnlyList<string>>(kits => kits.SequenceEqual(new[] { "USMarine_Scout" })),
            Arg.Is<IReadOnlyList<string>>(trees => trees.SequenceEqual(new[] { "bf1942" })));
        meshIndex.Received().TreesFor("bf1942");
    }

    [Fact]
    public async Task GetMapArmiesAsync_ReturnsNull_WhenTheMapHasNoDossier()
    {
        dossierService.GetAsync("bf1942", "kursk_custom", Arg.Any<CancellationToken>()).Returns((MapDossier?)null);

        Assert.Null(await service.GetMapArmiesAsync("bf1942", "kursk_custom"));
    }

    [Fact]
    public async Task GetMapArmiesAsync_KeepsTheArmyWhenItsFigureCannotBeResolved()
    {
        dossierService.GetAsync("bf1942", "wake", Arg.Any<CancellationToken>()).Returns(Wake());
        meshIndex.ResolveFigure(Arg.Any<string?>(), Arg.Any<IReadOnlyList<string>>(), Arg.Any<IReadOnlyList<string>>())
            .Throws(new IOException("volume went away"));

        var armies = await service.GetMapArmiesAsync("bf1942", "wake");

        Assert.NotNull(armies);
        Assert.All(armies.Teams, team => Assert.Null(team.Figure));
        Assert.Equal(["Imperial Japanese Army", "US Marine Corps"], armies.Teams.Select(team => team.Name));
    }

    [Fact]
    public async Task Controller_Returns404_WhenTheMapHasNoDossier()
    {
        var armoury = Substitute.For<IArmouryService>();
        armoury.GetMapArmiesAsync("bf1942", "nowhere", Arg.Any<CancellationToken>()).Returns((MapArmies?)null);

        var result = await new ArmouryController(armoury).GetMapArmies("bf1942", "nowhere", CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public async Task Controller_ReturnsTheArmies()
    {
        var armoury = Substitute.For<IArmouryService>();
        var armies = new MapArmies("bf1942", "wake", "Wake", []);
        armoury.GetMapArmiesAsync("bf1942", "wake", Arg.Any<CancellationToken>()).Returns(armies);

        var result = await new ArmouryController(armoury).GetMapArmies("bf1942", "wake", CancellationToken.None);

        Assert.Same(armies, Assert.IsType<OkObjectResult>(result).Value);
    }
}
