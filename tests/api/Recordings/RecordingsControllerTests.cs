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
    private const string Play = "https://play.bfstats.io";
    private const string Link = "https://replay.bfstats.io";

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
            "<meta http-equiv=\"refresh\" content=\"0; url=https://play.bfstats.io/map.html?mod=bf1942&amp;map=bocage"
            + "&amp;replay=/stats/recordings/abcdefghjk.ndjson&amp;serverlog=/stats/recordings/abcdefghjk.xml&amp;t=95\">",
            html);
        Assert.Contains("<meta property=\"og:url\" content=\"https://replay.bfstats.io/abcdefghjk\">", html);
        Assert.Contains(
            "<meta property=\"og:image\" content=\"https://play.bfstats.io/stats/recordings/abcdefghjk.jpg?v=5\">", html);
        Assert.Contains("<meta name=\"twitter:card\" content=\"summary_large_image\">", html);
        Assert.Contains(
            "<meta property=\"og:description\" content=\"Bocage · Conquest · 14:43 · MoonGamers.com · recorded by skandia\">",
            html);
        // A title is the uploader's free text: markup in it is text.
        Assert.DoesNotContain("<b>", html);
        Assert.Contains("<title>Bocage &lt;b&gt;&quot;rush&quot;&lt;/b&gt; &amp; more · BattleView | bfstats.io</title>", html);
        Assert.Equal("nosniff", controller.Response.Headers.XContentTypeOptions.ToString());
        Assert.StartsWith("default-src 'none'", controller.Response.Headers.ContentSecurityPolicy.ToString());
    }

    /// <summary>A short link with <c>?edit=</c> (features/replay-creator-view, "Sharing an
    /// edit") names the edit and who cut it, and the replay it goes on to opens it; an edit of
    /// another recording is not this one's, and the link is the recording's own.</summary>
    [Fact]
    public async Task ShortLink_WithAnEdit_NamesIt_AndOpensIt()
    {
        recordings.GetAsync(Slug, null, Arg.Any<CancellationToken>()).Returns(Detail());
        var edits = Substitute.For<IRecordingEditService>();
        using var doc = System.Text.Json.JsonDocument.Parse("{}");
        edits.GetAsync("k3f9ab2c", Arg.Any<CancellationToken>()).Returns(new RecordingEditDto(
            "k3f9ab2c", Slug, "Mustang bomb", "skandia", "2026-11-09T08:00:00Z", doc.RootElement.Clone(),
            "https://replay.bfstats.io/abcdefghjk?edit=k3f9ab2c"));
        edits.GetAsync("zzzzzzzz", Arg.Any<CancellationToken>()).Returns(new RecordingEditDto(
            "zzzzzzzz", "otherslugx", "Not this one", "Rut", "2026-11-09T08:00:00Z", doc.RootElement.Clone(), ""));

        var html = (await controller.ShortLink(Slug, null, CancellationToken.None, "K3F9AB2C", edits)).Content!;

        Assert.Contains("&amp;edit=k3f9ab2c\">", html);
        Assert.Contains("<meta property=\"og:title\" content=\"Mustang bomb · skandia&#x27;s edit\">", html);
        Assert.Contains("<meta property=\"og:url\" content=\"https://replay.bfstats.io/abcdefghjk?edit=k3f9ab2c\">", html);
        Assert.Contains("<meta property=\"og:description\" content=\"An edit of Bocage on MoonGamers.com · Bocage", html);

        var other = (await controller.ShortLink(Slug, null, CancellationToken.None, "zzzzzzzz", edits)).Content!;
        Assert.DoesNotContain("edit=", other);
        Assert.Contains("<meta property=\"og:title\" content=\"Bocage on MoonGamers.com\">", other);
    }

    /// <summary>A recording with no cover of its own shows its round's; with none at all, the
    /// unfurl is text.</summary>
    [Fact]
    public void ShortLink_CoverIsTheRoundsWhenTheRecordingHasNone()
    {
        RecordingRoundMemberDto member = new(
            "bbbbbbbbbb", "Other side", "Rut", null, "Rut", 600, 60, "/stats/recordings/bbbbbbbbbb.ndjson", null,
            "/stats/recordings/bbbbbbbbbb.jpg?v=2", "detected", 30, 1.0);

        var withRound = RecordingShortLink.Page(Detail(round: [member]), Play, Link, null);
        var bare = RecordingShortLink.Page(Detail(serverLogUrl: null), Play, Link, null);

        Assert.Contains("content=\"https://play.bfstats.io/stats/recordings/bbbbbbbbbb.jpg?v=2\"", withRound);
        Assert.DoesNotContain("og:image", bare);
        Assert.Contains("<meta name=\"twitter:card\" content=\"summary\">", bare);
        Assert.Contains("url=https://play.bfstats.io/map.html?mod=bf1942&amp;map=bocage&amp;replay=/stats/recordings/abcdefghjk.ndjson\"", bare);
    }

    /// <summary>A recording nobody set a cover on, in a round with none, is pictured by its
    /// level's loading screen, as its card in the feed is: a link to it never previews as
    /// text alone while the level has a picture. A recording with a cover is never asked
    /// about its level.</summary>
    [Fact]
    public async Task ShortLink_WithNoCover_ShowsTheLevelsPicture()
    {
        const string art = "https://play.bfstats.io/maps/bocage/load.webp";
        var levelArt = Substitute.For<IRecordingLevelArt>();
        levelArt.UrlAsync("bf1942", "bocage", Arg.Any<CancellationToken>()).Returns(art);
        recordings.GetAsync(Slug, null, Arg.Any<CancellationToken>()).Returns(Detail());

        var bare = (await controller.ShortLink(Slug, null, CancellationToken.None, levelArt: levelArt)).Content!;

        Assert.Contains($"<meta property=\"og:image\" content=\"{art}\">", bare);
        Assert.Contains("<meta name=\"twitter:card\" content=\"summary_large_image\">", bare);

        recordings.GetAsync(Slug, null, Arg.Any<CancellationToken>())
            .Returns(Detail(thumbnailUrl: "/stats/recordings/abcdefghjk.jpg?v=5"));
        levelArt.ClearReceivedCalls();

        var covered = (await controller.ShortLink(Slug, null, CancellationToken.None, levelArt: levelArt)).Content!;

        Assert.Contains("content=\"https://play.bfstats.io/stats/recordings/abcdefghjk.jpg?v=5\"", covered);
        Assert.DoesNotContain(art, covered);
        await levelArt.DidNotReceiveWithAnyArgs().UrlAsync(default!, default!, default);
    }

    /// <summary>The preview's line names the player whose game recorded the round; whoever
    /// shared it too when that is someone else, and alone when the file names no recorder
    /// (the server's own recorder writes none).</summary>
    [Theory]
    [InlineData("skandia", "skandia", "recorded by skandia")]
    [InlineData("Rut", "skandia", "recorded by Rut · shared by skandia")]
    [InlineData(null, "skandia", "MoonGamers.com · shared by skandia")]
    [InlineData("Rut", "", "recorded by Rut")]
    public void ShortLink_SaysWhoRecordedIt(string? recordedBy, string uploader, string expected)
    {
        var line = RecordingShortLink.Description(Detail() with { RecordedBy = recordedBy!, UploaderName = uploader });

        Assert.EndsWith(expected, line, StringComparison.Ordinal);
        Assert.StartsWith("Bocage · Conquest · 14:43 · MoonGamers.com", line, StringComparison.Ordinal);
    }

    /// <summary>The cover job's frame goes in with the Shorts render job's key and nothing
    /// else: no key, a wrong one, or no key configured at all is a 401 that never reaches
    /// the recording.</summary>
    [Theory]
    [InlineData("the-key", "the-key", true)]
    [InlineData("the-key", "another", false)]
    [InlineData("the-key", "", false)]
    [InlineData("", "", false)]
    public async Task SetFilmedCover_TakesTheRenderJobsKeyOnly(string configured, string sent, bool allowed)
    {
        recordings.SetFilmedThumbnailAsync(Slug, Arg.Any<Stream>(), Arg.Any<CancellationToken>()).Returns(Detail());
        if (sent.Length > 0) controller.Request.Headers[api.Shorts.ShortsController.KeyHeader] = sent;
        var shorts = Options.Create(new api.Shorts.ShortsOptions { UploadKey = configured });

        var result = (await controller.SetFilmedCover(Slug, shorts, CancellationToken.None)).Result;

        if (allowed)
        {
            Assert.IsType<OkObjectResult>(result);
            return;
        }
        Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<ObjectResult>(result).StatusCode);
        await recordings.DidNotReceiveWithAnyArgs().SetFilmedThumbnailAsync(default!, default!, default);
    }

    /// <summary>A cover's body is an image, read by the action alone. Sent with a form's
    /// content type (curl's default), MVC's form readers would parse the bytes before the
    /// action ran and fail: a 500 on the live API, 2026-11-23.</summary>
    [Theory]
    [InlineData(nameof(RecordingsController.SetThumbnail))]
    [InlineData(nameof(RecordingsController.SetFilmedCover))]
    public void ACoversBody_IsNeverReadAsAForm(string action)
    {
        var method = typeof(RecordingsController).GetMethod(action)!;

        Assert.NotEmpty(method.GetCustomAttributes(typeof(DisableFormValueModelBindingAttribute), false));
    }

    /// <summary>A recording that has a cover keeps it: the job is told so (409).</summary>
    [Fact]
    public async Task SetFilmedCover_LeavesACoverAlone()
    {
        recordings.SetFilmedThumbnailAsync(Slug, Arg.Any<Stream>(), Arg.Any<CancellationToken>())
            .Returns<Task<RecordingDetailDto?>>(_ => throw new RecordingRejectedException("This recording already has a cover.", StatusCodes.Status409Conflict));
        controller.Request.Headers[api.Shorts.ShortsController.KeyHeader] = "the-key";

        var result = (await controller.SetFilmedCover(
            Slug, Options.Create(new api.Shorts.ShortsOptions { UploadKey = "the-key" }), CancellationToken.None)).Result;

        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsType<ObjectResult>(result).StatusCode);
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
        Assert.Contains("href=\"https://play.bfstats.io/play/?tab=replay\"", result.Content);
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
