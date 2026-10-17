using api.AdminData;
using api.AdminData.Models;
using api.Auth;
using api.PlayerTracking;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using NSubstitute;

namespace api.tests.AdminData;

public class AdminDataControllerUsersAndCommentsTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private static readonly Instant T0 = Instant.FromUtc(2026, 10, 1, 12, 0);

    public AdminDataControllerUsersAndCommentsTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();
        _dbContext = new PlayerTrackerDbContext(
            new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(_connection).Options);
        _dbContext.Database.EnsureCreated();
    }

    private AdminDataController BuildController() => new(
        Substitute.For<IAdminDataService>(),
        Substitute.For<IServerMergeService>(),
        _dbContext,
        new PasswordHashService(),
        new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(),
        NullLogger<AdminDataController>.Instance);

    private async Task<User> AddUserAsync(string email, string? username, DateTime created, DateTime lastLogin)
    {
        var user = new User
        {
            Email = email,
            Username = username,
            AuthProvider = username == null ? "discord" : "password",
            CreatedAt = created,
            LastLoggedIn = lastLogin,
            IsActive = true
        };
        _dbContext.Users.Add(user);
        await _dbContext.SaveChangesAsync();
        return user;
    }

    [Fact]
    public async Task GetUsers_ReturnsJoinedLastLoginAndLastActive()
    {
        var joined = new DateTime(2026, 1, 5, 9, 0, 0, DateTimeKind.Utc);
        var login = new DateTime(2026, 9, 1, 10, 0, 0, DateTimeKind.Utc);
        var refreshed = new DateTime(2026, 10, 10, 18, 30, 0, DateTimeKind.Utc);

        var active = await AddUserAsync("a@example.com", "Active", joined, login);
        _dbContext.RefreshTokens.Add(new RefreshToken
        {
            UserId = active.Id, TokenHash = "h1", CreatedAt = refreshed, ExpiresAt = refreshed.AddDays(60)
        });
        // Predates the LastLoggedIn column: MinValue means "never recorded".
        await AddUserAsync("b@example.com", null, joined, DateTime.MinValue);
        await _dbContext.SaveChangesAsync();

        var result = await BuildController().GetUsers();
        var users = Assert.IsType<List<UserWithRoleResponse>>(Assert.IsType<OkObjectResult>(result.Result).Value);

        var a = users.Single(u => u.Email == "a@example.com");
        Assert.Equal(Instant.FromDateTimeUtc(joined), a.JoinedAt);
        Assert.Equal(Instant.FromDateTimeUtc(login), a.LastLoggedInAt);
        Assert.Equal(Instant.FromDateTimeUtc(refreshed), a.LastActiveAt);

        var b = users.Single(u => u.Email == "b@example.com");
        Assert.Equal(Instant.FromDateTimeUtc(joined), b.JoinedAt);
        Assert.Null(b.LastLoggedInAt);
        Assert.Null(b.LastActiveAt);
    }

    [Fact]
    public async Task GetComments_MergesServerAndPlayerComments_NewestFirst_AndPages()
    {
        var discord = await AddUserAsync("d@example.com", null, DateTime.UtcNow, DateTime.UtcNow);
        var password = await AddUserAsync("p@example.com", "Pw", DateTime.UtcNow, DateTime.UtcNow);

        _dbContext.ServerComments.AddRange(
            new ServerComment { ServerName = "S1", Content = "s-oldest", AuthorUserId = discord.Id, AuthorPlayerName = "Dee", CreatedAt = T0, UpdatedAt = T0 },
            new ServerComment { ServerName = "S2", Content = "s-newest", AuthorUserId = password.Id, AuthorPlayerName = "Pee", CreatedAt = T0 + Duration.FromHours(4), UpdatedAt = T0 + Duration.FromHours(4) });
        _dbContext.PlayerComments.AddRange(
            new PlayerComment { PlayerName = "P1", Content = "p-middle", AuthorUserId = password.Id, AuthorPlayerName = "Pee", CreatedAt = T0 + Duration.FromHours(2), UpdatedAt = T0 + Duration.FromHours(2) });
        await _dbContext.SaveChangesAsync();

        var controller = BuildController();

        var all = Page(await controller.GetComments(page: 1, pageSize: 2));
        Assert.Equal(3, all.TotalCount);
        Assert.Equal(2, all.ServerCount);
        Assert.Equal(1, all.PlayerCount);
        Assert.Equal(["s-newest", "p-middle"], all.Items.Select(i => i.Content));
        Assert.Equal("server", all.Items[0].Kind);
        Assert.Equal("S2", all.Items[0].Target);
        Assert.Equal("Pw", all.Items[0].AuthorAccount);
        Assert.Equal("player", all.Items[1].Kind);

        var page2 = Page(await controller.GetComments(page: 2, pageSize: 2));
        var last = Assert.Single(page2.Items);
        Assert.Equal("s-oldest", last.Content);
        Assert.Equal("d@example.com", last.AuthorAccount);

        var playersOnly = Page(await controller.GetComments(kind: "player"));
        Assert.Equal(1, playersOnly.TotalCount);
        Assert.Equal(["p-middle"], playersOnly.Items.Select(i => i.Content));

        var serversOnly = Page(await controller.GetComments(kind: "server"));
        Assert.Equal(2, serversOnly.TotalCount);
        Assert.Equal(["s-newest", "s-oldest"], serversOnly.Items.Select(i => i.Content));
    }

    private static PagedAdminCommentsResponse Page(ActionResult<PagedAdminCommentsResponse> result) =>
        Assert.IsType<PagedAdminCommentsResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }
}
