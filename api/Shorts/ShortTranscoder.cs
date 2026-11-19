using System.ComponentModel;
using System.Diagnostics;
using System.Threading.Channels;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.Shorts;

/// <summary>Converts a Short's video to one every phone plays.</summary>
public interface IShortTranscoder
{
    /// <summary>Queues the Short's video for conversion. False when the queue is full or the
    /// converter is off; the nightly shorts-colour.mjs then puts it right.</summary>
    bool Enqueue(string slug);
}

/// <summary>
/// Re-encodes a studio share that is not H.264 with AAC sound (a browser asked for a bare
/// <c>video/mp4</c> writes VP9 and Opus in Firefox and in Chromium builds without an H.264
/// encoder, and no iPhone plays that; 2026-11-19, <c>2ywyeks3uj</c>). The share is live at
/// once as it came, and plays where it was made; this swaps in an H.264/AAC copy a few
/// seconds later, under a new <c>?v=</c> so every cache takes the new file. One at a time, at
/// low priority on two threads: measured on the API's base image, a worst case (60 s of
/// 1080x1920 VP9) takes 18 s on two cores and needs 200-250 MB. ffmpeg runs inside the API's
/// own cgroup (3 Gi, deploy/app/deployment.yaml), where the OOM killer would pick dotnet, not
/// it: so it starts only with <see cref="HeadroomBytes"/> free of anonymous memory (page cache
/// is reclaimed for it), waits up to <see cref="HeadroomWait"/> for that, and otherwise leaves
/// the share to the nightly. On start it looks over the live studio shares for any a restart
/// left unconverted.
/// </summary>
public sealed class ShortTranscoder(
    IServiceScopeFactory scopes,
    ShortStorage storage,
    IOptions<ShortsOptions> options,
    ILogger<ShortTranscoder> logger) : BackgroundService, IShortTranscoder
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan EncodeTimeout = TimeSpan.FromMinutes(5);
    /// <summary>Free memory an encode needs before it starts: 2.5 times the worst case measured.</summary>
    internal const long HeadroomBytes = 640L * 1024 * 1024;
    private static readonly TimeSpan HeadroomWait = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan HeadroomPoll = TimeSpan.FromMinutes(1);

    private readonly Channel<string> queue = Channel.CreateBounded<string>(new BoundedChannelOptions(100)
    {
        FullMode = BoundedChannelFullMode.DropWrite,
        SingleReader = true,
    });

    private volatile bool unavailable;

    public bool Enqueue(string slug) => !unavailable && queue.Writer.TryWrite(slug);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (string.IsNullOrWhiteSpace(options.Value.FfmpegPath))
        {
            unavailable = true;
            return;
        }
        _ = Task.Run(() => SweepAsync(stoppingToken), stoppingToken);
        try
        {
            await foreach (var slug in queue.Reader.ReadAllAsync(stoppingToken))
            {
                if (unavailable) continue;
                try
                {
                    await ConvertAsync(slug, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Short {Slug}: the conversion to H.264 failed; the nightly re-encode will retry", slug);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    /// <summary>The live studio shares a restart may have left unconverted.</summary>
    private async Task SweepAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(StartupDelay, ct);
            List<string> slugs;
            using (var scope = scopes.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
                slugs = await db.ReplayShorts.AsNoTracking()
                    .Where(s => s.Kind == ShortKinds.Creator && s.PrunedAt == null)
                    .Select(s => s.Slug)
                    .ToListAsync(ct);
            }
            foreach (var slug in slugs)
            {
                var path = storage.VideoPath(slug);
                if (File.Exists(path) && Mp4Codecs.Unplayable(await Mp4Codecs.ReadAsync(path, ct)) is not null) Enqueue(slug);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "The sweep for studio shares iPhones cannot play failed");
        }
    }

    /// <summary>Converts one Short's video in place. Internal for the tests.</summary>
    internal async Task<bool> ConvertAsync(string slug, CancellationToken ct)
    {
        var path = storage.VideoPath(slug);
        if (!File.Exists(path)) return false;
        var before = await Mp4Codecs.ReadAsync(path, ct);
        if (Mp4Codecs.Unplayable(before) is null) return false;

        if (!await WaitForHeadroomAsync(slug, ct)) return false;
        var output = storage.IncomingPath() + ".h264.mp4";
        var started = Stopwatch.StartNew();
        try
        {
            if (!await EncodeAsync(path, output, before.Any(c => c is "Opus" or "opus" or "mp4a" or "ac-3" or "ec-3"), ct)) return false;
            var after = await Mp4Codecs.ReadAsync(output, ct);
            if (after.Count == 0 || Mp4Codecs.Unplayable(after) is { } still)
            {
                logger.LogWarning("Short {Slug}: the converted video is still not playable everywhere ({Codecs})", slug, string.Join(",", after));
                return false;
            }

            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
            var row = await db.ReplayShorts.FirstOrDefaultAsync(s => s.Slug == slug && s.PrunedAt == null, ct);
            if (row is null) return false;
            var bytes = new FileInfo(output).Length;
            storage.Replace(output, path);
            row.VideoBytes = bytes;
            await db.SaveChangesAsync(ct);
            logger.LogInformation("Short {Slug} converted from {From} to H.264/AAC in {Ms} ms, {Bytes} bytes",
                slug, string.Join("/", before), started.ElapsedMilliseconds, bytes);
            return true;
        }
        finally
        {
            try { File.Delete(output); } catch (IOException) { }
        }
    }

    private async Task<bool> WaitForHeadroomAsync(string slug, CancellationToken ct)
    {
        var waited = Stopwatch.StartNew();
        while (true)
        {
            var free = FreeBytes();
            if (free is null || free >= HeadroomBytes) return true;
            if (waited.Elapsed >= HeadroomWait)
            {
                logger.LogWarning("Short {Slug}: only {Free} MiB free in the API's memory limit for {Minutes} min; left for the nightly re-encode",
                    slug, free / (1024 * 1024), (int)HeadroomWait.TotalMinutes);
                return false;
            }
            await Task.Delay(HeadroomPoll, ct);
        }
    }

    /// <summary>The container's memory limit less its anonymous memory (cgroup v2), or null when
    /// there is no limit to read (a developer's machine, the tests).</summary>
    internal static long? FreeBytes(string root = "/sys/fs/cgroup")
    {
        try
        {
            var max = File.ReadAllText(Path.Combine(root, "memory.max")).Trim();
            if (max == "max" || !long.TryParse(max, out var limit)) return null;
            foreach (var line in File.ReadLines(Path.Combine(root, "memory.stat")))
            {
                if (line.StartsWith("anon ", StringComparison.Ordinal) && long.TryParse(line[5..], out var anon)) return limit - anon;
            }
            return null;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private async Task<bool> EncodeAsync(string input, string output, bool hasSound, CancellationToken ct)
    {
        // TV range, BT.709, even sides (scripts/video-range.mjs): what every Short is written in.
        string[] args =
        [
            "-nostdin", "-y", "-loglevel", "error", "-threads", "2", "-i", input,
            "-map", "0:v:0", .. hasSound ? (string[])["-map", "0:a:0"] : [],
            // Threads pinned for the encoder and the filters too: by default x264 sizes its
            // threads, and a frame buffer each, from the host's cores, and was OOM-killed at
            // 400 MB on a many-core machine.
            "-filter_threads", "1",
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2:out_range=tv:out_color_matrix=bt709,format=yuv420p,"
                + "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709",
            "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "20", "-maxrate", "10M", "-bufsize", "20M",
            "-profile:v", "high",
            .. hasSound ? (string[])["-c:a", "aac", "-b:a", "160k"] : ["-an"],
            "-movflags", "+faststart", output,
        ];
        var info = new ProcessStartInfo(options.Value.FfmpegPath!) { RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) info.ArgumentList.Add(a);
        Process process;
        try
        {
            process = Process.Start(info) ?? throw new Win32Exception("no process");
        }
        catch (Win32Exception ex)
        {
            unavailable = true;
            logger.LogWarning(ex, "No ffmpeg at {Path}: studio shares are left for the nightly re-encode", options.Value.FfmpegPath);
            return false;
        }
        using (process)
        {
            try { process.PriorityClass = ProcessPriorityClass.BelowNormal; } catch (Exception) { }
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(EncodeTimeout);
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(entireProcessTree: true); } catch (Exception) { }
                if (ct.IsCancellationRequested) throw;
                logger.LogWarning("ffmpeg ran past {Timeout} converting {Input}; stopped", EncodeTimeout, input);
                return false;
            }
            if (process.ExitCode != 0)
            {
                logger.LogWarning("ffmpeg failed ({Code}) converting {Input}: {Errors}", process.ExitCode, input,
                    (await errors).Trim() is { Length: > 0 } e ? e[..Math.Min(e.Length, 500)] : "no message");
                return false;
            }
            return File.Exists(output);
        }
    }
}
