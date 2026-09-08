using System.Net.Sockets;

namespace notifications.Services;

public static class ApiConnectionFailureClassifier
{
    public static bool IsTransient(Exception? exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            if (current is HttpRequestException httpException
                && httpException.HttpRequestError is HttpRequestError.ConnectionError
                    or HttpRequestError.NameResolutionError
                    or HttpRequestError.SecureConnectionError)
            {
                return true;
            }

            if (current is SocketException socketException
                && socketException.SocketErrorCode is SocketError.ConnectionRefused
                    or SocketError.HostUnreachable
                    or SocketError.NetworkUnreachable
                    or SocketError.TimedOut
                    or SocketError.TryAgain)
            {
                return true;
            }
        }

        return false;
    }
}
