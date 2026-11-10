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
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace api.tests.Auth;

/// <summary>
/// Seq Slow 02:07Z 11-10: Discord login sat CommandTimeout(60) on
/// <c>UPDATE Users SET LastLoggedIn</c> during the hourly writer, then HTTP 500.
/// </summary>
public sealed class AuthLoginSqliteBusyTests
{
    private const string Email = "recruit@example.com";

    [Fact]
    public async Task Login_ExistingUser_SkipsLastLoginWrite_WhenDatabaseIsLocked()
    {
        await using var harness = await Harness.CreateAsync(realRefreshTokens: false);
        var previous = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        await harness.SeedUserAsync(previous);

        await harness.BeginExclusiveAsync();
        var started = Stopwatch.GetTimestamp();
        var result = await harness.Controller.Login(DiscordLogin());
        var elapsed = Stopwatch.GetElapsedTime(started);
        await harness.RollbackAsync();

        Assert.IsType<OkObjectResult>(result);
        Assert.True(elapsed < TimeSpan.FromSeconds(5), $"waited {elapsed.TotalMilliseconds}ms under a lock");
        Assert.Equal(previous, await harness.ReadLastLoggedInAsync());
    }

    [Fact]
    public async Task Login_ExistingUser_Returns503_WhenTokenWriteIsLocked()
    {
        await using var harness = await Harness.CreateAsync(realRefreshTokens: true);
        await harness.SeedUserAsync(DateTime.UtcNow);

        await harness.BeginExclusiveAsync();
        var started = Stopwatch.GetTimestamp();
        var result = await harness.Controller.Login(DiscordLogin());
        var elapsed = Stopwatch.GetElapsedTime(started);
        await harness.RollbackAsync();

        var status = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status503ServiceUnavailable, status.StatusCode);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");
        Assert.Empty(await harness.Db.RefreshTokens.AsNoTracking().ToListAsync());
    }

    [Fact]
    public async Task Login_ExistingUser_UpdatesLastLogin_WhenUnlocked()
    {
        await using var harness = await Harness.CreateAsync(realRefreshTokens: true);
        var previous = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        await harness.SeedUserAsync(previous);

        var result = await harness.Controller.Login(DiscordLogin());

        Assert.IsType<OkObjectResult>(result);
        var stored = await harness.ReadLastLoggedInAsync();
        Assert.True(stored > previous);
        Assert.Single(await harness.Db.RefreshTokens.AsNoTracking().ToListAsync());
    }

    private static LoginRequest DiscordLogin() =>
        new() { DiscordCode = "code", RedirectUri = "https://bfstats.io/auth/discord/callback" };

    private sealed class Harness : IAsyncDisposable
    {
        private readonly string path;
        private readonly SqliteConnection connection;
        private SqliteConnection? locker;

        private Harness(string path, SqliteConnection connection, PlayerTrackerDbContext db, AuthController controller)
        {
            this.path = path;
            this.connection = connection;
            Db = db;
            Controller = controller;
        }

        public PlayerTrackerDbContext Db { get; }
        public AuthController Controller { get; }

        public static async Task<Harness> CreateAsync(bool realRefreshTokens)
        {
            var path = Path.Combine(Path.GetTempPath(), $"login-lock-{Guid.NewGuid():N}.db");
            var connection = new SqliteConnection($"Data Source={path}");
            await connection.OpenAsync();
            await using (var pragma = connection.CreateCommand())
            {
                pragma.CommandText = "PRAGMA journal_mode=WAL";
                await pragma.ExecuteNonQueryAsync();
            }

            var db = new PlayerTrackerDbContext(
                new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options);
            await db.Database.EnsureCreatedAsync();

            var discord = Substitute.For<IDiscordAuthService>();
            discord.ExchangeCodeForUserAsync(Arg.Any<string>(), Arg.Any<string>(), Arg.Any<string?>())
                .Returns(new DiscordUserPayload { Email = Email, Username = "skandia" });

            var tokens = Substitute.For<ITokenService>();
            tokens.CreateAccessToken(Arg.Any<User>())
                .Returns(call => ($"access-for-{call.Arg<User>().Id}", DateTime.UtcNow.AddHours(1)));

            IRefreshTokenService refresh;
            if (realRefreshTokens)
            {
                var config = new ConfigurationBuilder()
                    .AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["RefreshToken:Secret"] = "test-secret-for-login-lock",
                    })
                    .Build();
                refresh = new RefreshTokenService(db, config);
            }
            else
            {
                refresh = Substitute.For<IRefreshTokenService>();
                refresh.CreateAsync(Arg.Any<User>(), Arg.Any<string>(), Arg.Any<string>())
                    .Returns(Task.FromResult(("raw-refresh", new RefreshToken { ExpiresAt = DateTime.UtcNow.AddDays(7) })));
            }

            var controller = new AuthController(
                db,
                discord,
                Substitute.For<ILogger<AuthController>>(),
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

            return new Harness(path, connection, db, controller);
        }

        public async Task SeedUserAsync(DateTime lastLoggedIn)
        {
            Db.Users.Add(new User
            {
                Email = Email,
                CreatedAt = lastLoggedIn,
                LastLoggedIn = lastLoggedIn,
                IsActive = true
            });
            await Db.SaveChangesAsync();
        }

        public async Task BeginExclusiveAsync()
        {
            locker = new SqliteConnection($"Data Source={path}");
            await locker.OpenAsync();
            await using var begin = locker.CreateCommand();
            begin.CommandText = "BEGIN EXCLUSIVE";
            await begin.ExecuteNonQueryAsync();
        }

        public async Task RollbackAsync()
        {
            if (locker is null) return;
            await using var rollback = locker.CreateCommand();
            rollback.CommandText = "ROLLBACK";
            await rollback.ExecuteNonQueryAsync();
        }

        public async Task<DateTime> ReadLastLoggedInAsync()
        {
            Db.ChangeTracker.Clear();
            return (await Db.Users.AsNoTracking().SingleAsync()).LastLoggedIn;
        }

        public async ValueTask DisposeAsync()
        {
            if (locker is not null) await locker.DisposeAsync();
            await Db.DisposeAsync();
            await connection.DisposeAsync();
            try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
        }
    }
}
