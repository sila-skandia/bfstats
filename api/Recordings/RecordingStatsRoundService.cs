using api.PlayerTracking;
using api.Recordings.Models;
using api.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.Recordings;

/// <summary>
/// Ties each shared recording to the bfstats.io round it was recorded in
/// (features/recording-stats-round), so the round's report can show the replay and the round
/// lists can mark the round recorded. An upload is matched as it is shared; the background
/// pass (<see cref="RecordingRoundBackfill"/>) matches those shared before, looks again at an
/// unmatched one for a while in case its round's stats came in late, and at every recording
/// when <see cref="StatsRoundMatcher.Version"/> moves.
/// </summary>
public interface IRecordingStatsRoundService
{
    /// <summary>Looks for the round of one recording and keeps what it finds, a round or none.
    /// The round's id, or null.</summary>
    Task<string?> MatchAsync(int recordingId, CancellationToken ct);

    /// <summary>Every recording not yet looked at under the current version, and every
    /// unmatched one still young enough to look at again. Run in the background.</summary>
    Task<RecordingStatsRoundBackfillResult> BackfillAsync(CancellationToken ct);

    /// <summary>The shared recordings of one bfstats.io round, the longest first: what its
    /// report shows.</summary>
    Task<List<StatsRoundRecordingDto>> ForRoundAsync(string roundId, CancellationToken ct);
}

