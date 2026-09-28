using api.Recordings.Models;

namespace api.Recordings;

/// <summary>
/// Whether two recordings are of one round (features/replay-feed, "Rounds"). Each file's
/// <c>t</c> is its own recorder's clock, so the files are lined up by what they say, the way
/// the merge lines them up (round-replay-merge, "Time"): every pair of copies of a key either
/// fingerprint has only a few of proposes an offset between the two clocks, and the offset
/// the most keys agree on, within a second, is taken. At that offset the copies are paired one
/// to one. Two recordings are one round when enough player keys pair there and they are most
/// of the player keys either recording has over the stretch both cover.
/// <para>
/// Object keys vote and are counted, but do not decide: two rounds of one map begun from the
/// same moment make their first objects under the same ids at the same times (measured: a
/// round's opening spawns put 60 object keys, 0.61 of the pair's keys, at one offset against
/// a different round, and no player key).
/// </para>
/// </summary>
public static class RoundMatcher
{
    public static RoundMatch Match(RoundFingerprint first, RoundFingerprint second, RecordingsOptions options)
    {
        var playerSample = Math.Min(first.PlayerSample, second.PlayerSample);
        var objectSample = Math.Min(first.ObjectSample, second.ObjectSample);
        var mine = Rare(first.Keys, playerSample, objectSample, options.RoundRareKey);
        var theirs = Rare(second.Keys, playerSample, objectSample, options.RoundRareKey);

        var votes = new List<(int Delta, uint Hash)>();
        foreach (var (hash, times) in mine)
        {
            if (!theirs.TryGetValue(hash, out var others)) continue;
            foreach (var a in times)
            {
                foreach (var b in others) votes.Add((a - b, hash));
            }
        }
        if (votes.Count == 0) return RoundMatch.None;

        var offset = DensestOffset(votes, (int)Math.Round(options.RoundWindowSeconds * 1000));
        var window = (int)Math.Round(options.RoundPairSeconds * 1000);
        var matched = 0;
        var matchedPlayer = 0;
        foreach (var (hash, times) in mine)
        {
            if (!theirs.TryGetValue(hash, out var others)) continue;
            var pairs = Pairs(times, others, offset, window);
            matched += pairs;
            if ((hash & RoundKey.PlayerBit) != 0) matchedPlayer += pairs;
        }

        // The stretch both cover, on the first's clock.
        var seconds = offset / 1000.0;
        var from = Math.Max(first.LiveFromSeconds, second.LiveFromSeconds + seconds);
        var to = Math.Min(first.LiveToSeconds, second.LiveToSeconds + seconds);
        if (to <= from) return RoundMatch.None with { OffsetSeconds = seconds };
        var (all, player) = Within(mine, from, to, 0);
        var (allOther, playerOther) = Within(theirs, from, to, seconds);
        var share = matched / (double)Math.Max(1, Math.Min(all, allOther));
        var playerShare = matchedPlayer / (double)Math.Max(1, Math.Min(player, playerOther));
        var same = matched >= options.RoundMinMatches
            && matchedPlayer >= options.RoundMinPlayerKeys
            && playerShare >= options.RoundMinPlayerShare;
        return new RoundMatch(
            Math.Round(seconds, 3), matched, matchedPlayer, Math.Round(Math.Min(1, share), 3),
            Math.Round(Math.Min(1, playerShare), 3), Math.Round(to - from, 1), same);
    }

    /// <summary>Each key a fingerprint has at most <paramref name="rare"/> copies of, within
    /// both samples, with its times in order.</summary>
    private static Dictionary<uint, List<int>> Rare(IReadOnlyList<RoundKey> keys, uint playerSample, uint objectSample, int rare)
    {
        var byHash = new Dictionary<uint, List<int>>();
        foreach (var key in keys)
        {
            if (key.Sampled >= (key.IsPlayer ? playerSample : objectSample)) continue;
            if (!byHash.TryGetValue(key.Hash, out var times)) byHash[key.Hash] = times = [];
            times.Add(key.Millis);
        }
        foreach (var hash in byHash.Where(kv => kv.Value.Count > rare).Select(kv => kv.Key).ToList()) byHash.Remove(hash);
        foreach (var times in byHash.Values) times.Sort();
        return byHash;
    }

    /// <summary>The offset of the window <paramref name="width"/> wide holding the most keys:
    /// the median of its votes.</summary>
    private static int DensestOffset(List<(int Delta, uint Hash)> votes, int width)
    {
        votes.Sort((a, b) => a.Delta.CompareTo(b.Delta));
        var inWindow = new Dictionary<uint, int>();
        var best = (Keys: -1, From: 0, To: 0);
        var start = 0;
        for (var end = 0; end < votes.Count; end++)
        {
            inWindow[votes[end].Hash] = inWindow.GetValueOrDefault(votes[end].Hash) + 1;
            while (votes[end].Delta - votes[start].Delta > width)
            {
                var hash = votes[start].Hash;
                if (--inWindow[hash] == 0) inWindow.Remove(hash);
                start++;
            }
            if (inWindow.Count > best.Keys) best = (inWindow.Count, start, end);
        }
        return votes[(best.From + best.To) / 2].Delta;
    }

    /// <summary>Copies of one key paired in order, each within <paramref name="window"/> of
    /// the other once <paramref name="offset"/> has moved the second's onto the first's clock.</summary>
    private static int Pairs(List<int> mine, List<int> theirs, int offset, int window)
    {
        var pairs = 0;
        var i = 0;
        var j = 0;
        while (i < mine.Count && j < theirs.Count)
        {
            var d = mine[i] - (theirs[j] + offset);
            if (Math.Abs(d) <= window)
            {
                pairs++;
                i++;
                j++;
            }
            else if (d < 0)
            {
                i++;
            }
            else
            {
                j++;
            }
        }
        return pairs;
    }

    /// <summary>How many keys, and player keys, fall in <c>[from, to]</c> of the first's clock,
    /// a fingerprint's times moved by <paramref name="shift"/> seconds.</summary>
    private static (int All, int Player) Within(Dictionary<uint, List<int>> keys, double from, double to, double shift)
    {
        var all = 0;
        var player = 0;
        foreach (var (hash, times) in keys)
        {
            foreach (var millis in times)
            {
                var at = (millis / 1000.0) + shift;
                if (at < from || at > to) continue;
                all++;
                if ((hash & RoundKey.PlayerBit) != 0) player++;
            }
        }
        return (all, player);
    }
}
