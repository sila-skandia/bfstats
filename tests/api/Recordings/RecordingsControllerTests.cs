using api.Recordings;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using NodaTime;
using NSubstitute;

namespace api.tests.Recordings;

public sealed class RecordingsControllerTests : IDisposable
{
    private const string Slug = "abcdefghjk";

    private readonly string directory = Path.Combine(Path.GetTempPath(), $"bfstats-recordings-controller-{Guid.NewGuid():N}");
    private readonly RecordingStorage storage;
    private readonly IRecordingService recordings = Substitute.For<IRecordingService>();
    private readonly RecordingsController controller;

    public RecordingsControllerTests()
    {
        storage = new RecordingStorage(Options.Create(new RecordingsOptions { Path = directory }));
        File.WriteAllBytes(storage.RecordingPath(Slug), RecordingFixture.Kept(RecordingFixture.Midway()));
        File.WriteAllBytes(storage.ServerLogPath(Slug), RecordingFixture.Kept(RecordingFixture.EventLog()));
        File.WriteAllBytes(storage.ThumbnailPath(Slug), [0xFF, 0xD8, 0xFF, 0xD9]);
        controller = new RecordingsController(
            recordings,
            Substitute.For<IRecordingUploadService>(),
            storage,
            Substitute.For<IRecordingViewCounter>(),
            Substitute.For<IConfiguration>(),
            Substitute.For<IRecordingRoundService>(),
            Options.Create(new RecordingsOptions()))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    /// <summary>A shared file is someone's upload served from bfstats.io: a browser sent
    /// straight to one must neither guess it is a page nor, as an XML page, run what is in it.</summary>
    [Theory]
    [InlineData("ndjson", "application/x-ndjson")]
    [InlineData("xml", "text/xml")]
    [InlineData("jpg", "image/jpeg")]
    public void SharedFiles_AreServedInert(string kind, string contentType)
    {
        var result = kind switch
        {
            "ndjson" => controller.RecordingFile(Slug),
            "xml" => controller.ServerLogFile(Slug),
            _ => controller.Thumbnail(Slug),
        };

        var file = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal(contentType, file.ContentType);
        var headers = controller.Response.Headers;
        Assert.Equal("nosniff", headers.XContentTypeOptions.ToString());
        Assert.Equal("default-src 'none'; sandbox", headers.ContentSecurityPolicy.ToString());
    }

    /// <summary>The short link (features/replay-feed, "Short links") goes on to the replay the
    /// feed's long link opened, at its moment, and tells an unfurl what the recording is.</summary>
    [Fact]
    public async Task ShortLink_GoesOnToTheReplay_AndTellsAnUnfurlWhatItIs()
    {
        recordings.GetAsync(Slug, null, Arg.Any<CancellationToken>()).Returns(Detail(
            title: "Bocage <b>\"rush\"</b> & more",
            thumbnailUrl: "/stats/recordings/abcdefghjk.jpg?v=5"));

        var result = await controller.ShortLink("ABCDEFGHJK", "95", CancellationToken.None);

        Assert.Null(result.StatusCode);
        Assert.Equal("text/html; charset=utf-8", result.ContentType);
        var html = result.Content!;
        Assert.Contains(
            "<meta http-equiv=\"refresh\" content=\"0; url=/map.html?mod=bf1942&amp;map=bocage"
            + "&amp;replay=/stats/recordings/abcdefghjk.ndjson&amp;serverlog=/stats/recordings/abcdefghjk.xml&amp;t=95\">",
            html);
        Assert.Contains("<meta property=\"og:url\" content=\"https://play.bfstats.io/replay/abcdefghjk\">", html);
        Assert.Contains(
            "<meta property=\"og:image\" content=\"https://play.bfstats.io/stats/recordings/abcdefghjk.jpg?v=5\">", html);
        Assert.Contains("<meta name=\"twitter:card\" content=\"summary_large_image\">", html);
        Assert.Contains(
            "<meta property=\"og:description\" content=\"Bocage · Conquest · 14:43 · MoonGamers.com · shared by skandia\">",
            html);
        // A title is the uploader's free text: markup in it is text.
        Assert.DoesNotContain("<b>", html);
        Assert.Contains("<title>Bocage &lt;b&gt;&quot;rush&quot;&lt;/b&gt; &amp; more · BF1942 replay</title>", html);
        Assert.Equal("nosniff", controller.Response.Headers.XContentTypeOptions.ToString());
        Assert.StartsWith("default-src 'none'", controller.Response.Headers.ContentSecurityPolicy.ToString());
    }

    /// <summary>A recording with no cover of its own shows its round's; with none at all, the
    /// unfurl is text.</summary>
    [Fact]
    public void ShortLink_CoverIsTheRoundsWhenTheRecordingHasNone()
    {
        RecordingRoundMemberDto member = new(
            "bbbbbbbbbb", "Other side", "Rut", null, "Rut", 600, 60, "/stats/recordings/bbbbbbbbbb.ndjson", null,
            "/stats/recordings/bbbbbbbbbb.jpg?v=2", "detected", 30, 1.0);

        var withRound = RecordingShortLink.Page(Detail(round: [member]), "https://play.bfstats.io", null);
        var bare = RecordingShortLink.Page(Detail(serverLogUrl: null), "https://play.bfstats.io", null);

        Assert.Contains("content=\"https://play.bfstats.io/stats/recordings/bbbbbbbbbb.jpg?v=2\"", withRound);
        Assert.DoesNotContain("og:image", bare);
        Assert.Contains("<meta name=\"twitter:card\" content=\"summary\">", bare);
        Assert.Contains("url=/map.html?mod=bf1942&amp;map=bocage&amp;replay=/stats/recordings/abcdefghjk.ndjson\"", bare);
    }

    [Theory]
    [InlineData("abcdefghjk", false)]
    [InlineData("abc", true)]
    [InlineData("abcdefghj0", true)]
    public async Task ShortLink_ToNoRecording_IsANotFoundPage(string slug, bool malformed)
    {
        recordings.GetAsync(Slug, null, Arg.Any<CancellationToken>()).Returns((RecordingDetailDto?)null);

        var result = await controller.ShortLink(slug, null, CancellationToken.None);

        Assert.Equal(StatusCodes.Status404NotFound, result.StatusCode);
        Assert.Equal("text/html; charset=utf-8", result.ContentType);
        Assert.Contains("/play/?tab=replay", result.Content);
        if (malformed) await recordings.DidNotReceiveWithAnyArgs().GetAsync(default!, default, default);
    }

    [Theory]
    [InlineData("95", 95)]
    [InlineData("0", 0)]
    [InlineData(null, null)]
    [InlineData("", null)]
    [InlineData("-1", null)]
    [InlineData("1:35", null)]
    [InlineData("1e3", null)]
    [InlineData("9999999", null)]
    public void ShortLink_MomentIsWholeSeconds(string? t, int? expected) =>
        Assert.Equal(expected, RecordingShortLink.Moment(t));

    [Theory]
    [InlineData(0, "0:00")]
    [InlineData(59.9, "0:59")]
    [InlineData(883.029, "14:43")]
    [InlineData(3723, "1:02:03")]
    public void ShortLink_LengthIsSaidAsTheFeedSaysIt(double seconds, string expected) =>
        Assert.Equal(expected, RecordingShortLink.Clock(seconds));

    private static RecordingDetailDto Detail(
        string title = "Bocage on MoonGamers.com",
        string? serverLogUrl = "/stats/recordings/abcdefghjk.xml",
        string? thumbnailUrl = null,
        IReadOnlyList<RecordingRoundMemberDto>? round = null) => new(
        Slug, title, "skandia", "bocage", "bf1942", "conquest", "MoonGamers.com", "2026-09-28T20:00:00", "skandia",
        883.029, ["skandia", "Rut"], 5, 1_000_000, 22_000_000, 3, 1, Instant.FromUnixTimeSeconds(1_790_000_000),
        "/stats/recordings/abcdefghjk.ndjson", serverLogUrl, thumbnailUrl, false, null, round);
}
