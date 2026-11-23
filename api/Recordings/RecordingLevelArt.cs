using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.Recordings;

/// <summary>The picture a link preview shows for a recording with no cover.</summary>
public interface IRecordingLevelArt
{
    /// <summary>The level's loading picture on the play site, a whole URL, or null when none
    /// could be found in the time a preview has.</summary>
    Task<string?> UrlAsync(string modId, string level, CancellationToken ct);
}

/// <summary>
/// A level's loading picture, for the preview of a recording nobody set a cover on: what its
/// card in the feed wears (features/replay-feed, "The level's picture, and what stands in for
/// it"). The pictures are the play site's, named by each mod's <c>maps.json</c>
/// (<c>loading.background</c>), which this reads over HTTP and keeps an hour. The chain is the
/// viewer's own (<c>level-art.js</c>): the level's row in the mod's tree, the same level in
/// the vanilla game's trees, then the theatre picture every tree carries. A row can name a
/// file a re-bake took away, so a candidate is asked for (a HEAD) before it is handed out.
/// Whatever goes wrong, the answer is null and the preview is text: never the link's failure.
/// </summary>
public sealed partial class RecordingLevelArt(
    IOptions<RecordingsOptions> options,
    IMemoryCache cache,
    IHttpClientFactory http,
    ILogger<RecordingLevelArt> logger) : IRecordingLevelArt
{
    public const string HttpClientName = "RecordingLevelArt";

    /// <summary>A theatre picture every tree carries (the extractor's own default row).</summary>
    internal const string DefaultArt = "_shared/load/western.webp";

    private static readonly TimeSpan Kept = TimeSpan.FromHours(1);

    /// <summary>A lookup that failed is tried again this soon: the play site restarting.</summary>
    private static readonly TimeSpan KeptWhenMissing = TimeSpan.FromMinutes(2);

    public async Task<string?> UrlAsync(string modId, string level, CancellationToken ct)
    {
        var id = modId.Trim().ToLowerInvariant();
        var name = level.Trim().ToLowerInvariant();
        if (!ModId().IsMatch(id) || name.Length is 0 or > 128) return null;
        var key = $"recording-level-art:{id}:{name}";
        if (cache.TryGetValue(key, out string? known)) return known;
        string? found = null;
        try
        {
            using var client = http.CreateClient(HttpClientName);
            var origin = options.Value.PlayOrigin.TrimEnd('/');
            foreach (var candidate in await CandidatesAsync(client, origin, id, name, ct))
            {
                using var head = new HttpRequestMessage(HttpMethod.Head, candidate);
                using var answer = await client.SendAsync(head, ct);
                if (!answer.IsSuccessStatusCode) continue;
                found = candidate;
                break;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException)
        {
            if (ct.IsCancellationRequested) throw;
            logger.LogWarning(ex, "No level picture for {Mod}/{Level}", id, name);
        }
        cache.Set(key, found, found is null ? KeptWhenMissing : Kept);
        return found;
    }

    /// <summary>Where the picture may be, best first.</summary>
    private async Task<List<string>> CandidatesAsync(HttpClient client, string origin, string mod, string level, CancellationToken ct)
    {
        var trees = Trees(mod);
        List<string> found = [];
        foreach (var tree in trees)
        {
            var rows = await RowsAsync(client, origin, tree, ct);
            if (rows.TryGetValue(level, out var declared)) found.Add($"{origin}{TreePath(tree)}/{declared}");
        }
        found.AddRange(trees.Select(tree => $"{origin}{TreePath(tree)}/{DefaultArt}"));
        return [.. found.Distinct()];
    }

    /// <summary>The mod's own tree, then the vanilla game's: a pack's level tagged
    /// <c>bf1942</c> is in the pack's tree (<see cref="RecordingMods"/>), and a level a mod
    /// inherits shows vanilla's picture, which is the engine's rule.</summary>
    internal static List<string> Trees(string mod) =>
        [.. RecordingMods.SameGame(mod).OrderBy(id => id == mod ? 0 : 1).Append(RecordingMods.Vanilla[0]).Distinct()];

    /// <summary><c>/maps</c> for the vanilla game, <c>/maps/mods/&lt;id&gt;</c> for any other.</summary>
    internal static string TreePath(string mod) => mod == RecordingMods.Vanilla[0] ? "/maps" : $"/maps/mods/{mod}";

    private async Task<IReadOnlyDictionary<string, string>> RowsAsync(HttpClient client, string origin, string tree, CancellationToken ct)
    {
        var key = $"recording-level-art-rows:{tree}";
        if (cache.TryGetValue(key, out IReadOnlyDictionary<string, string>? rows) && rows is not null) return rows;
        using var answer = await client.GetAsync($"{origin}{TreePath(tree)}/maps.json", ct);
        // A mod with no tree is no rows, and stays so for the hour.
        rows = answer.IsSuccessStatusCode
            ? Backgrounds(await answer.Content.ReadAsStringAsync(ct))
            : new Dictionary<string, string>();
        cache.Set(key, rows, Kept);
        return rows;
    }

    /// <summary>Each level's <c>loading.background</c>, by the level's name in lower case. Only
    /// a path inside the tree is kept: a row is the extractor's, but what it names goes into a
    /// page's tags.</summary>
    internal static IReadOnlyDictionary<string, string> Backgrounds(string mapsJson)
    {
        Dictionary<string, string> rows = [];
        using var document = JsonDocument.Parse(mapsJson);
        if (document.RootElement.ValueKind is not JsonValueKind.Array) return rows;
        foreach (var row in document.RootElement.EnumerateArray())
        {
            if (row.ValueKind is not JsonValueKind.Object
                || !row.TryGetProperty("name", out var name) || name.ValueKind is not JsonValueKind.String
                || !row.TryGetProperty("loading", out var loading) || loading.ValueKind is not JsonValueKind.Object
                || !loading.TryGetProperty("background", out var background) || background.ValueKind is not JsonValueKind.String)
            {
                continue;
            }
            var path = background.GetString()!;
            if (ArtPath().IsMatch(path) && !path.Contains("..", StringComparison.Ordinal))
            {
                rows.TryAdd(name.GetString()!.ToLowerInvariant(), path);
            }
        }
        return rows;
    }

    [GeneratedRegex("^[a-z0-9_-]{1,40}$")]
    private static partial Regex ModId();

    [GeneratedRegex(@"^[A-Za-z0-9_][A-Za-z0-9_.\-/]{0,200}\.(?:webp|jpg|jpeg|png)$")]
    private static partial Regex ArtPath();
}
