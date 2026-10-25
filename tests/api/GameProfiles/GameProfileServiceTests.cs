using api.Auth;
using api.GameProfiles;
using api.GameProfiles.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.GameProfiles;

public sealed class GameProfileServiceTests : IDisposable
{
    private sealed class SteppingClock : IClock
    {
        public Instant Now { get; set; } = Instant.FromUtc(2026, 10, 25, 12, 0);

        public Instant GetCurrentInstant()
        {
            Now += Duration.FromSeconds(1);
            return Now;
        }
    }

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly SteppingClock clock = new();
    private readonly GameProfileService service;

    public GameProfileServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();
        service = new GameProfileService(dbContext, clock, NullLogger<GameProfileService>.Instance);
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

    private static UpsertGameProfileRequest Request(string? playerName = null, bool makeActive = false, string? general = null) =>
        new(playerName, new Dictionary<string, string?>
        {
            ["Controls/Air.con"] = "ControlMap.create AirPlayerInputControlMap\r\n",
            ["GeneralOptions.con"] = general ?? "game.setPlayerName \"FromFile\"\r\n",
        }, makeActive);

    private async Task<GameProfileResponse> UpsertOkAsync(int userId, string name, UpsertGameProfileRequest? request = null)
    {
        var result = await service.UpsertAsync(userId, name, request ?? Request());
        Assert.Equal(GameProfileOutcome.Ok, result.Outcome);
        return result.Profile!;
    }

    private async Task<string?> ActiveAsync(int userId) =>
        (await service.ListAsync(userId)).SingleOrDefault(p => p.IsActive)?.Name;

    [Fact]
    public async Task TheFirstProfile_IsActive_AndLaterOnesAreNot()
    {
        var userId = await CreateUserAsync();

        var first = await UpsertOkAsync(userId, "skandia");
        var second = await UpsertOkAsync(userId, "Custom");

        Assert.True(first.IsActive);
        Assert.False(second.IsActive);
        Assert.Equal("skandia", await ActiveAsync(userId));
    }

    [Fact]
    public async Task Upsert_ReplacesByName_CaseInsensitively()
    {
        var userId = await CreateUserAsync();
        await UpsertOkAsync(userId, "skandia");

        var replaced = await UpsertOkAsync(userId, "SKANDIA", new UpsertGameProfileRequest(
            null, new Dictionary<string, string?> { ["Controls/Land.con"] = "land" }));

        var list = await service.ListAsync(userId);
        var only = Assert.Single(list);
        Assert.Equal("SKANDIA", only.Name);
        Assert.True(only.IsActive);
        Assert.Equal(["Controls/Land.con"], only.Files.Keys);
        // No GeneralOptions.con this time: the name it had stays.
        Assert.Equal("FromFile", replaced.PlayerName);
    }

    [Fact]
    public async Task PlayerName_IsGiven_ElseReadFromGeneralOptions_ElseTheProfileName()
    {
        var userId = await CreateUserAsync();

        Assert.Equal("Given", (await UpsertOkAsync(userId, "a", Request(playerName: "Given"))).PlayerName);
        Assert.Equal("FromFile", (await UpsertOkAsync(userId, "b")).PlayerName);
        Assert.Equal("c", (await UpsertOkAsync(userId, "c", Request(general: "game.setConnection 2"))).PlayerName);
    }

    [Fact]
    public async Task TheEleventhProfile_IsRefused_ButTheTenthCanStillBeReplaced()
    {
        var userId = await CreateUserAsync();
        for (var i = 0; i < GameProfileRules.MaxProfiles; i++) await UpsertOkAsync(userId, $"p{i}");

        var eleventh = await service.UpsertAsync(userId, "one-too-many", Request());
        Assert.Equal(GameProfileOutcome.LimitReached, eleventh.Outcome);

        await UpsertOkAsync(userId, "P9", Request(playerName: "Again"));
        Assert.Equal(GameProfileRules.MaxProfiles, (await service.ListAsync(userId)).Count);
    }

