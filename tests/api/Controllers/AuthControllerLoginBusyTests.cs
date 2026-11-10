using System.Diagnostics;
using api.Auth;
using api.Auth.Models;
using api.Caching;
using api.PlayerTracking;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.Controllers;

/// <summary>
/// Seq Slow 02:09Z 11-10: Discord login spent the code, then
/// <c>UPDATE Users SET LastLoggedIn</c> sat CommandTimeout(60) behind the hourly
/// writer and returned 500. LastLoggedIn is telemetry — skip it on SQLITE_BUSY
/// and still issue tokens. Required writes (new user, refresh token) fail in 5s
/// as 503 instead of a minute-long 500.
/// </summary>
public sealed class AuthControllerLoginBusyTests
{
    private const string Email = "player@example.com";
    private const string Redirect = "https://bfstats.io/auth/discord/callback";
    private static readonly DateTime PreviousLogin = new(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Login_ExistingUser_SkipsLastLoginWrite_WhenHourlyHoldsTheLock()
    {
        var path = Path.Combine(Path.GetTempPath(), $"login-last-login-{Guid.NewGuid():N}.db");
        await using var connection = await OpenWalAsync(path);
        await using var db = CreateDb(connection);
        await db.Database.EnsureCreatedAsync();
        var user = await SeedUserAsync(db);

        var refresh = Substitute.For<IRefreshTokenService>();
        refresh.CreateAsync(Arg.Any<User>(), Arg.Any<string>(), Arg.Any<string>())
            .Returns(Task.FromResult(("raw-refresh", new RefreshToken { ExpiresAt = DateTime.UtcNow.AddDays(7) })));
        var controller = CreateController(db, refresh);

        await using var locker = await BeginImmediateAsync(path);
        var started = Stopwatch.GetTimestamp();
        var result = await controller.Login(new LoginRequest { DiscordCode = "code", RedirectUri = Redirect });
        var elapsed = Stopwatch.GetElapsedTime(started);
        await RollbackAsync(locker);

        var ok = Assert.IsType<OkObjectResult>(result);
        var body = Assert.IsType<LoginResponse>(ok.Value);
        Assert.Equal(user.Id, body.User.Id);
        Assert.Equal("access-for-" + user.Id, body.AccessToken);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");

        await db.Entry(user).ReloadAsync();
        Assert.Equal(PreviousLogin, user.LastLoggedIn);

        TryDelete(path);
    }

    [Fact]
    public async Task Login_ExistingUser_Returns503_WhenRefreshTokenWriteIsLocked()
    {
        var path = Path.Combine(Path.GetTempPath(), $"login-refresh-{Guid.NewGuid():N}.db");
        await using var connection = await OpenWalAsync(path);
        await using var db = CreateDb(connection);
        await db.Database.EnsureCreatedAsync();
        await SeedUserAsync(db);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RefreshToken:Secret"] = "test-secret-for-login-busy" })
            .Build();
        var controller = CreateController(db, new RefreshTokenService(db, config));

        await using var locker = await BeginImmediateAsync(path);
        var started = Stopwatch.GetTimestamp();
        var result = await controller.Login(new LoginRequest { DiscordCode = "code", RedirectUri = Redirect });
        var elapsed = Stopwatch.GetElapsedTime(started);
        await RollbackAsync(locker);

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, obj.StatusCode);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");

        TryDelete(path);
    }

    [Fact]
    public async Task Login_NewUser_Returns503_WhenInsertIsLocked()
    {
        var path = Path.Combine(Path.GetTempPath(), $"login-create-{Guid.NewGuid():N}.db");
        await using var connection = await OpenWalAsync(path);
        await using var db = CreateDb(connection);
        await db.Database.EnsureCreatedAsync();

        var refresh = Substitute.For<IRefreshTokenService>();
        var controller = CreateController(db, refresh);

        await using var locker = await BeginImmediateAsync(path);
        var started = Stopwatch.GetTimestamp();
        var result = await controller.Login(new LoginRequest { DiscordCode = "code", RedirectUri = Redirect });
        var elapsed = Stopwatch.GetElapsedTime(started);
        await RollbackAsync(locker);

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, obj.StatusCode);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");
        await refresh.DidNotReceiveWithAnyArgs().CreateAsync(default!, default, default);
        Assert.Empty(await db.Users.ToListAsync());

