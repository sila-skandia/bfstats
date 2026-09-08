using System.Globalization;
using api.Authorization;
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

        // A full 7x24 grid for the E2E server. MmServerActivityHeatmap renders a
        // muted placeholder instead of its grid when patternData.slots is empty
        // — and the Chrono-Wave ribbon lives inside that grid — so without these
        // rows the golden-hour spec can only ever see the header controls.
        //
        // Shaped like a real server rather than filled with a constant: a
        // European evening peak, a small hours trough, and busier weekends, so
        // the Activity/Momentum/Ceiling overlays have something to differentiate.
        if (!await db.ServerHourlyPatterns.AnyAsync(p => p.ServerGuid == ServerGuid, cancellationToken))
        {
            var patternUpdatedAt = Instant.FromDateTimeUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc));
            for (var day = 0; day < 7; day++)
            {
                var weekendBoost = day is 0 or 6 ? 1.4 : 1.0;
                for (var hour = 0; hour < 24; hour++)
                {
                    // Peaks around 20:00 UTC, troughs around 05:00.
                    var hoursFromPeak = Math.Min(Math.Abs(hour - 20), 24 - Math.Abs(hour - 20));
                    var avg = Math.Round((4 + (18 * Math.Max(0, 1 - (hoursFromPeak / 9.0)))) * weekendBoost, 2);

                    db.ServerHourlyPatterns.Add(new ServerHourlyPattern
                    {
                        ServerGuid = ServerGuid,
                        DayOfWeek = day,
                        HourOfDay = hour,
                        AvgPlayers = avg,
                        MinPlayers = Math.Round(avg * 0.4, 2),
                        Q25Players = Math.Round(avg * 0.7, 2),
                        MedianPlayers = avg,
                        Q75Players = Math.Round(avg * 1.2, 2),
                        Q90Players = Math.Round(avg * 1.4, 2),
                        MaxPlayers = Math.Round(avg * 1.6, 2),
                        DataPoints = 24,
                        UpdatedAt = patternUpdatedAt,
                    });
                }
            }
        }

        // Role matters. TokenService falls back to AppRoles.User when it is null,
        // so without it the suite's token said role=User and the tournament specs
        // only passed because AdminTournamentController also accepts the
        // tournament's creator — they were exercising ownership, never the Admin
        // policy. Anything behind [Authorize(Policy = "Admin")] was untestable.
        //
        // Updated in place as well as created: a fixture carved from production
        // already carries this user with a null role.
        var admin = await db.Users.FirstOrDefaultAsync(u => u.Email == AdminEmail, cancellationToken);
        if (admin is null)
        {
            db.Users.Add(new User
            {
                Email = AdminEmail,
                CreatedAt = now.AddDays(-1),
                LastLoggedIn = now.AddHours(-1),
                IsActive = true,
                Role = AppRoles.Admin,
            });
        }
        else if (admin.Role != AppRoles.Admin)
        {
            admin.Role = AppRoles.Admin;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
