using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using api.Recordings;

namespace api.tests.Recordings;

public class RecordingInspectorTests
{
    private static async Task<api.Recordings.Models.RecordingInspection> Inspect(string text, long max = 1 << 30)
    {
        using var gz = new MemoryStream(RecordingFixture.Gzip(text));
        return await RecordingInspector.InspectAsync(gz, null, max, CancellationToken.None);
    }

    private static async Task<long> InspectLog(string text, long max = 1 << 30)
    {
        using var gz = new MemoryStream(RecordingFixture.Gzip(text));
        return await RecordingInspector.InspectServerLogAsync(gz, null, max, CancellationToken.None);
    }

    private static string Gunzip(byte[] bytes)
    {
        using var gzip = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    /// <summary>The recording with <paramref name="line"/> put in before its last record.</summary>
    private static string MidwayWith(string line)
    {
        var lines = RecordingFixture.Midway().TrimEnd('\n').Split('\n').ToList();
        lines.Insert(lines.Count - 1, line);
        return string.Join('\n', lines) + "\n";
    }

    [Fact]
    public async Task Inspect_ReadsTheRoundOutOfTheFile()
    {
        var text = RecordingFixture.Midway();

        var found = await Inspect(text);

        Assert.Equal(5, found.Version);
        Assert.Equal("2026-09-27T20:34:59", found.Start);
        Assert.Equal("midway", found.Level);
        Assert.Equal("conquest", found.GameMode);
        Assert.Equal("bf1942", found.Mod);
        Assert.Equal("MoonGamers.com | Est. 2004", found.ServerName);
        Assert.Equal("skandia", found.RecordedBy);
        Assert.Equal(883.029, found.DurationSeconds, 3);
        Assert.Equal(["Rut", "skandia", "Bot", "Lapu"], found.Players);
        Assert.Equal(Encoding.UTF8.GetByteCount(text), found.RawBytes);
        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(text))), found.ContentHash);
    }

    /// <summary>Both real recordings in the repository (bf42plus v2 and v3, from the lab):
    /// every line a record, and the recording player found as the viewer finds him.</summary>
    [Theory]
    [InlineData("replay_20260915-210619.ndjson", 2)]
    [InlineData("replay_20260915-213110.ndjson", 3)]
    public async Task Inspect_TakesRealRecordings(string file, int version)
    {
        var bytes = await File.ReadAllBytesAsync(Path.Combine(RepositoryRoot(), "tools", "bf1942-models", "tests", "fixtures", file));
        using var plain = new MemoryStream(bytes);

        var found = await RecordingInspector.InspectAsync(plain, null, 1 << 30, CancellationToken.None);

        Assert.Equal(version, found.Version);
        Assert.Equal("skandia", found.RecordedBy);
        Assert.True(found.DurationSeconds > 100);
        Assert.Equal(bytes.Length, found.RawBytes);
    }

    [Fact]
    public async Task Inspect_SkipsALastLineACrashCutShort()
    {
        var text = RecordingFixture.Midway() + """{"k":"j","t":900.5,"o":[[1669,501,0.0""";

        var found = await Inspect(text);

        // As the viewer skips it: the round ends at its last whole record.
        Assert.Equal(883.029, found.DurationSeconds, 3);
        Assert.Equal("midway", found.Level);
    }

    [Theory]
    [InlineData("<html><script>alert(1)</script></html>")]
    [InlineData("""{"k":"j","t":900.5,"o":[[1669,501,0.0""")]
    [InlineData("""{"k":"o","t":12.0,"id":7}<script>alert(1)</script>""")]
    [InlineData("""{"t":12.0,"id":7}""")]
    [InlineData("""{"k":7,"t":12.0}""")]
    [InlineData("""["k","o"]""")]
    [InlineData("\u0001\u0002 binary")]
    public async Task Inspect_RefusesALineThatIsNotARecordWithRecordsAfterIt(string line)
    {
        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => Inspect(MidwayWith(line)));

        Assert.Equal(400, ex.StatusCode);
        Assert.Contains("line 9", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Inspect_RefusesAHeaderWithNothingAfterIt()
    {
        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => Inspect("""{"k":"h","v":5,"start":"2026-09-27T20:34:59"}""" + "\n\n"));

        Assert.Contains("empty", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Inspect_ReadsAModFromItsServerInLowerCase()
    {
        var text = RecordingFixture.Midway().Replace("\"mod\":\"bf1942\"", "\"mod\":\"XPack1\"", StringComparison.Ordinal);

        var found = await Inspect(text);

        Assert.Equal("xpack1", found.Mod);
    }

    [Fact]
    public async Task Inspect_LeavesEmptyWhatARecordingBegunMidRoundDoesNotSay()
    {
        var text = """
            {"k":"h","v":5,"start":"2026-09-27T20:34:59"}
            {"k":"o","t":0.0,"id":1}
            {"k":"end","t":60.0}
            """;

        var found = await Inspect(text);

        Assert.Equal("", found.Level);
        Assert.Equal("", found.ServerName);
        Assert.Equal("", found.RecordedBy);
        Assert.Empty(found.Players);
        Assert.Equal(60.0, found.DurationSeconds);
    }

    /// <summary>What a file says of itself is the uploader's to write, so it is held to what
    /// the feed stores: a level, mod and game type are names the viewer can look up, a player
    /// is a line of at most 32 characters with no bidi override in it, and a record's time
    /// past a day is not the recording's length.</summary>
    [Fact]
    public async Task Inspect_HoldsWhatTheFileSaysToWhatTheFeedKeeps()
    {
        var huge = new string('A', 4 * 1024 * 1024);
        var text = string.Join('\n',
            """{"k":"h","v":5,"start":"<b>then</b>"}""",
            """{"k":"e","t":0.0,"e":"serverInfo","mod":"<img src=x onerror=alert(1)>"}""",
            """{"k":"e","t":0.0,"e":"setLevel","level":"bf1942/levels/<svg onload=alert(1)>","mode":"conquest.con"}""",
            $$"""{"k":"e","t":0.0,"e":"serverName","name":"{{huge}}"}""",
            $$"""{"k":"e","t":1.0,"e":"createPlayer","pid":1,"name":"{{huge}}","ai":1}""",
            """{"k":"e","t":2.0,"e":"createPlayer","pid":2,"name":"‮ainadks","ai":1}""",
            """{"k":"e","t":3.0,"e":"createPlayer","pid":3,"name":"=\u0095NDR\u0095=  Lapu","ai":1}""",
            """{"k":"o","t":1e300,"id":1}""",
            """{"k":"end","t":120.0}""") + "\n";

        var found = await Inspect(text);

        Assert.Equal("", found.Start);
        Assert.Equal("", found.Mod);
        Assert.Equal("", found.Level);
        Assert.Equal("conquest", found.GameMode);
        Assert.Equal(RecordingInspector.MaxServerName, found.ServerName.Length);
        Assert.Equal(new string('A', RecordingInspector.MaxPlayerName), found.Players[0]);
        Assert.Equal("ainadks", found.Players[1]);
        // A clan tag's cp1252 bullets, as the recorder writes the bytes, and its spaces, stay.
        Assert.Equal("=\u0095NDR\u0095=  Lapu", found.Players[2]);
        Assert.Equal(120.0, found.DurationSeconds);
    }

    [Fact]
    public async Task Inspect_FindsWhoRecordedItByHisOwnShots()
    {
        // A public server hands a leaver's pid to the next to join: the name is the one the
        // pid had when the recording player fired.
        var text = """
            {"k":"h","v":5,"start":"2026-09-27T14:09:21"}
            {"k":"e","t":1.0,"e":"createPlayer","pid":23,"name":"Leaver","team":1,"ai":0}
            {"k":"e","t":2.0,"e":"createPlayer","pid":4,"name":"Darko","team":2,"ai":0}
            {"k":"e","t":9.0,"e":"destroyPlayer","pid":23}
            {"k":"e","t":16.5,"e":"createPlayer","pid":23,"name":"skandia","team":1,"ai":0}
            {"k":"f","t":18.1,"id":6424,"pid":4,"w":"MG42"}
            {"k":"f","t":19.2,"id":6425,"pid":23,"w":"Thompson","local":1}
            {"k":"end","t":60.0}
            """;

        Assert.Equal("skandia", (await Inspect(text)).RecordedBy);
    }

    [Fact]
    public async Task Inspect_FindsWhoRecordedItByHisTriggerOnAV3File()
    {
        var text = """
            {"k":"h","v":3,"start":"2026-09-15T21:31:10"}
            {"k":"e","t":1.0,"e":"createPlayer","pid":0,"name":"skandia","team":1,"ai":0}
            {"k":"e","t":1.1,"e":"createPlayer","pid":1,"name":"Darko","team":2,"ai":0}
            {"k":"e","t":21.2,"e":"fire","pid":0,"kind":2,"weapon":"USMarineSoldier"}
            {"k":"end","t":60.0}
            """;

        Assert.Equal("skandia", (await Inspect(text)).RecordedBy);
    }

    [Fact]
    public async Task Inspect_FindsWhoRecordedItByHisChatWhenTheFileNamesHimNowhereElse()
    {
        // Begun after the join by a recorder that wrote no roster (replay_20260927-190946):
        // his pid fires, and only his chat says who he is.
        var text = """
            {"k":"h","v":5,"start":"2026-09-27T19:09:46"}
            {"k":"e","t":0.0,"e":"createPlayer","pid":13,"name":"Kerem","ai":0,"ago":3.0}
            {"k":"chat","t":1.7,"pid":13,"team":2,"text":"Kerem: teams"}
            {"k":"f","t":5.0,"id":80,"pid":18,"w":"K98","local":1}
            {"k":"chat","t":347.2,"pid":18,"team":2,"text":"skandia: gf"}
            {"k":"end","t":400.0}
            """;

        Assert.Equal("skandia", (await Inspect(text)).RecordedBy);
    }

    [Fact]
    public async Task Inspect_TakesTheOnlyHumanForAFileWithNoMarks()
    {
        var text = """
            {"k":"h","v":2,"start":"2026-09-15T21:06:19"}
            {"k":"e","t":1.0,"e":"createPlayer","pid":255,"name":"Murray Soames","ai":1}
            {"k":"e","t":5.7,"e":"createPlayer","pid":0,"name":"skandia","ai":0}
            {"k":"end","t":60.0}
            """;

        Assert.Equal("skandia", (await Inspect(text)).RecordedBy);
    }

    [Fact]
    public async Task Inspect_SaysNobodyWhenSeveralHumansAndNothingMarksWhichRecorded()
    {
        var text = """
            {"k":"h","v":2,"start":"2026-09-15T21:06:19"}
            {"k":"e","t":1.0,"e":"createPlayer","pid":1,"name":"Darko","ai":0}
            {"k":"e","t":5.7,"e":"createPlayer","pid":0,"name":"skandia","ai":0}
            {"k":"end","t":60.0}
            """;

        Assert.Equal("", (await Inspect(text)).RecordedBy);
    }

    [Theory]
    [InlineData("hello world\n")]
    [InlineData("{\"k\":\"e\",\"t\":0}\n")]
    [InlineData("<?xml version=\"1.0\"?>\n")]
    [InlineData("\n\n")]
    public async Task Inspect_RefusesWhatIsNotABf42plusRecording(string text)
    {
        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => Inspect(text));

        Assert.Contains("not a bf42plus recording", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Inspect_ReadsAFileSentPlain()
    {
        using var plain = new MemoryStream(Encoding.UTF8.GetBytes(RecordingFixture.Midway()));

        var found = await RecordingInspector.InspectAsync(plain, null, 1 << 30, CancellationToken.None);

        Assert.Equal("midway", found.Level);
    }

    /// <summary>GZipStream hands back what it has of a stream cut short, without a word: half
    /// a file would be taken for a shorter round.</summary>
    [Theory]
    [InlineData(2)]
    [InlineData(8)]
    [InlineData(1)]
    public async Task Inspect_RefusesGzipCutShort(int keepEighths)
    {
        var gz = RecordingFixture.Gzip(RecordingFixture.Midway());
        var length = keepEighths == 8 ? gz.Length - 8 : gz.Length * keepEighths / 8;
        using var cut = new MemoryStream(gz[..length]);

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => RecordingInspector.InspectAsync(cut, null, 1 << 30, CancellationToken.None));

        Assert.Contains("not whole", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Inspect_RefusesBytesAfterTheEndOfTheGzipStream()
    {
        var hidden = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Repeat("hidden payload ", 4096)));
        using var sent = new MemoryStream([.. RecordingFixture.Gzip(RecordingFixture.Midway()), .. hidden]);

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => RecordingInspector.InspectAsync(sent, null, 1 << 30, CancellationToken.None));

        Assert.Contains("not whole", ex.Message, StringComparison.Ordinal);
    }

    /// <summary>Bytes after the end of the gzip stream, dressed to end as a whole one does, are
    /// still no part of what was read, and so no part of what is kept: a browser unpacking the
    /// file would never see them, and the feed is not somewhere to keep them.</summary>
    [Fact]
    public async Task Inspect_KeepsWhatItReadAndNothingElse()
    {
        var text = RecordingFixture.Midway();
        var hidden = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Repeat("hidden payload ", 4096)));
        var length = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(length, (uint)Encoding.UTF8.GetByteCount(text));
        using var sent = new MemoryStream([.. RecordingFixture.Gzip(text), .. hidden, .. length]);
        using var kept = new MemoryStream();

        await RecordingInspector.InspectAsync(sent, kept, 1 << 30, CancellationToken.None);

        Assert.Equal(text, Gunzip(kept.ToArray()));
        Assert.Equal(RecordingFixture.Kept(text), kept.ToArray());
    }

    [Fact]
    public async Task Inspect_StopsAFileThatUnpacksPastTheLimit()
    {
        var text = RecordingFixture.Midway() + new string('x', 200_000) + "\n";

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => Inspect(text, max: 100_000));

        Assert.Equal(413, ex.StatusCode);
    }

    [Fact]
    public async Task InspectServerLog_TakesTheGamesLogUnfinishedAsTheServerLeavesIt()
    {
        var log = RecordingFixture.EventLog();

        Assert.Equal(Encoding.UTF8.GetByteCount(log), await InspectLog(log));
    }

    [Fact]
    public async Task InspectServerLog_TakesAFinishedLog()
    {
        var log = RecordingFixture.EventLog() + "</bf:round>\n</bf:log>\n";

        Assert.Equal(Encoding.UTF8.GetByteCount(log), await InspectLog(log));
    }

    /// <summary>A real one, from the lab's dedicated server, as it left it mid-round.</summary>
    [Fact]
    public async Task InspectServerLog_TakesARealLog()
    {
        var path = Path.Combine(RepositoryRoot(), "tests", "api", "Recordings", "Fixtures", "ev_14568-20260927_0049.xml");
        var bytes = await File.ReadAllBytesAsync(path);
        using var gz = new MemoryStream(RecordingFixture.Gzip(bytes, System.IO.Compression.CompressionLevel.Fastest));

        Assert.Equal(bytes.Length, await RecordingInspector.InspectServerLogAsync(gz, null, 1 << 30, CancellationToken.None));
    }

    /// <summary>
    /// A server log is served from bfstats.io, and a browser runs XHTML script in an XML page
    /// as it would in HTML: anything in one that is not the game's own markup is refused.
    /// </summary>
    [Theory]
    [InlineData("""<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1"><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(document.cookie)</h:script></bf:log>""")]
    [InlineData("""<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1"><bf:round><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>""")]
    [InlineData("""<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>""")]
    [InlineData("""<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>""")]
    [InlineData("""<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="/stats/recordings/abcdefghjk.xml"?><bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1"></bf:log>""")]
    [InlineData("""<!DOCTYPE bf:log [<!ENTITY lol "lol">]><bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1">&lol;</bf:log>""")]
    [InlineData("""<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1" xmlns:h="http://www.w3.org/1999/xhtml"></bf:log>""")]
    [InlineData("""<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1" xmlns:xl="http://www.w3.org/1999/xlink" xl:href="javascript:alert(1)"></bf:log>""")]
    [InlineData("""<log>no namespace</log>""")]
    [InlineData("""<bf:round xmlns:bf="http://www.dice.se/xmlns/bf/1.1"></bf:round>""")]
    [InlineData("""<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1"></bf:log><h:p xmlns:h="http://www.w3.org/1999/xhtml"/>""")]
    [InlineData("""<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1"><bf:event></bf:round><bf:event name="chat" timestamp="1"></bf:event></bf:log>""")]
    [InlineData("""{"k":"h"}""")]
    [InlineData("")]
    public async Task InspectServerLog_RefusesAnythingButTheGamesOwnMarkup(string log)
    {
        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => InspectLog(log));

        Assert.Equal(400, ex.StatusCode);
    }

    [Fact]
    public async Task InspectServerLog_RefusesARunOfTextLongerThanAnyTheGameWrites()
    {
        var log = RecordingFixture.EventLog(
            $"""<bf:event name="chat" timestamp="3"><bf:param type="string" name="text">{new string('x', RecordingInspector.MaxServerLogRun + 1)}</bf:param></bf:event>""");

        await Assert.ThrowsAsync<RecordingRejectedException>(() => InspectLog(log));
    }

    [Fact]
    public async Task InspectServerLog_StopsALogThatUnpacksPastTheLimit()
    {
        var log = RecordingFixture.EventLog(string.Concat(Enumerable.Repeat("""<bf:event name="x" timestamp="1"></bf:event>""" + "\n", 5000)));

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => InspectLog(log, max: 64 * 1024));

        Assert.Equal(413, ex.StatusCode);
    }

    [Fact]
    public async Task InspectServerLog_KeepsWhatItReadAndNothingElse()
    {
        var log = RecordingFixture.EventLog();
        var length = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(length, (uint)Encoding.UTF8.GetByteCount(log));
        using var sent = new MemoryStream([.. RecordingFixture.Gzip(log), .. "<h:script>"u8.ToArray(), .. length]);
        using var kept = new MemoryStream();

        await RecordingInspector.InspectServerLogAsync(sent, kept, 1 << 30, CancellationToken.None);

        Assert.Equal(log, Gunzip(kept.ToArray()));
    }

    [Fact]
    public async Task InspectServerLog_RefusesGzipCutShort()
    {
        var gz = RecordingFixture.Gzip(RecordingFixture.EventLog());
        using var cut = new MemoryStream(gz[..(gz.Length / 2)]);

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => RecordingInspector.InspectServerLogAsync(cut, null, 1 << 30, CancellationToken.None));

        Assert.Contains("not whole", ex.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("bf1942/levels/midway/", "midway")]
    [InlineData("xpack1/levels/Anzio", "anzio")]
    [InlineData("Wake", "wake")]
    [InlineData("bf1942/levels/..", "")]
    [InlineData("bf1942/levels/wake island", "")]
    public void LevelOf_TakesTheLastFolder(string path, string level) =>
        Assert.Equal(level, RecordingInspector.LevelOf(path));

    [Theory]
    [InlineData("conquest.con", "conquest")]
    [InlineData("CoOp.CON", "coop")]
    [InlineData("ctf", "ctf")]
    public void ModeOf_DropsTheConExtension(string file, string mode) =>
        Assert.Equal(mode, RecordingInspector.ModeOf(file));

    [Theory]
    [InlineData("skandia: gf", "skandia")]
    [InlineData("Timmy! [axis]: don't everyone stack to axis", "Timmy!")]
    [InlineData("*Welcome\u0080to\u0080MoonGamers!", "")]
    [InlineData(": nobody", "")]
    public void SpeakerOf_ReadsTheNameAChatLineGoesOutUnder(string text, string name) =>
        Assert.Equal(name, RecordingInspector.SpeakerOf(text));

    /// <summary>The checkout the tests run from: the real recordings live under tools/.</summary>
    private static string RepositoryRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "bfstats.sln"))) return dir.FullName;
        }
        throw new InvalidOperationException("The tests run outside the repository.");
    }
}
