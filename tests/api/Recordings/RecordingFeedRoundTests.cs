using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace api.tests.Recordings;

/// <summary>
/// The feed's cards (features/replay-feed, "Rounds"): a round of several recordings is one
/// card, grouped by the API before it pages, counts and orders them, and shown whole under a
/// filter one of its recordings matches.
/// </summary>
public sealed class RecordingFeedRoundTests : IDisposable
{
    private const string Lab = "bfstats-lab";
    private const string Moon = "MoonGamers.com | Est. 2004";

    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    private async Task<RecordingDetailDto> ShareAsync(string text, string title, bool asRut = false)
    {
        // A minute between shares: the newest recording is the one shared last.
        fixture.Clock.Now += Duration.FromMinutes(1);
        return await fixture.UploadAsync(
            text, RecordingFixture.Meta(title, authorName: asRut ? "Rut" : "skandia"), asRut ? fixture.AsOther : fixture.AsUploader);
    }

    /// <summary>A recording of a round nobody else shared: Midway, on MoonGamers.</summary>
    private Task<RecordingDetailDto> SingleAsync(string salt) => ShareAsync(RecordingFixture.Midway(salt), $"Single {salt}");

    /// <summary>Two recordings of one made-up Wake round on the lab server: the first from the
    /// join for 200 s, the second (its clock drifting, its events jittered) from 150 s to 400 s.</summary>
    private async Task<(RecordingDetailDto First, RecordingDetailDto Second)> RoundAsync(
        int seed, string name, bool secondByRut = false, double to = 400)
    {
        var round = new SyntheticRound(seed, objectSeed: seed * 100);
        var first = await ShareAsync(round.File(0, 200), $"{name} first");
        var second = await ShareAsync(round.File(150, to, drift: 30e-6, jitter: 0.03, seed: 3, local: 2), $"{name} second", secondByRut);
        Assert.Equal(2, second.Round?.Count);
        return (first, second);
    }

    private Task<PagedRecordingsDto> ListAsync(string? sort = null, int page = 1, int pageSize = 24, string? server = null, string? uploader = null) =>
        fixture.Service.ListAsync(sort, page, pageSize, RecordingFilter.From(server, uploader), null, CancellationToken.None);

    private Task SetAsync(string slug, int views) =>
        fixture.Db.Recordings.Where(r => r.Slug == slug).ExecuteUpdateAsync(set => set.SetProperty(r => r.ViewCount, views));

    [Fact]
    public async Task ARoundIsOneCard_PagedCountedAndOrderedAsOne()
    {
        var a = await RoundAsync(31, "A");
        var single1 = await SingleAsync("one");
        var b1 = await ShareAsync(new SyntheticRound(32, objectSeed: 3200).File(0, 300), "B first");
        var single2 = await SingleAsync("two");
        var b2 = await ShareAsync(new SyntheticRound(32, objectSeed: 3200).File(100, 250, jitter: 0.03, seed: 4, local: 3), "B second");
        Assert.Equal(2, b2.Round?.Count);

        var recent = await ListAsync();

        // A round sits among the newest by its newest recording (B's second, shared last, puts
        // it ahead of the single shared between its two), and its card is its lead: the
        // recording that covers the most of it.
        Assert.Equal([b1.Slug, single2.Slug, single1.Slug, a.Second.Slug], recent.Items.Select(i => i.Slug));
        Assert.Equal(4, recent.TotalCount);
        Assert.Equal(6, recent.RecordingCount);
        Assert.Equal(1, recent.TotalPages);
        Assert.Equal([2, 0, 0, 2], recent.Items.Select(i => i.RoundCard?.Recordings ?? 0));
        Assert.Null(recent.Items[1].Round);

        // Paged by card: no round is split across pages, and none is counted twice.
        var first = await ListAsync(pageSize: 3);
        var second = await ListAsync(page: 2, pageSize: 3);
        Assert.Equal([b1.Slug, single2.Slug, single1.Slug], first.Items.Select(i => i.Slug));
        Assert.Equal([a.Second.Slug], second.Items.Select(i => i.Slug));
        Assert.Equal([a.First.Slug, a.Second.Slug], second.Items[0].Round!.Select(m => m.Slug));
        Assert.All([first, second], p => Assert.Equal((4, 6, 2), (p.TotalCount, p.RecordingCount, p.TotalPages)));

        // Most viewed: a round by its most-watched recording.
        await SetAsync(a.First.Slug, 5);
        await SetAsync(a.Second.Slug, 2);
        await SetAsync(single1.Slug, 4);
        await SetAsync(b1.Slug, 1);
        await SetAsync(b2.Slug, 1);
        var watched = await ListAsync("views");
        Assert.Equal([a.Second.Slug, single1.Slug, b1.Slug, single2.Slug], watched.Items.Select(i => i.Slug));
        Assert.Equal(5, watched.Items[0].RoundCard!.ViewCount);
        Assert.Equal(2, watched.Items[0].ViewCount);
    }

