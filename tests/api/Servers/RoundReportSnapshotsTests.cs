using api.Servers;
using Xunit;

namespace api.tests.Servers;

public class RoundReportSnapshotsTests
{
    private static readonly DateTime Start = new(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc);

    private static RoundsService.SnapshotObservation Obs(DateTime timestamp, string player, int score, int kills = 0, int deaths = 0) =>
        new(timestamp, score, kills, deaths, Ping: 20, Team: 1, TeamLabel: "Axis", PlayerName: player);

    [Fact]
    public void EmptyObservations_YieldsNoSnapshots()
    {
        var result = RoundsService.BuildLeaderboardSnapshots(Start, Start.AddMinutes(30), []);

        Assert.Empty(result);
    }

    [Fact]
    public void RanksPlayersByScore_AtEachMinuteBoundary()
    {
        var observations = new[]
        {
            Obs(Start, "alice", 5),
            Obs(Start, "bob", 10),
            Obs(Start.AddMinutes(2), "alice", 25),
            Obs(Start.AddMinutes(2), "bob", 15)
        };

        var result = RoundsService.BuildLeaderboardSnapshots(Start, Start.AddMinutes(3), observations);

        var first = result.First(s => s.Timestamp == Start);
        Assert.Equal(["bob", "alice"], first.Entries.Select(e => e.PlayerName));
        Assert.Equal([1, 2], first.Entries.Select(e => e.Rank));

        var third = result.First(s => s.Timestamp == Start.AddMinutes(2));
        Assert.Equal(["alice", "bob"], third.Entries.Select(e => e.PlayerName));
    }

    [Fact]
    public void PlayersUnseenForOverAMinute_DropOutOfSnapshots()
    {
        var observations = new[]
        {
            Obs(Start, "alice", 5),
            Obs(Start.AddMinutes(1), "alice", 8),
            Obs(Start.AddMinutes(5), "bob", 3)
        };

        var result = RoundsService.BuildLeaderboardSnapshots(Start, Start.AddMinutes(6), observations);

        // Alice's last observation is at +1min; by +3min she's outside the
        // seen-in-last-minute window, so that snapshot is empty and filtered out.
        Assert.DoesNotContain(result, s => s.Timestamp == Start.AddMinutes(3));
        var late = result.First(s => s.Timestamp == Start.AddMinutes(5));
        Assert.Equal(["bob"], late.Entries.Select(e => e.PlayerName));
    }

    [Fact]
    public void TimelineIsCapped_ForRoundsWithRunawayDurations()
    {
        // The June 2026 incident: a round left IsActive since the previous September
        // gave the report a ~280-day timeline. The builder must clamp, not iterate it.
        var observations = new[]
        {
            Obs(Start, "alice", 5),
            Obs(Start.AddDays(200), "bob", 3) // beyond the cap — must never be reached
        };

        var result = RoundsService.BuildLeaderboardSnapshots(Start, Start.AddDays(281), observations);

        var capEnd = Start.AddMinutes(RoundsService.MaxSnapshotMinutes);
        Assert.All(result, s => Assert.True(s.Timestamp <= capEnd));
        Assert.DoesNotContain(result, s => s.Entries.Any(e => e.PlayerName == "bob"));
    }

    [Fact]
    public void CancelledToken_AbortsTheBuild()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        Assert.Throws<OperationCanceledException>(() =>
            RoundsService.BuildLeaderboardSnapshots(Start, Start.AddMinutes(30), [Obs(Start, "alice", 5)], cts.Token));
    }
}
