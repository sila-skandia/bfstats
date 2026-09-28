using api.Auth;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.tests.Recordings;

public sealed class RecordingServiceTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    private Task<RecordingDetailDto> Share(string salt) => fixture.UploadAsync(
        RecordingFixture.Midway(salt),
        new RecordingUploadMeta($"Round {salt}", "skandia", null, null, null, null, null, null, null, null));

    [Fact]
    public async Task List_IsNewestFirstOrMostWatchedFirst()
    {
        var first = await Share("one");
        var second = await Share("two");
        var third = await Share("three");
        await fixture.Db.Recordings.Where(r => r.Slug == first.Slug)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.ViewCount, 9));

        var recent = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, default);
        var watched = await fixture.Service.ListAsync("views", 1, 24, RecordingFilter.None, default);

        Assert.Equal([third.Slug, second.Slug, first.Slug], recent.Items.Select(i => i.Slug));
        Assert.Equal([first.Slug, third.Slug, second.Slug], watched.Items.Select(i => i.Slug));
        Assert.Equal(3, recent.TotalCount);
        Assert.True(recent.Storage.UsedBytes > 0);
        Assert.Equal(fixture.Options.Value.QuotaBytes, recent.Storage.QuotaBytes);
    }

    [Fact]
    public async Task List_PagesOnTheServer()
    {
        for (var i = 0; i < 5; i++) await Share($"r{i}");

        var page = await fixture.Service.ListAsync(null, 2, 2, RecordingFilter.None, default);

        Assert.Equal(2, page.Items.Count);
        Assert.Equal(5, page.TotalCount);
        Assert.Equal(3, page.TotalPages);
        Assert.Equal("Round r2", page.Items[0].Title);
    }

    [Fact]
    public async Task List_LeavesOutARecordingWhoseFileIsMissing()
    {
        var gone = await Share("gone");
        await Share("here");
        File.Delete(fixture.Storage.RecordingPath(gone.Slug));
        var reconciler = new RecordingFileReconciler(
            new ServiceCollection().AddSingleton(fixture.Db).BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            fixture.Storage, NullLogger<RecordingFileReconciler>.Instance);

        await reconciler.ReconcileAsync(default);

        var feed = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, default);
        Assert.Single(feed.Items);
        Assert.Null(await fixture.Service.GetAsync(gone.Slug, null, default));
    }

    private const string Moon = "MoonGamers.com | Est. 2004";

    private Task<RecordingDetailDto> ShareAsRut(string salt) => fixture.UploadAsync(
        RecordingFixture.Midway(salt), actor: fixture.AsOther,
        meta: new RecordingUploadMeta($"Round {salt}", "Rut", null, null, null, null, null, null, null, null));

    private Task OnServer(string slug, string server) =>
        fixture.Db.Recordings.Where(r => r.Slug == slug).ExecuteUpdateAsync(set => set.SetProperty(r => r.ServerName, server));

    [Fact]
    public async Task List_NarrowsToAServerAnUploaderOrBoth()
    {
        var mine = await Share("mine");
        var theirs = await ShareAsRut("theirs");
        var elsewhere = await Share("elsewhere");
        await OnServer(elsewhere.Slug, "Other");

        var list = (string? server, string? uploader) =>
            fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(server, uploader), default);
        var onMoon = await list($"  {Moon} ", null);
        var byMe = await list(null, "skandia");
        var both = await list(Moon, "skandia");
        var none = await list("Other", "Rut");
        var everything = await list("", " ");

        Assert.Equal([theirs.Slug, mine.Slug], onMoon.Items.Select(i => i.Slug));
        Assert.Equal(2, onMoon.TotalCount);
        Assert.Equal([elsewhere.Slug, mine.Slug], byMe.Items.Select(i => i.Slug));
        Assert.Equal([mine.Slug], both.Items.Select(i => i.Slug));
        Assert.Empty(none.Items);
        Assert.Equal(0, none.TotalCount);
        Assert.Equal(1, none.TotalPages);
        Assert.Equal(3, everything.TotalCount);
        // The space used is everyone's, whatever the feed shows.
        Assert.Equal(everything.Storage.UsedBytes, none.Storage.UsedBytes);
    }

    [Fact]
    public async Task Filters_CountEachChoiceWithinTheOtherFilter()
    {
        await Share("a");
        await ShareAsRut("b");
        await OnServer((await Share("c")).Slug, "Other");
        var unnamed = await Share("d");
        await fixture.Db.Recordings.Where(r => r.Slug == unnamed.Slug).ExecuteUpdateAsync(set => set
            .SetProperty(r => r.ServerName, "")
            .SetProperty(r => r.UploaderName, "anna"));
        var gone = await Share("gone");
        await fixture.Db.Recordings.Where(r => r.Slug == gone.Slug).ExecuteUpdateAsync(set => set
            .SetProperty(r => r.FileMissing, true)
            .SetProperty(r => r.UploaderName, "absent"));

        var choices = (RecordingFiltersDto f) => (
            f.Servers.Select(c => (c.Name, c.Count)).ToList(),
            f.Uploaders.Select(c => (c.Name, c.Count)).ToList());
        var (servers, uploaders) = choices(await fixture.Service.FiltersAsync(RecordingFilter.None, default));
        var (serversOnOther, uploadersOnOther) = choices(await fixture.Service.FiltersAsync(RecordingFilter.From("Other", null), default));
        var (serversByRut, uploadersByRut) = choices(await fixture.Service.FiltersAsync(RecordingFilter.From(null, "Rut"), default));

        // By name ignoring case; a recording naming no server has no server to pick, and one
        // whose file is gone is not counted.
        Assert.Equal([(Moon, 2), ("Other", 1)], servers);
        Assert.Equal([("anna", 1), ("Rut", 1), ("skandia", 2)], uploaders);
        // A server picked narrows the uploaders, not the servers, and the other way round.
        Assert.Equal(servers, serversOnOther);
        Assert.Equal([("skandia", 1)], uploadersOnOther);
        Assert.Equal([(Moon, 1)], serversByRut);
        Assert.Equal(uploaders, uploadersByRut);
    }

    [Fact]
    public async Task FileCheck_LeavesTheRecordingsAloneWhileTheirDirectoryIsNotThere()
    {
        var shared = await Share("here");
        var unmounted = new RecordingStorage(Microsoft.Extensions.Options.Options.Create(
            fixture.Options.Value with { Path = "/proc/bfstats-recordings-not-mounted" }));
        var reconciler = new RecordingFileReconciler(
            new ServiceCollection().AddSingleton(fixture.Db).BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            unmounted, NullLogger<RecordingFileReconciler>.Instance);

        await reconciler.ReconcileAsync(default);

        Assert.False(unmounted.Available);
        Assert.NotNull(await fixture.Service.GetAsync(shared.Slug, null, default));
        var refused = Assert.Throws<RecordingRejectedException>(() => unmounted.IncomingPath());
        Assert.Equal(503, refused.StatusCode);
    }

    [Fact]
    public async Task Comments_ReadTheirTimeAndCount()
    {
        var shared = await Share("c");

        var timed = await fixture.Service.AddCommentAsync(shared.Slug, fixture.AsOther, new("0:21 get rekt", "rut"), default);
        var plain = await fixture.Service.AddCommentAsync(shared.Slug, fixture.AsUploader, new("gg all", "skandia"), default);
        var late = await fixture.Service.AddCommentAsync(shared.Slug, fixture.AsUploader, new("and 12:00 the carrier", "skandia"), default);

        Assert.Equal(21, timed!.AtSeconds);
        Assert.Equal("Rut", timed.AuthorName);
        Assert.Null(plain!.AtSeconds);
        Assert.Equal(720, late!.AtSeconds);
        Assert.Equal(3, (await fixture.Service.GetAsync(shared.Slug, null, default))!.CommentCount);

        var byTime = await fixture.Service.CommentsAsync(shared.Slug, "time", 1, 200, null, default);
        Assert.Equal([timed.Id, late.Id, plain.Id], byTime!.Items.Select(c => c.Id));
        var newest = await fixture.Service.CommentsAsync(shared.Slug, null, 1, 20, null, default);
        Assert.Equal([late.Id, plain.Id, timed.Id], newest!.Items.Select(c => c.Id));
        Assert.All(newest.Items, c => Assert.False(c.CanDelete));
    }

    [Fact]
    public async Task Comments_OnlyAsALinkedNameAndNeverEmpty()
    {
        var shared = await Share("c");

        var notMine = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.AddCommentAsync(shared.Slug, fixture.AsOther, new("hi", "skandia"), default));
        var empty = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.AddCommentAsync(shared.Slug, fixture.AsOther, new(" \n ", "Rut"), default));
        var tooLong = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.AddCommentAsync(shared.Slug, fixture.AsOther, new(new string('a', 1001), "Rut"), default));

        Assert.Equal(403, notMine.StatusCode);
        Assert.Equal(400, empty.StatusCode);
        Assert.Equal(400, tooLong.StatusCode);
        Assert.Null(await fixture.Service.AddCommentAsync("nosuchslug", fixture.AsOther, new("hi", "Rut"), default));
    }

    [Fact]
    public async Task DeleteComment_IsForItsAuthorTheUploaderOrAnAdmin()
    {
        var shared = await Share("c");
        var theirs = await fixture.Service.AddCommentAsync(shared.Slug, fixture.AsOther, new("one", "Rut"), default);
        var mine = await fixture.Service.AddCommentAsync(shared.Slug, fixture.AsUploader, new("two", "skandia"), default);

        var stranger = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.DeleteCommentAsync(shared.Slug, mine!.Id, fixture.AsOther, default));
        Assert.Equal(403, stranger.StatusCode);
        // The uploader may take down a comment on their own recording.
        Assert.True(await fixture.Service.DeleteCommentAsync(shared.Slug, theirs!.Id, fixture.AsUploader, default));
        Assert.True(await fixture.Service.DeleteCommentAsync(shared.Slug, mine!.Id, fixture.AsAdmin, default));
        Assert.Equal(0, (await fixture.Service.GetAsync(shared.Slug, null, default))!.CommentCount);
    }

    [Fact]
    public async Task RenameAndDelete_AreTheUploadersOrAnAdmins()
    {
        var shared = await Share("m");

        await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.RenameAsync(shared.Slug, fixture.AsOther, "mine now", default));
        var renamed = await fixture.Service.RenameAsync(shared.Slug, fixture.AsUploader, "  Midway, the carrier run ", default);
        Assert.Equal("Midway, the carrier run", renamed!.Title);
        Assert.False((await fixture.Service.GetAsync(shared.Slug, fixture.AsOther, default))!.CanManage);
        Assert.True((await fixture.Service.GetAsync(shared.Slug, fixture.AsAdmin, default))!.CanManage);

        await fixture.Service.AddCommentAsync(shared.Slug, fixture.AsOther, new("0:10 hi", "Rut"), default);
        Assert.True(await fixture.Service.DeleteAsync(shared.Slug, fixture.AsAdmin, default));
        Assert.False(File.Exists(fixture.Storage.RecordingPath(shared.Slug)));
        Assert.Equal(0, await fixture.Db.RecordingComments.CountAsync());
        Assert.False(await fixture.Service.DeleteAsync(shared.Slug, fixture.AsAdmin, default));
    }

    [Fact]
    public async Task SetThumbnail_WritesAFreshJpegAndVersionsItsLink()
    {
        var shared = await Share("t");
        using var frame = new Image<Rgba32>(1280, 720, new Rgba32(40, 60, 90, 255));
        await using var png = new MemoryStream();
        await frame.SaveAsPngAsync(png);
        png.Position = 0;

        var detail = await fixture.Service.SetThumbnailAsync(shared.Slug, fixture.AsUploader, png, default);

        Assert.StartsWith($"/stats/recordings/{shared.Slug}.jpg?v=", detail!.ThumbnailUrl, StringComparison.Ordinal);
        var written = await File.ReadAllBytesAsync(fixture.Storage.ThumbnailPath(shared.Slug));
        Assert.Equal([0xFF, 0xD8, 0xFF], written[..3]);
        var info = Image.Identify(written);
        Assert.Equal(RecordingThumbnails.Width, info.Width);
        Assert.Equal(360, info.Height);
        Assert.Equal(written.Length, (await fixture.Db.Recordings.AsNoTracking().SingleAsync()).ThumbnailBytes);
    }

    [Fact]
    public async Task SetThumbnail_RefusesAStrangerAndWhatIsNotAnImage()
    {
        var shared = await Share("t");
        await using var text = new MemoryStream("not an image"u8.ToArray());

        var stranger = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.SetThumbnailAsync(shared.Slug, fixture.AsOther, text, default));
        text.Position = 0;
        var notImage = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Service.SetThumbnailAsync(shared.Slug, fixture.AsUploader, text, default));

        Assert.Equal(403, stranger.StatusCode);
        Assert.Equal(400, notImage.StatusCode);
        Assert.False(File.Exists(fixture.Storage.ThumbnailPath(shared.Slug)));
    }

    [Fact]
    public async Task Views_CountOncePerViewerPerWindow()
    {
        var shared = await Share("v");
        var id = (await fixture.Db.Recordings.SingleAsync()).Id;
        var counter = new RecordingViewCounter(
            new ServiceCollection().AddSingleton(fixture.Db).BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            fixture.Clock, fixture.Options, NullLogger<RecordingViewCounter>.Instance);

        Assert.Equal(2, await counter.FlushAsync([(id, "a:1"), (id, "a:1"), (id, "u:7")], default));
        fixture.Clock.Now += Duration.FromHours(1);
        Assert.Equal(0, await counter.FlushAsync([(id, "a:1")], default));
        fixture.Clock.Now += Duration.FromHours(6);
        Assert.Equal(1, await counter.FlushAsync([(id, "a:1"), (id + 99, "a:1")], default));

        fixture.Db.ChangeTracker.Clear();
        Assert.Equal(3, (await fixture.Service.GetAsync(shared.Slug, null, default))!.ViewCount);
    }

    [Fact]
    public async Task AccountErasure_TakesTheirRecordingsAndCommentsWithIt()
    {
        var theirs = await Share("theirs");
        var others = await fixture.UploadAsync(RecordingFixture.Midway("others"), actor: fixture.AsOther,
            meta: new RecordingUploadMeta("Rut's round", "Rut", null, null, null, null, null, null, null, null));
        await fixture.Service.AddCommentAsync(others.Slug, fixture.AsUploader, new("0:05 nice", "skandia"), default);
        await fixture.Service.AddCommentAsync(others.Slug, fixture.AsOther, new("ty", "Rut"), default);
        await fixture.Service.AddCommentAsync(theirs.Slug, fixture.AsOther, new("wow", "Rut"), default);
        var accounts = new AccountService(fixture.Db, NullLogger<AccountService>.Instance, fixture.Storage);

        var export = await accounts.ExportAsync(fixture.Uploader.Id);
        Assert.Single(export!.SharedRecordings!);
        Assert.Contains(export.Comments, c => c.Kind == "recording" && c.Content == "0:05 nice");

        var summary = await accounts.DeleteAsync(fixture.Uploader.Id);

        Assert.Equal(1, summary!.RecordingsRemoved);
        Assert.False(File.Exists(fixture.Storage.RecordingPath(theirs.Slug)));
        fixture.Db.ChangeTracker.Clear();
        var left = await fixture.Db.Recordings.SingleAsync();
        Assert.Equal(others.Slug, left.Slug);
        Assert.Equal(1, left.CommentCount);
        Assert.Equal(1, await fixture.Db.RecordingComments.CountAsync());
    }
}
