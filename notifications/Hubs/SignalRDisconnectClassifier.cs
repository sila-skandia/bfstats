namespace notifications.Hubs;

public static class SignalRDisconnectClassifier
{
    public static bool IsExpectedIdleDisconnect(Exception? exception)
    {
        if (exception is null)
        {
            return false;
        }

        return exception.Message.Contains("ClientTimeoutInterval", StringComparison.Ordinal)
               || exception.Message.Contains("Client hasn't sent a message/ping", StringComparison.Ordinal);
    }
}
