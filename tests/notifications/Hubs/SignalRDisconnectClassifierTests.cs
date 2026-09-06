using notifications.Hubs;

namespace notifications.tests.Hubs;

public class SignalRDisconnectClassifierTests
{
    [Fact]
    public void IsExpectedIdleDisconnect_Null_IsFalse()
    {
        Assert.False(SignalRDisconnectClassifier.IsExpectedIdleDisconnect(null));
    }

    [Fact]
    public void IsExpectedIdleDisconnect_ClientTimeout_IsTrue()
    {
        var exception = new OperationCanceledException(
            "Client hasn't sent a message/ping within the configured ClientTimeoutInterval.");

        Assert.True(SignalRDisconnectClassifier.IsExpectedIdleDisconnect(exception));
    }

    [Fact]
    public void IsExpectedIdleDisconnect_Unexpected_IsFalse()
    {
        var exception = new InvalidOperationException("Hub method failed.");

        Assert.False(SignalRDisconnectClassifier.IsExpectedIdleDisconnect(exception));
    }
}
