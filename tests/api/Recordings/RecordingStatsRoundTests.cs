using api.PlayerTracking;
using api.Recordings;
using api.Recordings.Models;
using api.Servers;
using api.Servers.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.Recordings;

/// <summary>
/// A shared recording tied to the bfstats.io round it was recorded in
/// (features/recording-stats-round): on upload, by the background pass, and as the round's
/// report and the round lists show it. The Midway fixture began at 20:34:59 on a PC in UTC+10
/// and ran 883 seconds, with Rut, skandia, Lapu and a bot.
/// </summary>
public sealed class RecordingStatsRoundTests : IDisposable
{
    private const string Server = "MoonGamers.com | Est. 2004";

    private readonly RecordingFixture fixture = new();

    public void Dispose() => fixture.Dispose();

    private static DateTime Utc(string s) => DateTime.SpecifyKind(DateTime.Parse(s), DateTimeKind.Utc);

    private Task<RecordingDetailDto> Share(string salt = "") => fixture.UploadAsync(RecordingFixture.Midway(salt));

    /// <summary>The round the fixture is of, the same level earlier that night with one of its
    /// players, and the same players on another server.</summary>
    private async Task SeedRoundsAsync()
    {
        var db = fixture.Db;
        db.Servers.Add(new GameServer { Guid = "moon", Name = Server, Ip = "1.2.3.4", Port = 14567, GameId = "bf1942", Game = "bf1942" });
        db.Servers.Add(new GameServer { Guid = "else", Name = "Elsewhere", Ip = "5.6.7.8", Port = 14567, GameId = "bf1942", Game = "bf1942" });
        foreach (var name in new[] { "Rut", "skandia", "Lapu", "Stranger", "A", "B", "C", "D", "E" })
        {
            db.Players.Add(new Player { Name = name, FirstSeen = DateTime.UtcNow, LastSeen = DateTime.UtcNow });
        }
        AddRound("theirs", "moon", "midway", "2026-09-27T10:35:20", "2026-09-27T10:52:00", "Rut", "skandia", "Lapu", "Stranger");
        AddRound("earlier", "moon", "midway", "2026-09-27T02:00:00", "2026-09-27T02:30:00", "Rut", "A", "B", "C", "D", "E");
        AddRound("elsewhere", "else", "midway", "2026-09-27T10:35:20", "2026-09-27T10:52:00", "Rut", "skandia", "Lapu");
        await db.SaveChangesAsync();
    }

    private void AddRound(string id, string server, string map, string start, string end, params string[] players)
    {
        fixture.Db.Rounds.Add(new Round
        {
            RoundId = id,
            ServerGuid = server,
            ServerName = server,
            MapName = map,
            GameType = "conquest",
            StartTime = Utc(start),
            EndTime = Utc(end),
            ParticipantCount = players.Length,
        });
        foreach (var name in players)
        {
            fixture.Db.PlayerSessions.Add(new PlayerSession
            {
                PlayerName = name,
                ServerGuid = server,
                RoundId = id,
                MapName = map,
                GameType = "conquest",
                StartTime = Utc(start),
                LastSeenTime = Utc(end),
            });
        }
    }

    private Task<Recording> Row(string slug) => fixture.Db.Recordings.AsNoTracking().SingleAsync(r => r.Slug == slug);

    [Fact]
    public async Task Upload_FindsTheRoundItWasRecordedIn_AndThePcsZone()
    {
        await SeedRoundsAsync();

        var shared = await Share();
        var row = await Row(shared.Slug);

        Assert.Equal("theirs", row.StatsRoundId);
        Assert.Equal(600, row.StatsRoundZoneMinutes);
        Assert.Equal(3, row.StatsRoundMatchedPlayers);
        Assert.Equal(StatsRoundMatcher.Version, row.StatsRoundCheckVersion);
        Assert.Equal("theirs", shared.StatsRoundId);
    }

    [Fact]
    public async Task Upload_BeforeTheRoundsStats_IsMatchedByTheBackgroundPass_ForAWhile()
    {
        var early = await Share("early");
        Assert.Null((await Row(early.Slug)).StatsRoundId);
        Assert.Equal(StatsRoundMatcher.Version, (await Row(early.Slug)).StatsRoundCheckVersion);
        // Long unmatched, past the time it is looked at again.
        var stale = await Share("stale");
        await fixture.Db.Recordings.Where(r => r.Slug == stale.Slug)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.CreatedAt, RecordingFixture.Start - Duration.FromDays(5)));

        await SeedRoundsAsync();
        fixture.Clock.Now += Duration.FromMinutes(30);
        Assert.Equal(new RecordingStatsRoundBackfillResult(0, 0), await fixture.StatsRounds.BackfillAsync(default));

        fixture.Clock.Now += Duration.FromHours(1);
        Assert.Equal(new RecordingStatsRoundBackfillResult(1, 1), await fixture.StatsRounds.BackfillAsync(default));
        Assert.Equal("theirs", (await Row(early.Slug)).StatsRoundId);
        Assert.Null((await Row(stale.Slug)).StatsRoundId);
    }

    [Fact]
    public async Task Backfill_LooksAgainAtEveryRecording_WhenTheMatcherChanges()
    {
        await SeedRoundsAsync();
        var shared = await Share();
        await fixture.Db.Recordings.Where(r => r.Slug == shared.Slug).ExecuteUpdateAsync(set => set
            .SetProperty(r => r.StatsRoundId, (string?)null)
            .SetProperty(r => r.StatsRoundCheckVersion, 0));
        fixture.Db.ChangeTracker.Clear();
        // Long past the time an unmatched recording is looked at again.
        fixture.Clock.Now += Duration.FromDays(30);

        Assert.Equal(new RecordingStatsRoundBackfillResult(1, 1), await fixture.StatsRounds.BackfillAsync(default));
        Assert.Equal("theirs", (await Row(shared.Slug)).StatsRoundId);
    }

    [Fact]
    public async Task ForRound_IsWhatTheReportShows_WithWhenItBeganInUtc()
    {
        await SeedRoundsAsync();
        var shared = await Share();

        var shown = Assert.Single(await fixture.StatsRounds.ForRoundAsync("theirs", default));

        Assert.Equal(shared.Slug, shown.Slug);
        Assert.Equal(Instant.FromUtc(2026, 9, 27, 10, 34, 59), shown.RecordedAt);
        Assert.Equal("skandia", shown.UploaderPlayer);
        Assert.Equal("midway", shown.Level);
        Assert.Equal($"/stats/recordings/{shared.Slug}.ndjson", shown.RecordingUrl);
        Assert.Empty(await fixture.StatsRounds.ForRoundAsync("earlier", default));
    }

    [Fact]
    public async Task RoundLists_MarkTheRecordedRounds()
    {
        await SeedRoundsAsync();
        var shared = await Share();
        var rounds = new RoundsService(fixture.Db, NullLogger<RoundsService>.Instance);

        var page = await rounds.GetRounds(1, 10, "StartTime", "desc", new RoundFilters { ServerGuid = "moon" });

        var recorded = page.Items.Single(r => r.RoundId == "theirs");
        Assert.Equal([shared.Slug], recorded.Recordings!.Select(r => r.Slug));
        Assert.Null(page.Items.Single(r => r.RoundId == "earlier").Recordings);
    }
}
