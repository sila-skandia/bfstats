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