    [Fact]
    public async Task ARoundsCard_ShowsTheWholeRound()
    {
        var (first, second) = await RoundAsync(33, "Wake", secondByRut: true);
        await SetAsync(first.Slug, 7);
        await SetAsync(second.Slug, 3);
        await fixture.Service.AddCommentAsync(first.Slug, fixture.AsOther, new("0:21 nice", "Rut"), default);
        await fixture.Service.AddCommentAsync(first.Slug, fixture.AsOther, new("gg", "Rut"), default);
        await fixture.Service.AddCommentAsync(second.Slug, fixture.AsUploader, new("1:00 there", "skandia"), default);
        // A cover on the recording that is not the lead.
        await CoverAsync(first.Slug);

        var card = Assert.Single((await ListAsync()).Items);

        // The lead is the longer, its own fields its own.
        Assert.Equal(second.Slug, card.Slug);
        Assert.Equal(250, card.DurationSeconds, 0.1);
        Assert.Equal(3, card.ViewCount);
        Assert.Null(card.ThumbnailUrl);
        // The round in the order its recordings began, and the card's view of it whole.
        Assert.Equal([first.Slug, second.Slug], card.Round!.Select(m => m.Slug));
        var whole = card.RoundCard!;
        Assert.Equal(2, whole.Recordings);
        Assert.Equal(400, whole.DurationSeconds, 0.1);
        Assert.Equal(["skandia", "Rut"], whole.Uploaders);
        Assert.Equal(7, whole.ViewCount);
        Assert.Equal(3, whole.CommentCount);
        Assert.Equal(second.CreatedAt, whole.CreatedAt);
        Assert.StartsWith($"/stats/recordings/{first.Slug}.jpg?v=", whole.ThumbnailUrl, StringComparison.Ordinal);
        Assert.False(whole.Weak);

        // The lead's own cover comes first.
        await CoverAsync(second.Slug);
        card = Assert.Single((await ListAsync()).Items);
        Assert.StartsWith($"/stats/recordings/{second.Slug}.jpg?v=", card.RoundCard!.ThumbnailUrl, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ARoundWithOneRecordingLeftInTheFeed_IsAPlainCard()
    {
        var (first, second) = await RoundAsync(35, "Wake");
        await fixture.Db.Recordings.Where(r => r.Slug == second.Slug).ExecuteUpdateAsync(set => set.SetProperty(r => r.FileMissing, true));

        var feed = await ListAsync();

        var card = Assert.Single(feed.Items);
        Assert.Equal(first.Slug, card.Slug);
        Assert.Null(card.Round);
        Assert.Null(card.RoundCard);
        Assert.Equal((1, 1), (feed.TotalCount, feed.RecordingCount));
    }

    [Fact]
    public async Task AFilter_ShowsARoundWhenOneOfItsRecordingsMatches_AndCountsCards()
    {
        var (mine, theirs) = await RoundAsync(34, "Wake", secondByRut: true);
        var single = await SingleAsync("s");

        var byRut = await ListAsync(uploader: "Rut");
        var bySkandia = await ListAsync(uploader: "skandia");
        var onLab = await ListAsync(server: Lab);
        var both = await ListAsync(server: Lab, uploader: "Rut");
        var none = await ListAsync(server: Moon, uploader: "Rut");

        // Rut shared one recording of the round: the round shows, whole.
        var round = Assert.Single(byRut.Items);
        Assert.Equal(theirs.Slug, round.Slug);
        Assert.Equal([mine.Slug, theirs.Slug], round.Round!.Select(m => m.Slug));
        Assert.Equal((1, 2), (byRut.TotalCount, byRut.RecordingCount));
        Assert.Equal([single.Slug, theirs.Slug], bySkandia.Items.Select(i => i.Slug));
        Assert.Equal((2, 3), (bySkandia.TotalCount, bySkandia.RecordingCount));
        Assert.Equal([theirs.Slug], onLab.Items.Select(i => i.Slug));
        Assert.Equal([theirs.Slug], both.Items.Select(i => i.Slug));
        Assert.Empty(none.Items);

        // Each choice counts the cards it would show: the round once, whoever shared it.
        var choices = (RecordingFiltersDto f) => (
            f.Servers.Select(c => (c.Name, c.Count)).ToList(),
            f.Uploaders.Select(c => (c.Name, c.Count)).ToList());
        var (servers, uploaders) = choices(await fixture.Service.FiltersAsync(RecordingFilter.None, default));
        var (serversByRut, _) = choices(await fixture.Service.FiltersAsync(RecordingFilter.From(null, "Rut"), default));
        var (_, uploadersOnLab) = choices(await fixture.Service.FiltersAsync(RecordingFilter.From(Lab, null), default));
        Assert.Equal([(Lab, 1), (Moon, 1)], servers);
        Assert.Equal([("Rut", 1), ("skandia", 2)], uploaders);
        Assert.Equal([(Lab, 1)], serversByRut);
        Assert.Equal([("Rut", 1), ("skandia", 1)], uploadersOnLab);
    }

    /// <summary>A round's card says of each of its recordings whether the one asking may rename
    /// or delete it, and of itself (its lead's) likewise; a recording's page lists its round the
    /// same way.</summary>
    [Fact]
    public async Task ARoundsCard_SaysWhoMayRenameOrDeleteEachOfItsRecordings()
    {
        var (mine, theirs) = await RoundAsync(36, "Wake", secondByRut: true);

        async Task<RecordingSummaryDto> CardAsync(RecordingActor? actor) => Assert.Single(
            (await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, actor, default)).Items);

        // Rut's is the lead (the longer); the round lists skandia's first, as it began first.
        var anyone = await CardAsync(null);
        Assert.Equal(theirs.Slug, anyone.Slug);
        Assert.False(anyone.CanManage);
        Assert.Equal([false, false], anyone.Round!.Select(m => m.CanManage));
        var rut = await CardAsync(fixture.AsOther);
        Assert.True(rut.CanManage);
        Assert.Equal([false, true], rut.Round!.Select(m => m.CanManage));
        var skandia = await CardAsync(fixture.AsUploader);
        Assert.False(skandia.CanManage);
        Assert.Equal([true, false], skandia.Round!.Select(m => m.CanManage));
        var admin = await CardAsync(fixture.AsAdmin);
        Assert.True(admin.CanManage);
        Assert.Equal([true, true], admin.Round!.Select(m => m.CanManage));

        var page = await fixture.Service.GetAsync(mine.Slug, fixture.AsUploader, default);
        Assert.True(page!.CanManage);
        Assert.Equal([true, false], page.Round!.Select(m => m.CanManage));
    }

    private async Task CoverAsync(string slug)
    {
        using var frame = new Image<Rgba32>(640, 360, new Rgba32(40, 60, 90, 255));
        await using var png = new MemoryStream();
        await frame.SaveAsPngAsync(png);
        png.Position = 0;
        fixture.Clock.Now += Duration.FromSeconds(1);
        await fixture.Service.SetThumbnailAsync(slug, fixture.AsAdmin, png, default);
    }
}
