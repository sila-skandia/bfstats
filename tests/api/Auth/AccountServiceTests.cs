using api.Auth;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.Auth;

public sealed class AccountServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly AccountService service;

    public AccountServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        service = new AccountService(dbContext, NullLogger<AccountService>.Instance);
    }

    private async Task<User> CreateUserAsync(string email = "player@example.com", string? role = null)
    {
        var user = new User
        {
            Email = email,
            Role = role,
            CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
            LastLoggedIn = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
            IsActive = true
        };
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task DeleteAsync_RemovesEveryPieceOfPersonalData()
    {
        var user = await CreateUserAsync();
        dbContext.Servers.Add(new GameServer { Guid = "server-1", Name = "Test Server" });
        dbContext.Players.Add(new Player { Name = "Patton" }); // UserBuddy has an FK onto Player.Name
        dbContext.UserPlayerNames.Add(new UserPlayerName { UserId = user.Id, PlayerName = "Rommel", CreatedAt = DateTime.UtcNow });
        dbContext.UserFavoriteServers.Add(new UserFavoriteServer { UserId = user.Id, ServerGuid = "server-1", CreatedAt = DateTime.UtcNow });
        dbContext.UserBuddies.Add(new UserBuddy { UserId = user.Id, BuddyPlayerName = "Patton", CreatedAt = DateTime.UtcNow });
        dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = "hash",
            IpAddress = "203.0.113.9",
            UserAgent = "Firefox",
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(30)
        });
        await dbContext.SaveChangesAsync();

        var summary = await service.DeleteAsync(user.Id);

        Assert.NotNull(summary);
        Assert.Equal(1, summary!.AliasesRemoved);
        Assert.Equal(1, summary.FavouriteServersRemoved);
        Assert.Equal(1, summary.BuddiesRemoved);
        Assert.Equal(1, summary.SessionsRevoked);

        Assert.Empty(await dbContext.UserPlayerNames.Where(x => x.UserId == user.Id).ToListAsync());
        Assert.Empty(await dbContext.UserFavoriteServers.Where(x => x.UserId == user.Id).ToListAsync());
        Assert.Empty(await dbContext.UserBuddies.Where(x => x.UserId == user.Id).ToListAsync());
        Assert.Empty(await dbContext.RefreshTokens.Where(x => x.UserId == user.Id).ToListAsync());
    }

    [Fact]
    public async Task DeleteAsync_WipesTheEmailAndRole()
    {
        var user = await CreateUserAsync("real.person@example.com", role: "Support");

        await service.DeleteAsync(user.Id);

        var tombstoned = await dbContext.Users.AsNoTracking().FirstAsync(u => u.Id == user.Id);
        Assert.DoesNotContain("real.person", tombstoned.Email);
        Assert.EndsWith("@deleted.invalid", tombstoned.Email);
        Assert.Null(tombstoned.Role);
        Assert.False(tombstoned.IsActive);
    }

    [Fact]
    public async Task DeleteAsync_SucceedsForATournamentOrganiserAndKeepsTheTournament()
    {
        // The case a hard DELETE FROM Users would fail on: Tournament pins its
        // creator with DeleteBehavior.Restrict.
        var user = await CreateUserAsync("organiser@example.com");
        dbContext.Players.Add(new Player { Name = "Organiser" });
        dbContext.Tournaments.Add(new Tournament
        {
            Name = "Summer Cup",
            Organizer = "Organiser",
            Game = "bf1942",
            CreatedAt = SystemClock.Instance.GetCurrentInstant(),
            CreatedByUserId = user.Id,
            CreatedByUserEmail = "organiser@example.com"
        });
        await dbContext.SaveChangesAsync();

        var summary = await service.DeleteAsync(user.Id);

        Assert.NotNull(summary);
        Assert.Equal(1, summary!.TournamentsAnonymised);

        var tournament = await dbContext.Tournaments.AsNoTracking().FirstAsync();
        Assert.Equal("Summer Cup", tournament.Name);
        Assert.DoesNotContain("organiser@example.com", tournament.CreatedByUserEmail);
        Assert.EndsWith("@deleted.invalid", tournament.CreatedByUserEmail);
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheUsersCommentsButLeavesOtherPeoplesAlone()
    {
        var user = await CreateUserAsync();
        var other = await CreateUserAsync("someone.else@example.com");
        var now = SystemClock.Instance.GetCurrentInstant();

        dbContext.PlayerComments.Add(new PlayerComment
        {
            PlayerName = "Rommel", Content = "gg", AuthorUserId = user.Id,
            AuthorPlayerName = "Patton", CreatedAt = now, UpdatedAt = now
        });
        dbContext.ServerComments.Add(new ServerComment
        {
            ServerName = "Test Server", Content = "laggy", AuthorUserId = user.Id,
            AuthorPlayerName = "Patton", CreatedAt = now, UpdatedAt = now
        });
        dbContext.PlayerComments.Add(new PlayerComment
        {
            PlayerName = "Rommel", Content = "keep me", AuthorUserId = other.Id,
            AuthorPlayerName = "Bradley", CreatedAt = now, UpdatedAt = now
        });
        await dbContext.SaveChangesAsync();

        var summary = await service.DeleteAsync(user.Id);

        Assert.Equal(2, summary!.CommentsRemoved);
        var remaining = await dbContext.PlayerComments.AsNoTracking().ToListAsync();
        Assert.Single(remaining);
        Assert.Equal("keep me", remaining[0].Content);
    }

    [Fact]
    public async Task DeleteAsync_UnlinksTournamentRostersWithoutErasingTheRoster()
    {
        var user = await CreateUserAsync();
        dbContext.Players.Add(new Player { Name = "Organiser" });
        var tournament = new Tournament
        {
            Name = "Summer Cup", Organizer = "Organiser", Game = "bf1942",
            CreatedAt = SystemClock.Instance.GetCurrentInstant(),
            CreatedByUserId = user.Id, CreatedByUserEmail = "player@example.com"
        };
        dbContext.Tournaments.Add(tournament);
        await dbContext.SaveChangesAsync();

        var team = new TournamentTeam
        {
            TournamentId = tournament.Id, Name = "Desert Rats",
            LeaderUserId = user.Id, CreatedAt = SystemClock.Instance.GetCurrentInstant()
        };
        dbContext.TournamentTeams.Add(team);
        await dbContext.SaveChangesAsync();

        dbContext.Players.Add(new Player { Name = "Monty" });
        dbContext.TournamentTeamPlayers.Add(new TournamentTeamPlayer
        {
            TournamentTeamId = team.Id, PlayerName = "Monty", UserId = user.Id,
            JoinedAt = SystemClock.Instance.GetCurrentInstant()
        });
        await dbContext.SaveChangesAsync();

        await service.DeleteAsync(user.Id);

        var roster = await dbContext.TournamentTeamPlayers.AsNoTracking().SingleAsync();
        Assert.Equal("Monty", roster.PlayerName);   // competition record survives
        Assert.Null(roster.UserId);                 // account link is severed

        var savedTeam = await dbContext.TournamentTeams.AsNoTracking().SingleAsync();
        Assert.Null(savedTeam.LeaderUserId);
    }

    [Fact]
    public async Task DeleteAsync_FreesTheEmailSoASubsequentSignInGetsAFreshAccount()
    {
        var user = await CreateUserAsync("returning@example.com");
        await service.DeleteAsync(user.Id);

        // Users.Email is uniquely indexed — this insert is what proves the
        // address was genuinely released rather than merely flagged inactive.
        dbContext.Users.Add(new User
        {
            Email = "returning@example.com",
            CreatedAt = DateTime.UtcNow,
            LastLoggedIn = DateTime.UtcNow,
            IsActive = true
        });
        await dbContext.SaveChangesAsync();

        var accounts = await dbContext.Users.AsNoTracking()
            .Where(u => u.Email == "returning@example.com").ToListAsync();
        Assert.Single(accounts);
        Assert.NotEqual(user.Id, accounts[0].Id);
    }

    [Fact]
    public async Task DeleteAsync_IsIdempotentAndReturnsNullOnASecondCall()
    {
        var user = await CreateUserAsync();

        Assert.NotNull(await service.DeleteAsync(user.Id));
        Assert.Null(await service.DeleteAsync(user.Id));
    }

    [Fact]
    public async Task DeleteAsync_ReturnsNullForAnUnknownAccount()
    {
        Assert.Null(await service.DeleteAsync(4242));
    }

    [Fact]
    public async Task ExportAsync_ReturnsAccountDataWithoutLeakingTheTokenHash()
    {
        var user = await CreateUserAsync();
        dbContext.UserPlayerNames.Add(new UserPlayerName { UserId = user.Id, PlayerName = "Rommel", CreatedAt = DateTime.UtcNow });
        dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = user.Id,
            TokenHash = "super-secret-hash",
            IpAddress = "203.0.113.9",
            UserAgent = "Firefox",
            CreatedAt = DateTime.UtcNow,
            ExpiresAt = DateTime.UtcNow.AddDays(30)
        });
        await dbContext.SaveChangesAsync();

        var export = await service.ExportAsync(user.Id);

        Assert.NotNull(export);
        Assert.Equal("player@example.com", export!.Profile.Email);
        Assert.Equal("Rommel", Assert.Single(export.LinkedPlayerNames).PlayerName);

        var session = Assert.Single(export.Sessions);
        Assert.Equal("203.0.113.9", session.IpAddress);
        var serialised = System.Text.Json.JsonSerializer.Serialize(export);
        Assert.DoesNotContain("super-secret-hash", serialised);
    }

    [Fact]
    public async Task ExportAsync_ReturnsNullOnceTheAccountIsErased()
    {
        var user = await CreateUserAsync();
        await service.DeleteAsync(user.Id);

        Assert.Null(await service.ExportAsync(user.Id));
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
