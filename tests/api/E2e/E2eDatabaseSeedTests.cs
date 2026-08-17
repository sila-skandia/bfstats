using api.E2e;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace api.tests.E2e;

public sealed class E2eDatabaseSeedTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;

    public E2eDatabaseSeedTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();
    }

    [Fact]
    public async Task ApplyAsync_inserts_organizer_and_searchable_players()
    {
        await E2eDatabaseSeed.ApplyAsync(dbContext);

        var names = await dbContext.Players.Select(p => p.Name).ToListAsync();
        foreach (var expected in E2eDatabaseSeed.PlayerNames)
        {
            Assert.Contains(expected, names);
        }

        Assert.Contains(names, n => n.Contains('a', StringComparison.OrdinalIgnoreCase));
        Assert.Contains(names, n => n.Contains("player", StringComparison.OrdinalIgnoreCase));
        Assert.True(await dbContext.Servers.AnyAsync(s => s.Guid == E2eDatabaseSeed.ServerGuid));
        Assert.True(await dbContext.Users.AnyAsync(u => u.Email == E2eDatabaseSeed.AdminEmail));
    }

    [Fact]
    public async Task ApplyAsync_is_idempotent()
    {
        await E2eDatabaseSeed.ApplyAsync(dbContext);
        await E2eDatabaseSeed.ApplyAsync(dbContext);

        Assert.Equal(E2eDatabaseSeed.PlayerNames.Length, await dbContext.Players.CountAsync());
        Assert.Equal(1, await dbContext.Servers.CountAsync());
        Assert.Equal(1, await dbContext.Users.CountAsync());
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
