using System.Collections.Concurrent;
using System.Text.Json;
using api.Bflist.Models;
using api.Caching;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using api.Telemetry;

namespace api.Bflist;

public interface IBfListApiService
{
    Task<object[]> FetchServersAsync(string game, int perPage = 100, string? cursor = null, string? after = null);
    Task<object[]> FetchAllServersAsync(string game);
    Task<object?> FetchSingleServerAsync(string game, string serverIdentifier);

    /// <summary>
    /// Peeks the warm live-server snapshot (hot, then last-known-good) for a
    /// name match. Does not call BFList. Used by the banner so a stale <c>Servers.Ip</c>
    /// from a duplicate-name row does not 404 against an address BFList no longer lists.
    /// </summary>
    Task<Models.ServerSummary?> TryGetCachedServerByNameAsync(string game, string serverName);

    /// <summary>
    /// Read-path variant of <see cref="FetchAllServersAsync"/>: same hot cache, but if the
    /// hot cache is empty, prefers the last successful snapshot
    /// (raw_servers:{game}:last_good) over waiting on a live BFList round-trip. Only
    /// fetches upstream when no snapshot exists at all. Never used by the stats
    /// collector — session tracking must never be fed a stale/fallback snapshot.
    /// </summary>
    Task<Models.RawServerSnapshot> FetchAllServersWithMetaAsync(string game);

    /// <summary>
    /// Maps a raw BFList server to the UI-facing summary shape (dedup, field projection).
    /// Exposed so callers with their own enrichment (geo, bot detection) can reuse it
    /// instead of duplicating the mapping.
    /// </summary>
    Models.ServerSummary MapToSummary(Models.Bf1942ServerInfo server);

    // Helper methods for UI that need ServerSummary
    Task<Models.ServerSummary[]> FetchServerSummariesAsync(string game, int perPage = 100, string? cursor = null, string? after = null);
    Task<Models.ServerSummary[]> FetchAllServerSummariesWithCacheStatusAsync(string game);
    Task<Models.ServerSummary[]> FetchAllServerSummariesAsync(string game);
    Task<Models.ServerSummary?> FetchSingleServerSummaryAsync(string game, string serverIdentifier);
}

