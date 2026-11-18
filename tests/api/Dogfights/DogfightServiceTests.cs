using System.Text.Json;
using api.Dogfights;
using api.PlayerTracking;
using api.Recordings.Models;
using api.ServerMedia;
using api.ServerMedia.Models;
using api.Shorts.Models;
using api.tests.Recordings;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace api.tests.Dogfights;

/// <summary>
/// Recorded dogfights on bfstats.io's server and player pages, and the landing page's media per
/// server (features/dogfights-on-stats-pages), over a throwaway index file and an in-memory database.
/// </summary>
public sealed class DogfightServiceTests : IDisposable
{
    private const string Server = "MoonGamers.com | Est. 2004";
    // A server name with a cp1252 symbol: the site has U+2022, a recording the byte 0x95.
    private const string SiteBullet = "• Bullet Server";
    private const string RecordedBullet = "\u0095 Bullet Server";

    private readonly string directory = Path.Combine(Path.GetTempPath(), $"bfstats-dogfights-test-{Guid.NewGuid():N}");
    private readonly string file;
    private readonly TestClock clock = new(Instant.FromUtc(2026, 11, 18, 10, 0));
    private readonly DogfightIndex index;
    private readonly DogfightService service;

    public DogfightServiceTests()
    {
        Directory.CreateDirectory(directory);
        file = Path.Combine(directory, "index.json");
        index = new DogfightIndex(MsOptions.Create(new DogfightsOptions { IndexPath = file, RefreshSeconds = 60 }), clock,
            NullLogger<DogfightIndex>.Instance);
        service = new DogfightService(index);
    }

