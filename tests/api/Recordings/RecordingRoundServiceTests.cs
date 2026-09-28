using api.Recordings;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace api.tests.Recordings;

/// <summary>
/// Recordings of one round found and grouped as they are shared (features/replay-feed,
/// "Rounds"): against SQLite and a temp directory, through the upload, the feed, the
/// background pass and the admin's tools.
/// </summary>
public sealed class RecordingRoundServiceTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    private Task<RecordingDetailDto> ShareAsync(string text, string title = "A round", RecordingActor? actor = null, string author = "skandia") =>
        fixture.UploadAsync(text, RecordingFixture.Meta(title, authorName: author), actor ?? fixture.AsUploader);

    private Task<Recording> RowAsync(string slug) => fixture.Db.Recordings.AsNoTracking().SingleAsync(r => r.Slug == slug);

    [Fact]
    public async Task TwoRecordingsOfOneRound_AreOneRound_WithTheirOffset()
    {
        var a = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        Assert.Null(a.Round);

        var b = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-b"), "Axis");

        // The page the uploader lands on says so already.
        Assert.NotNull(b.Round);
        Assert.Equal([a.Slug, b.Slug], b.Round!.Select(m => m.Slug));
        Assert.Equal(["detected", "self"], b.Round!.Select(m => m.Link));
        // B began 60 s into A's recording.
        Assert.Equal(0, b.Round![0].RoundOffsetSeconds);
        Assert.Equal(60, b.Round![1].RoundOffsetSeconds!.Value, 0.05);
        var rowA = await RowAsync(a.Slug);
        var rowB = await RowAsync(b.Slug);
        Assert.Equal(rowA.Id, rowA.RoundId);
        Assert.Equal(rowA.Id, rowB.RoundId);
        var link = await fixture.Db.RecordingRoundLinks.AsNoTracking().SingleAsync();
        Assert.Equal(RecordingRoundLinkKind.Detected, link.Kind);
        Assert.Equal((rowA.Id, rowB.Id), (link.RecordingId, link.OtherRecordingId));
        Assert.Equal(60, link.OffsetSeconds!.Value, 0.05);
        Assert.True(link.MatchedPlayerKeys >= 150);
        Assert.True(link.PlayerShare >= 0.95);

        // The feed's cards carry it too, each with the other.
        var feed = await fixture.Service.ListAsync("recent", 1, 24, new RecordingFilter(null, null), CancellationToken.None);
        Assert.All(feed.Items, card => Assert.Equal([a.Slug, b.Slug], card.Round!.Select(m => m.Slug)));
        Assert.Equal("self", feed.Items.Single(c => c.Slug == a.Slug).Round!.Single(m => m.Slug == a.Slug).Link);
    }

    [Fact]
    public async Task ARecordingOfAnotherRound_IsNotPutInIt()
    {
        var a = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        await ShareAsync(RoundFingerprintTests.FixtureText("bocage-b"), "Axis");

        // The same map on the same server the next day.
        var other = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-other"), "Next day");

        Assert.Null(other.Round);
        Assert.Null((await RowAsync(other.Slug)).RoundId);
        Assert.Equal(2, (await fixture.Service.GetAsync(a.Slug, null, CancellationToken.None))!.Round!.Count);
    }

    [Fact]
    public async Task TwoRoundsOfWakeOnTheLabServer_AreNotOneRound()
    {
        await ShareAsync(RoundFingerprintTests.FixtureText("wake-001120"), "First");
        var second = await ShareAsync(RoundFingerprintTests.FixtureText("wake-075756"), "Second");

        Assert.Null(second.Round);
        Assert.Empty(await fixture.Db.RecordingRoundLinks.ToListAsync());
    }

    [Theory]
    [InlineData("\"name\":\"MoonGamers.com | Est. 2004\"", "\"name\":\"Another server\"")]
    [InlineData("bf1942/levels/bocage/", "bf1942/levels/kursk/")]
    [InlineData("\"mode\":\"conquest.con\"", "\"mode\":\"ctf.con\"")]
    public async Task RecordingsOfAnotherServerMapOrGameType_AreNeverCompared(string said, string instead)
    {
        await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        var elsewhere = RoundFingerprintTests.FixtureText("bocage-b").Replace(said, instead, StringComparison.Ordinal);

        var b = await ShareAsync(elsewhere, "Axis");

        Assert.Null(b.Round);
        Assert.Empty(await fixture.Db.RecordingRoundLinks.ToListAsync());
    }

    [Fact]
    public async Task ThreeRecordings_ChainIntoOneRound()
    {
        var round = new SyntheticRound(seed: 21);
        var first = await ShareAsync(round.File(0, 200), "First");
        // The third shares no moment with the first...
        var third = await ShareAsync(round.File(350, 600, drift: 60e-6, jitter: 0.03, seed: 5, local: 4), "Third");
        Assert.Null(third.Round);

        // ...and the second shares one with each.
        var second = await ShareAsync(round.File(150, 400, drift: -30e-6, jitter: 0.03, seed: 3, local: 2), "Second");

        Assert.Equal([first.Slug, second.Slug, third.Slug], second.Round!.Select(m => m.Slug));
        Assert.Equal([null, "self", null], (await fixture.Service.GetAsync(second.Slug, null, CancellationToken.None))!.Round!
            .Select(m => m.Link == "detected" ? null : m.Link));
        Assert.Equal(150, second.Round![1].RoundOffsetSeconds!.Value, 0.05);
        Assert.Equal(350, second.Round![2].RoundOffsetSeconds!.Value, 0.05);
        var ids = await fixture.Db.Recordings.AsNoTracking().Select(r => new { r.Id, r.RoundId }).ToListAsync();
        Assert.All(ids, r => Assert.Equal(ids.Min(x => x.Id), r.RoundId));
        // The first and the third: through the second only.
        var viaFirst = (await fixture.Service.GetAsync(first.Slug, null, CancellationToken.None))!.Round!;
        Assert.Equal(["self", "detected", null], viaFirst.Select(m => m.Link));
    }

    [Fact]
    public async Task RemovingTheRecordingThatJoinedTwo_LeavesThemApart()
    {
        var round = new SyntheticRound(seed: 22);
        var first = await ShareAsync(round.File(0, 200), "First");
        var third = await ShareAsync(round.File(350, 600, jitter: 0.03, seed: 5), "Third");
        var second = await ShareAsync(round.File(150, 400, jitter: 0.03, seed: 3), "Second");
        Assert.Equal(3, second.Round!.Count);

        Assert.True(await fixture.Service.DeleteAsync(second.Slug, fixture.AsUploader, CancellationToken.None));

        Assert.Null((await RowAsync(first.Slug)).RoundId);
        Assert.Null((await RowAsync(third.Slug)).RoundId);
        Assert.Empty(await fixture.Db.RecordingRoundLinks.ToListAsync());
    }

    [Fact]
    public async Task ErasingAnAccount_RegroupsTheRoundsItsRecordingsJoined()
    {
        var round = new SyntheticRound(seed: 24);
        var first = await ShareAsync(round.File(0, 200), "First", fixture.AsOther, "Rut");
        var third = await ShareAsync(round.File(350, 600, jitter: 0.03, seed: 5), "Third", fixture.AsOther, "Rut");
        var second = await ShareAsync(round.File(150, 400, jitter: 0.03, seed: 3), "Second");
        Assert.Equal(3, second.Round!.Count);
        var accounts = new api.Auth.AccountService(
            fixture.Db, Microsoft.Extensions.Logging.Abstractions.NullLogger<api.Auth.AccountService>.Instance, fixture.Storage, fixture.Rounds);

        await accounts.DeleteAsync(fixture.Uploader.Id);

        Assert.Null((await RowAsync(first.Slug)).RoundId);
        Assert.Null((await RowAsync(third.Slug)).RoundId);
    }

    [Fact]
    public async Task AFileGone_LeavesItsRoundInTheFeed()
    {
        var a = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        var b = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-b"), "Axis");
        await fixture.Db.Recordings.Where(r => r.Slug == b.Slug).ExecuteUpdateAsync(set => set.SetProperty(r => r.FileMissing, true));

        // A round of one is no round to show; it comes back with the file.
        Assert.Null((await fixture.Service.GetAsync(a.Slug, null, CancellationToken.None))!.Round);
        Assert.NotNull((await RowAsync(b.Slug)).RoundId);
    }

    [Fact]
    public async Task RecordingsSharedBeforeRounds_AreFingerprintedFromTheirFilesAndGrouped()
    {
        var a = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        var b = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-b"), "Axis");
        var other = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-other"), "Next day");
        // As production has them before this change: no fingerprints, no links, no rounds.
        await fixture.Db.RecordingRoundLinks.ExecuteDeleteAsync();
        await fixture.Db.RecordingFingerprints.ExecuteDeleteAsync();
        await fixture.Db.Recordings.ExecuteUpdateAsync(set => set.SetProperty(r => r.RoundId, (int?)null));
        // The background pass runs in a scope of its own.
        fixture.Db.ChangeTracker.Clear();

        var result = await fixture.Rounds.BackfillAsync(CancellationToken.None);

        Assert.Equal(new RecordingRoundBackfillResult(Read: 3, Failed: 0, Compared: 3, Linked: 1), result);
        var prints = await fixture.Db.RecordingFingerprints.AsNoTracking().ToListAsync();
        Assert.Equal(3, prints.Count);
        Assert.All(prints, f => Assert.Equal(fixture.Options.Value.RoundSettings, f.RoundsChecked));
        Assert.Equal((await RowAsync(a.Slug)).Id, (await RowAsync(b.Slug)).RoundId);
        Assert.Null((await RowAsync(other.Slug)).RoundId);

        // A second pass has nothing to do.
        Assert.Equal(new RecordingRoundBackfillResult(0, 0, 0, 0), await fixture.Rounds.BackfillAsync(CancellationToken.None));
    }

    [Fact]
    public async Task TheBackfill_SkipsAFileThatIsGone()
    {
        var a = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        await fixture.Db.RecordingFingerprints.ExecuteDeleteAsync();
        fixture.Db.ChangeTracker.Clear();
        File.Delete(fixture.Storage.RecordingPath(a.Slug));

        var result = await fixture.Rounds.BackfillAsync(CancellationToken.None);

        Assert.Equal(1, result.Failed);
        Assert.Empty(await fixture.Db.RecordingFingerprints.ToListAsync());
    }

    [Fact]
    public async Task AnAdminTakesARecordingOutOfItsRound_AndDetectionLeavesItOut()
    {
        var a = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-a"), "Allies");
        var b = await ShareAsync(RoundFingerprintTests.FixtureText("bocage-b"), "Axis");

        var refused = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Rounds.SeparateAsync(b.Slug, fixture.AsUploader, CancellationToken.None));
        Assert.Equal(StatusCodes.Status403Forbidden, refused.StatusCode);

        Assert.True(await fixture.Rounds.SeparateAsync(b.Slug, fixture.AsAdmin, CancellationToken.None));

        Assert.Null((await RowAsync(a.Slug)).RoundId);
        Assert.Null((await RowAsync(b.Slug)).RoundId);
        var link = await fixture.Db.RecordingRoundLinks.AsNoTracking().SingleAsync();
        Assert.Equal(RecordingRoundLinkKind.Separated, link.Kind);
        Assert.Equal(fixture.Admin.Id, link.ByUserId);

        // Compared again, even under new settings, they stay apart.
        await fixture.Rounds.DetectAsync((await RowAsync(b.Slug)).Id, CancellationToken.None);
        await fixture.Rounds.DetectAsync((await RowAsync(a.Slug)).Id, CancellationToken.None);
        Assert.Null((await RowAsync(b.Slug)).RoundId);
        Assert.Equal(RecordingRoundLinkKind.Separated, (await fixture.Db.RecordingRoundLinks.AsNoTracking().SingleAsync()).Kind);
    }

    [Fact]
    public async Task AnAdminPutsTwoRecordingsDetectionMissedInOneRound()
    {
        // One round, recorded in two stretches that share no moment: a player who rejoined.
        var round = new SyntheticRound(seed: 23);
        var early = await ShareAsync(round.File(0, 100), "Before");
        var late = await ShareAsync(round.File(200, 300, seed: 2), "After");
        Assert.Null(late.Round);

        var refused = await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Rounds.LinkAsync(late.Slug, early.Slug, fixture.AsOther, CancellationToken.None));
        Assert.Equal(StatusCodes.Status403Forbidden, refused.StatusCode);
        await Assert.ThrowsAsync<RecordingRejectedException>(
            () => fixture.Rounds.LinkAsync(late.Slug, "not a recording", fixture.AsAdmin, CancellationToken.None));

        // Named by the link to its page in the feed.
        Assert.True(await fixture.Rounds.LinkAsync(
            late.Slug, $"https://play.bfstats.io/play/index.html?tab=replay&rec={early.Slug}", fixture.AsAdmin, CancellationToken.None));

        var page = (await fixture.Service.GetAsync(late.Slug, fixture.AsAdmin, CancellationToken.None))!;
        Assert.True(page.CanEditRound);
        Assert.Equal([early.Slug, late.Slug], page.Round!.Select(m => m.Slug));
        Assert.Equal("linked", page.Round![0].Link);
        var link = await fixture.Db.RecordingRoundLinks.AsNoTracking().SingleAsync();
        Assert.Equal(RecordingRoundLinkKind.Linked, link.Kind);
        Assert.False((await fixture.Service.GetAsync(late.Slug, fixture.AsOther, CancellationToken.None))!.CanEditRound);

        // Detection, run again, leaves an admin's link standing.
        await fixture.Rounds.DetectAsync((await RowAsync(late.Slug)).Id, CancellationToken.None);
        Assert.Equal(RecordingRoundLinkKind.Linked, (await fixture.Db.RecordingRoundLinks.AsNoTracking().SingleAsync()).Kind);

        // Taken out again, and put back: the separation gives way to the admin's word.
        Assert.True(await fixture.Rounds.SeparateAsync(early.Slug, fixture.AsAdmin, CancellationToken.None));
        Assert.Null((await RowAsync(late.Slug)).RoundId);
        Assert.True(await fixture.Rounds.LinkAsync(early.Slug, late.Slug, fixture.AsAdmin, CancellationToken.None));
        Assert.NotNull((await RowAsync(late.Slug)).RoundId);
    }

    [Theory]
    [InlineData("abcdefghjk", "abcdefghjk")]
    [InlineData(" abcdefghjk ", "abcdefghjk")]
    [InlineData("https://play.bfstats.io/stats/recordings/abcdefghjk.ndjson", "abcdefghjk")]
    [InlineData("https://play.bfstats.io/map.html?mod=bf1942&map=bocage&replay=/stats/recordings/abcdefghjk.ndjson", "abcdefghjk")]
    [InlineData("https://play.bfstats.io/play/index.html?tab=replay&rec=abcdefghjk", "abcdefghjk")]
    [InlineData("abcdefghj", null)]
    [InlineData("ABCDEFGHJK", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void ARecordingIsNamedByItsIdOrAnyLinkToIt(string? text, string? slug) =>
        Assert.Equal(slug, RecordingRoundService.SlugIn(text));
}
