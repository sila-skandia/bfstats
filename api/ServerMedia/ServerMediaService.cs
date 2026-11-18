using api.Dogfights;
using api.PlayerTracking;
using api.ServerMedia.Models;
using api.Shorts.Models;
using api.Utils;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace api.ServerMedia;

/// <summary>
/// A few thumbnails per server for the landing page's server list (features/dogfights-on-stats-pages):
/// its newest Short, its newest replay and its best dogfight first, so a server shows one of each
/// before two of any, then the next newest of any. One answer for the whole list, kept two minutes:
/// the landing page is the site's busiest, and the list changes when someone shares a round.
/// The newest <see cref="Window"/> Shorts and recordings are read, through the id and creation
/// indexes; a server whose last share is older than that shows its dogfights alone.
/// </summary>
public sealed class ServerMediaService(
    PlayerTrackerDbContext db,
    IDogfightService dogfights,
    IMemoryCache cache) : IServerMediaService
{
    public const int DefaultPerServer = 3;
    public const int MaxPerServer = 6;
    internal const int Window = 500;
    private static readonly TimeSpan Keep = TimeSpan.FromMinutes(2);

    public async Task<ServerMediaListDto> ListAsync(int perServer, CancellationToken ct)
    {
        perServer = Math.Clamp(perServer, 1, MaxPerServer);
        var key = $"server-media:{perServer}";
        if (cache.TryGetValue(key, out ServerMediaListDto? hit) && hit is not null) return hit;
        var list = await BuildAsync(perServer, ct);
        cache.Set(key, list, Keep);
        return list;
    }

    private async Task<ServerMediaListDto> BuildAsync(int perServer, CancellationToken ct)
    {
        var recordings = await db.Recordings.AsNoTracking()
            .Where(r => !r.FileMissing && r.ServerName != "")
            .OrderByDescending(r => r.Id)
            .Take(Window)
            .Select(r => new { r.Id, r.RoundId, r.Slug, r.Title, r.ServerName, r.Mod, r.Level, r.DurationSeconds, r.CreatedAt, r.ThumbnailBytes, r.UpdatedAt })
            .ToListAsync(ct);
        var serverOf = recordings.ToDictionary(r => r.Slug, r => Site(r.ServerName), StringComparer.Ordinal);

        // A round several players recorded is one card: its newest recording that has a picture,
        // or its newest.
        var replays = recordings
            .GroupBy(r => r.RoundId ?? r.Id)
            .Select(g => g.OrderByDescending(r => r.ThumbnailBytes > 0).ThenByDescending(r => r.Id).First())
            .OrderByDescending(r => r.Id)
            .Select(r => (Server: Site(r.ServerName), Item: new ServerMediaItemDto(
                "replay", r.Slug, r.Title,
                r.ThumbnailBytes > 0 ? $"/stats/recordings/{r.Slug}.jpg?v={r.UpdatedAt.ToUnixTimeSeconds()}" : null,
                r.Mod, r.Level, r.DurationSeconds, r.CreatedAt)))
            .ToList();

        var shortRows = await db.ReplayShorts.AsNoTracking()
            .Where(s => s.PrunedAt == null)
            .OrderByDescending(s => s.CreatedAtMs).ThenByDescending(s => s.Id)
            .Take(Window)
            .ToListAsync(ct);
        // Shorts of a recording older than the window: its server read by slug.
        var older = shortRows.Select(s => s.RecordingSlug).Where(s => !serverOf.ContainsKey(s)).Distinct().ToList();
        if (older.Count > 0)
        {
            var more = await db.Recordings.AsNoTracking()
                .Where(r => older.Contains(r.Slug) && r.ServerName != "")
                .Select(r => new { r.Slug, r.ServerName })
                .ToListAsync(ct);
            foreach (var r in more) serverOf[r.Slug] = Site(r.ServerName);
        }
        var shorts = shortRows
            .Where(s => serverOf.ContainsKey(s.RecordingSlug))
            .Select(s => (Server: serverOf[s.RecordingSlug], Short: ShortDto.From(s)))
            .Select(x => (x.Server, Item: new ServerMediaItemDto(
                "short", x.Short.Slug, x.Short.Title, x.Short.PosterUrl, x.Short.Mod, x.Short.Level, x.Short.LengthSeconds, x.Short.CreatedAt)))
            .ToList();

        // A fight's server is the feed's name for its recording. Dogfights before bounces, kills
        // before the rest, then the newest.
        var fights = (await dogfights.AllAsync(ct))
            .Where(f => f.ServerName.Length > 0)
            .OrderByDescending(f => f.Kind == "dogfight")
            .ThenByDescending(f => f.Kill is not null)
            .ThenByDescending(f => f.Recorded)
            .Select(f => (Server: Site(f.ServerName), Item: new ServerMediaItemDto(
                "dogfight", f.Id, FightTitle(f), null, f.Mod, f.Level, f.Duration, null)))
            .ToList();

        var servers = shorts.Select(s => s.Server).Concat(replays.Select(r => r.Server)).Concat(fights.Select(f => f.Server))
            .Distinct(StringComparer.Ordinal);
        var byServer = new List<ServerMediaDto>();
        var shortsOf = shorts.ToLookup(s => s.Server, s => s.Item, StringComparer.Ordinal);
        var replaysOf = replays.ToLookup(r => r.Server, r => r.Item, StringComparer.Ordinal);
        var fightsOf = fights.ToLookup(f => f.Server, f => f.Item, StringComparer.Ordinal);
        foreach (var server in servers)
        {
            List<IReadOnlyList<ServerMediaItemDto>> queues = [[.. shortsOf[server]], [.. replaysOf[server]], [.. fightsOf[server]]];
            byServer.Add(new ServerMediaDto(server, queues[0].Count, queues[1].Count, queues[2].Count, Pick(queues, perServer)));
        }
        return new ServerMediaListDto([.. byServer
            .OrderByDescending(s => s.Shorts + s.Replays + s.Dogfights)
            .ThenBy(s => s.ServerName, StringComparer.Ordinal)]);
    }

    /// <summary>One from each queue in turn, then round again, up to <paramref name="count"/>.</summary>
    internal static List<ServerMediaItemDto> Pick(IReadOnlyList<IReadOnlyList<ServerMediaItemDto>> queues, int count)
    {
        var picked = new List<ServerMediaItemDto>(count);
        for (var round = 0; picked.Count < count && queues.Any(q => q.Count > round); round++)
        {
            foreach (var q in queues)
            {
                if (picked.Count < count && q.Count > round) picked.Add(q[round]);
            }
        }
        return picked;
    }

    /// <summary>The site's form of a name a recording wrote.</summary>
    private static string Site(string name) => PlayerNameDecoder.FromRecording(name);

    /// <summary>"Ace (BF109) v Bravo (Spitfire)", the kill's maker first.</summary>
    internal static string FightTitle(Dogfights.Models.DogfightDto f)
    {
        var first = f.Kill?.Side ?? 0;
        var a = f.Sides[first];
        var b = f.Sides[1 - first];
        // The names as the recording wrote them: the page decodes them for display, as it does a Short's title.
        static string Pilot(Dogfights.Models.DogfightSideDto s) => string.IsNullOrEmpty(s.Tmpl) ? s.Name : $"{s.Name} ({s.Tmpl})";
        return $"{Pilot(a)} {(f.Kill is null ? "v" : "downs")} {Pilot(b)}";
    }
}
