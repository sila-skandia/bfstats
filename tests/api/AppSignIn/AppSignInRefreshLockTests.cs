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

/// <summary>
/// A RefreshTokens INSERT sits behind another writer the way the hourly
/// incremental does. The write must fail fast instead of parking for CommandTimeout(60).
/// </summary>
public sealed class AppSignInRefreshLockTests
{
    private const string Redirect = "http://127.0.0.1:53682/callback";
    private const string Verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    private const string Challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    [Fact]
    public async Task Refresh_ReturnsBusy_WhenAnotherWriterHoldsTheLock()
    {
        var path = Path.Combine(Path.GetTempPath(), $"rt-lock-{Guid.NewGuid():N}.db");
        await using var connection = new SqliteConnection($"Data Source={path}");
        await connection.OpenAsync();
        await using var wal = connection.CreateCommand();
        wal.CommandText = "PRAGMA journal_mode=WAL";
        await wal.ExecuteNonQueryAsync();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(connection).Options;
        await using var db = new PlayerTrackerDbContext(options);
        await db.Database.EnsureCreatedAsync();

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RefreshToken:Secret"] = "test-secret-for-app-sign-in" })
            .Build();
        var refreshTokens = new RefreshTokenService(db, config, NullLogger<RefreshTokenService>.Instance);
        var tokens = Substitute.For<ITokenService>();
        tokens.CreateAccessToken(Arg.Any<User>())
            .Returns(call => ($"access-for-{call.Arg<User>().Id}", DateTime.UtcNow.AddDays(7)));
        var service = new AppSignInService(db, refreshTokens, tokens, SystemClock.Instance, NullLogger<AppSignInService>.Instance);

        var user = new User { Email = "player@example.com", CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var authorized = await service.AuthorizeAsync(user.Id, new AuthorizeAppRequest(
            AppSignInRules.SidecarClient, "DESKTOP-42", Redirect, "st4te", Challenge, "S256"));
        Assert.Equal(AppSignInOutcome.Ok, authorized.Outcome);
        var exchanged = await service.ExchangeAsync(
            new AppTokenRequest(authorized.Value!.Code, Verifier, Redirect), "203.0.113.9", "ua");
        Assert.Equal(AppSignInOutcome.Ok, exchanged.Outcome);

        await using var locker = new SqliteConnection($"Data Source={path}");
        await locker.OpenAsync();
        await using var begin = locker.CreateCommand();
        begin.CommandText = "BEGIN IMMEDIATE";
        await begin.ExecuteNonQueryAsync();

        var started = Stopwatch.GetTimestamp();
        var result = await service.RefreshAsync(exchanged.Value!.RefreshToken, "203.0.113.9", "ua");
        var elapsed = Stopwatch.GetElapsedTime(started);

        Assert.Equal(AppSignInOutcome.Busy, result.Outcome);
        Assert.Equal("temporarily_unavailable", result.Error);
        Assert.Contains("busy updating", result.Message);
        Assert.True(elapsed < TimeSpan.FromSeconds(10), $"waited {elapsed.TotalMilliseconds}ms under a lock");

        await using var rollback = locker.CreateCommand();
        rollback.CommandText = "ROLLBACK";
        await rollback.ExecuteNonQueryAsync();

        try { File.Delete(path); } catch (IOException) { /* leftover until reboot */ }
    }
}
