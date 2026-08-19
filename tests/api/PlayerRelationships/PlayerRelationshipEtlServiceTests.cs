using api.PlayerRelationships;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.PlayerRelationships;

/// <summary>
/// Regression coverage for the co-rounds bug: PlayerRelationshipEtlService used to count
/// one PLAYED_WITH increment per shared 30s observation tick instead of per round, and
/// re-added the same rounds on every daily sync of a rolling 7-day window. These tests
/// pin down the corrected contract — one fact per round per overlapping pair, driven off
/// PlayerSessions (not PlayerObservations), gated by the SyncedToNeo4jAt watermark.
/// </summary>
public sealed class PlayerRelationshipEtlServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly PlayerRelationshipEtlService service;

    public PlayerRelationshipEtlServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        var neo4jService = new Neo4jService(new Neo4jConfiguration(), NullLogger<Neo4jService>.Instance);
        service = new PlayerRelationshipEtlService(dbContext, neo4jService, NullLogger<PlayerRelationshipEtlService>.Instance);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }

    private readonly HashSet<string> seededPlayers = [];
    private readonly HashSet<string> seededServers = [];
    private readonly HashSet<string> seededRounds = [];

    /// <summary>Seeds the Player/GameServer/Round rows a PlayerSession's foreign keys require, once each.</summary>
    private void EnsureParents(string player, string serverGuid, string roundId, DateTime roundStart)
    {
        if (seededPlayers.Add(player))
            dbContext.Players.Add(new Player { Name = player });

        if (seededServers.Add(serverGuid))
            dbContext.Servers.Add(new GameServer { Guid = serverGuid, Name = serverGuid });

        if (seededRounds.Add(roundId))
            dbContext.Rounds.Add(new Round { RoundId = roundId, ServerGuid = serverGuid, StartTime = roundStart, IsActive = false });
    }

    private PlayerSession Session(string player, string roundId, string serverGuid, DateTime roundStart, DateTime start, DateTime end)
    {
        EnsureParents(player, serverGuid, roundId, roundStart);
        return new PlayerSession
        {
            PlayerName = player,
            RoundId = roundId,
            ServerGuid = serverGuid,
            StartTime = start,
            LastSeenTime = end,
            IsActive = false
        };
    }

    [Fact]
    public async Task DetectCoPlayPairsForRoundsAsync_OneFact_WhenSessionsOverlap()
    {
        var round = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        dbContext.PlayerSessions.AddRange(
            Session("Alice", "round-1", "srv-1", round, round, round.AddMinutes(20)),
            Session("Bob", "round-1", "srv-1", round, round.AddMinutes(5), round.AddMinutes(25))
        );
        await dbContext.SaveChangesAsync();

        var facts = await service.DetectCoPlayPairsForRoundsAsync(
            [("round-1", round, "srv-1")]);

        var fact = Assert.Single(facts);
        Assert.Equal(("Alice", "Bob"), (fact.Player1, fact.Player2));
        Assert.Equal("srv-1", fact.ServerGuid);
    }

    [Fact]
    public async Task DetectCoPlayPairsForRoundsAsync_NoFact_WhenOnePlayerLeavesBeforeOtherJoins()
    {
        var round = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        dbContext.PlayerSessions.AddRange(
            // Alice is gone before Bob ever connects — same round, never online together.
            Session("Alice", "round-1", "srv-1", round, round, round.AddMinutes(10)),
            Session("Bob", "round-1", "srv-1", round, round.AddMinutes(15), round.AddMinutes(25))
        );
        await dbContext.SaveChangesAsync();

        var facts = await service.DetectCoPlayPairsForRoundsAsync(
            [("round-1", round, "srv-1")]);

        Assert.Empty(facts);
    }

    [Fact]
    public async Task DetectCoPlayPairsForRoundsAsync_OneFact_WhenPlayerReconnectsMidRound()
    {
        var round = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        dbContext.PlayerSessions.AddRange(
            // Bob disconnects and reconnects — two PlayerSession rows for the same round.
            Session("Bob", "round-1", "srv-1", round, round, round.AddMinutes(5)),
            Session("Bob", "round-1", "srv-1", round, round.AddMinutes(10), round.AddMinutes(20)),
            // Alice overlaps only with Bob's second session.
            Session("Alice", "round-1", "srv-1", round, round.AddMinutes(12), round.AddMinutes(18))
        );
        await dbContext.SaveChangesAsync();

        var facts = await service.DetectCoPlayPairsForRoundsAsync(
            [("round-1", round, "srv-1")]);

        // Exactly one fact for the pair, not one per overlapping session combination.
        var fact = Assert.Single(facts);
        Assert.Equal(("Alice", "Bob"), (fact.Player1, fact.Player2));
    }

    [Fact]
    public async Task DetectCoPlayPairsForRoundsAsync_BatchesAcrossRounds_WithoutCrossRoundLeakage()
    {
        var round1Start = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var round2Start = new DateTime(2026, 1, 2, 12, 0, 0, DateTimeKind.Utc);

        dbContext.PlayerSessions.AddRange(
            Session("Alice", "round-1", "srv-1", round1Start, round1Start, round1Start.AddMinutes(20)),
            Session("Bob", "round-1", "srv-1", round1Start, round1Start, round1Start.AddMinutes(20)),
            Session("Carol", "round-2", "srv-2", round2Start, round2Start, round2Start.AddMinutes(20)),
            Session("Dave", "round-2", "srv-2", round2Start, round2Start, round2Start.AddMinutes(20))
        );
        await dbContext.SaveChangesAsync();

        var facts = await service.DetectCoPlayPairsForRoundsAsync(
            [("round-1", round1Start, "srv-1"), ("round-2", round2Start, "srv-2")]);

        Assert.Equal(2, facts.Count);
        Assert.Contains(facts, f => f.Player1 == "Alice" && f.Player2 == "Bob" && f.ServerGuid == "srv-1");
        Assert.Contains(facts, f => f.Player1 == "Carol" && f.Player2 == "Dave" && f.ServerGuid == "srv-2");
    }

    [Fact]
    public async Task DetectCoPlayPairsForRoundsAsync_Empty_WhenFewerThanTwoSessions()
    {
        var round = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        dbContext.PlayerSessions.Add(Session("Alice", "round-1", "srv-1", round, round, round.AddMinutes(20)));
        await dbContext.SaveChangesAsync();

        var facts = await service.DetectCoPlayPairsForRoundsAsync(
            [("round-1", round, "srv-1")]);

        Assert.Empty(facts);
    }

    [Fact]
    public void AggregateRelationships_CollapsesMultipleRoundsIntoOneRelationship()
    {
        var day1 = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        var day2 = new DateTime(2026, 1, 2, 12, 0, 0, DateTimeKind.Utc);

        var pairs = new List<(string, string, DateTime, string)>
        {
            ("Alice", "Bob", day1, "srv-1"),
            ("Alice", "Bob", day2, "srv-2")
        };

        var result = service.AggregateRelationships(pairs);

        var metrics = Assert.Single(result.Values);
        Assert.Equal(2, metrics.ObservationCount); // two distinct rounds
        Assert.Equal(day1, metrics.FirstSeen);
        Assert.Equal(day2, metrics.LastSeen);
        Assert.Equal(2, metrics.ServerGuids.Count);
    }

    [Fact]
    public async Task SyncPendingRelationshipsAsync_SkipsAlreadySyncedRounds()
    {
        var round = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        dbContext.Servers.Add(new GameServer { Guid = "srv-1", Name = "srv-1" });
        dbContext.Rounds.Add(new Round
        {
            RoundId = "round-1",
            ServerGuid = "srv-1",
            StartTime = round,
            IsActive = false,
            SyncedToNeo4jAt = DateTime.UtcNow // already synced
        });
        await dbContext.SaveChangesAsync();

        // No pending rounds, so this must return immediately without attempting a Neo4j write.
        var result = await service.SyncPendingRelationshipsAsync();

        Assert.Equal(0, result.RoundsProcessed);
        Assert.Equal(0, result.RelationshipsProcessed);
    }

    [Fact]
    public async Task SyncPendingRelationshipsAsync_SkipsActiveRounds()
    {
        var round = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);
        dbContext.Servers.Add(new GameServer { Guid = "srv-1", Name = "srv-1" });
        dbContext.Rounds.Add(new Round
        {
            RoundId = "round-1",
            ServerGuid = "srv-1",
            StartTime = round,
            IsActive = true, // round still in progress — must not be picked up
            SyncedToNeo4jAt = null
        });
        await dbContext.SaveChangesAsync();

        var result = await service.SyncPendingRelationshipsAsync();

        Assert.Equal(0, result.RoundsProcessed);
    }

    [Fact]
    public async Task ResetNeo4jSyncWatermarkAsync_ClearsWatermarkFromDateOnward()
    {
        var before = new DateTime(2025, 12, 1, 0, 0, 0, DateTimeKind.Utc);
        var after = new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc);
        var resetFrom = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        dbContext.Servers.Add(new GameServer { Guid = "srv-1", Name = "srv-1" });
        dbContext.Rounds.AddRange(
            new Round { RoundId = "old", ServerGuid = "srv-1", StartTime = before, SyncedToNeo4jAt = DateTime.UtcNow },
            new Round { RoundId = "new", ServerGuid = "srv-1", StartTime = after, SyncedToNeo4jAt = DateTime.UtcNow }
        );
        await dbContext.SaveChangesAsync();

        var (roundsReset, _) = await service.ResetNeo4jSyncWatermarkAsync(resetFrom);

        Assert.Equal(1, roundsReset);
        Assert.Null(await dbContext.Rounds.Where(r => r.RoundId == "new").Select(r => r.SyncedToNeo4jAt).SingleAsync());
        Assert.NotNull(await dbContext.Rounds.Where(r => r.RoundId == "old").Select(r => r.SyncedToNeo4jAt).SingleAsync());
    }
}
