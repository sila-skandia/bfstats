using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;

namespace api.tests.Recordings;

/// <summary>
/// Who finds a recording (features/bfv-through-bfstats, "Access"): a listed one is everywhere
/// recordings are listed; an unlisted one is in no list, card or count, and its link opens it.
/// </summary>
public sealed class RecordingAccessTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    private static RecordingUploadMeta Meta(string? visibility = null, string? description = null) =>
        new("Midway at dawn", null, null, null, null, null, null, null, null, null, description, visibility);

    [Fact]
    public async Task AnUnlistedRecording_IsInNoListButOpensByItsLink()
    {
        var listed = await fixture.UploadAsync(RecordingFixture.Midway());
        var unlisted = await fixture.UploadAsync(RecordingFixture.Midway("hidden"), Meta("unlisted"));

        var feed = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default);
        var byUploader = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(null, "skandia"), null, default);
        var byPlayer = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(null, null, "Lapu"), null, default);
        var filters = await fixture.Service.FiltersAsync(RecordingFilter.None, default);

        Assert.Equal("unlisted", unlisted.Visibility);
        Assert.Equal([listed.Slug], feed.Items.Select(i => i.Slug));
        Assert.Equal(1, feed.TotalCount);
        Assert.Equal(1, feed.RecordingCount);
        Assert.Equal([listed.Slug], byUploader.Items.Select(i => i.Slug));
        Assert.Equal([listed.Slug], byPlayer.Items.Select(i => i.Slug));
        Assert.Equal(1, Assert.Single(filters.Servers).Count);

        var opened = await fixture.Service.GetAsync(unlisted.Slug, null, default);
        Assert.NotNull(opened);
        Assert.Equal(RecordingGames.Bf1942, await fixture.Service.GameAsync(unlisted.Slug, default));
    }

    [Fact]
    public async Task TheUploader_ListsAndUnlistsIt()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), Meta("unlisted"));
        Assert.Equal(0, (await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default)).TotalCount);

        var listed = await fixture.Service.UpdateAsync(detail.Slug, fixture.AsUploader, new UpdateRecordingRequest(null, Visibility: "public"), default);
        Assert.Equal("public", listed!.Visibility);
        Assert.Equal("Midway at dawn", listed.Title);
        Assert.Equal(1, (await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default)).TotalCount);
        Assert.Single((await fixture.Service.FiltersAsync(RecordingFilter.None, default)).Uploaders);

        await fixture.Service.UpdateAsync(detail.Slug, fixture.AsUploader, new UpdateRecordingRequest(null, Visibility: "unlisted"), default);
        Assert.Equal(0, (await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default)).TotalCount);
        Assert.Empty((await fixture.Service.FiltersAsync(RecordingFilter.None, default)).Uploaders);
    }

    [Fact]
    public async Task OnlyTheUploaderOrAnAdmin_ChangesIt()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway());

        await Assert.ThrowsAnyAsync<Exception>(() =>
            fixture.Service.UpdateAsync(detail.Slug, fixture.AsOther, new UpdateRecordingRequest(null, Visibility: "unlisted"), default));
        Assert.NotNull(await fixture.Service.UpdateAsync(detail.Slug, fixture.AsAdmin, new UpdateRecordingRequest(null, Visibility: "unlisted"), default));
    }

    [Fact]
    public async Task AVisibilityTheApiDoesNotKnow_IsRefused()
    {
        await Assert.ThrowsAsync<RecordingRejectedException>(() => fixture.UploadAsync(RecordingFixture.Midway(), Meta("secret")));
        var detail = await fixture.UploadAsync(RecordingFixture.Midway());
        await Assert.ThrowsAsync<RecordingRejectedException>(() =>
            fixture.Service.UpdateAsync(detail.Slug, fixture.AsUploader, new UpdateRecordingRequest(null, Visibility: "hidden"), default));
    }

    [Fact]
    public async Task ADescription_IsKeptCleanAndBounded()
    {
        var detail = await fixture.UploadAsync(RecordingFixture.Midway(), Meta(description: "  Our best round.\n\n\n\nGG all  "));
        Assert.Equal("Our best round.\n\nGG all", detail.Description);

        await Assert.ThrowsAsync<RecordingRejectedException>(() =>
            fixture.UploadAsync(RecordingFixture.Midway("long"), Meta(description: new string('x', RecordingText.MaxDescription + 1))));

        var changed = await fixture.Service.UpdateAsync(detail.Slug, fixture.AsUploader, new UpdateRecordingRequest(null, Description: "Edited"), default);
        Assert.Equal("Edited", changed!.Description);
        Assert.Equal("Midway at dawn", changed.Title);
    }

    [Fact]
    public async Task AnUnlistedRecordingInARound_IsNotNamedOnItsOthers()
    {
        var listed = await fixture.UploadAsync(RecordingFixture.Midway());
        var unlisted = await fixture.UploadAsync(RecordingFixture.Midway("other side"), Meta("unlisted"));
        await fixture.Rounds.LinkAsync(unlisted.Slug, listed.Slug, fixture.AsAdmin, confirm: true, default);
        var rows = await fixture.Db.Recordings.AsNoTracking().ToListAsync();
        Assert.All(rows, r => Assert.NotNull(r.RoundId));

        var page = await fixture.Service.GetAsync(listed.Slug, null, default);
        var own = await fixture.Service.GetAsync(unlisted.Slug, null, default);

        Assert.DoesNotContain(page!.Round ?? [], m => m.Slug == unlisted.Slug);
        Assert.Equal(1, (await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default)).RecordingCount);
        Assert.NotNull(own);
    }
}
