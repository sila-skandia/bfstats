using api.Armoury;
using api.MapDossiers;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.Armoury;

[Collection(SharedAssetsPath.Name)]
public sealed class MeshArmouryIndexTests : IDisposable
{
    private readonly string assetsRoot;
    private readonly string? previousAssetsPath;
    private readonly MeshArmouryIndex index;

    public MeshArmouryIndexTests()
    {
        assetsRoot = Path.Combine(Path.GetTempPath(), "bfstats-armoury-" + Guid.NewGuid().ToString("N"));
        previousAssetsPath = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", assetsRoot);

        Write("dossiers/manifest.json", """
        {
          "version": 1,
          "mods": {
            "bf1942": { "searchPath": ["bf1942"], "maps": [] },
            "xpack1": { "searchPath": ["xpack1", "bf1942"], "maps": [] },
            "xpack2": { "searchPath": ["xpack2", "bf1942"], "maps": [] },
            "eod": { "searchPath": ["eod", "bf1942"], "maps": [] },
            "dc_final": { "searchPath": ["dc_final", "desertcombat", "bf1942"], "maps": [] }
          }
        }
        """);

        // Vanilla: the manifest spells MP18, the pose file Mp18.
        Write("mesh/models/kits.json", """
        {
          "mod": "bf1942",
          "kits": [
            { "template": "Rus_Assault", "class": "Assault",
              "items": [ { "template": "MP18" }, { "template": "Colt" } ],
              "worn": [ { "template": "Russ_Helmet", "slot": "head", "bone": "A",
                          "position": [0.0, 0.1, 0.0], "rotation": [0.0, 0.0, 90.0], "glb": "Russ_Helmet.kit.glb" } ] },
            { "template": "Rus_AT", "items": [ { "template": "Bazooka" }, { "template": "Colt" } ], "worn": [] },
            { "template": "Rus_Medic", "items": [ { "template": "Nothing" } ], "worn": [] },
            { "template": "German_Assault", "items": [ { "template": "Sg44" }, { "template": "Gewehr42" } ], "worn": [] },
            { "template": "US_Assault", "items": [ { "template": "Thompson" } ], "worn": [] }
          ]
        }
        """);
        Touch("mesh/models/poses/RussianSoldier__Mp18.pose.glb");
        Touch("mesh/models/poses/RussianSoldier__Colt.pose.glb");
        Touch("mesh/models/poses/GermanSoldier__Sg44.pose.glb");
        Touch("mesh/models/poses/USSoldier__Thompson.pose.glb");
        Touch("mesh/models/Russ_Helmet.kit.glb");
        Touch("mesh/models/Radio.kit.glb");
        Touch("mesh/models/Chi-ha.glb");
        Touch("mesh/models/AA_Allies.glb");
        Touch("mesh/models/AA_Allies.cockpit.glb");
        Touch("mesh/models/Sherman.glb");
        Touch("mesh/models/thumbs/russiansoldier.png");
        Touch("mesh/models/thumbs/chi-ha.png");
        Touch("mesh/models/thumbs/aa-allies.png");
        Touch("mesh/models/thumbs/sherman.png");

        // Secret Weapons writes only what it adds: its own soldiers, and vanilla soldiers
        // holding its new weapons.
        Write("mesh/models/mods/xpack2/kits.json", """
        {
          "mod": "xpack2",
          "kits": [
            { "template": "GermanElite_Assault",
              "items": [ { "template": "Gewehr42" } ],
              "worn": [
                { "template": "GermanElite_Helmet", "slot": "head", "bone": "A", "glb": "GermanElite_Helmet.kit.glb" },
                { "template": "Radio", "slot": "back", "bone": "backpack", "glb": "radio.kit.glb" },
                { "template": "Ghost", "slot": "hip", "bone": "HipPack", "glb": "Missing.kit.glb" },
                { "template": "Unbaked", "slot": "hip", "bone": "HipPack", "glb": null }
              ] }
          ]
        }
        """);
        Touch("mesh/models/mods/xpack2/poses/GermanEliteSoldier__Gewehr42.pose.glb");
        Touch("mesh/models/mods/xpack2/poses/GermanSoldier__Gewehr42.pose.glb");
        Touch("mesh/models/mods/xpack2/GermanElite_Helmet.kit.glb");
        Touch("mesh/models/mods/xpack2/Sturmtiger.glb");
        Touch("mesh/models/mods/xpack2/thumbs/germanelitesoldier.png");
        Touch("mesh/models/mods/xpack2/thumbs/sturmtiger.png");

        // Eve of Destruction re-skins USSoldier; its tree is complete on its own.
        Write("mesh/models/mods/eod/kits.json", """
        { "mod": "eod", "kits": [ { "template": "US_Rifleman", "items": [ { "template": "M16" } ], "worn": [] } ] }
        """);
        Touch("mesh/models/mods/eod/poses/USSoldier__M16.pose.glb");

        var resolver = new MapDossierResolver(NullLogger<MapDossierResolver>.Instance);
        index = new MeshArmouryIndex(resolver, NullLogger<MeshArmouryIndex>.Instance);
    }

