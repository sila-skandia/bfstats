using System.IO.Compression;
using System.Text;
using api.Recordings;
using api.Recordings.Models;

namespace api.tests.Recordings;

/// <summary>
/// A recording's round fingerprint (<see cref="RoundFingerprintBuilder"/>) and the comparison
/// of two (<see cref="RoundMatcher"/>), features/replay-feed "Rounds": on real recordings cut to
/// what a fingerprint reads (Fixtures/rounds, made by make_round_fixtures.mjs) and on made-up
/// rounds.
/// </summary>
public sealed class RoundFingerprintTests
{
    private static readonly RecordingsOptions Defaults = new();

    // --- what a fingerprint holds -----------------------------------------------------

    [Fact]
    public async Task TheJoinsDatabase_IsNotEvidence_ButNamesThePlayers()
    {
        var text = Lines(
            """{"k":"h","v":5,"start":"2026-09-29T10:00:00","hz":10}""",
            """{"k":"e","t":0.4,"e":"createPlayer","pid":3,"name":"Alice","team":1,"ai":0}""",
            """{"k":"e","t":0.4,"e":"createPlayer","pid":5,"name":"Bob","team":2,"ai":0}""",
            """{"k":"e","t":0.5,"e":"createObject","tid":3427,"netId":534,"tmpl":"Shokaku"}""",
            """{"k":"e","t":1.0,"e":"dbComplete"}""",
            """{"k":"e","t":1.0,"e":"createObject","tid":1700,"netId":900,"tmpl":"Soldier"}""",
            """{"k":"e","t":4.2,"e":"score","kind":3,"pid":3,"victim":5,"weapon":1379,"bodypart":41}""",
            """{"k":"e","t":5.0,"e":"createObject","tid":1701,"netId":901,"tmpl":"Soldier"}""",
            """{"k":"end","t":10}""");

        var fingerprint = (await SyntheticRound.InspectAsync(text)).Fingerprint;

        // The kill, named, and the object made in play; not the Shokaku nor the players the
        // join listed, nor what came at the join's own moment.
        Assert.Equal(
            [Key("K", "3|Alice|Bob|1379", 4.2), Key("O", "901|1701", 5.0)],
            fingerprint.Keys);
        Assert.Equal(1.0, fingerprint.LiveFromSeconds);
        Assert.Equal(10, fingerprint.LiveToSeconds);
    }

    [Fact]
    public async Task AFileBegunMidRound_NamesItsPlayersFromWhatItHeld()
    {
        var text = Lines(
            """{"k":"h","v":5,"start":"2026-09-29T10:00:00","hz":10}""",
            """{"k":"e","t":0,"e":"createPlayer","pid":3,"name":"Alice","team":1,"ai":0,"ago":40.5}""",
            """{"k":"e","t":0,"e":"createObject","tid":1700,"netId":900,"tmpl":"Soldier","ago":3.2}""",
            """{"k":"roster","t":0,"p":[[3,1,0,"Alice",1],[5,2,0,"Bob",0]]}""",
            """{"k":"e","t":2.5,"e":"score","kind":3,"pid":5,"victim":3,"weapon":1385,"bodypart":41}""",
            """{"k":"e","t":3.0,"e":"destroyPlayer","pid":3}""",
            """{"k":"end","t":10}""");

        var fingerprint = (await SyntheticRound.InspectAsync(text)).Fingerprint;

        Assert.Equal([Key("K", "3|Bob|Alice|1385", 2.5), Key("L", "Alice", 3.0)], fingerprint.Keys);
        Assert.Equal(0, fingerprint.LiveFromSeconds);
    }

    [Fact]
    public async Task APlayersName_IsTheOneHisPidHadThen()
    {
        // pid 3 is Alice until she leaves, then Rut's: a public server hands a leaver's pid on.
        var text = Lines(
            """{"k":"h","v":5,"start":"2026-09-29T10:00:00","hz":10}""",
            """{"k":"e","t":0.4,"e":"createPlayer","pid":3,"name":"Alice","team":1,"ai":0}""",
            """{"k":"e","t":0.4,"e":"createPlayer","pid":5,"name":"Bob","team":2,"ai":0}""",
            """{"k":"e","t":1.0,"e":"dbComplete"}""",
            """{"k":"e","t":2.0,"e":"score","kind":3,"pid":3,"victim":5,"weapon":1379,"bodypart":41}""",
            """{"k":"e","t":3.0,"e":"destroyPlayer","pid":3}""",
            """{"k":"e","t":7.0,"e":"createPlayer","pid":3,"name":"Rut","team":1,"ai":0}""",
            """{"k":"e","t":9.0,"e":"score","kind":3,"pid":3,"victim":5,"weapon":1379,"bodypart":41}""",
            """{"k":"e","t":9.5,"e":"score","kind":3,"pid":8,"victim":5,"weapon":1379,"bodypart":41}""",
            """{"k":"end","t":10}""");

        var fingerprint = (await SyntheticRound.InspectAsync(text)).Fingerprint;

        // A kill by a pid the file has no name for is no key at all.
        Assert.Equal(
            [Key("K", "3|Alice|Bob|1379", 2), Key("L", "Alice", 3), Key("J", "Rut", 7), Key("K", "3|Rut|Bob|1379", 9)],
            fingerprint.Keys);
    }

