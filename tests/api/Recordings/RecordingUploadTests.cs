using System.IO.Compression;
using System.Text;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;

namespace api.tests.Recordings;

public sealed class RecordingUploadTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    [Fact]
    public async Task Upload_KeepsTheFileGzippedAndDescribesItFromItself()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), serverLog: RecordingFixture.EventLog());

        Assert.Equal(RecordingStorage.SlugLength, detail.Slug.Length);
        Assert.Equal("Midway at dawn", detail.Title);
        Assert.Equal("skandia", detail.UploaderName);
        Assert.Equal("midway", detail.Level);
        Assert.Equal("bf1942", detail.Mod);
        Assert.Equal("conquest", detail.GameMode);
        Assert.Equal("MoonGamers.com | Est. 2004", detail.ServerName);
        Assert.Equal("skandia", detail.RecordedBy);
        Assert.Equal("2026-09-27T20:34:59", detail.RecordedLocal);
        Assert.Equal(883.029, detail.DurationSeconds, 3);
        Assert.Equal(4, detail.Players.Count);
        Assert.True(detail.CanManage);
        Assert.Equal($"/stats/recordings/{detail.Slug}.ndjson", detail.RecordingUrl);
        Assert.Equal($"/stats/recordings/{detail.Slug}.xml", detail.ServerLogUrl);

        Assert.Equal(RecordingFixture.Midway(), Gunzip(fixture.Storage.RecordingPath(detail.Slug)));
        Assert.Equal(RecordingFixture.EventLog(), Gunzip(fixture.Storage.ServerLogPath(detail.Slug)));
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.Directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_GzipsARecordingSentPlain()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), gzip: false);

        Assert.Equal(RecordingFixture.Midway(), Gunzip(fixture.Storage.RecordingPath(detail.Slug)));
    }

    /// <summary>What is served is what was read, gzipped here: never the bytes as they came,
    /// whatever rode along after the end of their gzip stream.</summary>
    [Fact]
    public async Task Upload_KeepsWhatItReadNotWhatWasSent()
    {
        var text = RecordingFixture.Midway();
        var hidden = Encoding.UTF8.GetBytes(string.Concat(Enumerable.Repeat("hidden payload ", 4096)));
        var length = new byte[4];
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32LittleEndian(length, (uint)Encoding.UTF8.GetByteCount(text));

        var detail = await fixture.UploadBytesAsync([.. RecordingFixture.Gzip(text), .. hidden, .. length], RecordingFixture.Meta());

        var kept = await File.ReadAllBytesAsync(fixture.Storage.RecordingPath(detail.Slug));
        Assert.Equal(RecordingFixture.Kept(text), kept);
        Assert.Equal(kept.Length, detail.RecordingBytes);
    }

    [Fact]
    public async Task Upload_RefusesAGzipStreamCutShort()
    {
        var gz = RecordingFixture.Gzip(RecordingFixture.Midway());

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.UploadBytesAsync(gz[..(gz.Length * 3 / 4)], RecordingFixture.Meta()));

        Assert.Equal(400, ex.StatusCode);
        Assert.Equal(0, await fixture.Db.Recordings.CountAsync());
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.Directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_RefusesAServerLogThatIsNotTheGames()
    {
        var log = """<bf:log xmlns:bf="http://www.dice.se/xmlns/bf/1.1"><h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(document.cookie)</h:script></bf:log>""";

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(RecordingFixture.Midway(), serverLog: log));

        Assert.Equal(400, ex.StatusCode);
        Assert.Contains("event log", ex.Message, StringComparison.Ordinal);
        Assert.Equal(0, await fixture.Db.Recordings.CountAsync());
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.Directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_TakesWhatTheBrowserReadForARecordingBegunMidRound()
    {
        var text = """
            {"k":"h","v":5,"start":"2026-09-27T20:34:59"}
            {"k":"end","t":120.0}
            """;
        var meta = new RecordingUploadMeta(
            "", "skandia", "Tobruk", "bf1942", "conquest", "A server", "skandia", null, 999, ["A", "B"]);

        var detail = await fixture.UploadAsync(text, meta);

        Assert.Equal("tobruk", detail.Level);
        Assert.Equal("A server", detail.ServerName);
        Assert.Equal("skandia", detail.RecordedBy);
        Assert.Equal(["A", "B"], detail.Players);
        // The file's own clock wins over the browser's figure.
        Assert.Equal(120.0, detail.DurationSeconds);
        // No title given: the level and the server.
        Assert.Equal("Tobruk on A server", detail.Title);
    }

    [Fact]
    public async Task Upload_RefusesARecordingThatNamesNoLevelAnywhere()
    {
        var text = "{\"k\":\"h\",\"v\":5}\n{\"k\":\"end\",\"t\":1.0}\n";

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(text));

        Assert.Contains("which level", ex.Message, StringComparison.Ordinal);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.Directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_TheSameRoundTwiceIsTheOneAlreadyShared()
    {
        var first = await fixture.UploadAsync(RecordingFixture.Midway());

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.UploadAsync(RecordingFixture.Midway(), actor: fixture.AsOther,
                meta: new RecordingUploadMeta("again", "Rut", null, null, null, null, null, null, null, null)));

        Assert.Equal(409, ex.StatusCode);
        Assert.Equal(first.Slug, ex.ExistingSlug);
        Assert.Equal(1, await fixture.Db.Recordings.CountAsync());
    }

    [Fact]
    public async Task Upload_PutsBackARecordingWhoseFileWentMissing()
    {
        var first = await fixture.UploadAsync(RecordingFixture.Midway());
        await fixture.Service.AddCommentAsync(first.Slug, fixture.AsOther, new CreateRecordingCommentRequest("0:21 get rekt", "Rut"), default);
        File.Delete(fixture.Storage.RecordingPath(first.Slug));
        await fixture.Db.Recordings.ExecuteUpdateAsync(set => set.SetProperty(r => r.FileMissing, true));
        // As the file check leaves it, from its own context.
        fixture.Db.ChangeTracker.Clear();

        var again = await fixture.UploadAsync(RecordingFixture.Midway(), actor: fixture.AsOther,
            meta: new RecordingUploadMeta("again", "Rut", null, null, null, null, null, null, null, null));

        Assert.Equal(first.Slug, again.Slug);
        Assert.Equal(1, again.CommentCount);
        Assert.True(fixture.Storage.Exists(first.Slug));
    }

    /// <summary>A recording goes up under the name of the player who recorded it, as the file
    /// names him: no name to pick, and none to have linked to the account first.</summary>
    [Fact]
    public async Task Upload_SharesUnderTheRecordingsPlayerByDefault()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), RecordingFixture.Meta(), actor: fixture.AsUnlinked);

        Assert.Equal("skandia", detail.UploaderName);
        Assert.Equal("skandia", detail.RecordedBy);
        Assert.True(detail.CanManage);
    }

    [Fact]
    public async Task Upload_TakesTheRecordingsPlayerAsAskedAsTheFileSpellsHim()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), RecordingFixture.Meta(authorName: "SKANDIA"), actor: fixture.AsUnlinked);

        Assert.Equal("skandia", detail.UploaderName);
    }

    [Fact]
    public async Task Upload_TakesALinkedNameInsteadOfTheRecordingsPlayer()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), RecordingFixture.Meta(authorName: "rut"), actor: fixture.AsOther);

        Assert.Equal("Rut", detail.UploaderName);
        Assert.Equal("skandia", detail.RecordedBy);
    }

    [Fact]
    public async Task Upload_FallsBackToALinkedNameWhenTheRecordingNamesNobody()
    {
        var text = """
            {"k":"h","v":5,"start":"2026-09-27T20:34:59"}
            {"k":"e","t":0.0,"e":"setLevel","level":"bf1942/levels/wake/","mode":"coop.con"}
            {"k":"end","t":120.0}
            """;

        var detail = await fixture.UploadAsync(text, RecordingFixture.Meta());

        Assert.Equal("skandia", detail.UploaderName);
        Assert.Equal("", detail.RecordedBy);
    }

    [Fact]
    public async Task Upload_AsksForANameWhenNeitherTheRecordingNorTheAccountHasOne()
    {
        var text = """
            {"k":"h","v":5,"start":"2026-09-27T20:34:59"}
            {"k":"e","t":0.0,"e":"setLevel","level":"bf1942/levels/wake/","mode":"coop.con"}
            {"k":"end","t":120.0}
            """;

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.UploadAsync(text, RecordingFixture.Meta(), actor: fixture.AsUnlinked));

        Assert.Equal(400, ex.StatusCode);
        Assert.Contains("Link your in-game name", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Upload_RefusesANameThatIsNeitherTheRecordingsPlayerNorLinked()
    {
        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(
            RecordingFixture.Midway(), RecordingFixture.Meta(authorName: "SomeoneElse")));

        Assert.Equal(403, ex.StatusCode);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.Directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_RefusesWhatIsNotARecording()
    {
        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync("just some text\n"));

        Assert.Equal(400, ex.StatusCode);
    }

    [Fact]
    public async Task Upload_RefusesARecordingOverTheSizeLimit()
    {
        using var small = new RecordingFixture(o => o with { MaxRecordingBytes = 64 });

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => small.UploadAsync(RecordingFixture.Midway()));

        Assert.Equal(413, ex.StatusCode);
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(small.Directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_StopsAtTheQuota()
    {
        // Room for the first, as kept (gzipped here), and not for a second.
        var stored = RecordingFixture.Kept(RecordingFixture.Midway()).Length;
        using var tight = new RecordingFixture(o => o with { QuotaBytes = stored + 10 });
        await tight.UploadAsync(RecordingFixture.Midway());

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => tight.UploadAsync(RecordingFixture.Midway("second")));

        Assert.Equal(507, ex.StatusCode);
        Assert.Contains("filled", ex.Message, StringComparison.Ordinal);
        Assert.Equal(1, await tight.Db.Recordings.CountAsync());
    }

    [Fact]
    public async Task Upload_LeavesTheDiskItsMargin()
    {
        using var full = new RecordingFixture(o => o with { MinFreeBytes = long.MaxValue / 2 });

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => full.UploadAsync(RecordingFixture.Midway()));

        Assert.Equal(507, ex.StatusCode);
        Assert.Contains("disk", ex.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Upload_RefusesABodyThatIsNotMultipart()
    {
        await using var body = new MemoryStream(RecordingFixture.Gzip(RecordingFixture.Midway()));

        var ex = await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.Uploads.UploadAsync(
            "application/gzip", body, body.Length, fixture.AsUploader, CancellationToken.None));

        Assert.Equal(415, ex.StatusCode);
    }

    private static string Gunzip(string path)
    {
        using var file = File.OpenRead(path);
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return reader.ReadToEnd();
    }
}
