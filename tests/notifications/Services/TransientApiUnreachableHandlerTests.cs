using System.Net;
using System.Net.Sockets;
using notifications.Services;

namespace notifications.tests.Services;

public class TransientApiUnreachableHandlerTests
{
    [Fact]
    public async Task SendAsync_ConvertsConnectionRefusedTo503()
    {
        var handler = new TransientApiUnreachableHandler
        {
            InnerHandler = new ThrowHandler()
        };
        using var client = new HttpClient(handler);

        var response = await client.GetAsync("http://bf42-stats-service.bf42-stats:8080/stats/notification/users-with-favourite-server?serverGuid=x");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Equal("API unreachable", response.ReasonPhrase);
    }

    [Fact]
    public async Task SendAsync_DoesNotSwallowUnexpectedErrors()
    {
        var handler = new TransientApiUnreachableHandler
        {
            InnerHandler = new UnexpectedHandler()
        };
        using var client = new HttpClient(handler);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            client.GetAsync("http://bf42-stats-service.bf42-stats:8080/health"));
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

    private sealed class UnexpectedHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            throw new InvalidOperationException("boom");
        }
    }
}
