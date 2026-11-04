using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using api.Authorization;
using api.PlayerTracking;
using api.Recordings;
using api.Shorts;
using api.Recordings.Models;
using api.Shorts.Models;
using api.tests.Recordings;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace api.tests.Shorts;

/// <summary>
/// Replay Shorts' API (features/replay-shorts) through its controller, over an in-memory
/// database and a throwaway recordings directory.
/// </summary>
public sealed class ShortsControllerTests : IDisposable
{
    private const string UploadKey = "render-job-key";
    private const string RecordingSlug = "abcdefghjk";

    private static readonly byte[] Mp4 = [0, 0, 0, 0x18, (byte)'f', (byte)'t', (byte)'y', (byte)'p', (byte)'i', (byte)'s', (byte)'o', (byte)'m', 1, 2, 3, 4];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 9, 9, 0xFF, 0xD9];

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext db;
    private readonly string directory = Path.Combine(Path.GetTempPath(), $"bfstats-shorts-test-{Guid.NewGuid():N}");
    private readonly ShortStorage storage;
    private readonly TestClock clock = new(Instant.FromUtc(2026, 11, 3, 10, 0));
    private readonly ShortService service;
    private readonly ShortViewCounter counter;

    public ShortsControllerTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
        db.Database.EnsureCreated();
        var recordingOptions = MsOptions.Create(new RecordingsOptions { Path = directory, MinFreeBytes = 0, MinFreeFraction = 0 });
        storage = new ShortStorage(new RecordingStorage(recordingOptions));
        service = new ShortService(db, storage, clock, MsOptions.Create(new ShortsOptions { UploadKey = UploadKey }),
            NullLogger<ShortService>.Instance);
        counter = new ShortViewCounter(
            new ServiceCollection().AddSingleton(db).BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
            clock, recordingOptions, NullLogger<ShortViewCounter>.Instance);
    }

    public void Dispose()
    {
        counter.Dispose();
        db.Dispose();
        connection.Dispose();
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private ShortsController Controller(string? key = null, ClaimsPrincipal? user = null, string configuredKey = UploadKey)
    {
        var context = new DefaultHttpContext();
        if (key is not null) context.Request.Headers[ShortsController.KeyHeader] = key;
        if (user is not null) context.User = user;
        var services = new ServiceCollection().AddLogging()
            .AddSingleton<IActionResultExecutor<PhysicalFileResult>, PhysicalFileResultExecutor>()
            .BuildServiceProvider();
        context.RequestServices = services;
        return new ShortsController(
            service, storage, counter, new ConfigurationBuilder().Build(),
            MsOptions.Create(new ShortsOptions { UploadKey = configuredKey }),
            MsOptions.Create(new RecordingsOptions()))
        {
            ControllerContext = new ControllerContext { HttpContext = context },
        };
    }

    private static ClaimsPrincipal User(bool admin) => new(new ClaimsIdentity(
        [new Claim(ClaimTypes.NameIdentifier, "7"), .. admin ? [new Claim(ClaimTypes.Role, AppRoles.Admin)] : Array.Empty<Claim>()],
        "test"));

    private static object Meta(double killTime = 132.456, int victimPid = 4, string kind = ShortKinds.AirToAir, string title = "Mustang downs BF109") => new
    {
        recordingSlug = RecordingSlug,
        killTime,
        victimPid,
        kind,
        title,
        killer = "skandia",
        victim = "Rut",
        weapon = "M2",
        killerVehicle = "P51",
        victimVehicle = (string?)null,
        distance = 412.3,
        lengthSeconds = 12.5,
        level = "midway",
        mod = "bf1942",
    };

    private static async Task Body(ShortsController controller, object meta, byte[]? video = null, byte[]? poster = null)
    {
        var content = new MultipartFormDataContent();
        content.Add(new StringContent(JsonSerializer.Serialize(meta), Encoding.UTF8, "application/json"), "meta");
        var v = new ByteArrayContent(video ?? Mp4);
        v.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
        content.Add(v, "video", "short.mp4");
        var p = new ByteArrayContent(poster ?? Jpeg);
        p.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        content.Add(p, "poster", "short.jpg");
        var bytes = await content.ReadAsByteArrayAsync();
        var request = controller.HttpContext.Request;
        request.ContentType = content.Headers.ContentType!.ToString();
        request.ContentLength = bytes.Length;
        request.Body = new MemoryStream(bytes);
    }

    private async Task<ShortDto> UploadAsync(object? meta = null)
    {
        var controller = Controller(UploadKey);
        await Body(controller, meta ?? Meta());
        var result = await controller.Upload(default);
        var created = Assert.IsType<CreatedAtActionResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        return Assert.IsType<ShortDto>(created.Value);
    }

    private string[] ShortFiles() =>
        Directory.Exists(storage.Directory) ? Directory.GetFiles(storage.Directory) : [];

    [Fact]
    public async Task Upload_WithTheKey_CreatesTheRowAndBothFiles()
    {
        var dto = await UploadAsync();

        Assert.Equal($"{RecordingSlug}:132.46:4", dto.Key);
        Assert.Equal($"/stats/shorts/{dto.Slug}.mp4", dto.VideoUrl);
        Assert.Equal($"/stats/shorts/{dto.Slug}.jpg", dto.PosterUrl);
        Assert.Equal("P51", dto.KillerVehicle);
        Assert.Null(dto.VictimVehicle);
        Assert.Equal(Mp4, await File.ReadAllBytesAsync(storage.VideoPath(dto.Slug)));
        Assert.Equal(Jpeg, await File.ReadAllBytesAsync(storage.PosterPath(dto.Slug)));
        var row = await db.ReplayShorts.SingleAsync();
        Assert.Equal(Mp4.Length, row.VideoBytes);
        Assert.Equal(clock.Now, row.CreatedAt);
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Theory]
    [InlineData("render-job-key", "render-job-key\n", true)]
    [InlineData("render-job-key", "  render-job-key \r\n", true)]
    [InlineData("render-job-key", "render-job-kez\n", false)]
    [InlineData("render-job-key", "\n", false)]
    public void Key_IgnoresWhitespaceRoundTheConfiguredKey(string sent, string configured, bool matches) =>
        Assert.Equal(matches, ShortsController.KeyMatches(sent, configured));

    [Fact]
    public async Task Upload_AnOwnGoal_IsTaken()
    {
        var dto = await UploadAsync(Meta(kind: ShortKinds.OwnGoal, title: "Spitfire pilot crashes on Battle of Britain"));

        Assert.Equal("own-goal", dto.Kind);
    }

    [Fact]
    public async Task Upload_TheSameKillAgain_IsTheShortThere_AndWritesNothing()
    {
        var first = await UploadAsync();
        var before = ShortFiles().Select(f => (f, File.GetLastWriteTimeUtc(f))).ToList();

        var controller = Controller(UploadKey);
        await Body(controller, Meta(title: "Another title"));
        var ok = Assert.IsType<OkObjectResult>((await controller.Upload(default)).Result);
        var again = Assert.IsType<ShortDto>(ok.Value);

        Assert.Equal(first.Slug, again.Slug);
        Assert.Equal(first.Title, again.Title);
        Assert.Equal(1, await db.ReplayShorts.CountAsync());
        Assert.Equal(before, ShortFiles().Select(f => (f, File.GetLastWriteTimeUtc(f))).ToList());
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Theory]
    [InlineData("wrong-key", UploadKey, null)]
    [InlineData(null, UploadKey, null)]
    [InlineData(UploadKey, "", null)]
    [InlineData("wrong-key", UploadKey, true)]
    public async Task Upload_WithoutTheKeyOrAnAdmin_IsRefused(string? key, string configured, bool? admin)
    {
        var controller = Controller(key, admin is null ? null : User(admin.Value), configured);
        await Body(controller, Meta());

        var refused = Assert.IsType<ObjectResult>((await controller.Upload(default)).Result);

        Assert.Equal(StatusCodes.Status401Unauthorized, refused.StatusCode);
        Assert.Equal(0, await db.ReplayShorts.CountAsync());
        Assert.Empty(ShortFiles());
    }

    [Fact]
    public async Task Upload_BySignedInNonAdmin_IsForbidden_ByAdmin_IsTaken()
    {
        var user = Controller(user: User(admin: false));
        await Body(user, Meta());
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>((await user.Upload(default)).Result).StatusCode);

        var admin = Controller(user: User(admin: true), configuredKey: "");
        await Body(admin, Meta());
        Assert.IsType<CreatedAtActionResult>((await admin.Upload(default)).Result);
    }

    [Fact]
    public async Task Upload_NotAnMp4_OrNotAJpeg_IsRefused()
    {
        var notMp4 = Controller(UploadKey);
        await Body(notMp4, Meta(), video: Encoding.ASCII.GetBytes("<html>not a video</html>"));
        var refused = Assert.IsType<ObjectResult>((await notMp4.Upload(default)).Result);
        Assert.Equal(StatusCodes.Status400BadRequest, refused.StatusCode);

        var notJpeg = Controller(UploadKey);
        await Body(notJpeg, Meta(), poster: [0x89, (byte)'P', (byte)'N', (byte)'G']);
        Assert.Equal(StatusCodes.Status400BadRequest, Assert.IsType<ObjectResult>((await notJpeg.Upload(default)).Result).StatusCode);

        Assert.Equal(0, await db.ReplayShorts.CountAsync());
        Assert.Empty(ShortFiles());
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Theory]
    [InlineData("kind")]
    [InlineData("title")]
    [InlineData("killTime")]
    [InlineData("length")]
    [InlineData("slug")]
    public async Task Upload_BadMeta_IsRefused(string what)
    {
        object meta = what switch
        {
            "kind" => Meta(kind: "car-to-car"),
            "title" => Meta(title: "   "),
            "killTime" => Meta(killTime: -1),
            "length" => new { recordingSlug = RecordingSlug, killTime = 1.0, victimPid = 1, kind = "other", title = "t", lengthSeconds = 500.0 },
            _ => new { recordingSlug = "short", killTime = 1.0, victimPid = 1, kind = "other", title = "t", lengthSeconds = 10.0 },
        };
        var controller = Controller(UploadKey);
        await Body(controller, meta);

        var refused = Assert.IsType<ObjectResult>((await controller.Upload(default)).Result);

        Assert.Equal(StatusCodes.Status400BadRequest, refused.StatusCode);
        Assert.Equal(0, await db.ReplayShorts.CountAsync());
    }

    [Fact]
    public async Task List_PagesNewestFirst_KeepsToTheWindow_AndSortsByViews()
    {
        var made = new List<ShortDto>();
        for (var i = 0; i < 5; i++)
        {
            made.Add(await UploadAsync(Meta(killTime: i, victimPid: i)));
            clock.Now += Duration.FromDays(1);
        }
        // The first is now five days old, the last one day.
        await db.ReplayShorts.Where(s => s.Slug == made[1].Slug).ExecuteUpdateAsync(set => set.SetProperty(s => s.Views, 9));

        var page1 = Value<PagedShortsDto>(await Controller().List(7, null, 1, 2, default));
        Assert.Equal(5, page1.Total);
        Assert.Equal([made[4].Slug, made[3].Slug], page1.Items.Select(s => s.Slug));
        var page3 = Value<PagedShortsDto>(await Controller().List(7, "new", 3, 2, default));
        Assert.Equal([made[0].Slug], page3.Items.Select(s => s.Slug));

        var recent = Value<PagedShortsDto>(await Controller().List(3, null, 1, 24, default));
        Assert.Equal(3, recent.Total);
        Assert.Equal([made[4].Slug, made[3].Slug, made[2].Slug], recent.Items.Select(s => s.Slug));

        var watched = Value<PagedShortsDto>(await Controller().List(7, "views", 1, 24, default));
        Assert.Equal([made[1].Slug, made[4].Slug, made[3].Slug, made[2].Slug, made[0].Slug], watched.Items.Select(s => s.Slug));

        var capped = Value<PagedShortsDto>(await Controller().List(500, null, 1, 1000, default));
        Assert.Equal(48, capped.PageSize);
    }

    [Fact]
    public async Task List_FiltersByKind_PagingTheFilteredSet()
    {
        var air = await UploadAsync(Meta(killTime: 1, victimPid: 1, kind: ShortKinds.AirToAir));
        clock.Now += Duration.FromMinutes(1);
        var tank = await UploadAsync(Meta(killTime: 2, victimPid: 2, kind: ShortKinds.TankToTank));
        clock.Now += Duration.FromMinutes(1);
        var aa = await UploadAsync(Meta(killTime: 3, victimPid: 3, kind: ShortKinds.GroundToAir));

        var one = Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, ShortKinds.TankToTank, default));
        Assert.Equal(1, one.Total);
        Assert.Equal([tank.Slug], one.Items.Select(s => s.Slug));

        // Several kinds, spaces and an unknown one among them.
        var two = Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, " air-to-air, ground-to-air,bogus", default));
        Assert.Equal(2, two.Total);
        Assert.Equal([aa.Slug, air.Slug], two.Items.Select(s => s.Slug));

        // Naming no known kind is none, not all.
        var none = Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, "bogus", default));
        Assert.Equal(0, none.Total);
        var all = Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, "", default));
        Assert.Equal(3, all.Total);
    }

    [Fact]
    public async Task Players_AreTheKillerAndEveryVictim_AndFilterTheList()
    {
        // A single kill: its killer and victim.
        var single = await UploadAsync(Meta(killTime: 1, victimPid: 1));
        clock.Now += Duration.FromMinutes(1);
        // A compilation: one killer, many victims (a repeat and a blank among them).
        var reel = await UploadAsync(new
        {
            recordingSlug = RecordingSlug, killTime = 2.0, victimPid = -1006, kind = ShortKinds.TankToTank,
            title = "skandia: 5 vehicle kills on Midway", killer = "skandia", victim = "", weapon = "",
            distance = 0.0, lengthSeconds = 40.0, level = "midway", mod = "bf1942",
            victims = new[] { "Kerem", "Rut", "Kerem", " " },
        });
        clock.Now += Duration.FromMinutes(1);
        var other = await UploadAsync(new
        {
            recordingSlug = RecordingSlug, killTime = 3.0, victimPid = 3, kind = ShortKinds.LongShot,
            title = "212 m K98 shot on Midway", killer = "Kerem", victim = "aist", weapon = "K98",
            distance = 212.0, lengthSeconds = 9.0, level = "midway", mod = "bf1942",
        });

        var rows = await db.ReplayShortPlayers.Where(p => p.ShortId == db.ReplayShorts.Single(s => s.Slug == reel.Slug).Id)
            .OrderBy(p => p.Id).Select(p => p.Role + ":" + p.Name).ToListAsync();
        Assert.Equal(["killer:skandia", "victim:Kerem", "victim:Rut"], rows);

        // Rut: the single kill's victim and one of the compilation's.
        var rut = Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, null, "Rut", default));
        Assert.Equal([reel.Slug, single.Slug], rut.Items.Select(s => s.Slug));
        // Kerem: a victim in the compilation, the killer of the long shot; with a kind, only that.
        var kerem = Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, ShortKinds.LongShot, "Kerem", default));
        Assert.Equal([other.Slug], kerem.Items.Select(s => s.Slug));
        Assert.Equal(0, Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, null, "nobody", default)).Total);

        // Killers first, then the most featured.
        var players = Value<ShortPlayersDto>(await Controller().Players(7, default));
        Assert.Equal(
            [("skandia", 2, 2), ("Kerem", 2, 1), ("Rut", 2, 0), ("aist", 1, 0)],
            players.Items.Select(p => (p.Name, p.Shorts, p.AsKiller)));
    }

    private async Task<ActionResult<ShortDto>> ShareAsync(object meta, ClaimsPrincipal user)
    {
        var controller = Controller(user: user);
        await Body(controller, meta);
        return await controller.Share(default);
    }

    private static object ShareMeta(string recordingSlug = RecordingSlug) => new
    {
        recordingSlug, killTime = 40.5, victimPid = 3, kind = ShortKinds.AirToAir, title = "My best dogfight",
        killer = "skandia", victim = "Rut", weapon = "M2", distance = 120.0, lengthSeconds = 14.0, level = "midway", mod = "bf1942",
    };

    [Fact]
    public async Task Share_IsAPlayersClip_LiveUnderHisLinkedName_AndHisToTakeDown()
    {
        db.Users.Add(new User { Id = 7, Email = "creator@example.com" });
        db.Users.Add(new User { Id = 8, Email = "other@example.com" });
        db.Recordings.Add(new Recording { Slug = RecordingSlug, UploaderUserId = 8 });
        await db.SaveChangesAsync();

        // No linked in-game name: nothing to credit him under.
        var unlinked = Assert.IsType<ObjectResult>((await ShareAsync(ShareMeta(), User(false))).Result);
        Assert.Equal(StatusCodes.Status400BadRequest, unlinked.StatusCode);

        db.UserPlayerNames.Add(new UserPlayerName { UserId = 7, PlayerName = "skandia", CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        // A round that is not shared.
        var missing = Assert.IsType<ObjectResult>((await ShareAsync(ShareMeta("zzzzzzzzzz"), User(false))).Result);
        Assert.Equal(StatusCodes.Status404NotFound, missing.StatusCode);

        var created = Assert.IsType<CreatedAtActionResult>((await ShareAsync(ShareMeta(), User(false))).Result);
        var dto = Assert.IsType<ShortDto>(created.Value);
        Assert.Equal((ShortKinds.Creator, "skandia", "My best dogfight"), (dto.Kind, dto.CreatorName, dto.Title));
        // Twice is two Shorts: a creator's clips are his own, not one a kill.
        Assert.IsType<CreatedAtActionResult>((await ShareAsync(ShareMeta(), User(false))).Result);
        Assert.Equal(2, await db.ReplayShorts.CountAsync(s => s.Kind == ShortKinds.Creator));
        Assert.Contains(await db.ReplayShortPlayers.Select(p => p.Role + ":" + p.Name).ToListAsync(), r => r == "creator:skandia");

        // Not signed in: 401. Someone else signed in cannot take it down; he can.
        var anonymous = Controller();
        await Body(anonymous, ShareMeta());
        Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<ObjectResult>((await anonymous.Share(default)).Result).StatusCode);
        var other = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "8")], "test"));
        Assert.Equal(StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>(await Controller(user: other).Delete(dto.Slug, default)).StatusCode);
        Assert.IsType<NoContentResult>(await Controller(user: User(false)).Delete(dto.Slug, default));
    }

    [Fact]
    public async Task Keys_AreTheKillsClippedFromThatRecording()
    {
        var a = await UploadAsync(Meta(killTime: 10, victimPid: 1));
        var b = await UploadAsync(Meta(killTime: 5.5, victimPid: 2));

        var keys = Value<ShortKeysDto>(await Controller().Keys(RecordingSlug, default));
        Assert.Equal([b.Key, a.Key], keys.Keys);
        Assert.Equal($"{RecordingSlug}:5.50:2", b.Key);
        Assert.Empty(Value<ShortKeysDto>(await Controller().Keys("zzzzzzzzzz", default)).Keys);
        Assert.Empty(Value<ShortKeysDto>(await Controller().Keys(null, default)).Keys);
    }

    [Fact]
    public async Task Get_IsTheShort_OrNotFound()
    {
        var dto = await UploadAsync();
        Assert.Equal(dto.Key, Value<ShortDto>(await Controller().Get(dto.Slug, default)).Key);
        Assert.IsType<NotFoundResult>((await Controller().Get("zzzzzzzzzz", default)).Result);
    }

    [Fact]
    public async Task Video_IsServedWithRanges_AndCachedForGood()
    {
        var dto = await UploadAsync();
        var controller = Controller();
        controller.HttpContext.Request.Method = "GET";
        controller.HttpContext.Request.Headers.Range = "bytes=4-7";
        var body = new MemoryStream();
        controller.HttpContext.Response.Body = body;

        var result = Assert.IsType<PhysicalFileResult>(controller.Video(dto.Slug));
        Assert.True(result.EnableRangeProcessing);
        Assert.Equal("video/mp4", result.ContentType);
        await result.ExecuteResultAsync(controller.ControllerContext);

        Assert.Equal(StatusCodes.Status206PartialContent, controller.HttpContext.Response.StatusCode);
        Assert.Equal("ftyp"u8.ToArray(), body.ToArray());
        Assert.Contains("immutable", controller.HttpContext.Response.Headers.CacheControl.ToString());

        var poster = Assert.IsType<PhysicalFileResult>(Controller().Poster(dto.Slug));
        Assert.Equal("image/jpeg", poster.ContentType);
        Assert.IsType<NotFoundResult>(Controller().Video("zzzzzzzzzz"));
    }

    [Fact]
    public async Task Views_CountOncePerViewerPerWindow()
    {
        var dto = await UploadAsync();
        Assert.Equal(0, Value<ShortViewsDto>(await Controller().View(dto.Slug, default)).Views);
        var id = (await db.ReplayShorts.SingleAsync()).Id;

        Assert.Equal(2, await counter.FlushAsync([(id, "a:1"), (id, "a:1"), (id, "u:7")], default));
        clock.Now += Duration.FromHours(1);
        Assert.Equal(0, await counter.FlushAsync([(id, "a:1")], default));
        clock.Now += Duration.FromHours(6);
        Assert.Equal(1, await counter.FlushAsync([(id, "a:1"), (id + 99, "a:1")], default));

        db.ChangeTracker.Clear();
        Assert.Equal(3, Value<ShortViewsDto>(await Controller().View(dto.Slug, default)).Views);
        Assert.IsType<NotFoundResult>((await Controller().View("zzzzzzzzzz", default)).Result);
    }

    [Fact]
    public async Task Delete_TakesTheRowAndFiles_ForTheKeyOrAnAdminOnly()
    {
        var dto = await UploadAsync();

        Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<ObjectResult>(await Controller().Delete(dto.Slug, default)).StatusCode);
        Assert.Equal(StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>(await Controller(user: User(false)).Delete(dto.Slug, default)).StatusCode);
        Assert.Equal(1, await db.ReplayShorts.CountAsync());

        Assert.IsType<NoContentResult>(await Controller(UploadKey).Delete(dto.Slug, default));
        Assert.Equal(0, await db.ReplayShorts.CountAsync());
        Assert.Equal(0, await db.ReplayShortPlayers.CountAsync());
        Assert.Empty(ShortFiles());
        Assert.IsType<NotFoundResult>(await Controller(user: User(true)).Delete(dto.Slug, default));
    }

    [Fact]
    public async Task ShareLink_GoesOnToThePlayer_AndGivesAnUnfurlTheVideo()
    {
        var dto = await UploadAsync(Meta(title: "Mustang <b>downs</b> BF109"));
        var controller = Controller();

        var result = Assert.IsType<ContentResult>(await controller.ShareLink(dto.Slug.ToUpperInvariant(), default));

        Assert.Null(result.StatusCode);
        Assert.Equal("text/html; charset=utf-8", result.ContentType);
        var html = result.Content!;
        var video = $"https://play.bfstats.io/stats/shorts/{dto.Slug}.mp4";
        Assert.Contains($"<meta http-equiv=\"refresh\" content=\"0; url=https://play.bfstats.io/play/?tab=replay&amp;short={dto.Slug}\">", html);
        Assert.Contains($"<meta property=\"og:url\" content=\"https://replay.bfstats.io/s/{dto.Slug}\">", html);
        Assert.Contains("<meta property=\"og:type\" content=\"video.other\">", html);
        Assert.Contains($"<meta property=\"og:video\" content=\"{video}\">", html);
        Assert.Contains($"<meta property=\"og:video:secure_url\" content=\"{video}\">", html);
        Assert.Contains("<meta property=\"og:video:type\" content=\"video/mp4\">", html);
        Assert.Contains("<meta property=\"og:video:width\" content=\"1080\">", html);
        Assert.Contains("<meta property=\"og:video:height\" content=\"1920\">", html);
        Assert.Contains($"<meta property=\"og:image\" content=\"https://play.bfstats.io/stats/shorts/{dto.Slug}.jpg\">", html);
        Assert.Contains("<meta name=\"twitter:card\" content=\"player\">", html);
        Assert.Contains("<meta property=\"og:description\" content=\"skandia → Rut · M2 · 412 m · Midway\">", html);
        // A title is free text: markup in it is text.
        Assert.DoesNotContain("<b>", html);
        Assert.Equal("nosniff", controller.Response.Headers.XContentTypeOptions.ToString());
        Assert.StartsWith("default-src 'none'", controller.Response.Headers.ContentSecurityPolicy.ToString());
    }

    [Theory]
    [InlineData("abcdefghjk")]
    [InlineData("abc")]
    public async Task ShareLink_ToNoShort_GoesOnToTheReplays_ToSayItIsGone(string slug)
    {
        var controller = Controller();
        var result = Assert.IsType<RedirectResult>(await controller.ShareLink(slug, default));

        Assert.EndsWith("/play/index.html?tab=replay&gone=1", result.Url);
        Assert.Equal("noindex", controller.Response.Headers["X-Robots-Tag"].ToString());
    }

    [Fact]
    public void Key_IsInvariantCulture()
    {
        var culture = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("de-DE");
            Assert.Equal("abcdefghjk:1.50:3", ShortKinds.Key("abcdefghjk", 1.5, 3));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = culture;
        }
    }

    private static T Value<T>(ActionResult<T> result) =>
        Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);
}
