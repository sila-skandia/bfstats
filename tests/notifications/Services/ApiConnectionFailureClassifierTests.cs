using System.Net.Sockets;
using notifications.Services;

namespace notifications.tests.Services;

public class ApiConnectionFailureClassifierTests
{
    [Fact]
    public void IsTransient_Null_IsFalse()
    {
        Assert.False(ApiConnectionFailureClassifier.IsTransient(null));
    }

    [Fact]
    public void IsTransient_ConnectionRefused_IsTrue()
    {
        var exception = new HttpRequestException(
            HttpRequestError.ConnectionError,
            "Connection refused (bf42-stats-service.bf42-stats:8080)",
            inner: new SocketException((int)SocketError.ConnectionRefused));

        Assert.True(ApiConnectionFailureClassifier.IsTransient(exception));
    }

    [Fact]
    public void IsTransient_InnerSocketRefusedWithoutHttpRequestError_IsTrue()
    {
        var exception = new HttpRequestException(
            "Connection refused (bf42-stats-service.bf42-stats:8080)",
            new SocketException((int)SocketError.ConnectionRefused));

        Assert.True(ApiConnectionFailureClassifier.IsTransient(exception));
    }

    [Fact]
    public void IsTransient_Unexpected_IsFalse()
    {
        var exception = new InvalidOperationException("JSON was invalid.");

        Assert.False(ApiConnectionFailureClassifier.IsTransient(exception));
    }
}
