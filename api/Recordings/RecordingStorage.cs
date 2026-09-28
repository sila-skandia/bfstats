using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace api.Recordings;

/// <summary>
/// The recordings directory (features/replay-feed): <c>&lt;slug&gt;.ndjson.gz</c> and
/// <c>&lt;slug&gt;.xml.gz</c>, with uploads arriving in <c>.incoming/</c> on the same file
/// system so that sharing one is a rename. In production the directory is a PV on the
/// node's root disk, which the kubelet also needs, so every write asks first whether the
/// disk can spare it.
/// </summary>
public interface IRecordingStorage
{
    string Root { get; }

    /// <summary>The directory is there: false while its volume is not mounted, which
    /// the file check must not read as every recording having gone.</summary>
    bool Available { get; }

    string RecordingPath(string slug);

    string ServerLogPath(string slug);

    string ThumbnailPath(string slug);

    /// <summary>Writes a recording's cover, replacing any it had, by way of a rename.</summary>
    Task WriteThumbnailAsync(string slug, byte[] jpeg, CancellationToken ct);

    /// <summary>A fresh name in <c>.incoming/</c> for an upload to stream into.</summary>
    string IncomingPath();

    /// <summary>Why <paramref name="incomingBytes"/> more cannot be stored, with
    /// <paramref name="storedBytes"/> already shared; null when it can.</summary>
    string? RoomFor(long storedBytes, long incomingBytes);

    /// <summary>Moves an upload into place, over nothing: a slug is never reused.</summary>
    void Promote(string incomingPath, string finalPath);

    bool Exists(string slug);

    /// <summary>Removes a recording's files. Missing ones are not an error.</summary>
    void Delete(string slug);

    /// <summary>Removes what uploads that never finished left in <c>.incoming/</c>.</summary>
    int SweepIncoming(TimeSpan olderThan);
}

public sealed class RecordingStorage : IRecordingStorage
{
    /// <summary>Slugs draw from this: no 0/o, 1/l or i, so one read aloud or retyped survives.</summary>
    private const string SlugAlphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    public const int SlugLength = 10;

    private readonly RecordingsOptions options;
    private readonly ILogger<RecordingStorage> logger;
    private readonly string incoming;

    public RecordingStorage(IOptions<RecordingsOptions> options, ILogger<RecordingStorage>? logger = null)
    {
        this.options = options.Value;
        this.logger = logger ?? NullLogger<RecordingStorage>.Instance;
        Root = string.IsNullOrWhiteSpace(this.options.Path)
            ? Path.Combine(Path.GetTempPath(), "bfstats-recordings")
            : this.options.Path;
        incoming = Path.Combine(Root, ".incoming");
        // Never fatal: the API serves everything else without its recordings.
        EnsureIncoming();
    }

    public string Root { get; }

    public bool Available => Directory.Exists(Root);

    /// <summary>The uploads' directory, made if it is not there; false when it cannot be.</summary>
    private bool EnsureIncoming()
    {
        try
        {
            Directory.CreateDirectory(incoming);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            logger.LogError(ex, "The recordings directory {Root} is not writable; sharing recordings is off", Root);
            return false;
        }
    }

    public static string NewSlug() => RandomNumberGenerator.GetString(SlugAlphabet, SlugLength);

    /// <summary>A slug as a URL carries it, or null for anything else: the one check that
    /// stands between a request and a file name.</summary>
    public static string? CleanSlug(string? slug)
    {
        if (slug is null || slug.Length != SlugLength) return null;
        foreach (var c in slug)
        {
            if (!SlugAlphabet.Contains(c, StringComparison.Ordinal)) return null;
        }
        return slug;
    }

    public string RecordingPath(string slug) => Path.Combine(Root, $"{Checked(slug)}.ndjson.gz");

    public string ServerLogPath(string slug) => Path.Combine(Root, $"{Checked(slug)}.xml.gz");

    public string ThumbnailPath(string slug) => Path.Combine(Root, $"{Checked(slug)}.jpg");

    public async Task WriteThumbnailAsync(string slug, byte[] jpeg, CancellationToken ct)
    {
        var part = IncomingPath();
        try
        {
            await File.WriteAllBytesAsync(part, jpeg, ct);
            File.Move(part, ThumbnailPath(slug), overwrite: true);
        }
        finally
        {
            File.Delete(part);
        }
    }

    public string IncomingPath() => EnsureIncoming()
        ? Path.Combine(incoming, $"{Guid.NewGuid():N}.part")
        : throw new RecordingRejectedException(
            "The server cannot store recordings just now. Try again later.", StatusCodes.Status503ServiceUnavailable);

    public string? RoomFor(long storedBytes, long incomingBytes)
    {
        if (storedBytes + incomingBytes > options.QuotaBytes)
        {
            return $"Shared recordings have filled their {Size(options.QuotaBytes)}. "
                + "An older one has to go before this one fits.";
        }
        long total;
        long free;
        try
        {
            // statvfs on the directory: the file system it is on, which for a hostPath PV is
            // the node's own.
            var drive = new DriveInfo(Root);
            total = drive.TotalSize;
            free = drive.AvailableFreeSpace;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
            return "The server could not see how much room its disk has, so it is not taking recordings just now.";
        }
        var keep = Math.Max(options.MinFreeBytes, (long)(total * options.MinFreeFraction));
        return free - incomingBytes < keep
            ? "The server's disk is too full to take this recording just now."
            : null;
    }

    public void Promote(string incomingPath, string finalPath) =>
        File.Move(incomingPath, finalPath, overwrite: false);

    public bool Exists(string slug) => File.Exists(RecordingPath(slug));

    public void Delete(string slug)
    {
        File.Delete(RecordingPath(slug));
        File.Delete(ServerLogPath(slug));
        File.Delete(ThumbnailPath(slug));
    }

    public int SweepIncoming(TimeSpan olderThan)
    {
        if (!Directory.Exists(incoming)) return 0;
        var removed = 0;
        var before = DateTime.UtcNow - olderThan;
        foreach (var file in Directory.EnumerateFiles(incoming, "*.part"))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(file) >= before) continue;
                File.Delete(file);
                removed++;
            }
            catch (IOException)
            {
                // In use by an upload still running, or gone already.
            }
        }
        return removed;
    }

    private static string Checked(string slug) =>
        CleanSlug(slug) ?? throw new ArgumentException("not a recording slug", nameof(slug));

    /// <summary>A size as the feed says it: <c>20 GB</c>, <c>512 MB</c>.</summary>
    public static string Size(long bytes) => bytes >= 1024L * 1024 * 1024
        ? $"{bytes / (1024.0 * 1024 * 1024):0.#} GB"
        : $"{bytes / (1024.0 * 1024):0.#} MB";
}
