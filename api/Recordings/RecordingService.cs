using System.Text.Json;
using api.PlayerTracking;
using api.Recordings.Models;
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
    Task<PagedRecordingsDto> ListAsync(string? sort, int page, int pageSize, CancellationToken ct);

    Task<RecordingDetailDto?> GetAsync(string slug, RecordingActor? actor, CancellationToken ct);

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
}

public sealed class RecordingService(
    PlayerTrackerDbContext db,
    IRecordingStorage storage,
    IClock clock,
    IOptions<RecordingsOptions> options,
    ILogger<RecordingService> logger) : IRecordingService
{
    public const int DefaultPageSize = 24;
    public const int MaxPageSize = 48;
    public const int MaxCommentPageSize = 200;

    public async Task<PagedRecordingsDto> ListAsync(string? sort, int page, int pageSize, CancellationToken ct)
    {
        page = Math.Max(1, page);
        pageSize = pageSize is < 1 or > MaxPageSize ? DefaultPageSize : pageSize;
        var shared = db.Recordings.AsNoTracking().Where(r => !r.FileMissing);
        // Newest by id: CreatedAt is an ExtendedIso string, whose varying fraction digits
        // do not sort.
        var ordered = sort == "views"
            ? shared.OrderByDescending(r => r.ViewCount).ThenByDescending(r => r.Id)
            : shared.OrderByDescending(r => r.Id);
        var total = await shared.CountAsync(ct);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        var used = await shared.SumAsync(r => r.RecordingBytes + r.ServerLogBytes + r.ThumbnailBytes, ct);
        return new PagedRecordingsDto(
            [.. rows.Select(Summary)],
            total,
            page,
            pageSize,
            Math.Max(1, (int)Math.Ceiling(total / (double)pageSize)),
            new RecordingStorageDto(used, options.Value.QuotaBytes));
    }

    public async Task<RecordingDetailDto?> GetAsync(string slug, RecordingActor? actor, CancellationToken ct)
    {
        var recording = await Find(slug).AsNoTracking().FirstOrDefaultAsync(ct);
        return recording is null || recording.FileMissing ? null : Detail(recording, actor);
    }

    public async Task<int?> WatchableIdAsync(string slug, CancellationToken ct) =>
        await Find(slug).Where(r => !r.FileMissing).Select(r => (int?)r.Id).FirstOrDefaultAsync(ct);

    public async Task<RecordingViewerDto> ViewerAsync(RecordingActor actor, CancellationToken ct)
    {
        var names = await db.UserPlayerNames.AsNoTracking()
            .Where(n => n.UserId == actor.UserId)
            .OrderBy(n => n.CreatedAt)
            .Select(n => n.PlayerName)
            .ToListAsync(ct);
        return new RecordingViewerDto(actor.UserId, names, actor.IsAdmin);
    }

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
        return Detail(recording, actor);
    }

    public async Task<bool> DeleteAsync(string slug, RecordingActor actor, CancellationToken ct)
    {
        var recording = await Find(slug).FirstOrDefaultAsync(ct);
        if (recording is null) return false;
        Manage(recording, actor);
        db.Recordings.Remove(recording);
        await db.SaveChangesAsync(ct);
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
        return Detail(recording, actor);
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
        var names = await db.UserPlayerNames.AsNoTracking()
            .Where(n => n.UserId == actor.UserId)
            .Select(n => n.PlayerName)
            .ToListAsync(ct);
        return names.FirstOrDefault(n => string.Equals(n, wanted, StringComparison.OrdinalIgnoreCase))
            ?? throw new RecordingRejectedException(
                $"{wanted} is not one of your linked player names.", StatusCodes.Status403Forbidden);
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
    public static string? ThumbnailLink(Recording r) =>
        r.ThumbnailBytes > 0 ? $"/stats/recordings/{r.Slug}.jpg?v={r.UpdatedAt.ToUnixTimeSeconds()}" : null;

    internal static RecordingSummaryDto Summary(Recording r) => new(
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
        ThumbnailLink(r));

    internal static RecordingDetailDto Detail(Recording r, RecordingActor? actor) => new(
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
        actor is not null && (actor.IsAdmin || actor.UserId == r.UploaderUserId));

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
