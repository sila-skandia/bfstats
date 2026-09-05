using System.Globalization;
using api.Data.Entities;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using NodaTime;

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
                CurrentNumPlayers = 8,
                IsOnline = true,
                LastSeenTime = now.AddHours(-2),
                Country = "AU",
            });
        }

        if (!await db.ServerMapStats.AnyAsync(s => s.ServerGuid == ServerGuid, cancellationToken))
        {
            db.ServerMapStats.Add(new ServerMapStats
            {
                ServerGuid = ServerGuid,
                MapName = "Wake Island",
                Year = now.Year,
                Month = now.Month,
                TotalRounds = 40,
                TotalPlayTimeMinutes = 12_000,
                AvgConcurrentPlayers = 24,
                PeakConcurrentPlayers = 48,
                Team1Victories = 20,
                Team2Victories = 20,
                UpdatedAt = Instant.FromDateTimeUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc)),
            });
        }

        if (!await db.PlayerServerStats.AnyAsync(s => s.ServerGuid == ServerGuid, cancellationToken))
        {
            var isoYear = ISOWeek.GetYear(now);
            var isoWeek = ISOWeek.GetWeekOfYear(now);
            var updatedAt = Instant.FromDateTimeUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc));
            int[] kills = [14000, 7500, 19000, 4500, 3200, 9800, 6100];
            int[] deaths = [7000, 4500, 8000, 3800, 2900, 6200, 4100];
            int[] scores = [24000, 13500, 32000, 8500, 6100, 16800, 11200];
            int[] minutes = [17000, 8500, 20000, 5500, 4000, 11000, 7200];
            int[] rounds = [120, 80, 160, 50, 36, 94, 68];

            for (var i = 0; i < PlayerNames.Length; i++)
            {
                db.PlayerServerStats.Add(new PlayerServerStats
                {
                    PlayerName = PlayerNames[i],
                    ServerGuid = ServerGuid,
                    Year = isoYear,
                    Week = isoWeek,
                    TotalKills = kills[i],
                    TotalDeaths = deaths[i],
                    TotalScore = scores[i],
                    TotalPlayTimeMinutes = minutes[i],
                    TotalRounds = rounds[i],
                    UpdatedAt = updatedAt,
                });

                db.PlayerMapStats.Add(new PlayerMapStats
                {
                    PlayerName = PlayerNames[i],
                    MapName = "Wake Island",
                    ServerGuid = ServerGuid,
                    Year = now.Year,
                    Month = now.Month,
                    TotalRounds = rounds[i] / 2,
                    TotalKills = kills[i] / 2,
                    TotalDeaths = deaths[i] / 2,
                    TotalScore = scores[i] / 2,
                    TotalPlayTimeMinutes = minutes[i] / 2,
                    UpdatedAt = updatedAt,
                });
            }
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
