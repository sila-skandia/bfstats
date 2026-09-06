using System.Net;
using api.Bflist;
using api.Bflist.Models;
using api.Caching;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.Bflist;

/// <summary>
/// Covers the read-path resilience layering added for the landing page's live-server
/// snapshot: L1 memory cache in front of L2 Redis (ICacheService), a last-known-good
/// fallback when BFList itself is unreachable, and the guarantee that the stats collector's
/// own path (FetchAllServersAsync) never silently serves stale/fallback data into session
/// tracking.
/// </summary>
public sealed class BfListApiServiceTests
{
    private const string Game = "bf1942";
    private const string HotKey = $"raw_servers:{Game}";
    private const string LastGoodKey = $"raw_servers:{Game}:last_good";

    private static Bf1942ServersResponse SinglePageResponse() => new()
    {
        Servers = [new Bf1942ServerInfo { Guid = "srv-1", Name = "Test Server", NumPlayers = 1 }],
        HasMore = false
    };

    private static BfListApiService BuildService(
        ICacheService cacheService,
        IMemoryCache? memoryCache = null,
        FakeHttpMessageHandler? handler = null)
    {
        handler ??= FakeHttpMessageHandler.ReturningJson(SinglePageResponse());
        var httpClient = new HttpClient(handler);
        var factory = Substitute.For<IHttpClientFactory>();
        factory.CreateClient("BfListApi").Returns(httpClient);

        var configuration = new ConfigurationBuilder().AddInMemoryCollection().Build();

        return new BfListApiService(
            factory,
            cacheService,
            memoryCache ?? new MemoryCache(new MemoryCacheOptions()),
            NullLogger<BfListApiService>.Instance,
            configuration);
    }

    [Fact]
    public async Task WithMeta_MemoryCacheHit_SkipsRedisAndUpstream()
    {
        var memoryCache = new MemoryCache(new MemoryCacheOptions());
        var cached = new RawServerSnapshot { FetchedAtUtc = DateTime.UtcNow, Servers = [] };
        memoryCache.Set(HotKey, cached, TimeSpan.FromSeconds(30));

        var cacheService = Substitute.For<ICacheService>();
        var handler = FakeHttpMessageHandler.Throwing();
        var service = BuildService(cacheService, memoryCache, handler);

        var result = await service.FetchAllServersWithMetaAsync(Game);

        Assert.Same(cached, result);
        Assert.Equal(0, handler.CallCount);
        await cacheService.DidNotReceive().GetAsync<RawServerSnapshot>(Arg.Any<string>());
    }

    [Fact]
    public async Task WithMeta_CacheMiss_LiveFetchSucceeds_PopulatesHotAndLastGood()
    {
        var cacheService = Substitute.For<ICacheService>();
        cacheService.GetAsync<RawServerSnapshot>(Arg.Any<string>()).Returns((RawServerSnapshot?)null);
        var memoryCache = new MemoryCache(new MemoryCacheOptions());
        var service = BuildService(cacheService, memoryCache);

        var result = await service.FetchAllServersWithMetaAsync(Game);

        Assert.False(result.IsFallback);
        Assert.Single(result.Servers);
        await cacheService.Received(1).SetAsync(HotKey, Arg.Any<RawServerSnapshot>(), TimeSpan.FromSeconds(30));
        await cacheService.Received(1).SetAsync(LastGoodKey, Arg.Any<RawServerSnapshot>(), TimeSpan.FromHours(24));
        Assert.True(memoryCache.TryGetValue<RawServerSnapshot>(HotKey, out _));
        Assert.True(memoryCache.TryGetValue<RawServerSnapshot>(LastGoodKey, out _));
    }

