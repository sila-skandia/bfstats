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
using Microsoft.Extensions.Logging;
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

    private ShortsController Controller(string? key = null, ClaimsPrincipal? user = null, string configuredKey = UploadKey,
        IShortService? with = null)
    {
        var context = new DefaultHttpContext();
        if (key is not null) context.Request.Headers[ShortsController.KeyHeader] = key;
        if (user is not null) context.User = user;
        var services = new ServiceCollection().AddLogging()
            .AddSingleton<IActionResultExecutor<PhysicalFileResult>, PhysicalFileResultExecutor>()
            .BuildServiceProvider();
        context.RequestServices = services;
        return new ShortsController(
            with ?? service, storage, counter, new ConfigurationBuilder().Build(),
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

    private static async Task Body(ShortsController controller, object meta, byte[]? video = null, byte[]? poster = null,
        byte[]? videoHd = null, string? videoUpload = null, string? videoHdUpload = null)
    {
        var content = new MultipartFormDataContent();
        content.Add(new StringContent(JsonSerializer.Serialize(meta), Encoding.UTF8, "application/json"), "meta");
        if (videoUpload is not null)
        {
            content.Add(new StringContent(videoUpload), "videoUpload");
        }
        else
        {
            var v = new ByteArrayContent(video ?? Mp4);
            v.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
            content.Add(v, "video", "short.mp4");
        }
        if (videoHdUpload is not null) content.Add(new StringContent(videoHdUpload), "videoHdUpload");
        if (videoHd is not null)
        {
            var hd = new ByteArrayContent(videoHd);
            hd.Headers.ContentType = new MediaTypeHeaderValue("video/mp4");
            content.Add(hd, "videoHd", "short.hd.mp4");
        }
        var p = new ByteArrayContent(poster ?? Jpeg);
        p.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        content.Add(p, "poster", "short.jpg");
        var bytes = await content.ReadAsByteArrayAsync();
        var request = controller.HttpContext.Request;
        request.ContentType = content.Headers.ContentType!.ToString();
        request.ContentLength = bytes.Length;
        request.Body = new MemoryStream(bytes);
    }

    private async Task<ShortDto> UploadAsync(object? meta = null, byte[]? videoHd = null)
    {
        var controller = Controller(UploadKey);
        await Body(controller, meta ?? Meta(), videoHd: videoHd);
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
        Assert.Equal($"/stats/shorts/{dto.Slug}.mp4?v={Mp4.Length}", dto.VideoUrl);
        Assert.Equal($"/stats/shorts/{dto.Slug}.jpg?v={Jpeg.Length}", dto.PosterUrl);
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

    [Fact]
    public async Task List_ByServer_IsTheShortsCutFromThatServersRecordings()
    {
        db.Users.Add(new User { Id = 8, Email = "uploader@example.com" });
        db.Recordings.Add(new Recording { Slug = RecordingSlug, ContentHash = "a", UploaderUserId = 8, ServerName = "-=DoF=- Battlefield 1942" });
        db.Recordings.Add(new Recording { Slug = "zzzzzzzzzz", ContentHash = "b", UploaderUserId = 8, ServerName = "Other server" });
        await db.SaveChangesAsync();
        var here = await UploadAsync(Meta(killTime: 1, victimPid: 1));
        clock.Now += Duration.FromMinutes(1);
        await UploadAsync(new
        {
            recordingSlug = "zzzzzzzzzz", killTime = 3.0, victimPid = 3, kind = ShortKinds.LongShot,
            title = "212 m K98 shot on Midway", killer = "Kerem", victim = "aist", weapon = "K98",
            distance = 212.0, lengthSeconds = 9.0, level = "midway", mod = "bf1942",
        });

        var list = Value<PagedShortsDto>(await Controller().List(3650, null, 1, 24, null, null, "-=DoF=- Battlefield 1942", default));
        Assert.Equal([here.Slug], list.Items.Select(s => s.Slug));
        Assert.Equal(0, Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, null, null, "nowhere", default)).Total);
        // A player and a server together narrow to both.
        Assert.Equal(0, Value<PagedShortsDto>(await Controller().List(7, null, 1, 24, null, "Kerem", "-=DoF=- Battlefield 1942", default)).Total);
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

    private ShortsController PosterBody(ShortsController controller, byte[] body)
    {
        controller.HttpContext.Request.Body = new MemoryStream(body);
        controller.HttpContext.Request.ContentLength = body.Length;
        return controller;
    }

    [Fact]
    public async Task SetPoster_ReplacesTheFile_AndGivesItANewLink_ForTheKeyAnAdminOrItsCreator()
    {
        db.Users.Add(new User { Id = 7, Email = "creator@example.com" });
        db.Recordings.Add(new Recording { Slug = RecordingSlug, UploaderUserId = 7 });
        db.UserPlayerNames.Add(new UserPlayerName { UserId = 7, PlayerName = "skandia", CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var shared = Assert.IsType<ShortDto>(Assert.IsType<CreatedAtActionResult>((await ShareAsync(ShareMeta(), User(false))).Result).Value);
        byte[] better = [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 0xFF, 0xD9];

        // Nobody signed in, and someone else signed in: refused, the poster as it was.
        Assert.Equal(StatusCodes.Status401Unauthorized,
            Assert.IsType<ObjectResult>((await PosterBody(Controller(), better).SetPoster(shared.Slug, default)).Result).StatusCode);
        var other = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "8")], "test"));
        Assert.Equal(StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>((await PosterBody(Controller(user: other), better).SetPoster(shared.Slug, default)).Result).StatusCode);
        Assert.Equal(Jpeg, await File.ReadAllBytesAsync(storage.PosterPath(shared.Slug)));

        // Not a JPEG: refused.
        Assert.Equal(StatusCodes.Status400BadRequest,
            Assert.IsType<ObjectResult>((await PosterBody(Controller(user: User(false)), Mp4).SetPoster(shared.Slug, default)).Result).StatusCode);

        // Its creator: the new file, and a link that is not the cached one.
        var dto = Value(await PosterBody(Controller(user: User(false)), better).SetPoster(shared.Slug, default));
        Assert.Equal(better, await File.ReadAllBytesAsync(storage.PosterPath(shared.Slug)));
        Assert.Equal($"/stats/shorts/{shared.Slug}.jpg?v={better.Length}", dto.PosterUrl);
        Assert.NotEqual(shared.PosterUrl, dto.PosterUrl);
        Assert.Equal(better.Length, (await db.ReplayShorts.AsNoTracking().SingleAsync()).PosterBytes);

        // The render job's own, by the key; none at all is a 404.
        var job = await UploadAsync();
        Assert.IsType<OkObjectResult>((await PosterBody(Controller(UploadKey), better).SetPoster(job.Slug, default)).Result);
        Assert.IsType<NotFoundResult>((await PosterBody(Controller(user: User(true)), better).SetPoster("zzzzzzzzzz", default)).Result);
    }

    /// <summary>Flattens by stamping the file, and says which it was given.</summary>
    private sealed class StampFlattener : IVideoFlattener
    {
        public List<string> Seen { get; } = [];

        public async Task<bool> FlattenAsync(string path, CancellationToken ct)
        {
            Seen.Add(path);
            await File.AppendAllTextAsync(path, "flat", ct);
            return true;
        }
    }

    [Fact]
    public async Task Share_FlattensTheVideo_TheRenderJobsUploadIsLeft_AndFlattenRewritesOneLive()
    {
        var flattener = new StampFlattener();
        var flattening = new ShortService(db, storage, clock, MsOptions.Create(new ShortsOptions { UploadKey = UploadKey }),
            NullLogger<ShortService>.Instance, flattener);
        ShortsController Using(string? key = null, ClaimsPrincipal? user = null)
        {
            var c = Controller(key, user);
            return new ShortsController(flattening, storage, counter, new ConfigurationBuilder().Build(),
                MsOptions.Create(new ShortsOptions { UploadKey = UploadKey }), MsOptions.Create(new RecordingsOptions()))
            {
                ControllerContext = c.ControllerContext,
            };
        }
        db.Users.Add(new User { Id = 7, Email = "creator@example.com" });
        db.Recordings.Add(new Recording { Slug = RecordingSlug, UploaderUserId = 7 });
        db.UserPlayerNames.Add(new UserPlayerName { UserId = 7, PlayerName = "skandia", CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();

        var job = Using(UploadKey);
        await Body(job, Meta());
        var uploaded = Assert.IsType<ShortDto>(Assert.IsType<CreatedAtActionResult>((await job.Upload(default)).Result).Value);
        Assert.Empty(flattener.Seen);
        Assert.Equal(Mp4, await File.ReadAllBytesAsync(storage.VideoPath(uploaded.Slug)));

        var share = Using(user: User(false));
        await Body(share, ShareMeta());
        var shared = Assert.IsType<ShortDto>(Assert.IsType<CreatedAtActionResult>((await share.Share(default)).Result).Value);
        Assert.Single(flattener.Seen);
        Assert.Equal(Mp4.Length + 4, new FileInfo(storage.VideoPath(shared.Slug)).Length);
        Assert.Equal($"/stats/shorts/{shared.Slug}.mp4?v={Mp4.Length + 4}", shared.VideoUrl);

        // One already live, flattened: a new link. Nobody signed in may not.
        Assert.Equal(StatusCodes.Status401Unauthorized,
            Assert.IsType<ObjectResult>((await Using().Flatten(uploaded.Slug, default)).Result).StatusCode);
        var flat = Value(await Using(UploadKey).Flatten(uploaded.Slug, default));
        Assert.Equal($"/stats/shorts/{uploaded.Slug}.mp4?v={Mp4.Length + 4}", flat.VideoUrl);
    }

    /// <summary>The top-level boxes of an MP4: type, payload start, payload length.</summary>
    private static List<(string Type, int At, int Length)> Boxes(byte[] data, int from = 0, int to = -1)
    {
        to = to < 0 ? data.Length : to;
        var boxes = new List<(string, int, int)>();
        for (var at = from; at + 8 <= to;)
        {
            var size = (int)System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(at));
            boxes.Add((Encoding.ASCII.GetString(data, at + 4, 4), at + 8, size - 8));
            at += size;
        }
        return boxes;
    }

    /// <summary>The box at <paramref name="path"/> (types, outermost first) inside
    /// <paramref name="data"/>'s top level.</summary>
    private static List<(string Type, int At, int Length)> Find(byte[] data, params string[] path)
    {
        var level = Boxes(data);
        foreach (var type in path[..^1])
        {
            var (_, at, length) = level.First(b => b.Type == type);
            level = Boxes(data, at, at + length);
        }
        return level.Where(b => b.Type == path[^1]).ToList();
    }

    /// <summary>A logger that keeps what it is told, exceptions with it.</summary>
    private sealed class Said : ILogger<Mp4Flattener>
    {
        public List<string> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Add($"{logLevel}: {formatter(state, exception)} {exception}");
    }

    private static uint U32(byte[] data, int at) => System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(data.AsSpan(at));

    [Fact]
    public async Task Flattener_RewritesAFragmentedMp4_AsOnePiece_IndexFirst_EverySampleAsItWas()
    {
        // A 1.2 s clip in the layout a browser's recorder writes: an empty moov, then
        // moof/mdat pairs (ffmpeg's frag_keyframe+empty_moov+default_base_moof), 18 video
        // frames with B-frames, 27 audio frames.
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, "share.mp4");
        File.Copy(Path.Combine(AppContext.BaseDirectory, "Shorts", "Fixtures", "fragmented.mp4"), path);
        var before = await File.ReadAllBytesAsync(path);
        var media = Boxes(before).Where(b => b.Type == "mdat").SelectMany(b => before.AsSpan(b.At, b.Length).ToArray()).ToArray();
        var said = new Said();
        var flattener = new Mp4Flattener(said);

        Assert.True(await flattener.FlattenAsync(path, default), string.Join("\n", said.Lines));
        var after = await File.ReadAllBytesAsync(path);
        Assert.Equal(["ftyp", "moov", "mdat"], Boxes(after).Select(b => b.Type));
        Assert.Empty(Find(after, "moov", "mvex"));

        // Its length in the index, not 0: the longer track's, the audio's 1.33 s (AAC pads
        // its last frame), as ffprobe reads the source.
        var mvhd = Find(after, "moov", "mvhd")[0];
        var seconds = (double)U32(after, mvhd.At + 16) / U32(after, mvhd.At + 12);
        Assert.Equal(1.333, seconds, 3);

        // Every sample, in the order it came, in the one mdat.
        var mdat = Boxes(after).Single(b => b.Type == "mdat");
        Assert.Equal(media, after.AsSpan(mdat.At, mdat.Length).ToArray());

        var counts = new List<uint>();
        foreach (var trak in Find(after, "moov", "trak"))
        {
            var level = Boxes(after, trak.At, trak.At + trak.Length);
            var mdia = level.First(b => b.Type == "mdia");
            var minf = Boxes(after, mdia.At, mdia.At + mdia.Length).First(b => b.Type == "minf");
            var stbl = Boxes(after, minf.At, minf.At + minf.Length).First(b => b.Type == "stbl");
            var tables = Boxes(after, stbl.At, stbl.At + stbl.Length).ToDictionary(b => b.Type);
            var stsz = tables["stsz"];
            counts.Add(U32(after, stsz.At + 8));
            // Each chunk starts inside the mdat.
            var stco = tables["stco"];
            for (var i = 0; i < U32(after, stco.At + 4); i++)
            {
                Assert.InRange(U32(after, stco.At + 8 + i * 4), (uint)mdat.At, (uint)(mdat.At + mdat.Length - 1));
            }
            Assert.True(tables.ContainsKey("stts"));
            Assert.True(tables.ContainsKey("stsc"));
        }
        Assert.Equal([18u, 27u], counts.Order());

        // Flat already: left alone.
        Assert.False(await flattener.FlattenAsync(path, default));
        Assert.Equal(after, await File.ReadAllBytesAsync(path));
    }

    [Fact]
    public async Task Flattener_KeepsATrackThatStartsLate_AsAnEditList()
    {
        // Safari's video starts a few hundredths of a second after its audio: its first
        // fragment's tfdt is past 0. The fixture's video fragments moved 0.1 s on (1536 at
        // 15360 a second) stand in for it.
        Directory.CreateDirectory(directory);
        var data = await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory, "Shorts", "Fixtures", "fragmented.mp4"));
        const uint videoTrack = 1;
        foreach (var moof in Boxes(data).Where(b => b.Type == "moof"))
        {
            foreach (var traf in Boxes(data, moof.At, moof.At + moof.Length).Where(b => b.Type == "traf"))
            {
                var inner = Boxes(data, traf.At, traf.At + traf.Length);
                if (U32(data, inner.First(b => b.Type == "tfhd").At + 4) != videoTrack) continue;
                var tfdt = inner.First(b => b.Type == "tfdt");
                if (data[tfdt.At] == 1)
                {
                    var v = System.Buffers.Binary.BinaryPrimitives.ReadUInt64BigEndian(data.AsSpan(tfdt.At + 4));
                    System.Buffers.Binary.BinaryPrimitives.WriteUInt64BigEndian(data.AsSpan(tfdt.At + 4), v + 1536);
                }
                else
                {
                    System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(tfdt.At + 4), U32(data, tfdt.At + 4) + 1536);
                }
            }
        }
        var path = Path.Combine(directory, "late.mp4");
        await File.WriteAllBytesAsync(path, data);

        Assert.True(await new Mp4Flattener(NullLogger<Mp4Flattener>.Instance).FlattenAsync(path, default));
        var after = await File.ReadAllBytesAsync(path);
        var mvhd = Find(after, "moov", "mvhd")[0];
        var movieScale = U32(after, mvhd.At + 12);
        var traks = Find(after, "moov", "trak");
        var withEdits = traks.Where(t => Boxes(after, t.At, t.At + t.Length).Any(b => b.Type == "edts")).ToList();
        var video = Assert.Single(withEdits);
        Assert.Equal(videoTrack, U32(after, Boxes(after, video.At, video.At + video.Length).First(b => b.Type == "tkhd").At + 12));
        var edts = Boxes(after, video.At, video.At + video.Length).First(b => b.Type == "edts");
        var elst = Boxes(after, edts.At, edts.At + edts.Length).Single(b => b.Type == "elst");
        // Two edits: 0.1 s of nothing (media time -1), then the track from its start.
        Assert.Equal(2u, U32(after, elst.At + 4));
        Assert.Equal(movieScale / 10, U32(after, elst.At + 8));
        Assert.Equal(uint.MaxValue, U32(after, elst.At + 12));
        Assert.Equal(0u, U32(after, elst.At + 24));
    }

    [Fact]
    public async Task Flattener_LeavesAPlainOrBrokenFile_AsItCame()
    {
        Directory.CreateDirectory(directory);
        var flattener = new Mp4Flattener(NullLogger<Mp4Flattener>.Instance);
        var plain = Path.Combine(directory, "plain.mp4");
        await File.WriteAllBytesAsync(plain, Mp4);
        Assert.False(await flattener.FlattenAsync(plain, default));
        Assert.Equal(Mp4, await File.ReadAllBytesAsync(plain));

        // A fragmented file cut off half way through its media.
        var fixture = await File.ReadAllBytesAsync(Path.Combine(AppContext.BaseDirectory, "Shorts", "Fixtures", "fragmented.mp4"));
        var cut = fixture[..(fixture.Length / 2)];
        var broken = Path.Combine(directory, "broken.mp4");
        await File.WriteAllBytesAsync(broken, cut);
        Assert.False(await flattener.FlattenAsync(broken, default));
        Assert.Equal(cut, await File.ReadAllBytesAsync(broken));
        Assert.Single(Directory.GetFiles(directory, "broken*"));
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
        var video = $"https://play.bfstats.io/stats/shorts/{dto.Slug}.mp4?v={Mp4.Length}";
        Assert.Contains($"<meta http-equiv=\"refresh\" content=\"0; url=https://play.bfstats.io/play/?tab=replay&amp;short={dto.Slug}\">", html);
        Assert.Contains($"<meta property=\"og:url\" content=\"https://replay.bfstats.io/s/{dto.Slug}\">", html);
        Assert.Contains("<meta property=\"og:type\" content=\"video.other\">", html);
        Assert.Contains($"<meta property=\"og:video\" content=\"{video}\">", html);
        Assert.Contains($"<meta property=\"og:video:secure_url\" content=\"{video}\">", html);
        Assert.Contains("<meta property=\"og:video:type\" content=\"video/mp4\">", html);
        Assert.Contains("<meta property=\"og:video:width\" content=\"1080\">", html);
        Assert.Contains("<meta property=\"og:video:height\" content=\"1920\">", html);
        Assert.Contains($"<meta property=\"og:image\" content=\"https://play.bfstats.io/stats/shorts/{dto.Slug}.jpg?v={Jpeg.Length}\">", html);
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

    /// <summary>An MP4 head padded to <paramref name="bytes"/>.</summary>
    private static byte[] Mp4Of(int bytes)
    {
        var file = new byte[bytes];
        Mp4.CopyTo(file, 0);
        return file;
    }

    [Fact]
    public async Task Upload_WithAnHdCopy_ServesIt_AndLinksIt_ARollIsLandscape()
    {
        var plain = await UploadAsync();
        Assert.Null(plain.HdVideoUrl);
        Assert.False(plain.Landscape);
        Assert.IsType<NotFoundResult>(Controller().HdVideo(plain.Slug));

        var hd = Mp4Of(40);
        var roll = await UploadAsync(Meta(killTime: 61.5, victimPid: 3, kind: ShortKinds.Roll, title: "Bocage, 60 s"), hd);

        Assert.Equal($"{RecordingSlug}:61.50:-10", roll.Key);
        Assert.Equal(ShortKinds.RollVictimPid, roll.VictimPid);
        Assert.True(roll.Landscape);
        Assert.Equal($"/stats/shorts/{roll.Slug}.hd.mp4?v={hd.Length}", roll.HdVideoUrl);
        Assert.Equal(hd, await File.ReadAllBytesAsync(storage.HdVideoPath(roll.Slug)));
        Assert.Equal(hd.Length, (await db.ReplayShorts.AsNoTracking().SingleAsync(s => s.Slug == roll.Slug)).HdVideoBytes);
        Assert.Equal(roll.HdVideoUrl, Value<ShortDto>(await Controller().Get(roll.Slug, default)).HdVideoUrl);

        var controller = Controller();
        controller.HttpContext.Request.Method = "GET";
        controller.HttpContext.Request.Headers.Range = "bytes=4-7";
        var body = new MemoryStream();
        controller.HttpContext.Response.Body = body;
        var result = Assert.IsType<PhysicalFileResult>(controller.HdVideo(roll.Slug));
        Assert.True(result.EnableRangeProcessing);
        Assert.Equal("video/mp4", result.ContentType);
        await result.ExecuteResultAsync(controller.ControllerContext);
        Assert.Equal(StatusCodes.Status206PartialContent, controller.HttpContext.Response.StatusCode);
        Assert.Equal("ftyp"u8.ToArray(), body.ToArray());
        Assert.Contains("immutable", controller.HttpContext.Response.Headers.CacheControl.ToString());
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_AnHdCopyNotAnMp4_IsRefused()
    {
        var controller = Controller(UploadKey);
        await Body(controller, Meta(kind: ShortKinds.Roll), videoHd: Jpeg);
        var refused = Assert.IsType<ObjectResult>((await controller.Upload(default)).Result);
        Assert.Equal(StatusCodes.Status400BadRequest, refused.StatusCode);
        Assert.Equal(0, await db.ReplayShorts.CountAsync());
        Assert.Empty(ShortFiles());
    }

    [Fact]
    public async Task Upload_ARollMayBeLarger_ThanAnotherKind()
    {
        var limits = new ShortsOptions { UploadKey = UploadKey, MaxVideoBytes = 32, MaxRollVideoBytes = 128, MaxHdVideoBytes = 64 };
        var small = new ShortService(db, storage, clock, MsOptions.Create(limits), NullLogger<ShortService>.Instance);
        async Task<int?> Send(object meta, int video, int? hd = null)
        {
            var controller = Controller(UploadKey, with: small);
            await Body(controller, meta, Mp4Of(video), videoHd: hd is { } h ? Mp4Of(h) : null);
            var result = (await controller.Upload(default)).Result;
            return result is ObjectResult o ? o.StatusCode : null;
        }

        Assert.Equal(StatusCodes.Status413PayloadTooLarge, await Send(Meta(killTime: 1), 100));
        Assert.Equal(StatusCodes.Status201Created, await Send(Meta(killTime: 2, kind: ShortKinds.Roll), 100, 60));
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, await Send(Meta(killTime: 3, kind: ShortKinds.Roll), 200));
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, await Send(Meta(killTime: 4, kind: ShortKinds.Roll), 100, 100));
        // Another kind's HD copy is held to its video's limit.
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, await Send(Meta(killTime: 5), 20, 60));
        Assert.Equal(1, await db.ReplayShorts.CountAsync());
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Fact]
    public async Task Delete_TakesTheHdCopyToo_AndTheVolumeCountsIt()
    {
        var before = await VolumeUsage.StoredBytesAsync(db, default);
        var dto = await UploadAsync(Meta(kind: ShortKinds.Roll), Mp4Of(50));
        Assert.Equal(before + Mp4.Length + 50 + Jpeg.Length, await VolumeUsage.StoredBytesAsync(db, default));
        Assert.True(File.Exists(storage.HdVideoPath(dto.Slug)));

        Assert.IsType<NoContentResult>(await Controller(UploadKey).Delete(dto.Slug, default));
        Assert.False(File.Exists(storage.HdVideoPath(dto.Slug)));
        Assert.Empty(ShortFiles());
    }

    [Fact]
    public async Task SetLinkVideo_GivesTheShareLinkASmallLandscapeCopy_TheVolumeCountsIt_DeleteTakesIt()
    {
        var limits = new ShortsOptions { UploadKey = UploadKey, MaxLinkVideoBytes = 64 };
        var small = new ShortService(db, storage, clock, MsOptions.Create(limits), NullLogger<ShortService>.Instance);
        var roll = await UploadAsync(Meta(kind: ShortKinds.Roll, title: "Action roll: Gazala"), Mp4Of(50));
        Assert.Null(roll.LinkVideoUrl);
        Assert.IsType<NotFoundResult>(Controller().LinkVideo(roll.Slug));

        // Nobody signed in: refused. Not an MP4, or over the limit: refused, nothing kept.
        Assert.Equal(StatusCodes.Status401Unauthorized,
            Assert.IsType<ObjectResult>((await PosterBody(Controller(with: small), Mp4Of(40)).SetLinkVideo(roll.Slug, default)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status400BadRequest,
            Assert.IsType<ObjectResult>((await PosterBody(Controller(UploadKey, with: small), Jpeg).SetLinkVideo(roll.Slug, default)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status413PayloadTooLarge,
            Assert.IsType<ObjectResult>((await PosterBody(Controller(UploadKey, with: small), Mp4Of(100)).SetLinkVideo(roll.Slug, default)).Result).StatusCode);
        Assert.False(File.Exists(storage.LinkVideoPath(roll.Slug)));
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));

        var before = await VolumeUsage.StoredBytesAsync(db, default);
        var dto = Value(await PosterBody(Controller(UploadKey, with: small), Mp4Of(40)).SetLinkVideo(roll.Slug, default));
        Assert.Equal($"/stats/shorts/{roll.Slug}.link.mp4?v=40", dto.LinkVideoUrl);
        Assert.Equal(before + 40, await VolumeUsage.StoredBytesAsync(db, default));
        Assert.IsType<PhysicalFileResult>(Controller().LinkVideo(roll.Slug));
        // Sent again, it replaces the last.
        Value(await PosterBody(Controller(UploadKey, with: small), Mp4Of(30)).SetLinkVideo(roll.Slug, default));
        Assert.Equal(30, new FileInfo(storage.LinkVideoPath(roll.Slug)).Length);

        // The share link names the small copy, 16:9, and the poster as the 1920x1080 it is.
        var html = Assert.IsType<ContentResult>(await Controller().ShareLink(roll.Slug, default)).Content!;
        Assert.Contains($"<meta property=\"og:video\" content=\"https://play.bfstats.io/stats/shorts/{roll.Slug}.link.mp4?v=30\">", html);
        Assert.Contains("<meta property=\"og:video:width\" content=\"1280\">", html);
        Assert.Contains("<meta property=\"og:video:height\" content=\"720\">", html);
        Assert.Contains("<meta property=\"og:image:width\" content=\"1920\">", html);
        Assert.Contains("<meta property=\"og:image:height\" content=\"1080\">", html);
        Assert.Contains($"<meta name=\"twitter:player:stream\" content=\"https://play.bfstats.io/stats/shorts/{roll.Slug}.link.mp4?v=30\">", html);

        Assert.IsType<NoContentResult>(await Controller(UploadKey).Delete(roll.Slug, default));
        Assert.False(File.Exists(storage.LinkVideoPath(roll.Slug)));
        Assert.Empty(ShortFiles());
        Assert.IsType<NotFoundResult>((await PosterBody(Controller(UploadKey, with: small), Mp4Of(30)).SetLinkVideo(roll.Slug, default)).Result);
    }

    [Fact]
    public async Task Retention_TakesDownTheUnwatchedWeekOld_KeepsTheWatchedTheYoungAndCreatorsShares()
    {
        db.Users.Add(new User { Id = 7, Email = "creator@example.com" });
        db.Recordings.Add(new Recording { Slug = RecordingSlug, UploaderUserId = 7 });
        db.UserPlayerNames.Add(new UserPlayerName { UserId = 7, PlayerName = "skandia", CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        var unseen = await UploadAsync(Meta(killTime: 1, kind: ShortKinds.Roll), Mp4Of(30));
        var once = await UploadAsync(Meta(killTime: 2));
        var twice = await UploadAsync(Meta(killTime: 3));
        var share = Assert.IsType<ShortDto>(Assert.IsType<CreatedAtActionResult>((await ShareAsync(ShareMeta(), User(false))).Result).Value);
        clock.Now += Duration.FromDays(1);
        var young = await UploadAsync(Meta(killTime: 4));
        await db.ReplayShorts.Where(s => s.Slug == once.Slug).ExecuteUpdateAsync(set => set.SetProperty(s => s.Views, 1));
        await db.ReplayShorts.Where(s => s.Slug == twice.Slug).ExecuteUpdateAsync(set => set.SetProperty(s => s.Views, 2));
        db.ChangeTracker.Clear();

        // Six days on, the first four are 7 days old; the young one is 6.
        clock.Now += Duration.FromDays(6);
        Assert.Equal(StatusCodes.Status200OK, await SendPart("staleupload000002", 0, Mp4Of(20)));
        File.SetLastWriteTimeUtc(storage.PartPath("staleupload000002", 0), DateTime.UtcNow.AddHours(-25));
        var before = await VolumeUsage.StoredBytesAsync(db, default);

        // A dry run lists what it would take, and changes nothing.
        var dry = Value<ShortPruneDto>(await Controller(UploadKey).Prune(dryRun: true, default));
        Assert.True(dry.DryRun);
        Assert.Equal([(unseen.Slug, ShortKinds.Roll, 7.0, 0), (once.Slug, ShortKinds.AirToAir, 7.0, 1)],
            dry.Pruned.Select(p => (p.Slug, p.Kind, p.AgeDays, p.Views)).ToList());
        Assert.Equal(0, dry.PartsSwept);
        Assert.Equal(0, await db.ReplayShorts.CountAsync(s => s.PrunedAt != null));
        Assert.True(File.Exists(storage.HdVideoPath(unseen.Slug)));
        Assert.Single(storage.Parts("staleupload000002"));
        Assert.Equal(before, await VolumeUsage.StoredBytesAsync(db, default));

        var run = Value<ShortPruneDto>(await Controller(UploadKey).Prune(dryRun: false, default));
        Assert.False(run.DryRun);
        Assert.Equal(dry.Pruned, run.Pruned);
        Assert.Equal(1, run.PartsSwept);
        Assert.Empty(storage.Parts("staleupload000002"));
        db.ChangeTracker.Clear();

        // Tombstones: the rows stay, pruned and weighing nothing, their keys still in /keys.
        var pruned = await db.ReplayShorts.AsNoTracking().Where(s => s.PrunedAt != null).ToListAsync();
        Assert.Equal(new[] { unseen.Slug, once.Slug }.Order(), pruned.Select(s => s.Slug).Order());
        Assert.All(pruned, s => Assert.Equal((clock.Now, 0L, 0L, 0L), (s.PrunedAt!.Value, s.VideoBytes, s.HdVideoBytes, s.PosterBytes)));
        Assert.Equal(before - (Mp4.Length + 30 + Jpeg.Length) - (Mp4.Length + Jpeg.Length), await VolumeUsage.StoredBytesAsync(db, default));
        var keys = Value<ShortKeysDto>(await Controller().Keys(RecordingSlug, default)).Keys;
        Assert.Contains(unseen.Key, keys);
        Assert.Contains(once.Key, keys);

        // Every read leaves them out.
        var listed = Value<PagedShortsDto>(await Controller().List(days: 30, ct: default));
        Assert.Equal(new[] { twice.Slug, share.Slug, young.Slug }.Order(), listed.Items.Select(s => s.Slug).Order());
        Assert.Equal(3, listed.Total);
        Assert.IsType<NotFoundResult>((await Controller().Get(unseen.Slug, default)).Result);
        Assert.IsType<NotFoundResult>((await Controller().View(once.Slug, default)).Result);
        Assert.IsType<NotFoundResult>(Controller().Video(unseen.Slug));
        Assert.IsType<NotFoundResult>(Controller().HdVideo(unseen.Slug));
        Assert.IsType<NotFoundResult>(Controller().Poster(once.Slug));
        // Rut is killed in all five; the three live ones count.
        Assert.Equal(3, Value<ShortPlayersDto>(await Controller().Players(30, default)).Items.Single(p => p.Name == "Rut").Shorts);

        // The render job sending the kill again writes nothing.
        var again = Controller(UploadKey);
        await Body(again, Meta(killTime: 2));
        Assert.IsType<OkObjectResult>((await again.Upload(default)).Result);
        Assert.False(File.Exists(storage.VideoPath(once.Slug)));
        Assert.Equal(5, await db.ReplayShorts.CountAsync());

        // An explicit delete still takes the row.
        Assert.IsType<NoContentResult>(await Controller(UploadKey).Delete(once.Slug, default));
        Assert.Equal(4, await db.ReplayShorts.CountAsync());

        Assert.False(File.Exists(storage.VideoPath(unseen.Slug)));
        Assert.False(File.Exists(storage.HdVideoPath(unseen.Slug)));
        Assert.False(File.Exists(storage.PosterPath(unseen.Slug)));
        Assert.False(File.Exists(storage.VideoPath(once.Slug)));
        Assert.True(File.Exists(storage.VideoPath(share.Slug)));
        Assert.Empty((await service.PruneUnwatchedAsync(dryRun: false, default)).Pruned);
    }

    [Fact]
    public async Task Prune_WithoutTheKeyOrAnAdmin_IsRefused_AsTheUploadIs()
    {
        await UploadAsync();
        clock.Now += Duration.FromDays(8);

        Assert.Equal(StatusCodes.Status401Unauthorized, Assert.IsType<ObjectResult>((await Controller().Prune(false, default)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status401Unauthorized,
            Assert.IsType<ObjectResult>((await Controller("wrong-key").Prune(false, default)).Result).StatusCode);
        Assert.Equal(StatusCodes.Status403Forbidden,
            Assert.IsType<ObjectResult>((await Controller(user: User(false)).Prune(false, default)).Result).StatusCode);
        Assert.Equal(0, await db.ReplayShorts.CountAsync(s => s.PrunedAt != null));

        Assert.Single(Value<ShortPruneDto>(await Controller(user: User(true)).Prune(true, default)).Pruned);
    }

    private async Task<int?> SendPart(string upload, int index, byte[] bytes)
    {
        var controller = Controller(UploadKey);
        controller.HttpContext.Request.ContentType = "application/octet-stream";
        controller.HttpContext.Request.ContentLength = bytes.Length;
        controller.HttpContext.Request.Body = new MemoryStream(bytes);
        var result = (await controller.Part(upload, index, default)).Result;
        return result is ObjectResult o ? o.StatusCode ?? StatusCodes.Status200OK : null;
    }

    [Fact]
    public async Task Upload_ARollInParts_JoinsThemInOrder_AndServesIt()
    {
        var whole = Mp4Of(3000);
        for (var i = 16; i < whole.Length; i++) whole[i] = (byte)(i * 31);
        var hd = Mp4Of(1200);
        const string upload = "rollpartsabc12345";
        const string hdUpload = "rollhdparts000001";
        // Out of order, and part 1 sent twice: the last try is the part.
        Assert.Equal(StatusCodes.Status200OK, await SendPart(upload, 2, whole[2000..]));
        Assert.Equal(StatusCodes.Status200OK, await SendPart(upload, 1, new byte[7]));
        Assert.Equal(StatusCodes.Status200OK, await SendPart(upload, 0, whole[..1000]));
        Assert.Equal(StatusCodes.Status200OK, await SendPart(upload, 1, whole[1000..2000]));
        Assert.Equal(StatusCodes.Status200OK, await SendPart(hdUpload, 0, hd));
        Assert.Equal(StatusCodes.Status400BadRequest, await SendPart("SHOUTING-ID-0000000", 0, hd));
        Assert.Equal(StatusCodes.Status400BadRequest, await SendPart(upload, -1, hd));
        Assert.Equal(StatusCodes.Status401Unauthorized, (await Controller().Part(upload, 0, default)).Result is ObjectResult o ? o.StatusCode : 0);

        var controller = Controller(UploadKey);
        await Body(controller, Meta(killTime: 40, kind: ShortKinds.Roll), videoUpload: upload, videoHdUpload: hdUpload);
        var dto = Assert.IsType<ShortDto>(Assert.IsType<CreatedAtActionResult>((await controller.Upload(default)).Result).Value);

        Assert.Equal(whole, await File.ReadAllBytesAsync(storage.VideoPath(dto.Slug)));
        Assert.Equal(hd, await File.ReadAllBytesAsync(storage.HdVideoPath(dto.Slug)));
        Assert.Equal($"/stats/shorts/{dto.Slug}.mp4?v={whole.Length}", dto.VideoUrl);
        Assert.Equal($"/stats/shorts/{dto.Slug}.hd.mp4?v={hd.Length}", dto.HdVideoUrl);
        Assert.IsType<PhysicalFileResult>(Controller().Video(dto.Slug));
        Assert.Empty(storage.Parts(upload));
        Assert.Empty(storage.Parts(hdUpload));
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_InParts_WithAMissingIndex_OrNone_IsRefused_ThePartsLeftToFinish()
    {
        const string upload = "gappyupload000001";
        Assert.Equal(StatusCodes.Status200OK, await SendPart(upload, 0, Mp4Of(100)));
        Assert.Equal(StatusCodes.Status200OK, await SendPart(upload, 2, new byte[100]));

        var controller = Controller(UploadKey);
        await Body(controller, Meta(kind: ShortKinds.Roll), videoUpload: upload);
        var refused = Assert.IsType<ObjectResult>((await controller.Upload(default)).Result);
        Assert.Equal(StatusCodes.Status400BadRequest, refused.StatusCode);
        Assert.Contains("missing part 1", refused.Value!.ToString());

        var none = Controller(UploadKey);
        await Body(none, Meta(kind: ShortKinds.Roll), videoUpload: "neversentupload01");
        Assert.Equal(StatusCodes.Status400BadRequest, Assert.IsType<ObjectResult>((await none.Upload(default)).Result).StatusCode);

        Assert.Equal(0, await db.ReplayShorts.CountAsync());
        Assert.Equal(2, storage.Parts(upload).Count);
        Assert.Empty(Directory.GetFiles(Path.Combine(directory, ".incoming")));
    }

    [Fact]
    public async Task Upload_InParts_IsHeldToTheKindsLimit()
    {
        var limits = new ShortsOptions { UploadKey = UploadKey, MaxVideoBytes = 32, MaxRollVideoBytes = 128, MaxHdVideoBytes = 64, MaxPartBytes = 50 };
        var small = new ShortService(db, storage, clock, MsOptions.Create(limits), NullLogger<ShortService>.Instance);
        async Task<int?> Part(string upload, int index, byte[] bytes)
        {
            var c = Controller(UploadKey, with: small);
            c.HttpContext.Request.ContentLength = bytes.Length;
            c.HttpContext.Request.Body = new MemoryStream(bytes);
            return (await c.Part(upload, index, default)).Result is ObjectResult o ? o.StatusCode : null;
        }
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, await Part("toobigapart000001", 0, Mp4Of(51)));
        Assert.Equal(StatusCodes.Status200OK, await Part("notarollupload001", 0, Mp4Of(40)));

        var controller = Controller(UploadKey, with: small);
        await Body(controller, Meta(), videoUpload: "notarollupload001");
        Assert.Equal(StatusCodes.Status413PayloadTooLarge, Assert.IsType<ObjectResult>((await controller.Upload(default)).Result).StatusCode);
    }

    [Fact]
    public async Task StaleParts_AreSweptAfterADay_AFreshUploadIsLeft()
    {
        Assert.Equal(StatusCodes.Status200OK, await SendPart("staleupload000001", 0, Mp4Of(20)));
        Assert.Equal(StatusCodes.Status200OK, await SendPart("staleupload000001", 1, new byte[10]));
        Assert.Equal(StatusCodes.Status200OK, await SendPart("freshupload000001", 0, Mp4Of(20)));
        // The stale upload began 25 hours ago; its last part came in just now.
        File.SetLastWriteTimeUtc(storage.PartPath("staleupload000001", 0), DateTime.UtcNow.AddHours(-25));

        Assert.Equal(2, storage.SweepStaleParts(TimeSpan.FromHours(24)));
        Assert.Empty(storage.Parts("staleupload000001"));
        Assert.Single(storage.Parts("freshupload000001"));
        Assert.Equal(20, storage.PendingPartBytes());
    }

    private static T Value<T>(ActionResult<T> result) =>
        Assert.IsType<T>(Assert.IsType<OkObjectResult>(result.Result).Value);
}
