using System.Buffers;
using System.Text.Json;
using api.PlayerTracking;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using NodaTime;

namespace api.Recordings;

/// <summary>Sharing a recording to the feed.</summary>
public interface IRecordingUploadService
{
    /// <summary>
    /// Reads a <c>multipart/form-data</c> body: <c>meta</c> (JSON,
    /// <see cref="RecordingUploadMeta"/>), <c>recording</c> (the <c>replay_*.ndjson</c>,
    /// gzipped by the browser where it can) and, optionally, <c>serverlog</c> (its
    /// <c>ev_*.xml</c>, likewise) and <c>thumbnail</c> (a frame of the replay). Throws
    /// <see cref="RecordingRejectedException"/> with the uploader's reason for anything it will
    /// not keep. What is kept of each file is what <see cref="RecordingInspector"/> read of it,
    /// gzipped here.
    /// </summary>
    Task<RecordingDetailDto> UploadAsync(
        string? contentType, Stream body, long? contentLength, RecordingActor actor, CancellationToken ct);
}

public sealed class RecordingUploadService(
    PlayerTrackerDbContext db,
    IRecordingStorage storage,
    IRecordingService recordings,
    IClock clock,
    IOptions<RecordingsOptions> options,
    ILogger<RecordingUploadService> logger) : IRecordingUploadService
{
    private const int MaxMetaBytes = 64 * 1024;
    private const int CopyBytes = 80 * 1024;
    private const long MultipartOverhead = 1024 * 1024;

    /// <summary>One upload at a time weighs the quota and moves its files into place, so two
    /// cannot both fit into the last of the room.</summary>
    private static readonly SemaphoreSlim Commit = new(1, 1);

    private static readonly JsonSerializerOptions MetaJson = new() { PropertyNameCaseInsensitive = true };

    public async Task<RecordingDetailDto> UploadAsync(
        string? contentType, Stream body, long? contentLength, RecordingActor actor, CancellationToken ct)
    {
        var limits = options.Value;
        var boundary = Boundary(contentType);
        if (contentLength > limits.MaxRecordingBytes + limits.MaxServerLogBytes + MultipartOverhead)
        {
            throw TooBig(limits.MaxRecordingBytes);
        }
        // Refused before a byte is read, when it plainly will not fit: the body less what
        // the multipart framing and the details could take.
        if (contentLength is long announced
            && storage.RoomFor(await StoredBytesAsync(ct), Math.Max(0, announced - MultipartOverhead)) is { } full)
        {
            throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
        }

        // Each file twice in .incoming/: as it came, and as it is kept.
        string? recordingFile = null;
        string? logFile = null;
        string? keptRecording = null;
        string? keptLog = null;
        try
        {
            RecordingUploadMeta? meta = null;
            byte[]? thumbnail = null;
            var reader = new MultipartReader(boundary, body) { HeadersLengthLimit = 16 * 1024 };
            while (await reader.ReadNextSectionAsync(ct) is { } section)
            {
                switch (PartName(section))
                {
                    case "meta":
                        meta = await ReadMetaAsync(section.Body, ct);
                        break;
                    case "recording" when recordingFile is null:
                        recordingFile = storage.IncomingPath();
                        await ReceiveAsync(section.Body, recordingFile, limits.MaxRecordingBytes, "A recording", ct);
                        break;
                    case "serverlog" when logFile is null:
                        logFile = storage.IncomingPath();
                        await ReceiveAsync(section.Body, logFile, limits.MaxServerLogBytes, "A server log", ct);
                        break;
                    case "thumbnail" when thumbnail is null:
                        thumbnail = await RecordingThumbnails.NormalizeAsync(section.Body, ct);
                        break;
                    default:
                        // Anything else is drained and ignored by the next read.
                        break;
                }
            }
            if (recordingFile is null) throw new RecordingRejectedException("Choose a recording to share.");

            RecordingInspection inspection;
            keptRecording = storage.IncomingPath();
            await using (var sent = File.OpenRead(recordingFile))
            await using (var kept = NewFile(keptRecording))
            {
                inspection = await RecordingInspector.InspectAsync(sent, kept, limits.MaxRecordingRawBytes, ct);
            }
            if (logFile is not null)
            {
                keptLog = storage.IncomingPath();
                await using var sent = File.OpenRead(logFile);
                await using var kept = NewFile(keptLog);
                await RecordingInspector.InspectServerLogAsync(sent, kept, limits.MaxServerLogRawBytes, ct);
            }

            // Who recorded it: the file's own word, else the uploader's browser's reading of it.
            var recorder = First(inspection.RecordedBy, RecordingText.Name(meta?.RecordedBy, RecordingInspector.MaxPlayerName));
            var author = await recordings.SharingNameAsync(actor, meta?.AuthorName, recorder, ct);
            var recording = Describe(inspection, meta, recorder, author, actor);
            recording.RecordingBytes = new FileInfo(keptRecording).Length;
            recording.ServerLogBytes = keptLog is null ? 0 : new FileInfo(keptLog).Length;
            recording.ThumbnailBytes = thumbnail?.Length ?? 0;

            var shared = await CommitAsync(recording, keptRecording, keptLog, thumbnail);
            keptRecording = null;
            keptLog = null;
            logger.LogInformation(
                "Recording {Slug} shared by user {UserId}: {Level} ({Mod}), {Duration:0}s, {Bytes} bytes",
                shared.Slug, actor.UserId, shared.Level, shared.Mod, shared.DurationSeconds, shared.RecordingBytes);
            return await recordings.DetailAsync(shared, actor, ct);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw new RecordingRejectedException(TooBig(limits.MaxRecordingBytes).Message, StatusCodes.Status413PayloadTooLarge);
        }
        catch (InvalidDataException ex)
        {
            logger.LogWarning(ex, "Recording upload by user {UserId} was not readable multipart", actor.UserId);
            throw new RecordingRejectedException("The upload is not well-formed multipart/form-data.", ex);
        }
        catch (IOException ex) when (ex is not FileNotFoundException)
        {
            logger.LogWarning(ex, "Recording upload by user {UserId} broke off", actor.UserId);
            throw new RecordingRejectedException("The upload broke off before the whole file arrived. Try again.", ex);
        }
        finally
        {
            Discard(recordingFile);
            Discard(logFile);
            Discard(keptRecording);
            Discard(keptLog);
        }
    }

    /// <summary>
    /// Weighs the room, then moves the files into place and records the recording. The same
    /// round shared again is the one already there; if that one's file has gone (the
    /// node's disk is not backed up), this upload puts it back under its old link, with its
    /// views and comments.
    /// </summary>
    private async Task<Recording> CommitAsync(Recording recording, string recordingFile, string? logFile, byte[]? thumbnail)
    {
        // Past the upload, a client that goes away does not leave half a recording: what
        // follows runs to the end.
        var ct = CancellationToken.None;
        await Commit.WaitAsync(ct);
        try
        {
            var existing = await db.Recordings.FirstOrDefaultAsync(r => r.ContentHash == recording.ContentHash, ct);
            if (existing is { FileMissing: false })
            {
                throw new RecordingRejectedException(
                    $"This round is already shared, as \"{existing.Title}\".", StatusCodes.Status409Conflict, existing.Slug);
            }
            var incoming = recording.RecordingBytes + recording.ServerLogBytes + recording.ThumbnailBytes;
            if (storage.RoomFor(await StoredBytesAsync(ct), incoming) is { } full)
            {
                throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
            }

            var target = existing ?? recording;
            if (existing is null)
            {
                target.Slug = await NewSlugAsync(ct);
                db.Recordings.Add(target);
            }
            else
            {
                existing.RecordingBytes = recording.RecordingBytes;
                existing.ServerLogBytes = recording.ServerLogBytes;
                existing.RecordingRawBytes = recording.RecordingRawBytes;
                existing.ThumbnailBytes = recording.ThumbnailBytes;
                existing.FileMissing = false;
                existing.UpdatedAt = recording.UpdatedAt;
                // What was left behind of it goes; this upload is the whole of it now.
                storage.Delete(existing.Slug);
            }
            storage.Promote(recordingFile, storage.RecordingPath(target.Slug));
            if (logFile is not null) storage.Promote(logFile, storage.ServerLogPath(target.Slug));
            try
            {
                if (thumbnail is not null) await storage.WriteThumbnailAsync(target.Slug, thumbnail, ct);
                await db.SaveChangesAsync(ct);
            }
            catch
            {
                storage.Delete(target.Slug);
                throw;
            }
            return target;
        }
        finally
        {
            Commit.Release();
        }
    }

    /// <summary>The row for an upload: what the file says of itself, else what the
    /// uploader's browser read of it.</summary>
    private Recording Describe(
        RecordingInspection inspection, RecordingUploadMeta? meta, string recorder, string author, RecordingActor actor)
    {
        var level = First(inspection.Level, RecordingText.Id(meta?.Level));
        if (level.Length == 0)
        {
            throw new RecordingRejectedException(
                "The recording does not say which level it was recorded on. Open it on the level first, then share it.");
        }
        var server = First(inspection.ServerName, RecordingText.Line(meta?.ServerName, RecordingInspector.MaxServerName));
        var players = inspection.Players.Count > 0
            ? inspection.Players
            : (meta?.Players ?? [])
                .Select(name => RecordingText.Name(name, RecordingInspector.MaxPlayerName))
                .Where(name => name.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .Take(128)
                .ToList();
        var duration = inspection.DurationSeconds > 0
            ? inspection.DurationSeconds
            : Math.Clamp(meta?.DurationSeconds ?? 0, 0, RecordingInspector.MaxDurationSeconds);
        var title = RecordingText.Line(meta?.Title, RecordingText.MaxTitle);
        if (title.Length == 0)
        {
            title = server.Length > 0 ? $"{RecordingText.Titled(level)} on {server}" : RecordingText.Titled(level);
            title = RecordingText.Line(title, RecordingText.MaxTitle);
        }
        var now = clock.GetCurrentInstant();
        return new Recording
        {
            Title = title,
            UploaderUserId = actor.UserId,
            UploaderName = author,
            Level = level,
            Mod = First(inspection.Mod, RecordingText.Id(meta?.Mod), "bf1942"),
            GameMode = First(inspection.GameMode, RecordingText.Id(meta?.GameMode)),
            ServerName = server,
            RecordedBy = recorder,
            RecordedLocal = First(RecordingText.Stamp(inspection.Start), RecordingText.Stamp(meta?.Start)),
            DurationSeconds = Math.Round(duration, 3),
            PlayerCount = players.Count,
            PlayersJson = JsonSerializer.Serialize(players),
            FormatVersion = inspection.Version,
            RecordingRawBytes = inspection.RawBytes,
            ContentHash = inspection.ContentHash,
            CreatedAt = now,
            UpdatedAt = now,
        };
    }

    private async Task<string> NewSlugAsync(CancellationToken ct)
    {
        while (true)
        {
            var slug = RecordingStorage.NewSlug();
            if (!await db.Recordings.AnyAsync(r => r.Slug == slug, ct)) return slug;
        }
    }

    private Task<long> StoredBytesAsync(CancellationToken ct) =>
        db.Recordings.Where(r => !r.FileMissing).SumAsync(r => r.RecordingBytes + r.ServerLogBytes + r.ThumbnailBytes, ct);

    /// <summary>
    /// Streams one part to <paramref name="path"/> as it comes: gzipped by a browser with
    /// <c>CompressionStream</c>, plain from one without. No more than
    /// <paramref name="maxBytes"/> are taken off the wire.
    /// </summary>
    private static async Task ReceiveAsync(Stream part, string path, long maxBytes, string what, CancellationToken ct)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(CopyBytes);
        try
        {
            await using var file = NewFile(path);
            long taken = 0;
            int read;
            while ((read = await part.ReadAsync(buffer.AsMemory(0, CopyBytes), ct)) > 0)
            {
                taken += read;
                if (taken > maxBytes) throw TooBig(maxBytes, what);
                await file.WriteAsync(buffer.AsMemory(0, read), ct);
            }
            if (taken == 0) throw new RecordingRejectedException("The file is empty.");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static FileStream NewFile(string path) =>
        new(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, CopyBytes, useAsync: true);

    private static async Task<RecordingUploadMeta?> ReadMetaAsync(Stream part, CancellationToken ct)
    {
        var buffer = new byte[MaxMetaBytes + 1];
        var read = await part.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, ct);
        if (read > MaxMetaBytes) throw new RecordingRejectedException("The upload's details are too long.");
        try
        {
            return JsonSerializer.Deserialize<RecordingUploadMeta>(buffer.AsSpan(0, read), MetaJson);
        }
        catch (JsonException ex)
        {
            throw new RecordingRejectedException("The upload's details are not readable.", ex);
        }
    }

    private static string Boundary(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType)
            || !string.Equals(mediaType.MediaType.Value, "multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            throw new RecordingRejectedException("Send the recording as multipart/form-data.", StatusCodes.Status415UnsupportedMediaType);
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

    private static RecordingRejectedException TooBig(long maxBytes, string what = "A recording") =>
        new($"{what} can be at most {RecordingStorage.Size(maxBytes)} compressed.", StatusCodes.Status413PayloadTooLarge);

    private static string First(params string[] values) => values.FirstOrDefault(v => v.Length > 0) ?? "";

    private void Discard(string? path)
    {
        if (path is null) return;
        try
        {
            File.Delete(path);
        }
        catch (IOException ex)
        {
            logger.LogWarning(ex, "Could not remove an unfinished upload, {Path}", path);
        }
    }
}
