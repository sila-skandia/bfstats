using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.Shorts;

/// <summary>
/// Rewrites a fragmented MP4 as a plain one, its index first (features/replay-shorts,
/// "Studio shares embed in Discord"). A browser's MediaRecorder writes MP4 in fragments: an
/// empty index saying the clip is 0 s long, then a run of <c>moof</c>/<c>mdat</c> pairs. A
/// player copes; Discord's link preview reads the index and shows nothing (2026-11-08, the
/// owner's Arnhem share). ffmpeg copies the streams into one <c>mdat</c> with a full
/// <c>moov</c> before it: no re-encoding, a second or so.
/// </summary>
public interface IVideoFlattener
{
    /// <summary>Flattens <paramref name="path"/> in place when it is fragmented. True when the
    /// file was rewritten; false when it needed nothing or could not be (it is left as it was).</summary>
    Task<bool> FlattenAsync(string path, CancellationToken ct);
}

public sealed class FfmpegVideoFlattener(IOptions<ShortsOptions> options, ILogger<FfmpegVideoFlattener> logger) : IVideoFlattener
{
    public async Task<bool> FlattenAsync(string path, CancellationToken ct)
    {
        if (!await IsFragmentedAsync(path, ct)) return false;
        var flat = path + ".flat.mp4";
        var started = Stopwatch.StartNew();
        try
        {
            var info = new ProcessStartInfo(options.Value.FfmpegPath)
            {
                RedirectStandardError = true,
                RedirectStandardOutput = true,
                UseShellExecute = false,
            };
            foreach (var arg in new[] { "-v", "error", "-nostdin", "-y", "-i", path, "-map", "0", "-c", "copy", "-movflags", "+faststart", "-f", "mp4", flat })
            {
                info.ArgumentList.Add(arg);
            }
            using var process = Process.Start(info) ?? throw new InvalidOperationException("ffmpeg did not start");
            var errors = process.StandardError.ReadToEndAsync(ct);
            _ = process.StandardOutput.ReadToEndAsync(ct);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(options.Value.FlattenTimeout);
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                throw;
            }
            if (process.ExitCode != 0 || !File.Exists(flat) || new FileInfo(flat).Length == 0)
            {
                logger.LogWarning("ffmpeg could not flatten a Short's video (exit {Code}): {Errors}", process.ExitCode, (await errors).Trim());
                return false;
            }
            var before = new FileInfo(path).Length;
            File.Move(flat, path, overwrite: true);
            logger.LogInformation("A Short's fragmented video flattened in {Ms} ms: {Before} to {After} bytes",
                started.ElapsedMilliseconds, before, new FileInfo(path).Length);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            // No ffmpeg (a developer's machine), or it hung: the video plays as it is.
            logger.LogWarning(ex, "A Short's fragmented video was kept as it came");
            return false;
        }
        finally
        {
            try
            {
                if (File.Exists(flat)) File.Delete(flat);
            }
            catch (IOException)
            {
            }
        }
    }

    /// <summary>Whether the MP4 at <paramref name="path"/> is fragmented: a top-level <c>moof</c>
    /// box. Reads the box headers only.</summary>
    internal static async Task<bool> IsFragmentedAsync(string path, CancellationToken ct)
    {
        await using var file = File.OpenRead(path);
        var header = new byte[16];
        long at = 0;
        for (var boxes = 0; boxes < 64 && at + 8 <= file.Length; boxes++)
        {
            file.Position = at;
            if (await file.ReadAtLeastAsync(header, 16, throwOnEndOfStream: false, ct) < 8) return false;
            long size = (uint)(header[0] << 24 | header[1] << 16 | header[2] << 8 | header[3]);
            var type = System.Text.Encoding.ASCII.GetString(header, 4, 4);
            if (type == "moof") return true;
            if (size == 1)
            {
                size = (long)((ulong)header[8] << 56 | (ulong)header[9] << 48 | (ulong)header[10] << 40 | (ulong)header[11] << 32
                    | (ulong)header[12] << 24 | (ulong)header[13] << 16 | (ulong)header[14] << 8 | header[15]);
            }
            else if (size == 0)
            {
                return false;
            }
            if (size < 8) return false;
            at += size;
        }
        return false;
    }
}
