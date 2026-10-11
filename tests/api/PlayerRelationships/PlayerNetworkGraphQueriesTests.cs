using api.PlayerRelationships;

namespace api.tests.PlayerRelationships;

public sealed class PlayerNetworkGraphQueriesTests
{
    [Theory]
    [InlineData(120, 15)]
    [InlineData(100, 15)]
    [InlineData(48, 8)]
    [InlineData(1, 8)]
    [InlineData(200, 15)]
    public void AllyLimit_ClampsBetweenEightAndFifteen(int maxNodes, int expected)
    {
        Assert.Equal(expected, PlayerNetworkGraphQueries.AllyLimit(maxNodes));
    }

    [Fact]
    public void AllyClique_OnlySeeksAmongAllyNames()
    {
        var cypher = PlayerNetworkGraphQueries.AllyClique;

        Assert.Contains("UNWIND $allyNames AS a", cypher, StringComparison.Ordinal);
        Assert.Contains("UNWIND $allyNames AS b", cypher, StringComparison.Ordinal);
        Assert.DoesNotContain("$names", cypher, StringComparison.Ordinal);
        Assert.DoesNotContain("fof", cypher, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void DiscoveryQueries_ReturnLastPlayedForTreeEdges()
    {
        Assert.Contains("r.lastPlayedTogether AS lastPlayed", PlayerNetworkGraphQueries.Allies, StringComparison.Ordinal);
        Assert.Contains("r2.lastPlayedTogether AS lastPlayed", PlayerNetworkGraphQueries.FriendsOfFriends, StringComparison.Ordinal);
        Assert.Contains("LIMIT $fofPerAlly", PlayerNetworkGraphQueries.FriendsOfFriends, StringComparison.Ordinal);
    }

    [Fact]
    public void EdgeKey_IsOrderInsensitive()
    {
        Assert.Equal(
            PlayerNetworkGraphQueries.EdgeKey("Daz28", "RoyLeesen"),
            PlayerNetworkGraphQueries.EdgeKey("RoyLeesen", "Daz28"));
        Assert.NotEqual(
            PlayerNetworkGraphQueries.EdgeKey("Daz28", "RoyLeesen"),
            PlayerNetworkGraphQueries.EdgeKey("Daz28", "Andrey"));
    }
}
