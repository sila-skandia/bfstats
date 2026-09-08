using api.PlayerTracking;
using api.StatsCollectors;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace api.tests.StatsCollectors;

public sealed class RankingCalculationServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;

    public RankingCalculationServiceTests()
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
    public async Task ExecuteAsync_HostShutdownDuringCycle_DoesNotLogError()
    {
        await SeedServer("srv-1");
        await SeedServer("srv-2");

        var recalc = Substitute.For<IServerPlayerRankingsRecalculationService>();
        recalc.RecalculateForServerAndPeriodAsync(
                Arg.Any<string>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(1);

        var logger = new CollectingLogger();
        var service = new RankingCalculationService(BuildProvider(recalc), logger)
        {
            StartupDelay = TimeSpan.Zero,
            CycleInterval = TimeSpan.FromHours(1)
        };

        await service.StartAsync(CancellationToken.None);
        await WaitUntil(() => logger.HasInformationContaining("Ranking calculation:"));
        await recalc.Received().RecalculateForServerAndPeriodAsync(
            Arg.Any<string>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>());
        await service.StopAsync(CancellationToken.None);

        Assert.Empty(logger.Errors);
        Assert.Contains(logger.Informations, m => m.Contains("RankingCalculationService stopped"));
    }

    [Fact]
    public async Task ExecuteAsync_CancelledRecalc_DoesNotLogPerServerError()
    {
        await SeedServer("srv-cancel");

        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var recalc = Substitute.For<IServerPlayerRankingsRecalculationService>();
        recalc.RecalculateForServerAndPeriodAsync(
                Arg.Any<string>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(async call =>
            {
                var ct = call.Arg<CancellationToken>();
                started.TrySetResult();
                var cancelled = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
                await using var reg = ct.Register(() => cancelled.TrySetCanceled(ct));
                return await cancelled.Task;
            });

        var logger = new CollectingLogger();
        var service = new RankingCalculationService(BuildProvider(recalc), logger)
        {
            StartupDelay = TimeSpan.Zero,
            CycleInterval = TimeSpan.FromHours(1)
        };

        await service.StartAsync(CancellationToken.None);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await service.StopAsync(CancellationToken.None);

        Assert.Empty(logger.Errors);
        Assert.Contains(logger.Informations, m => m.Contains("RankingCalculationService stopped"));
    }

    private IServiceProvider BuildProvider(IServerPlayerRankingsRecalculationService recalc)
    {
        var services = new ServiceCollection();
        services.AddSingleton(dbContext);
        services.AddSingleton(recalc);
        return services.BuildServiceProvider();
    }

    private async Task SeedServer(string guid)
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = guid,
            Ip = "1.2.3.4",
            Port = 14567,
            Game = "bf1942",
            GameId = "bf1942",
            GeoLookupDate = DateTime.UtcNow,
            CurrentNumPlayers = 0
        });
        await dbContext.SaveChangesAsync();
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < deadline)
        {
            if (condition()) return;
            await Task.Delay(20);
        }

        throw new TimeoutException("Timed out waiting for ranking cycle to finish.");
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }

    private sealed class CollectingLogger : ILogger<RankingCalculationService>
    {
        public List<string> Errors { get; } = [];
        public List<string> Informations { get; } = [];

        public bool HasInformationContaining(string text) =>
            Informations.Any(m => m.Contains(text, StringComparison.Ordinal));

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