    [Fact]
    public async Task OnlyLinesToEveryoneAreEvidence()
    {
        var text = Lines(
            """{"k":"h","v":5,"start":"2026-09-29T10:00:00","hz":10}""",
            """{"k":"chat","t":2.0,"pid":8,"team":1,"text":"_x_ sniper: !nextmap"}""",
            """{"k":"chat","t":3.0,"pid":10,"team":2,"text":"Nr 9 [allies]: yarrr"}""",
            """{"k":"chat","t":4.0,"pid":-1,"team":0,"text":"*Welcome\u0080to\u0080MoonGamers!"}""",
            """{"k":"chat","t":5.0,"pid":-1,"team":2,"text":"skandia: gf"}""",
            """{"k":"chat","t":6.0,"pid":-1,"team":2,"text":"skandia [allies]: don't do that"}""",
            """{"k":"chat","t":7.0,"pid":4,"team":1,"text":"Kaspar [coalition]: go"}""",
            """{"k":"end","t":10}""");

        var fingerprint = (await SyntheticRound.InspectAsync(text)).Fingerprint;

        // A player's line to all; the recording player's own line to all, on his screen before
        // the server relays it; not a team line (whatever the mod calls its sides), nor the
        // server's own adverts, which come round every round.
        Assert.Equal([Key("C", "_x_ sniper: !nextmap", 2), Key("C", "skandia: gf", 5)], fingerprint.Keys);
    }

    [Fact]
    public void TooManyKeys_AreSampledByHash_TheSameKeysInEveryFile()
    {
        var builder = new RoundFingerprintBuilder();
        for (var i = 0; i < 20_000; i++)
        {
            builder.Line("e", "createObject", i * 0.05,
                Encoding.UTF8.GetBytes($$"""{"k":"e","t":{{i * 0.05}},"e":"createObject","tid":1700,"netId":{{i}}}"""));
        }
        var fingerprint = builder.Build(1000);

        Assert.InRange(fingerprint.Keys.Count, RoundFingerprintBuilder.MaxKeysPerKind / 2, RoundFingerprintBuilder.MaxKeysPerKind);
        Assert.True(fingerprint.ObjectSample < RoundFingerprint.Everything);
        Assert.Equal(RoundFingerprint.Everything, fingerprint.PlayerSample);
        Assert.All(fingerprint.Keys, k => Assert.True(k.Sampled < fingerprint.ObjectSample));
        // Stored and read back as it was.
        Assert.Equal(fingerprint.Keys, RoundFingerprint.UnpackKeys(fingerprint.PackKeys()));
    }

    // --- real rounds ------------------------------------------------------------------

    [Fact]
    public async Task ARoundSplitBySide_IsOneRound_AtItsOffset()
    {
        // B began 60 s into A with its clock 40 ppm fast; at the stretch's middle that is
        // 60 s less 40 ppm of ~240 s.
        var a = await FixtureAsync("bocage-a");
        var b = await FixtureAsync("bocage-b");

        var match = RoundMatcher.Match(a, b, Defaults);

        Assert.True(match.SameRound);
        Assert.InRange(match.OffsetSeconds, 59.95, 60.0);
        Assert.True(match.MatchedPlayer >= 150, $"{match.MatchedPlayer} player keys");
        Assert.True(match.Matched >= 500, $"{match.Matched} keys");
        Assert.True(match.PlayerShare >= 0.95, $"player share {match.PlayerShare}");
        // The same the other way round.
        var back = RoundMatcher.Match(b, a, Defaults);
        Assert.True(back.SameRound);
        Assert.Equal(-match.OffsetSeconds, back.OffsetSeconds, 0.02);
    }

    [Theory]
    [InlineData("wake-001120", "wake-075756")]
    [InlineData("bocage-a", "bocage-other")]
    [InlineData("bocage-b", "bocage-other")]
    public async Task TwoRoundsOfOneMapOnOneServer_AreNotOneRound(string first, string second)
    {
        var match = RoundMatcher.Match(await FixtureAsync(first), await FixtureAsync(second), Defaults);

        Assert.False(match.SameRound);
        Assert.True(match.MatchedPlayer < Defaults.RoundMinPlayerKeys, $"{match.MatchedPlayer} player keys");
    }

