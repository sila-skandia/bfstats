using api.Recordings;
using api.Recordings.Models;

namespace api.tests.Recordings;

/// <summary>
/// Which bfstats.io round a recording is of (features/recording-stats-round). The cases are
/// recordings shared on the live site, against the rounds bfstats.io kept of their servers.
/// </summary>
public class StatsRoundMatcherTests
{
    private static DateTime Utc(string s) => DateTime.SpecifyKind(DateTime.Parse(s), DateTimeKind.Utc);

    private static DateTime Local(string s) => StatsRoundMatcher.ParseLocal(s)!.Value;

    private static StatsRoundCandidate Round(string id, string start, string? end, int players, int matched) =>
        new(id, Utc(start), end is null ? null : Utc(end), players, matched);

    [Theory]
    [InlineData("battle_of_britain", "battle of britain")]
    [InlineData("battle_for_ortona-1943", "battle for ortona-1943")]
    [InlineData("Battleaxe", "battleaxe")]
    public void LevelKey_IsTheSameForTheRecordingsFolderAndTheSitesName(string folder, string site) =>
        Assert.Equal(StatsRoundMatcher.LevelKey(folder), StatsRoundMatcher.LevelKey(site));

    [Fact]
    public void Pick_FindsTheRoundThePlayersAreIn_AndThePcsZone()
    {
        // Battleaxe on MoonGamers, recorded in Brisbane: 30 players with the bots, of whom
        // bfstats.io saw 17. The level came round seven hours before with 3 of them.
        var pick = StatsRoundMatcher.Pick(
            Local("2026-10-24T16:14:56"), 1832.484, Utc("2026-10-24T06:46:22"), 30,
            [
                Round("7f29e158", "2026-10-24T06:16:02", "2026-10-24T06:46:02", 17, 17),
                Round("52705b62", "2026-10-23T23:35:00", "2026-10-24T00:06:00", 38, 3),
            ],
            []);

        Assert.Equal(new StatsRoundPick("7f29e158", 600, 17), pick);
    }

    [Fact]
    public void Pick_TakesARoundStillRunning_EndingItWhenTheRecordingWasShared()
    {
        var pick = StatsRoundMatcher.Pick(
            Local("2026-10-21T20:33:09"), 1560, Utc("2026-10-21T19:05:00"), 67,
            [Round("862539d1", "2026-10-21T18:33:00", null, 62, 60)],
            []);

        Assert.Equal(new StatsRoundPick("862539d1", 120, 60), pick);
    }

    [Fact]
    public void Pick_SettlesTheZoneOfARecordingBegunMidRound_ByTheUploadersOtherRecordings()
    {
        // Bocage, 17 minutes of a 46-minute round: UTC-4:30, -4:15 and -4 all fit.
        DateTime local = Local("2026-10-10T16:01:46");
        StatsRoundCandidate[] rounds = [Round("bfeb8595", "2026-10-10T20:01:00", "2026-10-10T20:47:00", 46, 36)];
        var shared = Utc("2026-10-11T01:00:00");

        Assert.Equal([-270, -255, -240], StatsRoundMatcher.Zones(local, 17 * 60, shared, rounds[0]));
        Assert.Equal(-240, StatsRoundMatcher.Pick(local, 17 * 60, shared, 44, rounds, [-240, -240, 600])!.ZoneMinutes);
        Assert.Null(StatsRoundMatcher.Pick(local, 17 * 60, shared, 44, rounds, [])!.ZoneMinutes);
        Assert.Null(StatsRoundMatcher.Pick(local, 17 * 60, shared, 44, rounds, [-240, -270])!.ZoneMinutes);
        Assert.Equal("bfeb8595", StatsRoundMatcher.Pick(local, 17 * 60, shared, 44, rounds, [])!.RoundId);
    }

    [Fact]
    public void Pick_LeavesATooCloseCallUnmatched()
    {
        StatsRoundCandidate[] rounds =
        [
            Round("first", "2026-10-17T05:00:00", "2026-10-17T05:30:00", 20, 15),
            Round("again", "2026-10-17T15:00:00", "2026-10-17T15:30:00", 20, 10),
        ];

        Assert.Null(StatsRoundMatcher.Pick(Local("2026-10-17T15:00:30"), 25 * 60, Utc("2026-10-18T00:00:00"), 20, rounds, []));
    }

    [Fact]
    public void Pick_WantsAShareOfThePlayers()
    {
        StatsRoundCandidate[] rounds = [Round("thin", "2026-10-17T05:00:00", "2026-10-17T05:30:00", 40, 5)];

        Assert.Null(StatsRoundMatcher.Pick(Local("2026-10-17T15:00:30"), 25 * 60, Utc("2026-10-18T00:00:00"), 40, rounds, []));
    }

    [Fact]
    public void Pick_LeavesOutARoundTheRecordingCannotFitIn()
    {
        // 40 minutes recorded; the round lasted 20.
        StatsRoundCandidate[] rounds = [Round("short", "2026-10-17T05:00:00", "2026-10-17T05:20:00", 20, 20)];

        Assert.Null(StatsRoundMatcher.Pick(Local("2026-10-17T15:00:30"), 40 * 60, Utc("2026-10-18T00:00:00"), 20, rounds, []));
    }

    [Fact]
    public void Pick_NeverPutsTheRecordingAfterItWasShared()
    {
        // Only UTC+2 would put it in the round, and that has it end an hour after it was shared.
        StatsRoundCandidate[] rounds = [Round("later", "2026-10-17T13:00:00", "2026-10-17T13:30:00", 20, 20)];

        Assert.Null(StatsRoundMatcher.Pick(Local("2026-10-17T15:00:30"), 25 * 60, Utc("2026-10-17T12:30:00"), 20, rounds, []));
    }

    [Fact]
    public void Pick_WithNoStartInTheHeader_GoesByThePlayersAlone()
    {
        StatsRoundCandidate[] rounds =
        [
            Round("theirs", "2026-10-17T05:00:00", "2026-10-17T05:30:00", 20, 18),
            Round("other", "2026-10-17T09:00:00", "2026-10-17T09:30:00", 20, 2),
        ];

        Assert.Equal(new StatsRoundPick("theirs", null, 18), StatsRoundMatcher.Pick(null, 25 * 60, Utc("2026-10-18T00:00:00"), 20, rounds, []));
    }

    [Fact]
    public void Window_CoversEveryZoneAndALongRound_AndStopsWhenItWasShared()
    {
        var (from, to) = StatsRoundMatcher.Window(Local("2026-10-17T15:00:00"), Utc("2026-10-20T00:00:00"));
        Assert.Equal(Utc("2026-10-16T19:00:00"), from);
        Assert.Equal(Utc("2026-10-18T03:05:00"), to);

        var (_, sharedSoon) = StatsRoundMatcher.Window(Local("2026-10-17T15:00:00"), Utc("2026-10-17T14:00:00"));
        Assert.Equal(Utc("2026-10-17T14:00:00"), sharedSoon);
    }
}
