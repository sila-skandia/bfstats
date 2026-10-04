using System.Globalization;
using System.Text.RegularExpressions;
using api.PlayerTracking;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NodaTime;

namespace api.Recordings;

/// <summary>
/// Which shared recordings are of one round (features/replay-feed, "Rounds"). Each keeps a
/// fingerprint of what every client of its round was sent (<see cref="RoundFingerprintBuilder"/>);
/// a new one is compared with the recordings of the same level, game type, mod and server
/// whose headers began within a day or so of it (<see cref="RoundMatcher"/>), and linked to
/// those that match. A round is every recording its links reach. An admin can link two that
/// detection missed, or take one out of a round it was wrongly put in, which detection then
/// leaves alone.
/// </summary>
public interface IRecordingRoundService
{
    /// <summary>Compares one recording with every other that could be of its round and links
    /// it to those that are, unlinking any detection linked before and no longer would. The
    /// number it is linked to by detection.</summary>
    Task<int> DetectAsync(int recordingId, CancellationToken ct);

    /// <summary>An admin puts <paramref name="slug"/> in the round of the recording
    /// <paramref name="other"/> names (a slug or any link to one). False when there is no
    /// <paramref name="slug"/>. Two recordings whose files fall short of what detection needs
    /// are refused with the evidence (<see cref="RecordingRejectedException.Evidence"/>) unless
    /// <paramref name="confirm"/>.</summary>
    Task<bool> LinkAsync(string slug, string? other, RecordingActor actor, bool confirm, CancellationToken ct);

    /// <summary>An admin takes <paramref name="slug"/> out of its round, for good: detection
    /// never links it to those recordings again. False when there is no such recording.</summary>
    Task<bool> SeparateAsync(string slug, RecordingActor actor, CancellationToken ct);

    /// <summary>The rounds of these recordings worked out again from their links, after one of
    /// them lost some (a recording removed with its links).</summary>
    Task RegroupAsync(IReadOnlyCollection<int> roundIds, CancellationToken ct);

    /// <summary>
    /// Fingerprints for the recordings shared before there were any, or under an older
    /// version, read from their files; then every recording not yet compared under the current
    /// settings compared; then every round checked against its links. Run in the background,
    /// never for a request.
    /// </summary>
    Task<RecordingRoundBackfillResult> BackfillAsync(CancellationToken ct);
}

