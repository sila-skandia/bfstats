using api.PlayerTracking;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.Recordings;

/// <summary>
/// A recording's game (features/bfv-through-bfstats): read from its own header, never from the
/// uploader; it picks the checks, the folder and the feed, and no feed shows another game's.
/// </summary>
public sealed class RecordingGameTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    [Theory]
    [InlineData(null, "2.0", 5, "bf1942")]
    [InlineData(null, null, 3, "bf1942")]
    [InlineData("bf1942", "server-replay-recorder/3", 5, "bf1942")]
    [InlineData("bfv", "bfvplus/2", 5, "bfv")]
    public void GameOf_TakesWhatTheHeaderSays(string? game, string? plus, int version, string expected)
    {
        var (of, refusal) = RecordingInspector.GameOf(game, plus, version);

        Assert.Null(refusal);
        Assert.Equal(expected, of);
    }

    [Theory]
    [InlineData(null, "bfvplus/2", 5)] // bfvplus, but no game: never let through as BF1942
    [InlineData("bf1942", "bfvplus/2", 5)]
    [InlineData("bfv", "2.0", 5)] // BFV from anything but bfvplus
    [InlineData("bfv", null, 5)]
    [InlineData("bfv", "bfvplus/2", 4)]
    [InlineData("bf2", "2.0", 5)]
    [InlineData("", "2.0", 5)] // a game that was not a string
    [InlineData("BFV", "bfvplus/2", 5)]
    public void GameOf_RefusesAHeaderThatIsNotOneGameOrTheOther(string? game, string? plus, int version) =>
        Assert.NotNull(RecordingInspector.GameOf(game, plus, version).Refusal);

    [Fact]
    public async Task Upload_KeepsABfvRecordingAsBfvInItsOwnFolder()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.HueCity());

        var row = await fixture.Db.Recordings.AsNoTracking().SingleAsync();
        Assert.Equal(RecordingGames.Bfv, row.Game);
        Assert.Equal("hue", detail.Level);
        Assert.Equal("bfvietnam", detail.Mod);
        Assert.True(File.Exists(fixture.BfvStorage.RecordingPath(detail.Slug)));
        Assert.False(File.Exists(fixture.Storage.RecordingPath(detail.Slug)));
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.BfvDirectory, ".incoming")));
        Assert.Empty(Directory.EnumerateFiles(Path.Combine(fixture.Directory, ".incoming")));
        Assert.Equal(RecordingGames.Bfv, await fixture.Service.GameAsync(detail.Slug, default));
    }

    [Fact]
    public async Task Upload_KeepsABf1942RecordingAsBf1942()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway());

        Assert.Equal(RecordingGames.Bf1942, (await fixture.Db.Recordings.AsNoTracking().SingleAsync()).Game);
        Assert.True(File.Exists(fixture.Storage.RecordingPath(detail.Slug)));
        Assert.False(File.Exists(fixture.BfvStorage.RecordingPath(detail.Slug)));
    }

    [Fact]
    public async Task Upload_RefusesABfvRecordingWithAKindBfvplusDoesNotWrite()
    {
        var hue = RecordingFixture.HueCity().Replace("""{"k":"chat",""", """{"k":"zz",""", StringComparison.Ordinal);

        var refused = await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(hue));

        Assert.Contains("bfvplus does not write", refused.Message, StringComparison.Ordinal);
        Assert.Empty(fixture.Db.Recordings);
        Assert.Empty(Directory.EnumerateFiles(fixture.BfvDirectory));
    }

    [Fact]
    public async Task Upload_RefusesABf1942RecordingDressedAsBfv()
    {
        var dressed = RecordingFixture.Midway().Replace(
            """{"k":"h","v":5,"plus":"2.0",""", """{"k":"h","v":5,"game":"bfv","plus":"2.0",""", StringComparison.Ordinal);

        await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(dressed));
        Assert.Empty(fixture.Db.Recordings);
    }

    [Fact]
    public async Task Upload_RefusesABfvRecordingStrippedOfItsGame()
    {
        var stripped = RecordingFixture.HueCity(header: """{"k":"h","v":5,"plus":"bfvplus/2","start":"2026-11-24T21:10:02"}""");

        await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(stripped));
        Assert.Empty(fixture.Db.Recordings);
    }

    [Fact]
    public async Task Upload_RefusesAServerLogWithABfvRecording()
    {
        await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.UploadAsync(RecordingFixture.HueCity(), serverLog: RecordingFixture.EventLog()));
        Assert.Empty(fixture.Db.Recordings);
    }

    [Fact]
    public async Task Upload_RefusesABfvRecordingWhileNoFolderIsSet()
    {
        var uploads = new RecordingUploadService(
            fixture.Db, fixture.Storage, fixture.Service, fixture.Clock, fixture.Options,
            NullLogger<RecordingUploadService>.Instance, stores: new RecordingStores(fixture.Storage, bfv: null));
        using var content = RecordingFixture.Multipart(RecordingFixture.HueCity(), RecordingFixture.Meta(), gzip: true);
        await using var body = await content.ReadAsStreamAsync();

        var refused = await Assert.ThrowsAsync<RecordingRejectedException>(() => uploads.UploadAsync(
            content.Headers.ContentType!.ToString(), body, body.Length, fixture.AsUploader, default));

        Assert.Equal(503, refused.StatusCode);
        Assert.Empty(fixture.Db.Recordings);
    }

    [Fact]
    public async Task Feed_ShowsEachGameItsOwnRecordingsOnly()
    {
        var midway = await fixture.UploadAsync(RecordingFixture.Midway());
        var hue = await fixture.UploadAsync(RecordingFixture.HueCity());

        var bf1942 = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default);
        var bfv = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(null, null, game: "bfv"), null, default);
        var bfvByViews = await fixture.Service.ListAsync("views", 1, 24, RecordingFilter.From(null, null, game: "bfv"), null, default);
        var bfvByUploader = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(null, "skandia", game: "bfv"), null, default);

        Assert.Equal([midway.Slug], bf1942.Items.Select(i => i.Slug));
        Assert.Equal(1, bf1942.TotalCount);
        Assert.Equal([hue.Slug], bfv.Items.Select(i => i.Slug));
        Assert.Equal(1, bfv.TotalCount);
        Assert.Equal([hue.Slug], bfvByViews.Items.Select(i => i.Slug));
        Assert.Equal([hue.Slug], bfvByUploader.Items.Select(i => i.Slug));
    }

    [Fact]
    public async Task Filters_OfferEachGameItsOwnServers()
    {
        await fixture.UploadAsync(RecordingFixture.Midway());
        await fixture.UploadAsync(RecordingFixture.HueCity());

        var bf1942 = await fixture.Service.FiltersAsync(RecordingFilter.None, default);
        var bfv = await fixture.Service.FiltersAsync(RecordingFilter.From(null, null, game: "bfv"), default);

        Assert.Equal(["MoonGamers.com | Est. 2004"], bf1942.Servers.Select(c => c.Name));
        Assert.Equal(["Vietnam Lab"], bfv.Servers.Select(c => c.Name));
    }

    [Fact]
    public async Task Rounds_NeverLinkRecordingsOfTwoGames()
    {
        var midway = await fixture.UploadAsync(RecordingFixture.Midway());
        var hue = await fixture.UploadAsync(RecordingFixture.HueCity());

        await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Rounds.LinkAsync(hue.Slug, midway.Slug, fixture.AsAdmin, confirm: true, default));
    }

    [Fact]
    public async Task Delete_RemovesABfvRecordingsFilesFromItsFolder()
    {
        var hue = await fixture.UploadAsync(RecordingFixture.HueCity());

        Assert.True(await fixture.Service.DeleteAsync(hue.Slug, fixture.AsUploader, default));

        Assert.False(File.Exists(fixture.BfvStorage.RecordingPath(hue.Slug)));
    }

    [Theory]
    [InlineData(null, "bf1942")]
    [InlineData("bfv", "bfv")]
    [InlineData(" BFV ", "bfv")]
    [InlineData("bf2", "bf1942")]
    public void FromQuery_IsBf1942UnlessAGameItTakes(string? asked, string expected) =>
        Assert.Equal(expected, RecordingGames.FromQuery(asked));

    [Fact]
    public void GuardedFolder_TakesNoLinks()
    {
        var target = Path.Combine(Path.GetTempPath(), $"bfstats-link-target-{Guid.NewGuid():N}");
        Directory.CreateDirectory(target);
        var linked = Path.Combine(Path.GetTempPath(), $"bfstats-link-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateSymbolicLink(linked, target);
            var throughLink = new RecordingStorage(linked, long.MaxValue, 0, 0, guarded: true);
            Assert.False(throughLink.Available);
            Assert.Throws<RecordingRejectedException>(() => throughLink.IncomingPath());

            // A recording's file that is a link to somewhere else is not there.
            var secret = Path.Combine(target, "secret.txt");
            File.WriteAllText(secret, "not a recording");
            var slug = RecordingStorage.NewSlug();
            File.CreateSymbolicLink(fixture.BfvStorage.RecordingPath(slug), secret);
            Assert.False(fixture.BfvStorage.Exists(slug));
            Assert.False(fixture.BfvStorage.IsPlainFile(fixture.BfvStorage.RecordingPath(slug)));
            Assert.True(fixture.BfvStorage.IsPlainFile(secret));
        }
        finally
        {
            Directory.Delete(linked);
            Directory.Delete(target, recursive: true);
        }
    }

    [Fact]
    public void GuardedFolder_TakesNoLinkedIncomingFolder()
    {
        var root = Path.Combine(Path.GetTempPath(), $"bfstats-guarded-{Guid.NewGuid():N}");
        var elsewhere = Path.Combine(Path.GetTempPath(), $"bfstats-elsewhere-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        Directory.CreateDirectory(elsewhere);
        try
        {
            Directory.CreateSymbolicLink(Path.Combine(root, ".incoming"), elsewhere);
            var folder = new RecordingStorage(root, long.MaxValue, 0, 0, guarded: true);

            Assert.Throws<RecordingRejectedException>(() => folder.IncomingPath());
            Assert.Empty(Directory.EnumerateFileSystemEntries(elsewhere));
        }
        finally
        {
            Directory.Delete(Path.Combine(root, ".incoming"));
            Directory.Delete(root, recursive: true);
            Directory.Delete(elsewhere, recursive: true);
        }
    }

    [Fact]
    public async Task FileCheck_ChecksEachGameAgainstItsOwnFolder()
    {
        var midway = await fixture.UploadAsync(RecordingFixture.Midway());
        var hue = await fixture.UploadAsync(RecordingFixture.HueCity());
        File.Delete(fixture.BfvStorage.RecordingPath(hue.Slug));
        var reconciler = new RecordingFileReconciler(Scopes(), fixture.Storage, NullLogger<RecordingFileReconciler>.Instance, fixture.Stores);

        await reconciler.ReconcileAsync(default);

        var rows = await fixture.Db.Recordings.AsNoTracking().ToDictionaryAsync(r => r.Slug, r => r.FileMissing);
        Assert.False(rows[midway.Slug]);
        Assert.True(rows[hue.Slug]);
    }

    [Fact]
    public async Task FileCheck_LeavesBfvRowsAloneWhileNoFolderIsSet()
    {
        var hue = await fixture.UploadAsync(RecordingFixture.HueCity());
        var reconciler = new RecordingFileReconciler(
            Scopes(), fixture.Storage, NullLogger<RecordingFileReconciler>.Instance,
            new RecordingStores(fixture.Storage, bfv: null));

        await reconciler.ReconcileAsync(default);

        Assert.False((await fixture.Db.Recordings.AsNoTracking().SingleAsync(r => r.Slug == hue.Slug)).FileMissing);
    }

    /// <summary>
    /// The migration on a database built by every migration before it, with recordings shared
    /// under the old triggers: every one is BF1942's, the cards and counts come through, and the
    /// new triggers keep each game's apart.
    /// </summary>
    [Fact]
    public async Task Migration_MakesEveryRecordingSharedSoFarBf1942AndKeepsTheFeed()
    {
        await using var connection = new SqliteConnection("Filename=:memory:");
        await connection.OpenAsync();
        await using var db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync("20261112001417_AddShortLinkVideo");

        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO Users (Id, Email, CreatedAt, LastLoggedIn, IsActive, AuthProvider) VALUES (1, 'a@example.com', '2026-11-01', '2026-11-01', 1, 'discord');
            INSERT INTO Recordings (Slug,Title,UploaderUserId,UploaderName,Level,Mod,GameMode,ServerName,RecordedBy,RecordedLocal,DurationSeconds,PlayerCount,PlayersJson,FormatVersion,RecordingBytes,RecordingRawBytes,ServerLogBytes,ThumbnailBytes,ContentHash,ViewCount,CommentCount,FileMissing,CreatedAt,UpdatedAt,StatsRoundCheckVersion,Source)
            VALUES ('aaaaaaaaaa','a',1,'skandia','midway','bf1942','conquest','SiMPLE','skandia','',10,1,'[]',5,100,200,0,0,'h1',3,0,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',0,1),
                   ('bbbbbbbbbb','b',1,'Rut','midway','bf1942','conquest','SiMPLE','Rut','',10,1,'[]',5,100,200,0,0,'h2',5,0,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',0,1),
                   ('cccccccccc','c',1,'Rut','kursk','fhsw','conquest','MoonGamers','Rut','',10,1,'[]',5,100,200,0,0,'h3',1,0,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z',0,2);
            UPDATE Recordings SET RoundId = 1 WHERE Id IN (1, 2);
            """);
        var before = await TalliesAsync(connection);

        await migrator.MigrateAsync();

        Assert.All(await db.Recordings.AsNoTracking().ToListAsync(), r => Assert.Equal(RecordingGames.Bf1942, r.Game));
        var cards = await db.RecordingCards.AsNoTracking().OrderBy(c => c.CardKey).ToListAsync();
        Assert.Equal([1, 3], cards.Select(c => c.CardKey));
        Assert.All(cards, c => Assert.Equal(RecordingGames.Bf1942, c.Game));
        Assert.Equal(before, await TalliesAsync(connection));

        // A BFV recording shared now has its own card and counts, and moves none of BF1942's.
        await db.Database.ExecuteSqlRawAsync("""
            INSERT INTO Recordings (Slug,Title,UploaderUserId,UploaderName,Level,Mod,GameMode,ServerName,RecordedBy,RecordedLocal,DurationSeconds,PlayerCount,PlayersJson,FormatVersion,RecordingBytes,RecordingRawBytes,ServerLogBytes,ThumbnailBytes,ContentHash,ViewCount,CommentCount,FileMissing,CreatedAt,UpdatedAt,StatsRoundCheckVersion,Source,Game)
            VALUES ('dddddddddd','d',1,'Rut','hue','bfvietnam','conquest','SiMPLE','Rut','',10,1,'[]',5,100,200,0,0,'h4',9,0,0,'2026-11-27T00:00:00Z','2026-11-27T00:00:00Z',0,1,'bfv');
            """);
        Assert.Equal(before, await TalliesAsync(connection, RecordingGames.Bf1942));
        var bfv = await db.RecordingTallies.AsNoTracking().Where(t => t.Game == RecordingGames.Bfv).ToListAsync();
        Assert.Contains(bfv, t => t.Kind == RecordingTallyKind.Cards && t.Count == 1);
        Assert.Contains(bfv, t => t.Kind == RecordingTallyKind.Server && t.Name == "SiMPLE" && t.Count == 1);
    }

    /// <summary>Every count as text, BF1942's (or any game's when the column is not there yet).</summary>
    private static async Task<List<string>> TalliesAsync(SqliteConnection connection, string? game = null)
    {
        await using var command = connection.CreateCommand();
        if (game is null)
        {
            command.CommandText = "SELECT Kind || '|' || Name || '|' || Count FROM RecordingTallies ORDER BY Kind, Name";
        }
        else
        {
            command.CommandText = "SELECT Kind || '|' || Name || '|' || Count FROM RecordingTallies WHERE Game = $game ORDER BY Kind, Name";
            command.Parameters.AddWithValue("$game", game);
        }
        var rows = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync()) rows.Add(reader.GetString(0));
        return rows;
    }

    private Microsoft.Extensions.DependencyInjection.IServiceScopeFactory Scopes() =>
        Microsoft.Extensions.DependencyInjection.ServiceProviderServiceExtensions.GetRequiredService<Microsoft.Extensions.DependencyInjection.IServiceScopeFactory>(
            Microsoft.Extensions.DependencyInjection.ServiceCollectionContainerBuilderExtensions.BuildServiceProvider(
                Microsoft.Extensions.DependencyInjection.ServiceCollectionServiceExtensions.AddSingleton(
                    new Microsoft.Extensions.DependencyInjection.ServiceCollection(), fixture.Db)));
}