    private void Write(string relativePath, string content)
    {
        var path = Path.Combine(assetsRoot, relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, content);
    }

    private void Touch(string relativePath) => Write(relativePath, "glTF");

    [Theory]
    [InlineData("bf1942", new[] { "bf1942" })]
    [InlineData("xpack2", new[] { "xpack2", "bf1942" })]
    // Road to Rome has no tree of its own here, so only vanilla's remains.
    [InlineData("xpack1", new[] { "bf1942" })]
    // Outside the WWII packs vanilla's soldiers are the wrong soldiers, so its tree is never searched.
    [InlineData("eod", new[] { "eod" })]
    [InlineData("dc_final", new string[0])]
    public void TreesFor_MapsTheSearchPathToExistingTrees(string mod, string[] expected)
    {
        Assert.Equal(expected, index.TreesFor(mod));
    }

    [Fact]
    public void ResolveFigure_MatchesTheWeaponIgnoringCaseAndReturnsTheFilesSpelling()
    {
        var figure = index.ResolveFigure("RussianSoldier", ["RUS_assault"], ["bf1942"]);

        Assert.NotNull(figure);
        Assert.Equal("RussianSoldier", figure.Skin);
        var kit = Assert.Single(figure.Kits);
        // The dossier's spelling of the kit, so a page can match it against the army's kits.
        Assert.Equal("RUS_assault", kit.Template);
        Assert.Equal("Mp18", kit.Weapon);
        Assert.Equal("models/poses/RussianSoldier__Mp18.pose.glb", kit.Pose);

        var helmet = Assert.Single(kit.Worn);
        Assert.Equal("models/Russ_Helmet.kit.glb", helmet.Path);
        Assert.Equal("A", helmet.Bone);
        Assert.Equal("head", helmet.Slot);
        Assert.Equal([0.0, 0.1, 0.0], helmet.Position);
        Assert.Equal([0.0, 0.0, 90.0], helmet.Rotation);
    }

    [Fact]
    public void ResolveFigure_FallsBackToTheNextItemWhenTheFirstHasNoPose()
    {
        var figure = index.ResolveFigure("RussianSoldier", ["Rus_AT"], ["bf1942"]);

        var kit = Assert.Single(figure!.Kits);
        Assert.Equal("Colt", kit.Weapon);
        Assert.Equal("models/poses/RussianSoldier__Colt.pose.glb", kit.Pose);
    }

    [Fact]
    public void ResolveFigure_OmitsKitsWithNoPosedItemAndKitsNoManifestNames()
    {
        var figure = index.ResolveFigure("RussianSoldier", ["Rus_Medic", "Rus_Unknown", "Rus_Assault"], ["bf1942"]);

        Assert.NotNull(figure);
        Assert.Equal(["Rus_Assault"], figure.Kits.Select(kit => kit.Template));
    }

    [Fact]
    public void ResolveFigure_FindsEachWeaponPoseAcrossTheSearchPath()
    {
        // Secret Weapons' tree has GermanSoldier poses, but only for its own Gewehr42. The
        // vanilla kit's primary is posed in vanilla's tree alone and must still win.
        var figure = index.ResolveFigure("GermanSoldier", ["German_Assault"], index.TreesFor("xpack2"));

        var kit = Assert.Single(figure!.Kits);
        Assert.Equal("Sg44", kit.Weapon);
        Assert.Equal("models/poses/GermanSoldier__Sg44.pose.glb", kit.Pose);
    }

    [Fact]
    public void ResolveFigure_TakesAModWeaponFromTheModTree()
    {
        var figure = index.ResolveFigure("GermanEliteSoldier", ["GermanElite_Assault"], index.TreesFor("xpack2"));

        Assert.NotNull(figure);
        Assert.Equal("models/mods/xpack2/thumbs/germanelitesoldier.png", figure.Thumb);
        var kit = Assert.Single(figure.Kits);
        Assert.Equal("Gewehr42", kit.Weapon);
        Assert.Equal("models/mods/xpack2/poses/GermanEliteSoldier__Gewehr42.pose.glb", kit.Pose);
    }

    [Fact]
    public void ResolveFigure_TakesEachWornPartFromTheFirstTreeThatHasIt()
    {
        var figure = index.ResolveFigure("GermanEliteSoldier", ["GermanElite_Assault"], index.TreesFor("xpack2"));

        var worn = Assert.Single(figure!.Kits).Worn;
        // The mod's own helmet, vanilla's radio (spelled in another case), and nothing for a
        // part no tree has or the extractor never baked.
        Assert.Equal(["models/mods/xpack2/GermanElite_Helmet.kit.glb", "models/Radio.kit.glb"],
            worn.Select(part => part.Path));
        Assert.Equal([0.0, 0.0, 0.0], worn[1].Position);
        Assert.Equal([0.0, 0.0, 0.0], worn[1].Rotation);
        Assert.Equal("backpack", worn[1].Bone);
    }

