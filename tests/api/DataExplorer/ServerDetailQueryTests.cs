using System.Data.Common;
using api.Data.Entities;
using api.DataExplorer;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.DataExplorer;

public sealed class ServerDetailQueryTests : IDisposable
{
    private const string BusyGuid = "7b3a63-12e36b3-6dac2c-8c0a76c";
    private const string OtherGuid = "other-server";

    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _db;
    private readonly DataExplorerService _service;
    private readonly Instant _now = Instant.FromUtc(2026, 10, 1, 0, 0);

    public ServerDetailQueryTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        _db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options);
        _db.Database.EnsureCreated();
        _service = new DataExplorerService(_db, NullLogger<DataExplorerService>.Instance);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task GetServerDetail_ReturnsNullWhenServerMissing()
    {
        Assert.Null(await _service.GetServerDetailAsync("missing"));
    }

    [Fact]
    public async Task GetServerDetail_ReturnsEmptyRotationWhenServerHasNoMaps()
    {
        SeedServer(BusyGuid, "Empty");
        await _db.SaveChangesAsync();

        var detail = await _service.GetServerDetailAsync(BusyGuid);

        Assert.NotNull(detail);
        Assert.Empty(detail.MapRotation);
        Assert.Empty(detail.PerMapStats);
    }

    [Fact]
    public async Task GetServerDetail_RanksTopFiveByScoreSummedAcrossMonths()
    {
        SeedServer(BusyGuid, "Busy");
        SeedServer(OtherGuid, "Other");
        SeedMap(BusyGuid, "wake", playMinutes: 100);
        SeedMap(BusyGuid, "omaha", playMinutes: 40);

        // Two months for Ace so the SUM has to land in the covering index, not a single row.
        SeedPlayer(BusyGuid, "wake", "Ace", year: 2026, month: 8, score: 1000, kills: 10, deaths: 5);
        SeedPlayer(BusyGuid, "wake", "Ace", year: 2026, month: 9, score: 500, kills: 5, deaths: 5);
        SeedPlayer(BusyGuid, "wake", "Bob", year: 2026, month: 9, score: 1200, kills: 12, deaths: 4);
        SeedPlayer(BusyGuid, "wake", "Cat", year: 2026, month: 9, score: 1100, kills: 11, deaths: 11);
        SeedPlayer(BusyGuid, "wake", "Dan", year: 2026, month: 9, score: 900, kills: 9, deaths: 3);
        SeedPlayer(BusyGuid, "wake", "Eve", year: 2026, month: 9, score: 800, kills: 8, deaths: 8);
        SeedPlayer(BusyGuid, "wake", "Flo", year: 2026, month: 9, score: 700, kills: 7, deaths: 7);

        SeedPlayer(BusyGuid, "omaha", "Ace", year: 2026, month: 9, score: 50, kills: 1, deaths: 1);
        SeedPlayer(OtherGuid, "wake", "Ace", year: 2026, month: 9, score: 99999, kills: 99, deaths: 1);
        await _db.SaveChangesAsync();

        var detail = await _service.GetServerDetailAsync(BusyGuid);

        Assert.NotNull(detail);
        Assert.Equal(["wake", "omaha"], detail.MapRotation.Select(m => m.MapName).ToArray());

        var wake = Assert.Single(detail.PerMapStats, m => m.MapName == "wake");
        Assert.Equal(["Ace", "Bob", "Cat", "Dan", "Eve"], wake.TopPlayers.Select(p => p.PlayerName).ToArray());
        Assert.Equal(1500, wake.TopPlayers[0].TotalScore);
        Assert.Equal(15, wake.TopPlayers[0].TotalKills);
        Assert.Equal(1.5, wake.TopPlayers[0].KdRatio);
        Assert.DoesNotContain(wake.TopPlayers, p => p.PlayerName == "Flo");
    }

    [Fact]
    public async Task GetServerDetail_TopPlayersQueryUsesCoveringIndex()
    {
        SeedServer(BusyGuid, "Busy");
        SeedMap(BusyGuid, "wake", playMinutes: 100);
        SeedPlayer(BusyGuid, "wake", "Ace", year: 2026, month: 9, score: 100, kills: 10, deaths: 5);
        await _db.SaveChangesAsync();

        var recorder = new PlanRecorder();
        await using var db = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .AddInterceptors(recorder)
            .Options);
        var service = new DataExplorerService(db, NullLogger<DataExplorerService>.Instance);

        var detail = await service.GetServerDetailAsync(BusyGuid);
        Assert.NotNull(detail);

        var topPlayers = recorder.Statements
            .Where(s => s.Sql.Contains("ROW_NUMBER() OVER (PARTITION BY MapName ORDER BY SUM(TotalScore)", StringComparison.Ordinal)
                        && s.Sql.Contains("FROM PlayerMapStats", StringComparison.Ordinal))
            .ToList();
        Assert.NotEmpty(topPlayers);

        foreach (var (_, plan) in topPlayers)
        {
            Assert.Contains(
                plan,
                step => step.Contains("IX_PlayerMapStats_ServerDetail_Covering", StringComparison.Ordinal));
            Assert.DoesNotContain(
                plan,
                step => step.StartsWith("SCAN PlayerMapStats", StringComparison.Ordinal)
                        && !step.Contains("INDEX", StringComparison.Ordinal));
        }
    }

    private void SeedServer(string guid, string name)
    {
        _db.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = name,
            Game = "bf1942",
            IsOnline = true
        });
    }

    private void SeedMap(string guid, string mapName, int playMinutes)
    {
        _db.ServerMapStats.Add(new ServerMapStats
        {
            ServerGuid = guid,
            MapName = mapName,
            Year = 2026,
            Month = 9,
            TotalRounds = 10,
            TotalPlayTimeMinutes = playMinutes,
            AvgConcurrentPlayers = 16,
            Team1Victories = 6,
            Team2Victories = 4,
            Team1Label = "Axis",
            Team2Label = "Allies",
            UpdatedAt = _now
        });
    }

    private void SeedPlayer(string guid, string mapName, string player, int year, int month, int score, int kills, int deaths)
    {
        _db.PlayerMapStats.Add(new PlayerMapStats
        {
            PlayerName = player,
            MapName = mapName,
            ServerGuid = guid,
            Year = year,
            Month = month,
            TotalScore = score,
            TotalKills = kills,
            TotalDeaths = deaths,
            TotalRounds = 4,
            TotalPlayTimeMinutes = 40,
            UpdatedAt = _now
        });
    }

    private sealed class PlanRecorder : DbCommandInterceptor
    {
        public List<(string Sql, List<string> Plan)> Statements { get; } = [];

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Record(command);
            return result;
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Record(command);
            return ValueTask.FromResult(result);
        }

        private void Record(DbCommand command)
        {
            if (!command.CommandText.TrimStart().StartsWith("SELECT", StringComparison.OrdinalIgnoreCase))
                return;

            using var explain = command.Connection!.CreateCommand();
#pragma warning disable CA2100
            explain.CommandText = "EXPLAIN QUERY PLAN " + command.CommandText;
#pragma warning restore CA2100
            foreach (DbParameter p in command.Parameters)
            {
                var copy = explain.CreateParameter();
                copy.ParameterName = p.ParameterName;
                copy.Value = p.Value;
                explain.Parameters.Add(copy);
            }

            var plan = new List<string>();
            using (var reader = explain.ExecuteReader())
            {
                while (reader.Read())
                    plan.Add(reader.GetString(3));
            }

            Statements.Add((command.CommandText, plan));
        }
    }
}
