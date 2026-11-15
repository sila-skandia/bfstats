using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.DataProtection;

namespace api.Sidecar;

// The bfstats Sidecar's downloads, for Early Adopters (features/early-access-sidecar).
//
// The release lives on the stats volume as one folder: the installers and a
// release.json that names them. Uploading a new release replaces the folder;
// nothing here is built or cached, so the next request reads the new one.
//
// release.json:
//   { "version": "0.3.1", "releasedAt": "2026-11-15",
//     "files": [ { "file": "bfstats-sidecar-0.3.1-x64.exe", "platform": "windows",
//                  "arch": "x64", "size": 123063646, "sha256": "..." } ] }

public sealed class SidecarDownloadsOptions
{
    public const string Section = "SidecarDownloads";

    /// <summary>The release folder (deployment.yaml sets /mnt/data/sidecar).</summary>
    public string Path { get; set; } = "/mnt/data/sidecar";

    /// <summary>How long a download link from the page works.</summary>
    public int LinkMinutes { get; set; } = 30;
}

public sealed record SidecarFile(
    string File,
    string Platform,
    string? Arch,
    long Size,
    string? Sha256);

public sealed record SidecarRelease(
    string Version,
    string? ReleasedAt,
    IReadOnlyList<SidecarFile> Files)
{
    public const string ManifestName = "release.json";

    /// <summary>The platforms the page has install steps for.</summary>
    public static readonly IReadOnlySet<string> Platforms = new HashSet<string> { "windows", "mac", "linux" };

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        NumberHandling = JsonNumberHandling.Strict,
    };

    /// <summary>
    /// The release in <paramref name="folder"/>, keeping only files that are there,
    /// on a known platform, under a plain name (no folders). Null when there is none.
    /// </summary>
    public static SidecarRelease? Read(string folder)
    {
        var manifest = System.IO.Path.Combine(folder, ManifestName);
        if (!System.IO.File.Exists(manifest)) return null;
        SidecarRelease? release;
        try
        {
            release = JsonSerializer.Deserialize<SidecarRelease>(System.IO.File.ReadAllText(manifest), Json);
        }
        catch (JsonException)
        {
            return null;
        }
        if (release is null || string.IsNullOrWhiteSpace(release.Version) || release.Files is null) return null;
        var files = release.Files
            .Where(f => f is not null && IsPlainName(f.File) && Platforms.Contains(f.Platform)
                        && System.IO.File.Exists(System.IO.Path.Combine(folder, f.File)))
            .ToList();
        return release with { Files = files };
    }

    /// <summary>A file name with no folder in it, so a request can never reach outside the release folder.</summary>
    public static bool IsPlainName(string? name) =>
        !string.IsNullOrWhiteSpace(name)
        && name == System.IO.Path.GetFileName(name)
        && name is not "." and not ".."
        && name.IndexOfAny(System.IO.Path.GetInvalidFileNameChars()) < 0
        && !name.Contains('/') && !name.Contains('\\');
}

/// <summary>
/// The signed part of a download link: which file, for whom. A link only works
/// for the file it was made for, until it expires.
/// </summary>
public static class SidecarLink
{
    public const string Purpose = "early-access-sidecar-download";

    public static string Make(ITimeLimitedDataProtector protector, string file, int userId, TimeSpan lifetime) =>
        protector.Protect($"{userId}:{file}", lifetime);

    /// <summary>The user the link was made for, when it is for <paramref name="file"/> and still good; else null.</summary>
    public static int? Check(ITimeLimitedDataProtector protector, string? token, string file)
    {
        if (string.IsNullOrEmpty(token)) return null;
        string payload;
        try
        {
            payload = protector.Unprotect(token, out _);
        }
        catch (CryptographicException)
        {
            return null;
        }
        var colon = payload.IndexOf(':');
        if (colon <= 0 || payload[(colon + 1)..] != file) return null;
        return int.TryParse(payload[..colon], out var userId) ? userId : null;
    }
}
