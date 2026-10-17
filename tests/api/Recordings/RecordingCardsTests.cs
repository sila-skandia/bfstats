using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;

namespace api.tests.Recordings;

/// <summary>
/// The whole feed's cards, their names and the counts (features/replay-feed, "Scale") are kept
/// by triggers on Recordings. After every kind of write, they must be what grouping the
/// recordings from scratch gives.
/// </summary>
public sealed class RecordingCardsTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    private sealed record State(List<string> Cards, List<string> Names, List<string> Tallies);

    /// <summary>What the tables hold.</summary>
    private async Task<State> KeptAsync()
    {
        var cards = await fixture.Db.RecordingCards.AsNoTracking().ToListAsync();
        var names = await fixture.Db.RecordingCardNames.AsNoTracking().ToListAsync();
        var tallies = await fixture.Db.RecordingTallies.AsNoTracking().Where(t => t.Count != 0).ToListAsync();
        return new State(
            [.. cards.Select(c => $"{c.CardKey}:{c.NewestId}:{c.Views}:{c.Recordings}").Order()],
            [.. names.Select(n => $"{n.CardKey}:{n.Kind}:{n.Name}").Order()],
            [.. tallies.Select(t => $"{t.Kind}:{t.Name}:{t.Count}").Order()]);
    }

    /// <summary>What grouping the recordings whose file is there gives, worked out here.</summary>
    private async Task<State> ExpectedAsync()
    {
        var live = await fixture.Db.Recordings.AsNoTracking().Where(r => !r.FileMissing).ToListAsync();
        var cards = live.GroupBy(r => r.RoundId ?? r.Id).ToList();
        var names = cards
            .SelectMany(g => g.Where(r => r.ServerName.Length > 0).Select(r => (g.Key, Kind: RecordingTallyKind.Server, Name: r.ServerName))
                .Concat(g.Where(r => r.UploaderName.Length > 0).Select(r => (g.Key, Kind: RecordingTallyKind.Uploader, Name: r.UploaderName))))
            .Distinct()
            .ToList();
        List<string> tallies = [.. names.GroupBy(n => (n.Kind, n.Name)).Select(g => $"{g.Key.Kind}:{g.Key.Name}:{g.Count()}")];
        if (cards.Count > 0)
        {
            tallies.Add($"{RecordingTallyKind.Cards}::{cards.Count}");
            tallies.Add($"{RecordingTallyKind.Recordings}::{live.Count}");
        }
        return new State(
            [.. cards.Select(g => $"{g.Key}:{g.Max(r => r.Id)}:{g.Max(r => r.ViewCount)}:{g.Count()}").Order()],
            [.. names.Select(n => $"{n.Key}:{n.Kind}:{n.Name}").Order()],
            [.. tallies.Order()]);
    }

    private async Task AssertInStepAsync(string after)
    {
        var expected = await ExpectedAsync();
        var kept = await KeptAsync();
        Assert.True(expected.Cards.SequenceEqual(kept.Cards), $"Cards after {after}: expected {string.Join(' ', expected.Cards)}, kept {string.Join(' ', kept.Cards)}");
        Assert.True(expected.Names.SequenceEqual(kept.Names), $"Names after {after}: expected {string.Join(' ', expected.Names)}, kept {string.Join(' ', kept.Names)}");
        Assert.True(expected.Tallies.SequenceEqual(kept.Tallies), $"Tallies after {after}: expected {string.Join(' ', expected.Tallies)}, kept {string.Join(' ', kept.Tallies)}");
    }

    private Task<RecordingDetailDto> ShareAsync(string salt, bool asRut = false) => fixture.UploadAsync(
        RecordingFixture.Midway(salt),
        RecordingFixture.Meta($"Midway {salt}", authorName: asRut ? "Rut" : "skandia"),
        asRut ? fixture.AsOther : fixture.AsUploader);

    private Task SetAsync(string slug, bool? missing = null, int? views = null) =>
        fixture.Db.Recordings.Where(r => r.Slug == slug).ExecuteUpdateAsync(set => set
            .SetProperty(r => r.FileMissing, r => missing ?? r.FileMissing)
            .SetProperty(r => r.ViewCount, r => views ?? r.ViewCount));

    [Fact]
    public async Task EveryWriteKeepsTheCardsAndCountsInStep()
    {
        await AssertInStepAsync("nothing shared");
        var a = await ShareAsync("a");
        var b = await ShareAsync("b");
        var c = await ShareAsync("c");
        var d = await ShareAsync("d", asRut: true);
        await AssertInStepAsync("uploads");
        Assert.Equal(4, (await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default)).TotalCount);

        Assert.True(await fixture.Rounds.LinkAsync(b.Slug, a.Slug, fixture.AsAdmin, true, default));
        Assert.True(await fixture.Rounds.LinkAsync(d.Slug, b.Slug, fixture.AsAdmin, true, default));
        await AssertInStepAsync("linking a round of three, by two uploaders");
        var feed = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default);
        Assert.Equal((2, 4), (feed.TotalCount, feed.RecordingCount));

        await SetAsync(b.Slug, views: 5);
        await fixture.Db.Recordings.ExecuteUpdateAsync(set => set.SetProperty(r => r.ViewCount, r => r.ViewCount + 1));
        await AssertInStepAsync("views");

        await SetAsync(d.Slug, missing: true);
        await AssertInStepAsync("a file going missing");
        await SetAsync(a.Slug, missing: true);
        await AssertInStepAsync("the file of the recording the round is known by going missing");

        Assert.True(await fixture.Rounds.SeparateAsync(b.Slug, fixture.AsAdmin, default));
        await AssertInStepAsync("separating a recording from its round");

        await fixture.Db.Recordings.ExecuteUpdateAsync(set => set.SetProperty(r => r.FileMissing, false));
        await AssertInStepAsync("the files coming back");

        Assert.True(await fixture.Service.DeleteAsync(a.Slug, fixture.AsUploader, default));
        await AssertInStepAsync("deleting the recording a round is known by");
        Assert.True(await fixture.Service.DeleteAsync(c.Slug, fixture.AsUploader, default));
        await AssertInStepAsync("deleting the rest of a round");

        await fixture.Db.Recordings.ExecuteDeleteAsync();
        await AssertInStepAsync("deleting everything");
    }

    [Fact]
    public async Task Migration_FillsTheCardsOfRecordingsSharedBefore()
    {
        var a = await ShareAsync("a");
        var b = await ShareAsync("b", asRut: true);
        await ShareAsync("c");
        Assert.True(await fixture.Rounds.LinkAsync(b.Slug, a.Slug, fixture.AsAdmin, true, default));
        await SetAsync(a.Slug, views: 3);
        // As a database from before the triggers: the tables empty.
        await fixture.Db.Database.ExecuteSqlRawAsync("DELETE FROM RecordingCardNames; DELETE FROM RecordingCards; DELETE FROM RecordingTallies;");
        Assert.Empty(await fixture.Db.RecordingCards.ToListAsync());

        await fixture.Db.Database.ExecuteSqlRawAsync(RecordingCards.BackfillSql);
        await AssertInStepAsync("the back-fill");
        // Run again, it gives the same.
        await fixture.Db.Database.ExecuteSqlRawAsync(RecordingCards.BackfillSql);
        await AssertInStepAsync("the back-fill run twice");
    }
}