    [Fact]
    public void ResolveFigure_IsNullWhenNoKitCanBePosed()
    {
        // Eve of Destruction levels that issue only parachute kits: the soldier exists, but
        // nothing he is issued has a pose, so there is nothing to draw.
        Assert.Null(index.ResolveFigure("RussianSoldier", ["Rus_Medic", "Rus_Unknown"], ["bf1942"]));
    }

    [Fact]
    public void ResolveFigure_IsNullWhenNoTreeHasAPoseForTheSkin()
    {
        Assert.Null(index.ResolveFigure("ItalianSoldier", ["Rus_Assault"], index.TreesFor("xpack2")));
        Assert.Null(index.ResolveFigure(null, ["Rus_Assault"], ["bf1942"]));
    }

    [Fact]
    public void ResolveFigure_NeverDrawsAVanillaSoldierForAnotherModsArmy()
    {
        // Desert Combat's "United States" wears USSoldier too, but DC's soldier is not the
        // WWII GI in vanilla's tree; with no DC tree there is no figure at all.
        Assert.Null(index.ResolveFigure("USSoldier", ["US_Assault"], index.TreesFor("dc_final")));

        // EoD has its own USSoldier: its own kit resolves, and a kit posed only in vanilla does not.
        var figure = index.ResolveFigure("USSoldier", ["US_Assault", "US_Rifleman"], index.TreesFor("eod"));
        var kit = Assert.Single(figure!.Kits);
        Assert.Equal("models/mods/eod/poses/USSoldier__M16.pose.glb", kit.Pose);
    }

    [Fact]
    public void ResolveFigure_ThumbIsNullWhenNoTreeHasOne()
    {
        var figure = index.ResolveFigure("GermanSoldier", ["German_Assault"], ["bf1942"]);

        Assert.NotNull(figure);
        Assert.Null(figure.Thumb);
    }

    [Fact]
    public void ResolveVehicle_FindsTheModelAndThumbnailIgnoringCase()
    {
        var chiHa = index.ResolveVehicle("chi-ha", ["bf1942"]);
        Assert.Equal("models/Chi-ha.glb", chiHa.Model);
        Assert.Equal("models/thumbs/chi-ha.png", chiHa.Thumb);

        // The model is the machine itself, not one of its variants.
        var flak = index.ResolveVehicle("AA_allies", ["bf1942"]);
        Assert.Equal("models/AA_Allies.glb", flak.Model);
        Assert.Equal("models/thumbs/aa-allies.png", flak.Thumb);
    }

    [Fact]
    public void ResolveVehicle_SearchesTheModTreeFirst()
    {
        var sturmtiger = index.ResolveVehicle("sturmtiger", index.TreesFor("xpack2"));
        Assert.Equal("models/mods/xpack2/Sturmtiger.glb", sturmtiger.Model);
        Assert.Equal("models/mods/xpack2/thumbs/sturmtiger.png", sturmtiger.Thumb);

        var sherman = index.ResolveVehicle("sherman", index.TreesFor("xpack2"));
        Assert.Equal("models/Sherman.glb", sherman.Model);
    }

    [Fact]
    public void ResolveVehicle_LeavesBothNullWhenNothingMatches()
    {
        var unknown = index.ResolveVehicle("flak38", ["bf1942"]);
        Assert.Null(unknown.Model);
        Assert.Null(unknown.Thumb);

        // Forgotten Hope's Sherman is not vanilla's.
        var elsewhere = index.ResolveVehicle("sherman", index.TreesFor("dc_final"));
        Assert.Null(elsewhere.Model);
        Assert.Null(elsewhere.Thumb);
    }

    [Theory]
    [InlineData("chi-ha", "chi-ha")]
    [InlineData("AA_allies", "aa-allies")]
    [InlineData("CivilVC_Soldier", "civilvc-soldier")]
    [InlineData("M11-39", "m11-39")]
    [InlineData("_Boat (Big)_", "boat-big")]
    [InlineData("", "base")]
    [InlineData(null, "base")]
    public void Slug_MatchesTheThumbnailRenderer(string? value, string expected)
    {
        Assert.Equal(expected, MeshArmouryIndex.Slug(value));
    }

    public void Dispose()
    {
        Environment.SetEnvironmentVariable("ASSETS_STORAGE_PATH", previousAssetsPath);
        if (Directory.Exists(assetsRoot))
            Directory.Delete(assetsRoot, recursive: true);
    }
}
