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

/// <summary>The join name (features/game-profiles, "Join name"): the rule, the PATCH, and PUT keeping it.</summary>
public sealed class GameProfileJoinNameTests : IDisposable
{
    private sealed class FixedClock : IClock
    {
        public Instant GetCurrentInstant() => Instant.FromUtc(2026, 10, 25, 12, 0);
    }

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly GameProfileService service;

    public GameProfileJoinNameTests()
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
    [InlineData("Join", "Join")]
    [InlineData("  padded  ", "padded")]
    [InlineData("Jörg Müller", "Jörg Müller")]
    [InlineData("[CLAN]name-with.marks!", "[CLAN]name-with.marks!")]
    [InlineData("12345678901234567890123", "12345678901234567890123")]
    public void ValidateJoinName_TakesWhatTheServerTakes(string raw, string expected)
    {
        var (name, error) = GameProfileRules.ValidateJoinName(raw);
        Assert.Null(error);
        Assert.Equal(expected, name);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ValidateJoinName_BlankClears(string? raw)
    {
        var (name, error) = GameProfileRules.ValidateJoinName(raw);
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
    public void ValidateJoinName_RefusesWhatCannotReachTheServer(string raw, string reason)
    {
        var (name, error) = GameProfileRules.ValidateJoinName(raw);
        Assert.Null(name);
        Assert.Contains(reason, error);
    }

    // --- the service ---

    [Fact]
    public async Task Patch_SetsAndClears_AndLeavesPlayerNameAlone()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());

        var set = await service.SetJoinNameAsync(userId, "SKANDIA", " Join ");
        Assert.Equal(GameProfileOutcome.Ok, set.Outcome);
        Assert.Equal("Join", set.Profile!.JoinName);
        Assert.Equal("FromFile", set.Profile.PlayerName);
        Assert.Equal("Join", (await service.ListAsync(userId)).Single().JoinName);

        var cleared = await service.SetJoinNameAsync(userId, "skandia", "");
        Assert.Null(cleared.Profile!.JoinName);
        Assert.Null((await service.ListAsync(userId)).Single().JoinName);
    }

    [Fact]
    public async Task Patch_RefusesAnUnknownProfileAndABadName()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());

        Assert.Equal(GameProfileOutcome.NotFound, (await service.SetJoinNameAsync(userId, "nobody", "x")).Outcome);
        Assert.Equal(GameProfileOutcome.Invalid, (await service.SetJoinNameAsync(userId, "skandia", "a\"b")).Outcome);
        Assert.Null((await service.ListAsync(userId)).Single().JoinName);
    }

    [Fact]
    public async Task Patch_IsPerUser()
    {
        var owner = await CreateUserAsync();
        var other = await CreateUserAsync("other@example.com");
        await service.UpsertAsync(owner, "skandia", Import());

        Assert.Equal(GameProfileOutcome.NotFound, (await service.SetJoinNameAsync(other, "skandia", "x")).Outcome);
    }

    [Fact]
    public async Task Put_WithoutTheField_KeepsTheJoinName()
    {
        var userId = await CreateUserAsync();
        await service.UpsertAsync(userId, "skandia", Import());
        await service.SetJoinNameAsync(userId, "skandia", "Join");

        var reimport = await service.UpsertAsync(userId, "skandia",
            Import("""{"files":{"GeneralOptions.con":"game.setPlayerName \"Renamed\"\r\n"},"makeActive":true}"""));

        Assert.Equal("Renamed", reimport.Profile!.PlayerName);
        Assert.Equal("Join", reimport.Profile.JoinName);
    }

    [Fact]
    public async Task Put_WithTheField_SetsOrClearsIt()
    {
        var userId = await CreateUserAsync();
        var created = await service.UpsertAsync(userId, "skandia", Import("""{"files":{},"joinName":"OnCreate"}"""));
        Assert.Equal("OnCreate", created.Profile!.JoinName);

        var cleared = await service.UpsertAsync(userId, "skandia", Import("""{"files":{},"joinName":null}"""));
        Assert.Null(cleared.Profile!.JoinName);

        var refused = await service.UpsertAsync(userId, "skandia", Import("""{"files":{},"joinName":"Иван"}"""));
        Assert.Equal(GameProfileOutcome.Invalid, refused.Outcome);
    }

    // --- the bodies and the controller ---

    [Fact]
    public void Bodies_TellAMissingFieldFromANull()
    {
        Assert.False(Import("""{"files":{}}""").HasJoinName);
        Assert.True(Import("""{"files":{},"joinName":null}""").HasJoinName);
        Assert.False(JsonSerializer.Deserialize<SetJoinNameRequest>("{}", Web)!.HasJoinName);
        var patch = JsonSerializer.Deserialize<SetJoinNameRequest>("""{"joinName":null}""", Web)!;
        Assert.True(patch.HasJoinName);
        Assert.Null(patch.JoinName);
    }

    [Fact]
    public void Response_CarriesJoinNameInCamelCase()
    {
        var json = JsonSerializer.Serialize(
            new GameProfileResponse("a", "b", true, Instant.FromUtc(2026, 10, 25, 0, 0), new Dictionary<string, string>(), "Side"), Web);
        Assert.Contains("\"joinName\":\"Side\"", json);
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

        static SetJoinNameRequest Body(string json) => JsonSerializer.Deserialize<SetJoinNameRequest>(json, Web)!;

        var ok = Assert.IsType<OkObjectResult>(await controller.SetJoinName("skandia", Body("""{"joinName":"Join"}"""), CancellationToken.None));
        Assert.Equal("Join", Assert.IsType<GameProfileResponse>(ok.Value).JoinName);
        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>(await controller.SetJoinName("skandia", Body("{}"), CancellationToken.None)).StatusCode);
        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>(await controller.SetJoinName("skandia", Body("""{"joinName":"x\"y"}"""), CancellationToken.None)).StatusCode);
        Assert.Equal(404, Assert.IsAssignableFrom<ObjectResult>(await controller.SetJoinName("nobody", Body("""{"joinName":"x"}"""), CancellationToken.None)).StatusCode);
    }
}
