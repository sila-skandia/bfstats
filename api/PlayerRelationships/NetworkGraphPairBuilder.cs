namespace api.PlayerRelationships;

internal static class NetworkGraphPairBuilder
{
    public static List<(string A, string B)> BuildUniquePairs(IReadOnlyList<string> names)
    {
        var pairCount = names.Count * Math.Max(0, names.Count - 1) / 2;
        var pairs = new List<(string A, string B)>(pairCount);
        for (var i = 0; i < names.Count; i++)
        {
            for (var j = i + 1; j < names.Count; j++)
            {
                var a = names[i];
                var b = names[j];
                if (string.CompareOrdinal(a, b) < 0)
                    pairs.Add((a, b));
                else
                    pairs.Add((b, a));
            }
        }

        return pairs;
    }
}