        TryDelete(path);
    }

    [Fact]
    public async Task Login_ExistingUser_UpdatesLastLogin_WhenTheWriterIsFree()
    {
        var path = Path.Combine(Path.GetTempPath(), $"login-free-{Guid.NewGuid():N}.db");
        await using var connection = await OpenWalAsync(path);
        await using var db = CreateDb(connection);
        await db.Database.EnsureCreatedAsync();
        var user = await SeedUserAsync(db);

        var refresh = Substitute.For<IRefreshTokenService>();
        refresh.CreateAsync(Arg.Any<User>(), Arg.Any<string>(), Arg.Any<string>())
            .Returns(Task.FromResult(("raw-refresh", new RefreshToken { ExpiresAt = DateTime.UtcNow.AddDays(7) })));
        var controller = CreateController(db, refresh);

        var result = await controller.Login(new LoginRequest { DiscordCode = "code", RedirectUri = Redirect });

        Assert.IsType<OkObjectResult>(result);
        await db.Entry(user).ReloadAsync();
        Assert.True(user.LastLoggedIn > PreviousLogin);

        TryDelete(path);
    }

    private static AuthController CreateController(PlayerTrackerDbContext db, IRefreshTokenService refresh)
    {
        var discord = Substitute.For<IDiscordAuthService>();
        discord.ExchangeCodeForUserAsync("code", Redirect, Arg.Any<string?>())
            .Returns(new DiscordUserPayload { Email = Email, Username = "Player" });

        var tokens = Substitute.For<ITokenService>();
        tokens.CreateAccessToken(Arg.Any<User>())
            .Returns(call => ($"access-for-{call.Arg<User>().Id}", DateTime.UtcNow.AddDays(7)));

        return new AuthController(
            db,
            discord,
            NullLogger<AuthController>.Instance,
            tokens,
            refresh,
            Substitute.For<IAccountService>(),
            Substitute.For<IPasswordHashService>(),
            Substitute.For<IEmailHashService>(),
            Substitute.For<IEmailSender>(),
            Substitute.For<ICacheService>(),
            Substitute.For<IConfiguration>())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };
    }

    private static PlayerTrackerDbContext CreateDb(SqliteConnection connection) =>
        new(new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);

    private static async Task<User> SeedUserAsync(PlayerTrackerDbContext db)
    {
        var user = new User
        {
            Email = Email,
            CreatedAt = PreviousLogin,
            LastLoggedIn = PreviousLogin,
            IsActive = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static async Task<SqliteConnection> OpenWalAsync(string path)
    {
        var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        await using var wal = connection.CreateCommand();
        wal.CommandText = "PRAGMA journal_mode=WAL";
        await wal.ExecuteNonQueryAsync();
        return connection;
    }

    private static async Task<SqliteConnection> BeginImmediateAsync(string path)
    {
        var locker = new SqliteConnection($"Data Source={path}");
        await locker.OpenAsync();
        await using var begin = locker.CreateCommand();
        begin.CommandText = "BEGIN IMMEDIATE";
        await begin.ExecuteNonQueryAsync();
        return locker;
    }

    private static async Task RollbackAsync(SqliteConnection locker)
    {
        await using var rollback = locker.CreateCommand();
        rollback.CommandText = "ROLLBACK";
        await rollback.ExecuteNonQueryAsync();
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
        try { File.Delete(path + "-wal"); } catch (IOException) { }
        try { File.Delete(path + "-shm"); } catch (IOException) { }
    }
}