    [Fact]
    public async Task Upsert_RefusesBadNamesAndFiles()
    {
        var userId = await CreateUserAsync();

        Assert.Equal(GameProfileOutcome.Invalid, (await service.UpsertAsync(userId, "../etc", Request())).Outcome);
        var video = await service.UpsertAsync(userId, "ok", new UpsertGameProfileRequest(
            null, new Dictionary<string, string?> { ["Video.con"] = "x" }));
        Assert.Equal(GameProfileOutcome.Invalid, video.Outcome);
        Assert.Empty(await service.ListAsync(userId));
    }

    [Fact]
    public async Task MakeActive_And_Activate_MoveTheOneActiveProfile()
    {
        var userId = await CreateUserAsync();
        await UpsertOkAsync(userId, "a");
        await UpsertOkAsync(userId, "b", Request(makeActive: true));
        Assert.Equal("b", await ActiveAsync(userId));

        Assert.Equal(GameProfileOutcome.Ok, (await service.ActivateAsync(userId, "A")).Outcome);
        Assert.Equal("a", await ActiveAsync(userId));

        Assert.Equal(GameProfileOutcome.NotFound, (await service.ActivateAsync(userId, "missing")).Outcome);
        Assert.Equal("a", await ActiveAsync(userId));
    }

    [Fact]
    public async Task DeletingTheActiveProfile_ActivatesTheMostRecentlyUpdatedRemaining()
    {
        var userId = await CreateUserAsync();
        await UpsertOkAsync(userId, "active");
        await UpsertOkAsync(userId, "older");
        await UpsertOkAsync(userId, "newer");
        await UpsertOkAsync(userId, "older", Request(playerName: "Touched")); // now the newest

        Assert.Equal(GameProfileOutcome.Ok, (await service.DeleteAsync(userId, "ACTIVE")).Outcome);

        Assert.Equal("older", await ActiveAsync(userId));
    }

    [Fact]
    public async Task DeletingAnInactiveProfile_LeavesTheActiveOne()
    {
        var userId = await CreateUserAsync();
        await UpsertOkAsync(userId, "active");
        await UpsertOkAsync(userId, "other");

        await service.DeleteAsync(userId, "other");

        Assert.Equal("active", await ActiveAsync(userId));
        Assert.Equal(GameProfileOutcome.NotFound, (await service.DeleteAsync(userId, "other")).Outcome);
    }

    [Fact]
    public async Task Profiles_BelongToTheirOwnAccount()
    {
        var mine = await CreateUserAsync("me@example.com");
        var theirs = await CreateUserAsync("them@example.com");
        await UpsertOkAsync(mine, "shared-name");
        await UpsertOkAsync(theirs, "shared-name");

        Assert.Equal(GameProfileOutcome.Ok, (await service.DeleteAsync(mine, "shared-name")).Outcome);

        Assert.Empty(await service.ListAsync(mine));
        Assert.True(Assert.Single(await service.ListAsync(theirs)).IsActive);
    }

    [Fact]
    public async Task AProfileWithUnreadableFiles_StillLists()
    {
        var userId = await CreateUserAsync();
        await UpsertOkAsync(userId, "broken");
        await UpsertOkAsync(userId, "fine");
        await dbContext.GameProfiles.Where(p => p.Name == "broken")
            .ExecuteUpdateAsync(set => set.SetProperty(p => p.FilesJson, "{not json"));
        dbContext.ChangeTracker.Clear();

        var list = await service.ListAsync(userId);

        Assert.Equal(["broken", "fine"], list.Select(p => p.Name));
        Assert.Empty(list[0].Files);
        Assert.NotEmpty(list[1].Files);
    }

    [Fact]
    public async Task TheAccountExport_CarriesTheProfiles_AndErasureRemovesThem()
    {
        var userId = await CreateUserAsync();
        await UpsertOkAsync(userId, "skandia");
        var account = new AccountService(dbContext, NullLogger<AccountService>.Instance);

        var export = await account.ExportAsync(userId);
        var profile = Assert.Single(export!.GameProfiles!);
        Assert.Equal("skandia", profile.Name);
        Assert.Equal("FromFile", profile.PlayerName);
        Assert.True(profile.IsActive);
        Assert.Contains("GeneralOptions.con", profile.Files.Keys);

        var summary = await account.DeleteAsync(userId);
        Assert.Equal(1, summary!.GameProfilesRemoved);
        Assert.Empty(await dbContext.GameProfiles.Where(p => p.UserId == userId).ToListAsync());
    }
}
