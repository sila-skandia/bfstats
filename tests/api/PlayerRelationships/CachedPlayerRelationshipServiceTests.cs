using api.PlayerRelationships;
using api.PlayerRelationships.Models;
using api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.PlayerRelationships;

public sealed class CachedPlayerRelationshipServiceTests
{
    [Fact]
    public async Task DetectAndStoreCommunities_TakesNeo4jLockBeforeTouchingCache()
    {
        Func<CancellationToken, Task<string>>? capturedWork = null;
        var concurrency = Substitute.For<IAggregateConcurrencyService>();
        concurrency.ExecuteWithNeo4jRelationshipSyncLockAsync(
                Arg.Any<Func<CancellationToken, Task<string>>>(),
                Arg.Any<CancellationToken>())
            .Returns(callInfo =>
            {
                capturedWork = callInfo.Arg<Func<CancellationToken, Task<string>>>();
                return "held";
            });

        var cache = Substitute.For<IRelationshipCacheService>();
        var inner = new PlayerRelationshipService(
            new Neo4jService(new Neo4jConfiguration(), NullLogger<Neo4jService>.Instance),
            NullLogger<PlayerRelationshipService>.Instance);

        var sut = new CachedPlayerRelationshipService(
            inner,
            cache,
            concurrency,
            NullLogger<CachedPlayerRelationshipService>.Instance);

        var result = await sut.DetectAndStoreCommunities();

        Assert.Equal("held", result);
        Assert.NotNull(capturedWork);
        await cache.DidNotReceive().RemoveAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await cache.DidNotReceive().SetCommunitiesAsync(
            Arg.Any<List<PlayerCommunity>>(),
            Arg.Any<CancellationToken>());
    }
}
