using System.Diagnostics;
using System.Security.Claims;
using api.Recordings;
using api.Recordings.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NSubstitute;

namespace api.tests.Recordings;

/// <summary>The Seq events that say who watches and uses the replay system
/// (features/replay-usage-metrics): their shape, that a visitor is one id across actions, that
/// no address or browser string is written, and that a crawler is not counted.</summary>
public sealed class ReplayUsageTests
{
    private const string Slug = "abcdefghjk";

    private sealed record Entry(string Message, IReadOnlyDictionary<string, object?> Properties);

    private sealed class Capture : ILoggerProvider, ILogger
    {
        public List<Entry> Entries { get; } = [];
        public ILogger CreateLogger(string categoryName) => this;
        public void Dispose() { }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var properties = (state as IEnumerable<KeyValuePair<string, object?>>)?.ToDictionary(p => p.Key, p => p.Value)
                ?? [];
            Entries.Add(new Entry(formatter(state, exception), properties));
        }
    }

    private static (HttpContext Http, Capture Log) Visitor(
        string? address = "203.0.113.9", string userAgent = "Mozilla/5.0 Test", int? userId = null, string? origin = "https://play.bfstats.io")
    {
        var log = new Capture();
        var services = new ServiceCollection()
            .AddSingleton<ILoggerFactory>(new LoggerFactory([log]))
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["RefreshToken:Secret"] = "test-secret",
            }).Build())
            .BuildServiceProvider();
        var http = new DefaultHttpContext { RequestServices = services };
        if (address is not null) http.Request.Headers["CF-Connecting-IP"] = address;
        http.Request.Headers.UserAgent = userAgent;
        if (origin is not null) http.Request.Headers.Origin = origin;
        if (userId is { } id)
        {
            http.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, id.ToString())], "test"));
        }
        return (http, log);
    }

    [Fact]
    public void AView_IsOneEventWithTheFieldsADashboardGroupsBy()
    {
        var (http, log) = Visitor();

        ReplayUsage.Record(http, ReplayUsage.View, Slug);

        var entry = Assert.Single(log.Entries);
        Assert.Equal("view", entry.Properties["ReplayAction"]);
        Assert.Equal(Slug, entry.Properties["ReplaySlug"]);
        Assert.Equal(false, entry.Properties["ReplaySignedIn"]);
        Assert.Equal("play.bfstats.io", entry.Properties["ReplaySurface"]);
        Assert.StartsWith("a:", (string)entry.Properties["ReplayViewerId"]!);
        Assert.StartsWith("ReplayUsage view", entry.Message);
    }

    [Fact]
    public void ASignedInViewer_IsTheirAccountId_OnEveryAction()
    {
        var (http, log) = Visitor(userId: 42);

        ReplayUsage.Record(http, ReplayUsage.View, Slug);
        ReplayUsage.Record(http, ReplayUsage.Comment, Slug);

        Assert.All(log.Entries, e =>
        {
            Assert.Equal("u:42", e.Properties["ReplayViewerId"]);
            Assert.Equal(true, e.Properties["ReplaySignedIn"]);
        });
    }

    [Fact]
    public void AnAnonymousViewer_IsTheSameIdAcrossActions_AndNotAnotherVisitors()
    {
        var (first, firstLog) = Visitor();
        var (again, againLog) = Visitor();
        var (other, otherLog) = Visitor(address: "198.51.100.7");

        ReplayUsage.Record(first, ReplayUsage.Feed);
        ReplayUsage.Record(first, ReplayUsage.View, Slug);
        ReplayUsage.Record(again, ReplayUsage.View, Slug);
        ReplayUsage.Record(other, ReplayUsage.View, Slug);

        var id = (string)firstLog.Entries[0].Properties["ReplayViewerId"]!;
        Assert.Equal(id, firstLog.Entries[1].Properties["ReplayViewerId"]);
        Assert.Equal(id, againLog.Entries[0].Properties["ReplayViewerId"]);
        Assert.NotEqual(id, otherLog.Entries[0].Properties["ReplayViewerId"]);
    }

    [Fact]
    public void TheViewerId_IsNotTheStoredViewKey_AndHoldsNeitherAddressNorBrowser()
    {
        var (http, log) = Visitor(address: "203.0.113.9", userAgent: "Mozilla/5.0 Test");

        ReplayUsage.Record(http, ReplayUsage.View, Slug);

        var entry = log.Entries.Single();
        var everything = entry.Message + string.Join('|', entry.Properties.Values.Select(v => v?.ToString()));
        Assert.DoesNotContain("203.0.113.9", everything);
        Assert.DoesNotContain("Mozilla", everything);
        // The id RecordingViews keeps for the same visitor must not be joinable to Seq's.
        Assert.NotEqual(StoredViewKey(http), entry.Properties["ReplayViewerId"]);
    }

    [Fact]
    public void ACrawler_IsNotCounted()
    {
        var (http, log) = Visitor();
        using var activity = new Activity("request").Start();
        activity.SetTag("is_bot", "true");

        ReplayUsage.Record(http, ReplayUsage.View, Slug);

        Assert.Empty(log.Entries);
    }

    [Theory]
    [InlineData("https://play.bfstats.io", null, "play.bfstats.io")]
    [InlineData(null, "https://replay.bfstats.io/abcdefghjk?t=30", "replay.bfstats.io")]
    [InlineData("http://localhost:5173", null, "localhost")]
    [InlineData(null, null, null)]
    [InlineData("not a url", null, null)]
    public void TheSurface_IsTheHostOfTheOrigin_ElseTheReferer_NeverAPath(string? origin, string? referer, string? expected)
    {
        var (http, log) = Visitor(origin: origin);
        if (referer is not null) http.Request.Headers.Referer = referer;

        ReplayUsage.Record(http, ReplayUsage.Feed);

        Assert.Equal(expected, log.Entries.Single().Properties["ReplaySurface"]);
    }

    [Fact]
    public void WithNoRequest_OrNoLogging_NothingThrows()
    {
        ReplayUsage.Record(null, ReplayUsage.View, Slug);
        ReplayUsage.Record(new DefaultHttpContext(), ReplayUsage.View, Slug);
    }

    [Fact]
    public async Task OpeningARecording_LogsTheView_WhateverTheCounterDoes()
    {
        var (http, log) = Visitor();
        var recordings = Substitute.For<IRecordingService>();
        recordings.WatchableIdAsync(Slug, Arg.Any<CancellationToken>()).Returns(7);
        var counter = Substitute.For<IRecordingViewCounter>();
        counter.Enqueue(Arg.Any<int>(), Arg.Any<string>()).Returns(false);
        var controller = Controller(recordings, counter, http);

        var result = await controller.View(Slug, CancellationToken.None);

        Assert.IsType<AcceptedResult>(result);
        Assert.Equal("view", log.Entries.Single().Properties["ReplayAction"]);
    }

    [Fact]
    public async Task ViewingARecordingThatIsNotThere_LogsNothing()
    {
        var (http, log) = Visitor();
        var recordings = Substitute.For<IRecordingService>();
        recordings.WatchableIdAsync(Slug, Arg.Any<CancellationToken>()).Returns((int?)null);

        var result = await Controller(recordings, Substitute.For<IRecordingViewCounter>(), http).View(Slug, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result);
        Assert.Empty(log.Entries);
    }

    [Theory]
    [InlineData(1, null, "default")]
    [InlineData(1, "views", "views")]
    [InlineData(1, "Newest", "newest")]
    [InlineData(2, "views", null)]
    public async Task TheFeed_IsLoggedOnItsFirstPage_WithTheSortAndNotTheNamesFiltered(int page, string? sort, string? detail)
    {
        var (http, log) = Visitor();
        var recordings = Substitute.For<IRecordingService>();
        recordings.ListAsync(Arg.Any<string?>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<RecordingFilter>(), Arg.Any<RecordingActor?>(), Arg.Any<CancellationToken>())
            .Returns(new PagedRecordingsDto([], 0, page, 20, 0, null!));

        await Controller(recordings, Substitute.For<IRecordingViewCounter>(), http).List(sort, null, null, null, null, page);

        if (detail is null) Assert.Empty(log.Entries);
        else Assert.Equal(detail, log.Entries.Single().Properties["ReplayDetail"]);
    }

    [Fact]
    public async Task AFilteredFeed_SaysWhichFiltersWereOn_NotTheValues()
    {
        var (http, log) = Visitor();
        var recordings = Substitute.For<IRecordingService>();
        recordings.ListAsync(Arg.Any<string?>(), Arg.Any<int>(), Arg.Any<int>(), Arg.Any<RecordingFilter>(), Arg.Any<RecordingActor?>(), Arg.Any<CancellationToken>())
            .Returns(new PagedRecordingsDto([], 0, 1, 20, 0, null!));

        await Controller(recordings, Substitute.For<IRecordingViewCounter>(), http).List("views", "My Server", null, "SecretPlayer", null);

        var detail = (string)log.Entries.Single().Properties["ReplayDetail"]!;
        Assert.Equal("views+server+player", detail);
        Assert.DoesNotContain("SecretPlayer", detail);
    }

    private static RecordingsController Controller(IRecordingService recordings, IRecordingViewCounter counter, HttpContext http) =>
        new(recordings, Substitute.For<IRecordingUploadService>(), new RecordingStorage(Options.Create(new RecordingsOptions { Path = Path.GetTempPath() })),
            counter, Substitute.For<IConfiguration>(), Substitute.For<IRecordingRoundService>(), Options.Create(new RecordingsOptions()))
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };

    /// <summary>The key <see cref="RecordingsController"/> files the same visitor's view under.</summary>
    private static string StoredViewKey(HttpContext http)
    {
        var key = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("recording-views|test-secret"));
        var visitor = System.Text.Encoding.UTF8.GetBytes($"{ClientAddress.Of(http)}|{http.Request.Headers.UserAgent}");
        return $"a:{Convert.ToHexStringLower(System.Security.Cryptography.HMACSHA256.HashData(key, visitor))[..32]}";
    }
}
