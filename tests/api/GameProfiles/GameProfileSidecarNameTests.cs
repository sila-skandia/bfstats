using System.Diagnostics;
using System.Security.Claims;
using System.Text.Json;
using api.GameProfiles;
using api.GameProfiles.Models;
using api.PlayerTracking;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.GameProfiles;

/// <summary>The sidecar name (features/game-profiles, "Sidecar name"): the rule, the PATCH, and PUT keeping it.</summary>
public sealed class GameProfileSidecarNameTests : IDisposable
{
    private sealed class FixedClock : IClock
    {
        public Instant GetCurrentInstant() => Instant.FromUtc(2026, 10, 25, 12, 0);
    }

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly GameProfileService service;

    public GameProfileSidecarNameTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();
        service = new GameProfileService(dbContext, new FixedClock(), NullLogger<GameProfileService>.Instance);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }

    private async Task<int> CreateUserAsync(string email = "player@example.com")
    {
        var user = new User { Email = email, CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync();
        return user.Id;
    }

    private static UpsertGameProfileRequest Import(string json = """{"files":{"GeneralOptions.con":"game.setPlayerName \"FromFile\"\r\n"}}""") =>
        JsonSerializer.Deserialize<UpsertGameProfileRequest>(json, Web)!;

    // --- the rule ---

    [Theory]
    [InlineData("Sidecar", "Sidecar")]
    [InlineData("  padded  ", "padded")]
    [InlineData("Jörg Müller", "Jörg Müller")]
    [InlineData("[CLAN]name-with.marks!", "[CLAN]name-with.marks!")]
    [InlineData("12345678901234567890123", "12345678901234567890123")]
    public void ValidateSidecarName_TakesWhatTheSidecarTakes(string raw, string expected)
    {
        var (name, error) = GameProfileRules.ValidateSidecarName(raw);
        Assert.Null(error);
        Assert.Equal(expected, name);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ValidateSidecarName_BlankClears(string? raw)
    {
        var (name, error) = GameProfileRules.ValidateSidecarName(raw);
        Assert.Null(name);
        Assert.Null(error);
    }

    [Theory]
    [InlineData("say \"hi\"", "quote")]
    [InlineData("tab\there", "control")]
    [InlineData("c1\u0085char", "control")]
    [InlineData("del\u007f", "control")]
    [InlineData("Иван", "Latin-1")]
    [InlineData("snow☃man", "Latin-1")]
    [InlineData("123456789012345678901234", "at most 23")]
    public void ValidateSidecarName_RefusesWhatCannotReachTheServer(string raw, string reason)
    {
        var (name, error) = GameProfileRules.ValidateSidecarName(raw);
        Assert.Null(name);
        Assert.Contains(reason, error);
    }

    // --- the service ---

    [Fact]
    public async Task Patch_SetsAndClears_AndLeavesPlayerNameAlone()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());

        var set = await service.SetSidecarNameAsync(userId, "SKANDIA", " Sidecar ");
        Assert.Equal(GameProfileOutcome.Ok, set.Outcome);
        Assert.Equal("Sidecar", set.Profile!.SidecarName);
        Assert.Equal("FromFile", set.Profile.PlayerName);
        Assert.Equal("Sidecar", (await service.ListAsync(userId)).Single().SidecarName);

        var cleared = await service.SetSidecarNameAsync(userId, "skandia", "");
        Assert.Null(cleared.Profile!.SidecarName);
        Assert.Null((await service.ListAsync(userId)).Single().SidecarName);
    }

    [Fact]
    public async Task Patch_RefusesAnUnknownProfileAndABadName()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());

        Assert.Equal(GameProfileOutcome.NotFound, (await service.SetSidecarNameAsync(userId, "nobody", "x")).Outcome);
        Assert.Equal(GameProfileOutcome.Invalid, (await service.SetSidecarNameAsync(userId, "skandia", "a\"b")).Outcome);
        Assert.Null((await service.ListAsync(userId)).Single().SidecarName);
    }

    [Fact]
    public async Task Patch_IsPerUser()
    {
        var owner = await CreateUserAsync();
        var other = await CreateUserAsync("other@example.com");
        await service.UpsertAsync(owner, "skandia", Import());

        Assert.Equal(GameProfileOutcome.NotFound, (await service.SetSidecarNameAsync(other, "skandia", "x")).Outcome);
    }

    [Fact]
    public async Task Put_WithoutTheField_KeepsTheSidecarName()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());
        await service.SetSidecarNameAsync(userId, "skandia", "Sidecar");

        var reimport = await service.UpsertAsync(userId, "skandia",
            Import("""{"files":{"GeneralOptions.con":"game.setPlayerName \"Renamed\"\r\n"},"makeActive":true}"""));

        Assert.Equal("Renamed", reimport.Profile!.PlayerName);
        Assert.Equal("Sidecar", reimport.Profile.SidecarName);
    }

    [Fact]
    public async Task Put_WithTheField_SetsOrClearsIt()
    {
        var userId = await CreateUserAsync();
        var created = await service.UpsertAsync(userId, "skandia", Import("""{"files":{},"sidecarName":"OnCreate"}"""));
        Assert.Equal("OnCreate", created.Profile!.SidecarName);

        var cleared = await service.UpsertAsync(userId, "skandia", Import("""{"files":{},"sidecarName":null}"""));
        Assert.Null(cleared.Profile!.SidecarName);

        var refused = await service.UpsertAsync(userId, "skandia", Import("""{"files":{},"sidecarName":"Иван"}"""));
        Assert.Equal(GameProfileOutcome.Invalid, refused.Outcome);
    }

    // --- the bodies and the controller ---

    [Fact]
    public void Bodies_TellAMissingFieldFromANull()
    {
        Assert.False(Import("""{"files":{}}""").HasSidecarName);
        Assert.True(Import("""{"files":{},"sidecarName":null}""").HasSidecarName);
        Assert.False(JsonSerializer.Deserialize<SetSidecarNameRequest>("{}", Web)!.HasSidecarName);
        var patch = JsonSerializer.Deserialize<SetSidecarNameRequest>("""{"sidecarName":null}""", Web)!;
        Assert.True(patch.HasSidecarName);
        Assert.Null(patch.SidecarName);
    }

    [Fact]
    public void Response_CarriesSidecarNameInCamelCase()
    {
        var json = JsonSerializer.Serialize(
            new GameProfileResponse("a", "b", true, Instant.FromUtc(2026, 10, 25, 0, 0), new Dictionary<string, string>(), "Side"), Web);
        Assert.Contains("\"sidecarName\":\"Side\"", json);
    }

    [Fact]
    public async Task Controller_PatchAnswers()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());
        var controller = new GameProfilesController(service)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")),
                },
            },
        };

        static SetSidecarNameRequest Body(string json) => JsonSerializer.Deserialize<SetSidecarNameRequest>(json, Web)!;

        var ok = Assert.IsType<OkObjectResult>(await controller.SetSidecarName("skandia", Body("""{"sidecarName":"Sidecar"}"""), CancellationToken.None));
        Assert.Equal("Sidecar", Assert.IsType<GameProfileResponse>(ok.Value).SidecarName);
        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>(await controller.SetSidecarName("skandia", Body("{}"), CancellationToken.None)).StatusCode);
        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>(await controller.SetSidecarName("skandia", Body("""{"sidecarName":"x\"y"}"""), CancellationToken.None)).StatusCode);
        Assert.Equal(404, Assert.IsAssignableFrom<ObjectResult>(await controller.SetSidecarName("nobody", Body("""{"sidecarName":"x"}"""), CancellationToken.None)).StatusCode);
    }

    [Fact]
    public async Task Patch_ReturnsBusy_WhenAnotherWriterHoldsTheLock()
    {
        var path = Path.Combine(Path.GetTempPath(), $"gp-lock-{Guid.NewGuid():N}.db");
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        await using var db = new PlayerTrackerDbContext(options);
        await db.Database.EnsureCreatedAsync();
        var locked = new GameProfileService(db, new FixedClock(), NullLogger<GameProfileService>.Instance);

        var user = new User { Email = "player@example.com", CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        await locked.UpsertAsync(user.Id, "skandia", Import());

        await using var locker = new SqliteConnection($"Data Source={path}");
        await locker.OpenAsync();
        await using var begin = locker.CreateCommand();
        begin.CommandText = "BEGIN EXCLUSIVE";
        await begin.ExecuteNonQueryAsync();

        var started = Stopwatch.GetTimestamp();
        var result = await locked.SetSidecarNameAsync(user.Id, "skandia", "Sidecar");
        var elapsed = Stopwatch.GetElapsedTime(started);

        Assert.Equal(GameProfileOutcome.Busy, result.Outcome);
        Assert.Contains("busy updating", result.Message);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");

        await using var rollback = locker.CreateCommand();
        rollback.CommandText = "ROLLBACK";
        await rollback.ExecuteNonQueryAsync();

        try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
    }
}
