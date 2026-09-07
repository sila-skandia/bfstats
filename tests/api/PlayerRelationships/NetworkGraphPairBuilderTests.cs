using api.PlayerRelationships;

namespace api.tests.PlayerRelationships;

public sealed class NetworkGraphPairBuilderTests
{
    [Fact]
    public void BuildUniquePairs_EmptyOrSingle_ReturnsNoPairs()
    {
        Assert.Empty(NetworkGraphPairBuilder.BuildUniquePairs([]));
        Assert.Empty(NetworkGraphPairBuilder.BuildUniquePairs(["only"]));
    }

    [Fact]
    public void BuildUniquePairs_OrdersEachPairLexicographically()
    {
        var pairs = NetworkGraphPairBuilder.BuildUniquePairs(["zeta", "alpha"]);

        Assert.Equal([("alpha", "zeta")], pairs);
    }

    [Fact]
    public void BuildUniquePairs_FifteenAllies_StaysAtOneHundredFive()
    {
        var names = Enumerable.Range(0, 15).Select(i => $"p{i:D2}").ToList();

        var pairs = NetworkGraphPairBuilder.BuildUniquePairs(names);

        Assert.Equal(105, pairs.Count);
        Assert.Equal(pairs.Count, pairs.Distinct().Count());
        Assert.All(pairs, pair => Assert.True(string.CompareOrdinal(pair.A, pair.B) < 0));
    }

    [Fact]
    public void BuildUniquePairs_FiftyThreeNodes_IsAnOrderOfMagnitudeLargerThanFifteenAllies()
    {
        var allNodes = Enumerable.Range(0, 53).Select(i => $"n{i:D2}").ToList();
        var allies = allNodes.Take(15).ToList();

        var allPairs = NetworkGraphPairBuilder.BuildUniquePairs(allNodes);
        var allyPairs = NetworkGraphPairBuilder.BuildUniquePairs(allies);

        Assert.Equal(1378, allPairs.Count);
        Assert.Equal(105, allyPairs.Count);
        Assert.True(allPairs.Count > allyPairs.Count * 10);
    }

    [Fact]
    public void BuildUniquePairs_FiftySevenNodes_MatchesLittleCarmineCartesian()
    {
        var allNodes = Enumerable.Range(0, 57).Select(i => $"n{i:D2}").ToList();

        var allPairs = NetworkGraphPairBuilder.BuildUniquePairs(allNodes);
        var allyPairs = NetworkGraphPairBuilder.BuildUniquePairs(allNodes.Take(15).ToList());

        Assert.Equal(1596, allPairs.Count);
        Assert.Equal(105, allyPairs.Count);
    }
}
