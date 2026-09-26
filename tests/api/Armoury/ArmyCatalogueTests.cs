using api.Armoury;
using api.MapDossiers.Models;

namespace api.tests.Armoury;

public class ArmyCatalogueTests
{
    private static MapDossierTeam Team(int index, string? nation, string label, string? skin) =>
        new() { Index = index, Nation = nation, Label = label, Skin = skin };

    [Theory]
    [InlineData("bf1942", 2, "rus", "Soviet Union", "RussianSoldier", "bf1942:rus:RussianSoldier", "Red Army")]
    [InlineData("bf1942", 1, "ger", "Germany", "GermanDesertSoldier", "bf1942:ger:GermanDesertSoldier", "Afrika Korps")]
    [InlineData("bf1942", 1, "jp", "Japan", "JapaneseSoldier", "bf1942:jp:JapaneseSoldier", "Imperial Japanese Army")]
    [InlineData("xpack1", 1, "ita", "Italy", "ItalianSoldier", "bf1942:ita:ItalianSoldier", "Italian Army")]
    [InlineData("xpack1", 2, "fra", "France", "FrenchSoldier", "bf1942:fra:FrenchSoldier", "Free French")]
    [InlineData("xpack2", 1, "ger", "Germany", "GermanEliteSoldier", "bf1942:ger:GermanEliteSoldier", "German Elite")]
    [InlineData("xpack2", 2, "brit", "Great Britain", "BritishCommandoSoldier", "bf1942:brit:BritishCommandoSoldier", "British Commandos")]
    [InlineData("bf1942", 2, "us", "United States", "USMarineSoldier", "bf1942:us:USMarineSoldier", "US Marine Corps")]
    public void Identify_NamesTheWorldWarTwoRosterPerSkin(string mod, int index, string nation, string label,
        string skin, string expectedKey, string expectedName)
    {
        var army = ArmyCatalogue.Identify(mod, Team(index, nation, label, skin));

        Assert.Equal(expectedKey, army.Key);
        Assert.Equal(expectedName, army.Name);
        Assert.Equal(nation, army.Nation);
        Assert.Equal(label, army.NationLabel);
        Assert.Equal("bf1942", army.Family);
    }

    [Fact]
    public void Identify_TheThreeWorldWarTwoPacksShareOneArmy()
    {
        // A Wehrmacht soldier on a Secret Weapons map served in the same army as on a vanilla one.
        var vanilla = ArmyCatalogue.Identify("bf1942", Team(1, "ger", "Germany", "GermanSoldier"));
        var secretWeapons = ArmyCatalogue.Identify("XPack2", Team(1, "ger", "Germany", "GermanSoldier"));

        Assert.Equal(vanilla.Key, secretWeapons.Key);
        Assert.Equal("Wehrmacht", secretWeapons.Name);
    }

    [Fact]
    public void Identify_BritishUniformUnderTheCanadianFlagIsTheCanadianArmy()
    {
        var canadians = ArmyCatalogue.Identify("bf1942", Team(2, "can", "Canada", "BritishSoldier"));
        var british = ArmyCatalogue.Identify("bf1942", Team(2, "brit", "Great Britain", "BritishSoldier"));

        Assert.Equal("Canadian Army", canadians.Name);
        Assert.Equal("bf1942:can:BritishSoldier", canadians.Key);
        Assert.Equal("British Army", british.Name);
        Assert.NotEqual(british.Key, canadians.Key);
    }

    [Fact]
    public void Identify_EveOfDestructionUsesItsOwnRosterAndKeepsTheNationInTheKey()
    {
        var unflagged = ArmyCatalogue.Identify("eod", Team(1, null, "NVA", "NVASoldier"));
        var flaggedSoviet = ArmyCatalogue.Identify("eod", Team(1, "rus", "Soviet Union", "NVASoldier"));

        Assert.Equal("eod:-:NVASoldier", unflagged.Key);
        Assert.Equal("North Vietnamese Army", unflagged.Name);
        Assert.Null(unflagged.Nation);
        Assert.Equal("eod", unflagged.Family);

        // The skin names the army; the flag only separates the key.
        Assert.Equal("eod:rus:NVASoldier", flaggedSoviet.Key);
        Assert.Equal("North Vietnamese Army", flaggedSoviet.Name);
        Assert.Equal("Soviet Union", flaggedSoviet.NationLabel);
    }

