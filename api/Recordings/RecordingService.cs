using System.Linq.Expressions;
using System.Text.Json;
using api.PlayerTracking;
using api.Recordings.Models;
using api.Utils;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NodaTime;

namespace api.Recordings;

/// <summary>The REPLAY feed (features/replay-feed): the recordings, newest or most watched
/// first, one recording's page, and its comments.</summary>
public interface IRecordingService
{
    Task<PagedRecordingsDto> ListAsync(string? sort, int page, int pageSize, RecordingFilter filter, CancellationToken ct);

    /// <summary>The servers and uploaders the feed can be narrowed to. Each list is counted
    /// within the other's filter and not its own, so the one picked keeps its neighbours.</summary>
    Task<RecordingFiltersDto> FiltersAsync(RecordingFilter filter, CancellationToken ct);

    Task<RecordingDetailDto?> GetAsync(string slug, RecordingActor? actor, CancellationToken ct);

    /// <summary>One recording's page, with the player page its uploader has on bfstats.io.</summary>
    Task<RecordingDetailDto> DetailAsync(Recording recording, RecordingActor? actor, CancellationToken ct);

    /// <summary>The recording's id for counting a view, or null when there is none to watch.</summary>
    Task<int?> WatchableIdAsync(string slug, CancellationToken ct);

    Task<RecordingViewerDto> ViewerAsync(RecordingActor actor, CancellationToken ct);

    Task<RecordingDetailDto?> RenameAsync(string slug, RecordingActor actor, string title, CancellationToken ct);

    Task<bool> DeleteAsync(string slug, RecordingActor actor, CancellationToken ct);

    /// <summary>Sets a recording's cover from an image in <paramref name="body"/>.</summary>
    Task<RecordingDetailDto?> SetThumbnailAsync(string slug, RecordingActor actor, Stream body, CancellationToken ct);

    Task<PagedRecordingCommentsDto?> CommentsAsync(string slug, string? sort, int page, int pageSize, RecordingActor? actor, CancellationToken ct);

    Task<RecordingCommentDto?> AddCommentAsync(string slug, RecordingActor actor, CreateRecordingCommentRequest request, CancellationToken ct);

    Task<bool> DeleteCommentAsync(string slug, int commentId, RecordingActor actor, CancellationToken ct);

    /// <summary>The linked player name <paramref name="name"/> matches, as the account has it;
    /// throws for one the account has not linked.</summary>
    Task<string> PostingNameAsync(RecordingActor actor, string? name, CancellationToken ct);

    /// <summary>
    /// The name a recording is shared under. By default the player who recorded it,
    /// <paramref name="recorder"/> as the file names him, else the account's first linked name;
    /// <paramref name="name"/> picks either instead. Throws for any other name, and when there
    /// is neither.
    /// </summary>
    Task<string> SharingNameAsync(RecordingActor actor, string? name, string recorder, CancellationToken ct);
}

