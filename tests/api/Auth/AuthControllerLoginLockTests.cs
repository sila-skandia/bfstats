using System.Diagnostics;
using System.Text.Json;
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

namespace api.tests.Auth;

/// <summary>
/// POST /stats/auth/login vs a writer holding the SQLite lock (the hourly
/// incremental). LastLoggedIn is skipped; a refresh-token INSERT that still
/// cannot land returns 503 in ~5s instead of hanging CommandTimeout(60).
/// </summary>
public sealed class AuthControllerLoginLockTests
{
    [Fact]
    public async Task Login_ReturnsBusy_WhenAnotherWriterHoldsTheLock()
    {
        var path = Path.Combine(Path.GetTempPath(), $"login-lock-{Guid.NewGuid():N}.db");
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        await using var db = new PlayerTrackerDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ASPNETCORE_ENVIRONMENT"] = "Development",
                ["RefreshToken:Secret"] = "test-secret-for-login-lock",
            })
            .Build();
        var refresh = new RefreshTokenService(db, config);
        var tokens = Substitute.For<ITokenService>();
        tokens.CreateAccessToken(Arg.Any<User>())
            .Returns(call => ($"access-for-{call.Arg<User>().Id}", DateTime.UtcNow.AddDays(7)));

        var controller = new AuthController(
            db,
            Substitute.For<IDiscordAuthService>(),
            NullLogger<AuthController>.Instance,
            tokens,
            refresh,
            Substitute.For<IAccountService>(),
            Substitute.For<IPasswordHashService>(),
            Substitute.For<IEmailHashService>(),
            Substitute.For<IEmailSender>(),
            Substitute.For<ICacheService>(),
            config)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        db.Users.Add(new User
        {
            Email = "admin@bfstats.io",
            CreatedAt = DateTime.UtcNow,
            LastLoggedIn = DateTime.UtcNow.AddDays(-1),
            IsActive = true
        });
        await db.SaveChangesAsync();

        await using var locker = new SqliteConnection($"Data Source={path}");
        await locker.OpenAsync();
        await using var begin = locker.CreateCommand();
        begin.CommandText = "BEGIN IMMEDIATE";
        await begin.ExecuteNonQueryAsync();

        var started = Stopwatch.GetTimestamp();
        var result = await controller.Login(new LoginRequest { DevBypass = true });
        var elapsed = Stopwatch.GetElapsedTime(started);

        var obj = Assert.IsType<ObjectResult>(result);
        Assert.Equal(503, obj.StatusCode);
        var json = JsonSerializer.Serialize(obj.Value);
        Assert.Contains("busy updating", json, StringComparison.OrdinalIgnoreCase);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");

        await using var rollback = locker.CreateCommand();
        rollback.CommandText = "ROLLBACK";
        await rollback.ExecuteNonQueryAsync();

        try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
    }

    [Fact]
    public async Task Login_SkipsLastLogin_AndSignsIn_WhenRefreshWriteIsNotContended()
    {
        var path = Path.Combine(Path.GetTempPath(), $"login-skip-{Guid.NewGuid():N}.db");
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        await using var db = new PlayerTrackerDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ASPNETCORE_ENVIRONMENT"] = "Development",
                ["RefreshToken:Secret"] = "test-secret-for-login-lock",
            })
            .Build();

        var seededLogin = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var user = new User
        {
            Email = "admin@bfstats.io",
            CreatedAt = seededLogin,
            LastLoggedIn = seededLogin,
            IsActive = true
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var refresh = Substitute.For<IRefreshTokenService>();
        refresh.CreateAsync(Arg.Any<User>(), Arg.Any<string?>(), Arg.Any<string?>())
            .Returns(Task.FromResult(("raw-refresh", new RefreshToken { ExpiresAt = DateTime.UtcNow.AddDays(7) })));
        var tokens = Substitute.For<ITokenService>();
        tokens.CreateAccessToken(Arg.Any<User>())
            .Returns(("access-token", DateTime.UtcNow.AddDays(7)));

        var controller = new AuthController(
            db,
            Substitute.For<IDiscordAuthService>(),
            NullLogger<AuthController>.Instance,
            tokens,
            refresh,
            Substitute.For<IAccountService>(),
            Substitute.For<IPasswordHashService>(),
            Substitute.For<IEmailHashService>(),
            Substitute.For<IEmailSender>(),
            Substitute.For<ICacheService>(),
            config)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

        await using var locker = new SqliteConnection($"Data Source={path}");
        await locker.OpenAsync();
        await using var begin = locker.CreateCommand();
        begin.CommandText = "BEGIN IMMEDIATE";
        await begin.ExecuteNonQueryAsync();

        var started = Stopwatch.GetTimestamp();
        var result = await controller.Login(new LoginRequest { DevBypass = true });
        var elapsed = Stopwatch.GetElapsedTime(started);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.IsType<LoginResponse>(ok.Value);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");
        refresh.Received(1).SetCookie(Arg.Any<HttpResponse>(), "raw-refresh", Arg.Any<DateTime>());

        await using var rollback = locker.CreateCommand();
        rollback.CommandText = "ROLLBACK";
        await rollback.ExecuteNonQueryAsync();

        await using var check = new PlayerTrackerDbContext(options);
        var stored = await check.Users.SingleAsync(u => u.Email == "admin@bfstats.io");
        Assert.Equal(seededLogin, stored.LastLoggedIn);

        try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
    }
}
