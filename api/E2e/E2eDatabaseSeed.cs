using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;

namespace api.E2e;

/// <summary>
/// Minimal rows so Playwright can run against a throwaway sqlite file instead of
/// the 18 GB tracking database. Idempotent — safe to call on every E2E API boot.
/// </summary>
public static class E2eDatabaseSeed
{
    public static readonly string[] PlayerNames =
    [
        "Admin",
        "Alpha Player",
        "Bravo Player",
        "Charlie",
        "testplayer",
        "[TAG]Player",
        "Xanadu",
    ];

    public const string ServerGuid = "e2e-server-1";
    public const string AdminEmail = "admin@bfstats.io";

    public static async Task ApplyAsync(PlayerTrackerDbContext db, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var existingNames = await db.Players
            .Select(p => p.Name)
            .ToListAsync(cancellationToken);
        var existing = existingNames.ToHashSet(StringComparer.Ordinal);

        foreach (var name in PlayerNames)
        {
            if (existing.Contains(name))
            {
                continue;
            }

            db.Players.Add(new Player
            {
                Name = name,
                FirstSeen = now.AddDays(-30),
                LastSeen = now.AddHours(-2),
                TotalPlayTimeMinutes = 600 + name.Length,
                AiBot = false,
            });
        }

        if (!await db.Servers.AnyAsync(s => s.Guid == ServerGuid, cancellationToken))
        {
            db.Servers.Add(new GameServer
            {
                Guid = ServerGuid,
                Name = "E2E Test Server",
                Ip = "127.0.0.1",
                Port = 14567,
                GameId = "bf1942",
                Game = "bf1942",
                MaxPlayers = 64,
                CurrentNumPlayers = 0,
                IsOnline = false,
                LastSeenTime = now.AddHours(-2),
                Country = "AU",
            });
        }

        if (!await db.Users.AnyAsync(u => u.Email == AdminEmail, cancellationToken))
        {
            db.Users.Add(new User
            {
                Email = AdminEmail,
                CreatedAt = now.AddDays(-1),
                LastLoggedIn = now.AddHours(-1),
                IsActive = true,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