public sealed class RecordingService(
    PlayerTrackerDbContext db,
    IRecordingStorage storage,
    IClock clock,
    IOptions<RecordingsOptions> options,
    ILogger<RecordingService> logger,
    IRecordingRoundService? rounds = null) : IRecordingService
{
    public const int DefaultPageSize = 24;
    public const int MaxPageSize = 48;
    public const int MaxCommentPageSize = 200;

    /// <summary>The most names a filter offers: those with the most recordings.</summary>
    public const int MaxFilterChoices = 100;

    public async Task<PagedRecordingsDto> ListAsync(string? sort, int page, int pageSize, RecordingFilter filter, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = pageSize is < 1 or > MaxPageSize ? DefaultPageSize : pageSize;
        var shared = db.Recordings.AsNoTracking().Where(r => !r.FileMissing);
        var shown = Narrowed(shared, filter);
        // Newest by id: CreatedAt is an ExtendedIso string, whose varying fraction digits
        // do not sort.
        var ordered = sort == "views"
            ? shown.OrderByDescending(r => r.ViewCount).ThenByDescending(r => r.Id)
            : shown.OrderByDescending(r => r.Id);
        var total = await shown.CountAsync(ct);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        // The space is everyone's, whatever the feed is narrowed to.
        var used = await shared.SumAsync(r => r.RecordingBytes + r.ServerLogBytes + r.ThumbnailBytes, ct);
        var players = await PlayersAsync(rows.Select(r => r.UploaderName), ct);
        var roundsOf = await RoundsAsync([.. rows.Select(r => r.Id)], ct);
        return new PagedRecordingsDto(
            [.. rows.Select(r => Summary(r, players.GetValueOrDefault(r.UploaderName), roundsOf.GetValueOrDefault(r.Id)))],
            total,
            page,
            pageSize,
            Math.Max(1, (int)Math.Ceiling(total / (double)pageSize)),
            new RecordingStorageDto(used, options.Value.QuotaBytes));
    }

    public async Task<RecordingFiltersDto> FiltersAsync(RecordingFilter filter, CancellationToken ct)
    {
        var shared = db.Recordings.AsNoTracking().Where(r => !r.FileMissing);
        var servers = await ChoicesAsync(Narrowed(shared, filter with { Server = null }), r => r.ServerName, ct);
        var uploaders = await ChoicesAsync(Narrowed(shared, filter with { Uploader = null }), r => r.UploaderName, ct);
        return new RecordingFiltersDto(servers, uploaders);
    }

    private static IQueryable<Recording> Narrowed(IQueryable<Recording> recordings, RecordingFilter filter)
    {
        if (filter.Server is { } server) recordings = recordings.Where(r => r.ServerName == server);
        if (filter.Uploader is { } uploader) recordings = recordings.Where(r => r.UploaderName == uploader);
        return recordings;
    }

    /// <summary>Each name <paramref name="name"/> gives, with its count: the busiest
    /// <see cref="MaxFilterChoices"/>, in the order of their names. A recording that names no
    /// server is in the feed, but there is no server to pick for it.</summary>
    private static async Task<List<RecordingFilterChoiceDto>> ChoicesAsync(
        IQueryable<Recording> recordings, Expression<Func<Recording, string>> name, CancellationToken ct)
    {
        var busiest = await recordings
            .GroupBy(name)
            .Where(g => g.Key != "")
            .Select(g => new { Name = g.Key, Count = g.Count() })
            .OrderByDescending(c => c.Count).ThenBy(c => c.Name)
            .Take(MaxFilterChoices)
            .ToListAsync(ct);
        return [.. busiest
            .OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).ThenBy(c => c.Name, StringComparer.Ordinal)
            .Select(c => new RecordingFilterChoiceDto(c.Name, c.Count))];
    }

    public async Task<RecordingDetailDto?> GetAsync(string slug, RecordingActor? actor, CancellationToken ct)
    {
        var recording = await Find(slug).AsNoTracking().FirstOrDefaultAsync(ct);
        return recording is null || recording.FileMissing ? null : await DetailAsync(recording, actor, ct);
    }

    public async Task<RecordingDetailDto> DetailAsync(Recording recording, RecordingActor? actor, CancellationToken ct)
    {
        var players = await PlayersAsync([recording.UploaderName], ct);
        var roundsOf = await RoundsAsync([recording.Id], ct);
        return Detail(recording, actor, players.GetValueOrDefault(recording.UploaderName), roundsOf.GetValueOrDefault(recording.Id));
    }

    public async Task<int?> WatchableIdAsync(string slug, CancellationToken ct) =>
        await Find(slug).Where(r => !r.FileMissing).Select(r => (int?)r.Id).FirstOrDefaultAsync(ct);

    public async Task<RecordingViewerDto> ViewerAsync(RecordingActor actor, CancellationToken ct) =>
        new(actor.UserId, await LinkedNamesAsync(actor, ct), actor.IsAdmin);

    public async Task<RecordingDetailDto?> RenameAsync(string slug, RecordingActor actor, string title, CancellationToken ct)
    {
        var recording = await Find(slug).FirstOrDefaultAsync(ct);
        if (recording is null) return null;
        Manage(recording, actor);
        var clean = RecordingText.Line(title, RecordingText.MaxTitle);
        if (clean.Length == 0) throw new RecordingRejectedException("A recording needs a title.");
        recording.Title = clean;
        recording.UpdatedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(ct);
        return await DetailAsync(recording, actor, ct);
    }

    public async Task<bool> DeleteAsync(string slug, RecordingActor actor, CancellationToken ct)
    {
        var recording = await Find(slug).FirstOrDefaultAsync(ct);
        if (recording is null) return false;
        Manage(recording, actor);
        // Its links go with it (cascade); the rest of its round may fall in two.
        var round = await db.Recordings.Where(r => r.Id == recording.Id).Select(r => r.RoundId).FirstOrDefaultAsync(ct);
        db.Recordings.Remove(recording);
        await db.SaveChangesAsync(ct);
        if (round is { } roundId && rounds is not null) await rounds.RegroupAsync([roundId], ct);
        // After the row: a file without a row is swept up; a row without its file would
        // be a dead link in the feed.
        try
        {
            storage.Delete(recording.Slug);
        }
        catch (IOException ex)
        {
            logger.LogWarning(ex, "Recording {Slug} deleted, but its files were not", recording.Slug);
        }
        logger.LogInformation("Recording {Slug} deleted by user {UserId}", recording.Slug, actor.UserId);
        return true;
    }

    public async Task<RecordingDetailDto?> SetThumbnailAsync(string slug, RecordingActor actor, Stream body, CancellationToken ct)
    {
        var recording = await Find(slug).FirstOrDefaultAsync(ct);
        if (recording is null || recording.FileMissing) return null;
        Manage(recording, actor);
        var jpeg = await RecordingThumbnails.NormalizeAsync(body, ct);
        var stored = await db.Recordings.Where(r => !r.FileMissing)
            .SumAsync(r => r.RecordingBytes + r.ServerLogBytes + r.ThumbnailBytes, ct);
        if (storage.RoomFor(stored - recording.ThumbnailBytes, jpeg.Length) is { } full)
        {
            throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
        }
        await storage.WriteThumbnailAsync(recording.Slug, jpeg, ct);
        recording.ThumbnailBytes = jpeg.Length;
        recording.UpdatedAt = clock.GetCurrentInstant();
        await db.SaveChangesAsync(ct);
        return await DetailAsync(recording, actor, ct);
    }

    public async Task<PagedRecordingCommentsDto?> CommentsAsync(
        string slug, string? sort, int page, int pageSize, RecordingActor? actor, CancellationToken ct)
    {
        var recording = await Find(slug).AsNoTracking()
            .Select(r => new { r.Id, r.UploaderUserId, r.FileMissing })
            .FirstOrDefaultAsync(ct);
        if (recording is null || recording.FileMissing) return null;
        page = Math.Max(1, page);
        pageSize = pageSize is < 1 or > MaxCommentPageSize ? 20 : pageSize;
        var comments = db.RecordingComments.AsNoTracking().Where(c => c.RecordingId == recording.Id);
        // `time`: in the order they happen in the round, for the replay's own list; the
        // ones that name no time after.
        var ordered = sort == "time"
            ? comments.OrderBy(c => c.AtSeconds == null).ThenBy(c => c.AtSeconds).ThenBy(c => c.Id)
            : comments.OrderByDescending(c => c.Id);
        var total = await comments.CountAsync(ct);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        var owner = actor is not null && (actor.IsAdmin || actor.UserId == recording.UploaderUserId);
        return new PagedRecordingCommentsDto(
            [.. rows.Select(c => CommentDto(c, owner || c.AuthorUserId == actor?.UserId))],
            total,
            page,
            pageSize,
            Math.Max(1, (int)Math.Ceiling(total / (double)pageSize)));
    }

    public async Task<RecordingCommentDto?> AddCommentAsync(
        string slug, RecordingActor actor, CreateRecordingCommentRequest request, CancellationToken ct)
    {
        var recording = await Find(slug).AsNoTracking()
            .Select(r => new { r.Id, r.DurationSeconds, r.FileMissing })
            .FirstOrDefaultAsync(ct);
        if (recording is null || recording.FileMissing) return null;
        var content = RecordingText.Comment(request.Content);
        if (content.Length == 0) throw new RecordingRejectedException("Write something first.");
        if (content.Length > RecordingText.MaxComment)
        {
            throw new RecordingRejectedException($"A comment runs to {RecordingText.MaxComment} characters at most.");
        }
        var author = await PostingNameAsync(actor, request.AuthorName, ct);
        var comment = new RecordingComment
        {
            RecordingId = recording.Id,
            AuthorUserId = actor.UserId,
            AuthorName = author,
            Content = content,
            AtSeconds = RecordingText.FirstTime(content, recording.DurationSeconds),
            CreatedAt = clock.GetCurrentInstant(),
        };
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.RecordingComments.Add(comment);
        await db.SaveChangesAsync(ct);
        await db.Recordings.Where(r => r.Id == recording.Id)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.CommentCount, r => r.CommentCount + 1), ct);
        await transaction.CommitAsync(ct);
        return CommentDto(comment, canDelete: true);
    }

    public async Task<bool> DeleteCommentAsync(string slug, int commentId, RecordingActor actor, CancellationToken ct)
    {
        var comment = await db.RecordingComments
            .Include(c => c.Recording)
            .FirstOrDefaultAsync(c => c.Id == commentId && c.Recording.Slug == slug, ct);
        if (comment is null) return false;
        // Its author, the recording's uploader, or an admin.
        if (comment.AuthorUserId != actor.UserId && comment.Recording.UploaderUserId != actor.UserId && !actor.IsAdmin)
        {
            throw new RecordingRejectedException("That comment is not yours to remove.", StatusCodes.Status403Forbidden);
        }
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.RecordingComments.Remove(comment);
        await db.SaveChangesAsync(ct);
        await db.Recordings.Where(r => r.Id == comment.RecordingId && r.CommentCount > 0)
            .ExecuteUpdateAsync(set => set.SetProperty(r => r.CommentCount, r => r.CommentCount - 1), ct);
        await transaction.CommitAsync(ct);
        return true;
    }

    public async Task<string> PostingNameAsync(RecordingActor actor, string? name, CancellationToken ct)
    {
        var wanted = (name ?? "").Trim();
        if (wanted.Length == 0)
        {
            throw new RecordingRejectedException("Choose which of your player names to post as.");
        }
        var names = await LinkedNamesAsync(actor, ct);
        return names.FirstOrDefault(n => string.Equals(n, wanted, StringComparison.OrdinalIgnoreCase))
            ?? throw new RecordingRejectedException(
                $"{wanted} is not one of your linked player names.", StatusCodes.Status403Forbidden);
    }

    public async Task<string> SharingNameAsync(RecordingActor actor, string? name, string recorder, CancellationToken ct)
    {
        var wanted = RecordingText.Name(name, RecordingInspector.MaxPlayerName);
        if (recorder.Length > 0 && (wanted.Length == 0 || string.Equals(wanted, recorder, StringComparison.OrdinalIgnoreCase)))
        {
            return recorder;
        }
        var names = await LinkedNamesAsync(actor, ct);
        if (wanted.Length == 0)
        {
            return names.FirstOrDefault() ?? throw new RecordingRejectedException(
                "The recording does not say who recorded it. Link your in-game name to share it.");
        }
        return names.FirstOrDefault(n => string.Equals(n, wanted, StringComparison.OrdinalIgnoreCase))
            ?? throw new RecordingRejectedException(
                $"{wanted} is not the player who recorded this or one of your linked player names.",
                StatusCodes.Status403Forbidden);
    }

    /// <summary>The account's linked player names, the first it linked first.</summary>
    private Task<List<string>> LinkedNamesAsync(RecordingActor actor, CancellationToken ct) =>
        db.UserPlayerNames.AsNoTracking()
            .Where(n => n.UserId == actor.UserId)
            .OrderBy(n => n.CreatedAt)
            .Select(n => n.PlayerName)
            .ToListAsync(ct);

    /// <summary>
    /// The round each of <paramref name="ids"/> is one recording of (features/replay-feed,
    /// "Rounds"): every recording of it still in the feed, in the order they began in the round,
    /// each with how it is tied to the one asked about. A recording in no round, or whose
    /// round has no other recording left in the feed, has no entry. The rounds are read from
    /// the database, not from the rows the caller holds: an upload's own was just changed
    /// under it.
    /// </summary>
    private async Task<Dictionary<int, IReadOnlyList<RecordingRoundMemberDto>>> RoundsAsync(
        IReadOnlyCollection<int> ids, CancellationToken ct)
    {
        if (ids.Count == 0) return [];
        var asked = await db.Recordings.AsNoTracking()
            .Where(r => ids.Contains(r.Id) && r.RoundId != null)
            .Select(r => new { r.Id, Round = r.RoundId!.Value })
            .ToListAsync(ct);
        if (asked.Count == 0) return [];
        var roundIds = asked.Select(a => a.Round).Distinct().ToList();
        var members = await db.Recordings.AsNoTracking()
            .Where(r => r.RoundId != null && roundIds.Contains(r.RoundId.Value))
            .Select(r => new RoundRow(
                r.Id, r.RoundId!.Value, r.Slug, r.Title, r.UploaderName, r.RecordedBy, r.DurationSeconds,
                r.ServerLogBytes, r.ThumbnailBytes, r.UpdatedAt, r.FileMissing))
            .ToListAsync(ct);
        var memberIds = members.Select(m => m.Id).ToList();
        var links = await db.RecordingRoundLinks.AsNoTracking()
            .Where(l => memberIds.Contains(l.RecordingId) && l.Kind != RecordingRoundLinkKind.Separated)
            .ToListAsync(ct);
        var players = await PlayersAsync(members.Where(m => !m.FileMissing).Select(m => m.UploaderName), ct);
        var result = new Dictionary<int, IReadOnlyList<RecordingRoundMemberDto>>();
        foreach (var round in members.GroupBy(m => m.Round))
        {
            var shown = round.Where(m => !m.FileMissing).ToList();
            if (shown.Count < 2) continue;
            var offsets = RoundOffsets([.. round.Select(m => m.Id)], links);
            var ordered = shown
                .OrderBy(m => offsets.TryGetValue(m.Id, out var at) ? at : double.MaxValue)
                .ThenBy(m => m.Id)
                .ToList();
            foreach (var one in asked.Where(a => a.Round == round.Key))
            {
                result[one.Id] = [.. ordered.Select(m => Member(m, one.Id, links, offsets, players))];
            }
        }
        return result;
    }

    /// <summary>Where each recording's <c>t = 0</c> falls on its round's clock, as far as the
    /// links measured it: from the lowest id, each link moving the next along, then shifted so
    /// the one that began first begins at 0.</summary>
    private static Dictionary<int, double> RoundOffsets(IReadOnlyList<int> members, IReadOnlyList<RecordingRoundLink> links)
    {
        var at = new Dictionary<int, double>();
        if (members.Count == 0) return at;
        at[members.Min()] = 0;
        var measured = links.Where(l => l.OffsetSeconds is not null).ToList();
        for (var changed = true; changed;)
        {
            changed = false;
            foreach (var link in measured)
            {
                // t_recording = t_other + offset: the other's t = 0 is at the recording's `offset`.
                if (at.TryGetValue(link.RecordingId, out var a) && !at.ContainsKey(link.OtherRecordingId))
                {
                    at[link.OtherRecordingId] = a + link.OffsetSeconds!.Value;
                    changed = true;
                }
                else if (at.TryGetValue(link.OtherRecordingId, out var b) && !at.ContainsKey(link.RecordingId))
                {
                    at[link.RecordingId] = b - link.OffsetSeconds!.Value;
                    changed = true;
                }
            }
        }
        var first = at.Values.Min();
        return at.ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value - first, 3));
    }

    private static RecordingRoundMemberDto Member(
        RoundRow m, int askedId, IReadOnlyList<RecordingRoundLink> links, Dictionary<int, double> offsets,
        Dictionary<string, string> players)
    {
        var direct = links.FirstOrDefault(l =>
            (l.RecordingId == askedId && l.OtherRecordingId == m.Id) || (l.RecordingId == m.Id && l.OtherRecordingId == askedId));
        var link = m.Id == askedId ? "self"
            : direct is null ? null
            : direct.Kind == RecordingRoundLinkKind.Linked ? "linked"
            : "detected";
        return new RecordingRoundMemberDto(
            m.Slug,
            m.Title,
            m.UploaderName,
            players.GetValueOrDefault(m.UploaderName),
            m.RecordedBy,
            m.DurationSeconds,
            offsets.TryGetValue(m.Id, out var offset) ? offset : null,
            RecordingLink(m.Slug),
            m.ServerLogBytes > 0 ? ServerLogLink(m.Slug) : null,
            ThumbnailLink(m.Slug, m.ThumbnailBytes, m.UpdatedAt),
            link,
            direct?.MatchedKeys,
            direct?.PlayerShare);
    }

    private sealed record RoundRow(
        int Id, int Round, string Slug, string Title, string UploaderName, string RecordedBy, double DurationSeconds,
        long ServerLogBytes, long ThumbnailBytes, Instant UpdatedAt, bool FileMissing);

    /// <summary>
    /// The bfstats.io players among <paramref name="names"/>, each under the name the site has
    /// them by, for a link to their page: a recording writes a name's bytes as U+0000 to U+00FF,
    /// and BFList hands the site the same bytes read as cp1252. A name the site has no human
    /// player by has no entry.
    /// </summary>
    private async Task<Dictionary<string, string>> PlayersAsync(IEnumerable<string> names, CancellationToken ct)
    {
        var asked = names.Where(n => n.Length > 0).Distinct(StringComparer.Ordinal)
            .ToDictionary(n => n, PlayerNameDecoder.FromRecording, StringComparer.Ordinal);
        if (asked.Count == 0) return [];
        var candidates = asked.Values.Distinct(StringComparer.Ordinal).ToList();
        var known = (await db.Players.AsNoTracking()
            .Where(p => candidates.Contains(p.Name) && !p.AiBot)
            .Select(p => p.Name)
            .ToListAsync(ct)).ToHashSet(StringComparer.Ordinal);
        return asked.Where(a => known.Contains(a.Value)).ToDictionary(a => a.Key, a => a.Value, StringComparer.Ordinal);
    }

    private IQueryable<Recording> Find(string slug)
    {
        var clean = RecordingStorage.CleanSlug(slug) ?? "";
        return db.Recordings.Where(r => r.Slug == clean);
    }

    private static void Manage(Recording recording, RecordingActor actor)
    {
        if (recording.UploaderUserId != actor.UserId && !actor.IsAdmin)
        {
            throw new RecordingRejectedException("Only whoever shared this recording can change it.", StatusCodes.Status403Forbidden);
        }
    }

    public static string RecordingLink(string slug) => $"/stats/recordings/{slug}.ndjson";

    public static string ServerLogLink(string slug) => $"/stats/recordings/{slug}.xml";

    /// <summary>The cover's link, versioned by the recording's last change: a new cover is a
    /// new URL, past any cached copy of the old.</summary>
    public static string? ThumbnailLink(Recording r) => ThumbnailLink(r.Slug, r.ThumbnailBytes, r.UpdatedAt);

    private static string? ThumbnailLink(string slug, long bytes, Instant updatedAt) =>
        bytes > 0 ? $"/stats/recordings/{slug}.jpg?v={updatedAt.ToUnixTimeSeconds()}" : null;

    internal static RecordingSummaryDto Summary(Recording r, string? player, IReadOnlyList<RecordingRoundMemberDto>? round = null) => new(
        r.Slug,
        r.Title,
        r.UploaderName,
        r.Level,
        r.Mod,
        r.GameMode,
        r.ServerName,
        r.RecordedLocal,
        r.DurationSeconds,
        r.PlayerCount,
        r.ViewCount,
        r.CommentCount,
        r.CreatedAt,
        RecordingLink(r.Slug),
        r.ServerLogBytes > 0 ? ServerLogLink(r.Slug) : null,
        ThumbnailLink(r),
        player,
        round);

    internal static RecordingDetailDto Detail(
        Recording r, RecordingActor? actor, string? player, IReadOnlyList<RecordingRoundMemberDto>? round = null) => new(
        r.Slug,
        r.Title,
        r.UploaderName,
        r.Level,
        r.Mod,
        r.GameMode,
        r.ServerName,
        r.RecordedLocal,
        r.RecordedBy,
        r.DurationSeconds,
        Players(r.PlayersJson),
        r.FormatVersion,
        r.RecordingBytes,
        r.RecordingRawBytes,
        r.ViewCount,
        r.CommentCount,
        r.CreatedAt,
        RecordingLink(r.Slug),
        r.ServerLogBytes > 0 ? ServerLogLink(r.Slug) : null,
        ThumbnailLink(r),
        actor is not null && (actor.IsAdmin || actor.UserId == r.UploaderUserId),
        player,
        round,
        actor?.IsAdmin == true);

    private static RecordingCommentDto CommentDto(RecordingComment c, bool canDelete) =>
        new(c.Id, c.AuthorName, c.Content, c.AtSeconds, c.CreatedAt, canDelete);

    private static List<string> Players(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<List<string>>(json) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}
