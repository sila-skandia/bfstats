using api.GameProfiles;
using api.GameProfiles.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.GameProfiles;

/// <summary>
/// A Recreate-extra / hourly writer holding SQLite must not park a game-profile
/// PATCH for CommandTimeout (60s). The write fails fast with Busy.
/// </summary>
public sealed class GameProfileBusyTests : IDisposable
{
    private sealed class FixedClock : IClock
    {
        public Instant GetCurrentInstant() => Instant.FromUtc(2026, 10, 25, 12, 0);
    }

    private readonly string dbPath = Path.Combine(Path.GetTempPath(), $"gp-busy-{Guid.NewGuid():N}.db");
    private readonly PlayerTrackerDbContext dbContext;
    private readonly GameProfileService service;

    public GameProfileBusyTests()
    {
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite($"Data Source={dbPath}").Options;
        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();
        service = new GameProfileService(dbContext, new FixedClock(), NullLogger<GameProfileService>.Instance);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        try { File.Delete(dbPath); } catch (IOException) { /* still open on a late locker */ }
        try { File.Delete(dbPath + "-wal"); } catch (IOException) { }
        try { File.Delete(dbPath + "-shm"); } catch (IOException) { }
    }

    [Fact]
    public async Task Patch_WhileAnotherConnectionHoldsTheWriteLock_ReturnsBusy()
    {
        var user = new User { Email = "player@example.com", CreatedAt = DateTime.UtcNow, LastLoggedIn = DateTime.UtcNow };
        dbContext.Users.Add(user);
        await dbContext.SaveChangesAsync();

        var created = await service.UpsertAsync(user.Id, "skandia", new UpsertGameProfileRequest(
            null, new Dictionary<string, string?> { ["GeneralOptions.con"] = "game.setPlayerName \"FromFile\"\r\n" }));
        Assert.Equal(GameProfileOutcome.Ok, created.Outcome);

        await using var locker = new SqliteConnection($"Data Source={dbPath}");
        await locker.OpenAsync();
        await using var exclusive = locker.CreateCommand();
        exclusive.CommandText = "BEGIN IMMEDIATE";
        await exclusive.ExecuteNonQueryAsync();

        var result = await service.SetSidecarNameAsync(user.Id, "skandia", "Sidecar");

        exclusive.CommandText = "ROLLBACK";
        await exclusive.ExecuteNonQueryAsync();

        Assert.Equal(GameProfileOutcome.Busy, result.Outcome);
        Assert.Equal("The database is busy; try again", result.Message);

        await using var verify = new PlayerTrackerDbContext(
            new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite($"Data Source={dbPath}").Options);
        Assert.Null((await verify.GameProfiles.AsNoTracking().SingleAsync()).SidecarName);
    }
}
