using System.Security.Claims;
using System.Text.Json;
using api.Authorization;
using api.Sidecar;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace api.tests.Sidecar;

/// <summary>
/// The early access page's downloads (features/early-access-sidecar): the release
/// from its folder, signed links per file, and who may have them.
/// </summary>
public sealed class SidecarControllerTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), $"bfstats-sidecar-test-{Guid.NewGuid():N}");
    private readonly IDataProtectionProvider protection = new EphemeralDataProtectionProvider();

    public SidecarControllerTests() => Directory.CreateDirectory(folder);

    public void Dispose()
    {
        try { Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }

    private void WriteRelease(object manifest, params string[] files)
    {
        foreach (var f in files) File.WriteAllBytes(Path.Combine(folder, f), [1, 2, 3, 4]);
        File.WriteAllText(Path.Combine(folder, SidecarRelease.ManifestName), JsonSerializer.Serialize(manifest));
    }

    private void WriteStandardRelease() => WriteRelease(new
    {
        version = "0.3.1",
        releasedAt = "2026-11-15",
        files = new object[]
        {
            new { file = "bfstats-sidecar-0.3.1-x64.exe", platform = "windows", arch = "x64", size = 4, sha256 = "aa" },
            new { file = "bfstats-sidecar-0.3.1-mac-arm64.dmg", platform = "mac", arch = "arm64", size = 4, sha256 = "bb" },
            // Named in the manifest but never uploaded: left out.
            new { file = "bfstats-sidecar-0.3.1-x86_64.AppImage", platform = "linux", arch = "x64", size = 4, sha256 = "cc" },
            // A path, or a platform the page has no steps for: left out.
            new { file = "../secret.txt", platform = "windows", arch = "x64", size = 4, sha256 = "dd" },
            new { file = "notes.txt", platform = "amiga", arch = (string?)null, size = 4, sha256 = (string?)null },
        },
    }, "bfstats-sidecar-0.3.1-x64.exe", "bfstats-sidecar-0.3.1-mac-arm64.dmg", "notes.txt");

    private SidecarController Controller(int? userId = 7, int linkMinutes = 30)
    {
        var claims = userId is { } id ? new[] { new Claim(ClaimTypes.NameIdentifier, id.ToString()) } : [];
        return new SidecarController(
            MsOptions.Create(new SidecarDownloadsOptions { Path = folder, LinkMinutes = linkMinutes }),
            protection,
            NullLogger<SidecarController>.Instance)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) },
            },
        };
    }

    private static string TokenOf(string url) =>
        Uri.UnescapeDataString(url[(url.IndexOf("?t=", StringComparison.Ordinal) + 3)..]);

    [Fact]
    public void Release_lists_the_uploaded_files_with_signed_links()
    {
        WriteStandardRelease();

        var release = Assert.IsType<OkObjectResult>(Controller().Release().Result).Value as SidecarController.ReleaseDto;

        Assert.NotNull(release);
        Assert.Equal("0.3.1", release.Version);
        Assert.Equal(["bfstats-sidecar-0.3.1-x64.exe", "bfstats-sidecar-0.3.1-mac-arm64.dmg"], release.Files.Select(f => f.File));
        Assert.All(release.Files, f => Assert.StartsWith($"/stats/sidecar/files/{f.File}?t=", f.Url));
    }

    [Fact]
    public void Release_is_404_until_one_is_uploaded()
    {
        Assert.IsType<NotFoundResult>(Controller().Release().Result);
        File.WriteAllText(Path.Combine(folder, SidecarRelease.ManifestName), "{ not json");
        Assert.IsType<NotFoundResult>(Controller().Release().Result);
    }

    [Fact]
    public void A_link_downloads_its_own_file_only()
    {
        WriteStandardRelease();
        var files = (Assert.IsType<OkObjectResult>(Controller().Release().Result).Value as SidecarController.ReleaseDto)!.Files;
        var exe = files.Single(f => f.Platform == "windows");
        var dmg = files.Single(f => f.Platform == "mac");

        // Anyone holding the link gets the file: no sign-in on the download itself.
        var file = Assert.IsType<PhysicalFileResult>(Controller(userId: null).Download(exe.File, TokenOf(exe.Url)));
        Assert.Equal(Path.Combine(folder, exe.File), file.FileName);
        Assert.Equal(exe.File, file.FileDownloadName);
        Assert.True(file.EnableRangeProcessing);

        // The exe's link does not open the dmg, and no link opens nothing.
        Assert.Equal(403, Assert.IsType<ObjectResult>(Controller().Download(dmg.File, TokenOf(exe.Url))).StatusCode);
        Assert.Equal(403, Assert.IsType<ObjectResult>(Controller().Download(exe.File, null)).StatusCode);
        Assert.Equal(403, Assert.IsType<ObjectResult>(Controller().Download(exe.File, "forged")).StatusCode);
    }

    [Fact]
    public void Files_outside_the_release_are_not_served()
    {
        WriteStandardRelease();
        File.WriteAllText(Path.Combine(folder, "other.bin"), "x");
        var protector = protection.CreateProtector(SidecarLink.Purpose).ToTimeLimitedDataProtector();
        foreach (var name in new[] { "other.bin", "release.json", "../secret.txt", "notes.txt", "bfstats-sidecar-0.3.1-x86_64.AppImage" })
        {
            var token = SidecarLink.Make(protector, name, 7, TimeSpan.FromMinutes(5));
            Assert.IsType<NotFoundResult>(Controller().Download(name, token));
        }
    }

    [Fact]
    public void An_expired_link_is_refused()
    {
        WriteStandardRelease();
        var protector = protection.CreateProtector(SidecarLink.Purpose).ToTimeLimitedDataProtector();
        var token = SidecarLink.Make(protector, "bfstats-sidecar-0.3.1-x64.exe", 7, TimeSpan.FromMilliseconds(-1));
        Assert.Equal(403, Assert.IsType<ObjectResult>(Controller().Download("bfstats-sidecar-0.3.1-x64.exe", token)).StatusCode);
    }

    [Theory]
    [InlineData(AppRoles.EarlyAdopter, true)]
    [InlineData(AppRoles.Admin, true)]
    [InlineData(AppRoles.Support, false)]
    [InlineData(AppRoles.User, false)]
    public void Early_access_is_for_early_adopters_and_admins(string role, bool allowed)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "test"));
        Assert.Equal(allowed, AppRoles.HasEarlyAccess(user));
    }
}