    [Fact]
    public async Task WithMeta_CacheMiss_LiveFetchFails_FallsBackToRedisLastGood()
    {
        var lastGood = new RawServerSnapshot
        {
            FetchedAtUtc = DateTime.UtcNow.AddHours(-2),
            Servers = [new Bf1942ServerInfo { Guid = "srv-old", Name = "Old Server" }]
        };

        var cacheService = Substitute.For<ICacheService>();
        cacheService.GetAsync<RawServerSnapshot>(HotKey).Returns((RawServerSnapshot?)null);
        cacheService.GetAsync<RawServerSnapshot>(LastGoodKey).Returns(lastGood);

        var handler = FakeHttpMessageHandler.ReturningStatus(HttpStatusCode.ServiceUnavailable);
        var service = BuildService(cacheService, new MemoryCache(new MemoryCacheOptions()), handler);

        var result = await service.FetchAllServersWithMetaAsync(Game);

        Assert.True(result.IsFallback);
        Assert.Equal(lastGood.FetchedAtUtc, result.FetchedAtUtc);
        Assert.Same(lastGood.Servers, result.Servers);

        // The returned snapshot must be a copy — mutating IsFallback must never leak back
        // into the object the cache still holds, or every future recovery would be corrupted.
        Assert.False(lastGood.IsFallback);
    }

    [Fact]
    public async Task WithMeta_CacheMiss_LiveFetchFails_NoLastGoodAnywhere_Throws()
    {
        var cacheService = Substitute.For<ICacheService>();
        cacheService.GetAsync<RawServerSnapshot>(Arg.Any<string>()).Returns((RawServerSnapshot?)null);

        var handler = FakeHttpMessageHandler.ReturningStatus(HttpStatusCode.ServiceUnavailable);
        var service = BuildService(cacheService, new MemoryCache(new MemoryCacheOptions()), handler);

        await Assert.ThrowsAsync<HttpRequestException>(() => service.FetchAllServersWithMetaAsync(Game));
    }

    [Fact]
    public async Task FetchAllServersAsync_CollectorPath_DoesNotFallBackToLastGood()
    {
        // The stats collector must never be fed a stale/fallback snapshot — it would
        // refresh PlayerSessions.LastSeenTime for players who may no longer be online.
        var lastGood = new RawServerSnapshot
        {
            FetchedAtUtc = DateTime.UtcNow.AddHours(-2),
            Servers = [new Bf1942ServerInfo { Guid = "srv-old", Name = "Old Server" }]
        };

        var cacheService = Substitute.For<ICacheService>();
        cacheService.GetAsync<RawServerSnapshot>(HotKey).Returns((RawServerSnapshot?)null);
        cacheService.GetAsync<RawServerSnapshot>(LastGoodKey).Returns(lastGood);

        var handler = FakeHttpMessageHandler.ReturningStatus(HttpStatusCode.ServiceUnavailable);
        var service = BuildService(cacheService, new MemoryCache(new MemoryCacheOptions()), handler);

        await Assert.ThrowsAsync<HttpRequestException>(() => service.FetchAllServersAsync(Game));
        await cacheService.DidNotReceive().GetAsync<RawServerSnapshot>(LastGoodKey);
    }