    [Theory]
    [InlineData("USSoldier", "US Army")]
    [InlineData("VCFemaleSoldier", "Viet Cong")]
    [InlineData("CivilVC_Soldier", "Viet Cong")]
    [InlineData("SpecialForces", "Special Forces")]
    [InlineData("ARVNForces", "ARVN")]
    [InlineData("NavySeals", "Navy SEALs")]
    [InlineData("AustralianForces", "Australian Army")]
    [InlineData("PathetLaosSoldier", "Pathet Lao")]
    [InlineData("FrenchSoldier", "French Union")]
    public void Identify_CuratesEveOfDestructionSkins(string skin, string expectedName)
    {
        Assert.Equal(expectedName, ArmyCatalogue.Identify("eod", Team(2, null, "Whatever", skin)).Name);
    }

    [Fact]
    public void Identify_EveOfDestructionFallsBackToTheHumanisedLabel()
    {
        Assert.Equal("Rambo", ArmyCatalogue.Identify("eod", Team(2, null, "Rambo", "RamboSoldier")).Name);
        Assert.Equal("Mobile Riverine Force",
            ArmyCatalogue.Identify("eod", Team(2, null, "MobileRiverineForce", "RiverineSoldier")).Name);
    }

    [Fact]
    public void Identify_ReadsASkinSpelledInAnotherCaseAsTheSameSoldier()
    {
        // One EoD level spells its Viet Cong "VietcongSoldier"; the engine does not care.
        var odd = ArmyCatalogue.Identify("eod", Team(1, null, "Vietcong", "VietcongSoldier"));
        var usual = ArmyCatalogue.Identify("eod", Team(1, null, "VietCong", "VietCongSoldier"));

        Assert.Equal(usual.Key, odd.Key);
        Assert.Equal("eod:-:VietCongSoldier", odd.Key);
        Assert.Equal("Viet Cong", odd.Name);
    }

    [Fact]
    public void Identify_OtherModsGroupByNationNotSkin()
    {
        // FHSW fields several German skins; they are one army called Germany.
        var regulars = ArmyCatalogue.Identify("fhsw", Team(1, "ger", "Germany", "GermanSoldier"));
        var mountainTroops = ArmyCatalogue.Identify("fhsw", Team(1, "ger", "Germany", "GebirgsjagerSoldier"));

        Assert.Equal("fhsw:ger", regulars.Key);
        Assert.Equal(regulars.Key, mountainTroops.Key);
        Assert.Equal("Germany", regulars.Name);
        Assert.Equal("fhsw", regulars.Family);
    }

    [Fact]
    public void Identify_OtherModsWithoutANationGroupByLabel()
    {
        var iraq = ArmyCatalogue.Identify("dc_final", Team(1, null, "Iraq", "IraqiSoldier"));
        var us = ArmyCatalogue.Identify("DC_Final", Team(2, "us", "United States", "USSoldier"));

        Assert.Equal("dc_final:iraq", iraq.Key);
        Assert.Equal("Iraq", iraq.Name);
        Assert.Equal("dc_final:us", us.Key);
        Assert.Equal("United States", us.Name);
        Assert.Equal("dc_final", us.Family);
    }

    [Fact]
    public void Identify_OtherModsFoldTheCaseOfALabelKey()
    {
        // bf1918 labels the same Austro-Hungarian army "Kuk" on some levels and "kuk" on others.
        Assert.Equal(
            ArmyCatalogue.Identify("bf1918", Team(1, null, "Kuk", "KukSoldier")).Key,
            ArmyCatalogue.Identify("bf1918", Team(1, null, "kuk", "KukSoldier")).Key);
    }

    [Theory]
    [InlineData(1, "axis")]
    [InlineData(2, "allied")]
    public void Identify_TeamOneIsTheAxis(int index, string expectedSide)
    {
        Assert.Equal(expectedSide, ArmyCatalogue.Identify("bf1942", Team(index, "us", "United States", "USSoldier")).Side);
    }

    [Theory]
    [InlineData("bf1942", "bf1942")]
    [InlineData("XPack1", "bf1942")]
    [InlineData(" xpack2 ", "bf1942")]
    [InlineData("EOD", "eod")]
    [InlineData("fhsw", "fhsw")]
    [InlineData("DC_Final", "dc_final")]
    public void FamilyOf_FoldsTheWorldWarTwoPacks(string mod, string expected)
    {
        Assert.Equal(expected, ArmyCatalogue.FamilyOf(mod));
    }

    [Theory]
    [InlineData("SpecialForces", "Special Forces")]
    [InlineData("ARVNForces", "ARVN Forces")]
    [InlineData("CivilVC_Soldier", "Civil VC Soldier")]
    [InlineData("United States", "United States")]
    [InlineData("NVA", "NVA")]
    [InlineData("FMGermanSoldier16", "FM German Soldier 16")]
    public void Humanise_SplitsCamelCase(string value, string expected)
    {
        Assert.Equal(expected, ArmyCatalogue.Humanise(value));
    }
}
