using System.Buffers;
using System.Text.Json;
using api.PlayerTracking;
using api.Recordings;
using api.Shorts.Models;
using api.Utils;
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
    ILogger<ShortService> logger,
    IVideoFlattener? flattener = null) : IShortService
{
    public const int DefaultDays = 7;
    /// <summary>Ten years: a player's or a server's page asks for all of them.</summary>
    public const int MaxDays = 3650;
    public const int DefaultPageSize = 24;
    public const int MaxPageSize = 48;
    public const int MaxTitle = 120;
    public const double MaxLengthSeconds = 120;

    private const int MaxMetaBytes = 64 * 1024;
    private const int MaxName = 64;
    private const int MaxPlayers = 64;
    private const int MaxListedPlayers = 500;
    private const int MaxLabel = 80;
    private const int CopyBytes = 80 * 1024;
    private const long MultipartOverhead = 1024 * 1024;

    /// <summary>One upload at a time weighs the room and claims its key, so the same kill sent
    /// twice at once is one Short.</summary>
    private static readonly SemaphoreSlim Commit = new(1, 1);

    private static readonly JsonSerializerOptions MetaJson = new() { PropertyNameCaseInsensitive = true };

    /// <summary>The players in the last <paramref name="days"/>' Shorts, most featured first.</summary>
    public async Task<ShortPlayersDto> PlayersAsync(int days, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, MaxDays);
        var since = (clock.GetCurrentInstant() - Duration.FromDays(days)).ToUnixTimeMilliseconds();
        var rows = await db.ReplayShortPlayers.AsNoTracking()
            .Where(p => p.Short.CreatedAtMs >= since && p.Short.PrunedAt == null)
            .GroupBy(p => p.Name)
            .Select(g => new
            {
                Name = g.Key,
                Shorts = g.Select(p => p.ShortId).Distinct().Count(),
                AsKiller = g.Where(p => p.Role == ShortPlayerRoles.Killer).Select(p => p.ShortId).Distinct().Count(),
            })
            .OrderByDescending(r => r.AsKiller).ThenByDescending(r => r.Shorts).ThenBy(r => r.Name)
            .Take(MaxListedPlayers)
            .ToListAsync(ct);
        return new ShortPlayersDto([.. rows.Select(r => new ShortPlayerDto(r.Name, r.Shorts, r.AsKiller))]);
    }

    /// <param name="kind">Comma-separated kinds (<see cref="ShortKinds"/>), the strip's
    /// filters; null or blank is every kind, and one naming no known kind is none.</param>
    /// <param name="player">A player in it (killer, victim or creator). The strip sends the
    /// raw stored name; bfstats.io's player page sends the site's, so both forms match.</param>
    /// <param name="server">The server its recording was made on, by the site's or the
    /// recording's form of the name (features/replay-shorts, "On the stats pages").</param>
    public async Task<PagedShortsDto> ListAsync(int days, string? sort, int page, int pageSize, CancellationToken ct,
        string? kind = null, string? player = null, string? server = null)
    {
        days = Math.Clamp(days, 1, MaxDays);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, MaxPageSize);
        var since = (clock.GetCurrentInstant() - Duration.FromDays(days)).ToUnixTimeMilliseconds();

        var query = db.ReplayShorts.AsNoTracking().Where(s => s.CreatedAtMs >= since && s.PrunedAt == null);
        if (!string.IsNullOrWhiteSpace(kind))
        {
            string[] kinds = [.. kind.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Where(ShortKinds.All.Contains).Distinct()];
            query = query.Where(s => kinds.Contains(s.Kind));
        }
        if (!string.IsNullOrEmpty(player))
        {
            // The raw stored name, matched exactly (the strip sends back what it was given).
            // EXISTS, not a join: SQLite's planner (deploy/PRODUCTION_ISSUES.md).
            var names = BothForms(player);
            query = query.Where(s => db.ReplayShortPlayers.Any(p => p.ShortId == s.Id && names.Contains(p.Name)));
        }
        if (!string.IsNullOrEmpty(server))
        {
            // Through the recording's server index, then the Shorts' recording index.
            var names = BothForms(server);
            var recordings = db.Recordings.Where(r => names.Contains(r.ServerName)).Select(r => r.Slug);
            query = query.Where(s => recordings.Contains(s.RecordingSlug));
        }
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

    private static List<string> BothForms(string name) =>
        [.. new[] { name, PlayerNameDecoder.ToRecording(name) }.Distinct(StringComparer.Ordinal)];

    public async Task<ShortDto?> GetAsync(string slug, CancellationToken ct) =>
        await db.ReplayShorts.AsNoTracking().FirstOrDefaultAsync(s => s.Slug == slug && s.PrunedAt == null, ct) is { } row
            ? ShortDto.From(row)
            : null;

    /// <summary>Pruned Shorts' keys too: a kill taken down for want of views is not filmed again.</summary>
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
            .Where(s => s.Slug == slug && s.PrunedAt == null)
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

    public async Task<ShortPruneDto> PruneUnwatchedAsync(bool dryRun, CancellationToken ct)
    {
        var limits = options.Value;
        var now = clock.GetCurrentInstant();
        var cutoff = (now - Duration.FromDays(limits.RetentionDays)).ToUnixTimeMilliseconds();
        // Never a creator's share (CreatorUserId set): that is a player's own clip from the
        // studio, theirs to take down, not the render job's to tidy away.
        var stale = await db.ReplayShorts
            .Where(s => s.PrunedAt == null && s.CreatedAtMs <= cutoff && s.Views <= limits.RetentionMaxViews
                && s.CreatorUserId == null)
            .OrderBy(s => s.CreatedAtMs)
            .ToListAsync(ct);
        var taken = new List<PrunedShortDto>(stale.Count);
        foreach (var s in stale)
        {
            var ageDays = Math.Round((now - s.CreatedAt).TotalDays, 1);
            if (dryRun)
            {
                taken.Add(new PrunedShortDto(s.Slug, s.Kind, ageDays, s.Views));
                continue;
            }
            // A tombstone, not a delete: the row keeps its key, which /keys still names, so the
            // nightly render job does not film the kill again. Its files go and its sizes are 0,
            // so the volume's sum stops counting them.
            try
            {
                storage.Delete(s.Slug);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(ex, "Retention could not remove Short {Slug}'s files; the next run tries again", s.Slug);
                continue;
            }
            s.PrunedAt = now;
            s.VideoBytes = 0;
            s.HdVideoBytes = 0;
            s.LinkVideoBytes = 0;
            s.PosterBytes = 0;
            await db.SaveChangesAsync(ct);
            taken.Add(new PrunedShortDto(s.Slug, s.Kind, ageDays, s.Views));
            logger.LogInformation("Retention took down Short {Slug} ({Kind}), {AgeDays:0.0} days old with {Views} views",
                s.Slug, s.Kind, ageDays, s.Views);
        }
        var swept = dryRun ? 0 : storage.SweepStaleParts(TimeSpan.FromHours(limits.PartsMaxAgeHours));
        logger.LogInformation(
            "Retention {Verb} {Count} Shorts {Days} days old or more with {MaxViews} views or fewer, and swept {Parts} unjoined parts",
            dryRun ? "would take down" : "took down", taken.Count, limits.RetentionDays, limits.RetentionMaxViews, swept);
        return new ShortPruneDto(dryRun, taken, swept);
    }

    public async Task<ShortDto?> SetPosterAsync(string slug, Stream body, CancellationToken ct)
    {
        var row = await db.ReplayShorts.FirstOrDefaultAsync(s => s.Slug == slug && s.PrunedAt == null, ct);
        if (row is null) return null;
        string? posterFile = storage.IncomingPath();
        try
        {
            await ReceiveAsync(body, posterFile, options.Value.MaxPosterBytes, "A Short's poster", ct);
            if (!await IsJpegAsync(posterFile, ct)) throw new RecordingRejectedException("The poster is not a JPEG file.");
            var bytes = new FileInfo(posterFile).Length;
            storage.ReplacePoster(posterFile, row.Slug);
            posterFile = null;
            row.PosterBytes = bytes;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Short {Slug} has a new poster, {Bytes} bytes", row.Slug, bytes);
            return ShortDto.From(row);
        }
        finally
        {
            Discard(posterFile);
        }
    }

    public async Task<ShortDto?> SetLinkVideoAsync(string slug, Stream body, CancellationToken ct)
    {
        var row = await db.ReplayShorts.FirstOrDefaultAsync(s => s.Slug == slug && s.PrunedAt == null, ct);
        if (row is null) return null;
        string? videoFile = storage.IncomingPath();
        try
        {
            var limit = options.Value.MaxLinkVideoBytes;
            await ReceiveAsync(body, videoFile, limit, "A Short's link video", ct);
            if (!await IsMp4Async(videoFile, ct)) throw new RecordingRejectedException("The link video is not an MP4 file.");
            if (flattener is not null) await flattener.FlattenAsync(videoFile, ct);
            var bytes = new FileInfo(videoFile).Length;
            if (bytes > limit) throw TooBig(limit, "A Short's link video");
            var growth = bytes - row.LinkVideoBytes;
            if (growth > 0 && storage.RoomFor(await StoredBytesAsync(ct), growth) is { } full)
            {
                throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
            }
            storage.ReplaceLinkVideo(videoFile, row.Slug);
            videoFile = null;
            row.LinkVideoBytes = bytes;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Short {Slug} has a link video, {Bytes} bytes", row.Slug, bytes);
            return ShortDto.From(row);
        }
        finally
        {
            Discard(videoFile);
        }
    }

    public async Task<ShortDto?> FlattenVideoAsync(string slug, CancellationToken ct)
    {
        var row = await db.ReplayShorts.FirstOrDefaultAsync(s => s.Slug == slug && s.PrunedAt == null, ct);
        if (row is null) return null;
        var path = storage.VideoPath(row.Slug);
        if (flattener is not null && File.Exists(path) && await flattener.FlattenAsync(path, ct))
        {
            row.VideoBytes = new FileInfo(path).Length;
            await db.SaveChangesAsync(ct);
        }
        return ShortDto.From(row);
    }

    public Task<ShortUploadResult> UploadAsync(string? contentType, Stream body, long? contentLength, CancellationToken ct) =>
        ReceiveAsync(contentType, body, contentLength, flatten: false, meta => Task.FromResult(Describe(meta)), ct, rollsAllowed: true);

    public async Task<ShortUploadResult> ShareAsync(string? contentType, Stream body, long? contentLength, int userId, CancellationToken ct)
    {
        var creator = await db.UserPlayerNames.AsNoTracking()
            .Where(n => n.UserId == userId)
            .OrderBy(n => n.CreatedAt)
            .Select(n => n.PlayerName)
            .FirstOrDefaultAsync(ct)
            ?? throw new RecordingRejectedException("Link your in-game name to your account to share a Short.");
        return await ReceiveAsync(contentType, body, contentLength, flatten: true, async meta =>
        {
            // Of a shared round, kind and key its own: a creator may share any clip of any round,
            // as many as he likes, each one Short.
            var row = Describe(meta with { Kind = ShortKinds.Creator });
            if (!await db.Recordings.AsNoTracking().AnyAsync(r => r.Slug == row.RecordingSlug, ct))
            {
                throw new RecordingRejectedException("That round is not one of the shared recordings.", StatusCodes.Status404NotFound);
            }
            row.Key = $"share:{userId}:{Guid.NewGuid():N}";
            row.CreatorUserId = userId;
            row.CreatorName = creator;
            row.Players.Add(new ReplayShortPlayer { Name = creator, Role = ShortPlayerRoles.Creator });
            return row;
        }, ct);
    }

    public Task<bool> SharedByAsync(string slug, int userId, CancellationToken ct) =>
        db.ReplayShorts.AsNoTracking().AnyAsync(s => s.Slug == slug && s.CreatorUserId == userId, ct);

    /// <summary>The largest upload body for a Short of <paramref name="kind"/>: its video, HD
    /// copy and poster, and the framing round them.</summary>
    internal static long BodyLimit(ShortsOptions limits, string? kind) =>
        limits.VideoLimit(kind) + limits.HdVideoLimit(kind) + limits.MaxPosterBytes + MultipartOverhead;

    /// <summary>An upload received; <paramref name="flatten"/> rewrites a fragmented MP4 (a
    /// studio share's, from the browser's recorder) as a plain one. <paramref name="rollsAllowed"/>
    /// is the render job's way in, which may send an action roll (<see cref="ShortKinds.Roll"/>)
    /// and its larger video; until the meta part says what kind it is, a part is held to the
    /// largest limit the way in allows, and to its kind's once that is known.</summary>
    private async Task<ShortUploadResult> ReceiveAsync(string? contentType, Stream body, long? contentLength, bool flatten,
        Func<ShortUploadMeta, Task<ReplayShort>> describe, CancellationToken ct, bool rollsAllowed = false)
    {
        var limits = options.Value;
        var boundary = Boundary(contentType);
        var widest = rollsAllowed ? ShortKinds.Roll : null;
        if (contentLength > BodyLimit(limits, widest))
        {
            throw TooBig(limits.VideoLimit(widest), "A Short's video");
        }

        string? videoFile = null;
        string? hdVideoFile = null;
        string? posterFile = null;
        string? videoUpload = null;
        string? hdVideoUpload = null;
        string? kind = widest;
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
                        if (rollsAllowed) kind = (meta.Kind ?? "").Trim();
                        if (contentLength > BodyLimit(limits, kind)) throw TooBig(limits.VideoLimit(kind), "A Short's video");
                        break;
                    // A chunked upload's id in place of the file (the render job's way in only):
                    // joined below, once the meta says what kind it is.
                    case "videoUpload" when rollsAllowed && videoFile is null && videoUpload is null:
                        videoUpload = await ReadUploadIdAsync(section.Body, ct);
                        break;
                    case "videoHdUpload" when rollsAllowed && hdVideoFile is null && hdVideoUpload is null:
                        hdVideoUpload = await ReadUploadIdAsync(section.Body, ct);
                        break;
                    case "video" when videoFile is null && videoUpload is null:
                        videoFile = storage.IncomingPath();
                        await ReceiveAsync(section.Body, videoFile, limits.VideoLimit(kind), "A Short's video", ct);
                        break;
                    case "videoHd" when hdVideoFile is null && hdVideoUpload is null:
                        hdVideoFile = storage.IncomingPath();
                        await ReceiveAsync(section.Body, hdVideoFile, limits.HdVideoLimit(kind), "A Short's HD video", ct);
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
            if (videoFile is null && videoUpload is null) throw new RecordingRejectedException("The upload has no video part.");
            if (posterFile is null) throw new RecordingRejectedException("The upload has no poster part.");

            var row = await describe(meta);
            if (videoUpload is not null)
            {
                videoFile = storage.IncomingPath();
                await JoinAsync(videoUpload, videoFile, limits.VideoLimit(row.Kind), "A Short's video", ct);
            }
            if (hdVideoUpload is not null)
            {
                hdVideoFile = storage.IncomingPath();
                await JoinAsync(hdVideoUpload, hdVideoFile, limits.HdVideoLimit(row.Kind), "A Short's HD video", ct);
            }
            if (videoFile is null) throw new RecordingRejectedException("The upload has no video part.");
            // A part sent before the meta was held to the widest limit: now to its kind's.
            if (new FileInfo(videoFile).Length > limits.VideoLimit(row.Kind)) throw TooBig(limits.VideoLimit(row.Kind), "A Short's video");
            if (hdVideoFile is not null && new FileInfo(hdVideoFile).Length > limits.HdVideoLimit(row.Kind))
            {
                throw TooBig(limits.HdVideoLimit(row.Kind), "A Short's HD video");
            }
            if (!await IsMp4Async(videoFile, ct)) throw new RecordingRejectedException("The video is not an MP4 file.");
            if (hdVideoFile is not null && !await IsMp4Async(hdVideoFile, ct))
            {
                throw new RecordingRejectedException("The HD video is not an MP4 file.");
            }
            if (!await IsJpegAsync(posterFile, ct)) throw new RecordingRejectedException("The poster is not a JPEG file.");
            if (flatten && flattener is not null)
            {
                await flattener.FlattenAsync(videoFile, ct);
                if (hdVideoFile is not null) await flattener.FlattenAsync(hdVideoFile, ct);
            }
            row.VideoBytes = new FileInfo(videoFile).Length;
            row.HdVideoBytes = hdVideoFile is null ? 0 : new FileInfo(hdVideoFile).Length;
            row.PosterBytes = new FileInfo(posterFile).Length;

            var (saved, created) = await CommitAsync(row, videoFile, hdVideoFile, posterFile);
            // Joined, the parts are spent either way: in place, or the kill's Short already there.
            DiscardParts(videoUpload);
            DiscardParts(hdVideoUpload);
            if (created)
            {
                videoFile = null;
                hdVideoFile = null;
                posterFile = null;
                logger.LogInformation(
                    "Short {Slug} uploaded: {Key} ({Kind}), {Bytes} bytes", saved.Slug, saved.Key, saved.Kind, saved.VideoBytes);
            }
            return new ShortUploadResult(ShortDto.From(saved), created);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw new RecordingRejectedException(
                TooBig(limits.VideoLimit(kind), "A Short's video").Message, StatusCodes.Status413PayloadTooLarge);
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
            Discard(hdVideoFile);
            Discard(posterFile);
        }
    }

    /// <summary>The kill clipped already is the Short there; else this one, weighed against the
    /// room the volume has, moved into place and recorded.</summary>
    private async Task<(ReplayShort Short, bool Created)> CommitAsync(ReplayShort row, string videoFile, string? hdVideoFile,
        string posterFile)
    {
        var ct = CancellationToken.None;
        await Commit.WaitAsync(ct);
        try
        {
            if (await db.ReplayShorts.AsNoTracking().FirstOrDefaultAsync(s => s.Key == row.Key, ct) is { } existing)
            {
                return (existing, false);
            }
            if (storage.RoomFor(await StoredBytesAsync(ct), row.VideoBytes + row.HdVideoBytes + row.PosterBytes) is { } full)
            {
                throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
            }
            row.Slug = await NewSlugAsync(ct);
            storage.Promote(videoFile, storage.VideoPath(row.Slug));
            try
            {
                if (hdVideoFile is not null) storage.Promote(hdVideoFile, storage.HdVideoPath(row.Slug));
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
        // A roll is one take, not a kill: its key is the second it starts and the roll's pid.
        var victimPid = kind == ShortKinds.Roll ? ShortKinds.RollVictimPid : meta.VictimPid;
        var now = clock.GetCurrentInstant();
        var killer = RecordingText.Name(meta.Killer, MaxName);
        var victim = RecordingText.Name(meta.Victim, MaxName);
        return new ReplayShort
        {
            Players = PlayersOf(killer, [victim, .. meta.Victims ?? []]),
            RecordingSlug = recordingSlug,
            KillTime = meta.KillTime,
            VictimPid = victimPid,
            Key = ShortKinds.Key(recordingSlug, meta.KillTime, victimPid),
            Kind = kind,
            Title = title,
            // Names stay as stored (raw); the client decodes them for display.
            Killer = killer,
            Victim = victim,
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

    /// <summary>A Short's players: its killer, and each man killed in it once. At most
    /// <see cref="MaxPlayers"/>; a blank name is no one.</summary>
    internal static List<ReplayShortPlayer> PlayersOf(string killer, IEnumerable<string?> victims)
    {
        var players = new List<ReplayShortPlayer>();
        if (killer.Length > 0) players.Add(new ReplayShortPlayer { Name = killer, Role = ShortPlayerRoles.Killer });
        foreach (var raw in victims)
        {
            var name = RecordingText.Name(raw, MaxName);
            if (name.Length == 0 || players.Any(p => p.Role == ShortPlayerRoles.Victim && p.Name == name)) continue;
            if (players.Count >= MaxPlayers) break;
            players.Add(new ReplayShortPlayer { Name = name, Role = ShortPlayerRoles.Victim });
        }
        return players;
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
    private async Task<long> StoredBytesAsync(CancellationToken ct) =>
        await VolumeUsage.StoredBytesAsync(db, ct) + storage.PendingPartBytes();

    public async Task<ShortPartDto> ReceivePartAsync(string? upload, int index, Stream body, long? contentLength, CancellationToken ct)
    {
        var limits = options.Value;
        if (!ShortStorage.IsUploadId(upload)) throw new RecordingRejectedException("upload must be 16 to 32 of a-z and 0-9.");
        if (index < 0 || index >= limits.MaxParts)
        {
            throw new RecordingRejectedException($"index must be 0 to {limits.MaxParts - 1}.");
        }
        if (contentLength > limits.MaxPartBytes) throw TooBig(limits.MaxPartBytes, "A part");
        // Weighed as it arrives: everything stored, every part waiting, and this one.
        if (storage.RoomFor(await StoredBytesAsync(ct), contentLength ?? limits.MaxPartBytes) is { } full)
        {
            throw new RecordingRejectedException(full, StatusCodes.Status507InsufficientStorage);
        }
        string? partFile = storage.IncomingPath();
        try
        {
            await ReceiveAsync(body, partFile, limits.MaxPartBytes, "A part", ct);
            var bytes = new FileInfo(partFile).Length;
            storage.PlacePart(partFile, upload!, index);
            partFile = null;
            logger.LogInformation("Short upload {Upload} part {Index} received, {Bytes} bytes", upload, index, bytes);
            return new ShortPartDto(upload!, index, bytes);
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw new RecordingRejectedException(TooBig(limits.MaxPartBytes, "A part").Message, StatusCodes.Status413PayloadTooLarge);
        }
        catch (IOException ex) when (ex is not FileNotFoundException)
        {
            logger.LogWarning(ex, "Short upload {Upload} part {Index} broke off", upload, index);
            throw new RecordingRejectedException("The part broke off before it all arrived. Send it again.", ex);
        }
        finally
        {
            Discard(partFile);
        }
    }

    /// <summary>Joins a chunked upload's parts, 0 to n-1 with none missing, into
    /// <paramref name="path"/>, held to <paramref name="maxBytes"/>.</summary>
    private async Task JoinAsync(string upload, string path, long maxBytes, string what, CancellationToken ct)
    {
        var parts = storage.Parts(upload);
        if (parts.Count == 0) throw new RecordingRejectedException($"No parts were sent for upload {upload}.");
        if (parts.Select((p, i) => p.Index != i).Any(gap => gap))
        {
            var missing = Enumerable.Range(0, parts[^1].Index + 1).Except(parts.Select(p => p.Index)).First();
            throw new RecordingRejectedException($"Upload {upload} is missing part {missing}.");
        }
        if (parts.Sum(p => new FileInfo(p.Path).Length) > maxBytes) throw TooBig(maxBytes, what);
        await using var joined = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, CopyBytes, useAsync: true);
        foreach (var (_, partPath) in parts)
        {
            await using var part = new FileStream(partPath, FileMode.Open, FileAccess.Read, FileShare.Read, CopyBytes, useAsync: true);
            await part.CopyToAsync(joined, CopyBytes, ct);
        }
    }

    private void DiscardParts(string? upload)
    {
        if (upload is null) return;
        foreach (var (_, path) in storage.Parts(upload)) Discard(path);
    }

    private static async Task<string> ReadUploadIdAsync(Stream part, CancellationToken ct)
    {
        var buffer = new byte[65];
        var read = await part.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, ct);
        var id = System.Text.Encoding.ASCII.GetString(buffer, 0, read).Trim();
        return ShortStorage.IsUploadId(id)
            ? id
            : throw new RecordingRejectedException("A chunked upload's id must be 16 to 32 of a-z and 0-9.");
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