    [Fact]
    public async Task TryGetCachedServerByName_MemoryHit_DoesNotCallUpstream()
    {
        var memoryCache = new MemoryCache(new MemoryCacheOptions());
        memoryCache.Set(HotKey, new RawServerSnapshot
        {
            FetchedAtUtc = DateTime.UtcNow,
            Servers =
            [
                new Bf1942ServerInfo
                {
                    Name = "CHASABA Main BF1942 Server",
                    Ip = "153.207.118.175",
                    Port = 14567,
                    Tickets1 = 650,
                    Tickets2 = 436
                }
            ]
        }, TimeSpan.FromSeconds(30));

        var handler = FakeHttpMessageHandler.Throwing();
        var service = BuildService(Substitute.For<ICacheService>(), memoryCache, handler);

        var found = await service.TryGetCachedServerByNameAsync(Game, "CHASABA Main BF1942 Server");
        var missing = await service.TryGetCachedServerByNameAsync(Game, "No Such Server");

        Assert.NotNull(found);
        Assert.Equal("153.207.118.175", found.Ip);
        Assert.Equal(650, found.Tickets1);
        Assert.Null(missing);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task FetchSingleServerSummary_NotFound_IsCachedAndDoesNotThrow()
    {
        var cacheService = Substitute.For<ICacheService>();
        cacheService.GetAsync<BfListApiService.CachedSingleServer>(Arg.Any<string>())
            .Returns((BfListApiService.CachedSingleServer?)null);

        var handler = FakeHttpMessageHandler.ReturningStatus(HttpStatusCode.NotFound);
        var service = BuildService(cacheService, new MemoryCache(new MemoryCacheOptions()), handler);

        var first = await service.FetchSingleServerSummaryAsync(Game, "153.223.78.15:14567");
        Assert.Null(first);
        Assert.Equal(1, handler.CallCount);

        await cacheService.Received().SetAsync(
            "server:bf1942:153.223.78.15:14567",
            Arg.Is<BfListApiService.CachedSingleServer>(c => !c.Found && c.Server == null),
            TimeSpan.FromSeconds(8));
    }

    [Fact]
    public async Task FetchSingleServerSummary_CachedMiss_SkipsUpstream()
    {
        var cacheService = Substitute.For<ICacheService>();
        cacheService.GetAsync<BfListApiService.CachedSingleServer>("server:bf1942:153.223.78.15:14567")
            .Returns(new BfListApiService.CachedSingleServer { Found = false });

        var handler = FakeHttpMessageHandler.Throwing();
        var service = BuildService(cacheService, new MemoryCache(new MemoryCacheOptions()), handler);

        var result = await service.FetchSingleServerSummaryAsync(Game, "153.223.78.15:14567");

        Assert.Null(result);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public void MapToSummary_CopiesAllBfListHostFields()
    {
        var service = BuildService(Substitute.For<ICacheService>());
        var mapped = service.MapToSummary(new Bf1942ServerInfo
        {
            Guid = "g-1",
            Name = "Host",
            Ip = "1.2.3.4",
            Port = 14567,
            QueryPort = 23000,
            Password = true,
            GameVersion = "1.61",
            GameMode = "gpm_cq",
            AverageFps = 33,
            ContentCheck = true,
            Dedicated = 1,
            MapId = "wake",
            ReservedSlots = 2,
            RoundTime = 1200,
            Status = 4,
            Anticheat = true,
            UnpureMods = "foo",
            JoinLink = "bf1942://1.2.3.4:14567",
            JoinLinkWeb = "https://example.test/join",
            NumPlayers = 4,
            MaxPlayers = 64,
            MapName = "Wake Island",
            GameType = "Conquest",
            RoundTimeRemain = 400,
            Tickets1 = 312,
            Tickets2 = 198,
            GameId = "bf1942",
        });

        Assert.Equal("g-1", mapped.Guid);
        Assert.Equal(23000, mapped.QueryPort);
        Assert.True(mapped.Password);
        Assert.Equal("1.61", mapped.GameVersion);
        Assert.Equal("gpm_cq", mapped.GameMode);
        Assert.Equal(33, mapped.AverageFps);
        Assert.True(mapped.ContentCheck);
        Assert.Equal(1, mapped.Dedicated);
        Assert.Equal("wake", mapped.MapId);
        Assert.Equal(2, mapped.ReservedSlots);
        Assert.Equal(1200, mapped.RoundTime);
        Assert.Equal(4, mapped.Status);
        Assert.True(mapped.Anticheat);
        Assert.Equal("foo", mapped.UnpureMods);
        Assert.Equal("https://example.test/join", mapped.JoinLinkWeb);
        Assert.Equal("bf1942://1.2.3.4:14567", mapped.JoinLink);
    }
}

/// <summary>Minimal configurable HttpMessageHandler for exercising BfListApiService without a real network call.</summary>
public sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> responder;
    public int CallCount { get; private set; }

    private FakeHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
    {
        this.responder = responder;
    }

    public static FakeHttpMessageHandler ReturningJson(Bf1942ServersResponse body) =>
        new(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = System.Net.Http.Json.JsonContent.Create(body)
        });

    public static FakeHttpMessageHandler ReturningStatus(HttpStatusCode statusCode) =>
        new(_ => new HttpResponseMessage(statusCode));

    public static FakeHttpMessageHandler Throwing() =>
        new(_ => throw new InvalidOperationException("Upstream should not have been called"));

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        CallCount++;
        return Task.FromResult(responder(request));
    }
}
