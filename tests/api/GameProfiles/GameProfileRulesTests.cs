using api.GameProfiles;

namespace api.tests.GameProfiles;

public sealed class GameProfileRulesTests
{
    [Theory]
    [InlineData("rem *** Generated ***\r\n\r\ngame.setPlayerName \"skandia\"\r\ngame.setConnection 2\r\n", "skandia")]
    [InlineData("game.setPlayerName \"[CLAN] Rommel\"", "[CLAN] Rommel")]
    [InlineData("GAME.SETPLAYERNAME   \"Patton\"", "Patton")]
    [InlineData("game.setPlayerName Bare", "Bare")]
    [InlineData("game.setPlayerName \"First\"\ngame.setPlayerName \"Second\"", "Second")]
    public void ReadPlayerName_ReadsTheGamesLine(string text, string expected) =>
        Assert.Equal(expected, GameProfileRules.ReadPlayerName(text));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("game.setConnection 2")]
    [InlineData("rem game.setPlayerName \"Commented\"")]
    [InlineData("game.setPlayerName \"\"")]
    public void ReadPlayerName_IsNullWithoutAName(string? text) =>
        Assert.Null(GameProfileRules.ReadPlayerName(text));

    [Theory]
    [InlineData("skandia")]
    [InlineData("Default")]
    [InlineData("[CLAN] Rommel (2)")]
    [InlineData("12345678901234567890123456789012")]
    public void ValidateName_AcceptsFolderNames(string name) => Assert.Null(GameProfileRules.ValidateName(name));

    [Theory]
    [InlineData("")]
    [InlineData("123456789012345678901234567890123")]
    [InlineData(" padded")]
    [InlineData("padded ")]
    [InlineData("..")]
    [InlineData(".hidden")]
    [InlineData("a/b")]
    [InlineData("a\\b")]
    [InlineData("what?")]
    [InlineData("tab\there")]
    public void ValidateName_RefusesUnsafeNames(string name) => Assert.NotNull(GameProfileRules.ValidateName(name));

    [Fact]
    public void ValidateFiles_KeepsTheFiveFiles_UnderTheirCanonicalKeys()
    {
        var (files, error) = GameProfileRules.ValidateFiles(new Dictionary<string, string?>
        {
            ["controls/common.con"] = "a",
            ["Controls\\Infantry.con"] = "b",
            ["Controls/Air.con"] = "c",
            ["Controls/Land.con"] = "d",
            ["generaloptions.con"] = "e",
        });

        Assert.Null(error);
        Assert.Equal(GameProfileRules.AllowedFiles.Order(), files!.Keys.Order());
        Assert.Equal("a", files["Controls/Common.con"]);
        Assert.Equal("e", files["GeneralOptions.con"]);
    }

    [Theory]
    [InlineData("Video.con")]
    [InlineData("BuddyList.con")]
    [InlineData("ServerList.dat")]
    [InlineData("Controls/Other.con")]
    [InlineData("../GeneralOptions.con")]
    public void ValidateFiles_RefusesOtherFiles(string key)
    {
        var (files, error) = GameProfileRules.ValidateFiles(new Dictionary<string, string?> { [key] = "x" });
        Assert.Null(files);
        Assert.Contains(key, error);
    }

    [Fact]
    public void ValidateFiles_AllowsExactly64KB()
    {
        var limit = new string('a', GameProfileRules.MaxFileBytes);
        Assert.NotNull(GameProfileRules.ValidateFiles(new Dictionary<string, string?> { ["Controls/Air.con"] = limit }).Files);
        Assert.Null(GameProfileRules.ValidateFiles(new Dictionary<string, string?> { ["Controls/Air.con"] = limit + "a" }).Files);
    }

    [Fact]
    public void ValidateFiles_CountsBytesNotCharacters()
    {
        // Two UTF-8 bytes each: half as many characters reach the limit.
        var text = new string('é', GameProfileRules.MaxFileBytes / 2 + 1);
        Assert.Null(GameProfileRules.ValidateFiles(new Dictionary<string, string?> { ["Controls/Air.con"] = text }).Files);
    }

    [Fact]
    public void ValidateFiles_RefusesAKeyGivenTwiceUnderTwoSpellings()
    {
        var (files, _) = GameProfileRules.ValidateFiles(new Dictionary<string, string?>
        {
            ["Controls/Air.con"] = "a",
            ["controls/air.con"] = "b",
        });
        Assert.Null(files);
    }

    [Fact]
    public void ValidateFiles_RefusesNullsAndNoFiles()
    {
        Assert.Null(GameProfileRules.ValidateFiles(null).Files);
        Assert.Null(GameProfileRules.ValidateFiles(new Dictionary<string, string?> { ["Controls/Air.con"] = null }).Files);
    }
}