    // --- made-up rounds ---------------------------------------------------------------

    [Fact]
    public async Task TwoRoundsBegunFromTheSameMoment_ShareTheirObjectIds_AndAreNotOneRound()
    {
        // Two different rounds of one map whose objects are made under the same ids at the
        // same moments, as a level's opening spawns are: every object key agrees, and no
        // player key does.
        var one = new SyntheticRound(seed: 1, objectSeed: 99);
        var two = new SyntheticRound(seed: 2, objectSeed: 99);

        var match = RoundMatcher.Match(
            (await SyntheticRound.InspectAsync(one.File(0, 300))).Fingerprint,
            (await SyntheticRound.InspectAsync(two.File(0, 300))).Fingerprint,
            Defaults);

        Assert.True(match.Matched > 100, $"{match.Matched} object keys agree");
        Assert.True(match.Share > 0.5);
        Assert.False(match.SameRound);
    }

    [Fact]
    public async Task PidsHandedOn_DoNotFoolTheNames()
    {
        var round = new SyntheticRound(seed: 5);
        // pid 3's first holder kills before leaving at 100 s, and the next holder after.
        var first = round.PlayersAt(50).Single(p => p.Pid == 3).Name;
        round.Add(50, SyntheticRound.Event("score", ("kind", 3), ("pid", 3), ("victim", 4), ("weapon", 1379), ("bodypart", 41)));
        round.Add(100, SyntheticRound.Event("destroyPlayer", ("pid", 3)));
        round.Add(105, SyntheticRound.Event("createPlayer", ("pid", 3), ("name", "Handed On"), ("team", 1), ("ai", 0)));
        round.Add(130, SyntheticRound.Event("score", ("kind", 3), ("pid", 3), ("victim", 4), ("weapon", 1379), ("bodypart", 41)));
        round.Sort();

        var whole = (await SyntheticRound.InspectAsync(round.File(0, 300))).Fingerprint;
        var early = (await SyntheticRound.InspectAsync(round.File(0, 90, drift: 30e-6, jitter: 0.02, seed: 3))).Fingerprint;

        Assert.Contains(whole.Keys, k => k.Hash == PlayerHash("K", $"3|{first}|{round.PlayersAt(50).Single(p => p.Pid == 4).Name}|1379"));
        Assert.Contains(whole.Keys, k => k.Hash == PlayerHash("K", $"3|Handed On|{round.PlayersAt(130).Single(p => p.Pid == 4).Name}|1379"));
        var match = RoundMatcher.Match(whole, early, Defaults);
        Assert.True(match.SameRound);
        Assert.Equal(1, match.PlayerShare);
    }

    [Fact]
    public async Task ShortOverlaps_NeedEnoughPlayerKeys()
    {
        var round = new SyntheticRound(seed: 11);
        var whole = (await SyntheticRound.InspectAsync(round.File(0, 600))).Fingerprint;

        var minute = RoundMatcher.Match(whole, (await SyntheticRound.InspectAsync(round.File(300, 360, jitter: 0.03))).Fingerprint, Defaults);
        var moment = RoundMatcher.Match(whole, (await SyntheticRound.InspectAsync(round.File(300, 303, jitter: 0.03))).Fingerprint, Defaults);

        Assert.True(minute.SameRound);
        Assert.Equal(300, minute.OffsetSeconds, 0.05);
        Assert.False(moment.SameRound);
    }

    // --- helpers ----------------------------------------------------------------------

    internal static async Task<RoundFingerprint> FixtureAsync(string name)
    {
        var path = Path.Combine(RecordingInspectorTests.RepositoryRoot(), "tests", "api", "Recordings", "Fixtures", "rounds", $"{name}.ndjson.gz");
        await using var file = File.OpenRead(path);
        return (await RecordingInspector.InspectAsync(file, null, long.MaxValue, CancellationToken.None)).Fingerprint;
    }

    internal static string FixtureText(string name)
    {
        var path = Path.Combine(RecordingInspectorTests.RepositoryRoot(), "tests", "api", "Recordings", "Fixtures", "rounds", $"{name}.ndjson.gz");
        using var gzip = new GZipStream(File.OpenRead(path), CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    private static string Lines(params string[] lines) => string.Join('\n', lines) + "\n";

    private static uint PlayerHash(string type, string what) => RoundFingerprintBuilder.Hash(type, what) | RoundKey.PlayerBit;

    private static RoundKey Key(string type, string what, double seconds) => new(
        type == "O" ? RoundFingerprintBuilder.Hash(type, what) & ~RoundKey.PlayerBit : PlayerHash(type, what),
        (int)Math.Round(seconds * 1000));
}
