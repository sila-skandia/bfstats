namespace api.Auth;

/// <summary>
/// A RefreshTokens write sat on SQLITE_BUSY until the short write timeout.
/// Controllers map this to HTTP 503 so the client retries instead of hanging.
/// </summary>
public sealed class RefreshTokenWriteLockedException : Exception
{
    public RefreshTokenWriteLockedException()
        : this("write", 0)
    {
    }

    public RefreshTokenWriteLockedException(string message)
        : base(message)
    {
        Action = "write";
    }

    public RefreshTokenWriteLockedException(string message, Exception innerException)
        : base(message, innerException)
    {
        Action = "write";
    }

    public RefreshTokenWriteLockedException(string action, int elapsedMs)
        : base($"Refresh token write {action} locked after {elapsedMs}ms")
    {
        Action = action;
        ElapsedMs = elapsedMs;
    }

    public string Action { get; } = "write";
    public int ElapsedMs { get; }
}