public sealed class RecordingStatsRoundService(
    PlayerTrackerDbContext db,
    IClock clock,
    ILogger<RecordingStatsRoundService> logger) : IRecordingStatsRoundService
{
    /// <summary>An unmatched recording is looked at again for this long after it was shared.</summary>
    public static readonly Duration RetryFor = Duration.FromDays(2);

    /// <summary>And no more often than this.</summary>
    public static readonly Duration RetryEvery = Duration.FromHours(1);

    /// <summary>The zones the uploader's other recordings came out in, at most this many of
    /// the newest: what settles the zone of one begun mid-round.</summary>
    private const int ZoneHints = 20;

    public async Task<string?> MatchAsync(int recordingId, CancellationToken ct)
    {
        var recording = await db.Recordings.FirstOrDefaultAsync(r => r.Id == recordingId, ct);
        if (recording is null) return null;
        var pick = await PickAsync(recording, ct);
        recording.StatsRoundId = pick?.RoundId;
        recording.StatsRoundZoneMinutes = pick?.ZoneMinutes;
        recording.StatsRoundMatchedPlayers = pick?.Matched;
        recording.StatsRoundCheckVersion = StatsRoundMatcher.Version;
        recording.StatsRoundCheckedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(ct);
        if (pick is not null)
        {
            logger.LogInformation(
                "Recording {Slug} is of round {RoundId} ({Matched} players, zone {Zone})",
                recording.Slug, pick.RoundId, pick.Matched, pick.ZoneMinutes);
        }
        return pick?.RoundId;
    }

    public async Task<RecordingStatsRoundBackfillResult> BackfillAsync(CancellationToken ct)
    {
        var now = clock.GetCurrentInstant();
        // CreatedAt and the check time are ExtendedIso strings, which do not compare as times in
        // SQL; the unmatched are few, so they are sorted out here.
        var due = (await db.Recordings.AsNoTracking()
                .Where(r => !r.FileMissing && (r.StatsRoundCheckVersion < StatsRoundMatcher.Version || r.StatsRoundId == null))
                .Select(r => new { r.Id, r.StatsRoundCheckVersion, r.CreatedAt, r.StatsRoundCheckedAt })
                .ToListAsync(ct))
            .Where(r => r.StatsRoundCheckVersion < StatsRoundMatcher.Version
                || (now - r.CreatedAt < RetryFor && (r.StatsRoundCheckedAt is not { } at || now - at >= RetryEvery)))
            .OrderBy(r => r.Id)
            .Select(r => r.Id)
            .ToList();
        var matched = 0;
        foreach (var id in due)
        {
            ct.ThrowIfCancellationRequested();
            if (await MatchAsync(id, ct) is not null) matched++;
            db.ChangeTracker.Clear();
        }
        if (due.Count > 0)
        {
            logger.LogInformation("Recording stats rounds: looked at {Checked} recordings, matched {Matched}", due.Count, matched);
        }
        return new RecordingStatsRoundBackfillResult(due.Count, matched);
    }

    public async Task<List<StatsRoundRecordingDto>> ForRoundAsync(string roundId, CancellationToken ct)
    {
        var recordings = await db.Recordings.AsNoTracking()
            .Where(r => r.StatsRoundId == roundId && !r.FileMissing)
            .ToListAsync(ct);
        if (recordings.Count == 0) return [];
        var uploaders = recordings.Select(r => r.UploaderName).Where(n => n.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToDictionary(n => n, PlayerNameDecoder.FromRecording, StringComparer.Ordinal);
        var siteNames = uploaders.Values.Distinct(StringComparer.Ordinal).ToList();
        var known = (await db.Players.AsNoTracking()
                .Where(p => siteNames.Contains(p.Name) && !p.AiBot)
                .Select(p => p.Name)
                .ToListAsync(ct))
            .ToHashSet(StringComparer.Ordinal);
        return [.. recordings
            .OrderByDescending(r => r.DurationSeconds)
            .ThenBy(r => r.Id)
            .Select(r => new StatsRoundRecordingDto(
                r.Slug,
                r.Title,
                r.UploaderName,
                uploaders.TryGetValue(r.UploaderName, out var site) && known.Contains(site) ? site : null,
                r.RecordedBy,
                r.Mod,
                r.Level,
                r.DurationSeconds,
                RecordedAt(r),
                r.ViewCount,
                r.CommentCount,
                r.CreatedAt,
                RecordingService.RecordingLink(r.Slug),
                r.ServerLogBytes > 0 ? RecordingService.ServerLogLink(r.Slug) : null,
                RecordingService.ThumbnailLink(r),
                r.RoundId ?? r.Id))];
    }

    /// <summary>
    /// The shared recordings of each of <paramref name="roundIds"/>, the longest first, for a
    /// list of rounds to mark the recorded ones (features/recording-stats-round). One lookup
    /// through the recordings' round index; a round with none has no entry.
    /// </summary>
    public static async Task<Dictionary<string, List<RoundRecordingDto>>> ForRoundsAsync(
        PlayerTrackerDbContext db, IReadOnlyCollection<string> roundIds, CancellationToken ct)
    {
        var ids = roundIds.Where(id => id.Length > 0).Distinct(StringComparer.Ordinal).ToList();
        if (ids.Count == 0) return [];
        var rows = await db.Recordings.AsNoTracking()
            .Where(r => r.StatsRoundId != null && ids.Contains(r.StatsRoundId) && !r.FileMissing)
            .Select(r => new { r.StatsRoundId, r.Id, r.RoundId, r.Slug, r.Mod, r.Level, r.DurationSeconds, r.ServerLogBytes, r.ThumbnailBytes, r.UpdatedAt })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.StatsRoundId!, StringComparer.Ordinal)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(r => r.DurationSeconds).ThenBy(r => r.Id)
                    .Select(r => new RoundRecordingDto(
                        r.Slug,
                        r.Mod,
                        r.Level,
                        r.DurationSeconds,
                        RecordingService.RecordingLink(r.Slug),
                        r.ServerLogBytes > 0 ? RecordingService.ServerLogLink(r.Slug) : null,
                        RecordingService.ThumbnailLink(new Recording { Slug = r.Slug, ThumbnailBytes = r.ThumbnailBytes, UpdatedAt = r.UpdatedAt }),
                        r.RoundId ?? r.Id))
                    .ToList(),
                StringComparer.Ordinal);
    }

    /// <summary>When a recording began, in UTC, once its zone is known.</summary>
    public static Instant? RecordedAt(Recording r) =>
        r.StatsRoundZoneMinutes is { } zone && StatsRoundMatcher.ParseLocal(r.RecordedLocal) is { } local
            ? Instant.FromDateTimeUtc(DateTime.SpecifyKind(local.AddMinutes(-zone), DateTimeKind.Utc))
            : null;

    private async Task<StatsRoundPick?> PickAsync(Recording recording, CancellationToken ct)
    {
        if (recording.ServerName.Length == 0 || recording.Level.Length == 0) return null;
        var local = StatsRoundMatcher.ParseLocal(recording.RecordedLocal);
        var shared = recording.CreatedAt.ToDateTimeUtc();
        var (from, to) = StatsRoundMatcher.Window(local, shared);

        // The server by the name the recording heard, in either of its forms (PlayerNameDecoder).
        var serverNames = Forms(recording.ServerName);
        var guids = await db.Servers.AsNoTracking()
            .Where(s => serverNames.Contains(s.Name))
            .Select(s => s.Guid)
            .ToListAsync(ct);
        if (guids.Count == 0) return null;

        var level = StatsRoundMatcher.LevelKey(recording.Level);
        var rounds = (await db.Rounds.AsNoTracking()
                .Where(r => guids.Contains(r.ServerGuid) && r.StartTime >= from && r.StartTime <= to && !r.IsDeleted)
                .Select(r => new { r.RoundId, r.MapName, r.StartTime, r.EndTime })
                .ToListAsync(ct))
            .Where(r => StatsRoundMatcher.LevelKey(r.MapName) == level)
            .ToList();
        if (rounds.Count == 0) return null;

        var players = await db.RecordingPlayers.AsNoTracking()
            .Where(p => p.RecordingId == recording.Id)
            .Select(p => p.PlayerName)
            .ToListAsync(ct);
        var names = players.SelectMany(Forms).Distinct(StringComparer.Ordinal).ToList();
        var ids = rounds.Select(r => r.RoundId).ToList();
        var seen = await db.PlayerSessions.AsNoTracking()
            .Where(s => s.RoundId != null && ids.Contains(s.RoundId) && !s.IsDeleted)
            .Select(s => new { s.RoundId, s.PlayerName })
            .Distinct()
            .ToListAsync(ct);
        var nameSet = names.ToHashSet(StringComparer.Ordinal);
        var candidates = rounds.Select(r =>
        {
            var inRound = seen.Where(s => s.RoundId == r.RoundId).Select(s => s.PlayerName).ToList();
            return new StatsRoundCandidate(
                r.RoundId,
                DateTime.SpecifyKind(r.StartTime, DateTimeKind.Utc),
                r.EndTime is { } end ? DateTime.SpecifyKind(end, DateTimeKind.Utc) : null,
                inRound.Count,
                inRound.Count(nameSet.Contains));
        }).ToList();

        var hints = await db.Recordings.AsNoTracking()
            .Where(r => r.UploaderUserId == recording.UploaderUserId && r.Id != recording.Id && r.StatsRoundZoneMinutes != null)
            .OrderByDescending(r => r.Id)
            .Take(ZoneHints)
            .Select(r => r.StatsRoundZoneMinutes!.Value)
            .ToListAsync(ct);
        return StatsRoundMatcher.Pick(local, recording.DurationSeconds, shared, players.Count, candidates, hints);
    }

    private static IEnumerable<string> Forms(string name) =>
        new[] { name, PlayerNameDecoder.FromRecording(name), PlayerNameDecoder.ToRecording(name) }.Distinct(StringComparer.Ordinal);
}