    public void Dispose()
    {
        index.Dispose();
        try
        {
            Directory.Delete(directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }

    private static object Row(string id, string server, string kind, bool kill, string a = "-[HC]- WacArnolds", string b = "NazaroLamos",
        string recorded = "2026-11-15") => new
    {
        id, slug = id[..10], mod = "xpack1", level = "anzio", recorded, server, source = "client", t0 = 128.0, duration = 13.6,
        kind, mutual = false, closest = 30,
        kill = kill ? new { side = 0, t = 10.6, weapon = "BF109" } : null,
        end = kill
            ? (object)new { why = "shot down", t = 10.6, side = 1 }
            : new { why = "downed by another", t = 12.0, side = 0, by = new { pid = 16, name = "Green EMPEROR", weapon = "Gearing" } },
        sides = new object[]
        {
            new { name = a, team = 1, tmpl = "BF109", aimed = 27, hits = 8, turned = 251 },
            new { name = b, team = 2, tmpl = "Zero", aimed = 3, hits = 0, turned = 192, gunner = 4 },
        },
        clip = true,
    };

    private void Write(params object[] rows) => File.WriteAllText(file, JsonSerializer.Serialize(rows));

    [Fact]
    public async Task Narrows_to_a_server_or_a_pilot_by_either_form_of_the_name()
    {
        Write(
            Row("aaaaaaaaaa-1", Server, "bounce", kill: true),
            Row("aaaaaaaaaa-2", Server, "dogfight", kill: false),
            Row("aaaaaaaaaa-3", Server, "dogfight", kill: true),
            Row("bbbbbbbbbb-1", RecordedBullet, "dogfight", kill: true, a: "\u0095Ace", b: "Other"));

        var here = await service.ListAsync(Server, null, null, 1, 6, default);
        Assert.Equal(3, here.Total);
        Assert.Equal(2, here.Dogfights);
        Assert.Equal(2, here.Kills);
        // Dogfights first, kills among them first.
        Assert.Equal(["aaaaaaaaaa-3", "aaaaaaaaaa-2", "aaaaaaaaaa-1"], here.Items.Select(f => f.Id));
        var first = here.Items[0];
        Assert.Equal(new LocalDate(2026, 11, 15), first.Recorded);
        Assert.Equal("BF109", first.Kill!.Weapon);
        Assert.Equal(4, first.Sides[1].Gunner);
        Assert.Equal("Green EMPEROR", here.Items[1].End!.By!.Name);

        Assert.Equal(["bbbbbbbbbb-1"], (await service.ListAsync(SiteBullet, null, null, 1, 6, default)).Items.Select(f => f.Id));
        Assert.Equal(["bbbbbbbbbb-1"], (await service.ListAsync(null, "•Ace", null, 1, 6, default)).Items.Select(f => f.Id));
        Assert.Equal(3, (await service.ListAsync(null, "NazaroLamos", null, 1, 6, default)).Total);
        Assert.Equal(["aaaaaaaaaa-1"], (await service.ListAsync(Server, null, "bounce", 1, 6, default)).Items.Select(f => f.Id));
        Assert.Equal(0, (await service.ListAsync("nowhere", null, null, 1, 6, default)).Total);

        var paged = await service.ListAsync(Server, null, null, 2, 2, default);
        Assert.Equal(["aaaaaaaaaa-1"], paged.Items.Select(f => f.Id));
    }

    [Fact]
    public async Task No_index_is_no_fights_and_a_new_one_is_read_once_it_is_due()
    {
        Assert.Empty(await service.AllAsync(default));
        Write(Row("aaaaaaaaaa-1", Server, "dogfight", kill: true));
        // Looked at again only after RefreshSeconds.
        Assert.Empty(await service.AllAsync(default));
        clock.Now += Duration.FromSeconds(61);
        Assert.Single(await service.AllAsync(default));

        await File.WriteAllTextAsync(file, "{ not json");
        File.SetLastWriteTimeUtc(file, DateTime.UtcNow.AddMinutes(1));
        clock.Now += Duration.FromSeconds(61);
        // A broken build keeps the last list.
        Assert.Single(await service.AllAsync(default));
    }

    [Fact]
    public async Task The_landing_page_gets_one_of_each_kind_per_server_before_two_of_any()
    {
        Write(
            Row("aaaaaaaaaa-1", Server, "dogfight", kill: true),
            Row("aaaaaaaaaa-2", Server, "bounce", kill: true),
            Row("bbbbbbbbbb-1", RecordedBullet, "dogfight", kill: false));

        using var connection = new SqliteConnection("Filename=:memory:");
        await connection.OpenAsync();
        using var db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        db.Users.Add(new User { Id = 8, Email = "uploader@example.com" });
        var at = Instant.FromUtc(2026, 11, 10, 10, 0);
        db.Recordings.Add(new Recording { Slug = "recaaaaaaa", ContentHash = "a", UploaderUserId = 8, ServerName = Server, Title = "Old round", Level = "anzio", Mod = "xpack1", CreatedAt = at, UpdatedAt = at });
        db.Recordings.Add(new Recording { Slug = "recbbbbbbb", ContentHash = "b", UploaderUserId = 8, ServerName = Server, Title = "New round", Level = "anzio", Mod = "xpack1", ThumbnailBytes = 10, CreatedAt = at, UpdatedAt = at });
        db.Recordings.Add(new Recording { Slug = "recccccccc", ContentHash = "c", UploaderUserId = 8, ServerName = "Gone", FileMissing = true, CreatedAt = at, UpdatedAt = at });
        db.ReplayShorts.Add(new ReplayShort
        {
            Slug = "shortaaaaa", RecordingSlug = "recaaaaaaa", Key = "k", Kind = "streak", Title = "A 9-kill streak", Level = "anzio", Mod = "xpack1",
            LengthSeconds = 30, CreatedAt = at, CreatedAtMs = at.ToUnixTimeMilliseconds(),
        });
        await db.SaveChangesAsync();

        var media = new ServerMediaService(db, service, new MemoryCache(new MemoryCacheOptions()));
        var list = await media.ListAsync(3, default);

        var moon = Assert.Single(list.Servers, s => s.ServerName == Server);
        Assert.Equal((1, 2, 2), (moon.Shorts, moon.Replays, moon.Dogfights));
        Assert.Equal(["short", "replay", "dogfight"], moon.Items.Select(i => i.Kind));
        Assert.Equal(["shortaaaaa", "recbbbbbbb", "aaaaaaaaaa-1"], moon.Items.Select(i => i.Id));
        Assert.StartsWith("/stats/recordings/recbbbbbbb.jpg?v=", moon.Items[1].ImageUrl);
        Assert.Equal("-[HC]- WacArnolds (BF109) downs NazaroLamos (Zero)", moon.Items[2].Title);
        Assert.Null(moon.Items[2].ImageUrl);
        // The site's form of a recorded name; a missing file is not shown.
        var bullet = Assert.Single(list.Servers, s => s.ServerName == SiteBullet);
        Assert.Equal("-[HC]- WacArnolds (BF109) v NazaroLamos (Zero)", bullet.Items.Single().Title);
        Assert.DoesNotContain(list.Servers, s => s.ServerName == "Gone");
        // Busiest first.
        Assert.Equal(Server, list.Servers[0].ServerName);

        Assert.Equal(["short", "replay"], (await media.ListAsync(2, default)).Servers[0].Items.Select(i => i.Kind));
    }

    [Fact]
    public void Picks_round_robin_until_full()
    {
        static ServerMediaItemDto Item(string kind, int n) => new(kind, $"{kind}{n}", "", null, "bf1942", "wake", 1, null);
        IReadOnlyList<IReadOnlyList<ServerMediaItemDto>> queues = [[Item("short", 1), Item("short", 2), Item("short", 3)], [], [Item("dogfight", 1)]];
        Assert.Equal(["short1", "dogfight1", "short2"], ServerMediaService.Pick(queues, 3).Select(i => i.Id));
        Assert.Equal(["short1", "dogfight1", "short2", "short3"], ServerMediaService.Pick(queues, 6).Select(i => i.Id));
    }
}
