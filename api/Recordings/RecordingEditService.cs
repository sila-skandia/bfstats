using System.Security.Cryptography;
using System.Text.Json;
using api.PlayerTracking;
using api.Recordings.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NodaTime;
using NodaTime.Text;

namespace api.Recordings;

/// <summary>
/// A creator's edit, kept so a link can open it (features/replay-creator-view, "Sharing an
/// edit"). The payload is the studio's own JSON; the API checks only that it is an object and
/// small, since a page reads it and nothing here acts on it.
/// </summary>
public sealed class RecordingEditService(
    PlayerTrackerDbContext db,
    IRecordingService recordings,
    IClock clock,
    IOptions<RecordingsOptions> options) : IRecordingEditService
{
    /// <summary>The largest edit kept, in UTF-8 bytes. A clip with a dozen placed cameras is
    /// about 8 KB.</summary>
    public const int MaxPayloadBytes = 64 * 1024;

    public const int MaxName = 80;
    public const int CodeLength = 8;
    private const string CodeAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";

    /// <summary>SQLITE_CONSTRAINT: a code already taken.</summary>
    private const int SqliteConstraint = 19;

    public async Task<RecordingEditDto?> ShareAsync(
        string slug, RecordingActor actor, ShareRecordingEditRequest request, CancellationToken ct)
    {
        var recording = await db.Recordings.AsNoTracking()
            .Where(r => r.Slug == slug)
            .Select(r => new { r.Id, r.Slug, r.FileMissing })
            .FirstOrDefaultAsync(ct);
        if (recording is null || recording.FileMissing) return null;
        if (request.Edit.ValueKind != JsonValueKind.Object) throw new RecordingRejectedException("That is not an edit.");
        var payload = request.Edit.GetRawText();
        if (System.Text.Encoding.UTF8.GetByteCount(payload) > MaxPayloadBytes)
        {
            throw new RecordingRejectedException("That edit is too big to share.");
        }
        var name = Name(request.Name);
        var author = await AuthorAsync(actor, request.AuthorName, ct);
        for (var attempt = 0; ; attempt++)
        {
            var edit = new RecordingEdit
            {
                Code = NewCode(),
                RecordingId = recording.Id,
                AuthorUserId = actor.UserId,
                AuthorName = author,
                Name = name,
                Payload = payload,
                CreatedAt = clock.GetCurrentInstant(),
            };
            db.RecordingEdits.Add(edit);
            try
            {
                await db.SaveChangesAsync(ct);
                return Dto(edit, recording.Slug);
            }
            catch (DbUpdateException ex) when (attempt < 3 && ex.InnerException is SqliteException { SqliteErrorCode: SqliteConstraint })
            {
                // A code already taken: another.
                db.Entry(edit).State = EntityState.Detached;
            }
        }
    }

    public async Task<RecordingEditDto?> GetAsync(string code, CancellationToken ct)
    {
        if (CleanCode(code) is not { } clean) return null;
        var found = await db.RecordingEdits.AsNoTracking()
            .Where(e => e.Code == clean && !e.Recording.FileMissing)
            .Select(e => new { Edit = e, e.Recording.Slug })
            .FirstOrDefaultAsync(ct);
        return found is null ? null : Dto(found.Edit, found.Slug);
    }

    /// <summary>A code as typed into a link, lower-cased, or null for one that cannot be one.</summary>
    public static string? CleanCode(string? code)
    {
        if (code is null || code.Length != CodeLength) return null;
        var lower = code.ToLowerInvariant();
        return lower.All(c => CodeAlphabet.Contains(c, StringComparison.Ordinal)) ? lower : null;
    }

    public static string NewCode() => RandomNumberGenerator.GetString(CodeAlphabet, CodeLength);

    /// <summary>The edit's name: one line of plain text, cut to <see cref="MaxName"/>; "An edit"
    /// for none.</summary>
    public static string Name(string? name)
    {
        var line = string.Join(' ', (name ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        line = new string(line.Where(c => !char.IsControl(c)).ToArray());
        if (line.Length > MaxName) line = line[..MaxName].TrimEnd();
        return line.Length == 0 ? "An edit" : line;
    }

    /// <summary>The name the edit is shared under: the one asked for, else the account's first
    /// linked name, else none. Sharing an edit needs no linked name; a name not linked is
    /// refused.</summary>
    private async Task<string> AuthorAsync(RecordingActor actor, string? asked, CancellationToken ct)
    {
        try
        {
            return await recordings.SharingNameAsync(actor, asked, "", ct);
        }
        catch (RecordingRejectedException) when (string.IsNullOrWhiteSpace(asked))
        {
            return "";
        }
    }

    private RecordingEditDto Dto(RecordingEdit edit, string slug)
    {
        using var doc = JsonDocument.Parse(edit.Payload);
        return new RecordingEditDto(
            edit.Code, slug, edit.Name, edit.AuthorName, InstantPattern.ExtendedIso.Format(edit.CreatedAt),
            doc.RootElement.Clone(), Link(options.Value.ShortLinkOrigin, slug, edit.Code));
    }

    /// <summary><c>replay.bfstats.io/&lt;slug&gt;?edit=&lt;code&gt;</c>.</summary>
    public static string Link(string shortLinkOrigin, string slug, string code) =>
        $"{shortLinkOrigin.TrimEnd('/')}/{slug}?edit={code}";
}
