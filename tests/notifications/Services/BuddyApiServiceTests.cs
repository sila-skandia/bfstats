using System.Net;
using System.Net.Sockets;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using NSubstitute;
using notifications.Services;

namespace notifications.tests.Services;

public class BuddyApiServiceTests
{
    [Fact]
    public async Task GetUsersWithFavouriteServer_ReturnsEmpty_OnConnectionRefused()
    {
        var logger = Substitute.For<ILogger<BuddyApiService>>();
        var configuration = Substitute.For<IConfiguration>();
        configuration["ApiBaseUrl"].Returns("http://bf42-stats-service.bf42-stats:8080");
        var httpClient = new HttpClient(new ThrowHandler())
        {
            Timeout = TimeSpan.FromSeconds(5)
        };
        var service = new BuddyApiService(httpClient, logger, configuration);

        var result = await service.GetUsersWithFavouriteServer("1d1680b-3c0e83-a1e6bf3-1ffb030");

        Assert.Empty(result);
        logger.DidNotReceive().Log(
            LogLevel.Error,
            Arg.Any<EventId>(),
            Arg.Any<object>(),
            Arg.Any<Exception?>(),
            Arg.Any<Func<object, Exception?, string>>());
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("   ")]
    [InlineData("\t")]
    public async Task GetUsersWithBuddy_ReturnsEmpty_WithoutCallingApi_WhenNameIsWhitespace(string buddyPlayerName)
    {
        var logger = Substitute.For<ILogger<BuddyApiService>>();
        var configuration = Substitute.For<IConfiguration>();
        configuration["ApiBaseUrl"].Returns("http://bf42-stats-service.bf42-stats:8080");
        var httpClient = new HttpClient(new FailIfCalledHandler());
        var service = new BuddyApiService(httpClient, logger, configuration);

        var result = await service.GetUsersWithBuddy(buddyPlayerName);

        Assert.Empty(result);
        logger.DidNotReceive().Log(
            LogLevel.Error,
            Arg.Any<EventId>(),
            Arg.Any<object>(),
            Arg.Any<Exception?>(),
            Arg.Any<Func<object, Exception?, string>>());
        logger.DidNotReceive().Log(
            LogLevel.Warning,
            Arg.Any<EventId>(),
            Arg.Any<object>(),
            Arg.Any<Exception?>(),
            Arg.Any<Func<object, Exception?, string>>());
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("   ")]
    public async Task GetUsersWithFavouriteServer_ReturnsEmpty_WithoutCallingApi_WhenGuidIsWhitespace(string serverGuid)
    {
        var logger = Substitute.For<ILogger<BuddyApiService>>();
        var configuration = Substitute.For<IConfiguration>();
        configuration["ApiBaseUrl"].Returns("http://bf42-stats-service.bf42-stats:8080");
        var httpClient = new HttpClient(new FailIfCalledHandler());
        var service = new BuddyApiService(httpClient, logger, configuration);

        var result = await service.GetUsersWithFavouriteServer(serverGuid);

        Assert.Empty(result);
        logger.DidNotReceive().Log(
            LogLevel.Error,
            Arg.Any<EventId>(),
            Arg.Any<object>(),
            Arg.Any<Exception?>(),
            Arg.Any<Func<object, Exception?, string>>());
        logger.DidNotReceive().Log(
            LogLevel.Warning,
            Arg.Any<EventId>(),
            Arg.Any<object>(),
            Arg.Any<Exception?>(),
            Arg.Any<Func<object, Exception?, string>>());
    }

    [Fact]
    public async Task GetUsersWithFavouriteServer_ReturnsEmpty_OnServiceUnavailable()
    {
        var logger = Substitute.For<ILogger<BuddyApiService>>();
        var configuration = Substitute.For<IConfiguration>();
        configuration["ApiBaseUrl"].Returns("http://bf42-stats-service.bf42-stats:8080");
        var httpClient = new HttpClient(new StatusHandler(HttpStatusCode.ServiceUnavailable));
        var service = new BuddyApiService(httpClient, logger, configuration);

        var result = await service.GetUsersWithFavouriteServer("1d1680b-3c0e83-a1e6bf3-1ffb030");

        Assert.Empty(result);
        logger.DidNotReceive().Log(
            LogLevel.Error,
            Arg.Any<EventId>(),
            Arg.Any<object>(),
            Arg.Any<Exception?>(),
            Arg.Any<Func<object, Exception?, string>>());
    }

    private sealed class ThrowHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            throw new HttpRequestException(
                HttpRequestError.ConnectionError,
                "Connection refused (bf42-stats-service.bf42-stats:8080)",
                inner: new SocketException((int)SocketError.ConnectionRefused));
        }
    }

    private sealed class StatusHandler(HttpStatusCode statusCode) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            return Task.FromResult(new HttpResponseMessage(statusCode)
            {
                RequestMessage = request
            });
        }
    }

    private sealed class FailIfCalledHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            throw new InvalidOperationException($"HTTP should not be called for {request.RequestUri}");
        }
    }
}
