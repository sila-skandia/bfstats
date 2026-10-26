using System.Diagnostics;
using api.AppSignIn;
using api.AppSignIn.Models;
using api.Auth;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using NSubstitute;

namespace api.tests.AppSignIn;

public sealed class AppSignInBusyLockTests
{
    [Fact]
    public async Task Refresh_ReturnsBusy_WhenAnotherWriterHoldsTheLock()
    {
        var path = Path.Combine(Path.GetTempPath(), $"app-refresh-lock-{Guid.NewGuid():N}.db");
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        await using var db = new PlayerTrackerDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RefreshToken:Secret"] = "test-secret-for-app-sign-in" })
            .Build();
        var refreshTokens = new RefreshTokenService(db, config);
        var tokens = Substitute.For<ITokenService>();
        tokens.CreateAccessToken(Arg.Any<User>())
            .Returns(call => ($"access-for-{call.Arg<User>().Id}", DateTime.UtcNow.AddDays(7)));
        var clock = SystemClock.Instance;
        var service = new AppSignInService(db, refreshTokens, tokens, clock, NullLogger<AppSignInService>.Instance);

        var user = new User { Email = "player@example.com", CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var authorized = await service.AuthorizeAsync(user.Id, new AuthorizeAppRequest(
            AppSignInRules.SidecarClient, "pc", "http://127.0.0.1:53682/callback", "st4te",
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "S256"));
        Assert.Equal(AppSignInOutcome.Ok, authorized.Outcome);
        var exchanged = await service.ExchangeAsync(
            new AppTokenRequest(authorized.Value!.Code, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
                "http://127.0.0.1:53682/callback"),
            null, null);
        Assert.Equal(AppSignInOutcome.Ok, exchanged.Outcome);

        await using var locker = new SqliteConnection($"Data Source={path}");
        await locker.OpenAsync();
        await using var begin = locker.CreateCommand();
        begin.CommandText = "BEGIN EXCLUSIVE";
        await begin.ExecuteNonQueryAsync();

        var started = Stopwatch.GetTimestamp();
        var result = await service.RefreshAsync(exchanged.Value!.RefreshToken, null, null);
        var elapsed = Stopwatch.GetElapsedTime(started);

        Assert.Equal(AppSignInOutcome.Busy, result.Outcome);
        Assert.Contains("busy updating", result.Message);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");

        await using var rollback = locker.CreateCommand();
        rollback.CommandText = "ROLLBACK";
        await rollback.ExecuteNonQueryAsync();

        try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
    }
}
