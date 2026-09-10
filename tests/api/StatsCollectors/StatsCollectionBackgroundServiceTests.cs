using api.Bflist;
using api.DiscordNotifications;
using api.PlayerTracking;
using api.Servers;
using api.StatsCollectors;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests.StatsCollectors;

public sealed class StatsCollectionBackgroundServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;

    public StatsCollectionBackgroundServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();
    }

    [Fact]
    public async Task StopAsync_WaitsForInFlightCycle()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var proceed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var bfList = Substitute.For<IBfListApiService>();
        bfList.FetchAllServersAsync(Arg.Any<string>()).Returns(async _ =>
        {
            entered.TrySetResult();
            await proceed.Task;
            return Array.Empty<object>();
        });

        var logger = new CollectingLogger();
        using var service = CreateService(bfList, logger);

        await service.StartAsync(CancellationToken.None);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var stopTask = service.StopAsync(CancellationToken.None);
        await Task.Delay(50);
        Assert.False(stopTask.IsCompleted);

        proceed.TrySetResult();
        await stopTask.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Empty(logger.Errors);
    }

    [Fact]
    public async Task StopAsync_DisposedMemoryCache_DoesNotLogError()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var proceed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var bfList = Substitute.For<IBfListApiService>();
        bfList.FetchAllServersAsync(Arg.Any<string>()).Returns(_ => DelayThenDispose());
        async Task<object[]> DelayThenDispose()
        {
            entered.TrySetResult();
            await proceed.Task;
            throw new ObjectDisposedException("Microsoft.Extensions.Caching.Memory.MemoryCache");
        }

        var logger = new CollectingLogger();
        using var service = CreateService(bfList, logger);

        await service.StartAsync(CancellationToken.None);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var stopTask = service.StopAsync(CancellationToken.None);
        await Task.Delay(50);
        proceed.TrySetResult();
        await stopTask.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Empty(logger.Errors);
        Assert.Contains(logger.Informations, m => m.Contains("stopped during host shutdown", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Cycle_UnexpectedException_StillLogsError()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var bfList = Substitute.For<IBfListApiService>();
        bfList.FetchAllServersAsync(Arg.Any<string>()).Returns(_ =>
        {
            entered.TrySetResult();
            return Task.FromException<object[]>(new InvalidOperationException("bflist exploded"));
        });

        var logger = new CollectingLogger();
        using var service = CreateService(bfList, logger);

        await service.StartAsync(CancellationToken.None);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => logger.Errors.Count > 0);

        Assert.Contains(logger.Errors, m => m.Contains("Error in stats collection cycle", StringComparison.Ordinal));
        await service.StopAsync(CancellationToken.None);
    }

    [Fact]
    public async Task Cycle_ObjectDisposedExceptionWithoutShutdown_StillLogsError()
    {
        // A disposed dependency unrelated to host shutdown (e.g. a genuine bug) must not
        // be swallowed as "stopped during host shutdown" just because the exception type
        // matches - only StopAsync's cancellation should qualify for that treatment.
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var bfList = Substitute.For<IBfListApiService>();
        bfList.FetchAllServersAsync(Arg.Any<string>()).Returns(_ =>
        {
            entered.TrySetResult();
            return Task.FromException<object[]>(new ObjectDisposedException("SomeUnrelatedDependency"));
        });

        var logger = new CollectingLogger();
        using var service = CreateService(bfList, logger);

        await service.StartAsync(CancellationToken.None);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await WaitUntil(() => logger.Errors.Count > 0);

        Assert.Contains(logger.Errors, m => m.Contains("Error in stats collection cycle", StringComparison.Ordinal));
        Assert.DoesNotContain(logger.Informations, m => m.Contains("stopped during host shutdown", StringComparison.Ordinal));
        await service.StopAsync(CancellationToken.None);
    }

    private StatsCollectionBackgroundService CreateService(
        IBfListApiService bfList,
        ILogger<StatsCollectionBackgroundService> logger)
    {
        var tracking = new PlayerTrackingService(
            dbContext,
            new BotDetectionService(new ConfigurationBuilder().AddInMemoryCollection().Build()),
            Substitute.For<IDiscordWebhookService>(),
            eventPublisher: null,
            logger: NullLogger<PlayerTrackingService>.Instance);

        var services = new ServiceCollection();
        services.AddSingleton(dbContext);
        services.AddSingleton(tracking);
        services.AddSingleton(bfList);
        var provider = services.BuildServiceProvider();

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["STATS_COLLECTION_INTERVAL_SECONDS"] = "3600"
            })
            .Build();

        return new StatsCollectionBackgroundService(
            provider.GetRequiredService<IServiceScopeFactory>(),
            configuration,
            logger);
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(20);
        }

        throw new TimeoutException("Timed out waiting for collection cycle.");
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }

    private sealed class CollectingLogger : ILogger<StatsCollectionBackgroundService>
    {
        public List<string> Errors { get; } = [];
        public List<string> Informations { get; } = [];

        public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            var message = formatter(state, exception);
            if (logLevel == LogLevel.Error)
            {
                Errors.Add(message);
            }
            else if (logLevel == LogLevel.Information)
            {
                Informations.Add(message);
            }
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}