public class BfListApiService(
    IHttpClientFactory httpClientFactory,
    ICacheService cacheService,
    IMemoryCache memoryCache,
    ILogger<BfListApiService> logger,
    IConfiguration configuration) : IBfListApiService
{
    private static readonly JsonSerializerOptions CaseInsensitiveJson = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly Models.ServerFilteringConfig _serverFilteringConfig = configuration.GetSection("ServerFiltering").Get<Models.ServerFilteringConfig>() ?? new Models.ServerFilteringConfig();

    private const int ServerListCacheSeconds = 30;
    private const int SingleServerCacheSeconds = 8; // 8 seconds for individual server updates

    // Read-path safety net: kept far longer than the hot cache so a sustained BFList outage
    // degrades to "last known status, clearly stale" instead of an empty landing page.
    private static readonly TimeSpan LastGoodCacheDuration = TimeSpan.FromHours(24);

    // Same 90s grace as LiveServersController.StaleDataThreshold. Last-good younger than
    // this is the previous hot snapshot (hot TTL is 30s); older than this is a real outage.
    private static readonly TimeSpan LastGoodFreshThreshold = TimeSpan.FromSeconds(90);

    private static string RawServersCacheKey(string game) => $"raw_servers:{game}";
    private static string RawServersLastGoodCacheKey(string game) => $"raw_servers:{game}:last_good";

    // BfListApiService is request-scoped (Program.cs registers it AddScoped), so anything
    // that needs to survive across requests — the per-game upstream-fetch lock — has to live
    // in static state rather than an instance field.
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> FetchLocks = new();

    private static SemaphoreSlim GetFetchLock(string game) => FetchLocks.GetOrAdd(game, static _ => new SemaphoreSlim(1, 1));

    public async Task<object[]> FetchServersAsync(string game, int perPage = 100, string? cursor = null, string? after = null)
    {
        using var activity = ActivitySources.BfListApi.StartActivity("FetchServers");
        activity?.SetTag("bflist.game", game);
        activity?.SetTag("bflist.per_page", perPage);
        activity?.SetTag("bflist.has_cursor", !string.IsNullOrEmpty(cursor));
        activity?.SetTag("bflist.has_after", !string.IsNullOrEmpty(after));

        var httpClient = httpClientFactory.CreateClient("BfListApi");
        var baseUrl = $"https://api.bflist.io/v2/{game}/servers?perPage={perPage}";

        if (!string.IsNullOrEmpty(cursor))
        {
            baseUrl += $"&cursor={Uri.EscapeDataString(cursor)}";
        }
        if (!string.IsNullOrEmpty(after))
        {
            baseUrl += $"&after={Uri.EscapeDataString(after)}";
        }

        activity?.SetTag("bflist.url", baseUrl);

        logger.LogDebug("Fetching servers from BFList API: {Url}", baseUrl);

        var response = await httpClient.GetAsync(baseUrl);
        response.EnsureSuccessStatusCode();
        var content = await response.Content.ReadAsStringAsync();

        var bf1942Response = JsonSerializer.Deserialize<Bf1942ServersResponse>(content, CaseInsensitiveJson);

        return bf1942Response?.Servers?.Cast<object>().ToArray() ?? [];
    }

    public async Task<object[]> FetchAllServersAsync(string game)
    {
        var cached = await GetSnapshotAsync(RawServersCacheKey(game), TimeSpan.FromSeconds(ServerListCacheSeconds));
        if (cached != null)
        {
            return cached.Servers.Cast<object>().ToArray();
        }

        var snapshot = await FetchAndCacheServersAsync(game);
        return snapshot.Servers.Cast<object>().ToArray();
    }

    public async Task<RawServerSnapshot> FetchAllServersWithMetaAsync(string game)
    {
        var cached = await GetSnapshotAsync(RawServersCacheKey(game), TimeSpan.FromSeconds(ServerListCacheSeconds));
        if (cached != null)
        {
            return cached;
        }

        // Serve last-known-good before touching BFList. Polly's 8s attempt / 30s total
        // timeouts plus the per-game fetch lock turn an upstream stall into a 30s
        // homepage, and TimeoutRejectedException pages Seq Exceptions even after we
        // fall back to 200. The collector refreshes last-good via FetchAllServersAsync.
        var lastGood = await GetSnapshotAsync(RawServersLastGoodCacheKey(game), LastGoodCacheDuration);
        if (lastGood != null)
        {
            return AsReadPathSnapshot(lastGood);
        }

        try
        {
            return await FetchAndCacheServersAsync(game);
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                "Live fetch failed for game {Game} ({ExceptionType}: {Message}); no last-known-good snapshot to fall back to",
                game, ex.GetType().Name, ex.Message);
            throw;
        }
    }

    /// <summary>
    /// Last-good younger than <see cref="LastGoodFreshThreshold"/> is the previous hot
    /// snapshot and can be returned as-is. Older than that is a real outage: copy with
    /// <see cref="RawServerSnapshot.IsFallback"/> so the landing page disables edge cache.
    /// Never mutate the cache-owned instance — IMemoryCache returns the same reference.
    /// </summary>
    private static RawServerSnapshot AsReadPathSnapshot(RawServerSnapshot lastGood)
    {
        if (DateTime.UtcNow - lastGood.FetchedAtUtc <= LastGoodFreshThreshold)
        {
            return lastGood;
        }

        return new RawServerSnapshot
        {
            FetchedAtUtc = lastGood.FetchedAtUtc,
            Servers = lastGood.Servers,
            IsFallback = true
        };
    }

    /// <summary>
    /// Checks the in-process L1 cache first, then the Redis-backed L2 (backfilling L1 on a
    /// Redis hit). Used for both the hot key and the last-good key — same lookup shape,
    /// different TTL. This is what keeps the landing page working out of this pod's own
    /// memory if Redis itself is unreachable, not just if BFList is.
    /// </summary>
    private async Task<RawServerSnapshot?> GetSnapshotAsync(string cacheKey, TimeSpan memoryTtl)
    {
        if (memoryCache.TryGetValue<RawServerSnapshot>(cacheKey, out var memoryHit) && memoryHit != null)
        {
            logger.LogDebug("Memory cache hit for {CacheKey}", cacheKey);
            return memoryHit;
        }

        var redisHit = await cacheService.GetAsync<RawServerSnapshot>(cacheKey);
        if (redisHit != null)
        {
            logger.LogDebug("Redis cache hit for {CacheKey}", cacheKey);
            memoryCache.Set(cacheKey, redisHit, memoryTtl);
        }

        return redisHit;
    }

    /// <summary>
    /// Fetches fresh servers from the upstream API and populates the hot and last-known-good
    /// caches, in both memory and Redis. Guarded by a per-game lock so concurrent cache
    /// misses (e.g. several landing-page requests arriving while Redis is down) share one
    /// upstream call instead of each hitting BFList independently — the thing we're most
    /// trying to avoid here. Only called on a cache miss, so a live upstream failure here
    /// propagates — callers decide whether to fall back or (for the collector) let the cycle
    /// fail and retry next tick.
    /// </summary>
    private async Task<RawServerSnapshot> FetchAndCacheServersAsync(string game)
    {
        var fetchLock = GetFetchLock(game);
        await fetchLock.WaitAsync();
        try
        {
            // Someone else may have already refreshed the snapshot while we waited.
            var cached = await GetSnapshotAsync(RawServersCacheKey(game), TimeSpan.FromSeconds(ServerListCacheSeconds));
            if (cached != null)
            {
                return cached;
            }

            var freshServers = await FetchAllServersFromApiAsync(game);
            var typedServers = freshServers.Cast<Bf1942ServerInfo>()
                .Where(server => !IsStuckServer(server.Name))
                .ToArray();

            var snapshot = new RawServerSnapshot
            {
                FetchedAtUtc = DateTime.UtcNow,
                Servers = typedServers
            };

            memoryCache.Set(RawServersCacheKey(game), snapshot, TimeSpan.FromSeconds(ServerListCacheSeconds));
            memoryCache.Set(RawServersLastGoodCacheKey(game), snapshot, LastGoodCacheDuration);
            await cacheService.SetAsync(RawServersCacheKey(game), snapshot, TimeSpan.FromSeconds(ServerListCacheSeconds));
            await cacheService.SetAsync(RawServersLastGoodCacheKey(game), snapshot, LastGoodCacheDuration);

            return snapshot;
        }
        finally
        {
            fetchLock.Release();
        }
    }

    private async Task<object[]> FetchAllServersFromApiAsync(string game)
    {
        var allServers = new List<object>();
        string? cursor = null;
        string? after = null;
        var pageCount = 0;
        const int maxPages = 50; // Increased from 10 to ensure we get all servers
        bool hasMore = true;

        while (hasMore && pageCount < maxPages)
        {
            pageCount++;

            var httpClient = httpClientFactory.CreateClient("BfListApi");
            var baseUrl = $"https://api.bflist.io/v2/{game}/servers?perPage=100";

            if (!string.IsNullOrEmpty(cursor))
            {
                baseUrl += $"&cursor={Uri.EscapeDataString(cursor)}";
            }
            if (!string.IsNullOrEmpty(after))
            {
                baseUrl += $"&after={Uri.EscapeDataString(after)}";
            }

            logger.LogDebug("Fetching servers page {PageCount} from BFList API: {Url}", pageCount, baseUrl);

            var response = await httpClient.GetAsync(baseUrl);
            response.EnsureSuccessStatusCode();
            var content = await response.Content.ReadAsStringAsync();

            var bf1942Response = JsonSerializer.Deserialize<Bf1942ServersResponse>(content, CaseInsensitiveJson);

            if (bf1942Response?.Servers != null && bf1942Response.Servers.Length > 0)
            {
                allServers.AddRange(bf1942Response.Servers.Cast<object>());

                // Set pagination parameters for next request
                cursor = bf1942Response.Cursor;
                after = $"{bf1942Response.Servers.Last().Ip}:{bf1942Response.Servers.Last().Port}";
                hasMore = bf1942Response.HasMore;
            }
            else
            {
                hasMore = false;
            }
        }

        if (pageCount >= maxPages && hasMore)
        {
            logger.LogWarning("Reached maximum pages ({MaxPages}) while fetching all servers for game {Game}, there may be more servers", maxPages, game);
        }

        logger.LogDebug("Fetched {TotalServers} servers across {PageCount} pages for game {Game}", allServers.Count, pageCount, game);

        return allServers.ToArray();
    }

    public async Task<object?> FetchSingleServerAsync(string game, string serverIdentifier)
    {
        var httpClient = httpClientFactory.CreateClient("BfListApi");
        var baseUrl = $"https://api.bflist.io/v2/{game}/servers/{serverIdentifier}";

        logger.LogDebug("Fetching single server from BFList API: {Url}", baseUrl);

        try
        {
            var response = await httpClient.GetAsync(baseUrl);
            // Offline / IP-changed servers are a normal 404 from BFList, not a transport
            // failure. EnsureSuccessStatusCode would throw and the HttpClient span would
            // still be ERROR; treat NotFound as "not listed" so callers can fall back.
            if (response.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                logger.LogDebug("BFList has no listing for {ServerIdentifier}", serverIdentifier);
                return null;
            }

            response.EnsureSuccessStatusCode();
            var content = await response.Content.ReadAsStringAsync();

            return JsonSerializer.Deserialize<Bf1942ServerInfo>(content, CaseInsensitiveJson);
        }
        catch (Exception ex)
        {
            // Polly timeout / circuit-open are not HttpRequestException. Callers treat
            // null as not-listed; throwing would 500 GetServer after the hang.
            logger.LogWarning(
                "Failed to fetch single server {ServerIdentifier} ({ExceptionType}: {Message})",
                serverIdentifier, ex.GetType().Name, ex.Message);
            return null;
        }
    }

    public async Task<Models.ServerSummary?> TryGetCachedServerByNameAsync(string game, string serverName)
    {
        if (string.IsNullOrWhiteSpace(game) || string.IsNullOrWhiteSpace(serverName))
        {
            return null;
        }

        var snapshot = await TryPeekSnapshotAsync(game);
        var match = snapshot?.Servers.FirstOrDefault(s =>
            string.Equals(s.Name, serverName, StringComparison.Ordinal));
        return match == null ? null : MapToSummary(match);
    }

    /// <summary>
    /// Hot snapshot, then last-known-good. Never calls BFList. Same peek the landing
    /// page uses so a Recreate (empty process cache) still serves Redis last-good.
    /// </summary>
    private async Task<RawServerSnapshot?> TryPeekSnapshotAsync(string game)
    {
        return await GetSnapshotAsync(RawServersCacheKey(game), TimeSpan.FromSeconds(ServerListCacheSeconds))
            ?? await GetSnapshotAsync(RawServersLastGoodCacheKey(game), LastGoodCacheDuration);
    }

    private static bool MatchesServerIdentifier(Bf1942ServerInfo server, string serverIdentifier) =>
        string.Equals($"{server.Ip}:{server.Port}", serverIdentifier, StringComparison.OrdinalIgnoreCase);

    // Helper methods for UI that need ServerSummary
    public async Task<Models.ServerSummary[]> FetchServerSummariesAsync(string game, int perPage = 100, string? cursor = null, string? after = null)
    {
        var servers = await FetchServersAsync(game, perPage, cursor, after);
        return ConvertToServerSummaries(servers);
    }

    public async Task<Models.ServerSummary[]> FetchAllServerSummariesWithCacheStatusAsync(string game)
    {
        var servers = await FetchAllServersAsync(game);
        return ConvertToServerSummaries(servers);
    }

    public async Task<Models.ServerSummary[]> FetchAllServerSummariesAsync(string game)
    {
        return await FetchAllServerSummariesWithCacheStatusAsync(game);
    }

    public async Task<Models.ServerSummary?> FetchSingleServerSummaryAsync(string game, string serverIdentifier)
    {
        var cacheKey = $"server:{game}:{serverIdentifier}";
        var cachedResult = await cacheService.GetAsync<CachedSingleServer>(cacheKey);

        if (cachedResult != null)
        {
            logger.LogDebug("Cache hit for server {Game}:{ServerIdentifier} (found={Found})",
                game, serverIdentifier, cachedResult.Found);
            return cachedResult.Found ? cachedResult.Server : null;
        }

        logger.LogDebug("Cache miss for server {Game}:{ServerIdentifier}", game, serverIdentifier);

        // Same last-good-first rule as the landing-page list: if the collector (or a
        // previous live fetch) already has a snapshot, do not wait on BFList. GetServer
        // and banner tickets otherwise eat Polly's 8s attempt timeout twice, then 500.
        var snapshot = await TryPeekSnapshotAsync(game);
        if (snapshot != null)
        {
            var listed = snapshot.Servers.FirstOrDefault(s => MatchesServerIdentifier(s, serverIdentifier));
            if (listed != null)
            {
                var fromSnapshot = MapToSummary(listed);
                await cacheService.SetAsync(
                    cacheKey,
                    new CachedSingleServer { Found = true, Server = fromSnapshot },
                    TimeSpan.FromSeconds(SingleServerCacheSeconds));
                return fromSnapshot;
            }

            logger.LogDebug(
                "Server {ServerIdentifier} is not in the cached live snapshot; skipping BFList",
                serverIdentifier);
            await cacheService.SetAsync(
                cacheKey,
                new CachedSingleServer { Found = false },
                TimeSpan.FromSeconds(SingleServerCacheSeconds));
            return null;
        }

        var server = await FetchSingleServerAsync(game, serverIdentifier);

        if (server is Bf1942ServerInfo bf1942Server)
        {
            var summary = MapToSummary(bf1942Server);
            await cacheService.SetAsync(
                cacheKey,
                new CachedSingleServer { Found = true, Server = summary },
                TimeSpan.FromSeconds(SingleServerCacheSeconds));
            return summary;
        }

        // Remember a miss so a Discord/forum embed refreshing the banner does not
        // re-hit BFList (and re-page Seq) every few seconds for a dead IP.
        await cacheService.SetAsync(
            cacheKey,
            new CachedSingleServer { Found = false },
            TimeSpan.FromSeconds(SingleServerCacheSeconds));
        return null;
    }

    /// <summary>
    /// Single-server cache entry. <see cref="Found"/> is false when BFList returned 404
    /// so the miss can be reused for the same TTL as a hit.
    /// </summary>
    public sealed class CachedSingleServer
    {
        public bool Found { get; set; }
        public Models.ServerSummary? Server { get; set; }
    }

    private Models.ServerSummary[] ConvertToServerSummaries(object[] servers)
    {
        return servers.Cast<Bf1942ServerInfo>()
            .Select(MapToSummary)
            .OrderByDescending(s => s.NumPlayers)
            .ToArray();
    }

    private bool IsStuckServer(string serverName)
    {
        if (_serverFilteringConfig.StuckServers.Contains(serverName))
        {
            logger.LogDebug("Filtering out stuck server: {ServerName}", serverName);
            return true;
        }
        return false;
    }

    private PlayerInfo[] FilterDuplicatePlayers(PlayerInfo[] players, string serverName)
    {
        if (players == null || players.Length == 0)
            return players ?? [];

        var groupedPlayers = players.GroupBy(p => p.Name).ToArray();
        var duplicateGroups = groupedPlayers.Where(g => g.Count() > 1).ToArray();

        if (duplicateGroups.Any())
        {
            logger.LogWarning("Found {DuplicateCount} duplicate player groups in server {ServerName}: {DuplicateNames}",
                duplicateGroups.Length,
                serverName,
                string.Join(", ", duplicateGroups.Select(g => $"{g.Key} (x{g.Count()})")));
        }

        // For each group, keep only the player with the highest score
        var filteredPlayers = groupedPlayers
            .Select(group => group.OrderByDescending(p => p.Score).First())
            .ToArray();

        return filteredPlayers;
    }

    public Models.ServerSummary MapToSummary(Bf1942ServerInfo server)
    {
        var filteredPlayers = FilterDuplicatePlayers(server.Players ?? [], server.Name);

        return new Models.ServerSummary
        {
            Guid = server.Guid,
            Name = server.Name,
            Ip = server.Ip,
            Port = server.Port,
            QueryPort = server.QueryPort,
            Password = server.Password,
            GameVersion = server.GameVersion,
            GameMode = server.GameMode,
            AverageFps = server.AverageFps,
            ContentCheck = server.ContentCheck,
            Dedicated = server.Dedicated,
            MapId = server.MapId,
            ReservedSlots = server.ReservedSlots,
            RoundTime = server.RoundTime,
            Status = server.Status,
            Anticheat = server.Anticheat,
            UnpureMods = server.UnpureMods,
            NumPlayers = filteredPlayers.Length > 0 ? filteredPlayers.Length : server.NumPlayers,
            MaxPlayers = server.MaxPlayers,
            MapName = server.MapName,
            GameType = server.GameType,
            JoinLink = server.JoinLink,
            JoinLinkWeb = server.JoinLinkWeb,
            RoundTimeRemain = server.RoundTimeRemain,
            Tickets1 = server.Tickets1,
            Tickets2 = server.Tickets2,
            Players = filteredPlayers,
            Teams = server.Teams ?? [],
            GameId = server.GameId
        };
    }

}
