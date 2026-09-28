using System.Security.Cryptography;
using System.Text;
using api.Recordings;

namespace api.tests.Recordings;

public class RecordingInspectorTests
{
    private static async Task<api.Recordings.Models.RecordingInspection> Inspect(string text, long max = 1 << 30)
    {
        using var gz = new MemoryStream(RecordingFixture.Gzip(text));
        return await RecordingInspector.InspectAsync(gz, max, CancellationToken.None);
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

    [Fact]
    public async Task Inspect_SkipsALastLineACrashCutShort()
    {
        var text = RecordingFixture.Midway() + """{"k":"j","t":900.5,"o":[[1669,501,0.0""";

        var found = await Inspect(text);

        // The half line still names its time: it is read off the front.
        Assert.Equal(900.5, found.DurationSeconds, 3);
        Assert.Equal("midway", found.Level);
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
        Assert.Empty(found.Players);
        Assert.Equal(60.0, found.DurationSeconds);
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
    public async Task Inspect_RefusesAFileThatIsNotGzip()
    {
        using var plain = new MemoryStream(Encoding.UTF8.GetBytes(RecordingFixture.Midway()));

        await Assert.ThrowsAsync<RecordingRejectedException>(
            () => RecordingInspector.InspectAsync(plain, 1 << 30, CancellationToken.None));
    }

    [Fact]
    public async Task Inspect_StopsAFileThatUnpacksPastTheLimit()
    {
        var text = RecordingFixture.Midway() + new string('x', 200_000) + "\n";

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => Inspect(text, max: 100_000));

        Assert.Equal(413, ex.StatusCode);
    }

    [Fact]
    public async Task InspectServerLog_TakesXmlAndRefusesTheRest()
    {
        using var log = new MemoryStream(RecordingFixture.Gzip("﻿<?xml version=\"1.0\"?><bf:log></bf:log>"));
        Assert.True(await RecordingInspector.InspectServerLogAsync(log, 1 << 20, CancellationToken.None) > 0);

        using var notLog = new MemoryStream(RecordingFixture.Gzip("{\"k\":\"h\"}"));
        await Assert.ThrowsAsync<RecordingRejectedException>(
            () => RecordingInspector.InspectServerLogAsync(notLog, 1 << 20, CancellationToken.None));
    }

    [Theory]
    [InlineData("bf1942/levels/midway/", "midway")]
    [InlineData("xpack1/levels/Anzio", "anzio")]
    [InlineData("Wake", "wake")]
    public void LevelOf_TakesTheLastFolder(string path, string level) =>
        Assert.Equal(level, RecordingInspector.LevelOf(path));

    [Theory]
    [InlineData("conquest.con", "conquest")]
    [InlineData("CoOp.CON", "coop")]
    [InlineData("ctf", "ctf")]
    public void ModeOf_DropsTheConExtension(string file, string mode) =>
        Assert.Equal(mode, RecordingInspector.ModeOf(file));
}
