using System.Text;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.Recordings;

/// <summary>
/// Server recordings and client recordings (features/recording-source): which recorder wrote a
/// file is read from its header's <c>plus</c> when it is shared, kept on its row, said on every
/// card, member and page, and the feed can be narrowed to either. Rows shared before the source
/// was kept have theirs read from the first line of their files by the file check.
/// </summary>
public sealed class RecordingSourceTests : IDisposable
{
    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    /// <summary>The Midway round as the server-side recorder would head it.</summary>
    private static string ServerMidway(string salt) =>
        RecordingFixture.Midway(salt).Replace("\"plus\":\"2.0\"", "\"plus\":\"server-replay-recorder/3\"", StringComparison.Ordinal);

    private Task<RecordingDetailDto> Share(string text, string title) => fixture.UploadAsync(
        text, new RecordingUploadMeta(title, "skandia", null, null, null, null, null, null, null, null));

    [Theory]
    [InlineData("server-replay-recorder/3", RecordingSource.Server)]
    [InlineData("server-replay-recorder", RecordingSource.Server)]
    [InlineData("2.0", RecordingSource.Client)]
    [InlineData("", RecordingSource.Client)]
    [InlineData(null, RecordingSource.Client)]
    public void SourceOf_NamesTheServerRecorderByItsPrefix(string? plus, RecordingSource expected) =>
        Assert.Equal(expected, RecordingInspector.SourceOf(plus));

    [Fact]
    public async Task Inspect_ReadsTheSourceFromTheHeader()
    {
        using var server = new MemoryStream(RecordingFixture.Gzip(ServerMidway("s")));
        using var client = new MemoryStream(RecordingFixture.Gzip(RecordingFixture.Midway("c")));

        Assert.Equal(RecordingSource.Server, (await RecordingInspector.InspectAsync(server, null, 1 << 30, default)).Source);
        Assert.Equal(RecordingSource.Client, (await RecordingInspector.InspectAsync(client, null, 1 << 30, default)).Source);
    }

    [Fact]
    public async Task Upload_KeepsTheSource_AndEveryViewSaysIt()
    {
        var server = await Share(ServerMidway("s"), "Server round");
        var client = await Share(RecordingFixture.Midway("c"), "Client round");

        Assert.Equal("server", server.Source);
        Assert.Equal("client", client.Source);
        var feed = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.None, null, default);
        Assert.Equal("server", feed.Items.Single(i => i.Slug == server.Slug).Source);
        Assert.Equal("client", feed.Items.Single(i => i.Slug == client.Slug).Source);
    }

    [Fact]
    public async Task List_NarrowsToServerOrClientRecordings()
    {
        var server = await Share(ServerMidway("s"), "Server round");
        var client = await Share(RecordingFixture.Midway("c"), "Client round");
        var list = (string? source) =>
            fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(null, null, null, source), null, default);

        Assert.Equal([server.Slug], (await list("server")).Items.Select(i => i.Slug));
        Assert.Equal([client.Slug], (await list("client")).Items.Select(i => i.Slug));
        Assert.Equal([client.Slug], (await list(" Player ")).Items.Select(i => i.Slug));
        Assert.Equal(2, (await list("anything else")).TotalCount);
        Assert.Equal(1, (await list("server")).TotalCount);
        // The filter choices count within the source.
        var choices = await fixture.Service.FiltersAsync(RecordingFilter.From(null, null, source: "server"), default);
        Assert.Equal(1, Assert.Single(choices.Servers).Count);
    }

    [Fact]
    public async Task List_ShowsARoundWholeWhenOneOfItsRecordingsIsTheServers()
    {
        var server = await Share(ServerMidway("s"), "Server round");
        var client = await Share(RecordingFixture.Midway("c"), "Client round");
        var ids = await fixture.Db.Recordings.OrderBy(r => r.Id).Select(r => r.Id).ToListAsync();
        fixture.Db.RecordingRoundLinks.Add(new RecordingRoundLink
        {
            RecordingId = ids[0], OtherRecordingId = ids[1], Kind = RecordingRoundLinkKind.Detected,
            OffsetSeconds = 0, CreatedAt = RecordingFixture.Start,
        });
        await fixture.Db.SaveChangesAsync();
        await fixture.Db.Recordings.ExecuteUpdateAsync(set => set.SetProperty(r => r.RoundId, ids[0]));

        var page = await fixture.Service.ListAsync(null, 1, 24, RecordingFilter.From(null, null, null, "server"), null, default);

        var card = Assert.Single(page.Items);
        Assert.NotNull(card.Round);
        Assert.Equal("server", card.Round.Single(m => m.Slug == server.Slug).Source);
        Assert.Equal("client", card.Round.Single(m => m.Slug == client.Slug).Source);
    }

    [Fact]
    public async Task FileCheck_ReadsTheSourceOfRecordingsSharedBefore()
    {
        var server = await Share(ServerMidway("s"), "Server round");
        var client = await Share(RecordingFixture.Midway("c"), "Client round");
        var gone = await Share(RecordingFixture.Midway("g"), "Gone");
        // As the migration leaves them: no source read.
        await fixture.Db.Recordings.ExecuteUpdateAsync(set => set.SetProperty(r => r.Source, RecordingSource.Unknown));
        await File.WriteAllBytesAsync(fixture.Storage.RecordingPath(gone.Slug), Encoding.UTF8.GetBytes("not gzip"));
        var reconciler = new RecordingFileReconciler(
            new ServiceCollection().AddSingleton(fixture.Db).BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            fixture.Storage, NullLogger<RecordingFileReconciler>.Instance);

        Assert.Equal(2, await reconciler.BackfillSourcesAsync(default));

        var sources = await fixture.Db.Recordings.AsNoTracking().ToDictionaryAsync(r => r.Slug, r => r.Source);
        Assert.Equal(RecordingSource.Server, sources[server.Slug]);
        Assert.Equal(RecordingSource.Client, sources[client.Slug]);
        // A file that cannot be read stays unknown, and the API says nothing for it.
        Assert.Equal(RecordingSource.Unknown, sources[gone.Slug]);
        Assert.Null((await fixture.Service.GetAsync(gone.Slug, null, default))!.Source);
        // Nothing left that can be read: a second pass reads nothing.
        Assert.Equal(0, await reconciler.BackfillSourcesAsync(default));
    }
}
