using System.Text.Json;
using api.Recordings;
using api.Recordings.Models;
using NodaTime;

namespace api.tests.Recordings;

/// <summary>
/// Sharing a creator's edit of a clip (features/replay-creator-view, "Sharing an edit"): kept
/// against a shared recording, read back by its code from a link, and named by the
/// recording's short link when that link carries it.
/// </summary>
public sealed class RecordingEditTests : IDisposable
{
    private readonly RecordingFixture fixture = new();
    private readonly RecordingEditService edits;

    public RecordingEditTests() =>
        edits = new RecordingEditService(fixture.Db, fixture.Service, fixture.Clock, fixture.Options);

    public void Dispose() => fixture.Dispose();

    private static JsonElement Json(string text)
    {
        using var doc = JsonDocument.Parse(text);
        return doc.RootElement.Clone();
    }

    private const string Edit = """{"v":1,"range":{"in":263.06,"out":277.49},"sync":{"ev":"hit","at":41,"hold":"slow"},"cams":[{"cam":"shoulder"}]}""";

    [Fact]
    public async Task AnEditIsKept_AndReadBackByItsCode_WithItsLink()
    {
        var recording = await fixture.UploadAsync(RecordingFixture.Midway(), RecordingFixture.Meta());

        var shared = await edits.ShareAsync(recording.Slug, fixture.AsUploader, new ShareRecordingEditRequest("Mustang bomb", Json(Edit)), CancellationToken.None);

        Assert.NotNull(shared);
        Assert.Equal(RecordingEditService.CodeLength, shared.Code.Length);
        Assert.Equal(recording.Slug, shared.Slug);
        Assert.Equal("Mustang bomb", shared.Name);
        // Shared under the account's linked name.
        Assert.Equal("skandia", shared.AuthorName);
        Assert.Equal($"https://replay.bfstats.io/{recording.Slug}?edit={shared.Code}", shared.Link);
        Assert.Equal(RecordingFixture.Start.ToString(), Instant.FromDateTimeOffset(DateTimeOffset.Parse(shared.CreatedAt)).ToString());

        var read = await edits.GetAsync(shared.Code.ToUpperInvariant(), CancellationToken.None);
        Assert.NotNull(read);
        Assert.Equal(shared.Code, read.Code);
        Assert.Equal(41, read.Edit.GetProperty("sync").GetProperty("at").GetInt32());
        Assert.Equal("shoulder", read.Edit.GetProperty("cams")[0].GetProperty("cam").GetString());
    }

    [Fact]
    public async Task AnAccountWithNoLinkedName_SharesWithNone_ButCannotClaimSomeoneElses()
    {
        var recording = await fixture.UploadAsync(RecordingFixture.Midway(), RecordingFixture.Meta());

        var shared = await edits.ShareAsync(recording.Slug, fixture.AsUnlinked, new ShareRecordingEditRequest(null, Json(Edit)), CancellationToken.None);

        Assert.NotNull(shared);
        Assert.Equal("", shared.AuthorName);
        Assert.Equal("An edit", shared.Name);
        await Assert.ThrowsAsync<RecordingRejectedException>(() =>
            edits.ShareAsync(recording.Slug, fixture.AsOther, new ShareRecordingEditRequest("x", Json(Edit), "skandia"), CancellationToken.None));
    }

    [Fact]
    public async Task WhatIsNotAnEdit_OrIsTooBig_IsRefused_AndNoRecordingIsNothing()
    {
        var recording = await fixture.UploadAsync(RecordingFixture.Midway(), RecordingFixture.Meta());

        await Assert.ThrowsAsync<RecordingRejectedException>(() =>
            edits.ShareAsync(recording.Slug, fixture.AsUploader, new ShareRecordingEditRequest("x", Json("[1,2]")), CancellationToken.None));
        var big = $$"""{"v":1,"pad":"{{new string('a', RecordingEditService.MaxPayloadBytes)}}"}""";
        await Assert.ThrowsAsync<RecordingRejectedException>(() =>
            edits.ShareAsync(recording.Slug, fixture.AsUploader, new ShareRecordingEditRequest("x", Json(big)), CancellationToken.None));
        Assert.Null(await edits.ShareAsync("zzzzzzzzzz", fixture.AsUploader, new ShareRecordingEditRequest("x", Json(Edit)), CancellationToken.None));
        Assert.Null(await edits.GetAsync("nope", CancellationToken.None));
        Assert.Null(await edits.GetAsync("abcdefgh", CancellationToken.None));
    }

    [Theory]
    [InlineData("  Mustang\n bomb  ", "Mustang bomb")]
    [InlineData("", "An edit")]
    [InlineData(null, "An edit")]
    public void AnEditsNameIsOneLineOfText(string? asked, string kept) => Assert.Equal(kept, RecordingEditService.Name(asked));

    [Fact]
    public void ALongNameIsCut() => Assert.Equal(RecordingEditService.MaxName, RecordingEditService.Name(new string('x', 200)).Length);
}
