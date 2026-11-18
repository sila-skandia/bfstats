using System.Net.Http.Json;
using System.Text.Json;
using api.Dogfights.Models;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NodaTime;

namespace api.Dogfights;

/// <summary>
/// The dogfight school's list of recorded fights, held in memory (features/dogfights-on-stats-pages).
/// About 500 rows and 330 KB today; read again when the file's time changes, looked at no more
/// than every <see cref="DogfightsOptions.RefreshSeconds"/>. The CronJob swaps the list with one
/// rename of a symlink, so a read sees the old list or the new one whole. Missing or unreadable,
/// the list is the last one read, or empty: a page's extra section, never its failure.
/// </summary>
public sealed class DogfightIndex(
    IOptions<DogfightsOptions> options,
    IClock clock,
    ILogger<DogfightIndex> logger,
    IHttpClientFactory? http = null) : IDisposable
{
    public const string HttpClientName = "DogfightIndex";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly SemaphoreSlim gate = new(1, 1);
    private IReadOnlyList<DogfightIndexRow> rows = [];
    private DateTime? fileTime;
    private Instant? checkedAt;

    /// <summary>Every fight in the list, newest recording first, as the extractor sorts it.</summary>
    public async Task<IReadOnlyList<DogfightIndexRow>> RowsAsync(CancellationToken ct)
    {
        var now = clock.GetCurrentInstant();
        var every = Duration.FromSeconds(Math.Max(1, options.Value.RefreshSeconds));
        if (checkedAt is { } at && now - at < every) return rows;
        await gate.WaitAsync(ct);
        try
        {
            if (checkedAt is { } again && now - again < every) return rows;
            await RefreshAsync(ct);
            checkedAt = now;
            return rows;
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task RefreshAsync(CancellationToken ct)
    {
        var path = options.Value.ResolvedIndexPath();
        try
        {
            if (path is not null && File.Exists(path))
            {
                // The symlink's target's time: a new build is a new file.
                var info = new FileInfo(path);
                var time = (info.ResolveLinkTarget(returnFinalTarget: true) as FileInfo ?? info).LastWriteTimeUtc;
                if (time == fileTime) return;
                await using var stream = File.OpenRead(path);
                rows = Parse(await JsonSerializer.DeserializeAsync<List<DogfightIndexRow>>(stream, Json, ct));
                fileTime = time;
                return;
            }
            var url = options.Value.IndexUrl;
            if (string.IsNullOrWhiteSpace(url) || http is null) return;
            using var client = http.CreateClient(HttpClientName);
            rows = Parse(await client.GetFromJsonAsync<List<DogfightIndexRow>>(url, Json, ct));
        }
        catch (Exception ex) when (ex is IOException or JsonException or HttpRequestException or UnauthorizedAccessException or TaskCanceledException)
        {
            if (ct.IsCancellationRequested) throw;
            logger.LogWarning(ex, "Dogfight index could not be read from {Path} or {Url}", path, options.Value.IndexUrl);
        }
    }

    public void Dispose() => gate.Dispose();

    /// <summary>Rows with what a card needs: an id, a recording, two pilots.</summary>
    internal static IReadOnlyList<DogfightIndexRow> Parse(List<DogfightIndexRow>? read) =>
        read is null ? [] : [.. read.Where(r => !string.IsNullOrEmpty(r.Id) && !string.IsNullOrEmpty(r.Slug) && r.Sides is { Count: 2 })];
}