public sealed partial class RecordingRoundService(
    PlayerTrackerDbContext db,
    IRecordingStorage storage,
    IClock clock,
    IOptions<RecordingsOptions> options,
    ILogger<RecordingRoundService> logger) : IRecordingRoundService
{
    /// <summary>One change to the links and rounds at a time: an upload's, the backfill's, an admin's.</summary>
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private static readonly string[] LocalFormats =
        ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd HH:mm"];

    [GeneratedRegex(@"(?:rec=|/recordings/|/replay/)([a-z0-9]{10})(?![a-z0-9])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex SlugInLink();

    public async Task<int> DetectAsync(int recordingId, CancellationToken ct)
    {
        await Gate.WaitAsync(ct);
        try
        {
            return (await DetectHeldAsync(recordingId, ct)).Matched;
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>The recordings it matches, and the links that made new.</summary>
    private async Task<(int Matched, int Added)> DetectHeldAsync(int recordingId, CancellationToken ct)
    {
        var settings = options.Value;
        var fingerprint = await db.RecordingFingerprints.FirstOrDefaultAsync(f => f.RecordingId == recordingId, ct);
        var recording = await db.Recordings.AsNoTracking().FirstOrDefaultAsync(r => r.Id == recordingId, ct);
        if (fingerprint is null || recording is null) return (0, 0);
        var mine = fingerprint.Read();
        var links = await db.RecordingRoundLinks
            .Where(l => l.RecordingId == recordingId || l.OtherRecordingId == recordingId)
            .ToListAsync(ct);
        var touched = new HashSet<int> { recordingId };
        var found = 0;
        var added = 0;
        foreach (var (candidate, theirs) in await CandidatesAsync(recording, ct))
        {
            var match = RoundMatcher.Match(mine, theirs, settings);
            var (low, high) = Ordered(recordingId, candidate);
            // The link keeps the lower id's clock: t_low = t_high + offset.
            var oriented = low == recordingId ? match : match with { OffsetSeconds = -match.OffsetSeconds };
            var link = links.FirstOrDefault(l => l.RecordingId == low && l.OtherRecordingId == high);
            if (link?.Kind == RecordingRoundLinkKind.Separated) continue;
            if (link?.Kind == RecordingRoundLinkKind.Linked)
            {
                // An admin's link stands; it carries what the files say of it.
                link.Measured(oriented);
                continue;
            }
            if (match.SameRound)
            {
                found++;
                if (link is null)
                {
                    link = new RecordingRoundLink
                    {
                        RecordingId = low,
                        OtherRecordingId = high,
                        Kind = RecordingRoundLinkKind.Detected,
                        CreatedAt = clock.GetCurrentInstant(),
                    };
                    db.RecordingRoundLinks.Add(link);
                    touched.Add(candidate);
                    added++;
                }
                link.Measured(oriented);
            }
            else if (link is not null)
            {
                db.RecordingRoundLinks.Remove(link);
                touched.Add(candidate);
            }
        }
        fingerprint.RoundsChecked = settings.RoundSettings;
        await db.SaveChangesAsync(ct);
        if (touched.Count > 1) await RegroupHeldAsync(touched, ct);
        if (found > 0)
        {
            logger.LogInformation("Recording {RecordingId} is one round with {Count} other recordings", recordingId, found);
        }
        return (found, added);
    }

    /// <summary>
    /// The recordings that could be of <paramref name="recording"/>'s round, with their
    /// fingerprints: the same level, game type and mod, the same server (or either names
    /// none), and headers begun within <see cref="RecordingsOptions.RoundCandidateHours"/> and
    /// the longer one's length of each other (a header with no start could be any time).
    /// Found through the level's index; only these few fingerprints are read.
    /// </summary>
    private async Task<List<(int Id, RoundFingerprint Fingerprint)>> CandidatesAsync(Recording recording, CancellationToken ct)
    {
        var settings = options.Value;
        var query = db.Recordings.AsNoTracking().Where(r =>
            r.Level == recording.Level && r.Mod == recording.Mod && r.GameMode == recording.GameMode && r.Id != recording.Id);
        if (recording.ServerName.Length > 0)
        {
            query = query.Where(r => r.ServerName == recording.ServerName || r.ServerName == "");
        }
        var start = LocalStart(recording.RecordedLocal);
        if (start is { } began)
        {
            // The days either side, by the stamp's date; to the hour below.
            var reach = (int)Math.Ceiling((settings.RoundCandidateHours + 48) / 24);
            var days = Enumerable.Range(-reach, (2 * reach) + 1)
                .Select(d => began.AddDays(d).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture))
                .ToList();
            query = query.Where(r => r.RecordedLocal == "" || days.Contains(r.RecordedLocal.Substring(0, 10)));
        }
        var rows = await query
            .Join(db.RecordingFingerprints.AsNoTracking(), r => r.Id, f => f.RecordingId, (r, f) => new { r.Id, r.RecordedLocal, r.DurationSeconds, Fingerprint = f })
            .ToListAsync(ct);
        var result = new List<(int, RoundFingerprint)>();
        foreach (var row in rows)
        {
            if (start is { } mine && LocalStart(row.RecordedLocal) is { } theirs)
            {
                var apart = Math.Abs((theirs - mine).TotalHours);
                if (apart > settings.RoundCandidateHours + (Math.Max(recording.DurationSeconds, row.DurationSeconds) / 3600)) continue;
            }
            result.Add((row.Id, row.Fingerprint.Read()));
        }
        return result;
    }

    public async Task<bool> LinkAsync(string slug, string? other, RecordingActor actor, bool confirm, CancellationToken ct)
    {
        Admin(actor);
        var mine = RecordingStorage.CleanSlug(slug);
        if (mine is null) return false;
        var theirs = SlugIn(other) ?? throw new RecordingRejectedException(
            "Name the recording to put it with: its link, or the ten letters of its id.");
        var rows = await db.Recordings.AsNoTracking()
            .Where(r => r.Slug == mine || r.Slug == theirs)
            .Select(r => new { r.Id, r.Slug, r.Level, r.Mod, r.GameMode })
            .ToListAsync(ct);
        var one = rows.FirstOrDefault(r => r.Slug == mine);
        if (one is null) return false;
        var two = rows.FirstOrDefault(r => r.Slug == theirs)
            ?? throw new RecordingRejectedException($"There is no recording {theirs}.", StatusCodes.Status404NotFound);
        if (one.Id == two.Id) throw new RecordingRejectedException("That is this recording.");
        var sameLevel = one.Level == two.Level && one.Mod == two.Mod && one.GameMode == two.GameMode;

        RecordingRoundEvidenceDto evidence;
        await Gate.WaitAsync(ct);
        try
        {
            var (low, high) = Ordered(one.Id, two.Id);
            var prints = await db.RecordingFingerprints.AsNoTracking()
                .Where(f => f.RecordingId == low || f.RecordingId == high)
                .ToListAsync(ct);
            var a = prints.FirstOrDefault(f => f.RecordingId == low);
            var b = prints.FirstOrDefault(f => f.RecordingId == high);
            // The lower id's clock: t_low = t_high + offset.
            var match = a is not null && b is not null ? RoundMatcher.Match(a.Read(), b.Read(), options.Value) : null;
            evidence = Evidence(match, sameLevel, options.Value);
            // What the files say comes first: the admin reads it, and says yes, before a link
            // they do not bear out makes a round of them.
            if (!evidence.OneRound && !confirm) throw new RecordingRejectedException(evidence);
            var link = await db.RecordingRoundLinks.FirstOrDefaultAsync(l => l.RecordingId == low && l.OtherRecordingId == high, ct);
            if (link is null)
            {
                link = new RecordingRoundLink { RecordingId = low, OtherRecordingId = high };
                db.RecordingRoundLinks.Add(link);
            }
            link.Kind = RecordingRoundLinkKind.Linked;
            link.ByUserId = actor.UserId;
            link.CreatedAt = clock.GetCurrentInstant();
            // Kept as measured; an offset only where detection would have linked them too
            // (two levels are never one round, whatever their keys).
            link.Measured(sameLevel || match is null ? match : match with { SameRound = false });
            await db.SaveChangesAsync(ct);
            await RegroupHeldAsync([low, high], ct);
        }
        finally
        {
            Gate.Release();
        }
        logger.LogInformation(
            "Recording {Slug} put in the round of {Other} by user {UserId}: {Evidence}", mine, theirs, actor.UserId, evidence.Summary);
        return true;
    }

    /// <summary>
    /// What two recordings' fingerprints say of their being one round, in numbers and a line
    /// (features/replay-feed, "Rounds"): <paramref name="match"/> is null while either has no
    /// fingerprint. Recordings of different levels or game types are never one round, whatever
    /// their keys.
    /// </summary>
    internal static RecordingRoundEvidenceDto Evidence(RoundMatch? match, bool sameLevel, RecordingsOptions options)
    {
        var m = match ?? RoundMatch.None;
        var oneRound = match is { SameRound: true } && sameLevel;
        var events = m.Matched == 1 ? "1 shared event" : $"{m.Matched} shared events";
        var theirs = FormattableString.Invariant($"{m.MatchedPlayer} of them the players' own");
        var summary =
            !sameLevel ? "Recorded on different levels or game types: these cannot be one round."
            : match is null ? "Not compared yet: a fingerprint is still to be read from one of their files."
            : oneRound ? $"{events}, {theirs}: one round."
            // Different rounds, or two stretches of one that share no moment (a player who
            // rejoined): nothing in the files can tell which.
            : m.Matched == 0 ? "No shared event: nothing in their files says they are one round."
            : m.Matched < options.RoundMinMatches ? $"{events}: these look like different rounds."
            : m.MatchedPlayer < options.RoundMinPlayerKeys ? $"{events}, {theirs}: these look like different rounds."
            : FormattableString.Invariant(
                $"{events}, but {Math.Round(m.PlayerShare * 100)}% of the players' events where both recorded: these look like different rounds.");
        return new RecordingRoundEvidenceDto(
            match is not null, m.Matched, m.MatchedPlayer, m.PlayerShare, m.OverlapSeconds, sameLevel, oneRound,
            options.RoundMinMatches, options.RoundMinPlayerKeys, options.RoundMinPlayerShare, summary);
    }

    public async Task<bool> SeparateAsync(string slug, RecordingActor actor, CancellationToken ct)
    {
        Admin(actor);
        var clean = RecordingStorage.CleanSlug(slug);
        if (clean is null) return false;
        await Gate.WaitAsync(ct);
        try
        {
            var recording = await db.Recordings.AsNoTracking()
                .Where(r => r.Slug == clean)
                .Select(r => new { r.Id, r.RoundId })
                .FirstOrDefaultAsync(ct);
            if (recording is null) return false;
            if (recording.RoundId is not { } round) return true;
            var members = await db.Recordings.AsNoTracking()
                .Where(r => r.RoundId == round && r.Id != recording.Id)
                .Select(r => r.Id)
                .ToListAsync(ct);
            var links = await db.RecordingRoundLinks
                .Where(l => l.RecordingId == recording.Id || l.OtherRecordingId == recording.Id)
                .ToListAsync(ct);
            var now = clock.GetCurrentInstant();
            foreach (var member in members)
            {
                var (low, high) = Ordered(recording.Id, member);
                var link = links.FirstOrDefault(l => l.RecordingId == low && l.OtherRecordingId == high);
                if (link is null)
                {
                    link = new RecordingRoundLink { RecordingId = low, OtherRecordingId = high };
                    db.RecordingRoundLinks.Add(link);
                }
                link.Kind = RecordingRoundLinkKind.Separated;
                link.ByUserId = actor.UserId;
                link.CreatedAt = now;
            }
            await db.SaveChangesAsync(ct);
            await RegroupHeldAsync([recording.Id, .. members], ct);
        }
        finally
        {
            Gate.Release();
        }
        logger.LogInformation("Recording {Slug} taken out of its round by user {UserId}", clean, actor.UserId);
        return true;
    }

    public async Task RegroupAsync(IReadOnlyCollection<int> roundIds, CancellationToken ct)
    {
        if (roundIds.Count == 0) return;
        await Gate.WaitAsync(ct);
        try
        {
            var members = await db.Recordings.AsNoTracking()
                .Where(r => r.RoundId != null && roundIds.Contains(r.RoundId.Value))
                .Select(r => r.Id)
                .ToListAsync(ct);
            await RegroupHeldAsync(members, ct);
        }
        finally
        {
            Gate.Release();
        }
    }

    /// <summary>
    /// Each round that holds one of <paramref name="seeds"/>, worked out again from the links:
    /// every recording the links reach from it, bar the separated pairs. A round is known by its
    /// lowest id; a recording on its own is in none. The seeds' old rounds are included, since
    /// a round that lost a link may have fallen in two.
    /// </summary>
    private async Task RegroupHeldAsync(IReadOnlyCollection<int> seeds, CancellationToken ct)
    {
        var start = seeds.ToHashSet();
        var rounds = await db.Recordings.AsNoTracking()
            .Where(r => start.Contains(r.Id) && r.RoundId != null)
            .Select(r => r.RoundId!.Value)
            .Distinct()
            .ToListAsync(ct);
        if (rounds.Count > 0)
        {
            start.UnionWith(await db.Recordings.AsNoTracking()
                .Where(r => r.RoundId != null && rounds.Contains(r.RoundId.Value))
                .Select(r => r.Id)
                .ToListAsync(ct));
        }
        var edges = await db.RecordingRoundLinks.AsNoTracking()
            .Where(l => l.Kind != RecordingRoundLinkKind.Separated)
            .Select(l => new { l.RecordingId, l.OtherRecordingId })
            .ToListAsync(ct);
        var next = new Dictionary<int, List<int>>();
        foreach (var edge in edges)
        {
            Neighbours(next, edge.RecordingId).Add(edge.OtherRecordingId);
            Neighbours(next, edge.OtherRecordingId).Add(edge.RecordingId);
        }
        var seen = new HashSet<int>();
        foreach (var seed in start.Order())
        {
            if (!seen.Add(seed)) continue;
            var component = new List<int> { seed };
            for (var i = 0; i < component.Count; i++)
            {
                foreach (var neighbour in next.GetValueOrDefault(component[i]) ?? [])
                {
                    if (seen.Add(neighbour)) component.Add(neighbour);
                }
            }
            int? round = component.Count > 1 ? component.Min() : null;
            await db.Recordings
                .Where(r => component.Contains(r.Id) && r.RoundId != round)
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.RoundId, round), ct);
        }
    }

    private static List<int> Neighbours(Dictionary<int, List<int>> next, int id)
    {
        if (!next.TryGetValue(id, out var list)) next[id] = list = [];
        return list;
    }

    public async Task<RecordingRoundBackfillResult> BackfillAsync(CancellationToken ct)
    {
        var read = 0;
        var failed = 0;
        var unread = await db.Recordings.AsNoTracking()
            .Where(r => !r.FileMissing && !db.RecordingFingerprints.Any(f =>
                f.RecordingId == r.Id && f.Version == RecordingFingerprint.CurrentVersion))
            .OrderBy(r => r.Id)
            .Select(r => new { r.Id, r.Slug })
            .ToListAsync(ct);
        foreach (var recording in unread)
        {
            var fingerprint = await ReadFingerprintAsync(recording.Slug, ct);
            if (fingerprint is null)
            {
                failed++;
                continue;
            }
            await Gate.WaitAsync(ct);
            try
            {
                var now = clock.GetCurrentInstant();
                var row = await db.RecordingFingerprints.FirstOrDefaultAsync(f => f.RecordingId == recording.Id, ct);
                if (row is null)
                {
                    row = RecordingFingerprint.From(fingerprint, now);
                    row.RecordingId = recording.Id;
                    db.RecordingFingerprints.Add(row);
                }
                else
                {
                    row.Replace(fingerprint, now);
                }
                await db.SaveChangesAsync(ct);
                db.ChangeTracker.Clear();
            }
            finally
            {
                Gate.Release();
            }
            read++;
        }

        var settings = options.Value.RoundSettings;
        var stale = await db.RecordingFingerprints.AsNoTracking()
            .Where(f => f.RoundsChecked != settings)
            .OrderBy(f => f.RecordingId)
            .Select(f => f.RecordingId)
            .ToListAsync(ct);
        var linked = 0;
        foreach (var id in stale)
        {
            await Gate.WaitAsync(ct);
            try
            {
                linked += (await DetectHeldAsync(id, ct)).Added;
            }
            finally
            {
                Gate.Release();
            }
            db.ChangeTracker.Clear();
        }

        // Every round against its links: a recording removed outside this service (an account
        // erased) takes its links with it and may leave its round in two.
        await Gate.WaitAsync(ct);
        try
        {
            var all = await db.Recordings.AsNoTracking().Where(r => r.RoundId != null).Select(r => r.Id).ToListAsync(ct);
            all.AddRange(await db.RecordingRoundLinks.AsNoTracking().Select(l => l.RecordingId).ToListAsync(ct));
            await RegroupHeldAsync(all, ct);
        }
        finally
        {
            Gate.Release();
        }
        var result = new RecordingRoundBackfillResult(read, failed, stale.Count, linked);
        if (read + failed + stale.Count > 0)
        {
            logger.LogInformation(
                "Recording rounds: {Read} fingerprints read from their files ({Failed} could not be), {Compared} recordings compared, {Linked} links found",
                read, failed, stale.Count, linked);
        }
        return result;
    }

    /// <summary>A shared recording's fingerprint, read from its file as an upload is read;
    /// null (and a warning) for a file that is not there or not whole.</summary>
    private async Task<RoundFingerprint?> ReadFingerprintAsync(string slug, CancellationToken ct)
    {
        var path = storage.RecordingPath(slug);
        try
        {
            await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, useAsync: true);
            var inspection = await RecordingInspector.InspectAsync(file, stored: null, options.Value.MaxRecordingRawBytes, ct);
            return inspection.Fingerprint;
        }
        catch (Exception ex) when (ex is RecordingRejectedException or IOException or InvalidDataException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Recording {Slug}: its fingerprint could not be read from its file", slug);
            return null;
        }
    }

    private static (int Low, int High) Ordered(int a, int b) => a < b ? (a, b) : (b, a);

    private static void Admin(RecordingActor actor)
    {
        if (!actor.IsAdmin)
        {
            throw new RecordingRejectedException("Only an admin can change which recordings are one round.", StatusCodes.Status403Forbidden);
        }
    }

    /// <summary>The recording a slug or a link names: <c>abcdefghjk</c>,
    /// <c>…/stats/recordings/abcdefghjk.ndjson</c>, <c>…?tab=replay&amp;rec=abcdefghjk</c>,
    /// <c>…/replay/abcdefghjk</c> (its short link).</summary>
    internal static string? SlugIn(string? text)
    {
        var trimmed = (text ?? "").Trim();
        if (trimmed.Length > 2048) return null;
        if (RecordingStorage.CleanSlug(trimmed) is { } slug) return slug;
        var match = SlugInLink().Match(trimmed);
        return match.Success ? RecordingStorage.CleanSlug(match.Groups[1].Value) : null;
    }

    /// <summary>A header's local start, or null when it has none.</summary>
    internal static DateTime? LocalStart(string recordedLocal) =>
        DateTime.TryParseExact(recordedLocal, LocalFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at) ? at : null;
}
