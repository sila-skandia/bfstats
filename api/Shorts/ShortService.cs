using System.Buffers;
using System.Text.Json;
using api.PlayerTracking;
using api.Recordings;
using api.Shorts.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using NodaTime;

namespace api.Shorts;

public sealed class ShortService(
    PlayerTrackerDbContext db,
    ShortStorage storage,
    IClock clock,
    IOptions<ShortsOptions> options,
    ILogger<ShortService> logger) : IShortService
{
    public const int DefaultDays = 7;
    public const int MaxDays = 60;
    public const int DefaultPageSize = 24;
    public const int MaxPageSize = 48;
    public const int MaxTitle = 120;
    public const double MaxLengthSeconds = 120;

    private const int MaxMetaBytes = 64 * 1024;
    private const int MaxName = 64;
    private const int MaxLabel = 80;
    private const int CopyBytes = 80 * 1024;
    private const long MultipartOverhead = 1024 * 1024;

    /// <summary>One upload at a time weighs the room and claims its key, so the same kill sent
    /// twice at once is one Short.</summary>
    private static readonly SemaphoreSlim Commit = new(1, 1);

    private static readonly JsonSerializerOptions MetaJson = new() { PropertyNameCaseInsensitive = true };

    public async Task<PagedShortsDto> ListAsync(int days, string? sort, int page, int pageSize, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, MaxDays);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        var since = (clock.GetCurrentInstant() - Duration.FromDays(days)).ToUnixTimeMilliseconds();

        var query = db.ReplayShorts.AsNoTracking().Where(s => s.CreatedAtMs >= since);
        var total = await query.CountAsync(ct);
        var ordered = string.Equals(sort, "views", StringComparison.OrdinalIgnoreCase)
            ? query.OrderByDescending(s => s.Views).ThenByDescending(s => s.CreatedAtMs).ThenByDescending(s => s.Id)
            : query.OrderByDescending(s => s.CreatedAtMs).ThenByDescending(s => s.Id);
        var rows = await ordered.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);

        // One bad row costs the strip that card, not the page.
        var items = new List<ShortDto>(rows.Count);
        foreach (var row in rows)
        {
            try
            {
                items.Add(ShortDto.From(row));
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Short {Id} could not be listed", row.Id);
            }
        }
        return new PagedShortsDto(items, total, page, pageSize);
    }

    public async Task<ShortDto?> GetAsync(string slug, CancellationToken ct) =>
        await db.ReplayShorts.AsNoTracking().FirstOrDefaultAsync(s => s.Slug == slug, ct) is { } row
            ? ShortDto.From(row)
            : null;

    public async Task<ShortKeysDto> KeysAsync(string? recordingSlug, CancellationToken ct)
    {
        var slug = (recordingSlug ?? "").Trim();
        if (slug.Length != RecordingStorage.SlugLength) return new ShortKeysDto([]);
        var keys = await db.ReplayShorts.AsNoTracking()
            .Where(s => s.RecordingSlug == slug)
            .OrderBy(s => s.KillTime)
            .Select(s => s.Key)
            .ToListAsync(ct);
        return new ShortKeysDto(keys);
    }

    public async Task<(int Id, int Views)?> WatchableAsync(string slug, CancellationToken ct)
    {
        var row = await db.ReplayShorts.AsNoTracking()
            .Where(s => s.Slug == slug)
            .Select(s => new { s.Id, s.Views })
            .FirstOrDefaultAsync(ct);
        return row is null ? null : (row.Id, row.Views);
    }

    public async Task<bool> DeleteAsync(string slug, CancellationToken ct)
    {
        var row = await db.ReplayShorts.FirstOrDefaultAsync(s => s.Slug == slug, ct);
        if (row is null) return false;
        db.ReplayShorts.Remove(row);
        await db.SaveChangesAsync(ct);
        try
        {
            storage.Delete(row.Slug);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Short {Slug} was taken down but its files were not removed", row.Slug);
        }
        logger.LogInformation("Short {Slug} ({Key}) taken down", row.Slug, row.Key);
        return true;
    }

    public async Task<ShortUploadResult> UploadAsync(string? contentType, Stream body, long? contentLength, CancellationToken ct)
    {
        var limits = options.Value;
        var boundary = Boundary(contentType);
        if (contentLength > limits.MaxVideoBytes + limits.MaxPosterBytes + MultipartOverhead)
        {
            throw TooBig(limits.MaxVideoBytes, "A Short's video");
        }

        string? videoFile = null;
        string? posterFile = null;
        try
        {
            ShortUploadMeta? meta = null;
            var reader = new MultipartReader(boundary, body) { HeadersLengthLimit = 16 * 1024 };
            while (await reader.ReadNextSectionAsync(ct) is { } section)
            {
                switch (PartName(section))
                {
                    case "meta" when meta is null:
                        meta = await ReadMetaAsync(section.Body, ct);
                        break;
                    case "video" when videoFile is null:
                        videoFile = storage.IncomingPath();
                        await ReceiveAsync(section.Body, videoFile, limits.MaxVideoBytes, "A Short's video", ct);
                        break;
                    case "poster" when posterFile is null:
                        posterFile = storage.IncomingPath();
                        await ReceiveAsync(section.Body, posterFile, limits.MaxPosterBytes, "A Short's poster", ct);
                        break;
                    default:
                        break;
                }
            }
            if (meta is null) throw new RecordingRejectedException("The upload has no meta part.");
            if (videoFile is null) throw new RecordingRejectedException("The upload has no video part.");
            if (posterFile is null) throw new RecordingRejectedException("The upload has no poster part.");

            var row = Describe(meta);
            if (!await IsMp4Async(videoFile, ct)) throw new RecordingRejectedException("The video is not an MP4 file.");
            if (!await IsJpegAsync(posterFile, ct)) throw new RecordingRejectedException("The poster is not a JPEG file.");
            row.VideoBytes = new FileInfo(videoFile).Length;
            row.PosterBytes = new FileInfo(posterFile).Length;

            var (saved, created) = await CommitAsync(row, videoFile, posterFile);
            if (created)
            {
                videoFile = null;
                posterFile = null;
                logger.LogInformation(
                    "Short {Slug} uploaded: {Key} ({Kind}), {Bytes} bytes", saved.Slug, saved.Key, saved.Kind, saved.VideoBytes);
            }
            return new ShortUploadResult(ShortDto.From(saved), created);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw new RecordingRejectedException(
                TooBig(limits.MaxVideoBytes, "A Short's video").Message, StatusCodes.Status413PayloadTooLarge);
        }
        catch (InvalidDataException ex)
        {
            logger.LogWarning(ex, "Short upload was not readable multipart");
            throw new RecordingRejectedException("The upload is not well-formed multipart/form-data.", ex);
        }
        catch (IOException ex) when (ex is not FileNotFoundException)
        {
            logger.LogWarning(ex, "Short upload broke off");
            throw new RecordingRejectedException("The upload broke off before the whole file arrived. Try again.", ex);
        }
        finally
        {
            Discard(videoFile);
            Discard(posterFile);
        }
    }

    /// <summary>The kill clipped already is the Short there; else this one, weighed against the
    /// room the volume has, moved into place and recorded.</summary>
    private async Task<(ReplayShort Short, bool Created)> CommitAsync(ReplayShort row, string videoFile, string posterFile)
    {
        var ct = CancellationToken.None;
        await Commit.WaitAsync(ct);
        try
        {
            if (await db.ReplayShorts.AsNoTracking().FirstOrDefaultAsync(s => s.Key == row.Key, ct) is { } existing)
            {
                return (existing, false);
            }
            if (storage.RoomFor(await StoredBytesAsync(ct), row.VideoBytes + row.PosterBytes) is { } full)
            {
                throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
            }
            row.Slug = await NewSlugAsync(ct);
            storage.Promote(videoFile, storage.VideoPath(row.Slug));
            try
            {
                storage.Promote(posterFile, storage.PosterPath(row.Slug));
                db.ReplayShorts.Add(row);
                await db.SaveChangesAsync(ct);
            }
            catch
            {
                db.ChangeTracker.Clear();
                storage.Delete(row.Slug);
                throw;
            }
            return (row, true);
        }
        finally
        {
            Commit.Release();
        }
    }

    /// <summary>The row for an upload's details, or the reason they will not do.</summary>
    private ReplayShort Describe(ShortUploadMeta meta)
    {
        var recordingSlug = (meta.RecordingSlug ?? "").Trim();
        if (recordingSlug.Length != RecordingStorage.SlugLength)
        {
            throw new RecordingRejectedException("recordingSlug must be a recording's 10-character slug.");
        }
        if (!double.IsFinite(meta.KillTime) || meta.KillTime < 0)
        {
            throw new RecordingRejectedException("killTime must be a number of seconds, 0 or more.");
        }
        var kind = (meta.Kind ?? "").Trim();
        if (!ShortKinds.All.Contains(kind))
        {
            throw new RecordingRejectedException($"kind must be one of {string.Join(", ", ShortKinds.All)}.");
        }
        var rawTitle = (meta.Title ?? "").Trim();
        var title = RecordingText.Line(rawTitle, MaxTitle);
        if (rawTitle.Length is 0 or > MaxTitle || title.Length == 0)
        {
            throw new RecordingRejectedException($"title must be 1 to {MaxTitle} characters.");
        }
        if (!double.IsFinite(meta.LengthSeconds) || meta.LengthSeconds < 1 || meta.LengthSeconds > MaxLengthSeconds)
        {
            throw new RecordingRejectedException($"lengthSeconds must be 1 to {MaxLengthSeconds:0}.");
        }
        if (!double.IsFinite(meta.Distance) || meta.Distance < 0)
        {
            throw new RecordingRejectedException("distance must be a number of metres, 0 or more.");
        }
        var now = clock.GetCurrentInstant();
        return new ReplayShort
        {
            RecordingSlug = recordingSlug,
            KillTime = meta.KillTime,
            VictimPid = meta.VictimPid,
            Key = ShortKinds.Key(recordingSlug, meta.KillTime, meta.VictimPid),
            Kind = kind,
            Title = title,
            // Names stay as stored (raw); the client decodes them for display.
            Killer = RecordingText.Name(meta.Killer, MaxName),
            Victim = RecordingText.Name(meta.Victim, MaxName),
            Weapon = RecordingText.Line(meta.Weapon, MaxLabel),
            KillerVehicle = Optional(meta.KillerVehicle),
            VictimVehicle = Optional(meta.VictimVehicle),
            Distance = Math.Round(meta.Distance, 1),
            LengthSeconds = Math.Round(meta.LengthSeconds, 3),
            Level = RecordingText.Line(meta.Level, MaxLabel),
            Mod = RecordingText.Line(meta.Mod, MaxLabel),
            CreatedAt = now,
            CreatedAtMs = now.ToUnixTimeMilliseconds(),
        };
    }

    private static string? Optional(string? value) =>
        RecordingText.Line(value, MaxLabel) is { Length: > 0 } clean ? clean : null;

    private async Task<string> NewSlugAsync(CancellationToken ct)
    {
        while (true)
        {
            var slug = RecordingStorage.NewSlug();
            if (!await db.ReplayShorts.AnyAsync(s => s.Slug == slug, ct)) return slug;
        }
    }

    /// <summary>Everything on the volume: the recordings and the Shorts share its quota.</summary>
    private async Task<long> StoredBytesAsync(CancellationToken ct)
    {
        var recordings = await db.Recordings.Where(r => !r.FileMissing)
            .SumAsync(r => r.RecordingBytes + r.ServerLogBytes + r.ThumbnailBytes, ct);
        var shorts = await db.ReplayShorts.SumAsync(s => s.VideoBytes + s.PosterBytes, ct);
        return recordings + shorts;
    }

    /// <summary>An MP4 (ISO BMFF) file opens with its <c>ftyp</c> box: a size, then the type.</summary>
    internal static async Task<bool> IsMp4Async(string path, CancellationToken ct)
    {
        var head = await HeadAsync(path, 8, ct);
        return head.Length == 8 && head[4] == (byte)'f' && head[5] == (byte)'t' && head[6] == (byte)'y' && head[7] == (byte)'p';
    }

    internal static async Task<bool> IsJpegAsync(string path, CancellationToken ct)
    {
        var head = await HeadAsync(path, 2, ct);
        return head.Length == 2 && head[0] == 0xFF && head[1] == 0xD8;
    }

    private static async Task<byte[]> HeadAsync(string path, int count, CancellationToken ct)
    {
        await using var file = File.OpenRead(path);
        var buffer = new byte[count];
        var read = await file.ReadAtLeastAsync(buffer, count, throwOnEndOfStream: false, ct);
        return buffer[..read];
    }

    private static async Task ReceiveAsync(Stream part, string path, long maxBytes, string what, CancellationToken ct)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(CopyBytes);
        try
        {
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, CopyBytes, useAsync: true);
            long taken = 0;
            int read;
            while ((read = await part.ReadAsync(buffer.AsMemory(0, CopyBytes), ct)) > 0)
            {
                taken += read;
                if (taken > maxBytes) throw TooBig(maxBytes, what);
                await file.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            if (taken == 0) throw new RecordingRejectedException($"{what} is empty.");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static async Task<ShortUploadMeta> ReadMetaAsync(Stream part, CancellationToken ct)
    {
        var buffer = new byte[MaxMetaBytes + 1];
        var read = await part.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, ct);
        if (read > MaxMetaBytes) throw new RecordingRejectedException("The upload's meta is too long.");
        try
        {
            return JsonSerializer.Deserialize<ShortUploadMeta>(buffer.AsSpan(0, read), MetaJson)
                ?? throw new RecordingRejectedException("The upload's meta is empty.");
        }
        catch (JsonException ex)
        {
            throw new RecordingRejectedException("The upload's meta is not readable JSON.", ex);
        }
    }

    private static string Boundary(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType)
            || !string.Equals(mediaType.MediaType.Value, "multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            throw new RecordingRejectedException("Send the Short as multipart/form-data.", StatusCodes.Status415UnsupportedMediaType);
        }
        var boundary = HeaderUtilities.RemoveQuotes(mediaType.Boundary).Value;
        return string.IsNullOrWhiteSpace(boundary) || boundary.Length > 200
            ? throw new RecordingRejectedException("The upload has no multipart boundary.")
            : boundary;
    }

    private static string? PartName(MultipartSection section) =>
        ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out var disposition)
            ? HeaderUtilities.RemoveQuotes(disposition.Name).Value
            : null;

    private static RecordingRejectedException TooBig(long maxBytes, string what) =>
        new($"{what} can be at most {RecordingStorage.Size(maxBytes)}.", StatusCodes.Status413PayloadTooLarge);

    private void Discard(string? path)
    {
        if (path is null) return;
        try
        {
            File.Delete(path);
        }
        catch (IOException ex)
        {
            logger.LogWarning(ex, "Could not remove an unfinished Short upload, {Path}", path);
        }
    }
}
